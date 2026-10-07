import test from "node:test";
import assert from "node:assert/strict";
import { isListicleHook, hookEvidenceLines, buildHookPrompt, buildLensReframePrompt, buildThesisPrompt } from "./matrixCompass.js";
import { buildSubjectLock, subjectLockPromptLines, lockLensDirective } from "./subjectLock.js";

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
    anchors: [
      "START — Cranford retrofitted the downtown",
      "START — Route 22 still gathers in a parking lot",
    ],
  });
  assert.match(prompt, /Cranford retrofitted/);
  assert.match(prompt, /Route 22/);
  assert.match(prompt, /authorized proper nouns/);
  assert.match(prompt, /Discover surprising/);
  assert.match(prompt, /not an Instagram listicle/);
  assert.equal(/No invented proper nouns: do NOT name specific venues, towns/.test(prompt), false);
});

test("hook and thesis ignore unclicked cluster, corridor, emotion, demographic", () => {
  const hook = buildHookPrompt({
    pov: "Parkway towns eat the summer influx.",
    emotion: "Curiosity/Epiphany",
    demographics: ["Young Working Professionals"],
    editorialLens: "summer shore traffic in Parkway towns",
  });
  assert.equal(/Curiosity\/Epiphany/.test(hook), false);
  assert.equal(/Young Working Professionals/.test(hook), false);
  assert.equal(/Voice\/Emotion/.test(hook), false);
  assert.equal(/The Audience/.test(hook), false);
  assert.match(hook, /summer shore traffic in Parkway towns/);
  assert.match(hook, /dropdowns are not inputs/);

  const thesis = buildThesisPrompt({
    lens: "summer shore traffic in Parkway towns",
  });
  assert.equal(/Curiosity\/Epiphany/.test(thesis), false);
  assert.equal(/Young Working Professionals/.test(thesis), false);
  assert.equal(/Economics & Logistics/.test(thesis), false);
  assert.match(thesis, /summer shore traffic in Parkway towns/);
  assert.match(thesis, /already stitched into this LENS via Reframe/);
});

test("reframe stitches a typed topic to the selected pills", () => {
  const lock = buildSubjectLock({
    cluster: "PHILOSOPHY_OF_GATHERING",
    corridor: "Transit Village Suburbs",
    subjectFacets: ["social-friction"],
    corridorLocales: ["cranford"],
  });
  const prompt = buildLensReframePrompt({
    clusterLabel: "Philosophy & Behavioral Psychology of Gathering",
    baseDirective: lockLensDirective(lock),
    corridor: "Transit Village Suburbs",
    emotion: "Curiosity/Epiphany",
    demographics: ["Young Working Professionals"],
    subjectLock: { promptLines: subjectLockPromptLines(lock), summary: lock.summary },
    operatorTopic: "the last inbound from Cranford",
  });
  assert.match(prompt, /OPERATOR TOPIC/);
  assert.match(prompt, /the last inbound from Cranford/);
  assert.match(prompt, /OPERATOR PILLS/);
  assert.match(prompt, /Social friction/);
  assert.match(prompt, /Cranford/);
  assert.match(prompt, /Young Working Professionals/);
  assert.match(prompt, /do not throw it out/);
  assert.match(prompt, /Names the operator typed are authorized/);
});

test("reframe with an empty box still stitches the pills alone", () => {
  const prompt = buildLensReframePrompt({
    clusterLabel: "State & Sonic History",
    baseDirective: "Anchor the narrative in regional musical legacy.",
    corridor: "Urban / Commuter Core",
  });
  assert.match(prompt, /OPERATOR TOPIC: \(none/);
  assert.match(prompt, /stitch the pills into a narrowing angle on their own/);
});

test("reframe works without a cluster — typed topic is the piece", () => {
  const prompt = buildLensReframePrompt({
    clusterLabel: "",
    baseDirective: "",
    corridor: "Shore / Southern Arteries",
    operatorTopic: "summer shore traffic in Parkway towns",
  });
  assert.match(prompt, /cluster is optional/i);
  assert.match(prompt, /summer shore traffic in Parkway towns/);
  assert.match(prompt, /do not recite a cluster catalog/i);
  assert.equal(/Economics & Logistics/i.test(prompt), false);
  assert.equal(/Emotion:/.test(prompt), false);
  assert.equal(/Demographic:/.test(prompt), false);
  assert.match(prompt, /Corridor: Shore \/ Southern Arteries/);
});

test("reframe omits unclicked corridor and emotion", () => {
  const prompt = buildLensReframePrompt({
    clusterLabel: "",
    baseDirective: "",
    operatorTopic: "the last inbound",
  });
  assert.equal(/Corridor:/.test(prompt), false);
  assert.equal(/Emotion:/.test(prompt), false);
  assert.equal(/whole state/.test(prompt), false);
  assert.match(prompt, /typed topic is the piece/);
});
