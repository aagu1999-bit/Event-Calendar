import test from "node:test";
import assert from "node:assert/strict";
import { cadenceRotationBlock, contentCreativeDirection, editorialBuildFormulaLines } from "./cgeThesis.js";

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
  assert.match(contentCreativeDirection().join("\n"), /CONNECT LATERALLY/);
  assert.match(contentCreativeDirection().join("\n"), /nose-dive/);
  assert.match(contentCreativeDirection().join("\n"), /discover surprising/);
  assert.match(contentCreativeDirection().join("\n"), /named road vs a named town/);
});

test("editorial build formula is one idea then one sideways Saturday", () => {
  const block = editorialBuildFormulaLines().join("\n");
  assert.match(block, /FELT SATURDAY/);
  assert.match(block, /TEACH ONE/);
  assert.match(block, /ONE SPECIMEN/);
  assert.match(block, /ONE LATERAL/);
  assert.match(block, /NEXT QUESTION/);
  assert.match(block, /QUESTION/);
  assert.match(block, /BYOB/);
  assert.match(block, /cold reader/);
});
