import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICIAL_SEARCH_DOMAINS,
  CULTURAL_SEARCH_DOMAINS,
  LENS_ACCOUNTS,
  OPINION_NEWS_DOMAINS,
  UNIVERSITY_ARGUMENT_DOMAINS,
  PATTERN_ALTITUDE_DOMAINS,
  OVERFLOW_ARGUMENT_DOMAINS,
  OVERFLOW_INDEPENDENT_DOMAINS,
  PRESS_SEARCH_DOMAINS,
  classifySource,
  classifySources,
  countSourceClasses,
  argumentDeskEmpty,
  preferDeskSources,
  clusterSearchQueries,
  lensDiscoveryQueries,
  apparentLookthroughDomains,
  lookthroughSearchQueries,
} from "./cgeSources.js";

test("desk allowlists stay inside Perplexity's 20-domain cap", () => {
  assert.ok(OFFICIAL_SEARCH_DOMAINS.length <= 20);
  assert.ok(CULTURAL_SEARCH_DOMAINS.length <= 20);
  assert.ok(OFFICIAL_SEARCH_DOMAINS.includes(".gov"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("centralgroupevents.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("thejerzclub.substack.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("blackinjersey.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("echonewstv.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("frontrunnernewjersey.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("fivewardsmedia.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("nj.com"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("currentaffairs.org"));
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("instagram.com/thejerzclub"), false);
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("rutgers.edu"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("montclair.edu"));
  assert.ok(CULTURAL_SEARCH_DOMAINS.includes("princeton.edu"));
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("idontdoclubs.com"), false);
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("wbgo.org"), false);
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("njpac.org"), false);
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("essence.com"), false);
  assert.ok(OVERFLOW_ARGUMENT_DOMAINS.includes("morejersey.com"));
  assert.ok(OVERFLOW_ARGUMENT_DOMAINS.includes("trentonjournal.com"));
  assert.ok(OVERFLOW_INDEPENDENT_DOMAINS.includes("jeweljustice.substack.com"));
  assert.ok(PRESS_SEARCH_DOMAINS.includes("njpac.org"));
  assert.ok(PRESS_SEARCH_DOMAINS.includes("essence.com"));
  assert.ok(LENS_ACCOUNTS.length >= 1);
  assert.ok(OPINION_NEWS_DOMAINS.includes("blackinjersey.com"));
  assert.ok(UNIVERSITY_ARGUMENT_DOMAINS.includes("rutgers.edu"));
  assert.ok(PATTERN_ALTITUDE_DOMAINS.includes("currentaffairs.org"));
  assert.ok(LENS_ACCOUNTS.some((a) => a.id === "nj-uncovered"));
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("youtube.com"), false);
  assert.equal(CULTURAL_SEARCH_DOMAINS.includes("facebook.com"), false);
});

test("classifySource labels official, argument, press, and unranked", () => {
  assert.equal(classifySource("https://www.nj.gov/oag/abc/"), "OFFICIAL");
  assert.equal(classifySource("https://www.rutgers.edu/jazz"), "OFFICIAL");
  assert.equal(classifySource("https://thejerzclub.substack.com/p/x"), "CULTURAL");
  assert.equal(classifySource("https://www.instagram.com/thejerzclub/p/abc"), "CULTURAL");
  assert.equal(classifySource("https://www.instagram.com/nj.uncovered/"), "CULTURAL");
  assert.equal(classifySource("https://www.youtube.com/@nj.uncovered/videos"), "CULTURAL");
  assert.equal(classifySource("https://www.facebook.com/njuncovered"), "CULTURAL");
  assert.equal(classifySource("https://www.youtube.com/watch?v=abcdefghijk"), "UNRANKED");
  assert.equal(classifySource("https://www.instagram.com/njuncovered/"), "CULTURAL");
  assert.equal(classifySource("https://www.blackinjersey.com/x"), "CULTURAL");
  assert.equal(classifySource("https://www.echonewstv.com/all-news"), "CULTURAL");
  assert.equal(classifySource("https://frontrunnernewjersey.com/x"), "CULTURAL");
  assert.equal(classifySource("https://www.nj.com/essex/"), "CULTURAL");
  assert.equal(classifySource("https://www.currentaffairs.org/"), "CULTURAL");
  assert.equal(classifySource("https://www.instagram.com/randompage/"), "UNRANKED");
  assert.equal(classifySource("https://www.wbgo.org/show"), "PRESS");
  assert.equal(classifySource("https://www.njpac.org/events"), "PRESS");
  assert.equal(classifySource("https://www.essence.com/"), "PRESS");
  assert.equal(classifySource("https://www.morejersey.com/x"), "CULTURAL");
  assert.equal(classifySource("https://southjerseyjournal.com/x"), "CULTURAL");
  assert.equal(classifySource("https://jeweljustice.substack.com/p/x"), "CULTURAL");
  assert.equal(classifySource("https://www.timeout.com/newyork"), "UNRANKED");
});

test("look-through opens leftover press always and halls only when apparent", () => {
  const leftover = apparentLookthroughDomains({ topic: "A Saturday" });
  assert.ok(leftover.argument.includes("morejersey.com"));
  assert.ok(leftover.argument.includes("southjerseyjournal.com"));
  assert.ok(leftover.argument.includes("jeweljustice.substack.com"));
  assert.ok(leftover.argument.length <= 20);
  assert.ok(leftover.press.length <= 20);

  const jazz = apparentLookthroughDomains({
    topic: "Newark jazz night",
    cluster: "STATE_SONIC_HISTORY",
    corridor: "Newark",
  });
  assert.ok(jazz.press.includes("wbgo.org"));
  assert.ok(jazz.press.includes("njpac.org"));
  assert.ok(jazz.press.includes("njmonthly.com"));

  const liquor = apparentLookthroughDomains({
    topic: "NJ ABC liquor license cap",
    cluster: "POLICY_MECHANICS",
  });
  assert.ok(liquor.press.includes("njmonthly.com"));
  assert.ok(liquor.press.includes("nytimes.com"));
  assert.equal(liquor.press.includes("essence.com"), false);
  assert.equal(liquor.press.includes("njpac.org"), false);

  const queries = lookthroughSearchQueries({ topic: "A Saturday room", cluster: "NIGHTLIFE_DILEMMA" });
  assert.ok(queries.some((q) => /morejersey\.com|trentonjournal\.com/i.test(q)));
  assert.ok(queries.some((q) => /wbgo\.org|njpac\.org/i.test(q)));
});

test("countSourceClasses, named cluster searches, and argument hunts", () => {
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
  assert.ok(hunts.some((q) => /opinion|op-ed|column/i.test(q)));
  assert.ok(hunts.some((q) => /njpac|essence/i.test(q)));
  assert.ok(hunts.some((q) => /rutgers\.edu|montclair\.edu|princeton\.edu/i.test(q)));
  assert.ok(hunts.some((q) => /currentaffairs\.org/i.test(q)));
  assert.ok(hunts.some((q) => /influenc/i.test(q)));
  assert.ok(hunts.some((q) => /njuncovered|nj\.uncovered|NJ Uncovered/i.test(q)));
  assert.equal(hunts.some((q) => /I Don't Do Clubs|weeklies/i.test(q)), false);
  assert.equal(argumentDeskEmpty(classifySources(["https://www.rutgers.edu/jazz"])), false);
  assert.equal(argumentDeskEmpty(classifySources(["https://www.njpac.org/events"])), true);
});

test("preferDeskSources puts official and argument URLs ahead of venue homepages", () => {
  const ranked = preferDeskSources([
    "https://montclairbrewery.com/",
    "https://www.echonewstv.com/all-news",
    "https://www.nj.gov/oag/abc/",
    "https://visithudson.org/x",
  ]);
  assert.equal(ranked[0].class, "OFFICIAL");
  assert.equal(ranked[1].class, "CULTURAL");
  assert.equal(ranked[2].class, "UNRANKED");
  assert.equal(ranked[3].class, "UNRANKED");
  assert.match(ranked[0].uri, /nj\.gov/);
  assert.match(ranked[1].uri, /echonewstv/);
});
