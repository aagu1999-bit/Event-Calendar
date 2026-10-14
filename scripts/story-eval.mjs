#!/usr/bin/env node
// Storytelling eval runner (docs/storytelling-plan.md, Phase 0).
//
//   node scripts/story-eval.mjs score <deck.json> [--desk <id>]
//   node scripts/story-eval.mjs run [--pipeline current|moves] [--desk <id>|all] [--runs 3]
//   node scripts/story-eval.mjs judge [--pipeline current] [--desk <id>|all]
//   node scripts/story-eval.mjs summary
//   node scripts/story-eval.mjs review --a current --b <pipeline> [--out evals/review/round-1]
//   node scripts/story-eval.mjs tally --answers <answers.json> --key <round.key.json>
//
// score, summary, review and tally need no key. run and judge need
// GEMINI_API_KEY. Desks live in evals/desks/<id>.json, runs are written
// to evals/runs/<pipeline>/<desk>/<n>.json.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreDeck, deskContextText, slideTitle, slideBody } from "../src/shared/storyEval.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKS = join(ROOT, "evals", "desks");
const RUNS = join(ROOT, "evals", "runs");

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

function parseArgs(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (a.startsWith("--")) {
      const next = list[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else { out[a.slice(2)] = next; i += 1; }
    } else out._.push(a);
  }
  return out;
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2) + "\n"); };

function loadDesk(id) {
  const p = join(DESKS, `${id}.json`);
  if (!existsSync(p)) throw new Error(`No desk at ${p}`);
  return readJson(p);
}

function deskIds(which) {
  if (which && which !== "all" && which !== true) return String(which).split(",");
  return readdirSync(DESKS).filter((f) => f.endsWith(".json")).map((f) => basename(f, ".json")).sort();
}

function runFiles(pipeline, deskId) {
  const dir = join(RUNS, pipeline, deskId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)).map((f) => join(dir, f));
}

function requireKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY is not set. Add it under Cloud Agents > Secrets, or export it locally.");
    process.exit(1);
  }
  return key;
}

const counts = (s) => ({
  slides: s.slideCount,
  restatementPairs: s.restatementPairs,
  clippedTitles: s.clippedTitles,
  sourceDumpCards: s.sourceDumpCards,
  cardsWithUnsupportedNames: s.cardsWithUnsupportedNames,
});

// The desk Generate path in AiTemplateFillModal: Cover + one News per
// usable receipt + CTA, length locked. New pipelines (Phase 4 moves) add
// an entry here so the same desks run through both.
const PIPELINES = {
  async current({ apiKey, desk }) {
    const { generateTemplateFill } = await import("../src/shared/aiContent.js");
    const { earnedSlideCount, essaySlideSequence } = await import("../src/shared/matrixCompass.js");
    const context = deskContextText(desk);
    const n = earnedSlideCount(context);
    const sequence = essaySlideSequence(n);
    const slides = await generateTemplateFill({
      apiKey,
      sequence,
      topic: desk.topic,
      context,
      voice: desk.voice,
      templateMeta: {
        name: `${n} slides from this desk`,
        keyMove: "Cover locates. Extra chairs are more News — one receipt per card. Last sentence may plant the next In START with a short definition. Omit unverified claims and Gaps. Do not invent gaps onto slides.",
      },
      mode: desk.mode || "content",
      isEvergreen: !!desk.isEvergreen,
      lockLength: true,
    });
    return { sequence, slides };
  },
  async moves({ apiKey, desk }) {
    const { generateStoryCarousel } = await import("../src/shared/storyMoves.js");
    const { plan, sequence, slides } = await generateStoryCarousel({
      apiKey,
      topic: desk.topic,
      context: deskContextText(desk),
      mode: desk.mode || "content",
    });
    const { desk: _desk, ...kept } = plan;
    return { sequence, slides, plan: kept };
  },
};

async function cmdScore() {
  const file = args._[0];
  if (!file) throw new Error("score needs a deck file");
  const deck = readJson(resolve(file));
  const slides = Array.isArray(deck) ? deck : deck.slides;
  const deskId = args.desk || deck.desk;
  const context = deskId ? deskContextText(loadDesk(deskId)) : "";
  const score = scoreDeck(slides, { deskContext: context });
  console.log(JSON.stringify(args.details ? score : counts(score), null, 2));
}

async function cmdRun() {
  const apiKey = requireKey();
  const pipeline = String(args.pipeline || "current");
  const run = PIPELINES[pipeline];
  if (!run) throw new Error(`Unknown pipeline "${pipeline}". Known: ${Object.keys(PIPELINES).join(", ")}`);
  const runs = Math.max(1, parseInt(args.runs || "3", 10));
  for (const id of deskIds(args.desk)) {
    const desk = loadDesk(id);
    const start = runFiles(pipeline, id).length;
    for (let r = 1; r <= runs; r += 1) {
      const n = start + r;
      process.stderr.write(`${pipeline} · ${id} · run ${n}… `);
      const t0 = Date.now();
      try {
        const { sequence, slides, plan } = await run({ apiKey, desk });
        const score = scoreDeck(slides, { deskContext: deskContextText(desk) });
        writeJson(join(RUNS, pipeline, id, `${n}.json`), {
          desk: id, pipeline, run: n, at: new Date().toISOString(), ms: Date.now() - t0,
          sequence, slides, ...(plan ? { plan } : {}), score: counts(score), details: score.details,
        });
        process.stderr.write(`${slides.length} slides, ${score.sourceDumpCards} source-led, ${score.restatementPairs} repeats\n`);
      } catch (e) {
        process.stderr.write(`failed: ${e.message}\n`);
      }
    }
  }
}

function deckAsText(slides) {
  return slides.map((s, i) => {
    const title = slideTitle(s);
    const body = slideBody(s);
    return `[${i + 1}] (${s.type})${title ? ` ${title}` : ""}${body ? `\n${body}` : ""}`;
  }).join("\n\n");
}

const JUDGE_PROMPT = `You are an editor testing a carousel by deleting cards.
For each card, imagine the deck without it. What would a reader no longer know or feel?
If the answer is nothing a later or earlier card does not already give them, the card is removable.
Cover and last card count too.
Then state, in one sentence, what the deck is about — the point a reader walks away with. If you cannot, say "no single point".
Return JSON: {"point": string, "cards": [{"slide": number, "removable": boolean, "loses": string, "repeats": number|null}]}`;

async function judgeDeck(apiKey, slides) {
  const { geminiGenerate } = await import("../src/shared/aiContent.js");
  const data = await geminiGenerate(apiKey, {
    contents: [{ role: "user", parts: [{ text: `${JUDGE_PROMPT}\n\nDECK:\n\n${deckAsText(slides)}` }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "{}";
  const parsed = JSON.parse(text);
  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  return {
    point: String(parsed.point || ""),
    removableCards: cards.filter((c) => c.removable).map((c) => c.slide),
    cards,
  };
}

async function cmdJudge() {
  const apiKey = requireKey();
  const pipeline = String(args.pipeline || "current");
  for (const id of deskIds(args.desk)) {
    for (const file of runFiles(pipeline, id)) {
      const run = readJson(file);
      if (run.judge && !args.force) continue;
      process.stderr.write(`judge · ${pipeline} · ${id} · ${basename(file)}… `);
      try {
        run.judge = await judgeDeck(apiKey, run.slides);
        writeJson(file, run);
        process.stderr.write(`${run.judge.removableCards.length} removable\n`);
      } catch (e) {
        process.stderr.write(`failed: ${e.message}\n`);
      }
    }
  }
}

function cmdSummary() {
  if (!existsSync(RUNS)) { console.log("No runs yet."); return; }
  const rows = [];
  for (const pipeline of readdirSync(RUNS)) {
    for (const id of readdirSync(join(RUNS, pipeline))) {
      const files = runFiles(pipeline, id);
      if (!files.length) continue;
      const runs = files.map(readJson);
      const avg = (f) => Math.round((runs.reduce((a, r) => a + f(r), 0) / runs.length) * 10) / 10;
      const judged = runs.filter((r) => r.judge);
      rows.push({
        pipeline, desk: id, runs: runs.length,
        slides: avg((r) => r.score.slides),
        sourceLed: avg((r) => r.score.sourceDumpCards),
        repeats: avg((r) => r.score.restatementPairs),
        clipped: avg((r) => r.score.clippedTitles),
        offDesk: avg((r) => r.score.cardsWithUnsupportedNames),
        removable: judged.length ? Math.round((judged.reduce((a, r) => a + r.judge.removableCards.length, 0) / judged.length) * 10) / 10 : null,
      });
    }
  }
  console.table(rows);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function deckHtml(slides) {
  return slides.map((s, i) => `<div class="card"><div class="n">${i + 1}</div>${slideTitle(s) ? `<h3>${esc(slideTitle(s))}</h3>` : ""}<p>${esc(slideBody(s)).replace(/\n/g, "<br>")}</p></div>`).join("");
}

const QUESTIONS = [
  ["story", "Which one tells a story — a point you could say back in a sentence?"],
  ["post", "Which would you post?"],
  ["cut", "Which has a card you would cut?"],
];

function cmdReview() {
  const a = String(args.a || "current");
  const b = args.b && String(args.b);
  if (!b) throw new Error("review needs --b <pipeline>");
  const out = resolve(String(args.out || join(ROOT, "evals", "review", `${a}-vs-${b}`)));
  const pairs = [];
  const key = {};
  for (const id of deskIds(args.desk)) {
    const fa = runFiles(a, id);
    const fb = runFiles(b, id);
    const n = Math.min(fa.length, fb.length);
    for (let i = 0; i < n; i += 1) {
      const pairId = `p${pairs.length + 1}`;
      const flip = Math.random() < 0.5;
      const left = readJson(flip ? fb[i] : fa[i]);
      const right = readJson(flip ? fa[i] : fb[i]);
      key[pairId] = { desk: id, left: left.pipeline, right: right.pipeline };
      pairs.push({ pairId, title: loadDesk(id).title || id, left: left.slides, right: right.slides });
    }
  }
  if (!pairs.length) throw new Error(`No desk has runs for both ${a} and ${b}.`);
  for (let i = pairs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const opts = (name) => ["Left", "Right", "Both", "Neither"].map((o) => `<label><input type="radio" name="${name}" value="${o.toLowerCase()}"> ${o}</label>`).join(" ");
  const html = `<!doctype html><meta charset="utf-8"><title>Carousel review</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:24px;background:#f4f2ee;color:#1a1a1a}
section{background:#fff;border-radius:10px;padding:16px 20px;margin:0 0 28px;box-shadow:0 1px 3px #0002}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}.cols h2{margin:4px 0 8px;font-size:16px}
.card{border:1px solid #ddd;border-radius:8px;padding:8px 12px;margin:0 0 8px;position:relative}
.card h3{margin:0 0 4px;font-size:14px;letter-spacing:.02em}.card p{margin:0}
.n{position:absolute;right:10px;top:6px;color:#999;font-size:12px}
.q{margin:6px 0}.q b{display:inline-block;min-width:430px}
button{font-size:15px;padding:10px 18px;border-radius:8px;border:0;background:#1a1a1a;color:#fff;cursor:pointer}
</style>
<h1>Carousel review</h1>
<p>Each pair is two drafts from the same desk. Which side is which changes from pair to pair. Answer all three questions for each pair, then download your answers and send the file back.</p>
${pairs.map((p, i) => `<section data-pair="${p.pairId}"><h2>${i + 1}. ${esc(p.title)}</h2>
<div class="cols"><div><h2>Left</h2>${deckHtml(p.left)}</div><div><h2>Right</h2>${deckHtml(p.right)}</div></div>
${QUESTIONS.map(([k, q]) => `<div class="q"><b>${esc(q)}</b> ${opts(`${p.pairId}-${k}`)}</div>`).join("")}
<div class="q"><b>Anything else?</b> <input name="${p.pairId}-note" style="width:50%"></div></section>`).join("")}
<button id="dl">Download answers</button>
<script>
document.getElementById("dl").onclick = () => {
  const answers = {};
  document.querySelectorAll("section[data-pair]").forEach((s) => {
    const id = s.dataset.pair, a = {};
    ${JSON.stringify(QUESTIONS.map(([k]) => k))}.forEach((k) => { const c = s.querySelector('input[name="' + id + '-' + k + '"]:checked'); a[k] = c ? c.value : null; });
    a.note = s.querySelector('input[name="' + id + '-note"]').value;
    answers[id] = a;
  });
  const blob = new Blob([JSON.stringify(answers, null, 2)], { type: "application/json" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "answers.json"; link.click();
};
</script>`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(`${out}.html`, html);
  writeJson(`${out}.key.json`, { a, b, pairs: key });
  console.log(`Wrote ${out}.html (${pairs.length} pairs). Key: ${out}.key.json — keep it away from the reviewer.`);
}

// Win rate for pipeline b over a: of the pairs where the reviewer picked
// one side, how often it was b. "both" / "neither" are reported, not counted.
export function tallyAnswers(answers, key) {
  const result = {};
  for (const [q] of QUESTIONS) {
    const t = { [key.a]: 0, [key.b]: 0, both: 0, neither: 0, unanswered: 0 };
    for (const [pairId, sides] of Object.entries(key.pairs)) {
      const v = answers[pairId]?.[q];
      if (v === "left" || v === "right") t[sides[v]] += 1;
      else if (v === "both" || v === "neither") t[v] += 1;
      else t.unanswered += 1;
    }
    const decided = t[key.a] + t[key.b];
    // For "cut", the side picked is the worse one.
    const bWins = q === "cut" ? t[key.a] : t[key.b];
    t.winRateB = decided ? Math.round((bWins / decided) * 100) / 100 : null;
    result[q] = t;
  }
  return result;
}

function cmdTally() {
  if (!args.answers || !args.key) throw new Error("tally needs --answers and --key");
  const key = readJson(resolve(String(args.key)));
  const answers = readJson(resolve(String(args.answers)));
  const result = tallyAnswers(answers, key);
  console.log(JSON.stringify(result, null, 2));
  const story = result.story.winRateB;
  if (story !== null) console.log(`${key.b} wins "tells a story" ${Math.round(story * 100)}% of decided pairs (bar: 60%).`);
}

const COMMANDS = { score: cmdScore, run: cmdRun, judge: cmdJudge, summary: cmdSummary, review: cmdReview, tally: cmdTally };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`Usage: node scripts/story-eval.mjs <${Object.keys(COMMANDS).join("|")}> …`);
    process.exit(1);
  }
  Promise.resolve(fn()).catch((e) => { console.error(e.message); process.exit(1); });
}
