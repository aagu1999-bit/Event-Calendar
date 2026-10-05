import test from "node:test";
import assert from "node:assert/strict";
import { researchRequest, researchHypothesisRequest, researchOfficialRequest, researchCulturalRequest, researchVerificationRequest, parseResearchResponse } from "./perplexityResearch.js";

test("research uses Agent preset, web search, and structured output", () => {
  const request = researchRequest({ topic: "Newark", existingBullets: [null, "Existing fact"] });
  assert.equal(request.preset, "low");
  assert.equal(request.tools[0].type, "web_search");
  assert.ok(Array.isArray(request.tools[0].filters.search_domain_filter));
  assert.equal(request.response_format.type, "json_schema");
  assert.match(request.input, /Existing fact/);
  assert.equal(request.model, undefined);
});

test("reads output_text and collects safe source and annotation URLs", () => {
  const result = parseResearchResponse({
    output_text: '{"bullets":["A supported fact","Another supported fact"]}',
    model: "test-model",
    output: [
      { type: "search_results", results: [{ url: "https://example.org/source" }, { url: "javascript:alert(1)" }] },
      { type: "message", content: [{ annotations: [{ url: "https://example.org/source" }, { url: "https://example.org/other" }] }] },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.citations, ["https://example.org/source", "https://example.org/other"]);
});

test("rejects malformed, empty, oversized, and unsourced answers", () => {
  for (const output_text of ["not JSON", "null", '{"bullets":[5]}', JSON.stringify({ bullets: ["x".repeat(501)] })]) {
    assert.equal(parseResearchResponse({ output_text }).code, "bad_response");
  }
  assert.equal(parseResearchResponse({ output_text: '{"bullets":[]}' }).code, "empty");
  assert.equal(parseResearchResponse({ output_text: '{"bullets":["No sources","Another unsourced fact"]}' }).code, "empty");
});

test("Feature-tier desks split DOCUMENT and JOIN", () => {
  const official = researchOfficialRequest({ cluster: "DIASPORA_INFRASTRUCTURE", topic: "A Newark hall", tier: "FEATURE" });
  assert.match(official.instructions, /DOCUMENT/);
  assert.ok(official.tools[0].filters.search_domain_filter.includes(".gov"));
  assert.equal(/THIRD-PLACE MANDATE/.test(official.instructions), false);
  const cultural = researchCulturalRequest({ cluster: "DIASPORA_INFRASTRUCTURE", topic: "A Newark hall", tier: "FEATURE" });
  assert.match(cultural.instructions, /JOIN — /);
  assert.match(cultural.instructions, /ARGUMENT/);
  assert.match(cultural.input, /opinion|op-ed|column/i);
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("echonewstv.com"));
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("blackinjersey.com"));
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("frontrunnernewjersey.com"));
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("currentaffairs.org"));
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("rutgers.edu"));
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("montclair.edu"));
  assert.ok(cultural.tools[0].filters.search_domain_filter.includes("princeton.edu"));
  assert.equal(cultural.tools[0].filters.search_domain_filter.includes("njpac.org"), false);
  assert.equal(cultural.tools[0].filters.search_domain_filter.includes("idontdoclubs.com"), false);
  const orbit = researchHypothesisRequest({ cluster: "NIGHTLIFE_DILEMMA", topic: "A Saturday", tier: "ORBIT" });
  assert.equal(/FEATURE \/ CONTENT METHOD/.test(orbit.instructions), false);
});

test("verification keeps history that is true as stated", () => {
  const request = researchVerificationRequest({
    cluster: "STATE_SONIC_HISTORY",
    candidates: ["DOCUMENT — Club Zanzibar closed 1992"],
  });
  assert.match(request.instructions, /true AS STATED/);
  assert.match(request.instructions, /Do NOT drop a fact because the door is not open today/);
  assert.match(request.instructions, /PREFER THE DESKS FIRST/);
  assert.equal(request.tools.length, 3);
  assert.ok(request.tools[0].filters.search_domain_filter.includes(".gov"));
  assert.ok(request.tools[1].filters.search_domain_filter.includes("echonewstv.com"));
  assert.equal(request.tools[2].filters, undefined);
  assert.equal(/verifiably true today/.test(request.instructions), false);
});

test("merged research rules preserve NJ relevance and short-hook framing", () => {
  const request = researchRequest({ cluster: "Culture", topic: "Let Me Know" });
  assert.match(request.instructions, /at least 1 verifiable NJ-tied/);
  assert.match(request.instructions, /PRIMARY RESEARCH LENS/);
  assert.equal(parseResearchResponse({ output_text: '{"bullets":["Only one fact"]}' }).code, "empty");
});