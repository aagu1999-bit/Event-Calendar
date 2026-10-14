// The moves step (docs/storytelling-plan.md, Phase 4). One model call reads
// the whole desk and plans the story — a focus sentence, 4–7 moves that
// each depend on the one before, and the desk lines left out. Cards are
// then cut from the moves deterministically, so the deck follows the
// story instead of one card per desk line.
//
// Behind storyMode. Content / editorial only.

import { extractJson, extractResponseText } from "./aiJson.js";
import { findRestatements, findSourceDumpCards, findUnsupportedNames } from "./storyEval.js";

export const MOVE_JOBS = ["open", "turn", "scene", "voice", "context", "caveat", "holder", "next"];
export const MOVES_MIN = 4;
export const MOVES_MAX = 7;
const HEADLINE_MAX = 45;
const LABEL_MAX = 30;
const TEXT_WORDS_MAX = 45;

const LINE_KINDS = "THESIS|START|SPECIMEN|DOCUMENT|ARGUMENT|JOIN|NEXT|MECHANISM|FRICTION|LOCATE|SCENE|VOICE|CHANGE|IMAGE";
const KIND_RE = new RegExp(`^(${LINE_KINDS})\\s*—\\s*`, "i");
const HOMEWORK_RE = /^(?:RECEIPT\s*—\s*UNVERIFIED|UNVERIFIED\s*—|GAP\s*—)/i;
const SECTION_RE = /^(ANCHORED FACTS|PARKED FUEL|GAPS —)/i;
const NOTE_RE = /^(?:POV:|OPERATOR HOOK|SUBJECT LOCK:|LOCATE DESK:|COHERENCE:|USE THIS DESK|POINTED SLIDE|UNVERIFIED CLAIMS|RELATEDNESS|CONVERSATION|SLIDE_PLAN|SLIDE JOBS|NEWS STYLES)/i;

// Desk as Generate receives it (eventMatrixToFillSeed): POV / hook notes,
// then numbered Fuel lines under ANCHORED FACTS, PARKED FUEL and GAPS.
// Hand-typed desks with plain dashed lines count as anchored, numbered in
// order. Numbers are Fuel numbers, so a move's cites read like the desk.
export function readStoryDesk(context) {
  const out = { hook: "", pov: "", lines: [] };
  let section = "in";
  let counter = 0;
  for (const raw of String(context || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(SECTION_RE);
    if (sec) {
      const s = sec[1].toUpperCase();
      section = s.startsWith("ANCHORED") ? "in" : s.startsWith("PARKED") ? "parked" : "gap";
      continue;
    }
    if (/^POV:/i.test(line)) { out.pov = line.replace(/^POV:\s*/i, ""); continue; }
    const hook = line.match(/^OPERATOR HOOK[^:]*:\s*(.+)$/i);
    if (hook) { out.hook = hook[1]; continue; }
    if (NOTE_RE.test(line)) continue;
    const m = line.match(/^(?:(\d+)[.)]|[-•*])\s+(.+)$/);
    if (!m) continue;
    const n = m[1] ? Number(m[1]) : counter + 1;
    counter = Math.max(counter, n);
    let body = m[2].trim();
    const homework = HOMEWORK_RE.test(body);
    const kind = (body.match(KIND_RE)?.[1] || (homework ? "GAP" : "FACT")).toUpperCase();
    body = body.replace(KIND_RE, "").trim();
    out.lines.push({ n, kind, text: body, status: homework ? "gap" : section });
  }
  return out;
}

const usable = (desk) => desk.lines.filter((l) => l.status === "in");

function deskBlock(desk) {
  const fmt = (l) => `#${l.n} ${l.kind === "FACT" ? "" : `${l.kind} — `}${l.text}`;
  const inPlay = usable(desk);
  const blocked = desk.lines.filter((l) => l.status !== "in");
  return [
    "DESK — the only facts you may use. Cite them by number.",
    ...inPlay.map(fmt),
    ...(blocked.length ? ["", "NOT USABLE — parked by the operator, or open questions. Do not write these as fact:", ...blocked.map(fmt)] : []),
  ].join("\n");
}

export function buildMovesPrompt({ topic, context, mode } = {}) {
  const desk = readStoryDesk(context);
  return [
    "You are planning a short Instagram carousel for CGE, a publication about Black culture in New Jersey. You plan the story; the cards are cut from your plan afterwards.",
    "",
    `Topic: ${String(topic || "").trim() || "(none given)"}`,
    ...(desk.hook ? [`Operator's hook: ${desk.hook}`] : []),
    ...(desk.pov ? [`Operator's point of view: ${desk.pov}`] : []),
    `Register: ${mode || "content"}`,
    "",
    deskBlock(desk),
    "",
    "1. FOCUS — one sentence a reader could repeat to a friend: what happened or what is true, and why it matters to them. It is about the subject, not about the sources.",
    "",
    `2. MOVES — ${MOVES_MIN} to ${MOVES_MAX} steps that tell it, in order. Each move must follow from the one before it; a reader who skipped one should feel the gap.`,
    "   - Say what a source found or shows, not that the source exists. Write \"Tony Humphries steered Zanzibar from disco toward deep house\", not \"A Rutgers page identifies Humphries' role\". The source goes in cites; name it in the text only when who said it matters.",
    "   - Open on the most concrete thing on the desk: a person, a place, a moment, a number. If there is a SCENE or VOICE line, use it in the open or the turn.",
    "   - If the desk carries a caveat, say it once, in the move where it matters.",
    "   - Use only what is on the desk. Do not say one thing caused or led to another unless a desk line says so.",
    "   - The last move tells the reader where this lives now, who holds it, or what to go see — from the desk only.",
    "",
    "3. PARKED — you do not have to use every line. Fewer moves that connect beat a move per source. Lines you leave out are kept for the caption.",
    "",
    "For each move return:",
    `  job: one of ${MOVE_JOBS.join(", ")}`,
    `  label: a 1–3 word kicker (under ${LABEL_MAX} characters)`,
    `  headline: 3–7 words naming the move, not a sentence (under ${HEADLINE_MAX} characters)`,
    `  text: 1–2 sentences, at most ${TEXT_WORDS_MAX} words`,
    "  cites: the desk numbers this move stands on",
    "  follows: a few words on why this comes after the previous move (empty for the first)",
    "",
    'Return only JSON: {"focus":"...","moves":[{"job":"open","label":"...","headline":"...","text":"...","cites":[1],"follows":""}]}',
  ].join("\n");
}

const MOVES_SCHEMA = {
  type: "object",
  properties: {
    focus: { type: "string" },
    moves: {
      type: "array",
      items: {
        type: "object",
        properties: {
          job: { type: "string", enum: MOVE_JOBS },
          label: { type: "string" },
          headline: { type: "string" },
          text: { type: "string" },
          cites: { type: "array", items: { type: "integer" } },
          follows: { type: "string" },
        },
        required: ["job", "headline", "text", "cites"],
      },
    },
  },
  required: ["focus", "moves"],
};

// Shorten to whole words. Never cut inside a word — a chopped headline
// ("…PUTS A SPECIFI") is worse than a short one.
function fitWords(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  let out = "";
  for (const w of t.split(" ")) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return out.replace(/[,;:—–-]+$/, "").trim();
}

const wordCount = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

// Clean the model's plan against the desk and say what is wrong with it.
// Nothing is rewritten silently: every change or doubt is a warning on
// the move it belongs to.
export function checkMoves(raw, context) {
  const desk = readStoryDesk(context);
  const byN = new Map(desk.lines.map((l) => [l.n, l]));
  const warnings = [];
  const warn = (type, move, message) => warnings.push({ type, move, message });

  const moves = (Array.isArray(raw?.moves) ? raw.moves : []).slice(0, MOVES_MAX + 2).map((m, i) => {
    const n = i + 1;
    const job = MOVE_JOBS.includes(String(m?.job || "").toLowerCase()) ? String(m.job).toLowerCase() : (i === 0 ? "open" : "context");
    const rawHeadline = String(m?.headline || "").trim();
    const headline = fitWords(rawHeadline, HEADLINE_MAX);
    if (!headline) warn("no_headline", n, `Move ${n} has no headline.`);
    else if (headline !== rawHeadline.replace(/\s+/g, " ")) warn("headline_shortened", n, `Headline was over ${HEADLINE_MAX} characters ("${rawHeadline}"). Kept the whole words: "${headline}".`);
    const text = String(m?.text || "").replace(/\s+/g, " ").trim();
    if (wordCount(text) > TEXT_WORDS_MAX + 10) warn("text_long", n, `Move ${n} runs ${wordCount(text)} words; the card holds about ${TEXT_WORDS_MAX}.`);
    const cites = [];
    for (const c of Array.isArray(m?.cites) ? m.cites : []) {
      const num = Number(c);
      const line = byN.get(num);
      if (!line) warn("cite_missing", n, `Move ${n} cites #${c}, which is not on the desk.`);
      else if (line.status !== "in") warn("cite_unusable", n, `Move ${n} cites #${num}, which is ${line.status === "parked" ? "parked" : "an open question"}.`);
      else if (!cites.includes(num)) cites.push(num);
    }
    if (!cites.length) warn("uncited", n, `Move ${n} does not stand on any usable desk line.`);
    return {
      n,
      job,
      label: fitWords(String(m?.label || "").trim(), LABEL_MAX),
      headline,
      text,
      cites,
      follows: String(m?.follows || "").trim(),
    };
  }).filter((m) => m.text || m.headline);

  if (moves.length < MOVES_MIN) warn("too_few_moves", null, `${moves.length} moves. A story needs at least ${MOVES_MIN}; the desk may be thin.`);
  if (moves.length > MOVES_MAX) warn("too_many_moves", null, `${moves.length} moves. Past ${MOVES_MAX} the deck usually turns into a list.`);

  const asCards = moves.map((m) => ({ type: "text", textTitle: m.headline, textBody: m.text }));
  for (const d of findSourceDumpCards(asCards)) {
    warn("source_intro", d.slide, `Move ${d.slide} introduces a source instead of saying what it shows: "${d.opening}"`);
  }
  for (const r of findRestatements(asCards)) {
    warn("restatement", r.slides[1], `Moves ${r.slides[0]} and ${r.slides[1]} say the same thing${r.sharedPhrase ? ` ("${r.sharedPhrase}")` : ""}.`);
  }
  const deskText = usable(desk).map((l) => l.text).join("\n");
  for (const u of findUnsupportedNames(asCards, deskText)) {
    warn("off_desk_name", u.slide, `Move ${u.slide} names ${u.names.join(", ")}, which is not on the usable desk.`);
  }
  const caveats = moves.filter((m) => m.job === "caveat");
  if (caveats.length > 1) warn("caveat_repeated", caveats[1].n, `The caveat appears in ${caveats.length} moves (${caveats.map((m) => m.n).join(", ")}). Say it once.`);

  const cited = new Set(moves.flatMap((m) => m.cites));
  const parked = usable(desk).filter((l) => !cited.has(l.n)).map((l) => ({ n: l.n, kind: l.kind, text: l.text }));

  const focus = String(raw?.focus || "").trim();
  if (!focus) warn("no_focus", null, "The plan has no focus sentence.");

  return { focus, moves, parked, warnings, desk };
}

// One move = one card. First move is the cover, last is the closer,
// everything between is a News card. Each card carries its move so later
// passes (voice, polish, redo) can check it still does the move's job.
export function movesToSlides(plan) {
  const moves = Array.isArray(plan?.moves) ? plan.moves : [];
  const warnings = Array.isArray(plan?.warnings) ? plan.warnings : [];
  const last = moves.length - 1;
  return moves.map((m, i) => {
    const _move = { n: m.n, job: m.job, cites: m.cites, follows: m.follows };
    const own = warnings.filter((w) => w.move === m.n).map((w) => ({ type: `story_${w.type}`, message: w.message }));
    let slide;
    if (i === 0) slide = { type: "cover", headline: m.headline, subtitle: m.text };
    else if (i === last && moves.length > 1) slide = { type: "cta", ctaKicker: m.label, ctaDate: m.headline, ctaVenue: m.text };
    else slide = { type: "news", newsKicker: m.label, newsHeadline: m.headline, newsBody: m.text };
    slide._move = _move;
    if (own.length) slide._warnings = own;
    return slide;
  });
}

export async function generateStoryMoves({ apiKey, topic, context, mode, generate } = {}) {
  const call = generate || (await import("./aiContent.js")).geminiGenerate;
  const data = await call(apiKey, {
    contents: [{ parts: [{ text: buildMovesPrompt({ topic, context, mode }) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: MOVES_SCHEMA,
      temperature: 0.4,
      maxOutputTokens: 8192,
    },
  });
  const raw = extractJson(extractResponseText(data));
  return checkMoves(raw, context);
}

export async function generateStoryCarousel(opts = {}) {
  const plan = await generateStoryMoves(opts);
  const slides = movesToSlides(plan);
  return { plan, sequence: slides.map((s) => s.type), slides };
}