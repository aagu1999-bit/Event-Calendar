import test from "node:test";
import assert from "node:assert/strict";
import {
  SLIDE_JOBS,
  SLIDE_JOB_ORDER,
  DEFAULT_SLIDE_JOBS,
  NEWS_STYLE_ORDER,
  sanitizeSlidePlan,
  defaultSlidePlan,
  looksFromJobs,
  formatSlidePlanHeading,
  formatSlidePlanSeeLine,
  formatSlidePlanSeedLines,
  parseSlidePlanFromContext,
  replaceSlidePlanInContext,
  addMiddleJob,
  removeJob,
  setCoverStyle,
  hasNamedSlidePlan,
  trifectaWarnings,
  attachTrifectaWarnings,
  attachEmptyNewsWarnings,
  newsStyleAvailability,
  toggleNewsStyle,
  clampNewsStyles,
  formatNewsStyleParen,
  anchorsFromDeskContext,
} from "./slideJobs.js";
import { MATRIX_FIELDS } from "./matrixEnums.js";
import { matrixCompleteness } from "./matrixValidation.js";
import { eventMatrixToFillSeed } from "./eventMatrixToFillSeed.js";
import { earnedSlideCount, essaySlideSequence } from "./matrixCompass.js";
import { CONTENT_ESSAY_SLOTS } from "./cgeMethod.js";

test("catalog has six jobs and the default is three, not homework", () => {
  assert.deepEqual(SLIDE_JOB_ORDER, ["hook", "prove", "happened", "who", "changes", "todo"]);
  assert.deepEqual(DEFAULT_SLIDE_JOBS, ["hook", "happened", "todo"]);
  assert.equal(SLIDE_JOBS.happened.look, "news");
  assert.equal(SLIDE_JOBS.hook.look, "cover");
  assert.equal(SLIDE_JOBS.todo.look, "cta");
  assert.match(SLIDE_JOBS.hook.writer, /Do not withhold/);
  assert.match(SLIDE_JOBS.happened.writer, /THE LOG/);
  assert.equal(/THE BIGGER PICTURE/.test(SLIDE_JOBS.happened.writer), true);
});

test("sanitize forces hook first, todo last, unique, max 8", () => {
  const plan = sanitizeSlidePlan({ jobs: ["todo", "happened", "hook", "happened", "who"], coverStyle: "quote" });
  assert.deepEqual(plan.jobs, ["hook", "happened", "who", "todo"]);
  assert.equal(plan.coverStyle, "quote");
  assert.deepEqual(sanitizeSlidePlan({ jobs: ["hook", "todo"] }).jobs, ["hook", "happened", "todo"]);
  assert.deepEqual(sanitizeSlidePlan({}).jobs, []);
  assert.equal(hasNamedSlidePlan({}), false);
  assert.equal(hasNamedSlidePlan(defaultSlidePlan()), true);
});

test("looks come from jobs, not a second playbook", () => {
  assert.deepEqual(looksFromJobs(["hook", "happened", "todo"]), ["cover", "news", "cta"]);
  assert.deepEqual(looksFromJobs(["hook", "prove", "who", "changes", "todo"]), ["cover", "news", "text", "text", "cta"]);
  assert.deepEqual(looksFromJobs([]), ["cover", "news", "cta"]);
});

test("empty plan heading is Auto; named plan names the cards", () => {
  assert.equal(formatSlidePlanHeading({}), "Auto from Fuel / Check");
  assert.match(formatSlidePlanHeading(defaultSlidePlan()), /Stop the scroll → What happened → What to do/);
  assert.match(formatSlidePlanHeading(defaultSlidePlan()), /cover: Announcement/);
  assert.match(formatSlidePlanSeeLine(defaultSlidePlan()), /What you'll see:/);
});

test("seed lines parse back, and replace strips the old block", () => {
  const plan = defaultSlidePlan();
  const lines = formatSlidePlanSeedLines(plan);
  assert.match(lines[0], /SLIDE_PLAN_KEYS: jobs=hook,happened,todo; cover=announcement/);
  assert.match(lines.join("\n"), /Do not invent Locate \/ Cause \/ Explain/);
  const parsed = parseSlidePlanFromContext(lines.join("\n"));
  assert.deepEqual(parsed.jobs, ["hook", "happened", "todo"]);
  assert.equal(parsed.coverStyle, "announcement");
  const next = replaceSlidePlanInContext(`POV: a thesis\n\n${lines.join("\n")}`, { jobs: ["hook", "who", "todo"], coverStyle: "number" });
  assert.match(next, /POV: a thesis/);
  assert.match(next, /jobs=hook,who,todo; cover=number/);
  assert.equal(/jobs=hook,happened,todo/.test(next), false);
  assert.deepEqual(parseSlidePlanFromContext("no plan here").jobs, []);
});

test("add / remove middle jobs; hook and todo stay locked", () => {
  let plan = defaultSlidePlan();
  plan = addMiddleJob(plan, "who");
  assert.deepEqual(plan.jobs, ["hook", "happened", "who", "todo"]);
  plan = addMiddleJob(plan, "hook");
  assert.deepEqual(plan.jobs, ["hook", "happened", "who", "todo"]);
  plan = removeJob(plan, "happened");
  assert.deepEqual(plan.jobs, ["hook", "who", "todo"]);
  plan = removeJob(plan, "todo");
  assert.deepEqual(plan.jobs, ["hook", "who", "todo"]);
  plan = setCoverStyle(plan, "needtoknow");
  assert.equal(plan.coverStyle, "needtoknow");
});

test("trifecta warns only on What happened / Prove cards", () => {
  assert.deepEqual(trifectaWarnings({ newsBody: "A named receipt." }, "who"), []);
  const empty = trifectaWarnings({ newsBody: "" }, "happened");
  assert.equal(empty[0].type, "trifecta");
  const thin = trifectaWarnings({ newsHeadline: "discover surprising gathering spots" }, "prove");
  assert.equal(thin.some((w) => /brochure/.test(w.message)), true);
  const ok = trifectaWarnings({
    newsHeadline: "Council voted Tuesday",
    newsBody: "Doors start at 7. Comment EVENTS for the map.",
  }, "happened");
  assert.deepEqual(ok, []);
  const tagged = attachTrifectaWarnings(
    [{ type: "news", newsBody: "" }, { type: "cta", ctaVenue: "go" }],
    ["happened", "todo"],
  );
  assert.equal(tagged[0]._warnings.length > 0, true);
  assert.equal(tagged[1]._warnings, undefined);
});

test("empty News body is flagged so Redo can fill the receipt", () => {
  const tagged = attachEmptyNewsWarnings([
    { type: "news", newsKicker: "RUTGERS-NEWARK SUMMIT", newsHeadline: "", newsBody: "" },
    { type: "news", newsKicker: "THE SUMMIT", newsHeadline: "Rutgers–Newark", newsBody: "Oct. 12, 1:30–6 p.m. at Ruth Bader Ginsburg Hall." },
    { type: "cover", headline: "ok" },
  ]);
  assert.equal(tagged[0]._warnings[0].type, "empty_news");
  assert.equal(tagged[1]._warnings, undefined);
  assert.equal(tagged[2]._warnings, undefined);
});

test("matrix stores slide_plan and completeness ignores it", () => {
  assert.equal(MATRIX_FIELDS.includes("slide_plan"), true);
  const empty = matrixCompleteness({});
  const withPlan = matrixCompleteness({
    slide_plan: defaultSlidePlan(),
    pipeline_status: "READY",
    argument_check: { verdict: "coherent" },
    conversation_rank: { primary: "explainer" },
  });
  assert.equal(withPlan.filled, empty.filled);
  assert.equal(withPlan.total, empty.total);
});

test("fill seed injects named jobs and they win Auto length", () => {
  const seed = eventMatrixToFillSeed({
    name: "Parkway piece",
    matrix: {
      event_tier: "FEATURE",
      hook_a_side: "Parkway towns eat the summer influx.",
      editorial_pov: "The influx is a logistics tax.",
      data_points: [
        "START — Parkway towns lose the shoulder season.",
        "START — A currently-operating Saturday still pays the tax.",
        "START — a third named corridor.",
        "START — a fourth named Saturday.",
      ],
      slide_plan: defaultSlidePlan(),
    },
  });
  assert.match(seed.context, /SLIDE_PLAN_KEYS: jobs=hook,happened,todo/);
  assert.match(seed.context, /SLIDE JOBS: Stop the scroll → What happened → What to do/);
  assert.deepEqual(seed.slidePlan.jobs, ["hook", "happened", "todo"]);
  assert.equal(earnedSlideCount(seed.context), 3);
  assert.deepEqual(looksFromJobs(seed.slidePlan.jobs), ["cover", "news", "cta"]);
});

test("empty slide_plan leaves Auto from receipts", () => {
  const seed = eventMatrixToFillSeed({
    name: "Parkway piece",
    matrix: {
      event_tier: "FEATURE",
      hook_a_side: "Parkway towns eat the summer influx.",
      editorial_pov: "The influx is a logistics tax.",
      data_points: [
        "START — Parkway towns lose the shoulder season.",
        "START — A currently-operating Saturday still pays the tax.",
        "SPECIMEN — a Parkway operator named the influx.",
        "START — a fourth named Saturday.",
      ],
    },
  });
  assert.equal(/SLIDE_PLAN_KEYS:/.test(seed.context), false);
  assert.equal(seed.slidePlan.jobs.length, 0);
  assert.equal(earnedSlideCount(seed.context), 6);
  assert.deepEqual(essaySlideSequence(3), ["cover", "news", "cta"]);
});

test("essay slot catalog is Cover then News then Text then closer", () => {
  assert.deepEqual(CONTENT_ESSAY_SLOTS, ["cover", "news", "text", "cta"]);
});

test("Generate context only counts Fuel lines as News-style material", () => {
  const anchors = anchorsFromDeskContext([
    "LOCATE DESK: Cover + News + Done.",
    "POV: Newark Tech Week is in town.",
    "ANCHORED FACTS (write from these):",
    "- START — Oct. 12 at Ruth Bader Ginsburg Hall",
    "- START — Mixer at Consigliere",
    "HOMEWORK — NOT PROOF.",
    "- GAP — who paid for the main stages",
    "NEWS STYLES — stack on every News card, not extra chairs: Log + Receipt.",
  ].join("\n"));
  assert.deepEqual(anchors, [
    "START — Oct. 12 at Ruth Bader Ginsburg Hall",
    "START — Mixer at Consigliere",
    "GAP — who paid for the main stages",
  ]);
  const avail = newsStyleAvailability({ hook: "Newark Tech Week", anchors });
  assert.equal(avail.side.ok, true);
  assert.equal(avail.hole.ok, true);
  assert.equal(avail.receipt.ok, true);
});

test("News styles stay grey until the desk earns them, then they stack", () => {
  assert.deepEqual(NEWS_STYLE_ORDER, ["log", "receipt", "quote", "side", "hole"]);
  const empty = newsStyleAvailability({});
  for (const key of NEWS_STYLE_ORDER) assert.equal(empty[key].ok, false);

  const logOnly = newsStyleAvailability({ hook: "Newark Tech Week is in town." });
  assert.equal(logOnly.log.ok, true);
  assert.equal(logOnly.receipt.ok, false);
  assert.equal(logOnly.quote.ok, false);
  assert.equal(logOnly.side.ok, false);
  assert.equal(logOnly.hole.ok, false);

  const receiptDesk = newsStyleAvailability({
    hook: "Newark Tech Week is in town.",
    anchors: ["START — Oct. 12 at Ruth Bader Ginsburg Hall"],
  });
  assert.equal(receiptDesk.log.ok, true);
  assert.equal(receiptDesk.receipt.ok, true);
  assert.equal(receiptDesk.side.ok, false);

  const twoFacts = newsStyleAvailability({
    anchors: [
      "START — Oct. 12 at Ruth Bader Ginsburg Hall",
      "START — Mixer at Consigliere on Oct. 13",
    ],
  });
  assert.equal(twoFacts.side.ok, true);
  assert.equal(twoFacts.receipt.ok, true);

  const quoted = newsStyleAvailability({
    anchors: ['START — Mayor Jackson said the hall “does not list who paid.”'],
  });
  assert.equal(quoted.quote.ok, true);

  const gapped = newsStyleAvailability({
    anchors: [
      "START — Oct. 12 at Ruth Bader Ginsburg Hall",
      "GAP — who paid for the main stages",
    ],
    check: { claims: [{ claim: "Sponsors underwrite the week.", support: "unverified", anchor: 0 }], gaps: [] },
  });
  assert.equal(gapped.hole.ok, true);
});

test("News styles multi-select stack and clamp when Fuel disappears", () => {
  const desk = {
    hook: "Newark Tech Week is in town.",
    anchors: [
      "START — Oct. 12 at Ruth Bader Ginsburg Hall",
      "START — Mixer at Consigliere on Oct. 13",
      "GAP — who paid for the main stages",
    ],
  };
  let plan = toggleNewsStyle({}, "log", desk);
  plan = toggleNewsStyle(plan, "receipt", desk);
  plan = toggleNewsStyle(plan, "hole", desk);
  assert.deepEqual(plan.newsStyles, ["log", "receipt", "hole"]);
  plan = toggleNewsStyle(plan, "side", desk);
  assert.deepEqual(plan.newsStyles, ["log", "receipt", "hole", "side"]);
  assert.equal(toggleNewsStyle(plan, "quote", desk).newsStyles.includes("quote"), false);

  const dropped = clampNewsStyles(plan, { hook: "Newark Tech Week is in town." });
  assert.deepEqual(dropped.newsStyles, ["log"]);
  assert.equal(formatNewsStyleParen(plan), " (log + receipt + the hole + side by side)");
});

test("stacked News styles seed the writer without adding chairs", () => {
  const plan = sanitizeSlidePlan({ newsStyles: ["log", "receipt", "hole"] });
  assert.deepEqual(plan.jobs, []);
  const lines = formatSlidePlanSeedLines(plan);
  assert.match(lines[0], /jobs=none; cover=none; news=log,receipt,hole/);
  assert.match(lines.join("\n"), /stack on every News card/);
  assert.match(lines.join("\n"), /Log \+ Receipt \+ The hole/);
  assert.match(lines.join("\n"), /Do not add a slide per style/);
  const parsed = parseSlidePlanFromContext(lines.join("\n"));
  assert.deepEqual(parsed.newsStyles, ["log", "receipt", "hole"]);
  assert.deepEqual(parsed.jobs, []);
  const seed = eventMatrixToFillSeed({
    name: "Tech Week",
    matrix: {
      event_tier: "FEATURE",
      hook_a_side: "Newark Tech Week is in town.",
      editorial_pov: "The week is in town, but the stages do not list who paid.",
      data_points: [
        "START — Oct. 12 at Ruth Bader Ginsburg Hall",
        "START — Mixer at Consigliere",
        "GAP — who paid for the main stages",
      ],
      slide_plan: { newsStyles: ["log", "receipt", "hole"] },
    },
  });
  assert.match(seed.context, /news=log,receipt,hole/);
  assert.equal(earnedSlideCount(seed.context), 4);
  assert.deepEqual(essaySlideSequence(earnedSlideCount(seed.context)), ["cover", "news", "news", "cta"]);
  assert.match(formatSlidePlanHeading(plan), /news: \(log \+ receipt \+ the hole\)/);
});
