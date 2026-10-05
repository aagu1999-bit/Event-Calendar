import test from "node:test";
import assert from "node:assert/strict";
import { cadenceRotationBlock, contentCreativeDirection } from "./cgeThesis.js";

test("cadence rotation names kitchen table, detective, and GST as styles to rotate", () => {
  const block = cadenceRotationBlock().join("\n");
  assert.match(block, /KITCHEN TABLE/);
  assert.match(block, /DETECTIVE/);
  assert.match(block, /GST/);
  assert.match(block, /Rotate/);
  assert.match(contentCreativeDirection().join("\n"), /KITCHEN TABLE/);
});
