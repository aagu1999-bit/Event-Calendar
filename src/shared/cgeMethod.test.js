import test from "node:test";
import assert from "node:assert/strict";
import {
  METHOD_MARKER,
  parseMethodBrief,
  methodHasJoin,
  methodBriefToBullets,
  formatMethodBriefForContext,
  appendMethodBriefToContext,
  contextHasMethodBrief,
  contextHasFuelBrief,
  OPERATOR_QUESTIONS_MARKER,
  appendOperatorQuestions,
  contentMethodBlock,
  contentMethodResearchPrompt,
  contentArrangerLines,
  contentMethodSpineBlock,
  CONTENT_ESSAY_ARC,
  CONTENT_FLYER_SLOTS,
} from "./cgeMethod.js";

test("parseMethodBrief reads labeled lines", () => {
  const parsed = parseMethodBrief([
    "SPECIMEN: The Caribbean hall on that Newark corridor",
    "PATTERN: Same-city diaspora rooms keep two calendars",
    "MECHANISM: missed overlap",
    "DOCUMENT: Club Zanzibar closed 1992 (NJ.com)",
    "JOIN: The African restaurant two blocks over shares the Saturday and almost no audience",
    "REMNANT: The hall still opens Sundays",
    "UNCONFIRMED: NONE",
  ].join("\n"));
  assert.equal(parsed.specimen.startsWith("The Caribbean hall"), true);
  assert.equal(parsed.mechanism, "missed overlap");
  assert.equal(methodHasJoin(parsed), true);
  assert.deepEqual(methodBriefToBullets(parsed).length, 3);
});

test("a Fuel Research brief skips the second generation research pass", () => {
  assert.equal(contextHasFuelBrief("POV: the strip is empty\n\n- START — Cranford retrofitted the downtown\n- GAP — currently operating strip-mall speakeasy"), true);
  assert.equal(contextHasFuelBrief("THESIS — NJ was built as a commuter town."), true);
  assert.equal(contextHasFuelBrief("POV: a vibe\n- some cafe hours"), false);
});

test("JOIN: NONE is not a join", () => {
  assert.equal(methodHasJoin({ join: "NONE" }), false);
  assert.equal(methodHasJoin({ join: "could not find a sideways tie" }), false);
  assert.equal(methodHasJoin({ join: "The 1947 liquor cap explains the 150-cap room" }), true);
});

test("format and append stamp the method marker and extra bullets", () => {
  const block = formatMethodBriefForContext({
    parsed: {
      specimen: "A hall",
      pattern: "Memory loss",
      mechanism: "ownership vs programming",
      document: "Founded 1979",
      join: "The sister church kept the archive",
      remnant: "Ask the deacon",
    },
  });
  assert.equal(contextHasMethodBrief(block), true);
  assert.match(block, /homework from this desk/);
  assert.equal(/required architecture/.test(block), false);
  assert.match(block, /JOIN: The sister church/);
  assert.match(block, /^- Founded 1979/m);
  const next = appendMethodBriefToContext("POV: a thesis\n- existing bullet", { parsed: {
    specimen: "A hall",
    pattern: "Memory loss",
    document: "Founded 1979",
    join: "The sister church kept the archive",
    remnant: "Ask the deacon",
  } });
  assert.equal(contextHasMethodBrief(next), true);
  assert.match(next, /existing bullet/);
  assert.equal(next.includes(METHOD_MARKER), true);
});

test("appendOperatorQuestions is a no-op when blank and stamps the marker when asked", () => {
  assert.equal(appendOperatorQuestions("towns can't add many new drink rooms", "   "), "towns can't add many new drink rooms");
  assert.equal(appendOperatorQuestions("", ""), "");
  const next = appendOperatorQuestions(
    "Old places stay. New ones get blocked.",
    "Does a new restaurant that wants a bar just get told no?\nWhat about a BYOB hall?",
  );
  assert.equal(next.includes(OPERATOR_QUESTIONS_MARKER), true);
  assert.match(next, /Old places stay/);
  assert.match(next, /BYOB hall/);
  assert.match(next, /everyday wording/);
});

test("method homework does not hunt the house fight by default", () => {
  const prompt = contentMethodResearchPrompt({
    topic: "Newark Tech Week",
    context: "specifically for business owners",
  });
  assert.match(prompt, /HOUSE FIGHT IS OPTIONAL/);
  assert.match(prompt, /MECHANISM, PATTERN, JOIN, DOCUMENT/);
  assert.match(prompt, /NONE unless this specimen already shows/);
  assert.match(prompt, /PATTERN: \(NONE unless/);
  assert.match(prompt, /DOCUMENT: \(NONE unless/);
  assert.match(prompt, /JOIN: \(NONE unless/);
  assert.match(prompt, /not a CGE default/);
  assert.equal(/same-city other-diaspora site unless/.test(prompt), true);
  assert.equal(/PATTERN: \(the reusable pressure this NJ specimen is an instance of — may be a regional or country-wide norm: memory loss, ownership vs programming/.test(prompt), false);
});

test("method block writes an essay, not an Instagram formula", () => {
  const block = contentMethodBlock().join("\n");
  assert.match(block, new RegExp(CONTENT_ESSAY_ARC.replace(/[→]/g, "→")));
  assert.match(block, /EXPLAIN/);
  assert.match(block, /Sunken Silo and Autodidact/);
  assert.match(block, /find your next gathering spot/);
  assert.match(block, /discover surprising gathering spots/);
  assert.match(block, /Cover locates/);
  assert.equal(/Cover states the CONTRAST from THESIS/.test(block), false);
  assert.equal(/every other slide stays on one time/.test(block), false);
  const arranger = contentArrangerLines().join("\n");
  assert.match(arranger, /OPEN A LOOP/);
  assert.match(arranger, /Instagram formula is banned/);
  assert.match(arranger, /If the desk only locates, Cover \+ News locates/);
  for (const slot of CONTENT_FLYER_SLOTS) {
    assert.match(arranger, new RegExp(slot));
  }
  const spine = contentMethodSpineBlock().join("\n");
  assert.match(spine, /If it only locates, outline Cover \+ News/);
  assert.match(spine, /If the brief only located: two sentences that locate THIS specimen/);
});
