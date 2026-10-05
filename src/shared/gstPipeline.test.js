import test from "node:test";
import assert from "node:assert/strict";
import {
  GST_SLIDE_COUNT,
  GST_MAX_WORDS,
  GST_DESIGN_TOKENS,
  wordCount,
  containsBannedPhrase,
  stripScanMarkers,
  extractScanPath,
  enforceMicroCopyRules,
  gstCopyToSlots,
} from "./gstPipeline.js";

test("GST design tokens lock a 10-role arc", () => {
  assert.equal(GST_DESIGN_TOKENS.slideRoles.length, GST_SLIDE_COUNT);
  assert.equal(GST_DESIGN_TOKENS.slideRoles[0], "hook");
  assert.equal(GST_DESIGN_TOKENS.slideRoles[9], "cta");
});

test("word count ignores scan-path markers", () => {
  assert.equal(wordCount("**The Barrier:** liquor caps freeze the tap"), 7);
});

test("banned corporate sludge is detected", () => {
  const hits = containsBannedPhrase("Moreover this is a testament to our vibrant community");
  assert.ok(hits.includes("moreover"));
  assert.ok(hits.includes("testament"));
  assert.ok(hits.includes("vibrant community"));
});

test("scan-path extract + strip", () => {
  const raw = "**The Barrier:** towns hit the cap";
  assert.deepEqual(extractScanPath(raw), ["The Barrier:"]);
  assert.equal(stripScanMarkers(raw), "The Barrier: towns hit the cap");
});

test("enforceMicroCopyRules trims over 35 words and strips bans", () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const out = enforceMicroCopyRules([
    {
      n: 1,
      role: "hook",
      headline: "HOOK",
      body: `${long} moreover delve`,
      scanPath: [],
    },
  ]);
  assert.ok(out[0].wordCount <= GST_MAX_WORDS);
  assert.equal(out[0].bannedHits.length, 0);
  assert.ok(!/moreover|delve/i.test(out[0].body));
});

test("gstCopyToSlots maps the 10-slide GST arc onto MediaTool types", () => {
  const micro = [
    { n: 1, role: "hook", headline: "THE TAP IS FROZEN", body: "Nowhere to go means the licenses are gone.", scanPath: ["TAP"] },
    { n: 2, role: "anatomy", headline: "**The Barrier:** license caps", body: "Towns can't add new drink rooms.", scanPath: ["The Barrier:"] },
    { n: 3, role: "anatomy", headline: "Old licenses stay", body: "Grandfathered rooms keep pouring.", scanPath: [] },
    { n: 4, role: "anatomy", headline: "3,000 residents per license", body: "Many towns already hit the cap.", scanPath: ["3,000"] },
    { n: 5, role: "case", headline: "NEWARK", body: "Saturday spills into the same three rooms.", scanPath: [] },
    { n: 6, role: "case", headline: "ROUTE 22", body: "Parking-lot beer instead of a walkable bar.", scanPath: [] },
    { n: 7, role: "case", headline: "BYOB HALL", body: "Wine only. No advertise. Not a bar.", scanPath: [] },
    { n: 8, role: "case", headline: "$1M LICENSE", body: "Secondary market prices out new rooms.", scanPath: [] },
    { n: 9, role: "epiphany", headline: "THE FEELING", body: "A shut town is a policy outcome, not a vibe fail.", scanPath: [] },
    { n: 10, role: "cta", headline: "Comment LICENSE", body: "Name the town where the tap feels frozen.", scanPath: ["LICENSE"] },
  ];
  const { sequence, slides } = gstCopyToSlots(micro);
  assert.equal(slides.length, 10);
  assert.equal(sequence[0], "cover");
  assert.equal(sequence[sequence.length - 1], "cta");
  assert.equal(slides[0].type, "cover");
  assert.equal(slides[3].type, "stat");
  assert.equal(slides[4].type, "spotlight");
  assert.equal(slides[8].type, "text");
  assert.equal(slides[9].type, "cta");
  assert.ok(!/\*\*/.test(slides[0].headline));
});
