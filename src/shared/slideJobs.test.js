import test from "node:test";
import assert from "node:assert/strict";
import {
  SLIDE_JOBS,
  SLIDE_JOB_ORDER,
  DEFAULT_SLIDE_JOBS,
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
  assert.equal(formatSlidePlanHeading({}), "Cover + News + closer from this desk (Auto)");
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
