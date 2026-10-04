import test from "node:test";
import assert from "node:assert/strict";
import { researchRequest, researchHypothesisRequest, parseResearchResponse } from "./perplexityResearch.js";

test("research uses Agent preset, web search, and structured output", () => {
  const request = researchRequest({ topic: "Newark", existingBullets: [null, "Existing fact"] });
  assert.equal(request.preset, "low");
  assert.deepEqual(request.tools, [{ type: "web_search" }]);
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

test("Feature-tier hypothesis research requires a DOCUMENT and a JOIN", () => {
  const request = researchHypothesisRequest({ cluster: "DIASPORA_INFRASTRUCTURE", topic: "A Newark hall", tier: "FEATURE" });
  assert.match(request.instructions, /FEATURE \/ CONTENT METHOD/);
  assert.match(request.instructions, /DOCUMENT candidate/);
  assert.match(request.instructions, /JOIN candidate/);
  const orbit = researchHypothesisRequest({ cluster: "NIGHTLIFE_DILEMMA", topic: "A Saturday", tier: "ORBIT" });
  assert.equal(/FEATURE \/ CONTENT METHOD/.test(orbit.instructions), false);
});

test("merged research rules preserve NJ relevance and short-hook framing", () => {
  const request = researchRequest({ cluster: "Culture", topic: "Let Me Know" });
  assert.match(request.instructions, /at least 3 verifiable NJ-tied/);
  assert.match(request.instructions, /primary frame/);
  assert.equal(parseResearchResponse({ output_text: '{"bullets":["Only one fact"]}' }).code, "empty");
});