import test from "node:test";
import assert from "node:assert/strict";
import {
  METHOD_MARKER,
  parseMethodBrief,
  methodHasJoin,
  methodBriefToBullets,
  formatMethodBriefForContext,
  appendMethodBriefToContext,
  contextHasMethodBrief,
} from "./cgeMethod.js";

test("parseMethodBrief reads labeled lines", () => {
  const parsed = parseMethodBrief([
    "SPECIMEN: The Caribbean hall on that Newark corridor",
    "PATTERN: Same-city diaspora rooms keep two calendars",
    "MECHANISM: missed overlap",
    "DOCUMENT: Club Zanzibar closed 1992 (NJ.com)",
    "JOIN: The African restaurant two blocks over shares the Saturday and almost no audience",
    "REMNANT: The hall still opens Sundays",
    "UNCONFIRMED: NONE",
  ].join("\n"));
  assert.equal(parsed.specimen.startsWith("The Caribbean hall"), true);
  assert.equal(parsed.mechanism, "missed overlap");
  assert.equal(methodHasJoin(parsed), true);
  assert.deepEqual(methodBriefToBullets(parsed).length, 3);
});

test("JOIN: NONE is not a join", () => {
  assert.equal(methodHasJoin({ join: "NONE" }), false);
  assert.equal(methodHasJoin({ join: "could not find a sideways tie" }), false);
  assert.equal(methodHasJoin({ join: "The 1947 liquor cap explains the 150-cap room" }), true);
});

test("format and append stamp the method marker and extra bullets", () => {
  const block = formatMethodBriefForContext({
    parsed: {
      specimen: "A hall",
      pattern: "Memory loss",
      mechanism: "ownership vs programming",
      document: "Founded 1979",
      join: "The sister church kept the archive",
      remnant: "Ask the deacon",
    },
  });
  assert.equal(contextHasMethodBrief(block), true);
  assert.match(block, /JOIN: The sister church/);
  assert.match(block, /^- Founded 1979/m);
  const next = appendMethodBriefToContext("POV: a thesis\n- existing bullet", { parsed: {
    specimen: "A hall",
    pattern: "Memory loss",
    document: "Founded 1979",
    join: "The sister church kept the archive",
    remnant: "Ask the deacon",
  } });
  assert.equal(contextHasMethodBrief(next), true);
  assert.match(next, /existing bullet/);
  assert.equal(next.includes(METHOD_MARKER), true);
});
