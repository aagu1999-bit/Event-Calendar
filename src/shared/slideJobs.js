// Slide jobs — what a card DOES, not how it looks.
//
// Look (cover / news / text / cta) is assigned from the job. The
// operator names jobs on a strip; Generate does not invent a second
// hidden beat list when a plan is set. GST 10 ignores this plan.
//
// Empty plan = current Auto (Cover + News + closer from the desk).
// A named plan wins length. Default tap is three jobs, not homework.

export const SLIDE_JOBS = {
  hook: {
    key: "hook",
    label: "Stop the scroll",
    look: "cover",
    writer:
      "COVER. State the fact or the real stake already on the desk. Do not withhold the news so they swipe. Do not invent a fight.",
  },
  prove: {
    key: "prove",
    label: "Prove I wasn't lying",
    look: "news",
    writer:
      "Validate the cover with a named receipt already on the desk. Real stake + named receipt + a use. No invented NYC / digital-divide / who-benefits hunt.",
  },
  happened: {
    key: "happened",
    label: "What happened",
    look: "news",
    writer:
      "THE LOG: who / what / where / when already on this desk. Real stake + named receipt + a use on this card. Not manifesto. Not THE BIGGER PICTURE. Not an open loop.",
  },
  who: {
    key: "who",
    label: "Who this is for",
    look: "text",
    writer:
      "Talk to the audience already on the desk (chips / POV / hook). Do not invent a second public.",
  },
  changes: {
    key: "changes",
    label: "What changes",
    look: "text",
    writer:
      "What changes — a person, a block, a pattern, or a livelihood already on the desk. Not always the reader's Monday commute.",
  },
  todo: {
    key: "todo",
    label: "What to do",
    look: "cta",
    writer:
      "The next step already on the desk. Not 'share this to change the conversation.' Not THE ARCHIVE.",
  },
};

export const SLIDE_JOB_ORDER = ["hook", "prove", "happened", "who", "changes", "todo"];

export const MIDDLE_JOBS = ["prove", "happened", "who", "changes"];

export const DEFAULT_SLIDE_JOBS = ["hook", "happened", "todo"];

export const COVER_STYLES = {
  announcement: {
    key: "announcement",
    label: "Announcement",
    writer: "Cover style: blatant announcement. Give the news in the headline. Swipe is for how / when / what to do.",
  },
  number: {
    key: "number",
    label: "Number",
    writer: "Cover style: one verified number already on the desk. Do not invent a statistic.",
  },
  quote: {
    key: "quote",
    label: "Quote",
    writer: "Cover style: a named quote already on the desk. Do not invent a speaker.",
  },
  needtoknow: {
    key: "needtoknow",
    label: "What you need to know",
    writer: "Cover style: service journalism. Name the event and promise the map / date / who it hits — from the desk.",
  },
  howitworks: {
    key: "howitworks",
    label: "How it works",
    writer: "Cover style: explainer only if the desk already named a trick to break down. Do not hunt a mechanism.",
  },
};

export const COVER_STYLE_ORDER = ["announcement", "number", "quote", "needtoknow", "howitworks"];

export function slideJobOf(key) {
  const k = String(key || "").trim().toLowerCase();
  return SLIDE_JOBS[k] || null;
}

export function coverStyleOf(key) {
  const k = String(key || "").trim().toLowerCase();
  return COVER_STYLES[k] || null;
}

export function sanitizeSlidePlan(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const seen = new Set();
  const jobs = (Array.isArray(src.jobs) ? src.jobs : [])
    .map((j) => slideJobOf(j)?.key)
    .filter((k) => {
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  if (jobs.length && jobs[0] !== "hook") jobs.unshift("hook");
  if (jobs.length && jobs[jobs.length - 1] !== "todo") jobs.push("todo");
  const cleaned = jobs.filter((k, i) => {
    if (k === "hook") return i === 0;
    if (k === "todo") return i === jobs.length - 1;
    return true;
  });
  const unique = [];
  const once = new Set();
  for (const k of cleaned) {
    if (once.has(k)) continue;
    once.add(k);
    unique.push(k);
  }
  // A named plan is at least the default three — hook + one middle + todo.
  if (unique.length === 2 && unique[0] === "hook" && unique[1] === "todo") {
    unique.splice(1, 0, "happened");
  }
  const coverStyle = coverStyleOf(src.coverStyle)?.key || "";
  return {
    jobs: unique.slice(0, 8),
    coverStyle,
  };
}

export function defaultSlidePlan() {
  return { jobs: DEFAULT_SLIDE_JOBS.slice(), coverStyle: "announcement" };
}

export function looksFromJobs(jobs = []) {
  const plan = sanitizeSlidePlan({ jobs });
  const list = plan.jobs.length ? plan.jobs : DEFAULT_SLIDE_JOBS;
  return list.map((k) => SLIDE_JOBS[k].look);
}

export function formatSlidePlanHeading(plan) {
  const clean = sanitizeSlidePlan(plan);
  if (!clean.jobs.length) return "Cover + News + closer from this desk (Auto)";
  const labels = clean.jobs.map((k) => SLIDE_JOBS[k].label);
  const style = coverStyleOf(clean.coverStyle);
  const head = labels.join(" → ");
  return style ? `${head} · cover: ${style.label}` : head;
}

export function formatSlidePlanSeeLine(plan) {
  return `What you'll see: ${formatSlidePlanHeading(plan)}`;
}

export function hasNamedSlidePlan(planOrText) {
  const plan = typeof planOrText === "string"
    ? parseSlidePlanFromContext(planOrText)
    : sanitizeSlidePlan(planOrText);
  return plan.jobs.length > 0;
}

export function formatSlidePlanSeedLines(plan) {
  const clean = sanitizeSlidePlan(plan);
  if (!clean.jobs.length) return [];
  const labels = clean.jobs.map((k) => SLIDE_JOBS[k].label);
  const style = coverStyleOf(clean.coverStyle);
  return [
    `SLIDE_PLAN_KEYS: jobs=${clean.jobs.join(",")}; cover=${clean.coverStyle || "none"}`,
    `SLIDE JOBS: ${labels.join(" → ")}`,
    "The operator named these jobs. Look (cover / news / text / closer) is assigned from the job. Do not invent Locate / Cause / Explain / Paradox beats to complete a kit. Do not add slides the plan did not name.",
    style ? style.writer : "Cover states the fact or the real stake. Do not withhold the news.",
    "When a job is What happened or Prove I wasn't lying: put a real stake, a named receipt, and a use on THAT card (the trifecta). No fabricated drama.",
  ];
}

export function parseSlidePlanFromContext(text) {
  const s = String(text || "");
  const m = s.match(/SLIDE_PLAN_KEYS:\s*jobs=([a-z,]+);\s*cover=([a-z]+|none)/i);
  if (!m) return sanitizeSlidePlan({});
  const jobs = String(m[1] || "").split(",").map((k) => k.trim());
  const cover = String(m[2] || "").toLowerCase() === "none" ? "" : m[2];
  return sanitizeSlidePlan({ jobs, coverStyle: cover });
}

const SLIDE_PLAN_CONTEXT_RE = /^(?:SLIDE_PLAN_KEYS:|SLIDE JOBS:|The operator named these jobs|Cover style:|Cover states the fact|When a job is What happened)/i;

export function replaceSlidePlanInContext(text, plan) {
  const kept = String(text || "")
    .split(/\r?\n/)
    .filter((line) => !SLIDE_PLAN_CONTEXT_RE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const extra = formatSlidePlanSeedLines(plan);
  if (!extra.length) return kept;
  return kept ? `${kept}\n\n${extra.join("\n")}` : extra.join("\n");
}

export function slidePlanWriterBlock(planOrText) {
  const plan = typeof planOrText === "string"
    ? parseSlidePlanFromContext(planOrText)
    : sanitizeSlidePlan(planOrText);
  const lines = formatSlidePlanSeedLines(plan);
  if (!lines.length) return [];
  return [
    "═════════════════════════════",
    "SLIDE JOBS — operator-named. Look (cover / news / text / closer) is assigned from the job. This outranks Locate / Cause / Explain / Paradox / Friction kit-filling. GST 10 ignores this plan.",
    ...lines,
    "Do not invent slides the plan did not name. Do not compress below the named count.",
    "═════════════════════════════",
    "",
  ];
}

export function slidePlanSpineBlock(planOrText) {
  const plan = typeof planOrText === "string"
    ? parseSlidePlanFromContext(planOrText)
    : sanitizeSlidePlan(planOrText);
  if (!plan.jobs.length) return [];
  const labels = plan.jobs.map((k) => SLIDE_JOBS[k].label);
  return [
    "═════════════════════════════",
    "SLIDE JOBS OVERRIDE — the operator named the cards. Outline THESE jobs, in this order. Do not invent Locate / Cause / Explain / Paradox / Friction / Mechanism beats.",
    `Jobs: ${labels.join(" → ")}`,
    `slideAssignments MUST follow: ${labels.join(", ")}`,
    `recommendedSlideCount MUST be ${plan.jobs.length}. Do not compress.`,
    "═════════════════════════════",
    "",
  ];
}

export function addMiddleJob(plan, key) {
  const clean = sanitizeSlidePlan(plan);
  const job = slideJobOf(key);
  if (!job || job.key === "hook" || job.key === "todo") return clean;
  if (clean.jobs.includes(job.key)) return clean;
  const withoutEnds = clean.jobs.filter((k) => k !== "hook" && k !== "todo");
  return sanitizeSlidePlan({
    ...clean,
    jobs: ["hook", ...withoutEnds, job.key, "todo"],
  });
}

export function removeJob(plan, key) {
  const clean = sanitizeSlidePlan(plan);
  const job = slideJobOf(key);
  if (!job || job.key === "hook" || job.key === "todo") return clean;
  return sanitizeSlidePlan({
    ...clean,
    jobs: clean.jobs.filter((k) => k !== job.key),
  });
}

export function setCoverStyle(plan, key) {
  const clean = sanitizeSlidePlan(plan);
  return { ...clean, coverStyle: coverStyleOf(key)?.key || "" };
}

function slideText(slide) {
  if (!slide || typeof slide !== "object") return "";
  return [
    slide.headline, slide.subtitle, slide.newsKicker, slide.newsHeadline,
    slide.newsBody, slide.newsCaption, slide.textTitle, slide.textBody,
    slide.ctaDate, slide.ctaVenue, slide.mainLine, slide.subLine,
  ].map((s) => String(s || "")).join(" ");
}

// Soft check after Generate. Not a form. News-job cards should carry
// stake + receipt + use. Empty means the card passed the cheap test.
export function trifectaWarnings(slide, jobKey) {
  const job = slideJobOf(jobKey);
  if (!job || (job.key !== "happened" && job.key !== "prove")) return [];
  const text = slideText(slide);
  if (!text.trim()) {
    return [{ type: "trifecta", message: `${job.label} is empty — needs a real stake, a named receipt, and a use.` }];
  }
  const warnings = [];
  const hasReceipt = /\b(?:\d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|voted|vote|official|according to|said|report|oct|jan|feb|mar|apr|may|jun|jul|aug|sep|nov|dec)\b/i.test(text)
    || /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/.test(text);
  const hasUse = /\b(?:monday|swipe|map|when|where|who|attend|doors|starts?|save|comment|reroute|bring|go to|show up)\b/i.test(text);
  const isBrochure = /\bdiscover surprising|gathering spots|link in bio|the bigger picture\b/i.test(text);
  if (!hasReceipt) {
    warnings.push({ type: "trifecta", message: `${job.label} needs a named receipt (date, vote, number, or source already on the desk).` });
  }
  if (!hasUse) {
    warnings.push({ type: "trifecta", message: `${job.label} needs a use — when, where, or what to do with the fact.` });
  }
  if (isBrochure) {
    warnings.push({ type: "trifecta", message: `${job.label} reads like brochure / scaffolding, not the log.` });
  }
  return warnings;
}

export function attachTrifectaWarnings(slides, jobs = []) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((slide, i) => {
    const extras = trifectaWarnings(slide, jobs[i]);
    if (!extras.length) return slide;
    const existing = Array.isArray(slide?._warnings) ? slide._warnings : [];
    return { ...slide, _warnings: [...existing, ...extras] };
  });
}
