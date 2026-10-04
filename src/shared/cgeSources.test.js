import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICIAL_SEARCH_DOMAINS,
  CULTURAL_SEARCH_DOMAINS,
  LENS_ACCOUNTS,
  classifySource,
  classifySources,
  countSourceClasses,
  clusterSearchQueries,
  lensDiscoveryQueries,
} from "./cgeSources.js";

test("desk allowlists stay inside Perplexity's 20-domain cap", () => {
  assert.ok(OFFICIAL_SEARCH_DOMAINS.length <= 20);
  assert.ok(CULTURAL_SEARCH_DOMAINS.length <= 20);
  assert.ok(OFFICIAL_SEARCH_DOMAINS.includes(".gov"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("centralgroupevents.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("thejerzclub.substack.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("instagram.com/thejerzclub"));
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("wbgo.org"), false);
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("njpac.org"), false);
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("essence.com"), false);
  assert.ok(LENS_ACCOUNTS.length >= 1);
});

test("classifySource labels official, lens, press, and unranked", () => {
  assert.equal(classifySource("https://www.nj.gov/oag/abc/"), "OFFICIAL");
  assert.equal(classifySource("https://www.rutgers.edu/jazz"), "OFFICIAL");
  assert.equal(classifySource("https://thejerzclub.substack.com/p/x"), "CULTURAL");
  assert.equal(classifySource("https://www.instagram.com/thejerzclub/p/abc"), "CULTURAL");
  assert.equal(classifySource("https://www.instagram.com/randompage/"), "UNRANKED");
  assert.equal(classifySource("https://www.wbgo.org/show"), "PRESS");
  assert.equal(classifySource("https://www.njpac.org/events"), "PRESS");
  assert.equal(classifySource("https://www.essence.com/"), "PRESS");
  assert.equal(classifySource("https://www.nj.com/essex/"), "PRESS");
  assert.equal(classifySource("https://www.timeout.com/newyork"), "UNRANKED");
});

test("countSourceClasses, named cluster searches, and lens hunts", () => {
  const sources = classifySources([
    "https://nj.gov/x",
    "https://instagram.com/thejerzclub",
    "https://timeout.com/z",
  ]);
  assert.deepEqual(countSourceClasses(sources), {
    OFFICIAL: 1, CULTURAL: 1, PRESS: 0, UNRANKED: 1,
  });
  const policy = clusterSearchQueries("POLICY_MECHANICS");
  assert.ok(policy.some((q) => /ABC|3,000|statute/i.test(q)));
  const diaspora = clusterSearchQueries("Diaspora Infrastructure");
  assert.ok(diaspora.some((q) => /Caribbean|African/i.test(q)));
  const hunts = lensDiscoveryQueries({ cluster: "NIGHTLIFE_DILEMMA", topic: "A Saturday room" });
  assert.ok(hunts.some((q) => /Instagram|Substack/i.test(q)));
  assert.ok(hunts.some((q) => /njpac|essence/i.test(q)));
});
