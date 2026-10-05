import test from "node:test";
import assert from "node:assert/strict";
import { isListicleHook, hookEvidenceLines, buildHookPrompt } from "./matrixCompass.js";

test("listicle hooks are the Google-vs-CGE failure", () => {
  assert.equal(isListicleHook("Did your commuter community? Discover surprising new gathering spots"), true);
  assert.equal(isListicleHook("Discover surprising new gathering spots"), true);
  assert.equal(isListicleHook("Hidden gems you need to know"), true);
  assert.equal(isListicleHook("Here's why the strip died"), true);
  assert.equal(isListicleHook(""), false);
  assert.equal(isListicleHook("Walker's Paradise vs the strip-mall geography Route 22 built"), false);
  assert.equal(isListicleHook("Cranford retrofitted the downtown. Route 22 still parks the night."), false);
});

test("hook evidence prefers THESIS / START lines over leftover venue notes", () => {
  const lines = hookEvidenceLines([
    "AFROFEVER doors at 10",
    "START — Cranford retrofitted the downtown",
    "THESIS — NJ was built as a commuter town on Route 22",
    "GAP — currently operating strip-mall speakeasy",
  ]);
  assert.deepEqual(lines, [
    "START — Cranford retrofitted the downtown",
    "THESIS — NJ was built as a commuter town on Route 22",
    "GAP — currently operating strip-mall speakeasy",
  ]);
});

test("hook prompt authorizes Fuel names and bans the listicle cover", () => {
  const prompt = buildHookPrompt({
    pov: "Black commuters returning to car-dependent hometowns feel a walkable deficit.",
    emotion: "Curiosity/Epiphany",
    anchors: [
      "START — Cranford retrofitted the downtown",
      "START — Route 22 still gathers in a parking lot",
    ],
  });
  assert.match(prompt, /Cranford retrofitted/);
  assert.match(prompt, /Route 22/);
  assert.match(prompt, /authorized proper nouns/);
  assert.match(prompt, /Discover surprising/);
  assert.match(prompt, /Curiosity\/Epiphany means name the contrast/);
  assert.match(prompt, /not an Instagram listicle/);
  assert.equal(/No invented proper nouns: do NOT name specific venues, towns/.test(prompt), false);
});
