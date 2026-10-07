import test from "node:test";
import assert from "node:assert/strict";
import { cadenceRotationBlock, contentCreativeDirection, editorialBuildFormulaLines, isPlatformThemeLeak, platformThesisBlock, contentRegisterBlock } from "./cgeThesis.js";

test("cadence rotation is the one-sentence-per-line beat, not a source voice", () => {
  const block = cadenceRotationBlock().join("\n");
  assert.match(block, /STACKED/);
  assert.match(block, /one thought, one sentence, one line/);
  assert.match(block, /one-sentence-per-line/);
  assert.match(block, /CONVERSATIONAL/);
  assert.match(block, /[Ii]ntellectual but relevant/);
  assert.match(block, /ROLLING/);
  assert.match(block, /less plain text/);
  assert.equal(/DETECTIVE/.test(block), false);
  assert.match(contentCreativeDirection().join("\n"), /one-sentence-per-line|STACKED/);
  assert.match(contentCreativeDirection().join("\n"), /CONNECT/);
  assert.match(contentCreativeDirection().join("\n"), /discover surprising/);
  assert.match(contentCreativeDirection().join("\n"), /is gone/);
  assert.match(contentCreativeDirection().join("\n"), /Strip Malls vs Urban Cafes/);
  assert.match(contentCreativeDirection().join("\n"), /HOUSE FIGHT IS OPTIONAL/);
  assert.match(contentCreativeDirection().join("\n"), /If Fuel only located, the cover locates/);
  assert.equal(/FIRST name the CONTRAST/.test(contentCreativeDirection().join("\n")), false);
  assert.equal(/Hook archetypes that fit:[\s\S]*who owns vs who programs/.test(contentCreativeDirection().join("\n")), false);
});

test("house fight is a leak unless the LENS already named it", () => {
  const lens = "Newark Tech Week is here, specifically for business owners.";
  assert.equal(isPlatformThemeLeak("The Black diaspora's entrepreneurial spirit is navigating new digital frontiers.", lens), true);
  assert.equal(isPlatformThemeLeak("This influx prompts a closer look at whose vision is being prioritized.", lens), true);
  assert.equal(isPlatformThemeLeak("Newark Tech Week gathers business owners for a week of sessions in the city.", lens), false);
  assert.equal(isPlatformThemeLeak("The new class filled Newark Tech Week. The old gatekeepers still set the room.", lens), true);
  assert.equal(isPlatformThemeLeak("Newark Tech Week spotlights the city's innovations while the old gatekeepers still set the room.", lens), true);
  assert.equal(isPlatformThemeLeak("The week is in town. They still set the room.", lens), true);
  assert.equal(isPlatformThemeLeak("The old guard still books the week.", lens), true);
  assert.equal(isPlatformThemeLeak("Access dictates who shows up at Tech Week.", lens), true);
  assert.equal(isPlatformThemeLeak("The unseen hand still scripts the rooms.", lens), true);
  assert.equal(isPlatformThemeLeak("Same-city diaspora rooms keep two calendars.", "same-city diasporas on one ZIP"), false);
  assert.equal(isPlatformThemeLeak("A substantial share of households still lack internet access.", lens), true);
  assert.equal(isPlatformThemeLeak("The sharper question is innovation for whom.", lens), true);
  assert.equal(isPlatformThemeLeak("Who gets to define innovation when broadband lags.", lens), true);
  assert.equal(isPlatformThemeLeak("Newark's digital-inclusion work includes a municipally run Fiber network.", lens), true);
  assert.equal(isPlatformThemeLeak("The digital divide is the test of Tech Week's promise.", "digital divide on this desk"), false);
});

test("writer platform block does not sit the house fight ABOVE the LENS", () => {
  const block = platformThesisBlock({ mode: "content" }).join("\n");
  assert.match(block, /PUBLICATION IDENTITY/);
  assert.match(block, /HOUSE FIGHT IS OPTIONAL/);
  assert.match(block, /MECHANISM, PATTERN, FRICTION, JOIN, and DOCUMENT are OPTIONAL/);
  assert.match(block, /access illusion/);
  assert.match(block, /ORIENT/);
  assert.equal(/this sits ABOVE the cluster lens/.test(block), false);
  assert.equal(/Black New Jersey as an intersection/.test(block), false);
  assert.equal(/who actually benefits/.test(block), true);
  assert.match(block, /Current Affairs\) only if THIS desk already named/);
  const hero = contentRegisterBlock().join("\n");
  assert.match(hero, /locates the specimen/);
  assert.match(hero, /If the desk only locates, Cover \+ News locates/);
  assert.equal(/Hero is a QUESTION about Black New Jersey/.test(hero), false);
  assert.match(hero, /Do not invent 'the thing the audience has felt but never had a word for'/);
});

test("editorial build formula is one idea then one sideways Saturday", () => {
  const block = editorialBuildFormulaLines().join("\n");
  assert.match(block, /FELT SATURDAY/);
  assert.match(block, /TEACH ONE/);
  assert.match(block, /only if the brief named a rule/);
  assert.match(block, /ONE SPECIMEN/);
  assert.match(block, /ONE LATERAL/);
  assert.match(block, /NEXT QUESTION/);
  assert.match(block, /QUESTION/);
  assert.match(block, /BYOB/);
  assert.match(block, /cold reader/);
});
