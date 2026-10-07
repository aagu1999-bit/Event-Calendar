import test from "node:test";
import assert from "node:assert/strict";
import { researchRequest, researchHypothesisRequest, researchAiModeRequest, researchGapScoutRequest, researchOfficialRequest, researchCulturalRequest, researchLookthroughRequest, researchVerificationRequest, researchDiveRequest, parseResearchResponse, hasFuelResearchSeed } from "./perplexityResearch.js";

test("research uses Agent preset, open NJ web search, and structured output", () => {
  const request = researchRequest({ topic: "Newark", existingBullets: [null, "Existing fact"] });
  assert.equal(request.preset, "low");
  assert.equal(request.tools[0].type, "web_search");
  assert.equal(request.tools[0].filters, undefined);
  assert.equal(request.tools[0].user_location.region, "NJ");
  assert.equal(request.response_format.type, "json_schema");
  assert.match(request.input, /Existing fact/);
  assert.equal(request.model, undefined);
});

test("reads output_text and collects safe source and annotation URLs", () => {
  const result = parseResearchResponse({
    output_text: '{"thesis":"NJ strip towns were built to sleep.","bullets":["A supported fact","Another supported fact"]}',
    model: "test-model",
    output: [
      { type: "search_results", results: [{ url: "https://example.org/source" }, { url: "javascript:alert(1)" }] },
      { type: "message", content: [{ annotations: [{ url: "https://example.org/source" }, { url: "https://example.org/other" }] }] },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.thesis, "NJ strip towns were built to sleep.");
  assert.deepEqual(result.citations, ["https://example.org/source", "https://example.org/other"]);
});

test("rejects malformed, empty, oversized, and unsourced answers", () => {
  for (const output_text of ["not JSON", "null", '{"bullets":[5]}', JSON.stringify({ bullets: ["x".repeat(701)] })]) {
    assert.equal(parseResearchResponse({ output_text }).code, "bad_response");
  }
  assert.equal(parseResearchResponse({ output_text: '{"bullets":[]}' }).code, "empty");
  assert.equal(parseResearchResponse({ output_text: '{"bullets":["No sources","Another unsourced fact"]}' }).code, "empty");
});

test("AI Mode scout is unconstrained NJ search with a thesis and starting points", () => {
  const scout = researchAiModeRequest({
    cluster: "SUBURBAN_THIRD_PLACE",
    topic: "suburban commercial strip retrofit",
    corridor: "Transit Village Suburbs",
  });
  assert.match(scout.instructions, /Google AI Mode|open web|OPEN web/i);
  assert.match(scout.instructions, /STARTING POINTS/);
  assert.match(scout.instructions, /thesis/i);
  assert.match(scout.instructions, /HOUSE FIGHT IS OPTIONAL/);
  assert.match(scout.instructions, /MECHANISM IS OPTIONAL/);
  assert.match(scout.instructions, /Land this desk in New Jersey/);
  assert.equal(/Land Black New Jersey in the thesis or in at least one starting point: who this is for, which Saturday still feels like the strip, who owns vs who programs/.test(scout.instructions), false);
  assert.equal(scout.tools.length, 1);
  assert.equal(scout.tools[0].filters, undefined);
  assert.match(scout.input, /Transit Village|Cranford|retrofit/i);
  assert.equal(researchHypothesisRequest({ topic: "A Saturday" }).tools[0].filters, undefined);

  const calibrated = researchAiModeRequest({
    cluster: "SUBURBAN_THIRD_PLACE",
    topic: "strip mall speakeasy",
    coherenceGaps: [
      "Need anchors for currently operating, car-centric gathering spots.",
      "No anchor directly addresses the strip mall speakeasy concept.",
    ],
    coherenceReason: "The anchors are too historical.",
  });
  assert.match(calibrated.instructions, /CLOSE THESE GAPS/);
  assert.match(calibrated.input, /CLOSE THESE GAPS/);
  assert.match(calibrated.input, /currently operating/);
  assert.match(calibrated.input, /strip mall speakeasy/);
  assert.match(researchOfficialRequest({
    topic: "strip mall speakeasy",
    coherenceGaps: ["Need currently-operating car-centric spots."],
  }).input, /CLOSE THESE GAPS/);

  const gapScout = researchGapScoutRequest({
    cluster: "SUBURBAN_THIRD_PLACE",
    topic: "strip mall speakeasy",
    coherenceGaps: [
      "Need anchors for currently operating, car-centric gathering spots.",
      "No anchor directly addresses the strip mall speakeasy concept.",
    ],
    coherenceReason: "The anchors are too historical.",
  });
  assert.match(gapScout.instructions, /not another full brief/i);
  assert.match(gapScout.instructions, /GAP — /);
  assert.equal(gapScout.tools[0].filters, undefined);
  assert.match(gapScout.input, /CLOSE THESE GAPS/);
  assert.equal(/STARTING POINTS: 5–8/.test(gapScout.instructions), false);
});

test("Feature-tier official desk does not require a named program as the mechanism", () => {
  const official = researchOfficialRequest({ cluster: "DIASPORA_INFRASTRUCTURE", topic: "A Newark hall", tier: "FEATURE" });
  assert.match(official.instructions, /DOCUMENT/);
  assert.match(official.instructions, /MECHANISM IS OPTIONAL/);
  assert.match(official.instructions, /Do not hunt a program/);
  assert.ok(official.tools[0].filters.search_domain_filter.includes(".gov"));
  const cultural = researchCulturalRequest({ cluster: "DIASPORA_INFRASTRUCTURE", topic: "A Newark hall", tier: "FEATURE" });
  assert.match(cultural.instructions, /JOIN — |NEXT — |ARGUMENT/);
  assert.match(cultural.instructions, /do not invent a MECHANISM line/);
  assert.match(cultural.instructions, /Current Affairs only if/);
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("echonewstv.com"));
  assert.equal(cultural.tools[0].filters.search_domain_filter.includes("njpac.org"), false);
});

test("dive thickens starting points and does not drop the brief", () => {
  const request = researchDiveRequest({
    cluster: "STATE_SONIC_HISTORY",
    thesis: "Jersey club left a closed room and a living remnant.",
    candidates: ["START — Club Zanzibar closed 1992"],
  });
  assert.match(request.instructions, /THICKEN/);
  assert.match(request.instructions, /Do NOT drop a fact because the door is not open today/);
  assert.match(request.instructions, /PREFER THE DESKS FIRST/);
  assert.match(request.input, /SCOUT THESIS/);
  assert.match(request.input, /Club Zanzibar/);
  assert.equal(request.tools.length, 4);
  assert.ok(request.tools[0].filters.search_domain_filter.includes(".gov"));
  assert.ok(request.tools[1].filters.search_domain_filter.includes("echonewstv.com"));
  assert.ok(request.tools[2].filters.search_domain_filter.includes("morejersey.com"));
  assert.equal(request.tools[3].filters, undefined);
});

test("look-through searches leftover press and apparent halls, not Desk B", () => {
  const leftover = researchLookthroughRequest({ cluster: "POLICY_MECHANICS", topic: "NJ ABC liquor license cap" });
  assert.match(leftover.instructions, /LOOK-THROUGH/);
  assert.ok(leftover.tools[0].filters.search_domain_filter.includes("morejersey.com"));
  const leftoverPress = leftover.tools[1]?.filters.search_domain_filter || [];
  assert.ok(leftoverPress.includes("njmonthly.com"));
  assert.equal(leftoverPress.includes("essence.com"), false);
});

test("merged research rules preserve NJ relevance", () => {
  const request = researchRequest({ cluster: "Culture", topic: "Let Me Know" });
  assert.match(request.instructions, /at least 1 verifiable NJ-tied/);
  assert.match(request.instructions, /PRIMARY RESEARCH LENS/);
  assert.equal(parseResearchResponse({ output_text: '{"bullets":["Only one fact"]}' }).code, "empty");
});

test("Fuel seed does not require a cluster", () => {
  assert.equal(hasFuelResearchSeed({}), false);
  assert.equal(hasFuelResearchSeed({ cluster: "" }), false);
  assert.equal(hasFuelResearchSeed({ cluster: "GATHERING_LOGISTICS" }), true);
  assert.equal(hasFuelResearchSeed({ topic: "summer shore traffic in Parkway towns" }), true);
  assert.equal(hasFuelResearchSeed({ lensOverride: "the last inbound" }), true);
  assert.equal(hasFuelResearchSeed({ pov: "The influx is a logistics tax." }), true);
  assert.equal(hasFuelResearchSeed({ subjectFacets: ["social-friction"] }), true);
});
