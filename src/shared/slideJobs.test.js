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
  inPlayReceiptsFromContext,
  fillEmptyNewsFromDesk,
  dropEmptyNewsChairs,
  newsStyleAvailability,
  toggleNewsStyle,
  clampNewsStyles,
  formatNewsStyleParen,
  anchorsFromDeskContext,
  inferNewsStylesFromSlide,
  attachNewsStyles,
  sanitizeNewsStyles,
} from "./slideJobs.js";
import { MATRIX_FIELDS } from "./matrixEnums.js";
import { matrixCompleteness } from "./matrixValidation.js";
import { eventMatrixToFillSeed, emptyDeskPatch } from "./eventMatrixToFillSeed.js";
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

test("empty News chairs fill from IN Fuel, not Gaps or parked lines", () => {
  const context = [
    "ANCHORED FACTS (write from these — numbers match Fuel on the desk):",
    "1. START — Rutgers launched a Black and Latino Angel Investment Fund in 2020.",
    "4. START — Invest Newark lists Grow Newark Fund on its page.",
    "",
    "PARKED FUEL — on the desk, not this carousel. Do not write these:",
    "2. START — A parked fact about a Brooklyn week.",
    "",
    "GAPS — not proof. Do not write these as facts. Unverified claims stay off the slides:",
    "7. GAP — Fuel #1 × #4 · are these related?",
  ].join("\n");
  assert.deepEqual(inPlayReceiptsFromContext(context), [
    "Rutgers launched a Black and Latino Angel Investment Fund in 2020.",
    "Invest Newark lists Grow Newark Fund on its page.",
  ]);
  const filled = fillEmptyNewsFromDesk([
    { type: "cover", headline: "Tech Week is on." },
    { type: "news", newsKicker: "THE WEEK", newsHeadline: "Oct. 12", newsBody: "27 events across Newark." },
    { type: "news", newsKicker: "INVESTMENT FUND", newsHeadline: "", newsBody: "" },
    { type: "news", newsKicker: "SUPPORT", newsHeadline: "", newsBody: "" },
    { type: "news", newsKicker: "SPARE", newsHeadline: "", newsBody: "" },
    { type: "cta", ctaVenue: "Comment EVENTS" },
  ], context);
  assert.match(filled[2].newsBody, /Angel Investment Fund/);
  assert.match(filled[2].newsHeadline, /Rutgers/);
  assert.match(filled[3].newsBody, /Invest Newark/);
  assert.equal(filled[4].newsBody, "");
  const titledEmpty = fillEmptyNewsFromDesk([
    { type: "cover", headline: "Tech Week is on.", subtitle: "Rutgers launched a Black and Latino Angel Investment Fund in 2020." },
    { type: "news", newsKicker: "INVESTMENT FUND", newsHeadline: "Rutgers launched a Black and Latino Angel Investment Fund in 2020.", newsBody: "" },
    { type: "news", newsKicker: "GROW NEWARK", newsHeadline: "Invest Newark lists Grow Newark Fund", newsBody: "" },
  ], context);
  assert.match(titledEmpty[1].newsBody, /Angel Investment Fund/);
  assert.match(titledEmpty[2].newsBody, /Invest Newark/);
  const dropped = dropEmptyNewsChairs(filled);
  assert.equal(dropped.length, 5);
  assert.equal(dropped.some((s) => s.newsKicker === "SPARE"), false);
  assert.equal(dropped[dropped.length - 1].type, "cta");
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

test("each News card picks its own style mix after Generate", () => {
  const lines = formatSlidePlanSeedLines({});
  assert.match(lines.join("\n"), /each News card picks its own mix/);
  assert.match(lines.join("\n"), /Do not apply one stack to every News chair/);
  assert.equal(/SLIDE_PLAN_KEYS:/.test(lines.join("\n")), false);
  const inferred = inferNewsStylesFromSlide({
    type: "news",
    newsKicker: "THE SUMMIT",
    newsHeadline: "Ruth Bader Ginsburg Hall",
    newsBody: "Oct. 12 at Rutgers–Newark. Mayor Jackson said the hall “does not list who paid.”",
  });
  assert.equal(inferred.includes("log"), true);
  assert.equal(inferred.includes("receipt"), true);
  assert.equal(inferred.includes("quote"), true);
  const tagged = attachNewsStyles([
    { type: "cover", headline: "Tech Week" },
    { type: "news", newsHeadline: "Oct. 12", newsBody: "Ruth Bader Ginsburg Hall.", newsStyles: ["log"] },
    { type: "news", newsHeadline: "The mixer", newsBody: "Consigliere on Oct. 13." },
  ]);
  assert.deepEqual(tagged[1].newsStyles, ["log"]);
  assert.equal(tagged[2].newsStyles.includes("log"), true);
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
    },
  });
  assert.match(seed.context, /1\. START — Oct\. 12 at Ruth Bader Ginsburg Hall/);
  assert.match(seed.context, /3\. GAP — who paid for the main stages/);
  assert.match(seed.context, /GAPS — not proof/i);
  assert.equal(earnedSlideCount(seed.context), 4);
  assert.deepEqual(essaySlideSequence(earnedSlideCount(seed.context)), ["cover", "news", "news", "cta"]);
  assert.equal(seed.eventId, null);
  assert.deepEqual(seed.slides, []);
  const cleared = emptyDeskPatch();
  assert.deepEqual(cleared.data_points, []);
  assert.deepEqual(cleared.preview_slides, []);
  assert.equal(cleared.hook_a_side, null);
  assert.deepEqual(sanitizeNewsStyles(["log", "log", "nope", "receipt"]), ["log", "receipt"]);
});

test("fill seed carries event id and saved preview cards so sidebar Fill can reopen them", () => {
  const slides = [
    { type: "cover", headline: "Newark Tech Week lands Oct. 12" },
    { type: "news", newsHeadline: "24 events", newsBody: "Oct. 12–17.", newsStyles: ["log"] },
  ];
  const seed = eventMatrixToFillSeed({
    id: "editorial_tech_week",
    name: "Tech Week",
    matrix: {
      event_tier: "FEATURE",
      hook_a_side: "Newark Tech Week lands Oct. 12.",
      editorial_pov: "The week is on.",
      data_points: ["START — Oct. 12 at Ruth Bader Ginsburg Hall"],
      preview_slides: slides,
    },
  });
  assert.equal(seed.eventId, "editorial_tech_week");
  assert.equal(seed.slides.length, 2);
  assert.equal(seed.slides[0].headline, "Newark Tech Week lands Oct. 12");
  const cardsOnly = eventMatrixToFillSeed({
    id: "editorial_cards_only",
    name: "Saved cards",
    matrix: { event_tier: "FEATURE", preview_slides: slides },
  });
  assert.equal(cardsOnly.eventId, "editorial_cards_only");
  assert.equal(cardsOnly.slides.length, 2);
});
