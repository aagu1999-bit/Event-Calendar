import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readStoryDesk, buildMovesPrompt, checkMoves, movesToSlides, generateStoryCarousel } from "./storyMoves.js";
import { deskContextText, scoreDeck } from "./storyEval.js";

const desk = JSON.parse(readFileSync(new URL("../../evals/desks/zanzibar.json", import.meta.url), "utf8"));
const zanzibar = deskContextText(desk);

const seeded = [
  "OPERATOR HOOK: Zanzibar's sound outlived the room",
  "POV: The club closed; the music did not.",
  "",
  "ANCHORED FACTS (write from these — numbers match Fuel on the desk):",
  "1. START — Club Zanzibar opened in 1979 under the Lincoln Motel in Newark.",
  "3. SCENE — On Saturdays Tony Humphries played to a packed floor until morning.",
  "",
  "PARKED FUEL — on the desk, not this carousel. Do not write these:",
  "2. START — A 2019 listicle ranked Newark clubs.",
  "",
  "GAPS — not proof. Do not write these as facts. Unverified claims stay off the slides:",
  "4. GAP — Did Zanzibar invent Jersey Club? Cite a page or NONE.",
  "",
  "COHERENCE: ready — fine",
].join("\n");

test("readStoryDesk keeps Fuel numbers and sections", () => {
  const d = readStoryDesk(seeded);
  assert.equal(d.hook, "Zanzibar's sound outlived the room");
  assert.equal(d.pov, "The club closed; the music did not.");
  assert.deepEqual(d.lines.map((l) => [l.n, l.kind, l.status]), [
    [1, "START", "in"], [3, "SCENE", "in"], [2, "START", "parked"], [4, "GAP", "gap"],
  ]);
  assert.equal(d.lines[0].text, "Club Zanzibar opened in 1979 under the Lincoln Motel in Newark.");
});

test("hand-typed dashed desk lines number in order", () => {
  const d = readStoryDesk(zanzibar);
  assert.equal(d.lines.length, 6);
  assert.deepEqual(d.lines.map((l) => l.n), [1, 2, 3, 4, 5, 6]);
  assert.ok(d.pov.startsWith("Rutgers scholarship"));
});

test("prompt shows usable lines by number and fences off the rest", () => {
  const p = buildMovesPrompt({ topic: "Zanzibar", context: seeded });
  assert.match(p, /#1 START — Club Zanzibar opened/);
  assert.match(p, /#3 SCENE — On Saturdays/);
  const [usablePart, blocked] = p.split("NOT USABLE");
  assert.ok(!usablePart.includes("#2 START"));
  assert.match(blocked, /#2 START — A 2019 listicle/);
  assert.match(blocked, /#4 GAP/);
});

const told = {
  focus: "Zanzibar closed in 1994, but the deep-house sound Tony Humphries built in that Newark basement still runs through Jersey Club.",
  moves: [
    { job: "open", label: "NEWARK, 1979", headline: "A basement under the Lincoln Motel", text: "Club Zanzibar opened under a Newark motel, and its photographs, films and sound are back on view in A House Called Zanzibar.", cites: [1] },
    { job: "turn", label: "THE DJ", headline: "Humphries slows the floor down", text: "Tony Humphries steered the room from disco toward deep house.", cites: [4], follows: "who made the sound" },
    { job: "context", label: "WHO DANCED", headline: "A room the city needed", text: "Queer Newark dancers remember it as a social home, not only a club night.", cites: [6], follows: "who the sound was for" },
    { job: "caveat", label: "ONE CAUTION", headline: "Many scenes, not one origin", text: "Jasmine A. Henry warns against folding Newark's club scenes into a single origin story.", cites: [2], follows: "don't overclaim the line to now" },
    { job: "next", label: "SEE IT", headline: "Where the archive lives", text: "Vincent Bryant's photo memoir and the Rutgers club-music guide hold the first-person accounts.", cites: [3], follows: "where to go next" },
  ],
};

test("a connected plan passes clean and parks the unused line", () => {
  const plan = checkMoves(told, zanzibar);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.parked.map((p) => p.n), [5]);
  const slides = movesToSlides(plan);
  assert.deepEqual(slides.map((s) => s.type), ["cover", "news", "news", "news", "cta"]);
  assert.equal(slides[1].newsHeadline, "Humphries slows the floor down");
  assert.deepEqual(slides[1]._move.cites, [4]);
  const s = scoreDeck(slides, { deskContext: zanzibar });
  assert.equal(s.sourceDumpCards, 0);
  assert.equal(s.restatementPairs, 0);
  assert.equal(s.clippedTitles, 0);
});

const readingList = {
  focus: "",
  moves: [
    { job: "open", headline: "Newark's Club Zanzibar: from local hits to global beats", text: "An exhibition and Rutgers scholarship trace the club's influence.", cites: [1] },
    { job: "context", headline: "Henry's dissertation", text: "Jasmine A. Henry's 2022 dissertation uses oral history and ethnography to trace contemporary Newark Jersey Club makers.", cites: [2] },
    { job: "caveat", headline: "Rutgers guide", text: "Rutgers scholarship offers a locally grounded way to trace the club without collapsing distinct scenes into one origin story.", cites: [3, 9] },
    { job: "caveat", headline: "Rutgers again", text: "Rutgers scholarship offers a locally grounded way to trace the club without collapsing distinct scenes into one origin story.", cites: [] },
  ],
};

test("a reading-list plan is flagged, not rewritten", () => {
  const plan = checkMoves(readingList, zanzibar);
  const types = plan.warnings.map((w) => w.type);
  for (const t of ["no_focus", "headline_shortened", "source_intro", "restatement", "caveat_repeated", "cite_missing", "uncited"]) {
    assert.ok(types.includes(t), `expected ${t} in ${types}`);
  }
  assert.equal(plan.moves[0].headline, "Newark's Club Zanzibar: from local hits to");
  assert.ok(plan.moves.every((m) => m.headline.length <= 45));
  const slides = movesToSlides(plan);
  assert.ok(slides[1]._warnings.some((w) => w.type === "story_source_intro"));
});

test("a parked or open-question line cannot be cited", () => {
  const plan = checkMoves({ focus: "x", moves: [{ job: "open", headline: "Open", text: "Zanzibar opened in 1979.", cites: [2, 4] }] }, seeded);
  assert.deepEqual(plan.moves[0].cites, []);
  const types = plan.warnings.map((w) => w.type);
  assert.equal(types.filter((t) => t === "cite_unusable").length, 2);
  assert.ok(types.includes("uncited"));
});

test("a move with no headline is flagged", () => {
  const plan = checkMoves({ focus: "x", moves: [{ job: "open", headline: "  ", text: "Zanzibar opened.", cites: [1] }] }, zanzibar);
  assert.ok(plan.warnings.some((w) => w.type === "no_headline" && w.move === 1));
});

test("generateStoryCarousel sends one call with the schema and cuts cards", async () => {
  let body;
  const generate = async (key, b) => {
    body = b;
    return { candidates: [{ content: { parts: [{ text: JSON.stringify(told) }] } }] };
  };
  const out = await generateStoryCarousel({ apiKey: "k", topic: "Zanzibar", context: zanzibar, generate });
  assert.equal(body.generationConfig.responseSchema.properties.moves.type, "array");
  assert.match(body.contents[0].parts[0].text, /#4 START — Rutgers' "History of Queer Club Spaces/);
  assert.deepEqual(out.sequence, ["cover", "news", "news", "news", "cta"]);
  assert.equal(out.plan.focus, told.focus);
});
