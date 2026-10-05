import test from "node:test";
import assert from "node:assert/strict";
import { inferSpineMode } from "./aiContent.js";
import { pickTemplateFromMatrix } from "./eventMatrixToFillSeed.js";
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
