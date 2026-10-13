import test from "node:test";
import assert from "node:assert/strict";
import {
  plantZone,
  nextAdjacentProofKey,
  previousAdjacentProofKey,
  fuelNumberForProofKey,
  relatednessPlantMode,
  formatNextPlantClause,
  formatLandingClause,
  formatReservedProofLine,
  canPlantOnSlot,
  isAllowedPlantMention,
  isAllowedLandingMention,
} from "./slideBridge.js";
import { detectCrossContamination } from "./aiContent.js";
import { eventMatrixToFillSeed } from "./eventMatrixToFillSeed.js";
import { formatRelatednessSeedLines } from "./matrixCompass.js";
import { contentArrangerLines } from "./cgeMethod.js";

const CONTEXT = [
  "ANCHORED FACTS (write from these — numbers match Fuel on the desk):",
  "1. START — Equal Space is hosting Newark Tech Week sessions on Broad Street.",
  "2. START — Rutgers Angel Fund committed $25M to Newark tech founders.",
].join("\n");

test("adjacent proof keys follow the chair order, not a skip", () => {
  const assignments = {
    "START — Equal Space is hosting Newark Tech Week sessions on Broad Street.": 2,
    "START — Rutgers Angel Fund committed $25M to Newark tech founders.": 3,
  };
  assert.equal(
    nextAdjacentProofKey(assignments, 2).startsWith("START — Rutgers Angel Fund"),
    true,
  );
  assert.equal(nextAdjacentProofKey(assignments, 3), null);
  assert.equal(
    previousAdjacentProofKey(assignments, 3).startsWith("START — Equal Space"),
    true,
  );
  assert.equal(previousAdjacentProofKey(assignments, 2), null);
});

test("fuel numbers map from numbered ANCHORED FACTS", () => {
  assert.equal(
    fuelNumberForProofKey("START — Equal Space is hosting Newark Tech Week sessions on Broad Street.", CONTEXT),
    1,
  );
  assert.equal(
    fuelNumberForProofKey("START — Rutgers Angel Fund committed $25M to Newark tech founders.", CONTEXT),
    2,
  );
});

test("relatedness omit blocks a plant; afterthought allows weather", () => {
  const a = "START — Equal Space is hosting Newark Tech Week sessions on Broad Street.";
  const b = "START — Rutgers Angel Fund committed $25M to Newark tech founders.";
  const omit = `${CONTEXT}\nGAP — Fuel #1 × #2 · RELATED AS none. USE AS omit.`;
  assert.equal(relatednessPlantMode(a, b, omit), "block");
  const weather = `${CONTEXT}\nGAP — Fuel #1 × #2 · RELATED AS climate / city investment. NOT RELATED AS same program. USE AS afterthought.`;
  assert.equal(relatednessPlantMode(a, b, weather), "afterthought");
  const open = `${CONTEXT}\nGAP — Fuel #1 × #2 · are these related? #1: Equal Space · #2: HAX Name RELATED AS (what a page actually supports), NOT RELATED AS, and USE AS afterthought / omit.`;
  assert.equal(relatednessPlantMode(a, b, open), "allow");
  assert.equal(relatednessPlantMode(a, b, CONTEXT), "allow");
});

test("plant clause names the next START and demands a definition, not a label", () => {
  const clause = formatNextPlantClause({
    nextProof: "START — Rutgers Angel Fund committed $25M to Newark tech founders.",
    mode: "afterthought",
  });
  assert.match(clause, /NEXT PLANT/);
  assert.match(clause, /Rutgers Angel Fund/);
  assert.match(clause, /what the thing is/);
  assert.match(clause, /not left decoding a label/);
  assert.match(clause, /weather/);
  assert.match(clause, /not a second receipt/);
  const blocked = formatNextPlantClause({ nextProof: "START — Rutgers", mode: "block" });
  assert.match(blocked, /none/);
  assert.match(blocked, /not related/);
});

test("landing clause tells the next card to open on the planted START", () => {
  const landing = formatLandingClause({
    prevProof: "START — Equal Space is hosting Newark Tech Week sessions on Broad Street.",
    mode: "allow",
  });
  assert.match(landing, /LANDING/);
  assert.match(landing, /Equal Space/);
  assert.match(landing, /what it is/);
  assert.equal(formatLandingClause({ prevProof: "START — x", mode: "block" }), "");
});

test("reserved proof line exceptionalizes last-sentence plant on News, not showcase", () => {
  const news = formatReservedProofLine({
    reservedProof: "START — Equal Space",
    allowPlant: true,
  });
  assert.match(news, /receipt's details land HERE/);
  assert.match(news, /NEXT PLANT/);
  assert.equal(/NOWHERE ELSE/.test(news), false);
  const show = formatReservedProofLine({
    reservedProof: "START — Equal Space",
    showcase: true,
  });
  assert.match(show, /NOWHERE ELSE/);
  assert.equal(canPlantOnSlot("news"), true);
  assert.equal(canPlantOnSlot("news", { showcase: true }), false);
  assert.equal(canPlantOnSlot("cover"), false);
  assert.equal(canPlantOnSlot("cta"), false);
});

test("a last-sentence name is a plant; the same name in the body is a mash", () => {
  const plant = "Equal Space is hosting Newark Tech Week sessions on Broad Street this October. Investors just put money into Rutgers Angel Fund, a new pool for Newark tech founders in the same city.";
  assert.equal(isAllowedPlantMention(plant, "Rutgers Angel Fund"), true);
  const mash = "Equal Space and Rutgers Angel Fund both sit on Broad Street this October with Tech Week sessions.";
  assert.equal(isAllowedPlantMention(mash, "Rutgers Angel Fund"), false);
  const early = "Rutgers Angel Fund put $25 million into Newark. Equal Space is hosting Tech Week on Broad Street.";
  assert.equal(isAllowedPlantMention(early, "Rutgers Angel Fund"), false);
  const landing = "Rutgers Angel Fund, a $25 million pool for Newark tech founders, is the other reason this week is on the map. The fund closed this spring and is already writing checks.";
  assert.equal(isAllowedLandingMention(landing, "Equal Space"), false);
  const landPrev = "The same city that packed Equal Space for Tech Week just got Rutgers Angel Fund, a $25 million pool for founders. The fund closed this spring.";
  assert.equal(isAllowedLandingMention(landPrev, "Equal Space"), true);
});

test("plant zone includes the asterisk payoff after the join sentence", () => {
  const body = "Equal Space is hosting Tech Week on Broad Street. Investors put money into Rutgers Angel Fund, a new pool for Newark tech founders. *Same city, verified capital.*";
  const zone = plantZone(body);
  assert.match(zone.last, /Rutgers Angel Fund/);
  assert.match(zone.last, /verified capital/);
  assert.match(zone.before, /Equal Space/);
  assert.equal(isAllowedPlantMention(body, "Rutgers Angel Fund"), true);
});

test("cross-contamination allows a last-sentence plant of the next proof only", () => {
  const spine = {
    proofAssignments: {
      "START — Equal Space is hosting Newark Tech Week sessions on Broad Street.": 2,
      "START — Rutgers Angel Fund committed $25M to Newark tech founders.": 3,
    },
  };
  const sequence = ["cover", "news", "news", "cta"];
  const planted = detectCrossContamination([
    { type: "cover", headline: "Tech Week" },
    {
      type: "news",
      newsBody: "Equal Space is hosting Newark Tech Week sessions on Broad Street this October. Investors just put money into Rutgers Angel Fund, a new pool for Newark tech founders in the same city.",
    },
    {
      type: "news",
      newsBody: "Rutgers Angel Fund, a $25 million pool for Newark tech founders, closed this spring and is already writing checks.",
    },
    { type: "cta", ctaDate: "Comment EVENTS" },
  ], spine, CONTEXT, sequence);
  assert.equal((planted[1]._warnings || []).some((w) => w.type === "cross_contamination"), false);

  const mashed = detectCrossContamination([
    { type: "cover" },
    {
      type: "news",
      newsBody: "Equal Space and Rutgers Angel Fund both run Newark Tech Week on Broad Street this October with $25 million behind them.",
    },
    { type: "news", newsBody: "Rutgers Angel Fund committed $25 million to Newark tech founders." },
    { type: "cta" },
  ], spine, CONTEXT, sequence);
  assert.equal((mashed[1]._warnings || []).some((w) => w.type === "cross_contamination"), true);
});

test("locate desk and relatedness seed tell the writer to plant with a definition", () => {
  const seed = eventMatrixToFillSeed({
    name: "Newark Tech Week",
    matrix: {
      hook_a_side: "Newark Tech Week lands Oct. 12–17.",
      editorial_pov: "Newark Tech Week is in town Oct. 12–17.",
      data_points: [
        "START — Equal Space is hosting Newark Tech Week sessions on Broad Street.",
        "START — HAX / SOSV committed $25M and projects 2,500 jobs in Newark.",
      ],
    },
  });
  assert.match(seed.context, /LOCATE DESK/);
  assert.match(seed.context, /Last sentence/);
  assert.match(seed.context, /next In START/);
  assert.equal(/Do not write ecosystem \/ landscape \/ what's next/.test(seed.context), false);

  const related = formatRelatednessSeedLines([
    "GAP — Fuel #1 × #2 · are these related? RELATED AS",
  ]);
  assert.match(related.join("\n"), /last sentence/);
  assert.match(related.join("\n"), /what it is/);
  assert.match(related.join("\n"), /do not mash/);

  const arranger = contentArrangerLines().join("\n");
  assert.match(arranger, /Last sentence may plant/);
  assert.match(arranger, /short definition/);
});
