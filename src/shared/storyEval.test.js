import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  scoreDeck, deskContextText, firstSentence, findSourceDumpCards,
  findRestatements, findClippedTitles, findUnsupportedNames, titleLooksChopped,
} from "./storyEval.js";
import { tallyAnswers } from "../../scripts/story-eval.mjs";

const load = (p) => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
const shipped = load("evals/decks/zanzibar-shipped.json");
const desk = load("evals/desks/zanzibar.json");

test("shipped Zanzibar deck baseline", () => {
  const s = scoreDeck(shipped.slides, { deskContext: deskContextText(desk) });
  assert.equal(s.slideCount, 11);
  assert.deepEqual(s.details.sourceDumps.map((d) => d.slide), [2, 3, 4, 5, 6, 7, 9, 10]);
  assert.deepEqual(s.details.clipped.map((d) => d.slide), [2]);
  const pairs = s.details.restatements.map((r) => r.slides.join("-"));
  for (const p of ["2-3", "2-10", "3-9"]) assert.ok(pairs.includes(p), `expected ${p} in ${pairs}`);
  assert.equal(s.cardsWithUnsupportedNames, 0);
});

const told = [
  { type: "cover", headline: "THE BASEMENT THAT TAUGHT NEWARK TO DANCE", subtitle: "Club Zanzibar closed in 1994. The room is still in every Jersey Club track." },
  { type: "news", newsKicker: "1979", newsHeadline: "A HOTEL BASEMENT ON LINCOLN PARK", newsBody: "Miles Berger opened Zanzibar under the Lincoln Motel. Twelve hundred people fit on the floor on a Saturday." },
  { type: "news", newsKicker: "THE DJ", newsHeadline: "TONY HUMPHRIES SLOWS IT DOWN", newsBody: "Humphries played gospel vocals over drum machines. Dancers called the result the Jersey Sound." },
  { type: "news", newsKicker: "NOW", newsHeadline: "THE BEAT LEAVES THE ROOM", newsBody: "Kids on Clinton Avenue chopped those records into 130-bpm bed squeaks. That is Jersey Club." },
  { type: "cta", ctaKicker: "SEE IT", ctaDate: "THROUGH MARCH 2", ctaVenue: "Newark Public Library, 5 Washington St" },
];

test("a deck with one point and moving cards scores clean", () => {
  const s = scoreDeck(told, { deskContext: "- Miles Berger opened Zanzibar under the Lincoln Motel\n- Tony Humphries\n- Jersey Sound\n- Clinton Avenue kids built Jersey Club\n- Newark Public Library, 5 Washington St" });
  assert.equal(s.restatementPairs, 0);
  assert.equal(s.clippedTitles, 0);
  assert.equal(s.sourceDumpCards, 0);
  assert.equal(s.cardsWithUnsupportedNames, 0);
});

test("firstSentence does not stop at a middle initial", () => {
  assert.equal(firstSentence("Jasmine A. Henry's dissertation uses oral history. It traces makers."), "Jasmine A. Henry's dissertation uses oral history.");
});

test("a quoted title doing a document verb is source-led", () => {
  const out = findSourceDumpCards([{ type: "news", newsBody: "Rutgers’ “History of Queer Club Spaces in Newark” identifies Tony Humphries’ role." }]);
  assert.equal(out.length, 1);
});

test("restatement needs a shared run or heavy overlap", () => {
  const a = { type: "text", textBody: "The exhibition puts the club back into public view for a new crowd of dancers." };
  const b = { type: "text", textBody: "Humphries played gospel vocals over drum machines on Saturdays." };
  assert.equal(findRestatements([a, b]).length, 0);
  assert.equal(findRestatements([a, { ...a }]).length, 1);
});

test("clipped titles: at the cap or an open quote", () => {
  assert.ok(titleLooksChopped("NEWARK’S “A HOUSE CALLED ZANZIBAR” EXHIBITION PUTS A SPECIFI"));
  assert.ok(titleLooksChopped("RUTGERS’ “A HOUSE"));
  assert.ok(!titleLooksChopped("A HOTEL BASEMENT ON LINCOLN PARK"));
  assert.equal(findClippedTitles([{ type: "cta", ctaDate: "X".repeat(70) }]).length, 0);
});

test("a desk name with a curly apostrophe or a longer run still counts as on the desk", () => {
  const ctx = "- START — The Queer Newark Oral History Project records the club. Vincent Bryant's A Journey Through the House.";
  const slides = [{ type: "news", newsBody: "Later, The Queer Newark Oral History Project expands on it. See Vincent Bryant’s A Journey Through the House." }];
  assert.deepEqual(findUnsupportedNames(slides, ctx), []);
  const off = [{ type: "news", newsBody: "Later, the Tokyo Listening Room hosted a night." }];
  assert.equal(findUnsupportedNames(off, ctx).length, 1);
});

test("tally counts decided pairs and flips the cut question", () => {
  const key = { a: "current", b: "moves", pairs: { p1: { left: "moves", right: "current" }, p2: { left: "current", right: "moves" }, p3: { left: "current", right: "moves" } } };
  const answers = {
    p1: { story: "left", post: "left", cut: "right" },
    p2: { story: "right", post: "neither", cut: "left" },
    p3: { story: "left", post: "both", cut: null },
  };
  const t = tallyAnswers(answers, key);
  assert.equal(t.story.moves, 2);
  assert.equal(t.story.current, 1);
  assert.equal(t.story.winRateB, 0.67);
  assert.equal(t.post.winRateB, 1);
  assert.equal(t.cut.winRateB, 1);
  assert.equal(t.cut.unanswered, 1);
});
