import test from "node:test";
import assert from "node:assert/strict";
import {
  interpretBuildTurn,
  formatDraftForContinue,
  appendSavedTeaching,
  appendFollowupResearch,
  appendCurrentDraft,
  lessonFromTurn,
  SAVED_TEACHING_MARKER,
  CURRENT_DRAFT_MARKER,
  FOLLOWUP_RESEARCH_MARKER,
} from "./cgeBuildTurn.js";

test("a fact question before slides looks it up, then writes", () => {
  const turn = interpretBuildTurn({
    questions: "Does a new restaurant that wants a bar just get told no?",
    hasSlides: false,
  });
  assert.equal(turn.needsResearch, true);
  assert.equal(turn.startFresh, true);
  assert.equal(turn.continueBuild, false);
  assert.ok(turn.intents.includes("write"));
  assert.match(turn.label, /Look this up/);
});

test("the same question after slides keeps building — it does not start over", () => {
  const turn = interpretBuildTurn({
    questions: "What about a BYOB hall — is that the same rule?",
    hasSlides: true,
  });
  assert.equal(turn.needsResearch, true);
  assert.equal(turn.continueBuild, true);
  assert.equal(turn.startFresh, false);
  assert.ok(turn.intents.includes("continue"));
  assert.match(turn.label, /keep building/i);
});

test("marking a slide wrong writes over that part and keeps the rest", () => {
  const turn = interpretBuildTurn({
    questions: "That's not how a BYOB hall works.",
    hasSlides: true,
    markedSlides: [2],
  });
  assert.ok(turn.intents.includes("correct"));
  assert.equal(turn.rewriteMarkedOnly, true);
  assert.deepEqual(turn.markedSlides, [2]);
  assert.match(turn.label, /marked slides/);
});

test("wrong wording without a mark still continues — write over what's wrong", () => {
  const turn = interpretBuildTurn({
    questions: "Don't say N.J.S.A. That's wrong.",
    hasSlides: true,
  });
  assert.ok(turn.intents.includes("correct"));
  assert.equal(turn.continueBuild, true);
  assert.equal(turn.rewriteMarkedOnly, false);
});

test("draft map flags the wrong slide and keeps the others", () => {
  const map = formatDraftForContinue(
    [{ type: "cover" }, { type: "text" }, { type: "cta" }],
    [1],
    (s) => (s.type === "text" ? "statute dump" : "ok"),
  );
  assert.match(map, /Slide 2 \(text\)  <-- WRONG/);
  assert.match(map, /Slide 1 \(cover\)  — keep if it still holds/);
});

test("saved teaching stamps voice, exemplars, rejects, and lessons once", () => {
  const once = appendSavedTeaching("towns can't add many new drink rooms", {
    voice: { description: "street-level local critic", exemplars: ["The county's big announcements…"] },
    rejectedDrafts: [{ reason: "statute-speak" }],
    approvedDrafts: [{ digest: [] }],
    lessons: ["Don't say N.J.S.A."],
  });
  assert.equal(once.includes(SAVED_TEACHING_MARKER), true);
  assert.match(once, /street-level/);
  assert.match(once, /statute-speak/);
  assert.match(once, /Don't say N.J.S.A/);
  const twice = appendSavedTeaching(once, { lessons: ["again"] });
  assert.equal(twice, once);
});

test("follow-up research and current draft append as labeled blocks", () => {
  const withResearch = appendFollowupResearch("base", "- BYOB halls are not liquor licenses (nj.com)");
  assert.equal(withResearch.includes(FOLLOWUP_RESEARCH_MARKER), true);
  const withDraft = appendCurrentDraft(withResearch, "Slide 1 (cover) — keep: hello");
  assert.equal(withDraft.includes(CURRENT_DRAFT_MARKER), true);
  assert.match(withDraft, /do not start from scratch/);
});

test("a correction becomes a lesson that sticks; a plain ask does not", () => {
  assert.equal(lessonFromTurn({ questions: "What about BYOB?" }), "");
  assert.match(lessonFromTurn({ questions: "That's not true — BYOB is a different door." }), /BYOB/);
  assert.match(lessonFromTurn({ questions: "rewrite the closer", markedSlides: [3] }), /Slide 4/);
});
