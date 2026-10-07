import test from "node:test";
import assert from "node:assert/strict";
import { isListicleHook, hookEvidenceLines, buildHookPrompt, buildLensReframePrompt, buildThesisPrompt, buildCoherencePrompt, normalizeCoherenceResult, formatCoherenceSeedLines, defaultCoherenceUseFor, coherenceInputSignature } from "./matrixCompass.js";
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

test("coherence prompt reads the LENS strictly and asks for a claim map", () => {
  const prompt = buildCoherencePrompt({
    hook: "Parkway towns eat the summer influx.",
    pov: "The influx is a logistics tax, not a vibe.",
    anchors: [
      "START — Parkway towns lose the shoulder season to weekend traffic.",
      "START — A Brooklyn weekender calendar named Asbury without the tax.",
    ],
    clusterDirective: "summer shore traffic in Parkway towns",
  });
  assert.match(prompt, /LENS IS STRICT/);
  assert.match(prompt, /NOT the cluster catalog/);
  assert.match(prompt, /summer shore traffic in Parkway towns/);
  assert.match(prompt, /CLAIMS MAP/);
  assert.match(prompt, /USE THIS DESK FOR/);
  assert.match(prompt, /Cover \+ News/);
  assert.match(prompt, /NOT a 10-slide/);
  assert.equal(/Economics & Logistics/.test(prompt), false);
  assert.equal(/venue rental/i.test(prompt), false);
});

test("coherence prompt vetoes a conversation map the desk cannot carry", () => {
  const prompt = buildCoherencePrompt({
    hook: "Discover surprising gathering spots",
    pov: "A Saturday of mixers.",
    anchors: ["START — doors at 10", "START — DJ set"],
    conversationPrimary: "Injustice / Hook-Led",
  });
  assert.match(prompt, /CONVERSATION MAP PRIMARY/);
  assert.match(prompt, /Injustice \/ Hook-Led/);
  assert.match(prompt, /festival listings/);
  assert.match(prompt, /as a cluster syllabus/);
});

test("coherence prompt without a LENS does not invent a cluster syllabus", () => {
  const prompt = buildCoherencePrompt({
    hook: "The last inbound.",
    pov: "The train is the gathering.",
    anchors: ["START — one", "START — two"],
  });
  assert.match(prompt, /do not invent a cluster syllabus/);
});

test("normalizeCoherenceResult maps claims, clamps slides, and fills useFor", () => {
  const normalized = normalizeCoherenceResult({
    verdict: "thin",
    reason: "Only one receipt actually proves the influx tax.",
    gaps: ["Need a currently-operating Parkway Saturday, not a Brooklyn calendar."],
    claims: [
      { claim: "Parkway towns eat the summer influx.", from: "hook", support: "anchored", anchor: 1 },
      { claim: "The influx is a logistics tax.", from: "pov", support: "unverified", anchor: 9 },
      { claim: "", from: "hook", support: "anchored", anchor: 1 },
    ],
    slideCount: 99,
  }, { anchors: ["a", "b"] });
  assert.equal(normalized.verdict, "thin");
  assert.equal(normalized.claims.length, 2);
  assert.equal(normalized.claims[0].support, "anchored");
  assert.equal(normalized.claims[0].anchor, 1);
  assert.equal(normalized.claims[1].support, "unverified");
  assert.equal(normalized.claims[1].anchor, 0);
  assert.equal(normalized.slideCount, 6);
  assert.match(normalized.useFor, /Cap at 6 slides/);
  assert.equal(normalizeCoherenceResult({ verdict: "nope" }), null);
  assert.equal(defaultCoherenceUseFor(3).includes("Cover + News"), true);
});

test("coherence seed lines tell the writer what the desk can carry", () => {
  const lines = formatCoherenceSeedLines({
    verdict: "thin",
    reason: "One receipt.",
    claims: [
      { claim: "Parkway towns eat the summer influx.", from: "hook", support: "anchored", anchor: 1 },
      { claim: "The tax is unpaid.", from: "pov", support: "unverified", anchor: 0 },
    ],
    useFor: "Cover + News. Stay-line on the cover; one receipt in News.",
    slideCount: 3,
  });
  const blob = lines.join("\n");
  assert.match(blob, /COHERENCE: thin/);
  assert.match(blob, /USE THIS DESK FOR: Cover \+ News/);
  assert.match(blob, /POINTED SLIDE COUNT: 3/);
  assert.match(blob, /UNVERIFIED CLAIMS/);
  assert.match(blob, /The tax is unpaid/);
  assert.deepEqual(formatCoherenceSeedLines(null), []);
  const sig = coherenceInputSignature({ hook: "a", pov: "b", anchors: ["c"], lens: "d" });
  assert.equal(sig, "a|b|c|d");
});
