import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICIAL_SEARCH_DOMAINS,
  CULTURAL_SEARCH_DOMAINS,
  classifySource,
  classifySources,
  countSourceClasses,
  clusterSearchQueries,
} from "./cgeSources.js";

test("desk allowlists stay inside Perplexity's 20-domain cap", () => {
  assert.ok(OFFICIAL_SEARCH_DOMAINS.length <= 20);
  assert.ok(CULTURAL_SEARCH_DOMAINS.length <= 20);
  assert.ok(OFFICIAL_SEARCH_DOMAINS.includes(".gov"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("centralgroupevents.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("wbgo.org"));
});

test("classifySource labels official, cultural, press, and unranked", () => {
  assert.equal(classifySource("https://www.nj.gov/oag/abc/"), "OFFICIAL");
  assert.equal(classifySource("https://www.rutgers.edu/jazz"), "OFFICIAL");
  assert.equal(classifySource("https://www.wbgo.org/show"), "CULTURAL");
  assert.equal(classifySource("https://www.nj.com/essex/"), "PRESS");
  assert.equal(classifySource("https://www.timeout.com/newyork"), "UNRANKED");
});

test("countSourceClasses and named cluster searches", () => {
  const sources = classifySources([
    "https://nj.gov/x",
    "https://wbgo.org/y",
    "https://timeout.com/z",
  ]);
  assert.deepEqual(countSourceClasses(sources), {
    OFFICIAL: 1, CULTURAL: 1, PRESS: 0, UNRANKED: 1,
  });
  const policy = clusterSearchQueries("POLICY_MECHANICS");
  assert.ok(policy.some((q) => /ABC|3,000|statute/i.test(q)));
  const diaspora = clusterSearchQueries("Diaspora Infrastructure");
  assert.ok(diaspora.some((q) => /Caribbean|African/i.test(q)));
});
