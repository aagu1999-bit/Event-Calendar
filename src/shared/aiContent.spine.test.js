import test from "node:test";
import assert from "node:assert/strict";
import { inferSpineMode } from "./aiContent.js";
import { pickTemplateFromMatrix, pickGenerationTopic, pickKeywordTrigger, eventMatrixToFillSeed } from "./eventMatrixToFillSeed.js";
import { EVENT_TIERS } from "./matrixEnums.js";

test("Content / Feature never becomes a showcase directory", () => {
  const guideSeq = ["cover", "spotlight", "spotlight", "spotlight", "spotlight", "cta"];
  assert.equal(inferSpineMode(guideSeq), "showcase");
  assert.equal(inferSpineMode(guideSeq, { mode: "content" }), "insight");
  assert.equal(inferSpineMode(guideSeq, { isEvergreen: true }), "insight");
  assert.equal(inferSpineMode(["cover", "text", "news", "text", "cta"], { mode: "editorial" }), "insight");
});

test("Feature matrix defaults to Editorial Insight, not Local Guide", () => {
  assert.equal(pickTemplateFromMatrix({ event_tier: EVENT_TIERS.FEATURE.key }), "editorial-insight");
  assert.equal(pickTemplateFromMatrix({ event_tier: EVENT_TIERS.ORBIT.key }), "editorial-roundup");
});

test("Feature Preview does not send the brief through the Instagram arranger", () => {
  const seed = eventMatrixToFillSeed({
    name: "Strip brief",
    matrix: {
      event_tier: EVENT_TIERS.FEATURE.key,
      editorial_pov: "Strip malls vs urban cafes",
      data_points: ["START — Sunken Silo and Autodidact on Route 22"],
    },
  });
  assert.equal(seed.arrange, false);
  assert.equal(seed.templateId, "editorial-insight");
  const orbit = eventMatrixToFillSeed({
    name: "Weekend",
    matrix: { event_tier: EVENT_TIERS.ORBIT.key, editorial_pov: "this weekend" },
  });
  assert.equal(orbit.arrange, true);
});

test("generation topic ignores a listicle hook and keeps Fuel geography", () => {
  const m = {
    hook_a_side: "Did your commuter community? Discover surprising new gathering spots",
    editorial_pov: "Black commuters returning to car-dependent hometowns feel a walkable deficit.",
    data_points: [
      "START — Cranford retrofitted the downtown",
      "START — Route 22 still gathers in a parking lot",
    ],
    event_tier: EVENT_TIERS.FEATURE.key,
    keyword_trigger: "AFROFEVER",
  };
  assert.equal(pickGenerationTopic(m, { name: "AFROFEVER" }), m.editorial_pov);
  assert.equal(pickKeywordTrigger(m), null);
  const seed = eventMatrixToFillSeed({ name: "AFROFEVER", matrix: m });
  assert.equal(seed.topic, m.editorial_pov);
  assert.equal(seed.keywordTrigger, null);
  assert.match(seed.context, /OPERATOR HOOK \(listicle/);
  assert.match(seed.context, /Cranford retrofitted/);
});

test("a named-contrast hook stays the generation topic", () => {
  const hook = "Walker's Paradise vs the strip-mall geography Route 22 built";
  assert.equal(pickGenerationTopic({ hook_a_side: hook, editorial_pov: "a longer pov" }), hook);
  assert.equal(pickKeywordTrigger({
    event_tier: EVENT_TIERS.FEATURE.key,
    keyword_trigger: "Route 22",
    hook_a_side: hook,
  }), "Route 22");
});
