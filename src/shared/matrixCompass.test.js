import test from "node:test";
import assert from "node:assert/strict";
import { isListicleHook, isBrochureCopy, hookEvidenceLines, buildHookPrompt, buildLensReframePrompt, buildThesisPrompt, buildCoherencePrompt, normalizeCoherenceResult, formatCoherenceSeedLines, defaultCoherenceUseFor, coherenceInputSignature, describeReframeInputs, lensFreshnessSignature, earnedSlideCount, essaySlideSequence, countUsableAnchors, countEarnedBeats, isHomeworkAnchor } from "./matrixCompass.js";
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

test("question-mark and who-is-X-for covers are the Tech Week failure", () => {
  assert.equal(isListicleHook("Newark Tech Week's new professionals and students: Who is Newark's tech future for?"), true);
  assert.equal(isListicleHook("Who is Newark's tech future for?"), true);
  assert.equal(isListicleHook("Is this gathering actually for students?"), true);
  assert.equal(isListicleHook("The new class filled Newark Tech Week. The old gatekeepers still set the room."), false);
  assert.equal(isListicleHook("Who programs Newark Tech Week still decides who counts."), false);
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
  assert.match(prompt, /Who is X for/);
  assert.match(prompt, /question-mark cover/);
  assert.match(prompt, /never the cover's guest list/);
  assert.match(prompt, /Newark Tech Week's new professionals and students/);
  assert.match(prompt, /old gatekeepers still set the room/);
  assert.match(prompt, /spotlights the city's innovations/);
  assert.match(prompt, /Do NOT import African American/);
  assert.match(prompt, /still set the room/);
  assert.equal(/Prefer the POV's fight \(who programs/.test(prompt), false);
  assert.equal(/No invented proper nouns: do NOT name specific venues, towns/.test(prompt), false);
});

test("hook prompt on an orienting POV does not demand a who-programs fight", () => {
  const prompt = buildHookPrompt({
    pov: "Newark Tech Week is in town this week. The rooms are built for business owners.",
    editorialLens: "Newark Tech Week, specifically for business owners.",
  });
  assert.match(prompt, /If the POV only orients/);
  assert.match(prompt, /do not invent a fight/);
  assert.match(prompt, /do not add a house fight/);
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

test("reframe chip names only the pills that were actually selected", () => {
  assert.equal(describeReframeInputs({
    topic: true,
    demographics: ["Young Working Professionals", "student", "business owners"],
  }), "typed topic · demographic");
  assert.equal(/cluster|corridor|emotion/.test(describeReframeInputs({
    topic: true,
    demographics: ["student"],
  })), false);
  assert.match(describeReframeInputs({
    cluster: "GATHERING_LOGISTICS",
    corridor: "Shore / Southern Arteries",
    emotion: "Curiosity/Epiphany",
    lock: { facets: ["venue-splits"] },
  }), /cluster desk · corridor · emotion · facets/);
});

test("LENS freshness ignores chip-only topic so a just-ran Reframe is not stale", () => {
  const live = {
    cluster: "",
    corridor: "",
    emotion: "",
    demographics: ["student"],
    lock: { facets: [], locales: [], join: "" },
  };
  const snapshotAfterReframe = { ...live, topic: true };
  assert.equal(lensFreshnessSignature(live), lensFreshnessSignature(snapshotAfterReframe));
  assert.notEqual(
    lensFreshnessSignature(live),
    lensFreshnessSignature({ ...live, demographics: ["student", "Young Working Professionals"] }),
  );
});

test("reframe with only a topic and demographics does not invent a cluster desk", () => {
  const prompt = buildLensReframePrompt({
    clusterLabel: "",
    baseDirective: "",
    demographics: ["Young Working Professionals", "student", "business owners"],
    operatorTopic: "Newark Tech Week",
  });
  assert.match(prompt, /Newark Tech Week/);
  assert.match(prompt, /Demographic: Young Working Professionals, student, business owners/);
  assert.equal(/Cluster desk:/.test(prompt), false);
  assert.equal(/Corridor:/.test(prompt), false);
  assert.equal(/Emotion:/.test(prompt), false);
  assert.match(prompt, /BANNED in the reframe: vibrant/);
  assert.match(prompt, /burgeoning/);
  assert.match(prompt, /future potential/);
  assert.match(prompt, /Do NOT recap them as/);
  assert.match(prompt, /drawing attention to the city's burgeoning/);
  assert.match(prompt, /GOOD: "Newark Tech Week is a week of sessions in Newark."/);
  const thesis = buildThesisPrompt({ lens: "Newark Tech Week. For young working professionals." });
  assert.match(thesis, /Do NOT import African American/);
  assert.match(thesis, /ORIENT/);
  assert.equal(/always in force, ABOVE the LENS/.test(thesis), false);
  assert.equal(/Black New Jersey as an intersection/.test(thesis), false);
  assert.match(thesis, /do not recap a showcase/);
  assert.match(thesis, /BANNED: vibrant/);
  assert.match(thesis, /burgeoning/);
  assert.match(thesis, /Do not paraphrase a press-release LENS/);
  assert.match(thesis, /bringing attention to the city's developing technology sector/);
});

test("chamber-of-commerce LENS, POV, and hook are brochure copy", () => {
  assert.equal(isBrochureCopy("Newark Tech Week is drawing attention to the city's burgeoning technology sector. This event highlights the innovations and future potential emerging from Newark's tech scene."), true);
  assert.equal(isBrochureCopy("Newark Tech Week is bringing attention to the city's developing technology sector, highlighting the innovations and future potential from within Newark's tech scene."), true);
  assert.equal(isBrochureCopy("Newark Tech Week spotlights the city's innovations while the old gatekeepers still set the room."), true);
  assert.equal(isBrochureCopy("Newark Tech Week is a week of sessions in Newark."), false);
  assert.equal(isBrochureCopy("Newark Tech Week is in town. The rooms are built for business owners."), false);
  assert.equal(isBrochureCopy("Cranford retrofitted the downtown. Route 22 still parks the night."), false);
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
  assert.match(prompt, /NOT GST's locked 10-slide stance arc/);
  assert.match(prompt, /NOT one slide per START line/);
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
  assert.equal(normalized.slideCount, 10);
  assert.match(normalized.useFor, /Cap at 10 slides/);
  assert.equal(normalizeCoherenceResult({ verdict: "nope" }), null);
  assert.equal(defaultCoherenceUseFor(3).includes("Cover + News"), true);
});

test("coherence seed lines tell the writer what the desk can carry", () => {
  const lines = formatCoherenceSeedLines({
    verdict: "thin",
    reason: "One receipt.",
    gaps: ["Need a currently-operating Parkway Saturday, not a Brooklyn calendar."],
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
  assert.match(blob, /UNVERIFIED CLAIMS — OMIT FROM EVERY SLIDE/);
  assert.match(blob, /The tax is unpaid/);
  assert.match(blob, /OPEN GAPS — homework, not copy/);
  assert.match(blob, /currently-operating Parkway Saturday/);
  assert.deepEqual(formatCoherenceSeedLines(null), []);
  const sig = coherenceInputSignature({ hook: "a", pov: "b", anchors: ["c"], lens: "d" });
  assert.equal(sig, "a|b|c|d");
});

test("slide count is earned from this desk, not a silent 3", () => {
  assert.equal(isHomeworkAnchor("RECEIPT — UNVERIFIED: the tax is unpaid"), true);
  assert.equal(isHomeworkAnchor("GAP — a currently-operating Saturday"), true);
  assert.equal(isHomeworkAnchor("START — Parkway towns lose the shoulder season."), false);

  const fourProofs = [
    "POV: The influx is a logistics tax.",
    "ANCHORED FACTS (write from these):",
    "- START — Parkway towns lose the shoulder season.",
    "- START — A currently-operating Saturday still pays the tax.",
    "- MECHANISM — weekend traffic eats the split.",
    "- SPECIMEN — a Parkway operator named the influx.",
    "HOMEWORK — NOT PROOF. Do not write these as facts:",
    "- RECEIPT — UNVERIFIED: the tax is unpaid",
    "- GAP — a currently-operating Saturday operator quote",
    "POINTED SLIDE COUNT: 3. Cover + News is the starting pair.",
  ].join("\n");
  assert.equal(countUsableAnchors(fourProofs), 4);
  assert.equal(countEarnedBeats(fourProofs), 1);
  // Check's pointed count is the analysis — a Fuel pile does not override it.
  assert.equal(earnedSlideCount(fourProofs), 3);
  assert.equal(earnedSlideCount(fourProofs, 4), 4);

  const startPile = [
    "POV: Newark Tech Week is in town for business owners.",
    "- START — the week is in Newark.",
    "- START — sessions for operators.",
    "- START — a named hall.",
    "- START — a named date.",
    "- START — a partner calendar.",
    "- START — another session track.",
    "- START — a seventh starting point.",
    "- START — an eighth starting point.",
  ].join("\n");
  assert.equal(countUsableAnchors(startPile) >= 8, true);
  assert.equal(countEarnedBeats(startPile), 0);
  assert.equal(earnedSlideCount(startPile), 3);

  const withBeats = [
    startPile,
    "- DOCUMENT — a sourced year on this specimen.",
    "- JOIN — a parallel room already on the desk.",
  ].join("\n");
  assert.equal(countEarnedBeats(withBeats), 2);
  assert.equal(earnedSlideCount(withBeats), 5);

  const eightProofs = [
    fourProofs.replace(/POINTED SLIDE COUNT: 3[^\n]*/, ""),
    "- START — a fifth named Saturday.",
    "- START — a sixth named corridor.",
    "- DOCUMENT — a seventh sourced year.",
    "- JOIN — an eighth parallel room already on the desk.",
  ].join("\n");
  assert.equal(countEarnedBeats(eightProofs), 3);
  assert.equal(earnedSlideCount(eightProofs), 6);
  assert.deepEqual(essaySlideSequence(6), ["cover", "news", "text", "text", "text", "cta"]);
  assert.deepEqual(essaySlideSequence(3), ["cover", "news", "cta"]);
  assert.deepEqual(essaySlideSequence(4), ["cover", "news", "text", "cta"]);
  assert.equal(essaySlideSequence(10).length, 10);
  assert.deepEqual(essaySlideSequence(10).slice(0, 2), ["cover", "news"]);
  assert.equal(essaySlideSequence(10).at(-1), "cta");

  const emptyDesk = "POV: locate.\nPOINTED SLIDE COUNT: 5.";
  assert.equal(countUsableAnchors(emptyDesk), 0);
  assert.equal(earnedSlideCount(emptyDesk), 5);
  assert.equal(earnedSlideCount(""), 3);
});
