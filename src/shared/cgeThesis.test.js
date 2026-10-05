import test from "node:test";
import assert from "node:assert/strict";
import { cadenceRotationBlock, contentCreativeDirection } from "./cgeThesis.js";

test("cadence rotation is sentence rhythm, not detective vs GST", () => {
  const block = cadenceRotationBlock().join("\n");
  assert.match(block, /STACKED/);
  assert.match(block, /one thought, one sentence/);
  assert.match(block, /CONVERSATIONAL/);
  assert.match(block, /ROLLING/);
  assert.match(block, /less plain text/);
  assert.equal(/DETECTIVE/.test(block), false);
  assert.match(contentCreativeDirection().join("\n"), /STACKED/);
});
