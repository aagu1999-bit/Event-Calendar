import test from "node:test";
import assert from "node:assert/strict";
import { composePOV, buildHookPrompt, COMPASS_TOPICS } from "./matrixCompass.js";
import { MATRIX_FIELDS, LIMITS } from "./matrixEnums.js";
import { eventMatrixToFillSeed } from "./eventMatrixToFillSeed.js";
import { researchAiModeRequest } from "../../perplexityResearch.js";
import {
  buildSubjectLock,
  sanitizeSubjectLock,
  facetsForCluster,
  localesForCorridor,
  joinFacetOptions,
  subjectLockPromptLines,
  lockLensDirective,
  CLUSTER_FACETS,
} from "./subjectLock.js";

test("empty lock keeps whole-cluster behavior", () => {
  const lock = buildSubjectLock({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Route 1 Central Crossroads",
  });
  assert.equal(lock.empty, true);
  assert.equal(lock.summary, "");
  assert.deepEqual(lock.searches, []);
  assert.deepEqual(subjectLockPromptLines(lock), []);
  const pov = composePOV({ cluster: "SUBURBAN_THIRD_PLACE", corridor: "Route 1 Central Crossroads" });
  assert.equal(pov.includes("This piece stays on"), false);
});

test("parking-lot brewery on Route 22 does not mash liquor cap or Afrobeats", () => {
  const lock = buildSubjectLock({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Route 1 Central Crossroads",
    subjectFacets: ["parking-lot-brewery"],
    corridorLocales: ["route-22"],
  });
  assert.equal(lock.empty, false);
  assert.match(lock.summary, /Parking-lot brewery/);
  assert.match(lock.summary, /Route 22/);
  assert.equal(/liquor cap/i.test(lock.summary), false);
  assert.equal(/Afrobeats/i.test(lock.summary), false);
  const lines = subjectLockPromptLines(lock).join("\n");
  assert.match(lines, /SUBJECT LOCK/);
  assert.match(lines, /Parking-lot brewery/);
  assert.match(lines, /Route 22/);
  assert.match(lines, /JOIN: none/);
  assert.match(lines, /Do not invent an intersection/);
  assert.equal(lock.searches.some((q) => /parking lot brewery/i.test(q)), true);
  assert.equal(lock.searches.some((q) => /Route 22/i.test(q)), true);

  const pov = composePOV({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Route 1 Central Crossroads",
    lockSentence: lock.composeClause,
    thesisOverride: lockLensDirective(lock),
  });
  assert.match(pov, /parking-lot brewery/i);
  assert.match(pov, /Route 22/);
  assert.match(pov, /place context only/);
  assert.match(pov, /Do not mash overlapping topics/);
  assert.equal(/outsourced gathering to commercial strips/i.test(pov), false);
});

test("one philosophy facet replaces the cluster syllabus in the live LENS", () => {
  const lock = buildSubjectLock({
    cluster: "PHILOSOPHY_OF_GATHERING",
    subjectFacets: ["social-friction"],
  });
  const lens = lockLensDirective(lock);
  assert.match(lens, /Social friction/i);
  assert.equal(/cost of being outside/i.test(lens), false);
  assert.match(lens, /third-place void/i);
  assert.match(lens, /propinquity/i);
  assert.equal(/Oldenburg/i.test(lens), false);
  assert.equal(/collective effervescence/i.test(lens), false);
  const empty = lockLensDirective(buildSubjectLock({ cluster: "PHILOSOPHY_OF_GATHERING" }));
  assert.equal(empty, "");
});

test("locales are geography context, not a story spend", () => {
  const lock = buildSubjectLock({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Transit Village Suburbs",
    corridorLocales: ["cranford"],
  });
  assert.equal(lockLensDirective(lock), "");
  assert.match(lock.composeClause, /set in Cranford/);
  assert.match(lock.composeClause, /place context only/);
  assert.match(lock.composeClause, /not a story spend/);
  const lines = subjectLockPromptLines(lock).join("\n");
  assert.match(lines, /Geography context \(not a story spend\)/);
  assert.match(lines, /Cranford/);
  assert.equal(/Locked corridor locales/i.test(lines), false);
  const cranford = localesForCorridor("Transit Village Suburbs").find((l) => l.id === "cranford");
  assert.equal(cranford.hint, "Cranford · Union");
  assert.equal(/named retrofit/i.test(cranford.hint), false);
  const route22 = localesForCorridor("Route 1 Central Crossroads").find((l) => l.id === "route-22");
  assert.equal(route22.hint, "Route 22");
  assert.equal(/parking-lot geography/i.test(route22.hint), false);
});

test("join is the only permitted intersection", () => {
  const lock = buildSubjectLock({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Route 1 Central Crossroads",
    subjectFacets: ["parking-lot-brewery"],
    joinFacet: "liquor-cap",
  });
  assert.equal(lock.join?.id, "liquor-cap");
  assert.match(lock.composeClause, /Joined only to Liquor cap/);
  const lines = subjectLockPromptLines(lock).join("\n");
  assert.match(lines, /JOIN \(the only permitted intersection/);
  assert.match(lines, /Liquor cap/);
});

test("sanitize drops facets when the cluster changes", () => {
  const next = sanitizeSubjectLock({
    cluster: "NIGHTLIFE_DILEMMA",
    corridor: "Urban / Commuter Core",
    subjectFacets: ["parking-lot-brewery", "hi-fi-listening"],
    corridorLocales: ["route-22", "newark"],
    joinFacet: "hi-fi-listening",
  });
  assert.deepEqual(next.subject_facets, ["hi-fi-listening"]);
  assert.deepEqual(next.corridor_locales, ["newark"]);
  assert.equal(next.join_facet, "");
});

test("join from the same cluster is dropped", () => {
  const next = sanitizeSubjectLock({
    cluster: "SUBURBAN_THIRD_PLACE",
    subjectFacets: ["parking-lot-brewery"],
    joinFacet: "strip-mall-speakeasy",
  });
  assert.equal(next.join_facet, "");
});

test("caps stay at three facets and three locales", () => {
  const suburban = facetsForCluster("SUBURBAN_THIRD_PLACE").map((f) => f.id);
  const locales = localesForCorridor("Transit Village Suburbs").map((l) => l.id);
  const next = sanitizeSubjectLock({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Transit Village Suburbs",
    subjectFacets: suburban,
    corridorLocales: locales,
  });
  assert.equal(next.subject_facets.length, LIMITS.FACETS_MAX);
  assert.equal(next.corridor_locales.length, LIMITS.LOCALES_MAX);
});

test("every cluster has facets and join options come from other clusters", () => {
  for (const key of Object.keys(CLUSTER_FACETS)) {
    assert.ok(facetsForCluster(key).length >= 3, `${key} needs facets`);
  }
  const joins = joinFacetOptions("SUBURBAN_THIRD_PLACE");
  assert.equal(joins.some((j) => j.id === "parking-lot-brewery"), false);
  assert.equal(joins.some((j) => j.id === "liquor-cap"), true);
  assert.equal(joins.some((j) => /Policy · Liquor cap/.test(j.joinLabel)), true);
});

test("Compass seeds carry the matching facet lock", () => {
  const brewery = COMPASS_TOPICS.find((t) => t.id === "TOPIC-02");
  assert.deepEqual(brewery.facets, ["parking-lot-brewery"]);
  const voidTopic = COMPASS_TOPICS.find((t) => t.id === "TOPIC-01");
  assert.deepEqual(voidTopic.facets, ["walkable-vs-strip"]);
  assert.deepEqual(voidTopic.locales, ["route-1"]);
  const zanzibar = COMPASS_TOPICS.find((t) => t.id === "TOPIC-91");
  assert.deepEqual(zanzibar.facets, ["club-zanzibar"]);
  assert.deepEqual(zanzibar.locales, ["newark"]);
});

test("Fuel Research payload honors the lock and named searches", () => {
  const scout = researchAiModeRequest({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Route 1 Central Crossroads",
    topic: "parking lot brewery",
    subjectFacets: ["parking-lot-brewery"],
    corridorLocales: ["route-22"],
  });
  assert.match(scout.instructions, /SUBJECT LOCK/);
  assert.match(scout.input, /SUBJECT LOCK/);
  assert.match(scout.input, /Parking-lot brewery/);
  assert.match(scout.input, /Route 22/);
  assert.match(scout.input, /Geography context \(not a story spend\)/);
  assert.match(scout.input, /JOIN: none/);
  assert.match(scout.input, /New Jersey parking lot brewery/);
  assert.match(scout.input, /facet lock/);
  assert.equal(/strip mall speakeasy hidden bar/i.test(scout.input), false);
  const unlocked = researchAiModeRequest({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Transit Village Suburbs",
    topic: "suburban commercial strip retrofit",
  });
  assert.equal(/SUBJECT LOCK —/.test(unlocked.input), false);
  assert.match(unlocked.input, /cluster identity/);
});

test("Fuel on a philosophy facet does not ingest Oldenburg or sibling searches", () => {
  const scout = researchAiModeRequest({
    cluster: "PHILOSOPHY_OF_GATHERING",
    topic: "social friction",
    subjectFacets: ["social-friction"],
  });
  assert.match(scout.input, /Social friction/);
  assert.match(scout.input, /facet lock/);
  assert.equal(/Oldenburg/i.test(scout.input), false);
  assert.equal(/collective effervescence/i.test(scout.input), false);
  assert.equal(/third place public library/i.test(scout.input), false);
});

test("hook prompt and fill seed carry the lock", () => {
  const lock = buildSubjectLock({
    cluster: "SUBURBAN_THIRD_PLACE",
    corridor: "Route 1 Central Crossroads",
    subjectFacets: ["parking-lot-brewery"],
    corridorLocales: ["route-22"],
  });
  const prompt = buildHookPrompt({
    pov: "Suburban New Jersey outsourced gathering to the parking lot.",
    emotion: "Curiosity/Epiphany",
    subjectLock: { promptLines: subjectLockPromptLines(lock) },
    lensBase: lockLensDirective(lock),
  });
  assert.match(prompt, /SUBJECT LOCK/);
  assert.match(prompt, /Parking-lot brewery/);
  assert.match(prompt, /facet lock replaces the cluster syllabus/);
  assert.equal(/deficit of walkable social infrastructure/i.test(prompt), false);

  const seed = eventMatrixToFillSeed({
    name: "The brewery piece",
    matrix: {
      event_tier: "FEATURE",
      cluster: "SUBURBAN_THIRD_PLACE",
      corridor: "Route 1 Central Crossroads",
      subject_facets: ["parking-lot-brewery"],
      corridor_locales: ["route-22"],
      editorial_pov: "The parking-lot brewery is the town square.",
      hook_a_side: "Route 22 still gathers in a parking lot.",
    },
  });
  assert.match(seed.context, /SUBJECT LOCK/);
  assert.match(seed.context, /Parking-lot brewery/);
  assert.match(seed.context, /Route 22/);
  assert.match(seed.clusterDirective, /Parking-lot brewery/);
  assert.equal(/deficit of walkable social infrastructure/i.test(seed.clusterDirective), false);
});

test("fill seed on social friction does not carry the Oldenburg default POV", () => {
  const seed = eventMatrixToFillSeed({
    name: "Friction piece",
    matrix: {
      event_tier: "FEATURE",
      cluster: "PHILOSOPHY_OF_GATHERING",
      subject_facets: ["social-friction"],
      hook_a_side: "The cost of being outside is the gathering problem.",
    },
  });
  assert.match(seed.clusterDirective, /Social friction/);
  assert.equal(/Oldenburg/i.test(seed.clusterDirective), false);
  assert.equal(/Oldenburg/i.test(seed.context || ""), false);
});

test("matrix stores the lock fields", () => {
  assert.equal(MATRIX_FIELDS.includes("subject_facets"), true);
  assert.equal(MATRIX_FIELDS.includes("corridor_locales"), true);
  assert.equal(MATRIX_FIELDS.includes("join_facet"), true);
  assert.equal(LIMITS.FACETS_MAX, 3);
  assert.equal(LIMITS.LOCALES_MAX, 3);
});
