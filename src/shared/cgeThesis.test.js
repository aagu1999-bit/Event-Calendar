import test from "node:test";
import assert from "node:assert/strict";
import { cadenceRotationBlock, contentCreativeDirection } from "./cgeThesis.js";

test("cadence rotation is the one-sentence-per-line beat, not a source voice", () => {
  const block = cadenceRotationBlock().join("\n");
  assert.match(block, /STACKED/);
  assert.match(block, /one thought, one sentence, one line/);
  assert.match(block, /one-sentence-per-line/);
  assert.match(block, /CONVERSATIONAL/);
  assert.match(block, /[Ii]ntellectual but relevant/);
  assert.match(block, /ROLLING/);
  assert.match(block, /less plain text/);
  assert.equal(/DETECTIVE/.test(block), false);
  assert.match(contentCreativeDirection().join("\n"), /one-sentence-per-line|STACKED/);
});
