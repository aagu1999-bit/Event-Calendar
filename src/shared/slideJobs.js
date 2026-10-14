// Slide jobs — what a card DOES, not how it looks.
//
// Look (cover / news / text / cta) is assigned from the job. The
// operator names jobs on a strip; Generate does not invent a second
// hidden beat list when a plan is set. GST 10 ignores this plan.
//
// Empty plan = Auto from Fuel / Check. Extra START facts are extra
// News cards, not a lock at Cover + News + closer. A named plan wins
// length. "Lock 3 cards" is the tap that freezes at three jobs.

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
      "THE LOG: who / what / where / when already on this desk. Real stake + named receipt + a use on this card. Last sentence may plant the next In START — name it and what it is, not a second receipt. Not manifesto. Not THE BIGGER PICTURE. Not an open loop.",
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

// News is the beef. Styles stack on the same News card (trifecta), they
// do not add chairs. A style stays locked until the desk has the material.
export const NEWS_STYLES = {
  log: {
    key: "log",
    label: "Log",
    hint: "Who / what / where / when on the card",
    missing: "Type who / what / where / when in Narrowing or Fuel",
    writer:
      "LOG: who / what / where / when already on the desk. One night, not a landscape.",
  },
  receipt: {
    key: "receipt",
    label: "Receipt",
    hint: "A date, number, filing, or official line",
    missing: "Need a date, number, filing, or official line in Fuel",
    writer:
      "RECEIPT: plant one named proof already on the desk (date, vote, number, filing). Do not invent a statistic.",
  },
  quote: {
    key: "quote",
    label: "Quote",
    hint: "Someone on the desk said it",
    missing: "Need someone speaking — a quote or “X said” in Fuel",
    writer:
      "QUOTE: a named speaker already on the desk. Do not invent a voice.",
  },
  side: {
    key: "side",
    label: "Side by side",
    hint: "Two sourced facts, no because",
    missing: "Need two sourced facts in Fuel",
    writer:
      "SIDE BY SIDE: put two sourced facts already on the desk next to each other. Do not write because / which means / who paid unless that join is itself sourced.",
  },
  hole: {
    key: "hole",
    label: "The hole",
    hint: "Name what the desk could not prove",
    missing: "Add a GAP, or Check an unverified claim",
    writer:
      "THE HOLE: name the gap as a fact (the filing does not list who signed). Do not hedge a rumor onto the card. Do not fill the gap.",
  },
};

export const NEWS_STYLE_ORDER = ["log", "receipt", "quote", "side", "hole"];

const HOMEWORK_ANCHOR = /^(?:RECEIPT\s*—\s*UNVERIFIED|GAP\s*—)/i;

function stripFuelLead(line) {
  return String(line || "").trim()
    .replace(/^[-•*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "");
}
const RECEIPT_RE = /\b(?:\d{1,4}|\$[\d,]+|\d+%|monday|tuesday|wednesday|thursday|friday|saturday|sunday|voted|vote|official|according to|filing|ordinance|permit|lease|census|license|reported|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|19\d{2}|20\d{2})\b/i;
const QUOTE_RE = /[“”"][^“”"]{8,}[“”"]|\b(?:said|says|told)\s+[A-Z]|\baccording to\s+[A-Z]/;

function newsDeskBlob({ hook = "", pov = "", lens = "", anchors = [] } = {}) {
  const lines = Array.isArray(anchors) ? anchors : [];
  return [hook, pov, lens, ...lines].map((s) => String(s || "")).join("\n");
}

function usableNewsAnchors(anchors = []) {
  return (Array.isArray(anchors) ? anchors : [])
    .map((a) => String(a || "").trim())
    .filter((a) => a.length > 8 && !HOMEWORK_ANCHOR.test(stripFuelLead(a)));
}

const SKIP_CONTEXT_PREFIX = /^(?:POV:|OPERATOR HOOK:|COHERENCE:|USE THIS DESK|POINTED SLIDE|UNVERIFIED|OPEN GAPS|GAPS —|PARKED FUEL|CONVERSATION|ANCHORED FACTS|HOMEWORK|SLIDE_PLAN|SLIDE JOBS|NEWS STYLES|LOCATE DESK|The operator named|LOG:|RECEIPT:|QUOTE:|SIDE BY SIDE:|THE HOLE:)/i;

export function anchorsFromDeskContext(text) {
  const out = [];
  for (const line of String(text || "").split(/\n/)) {
    const raw = String(line || "").trim();
    if (!raw) continue;
    const bullet = stripFuelLead(raw);
    if (HOMEWORK_ANCHOR.test(raw) || HOMEWORK_ANCHOR.test(bullet)) {
      out.push(bullet);
      continue;
    }
    if (/^(?:THESIS|START|SPECIMEN|MECHANISM|FRICTION|DOCUMENT|ARGUMENT|JOIN|NEXT|GAP)\s*—/i.test(bullet)) {
      out.push(bullet);
      continue;
    }
    if ((/^[-•*]/.test(raw) || /^\d+[.)]\s+/.test(raw.trim())) && bullet.length > 8 && !SKIP_CONTEXT_PREFIX.test(bullet)) {
      out.push(bullet);
    }
  }
  return out;
}

export function newsStyleOf(key) {
  const k = String(key || "").trim().toLowerCase();
  return NEWS_STYLES[k] || null;
}

export function newsStyleAvailability(desk = {}) {
  const blob = newsDeskBlob(desk);
  const usable = usableNewsAnchors(desk.anchors);
  const homework = (Array.isArray(desk.anchors) ? desk.anchors : [])
    .map((a) => String(a || "").trim())
    .filter((a) => HOMEWORK_ANCHOR.test(stripFuelLead(a)));
  const check = desk.check && typeof desk.check === "object" ? desk.check : {};
  const unverified = Array.isArray(check.claims)
    ? check.claims.filter((c) => c && c.support === "unverified")
    : [];
  const gaps = Array.isArray(check.gaps) ? check.gaps.filter(Boolean) : [];
  const named = [desk.hook, desk.pov, desk.lens].map((s) => String(s || "").trim()).some((s) => s.length > 8);
  const logOk = named || usable.length > 0;
  const receiptOk = RECEIPT_RE.test(blob);
  const quoteOk = QUOTE_RE.test(blob);
  const sideOk = usable.length >= 2;
  const holeOk = homework.length > 0 || unverified.length > 0 || gaps.length > 0;
  return {
    log: { ok: logOk, reason: logOk ? NEWS_STYLES.log.hint : NEWS_STYLES.log.missing },
    receipt: { ok: receiptOk, reason: receiptOk ? NEWS_STYLES.receipt.hint : NEWS_STYLES.receipt.missing },
    quote: { ok: quoteOk, reason: quoteOk ? NEWS_STYLES.quote.hint : NEWS_STYLES.quote.missing },
    side: { ok: sideOk, reason: sideOk ? NEWS_STYLES.side.hint : NEWS_STYLES.side.missing },
    hole: { ok: holeOk, reason: holeOk ? NEWS_STYLES.hole.hint : NEWS_STYLES.hole.missing },
  };
}

export function clampNewsStyles(plan, desk = {}) {
  const clean = sanitizeSlidePlan(plan);
  const avail = newsStyleAvailability(desk);
  return {
    ...clean,
    newsStyles: clean.newsStyles.filter((k) => avail[k]?.ok),
  };
}

export function toggleNewsStyle(plan, key, desk = {}) {
  const style = newsStyleOf(key);
  if (!style) return sanitizeSlidePlan(plan);
  const clean = clampNewsStyles(plan, desk);
  const avail = newsStyleAvailability(desk);
  if (!avail[style.key]?.ok) return clean;
  const on = clean.newsStyles.includes(style.key);
  return {
    ...clean,
    newsStyles: on
      ? clean.newsStyles.filter((k) => k !== style.key)
      : [...clean.newsStyles, style.key],
  };
}

export function formatNewsStyleParen(plan) {
  const labels = sanitizeSlidePlan(plan).newsStyles.map((k) => NEWS_STYLES[k].label.toLowerCase());
  if (!labels.length) return "";
  return ` (${labels.join(" + ")})`;
}

export function sanitizeNewsStyles(list = []) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((k) => newsStyleOf(k)?.key)
    .filter((k) => {
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function toggleNewsStyleList(list, key, desk = {}) {
  const style = newsStyleOf(key);
  if (!style) return sanitizeNewsStyles(list);
  const avail = newsStyleAvailability(desk);
  if (!avail[style.key]?.ok) return sanitizeNewsStyles(list);
  const current = sanitizeNewsStyles(list).filter((k) => avail[k]?.ok);
  const on = current.includes(style.key);
  return on ? current.filter((k) => k !== style.key) : [...current, style.key];
}

export function inferNewsStylesFromSlide(slide = {}) {
  const blob = [
    slide.newsKicker, slide.newsHeadline, slide.newsBody,
  ].map((s) => String(s || "")).join("\n");
  if (!blob.trim()) return [];
  const out = ["log"];
  if (RECEIPT_RE.test(blob)) out.push("receipt");
  if (QUOTE_RE.test(blob)) out.push("quote");
  if (/\b(?:meanwhile|while|versus|vs\.?|on one side|on the other)\b/i.test(blob)) out.push("side");
  if (/\b(?:does not list|no filing|gap|unverified|could not prove|the hole)\b/i.test(blob)) out.push("hole");
  return sanitizeNewsStyles(out);
}

export function attachNewsStyles(slides = []) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((slide) => {
    if (!slide || slide.type !== "news") return slide;
    const tagged = sanitizeNewsStyles(slide.newsStyles);
    return { ...slide, newsStyles: tagged.length ? tagged : inferNewsStylesFromSlide(slide) };
  });
}

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
  const newsSeen = new Set();
  const newsStyles = (Array.isArray(src.newsStyles) ? src.newsStyles : [])
    .map((k) => newsStyleOf(k)?.key)
    .filter((k) => {
      if (!k || newsSeen.has(k)) return false;
      newsSeen.add(k);
      return true;
    });
  return {
    jobs: unique.slice(0, 8),
    coverStyle,
    newsStyles,
  };
}

export function defaultSlidePlan() {
  return { jobs: DEFAULT_SLIDE_JOBS.slice(), coverStyle: "announcement", newsStyles: [] };
}

export function looksFromJobs(jobs = []) {
  const plan = sanitizeSlidePlan({ jobs });
  const list = plan.jobs.length ? plan.jobs : DEFAULT_SLIDE_JOBS;
  return list.map((k) => SLIDE_JOBS[k].look);
}

export function formatSlidePlanHeading(plan) {
  const clean = sanitizeSlidePlan(plan);
  const news = formatNewsStyleParen(clean);
  const newsTail = news ? ` · news:${news}` : "";
  if (!clean.jobs.length) return `Auto from Fuel / Check${newsTail}`;
  const labels = clean.jobs.map((k) => SLIDE_JOBS[k].label);
  const style = coverStyleOf(clean.coverStyle);
  const head = labels.join(" → ");
  const withCover = style ? `${head} · cover: ${style.label}` : head;
  return `${withCover}${newsTail}`;
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
  const jobsKey = clean.jobs.length ? clean.jobs.join(",") : "none";
  const coverKey = clean.coverStyle || "none";
  const lines = [];
  if (clean.jobs.length) {
    lines.push(`SLIDE_PLAN_KEYS: jobs=${jobsKey}; cover=${coverKey}`);
    const labels = clean.jobs.map((k) => SLIDE_JOBS[k].label);
    const style = coverStyleOf(clean.coverStyle);
    lines.push(`SLIDE JOBS: ${labels.join(" → ")}`);
    lines.push("The operator named these jobs. Look (cover / news / text / closer) is assigned from the job. Do not invent Locate / Cause / Explain / Paradox beats to complete a kit. Do not add slides the plan did not name.");
    lines.push(style ? style.writer : "Cover states the fact or the real stake. Do not withhold the news.");
    lines.push("When a job is What happened or Prove I wasn't lying: put a real stake, a named receipt, and a use on THAT card (the trifecta). No fabricated drama.");
  }
  lines.push("NEWS STYLES: each News card picks its own mix (log / receipt / quote / side by side / the hole) from the Fuel on THAT card. Return newsStyles on that news JSON. Do not apply one stack to every News chair. Do not add a slide per style.");
  for (const k of NEWS_STYLE_ORDER) lines.push(NEWS_STYLES[k].writer);
  return lines;
}

export function parseSlidePlanFromContext(text) {
  const s = String(text || "");
  const m = s.match(/SLIDE_PLAN_KEYS:\s*jobs=([a-z,]+|none);\s*cover=([a-z]+|none)(?:;\s*news=([a-z,]+|none))?/i);
  if (!m) return sanitizeSlidePlan({});
  const jobsRaw = String(m[1] || "").toLowerCase();
  const jobs = jobsRaw === "none" ? [] : jobsRaw.split(",").map((k) => k.trim());
  const cover = String(m[2] || "").toLowerCase() === "none" ? "" : m[2];
  const newsRaw = String(m[3] || "").toLowerCase();
  const newsStyles = !newsRaw || newsRaw === "none" ? [] : newsRaw.split(",").map((k) => k.trim());
  return sanitizeSlidePlan({ jobs, coverStyle: cover, newsStyles });
}

const SLIDE_PLAN_CONTEXT_RE = /^(?:SLIDE_PLAN_KEYS:|SLIDE JOBS:|The operator named these jobs|Cover style:|Cover states the fact|When a job is What happened|NEWS STYLES|LOG:|RECEIPT:|QUOTE:|SIDE BY SIDE:|THE HOLE:)/i;

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
  const namedJobs = plan.jobs.length > 0;
  return [
    "═════════════════════════════",
    namedJobs
      ? "SLIDE JOBS — operator-named. Look (cover / news / text / closer) is assigned from the job. This outranks Locate / Cause / Explain / Paradox / Friction kit-filling. GST 10 ignores this plan."
      : "NEWS STYLES — each News card picks its own mix. These are not extra chairs. GST 10 ignores this plan.",
    ...lines,
    namedJobs
      ? "Do not invent slides the plan did not name. Do not compress below the named count."
      : "Do not apply one stack to every News chair. Return newsStyles on that news JSON.",
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

export function emptyNewsWarnings(slide) {
  if (!slide || slide.type !== "news") return [];
  if (String(slide.newsBody || "").trim()) return [];
  return [{
    type: "empty_news",
    message: "News body is empty. The receipt belongs in Body — Kicker is only the eyebrow.",
  }];
}

function stripAnchorPrefix(line) {
  return stripFuelLead(line)
    .replace(/^(?:THESIS|START|SPECIMEN|DOCUMENT|ARGUMENT|JOIN|NEXT|MECHANISM|FRICTION)\s*—\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function headlineFromReceipt(text) {
  const first = String(text || "").split(/[.!?]/)[0].trim();
  return first.slice(0, 60);
}

// IN-play START / THESIS lines from the Generate seed. Skips Gaps,
// parked Fuel, and Check homework so a backfill cannot print those.
export function inPlayReceiptsFromContext(text) {
  const lines = String(text || "").split("\n");
  const hasHeader = lines.some((l) => /^ANCHORED FACTS\b/i.test(String(l || "").trim()));
  let inFacts = !hasHeader;
  const out = [];
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (/^ANCHORED FACTS\b/i.test(line)) {
      inFacts = true;
      continue;
    }
    if (/^(?:PARKED FUEL|GAPS —|COHERENCE:|RELATEDNESS|UNVERIFIED|CONVERSATION|SLIDE_PLAN|SLIDE JOBS|NEWS STYLES|LOCATE DESK|POV:|OPERATOR HOOK)/i.test(line)) {
      if (hasHeader) inFacts = false;
      continue;
    }
    if (!inFacts || !line) continue;
    const bullet = stripFuelLead(line);
    if (HOMEWORK_ANCHOR.test(bullet)) continue;
    if (!/^(?:THESIS|START|SPECIMEN|DOCUMENT|ARGUMENT|JOIN|NEXT|MECHANISM|FRICTION)\s*—/i.test(bullet)) continue;
    const body = stripAnchorPrefix(bullet);
    if (body.length > 8) out.push(body);
  }
  return out;
}

function receiptNeedle(receipt) {
  const needle = String(receipt || "").slice(0, 28).toLowerCase();
  return needle.length >= 8 ? needle : "";
}

function receiptInBody(receipt, slide) {
  const needle = receiptNeedle(receipt);
  if (!needle) return false;
  const blob = [
    slide?.newsBody, slide?.subtitle, slide?.textBody,
  ].map((s) => String(s || "").toLowerCase()).join(" ");
  return blob.includes(needle);
}

function emptyNewsMatchIndex(receipts, slide, used) {
  const kicker = String(slide?.newsKicker || "").trim().toLowerCase();
  const head = String(slide?.newsHeadline || "").trim().toLowerCase();
  const hay = `${kicker} ${head}`.trim();
  if (hay.length >= 4) {
    const slice = (kicker.length >= 4 ? kicker : hay).slice(0, 8);
    const unusedHit = receipts.findIndex((r, i) => !used.has(i) && r.toLowerCase().includes(slice));
    if (unusedHit >= 0) return unusedHit;
    const titledHit = receipts.findIndex((r) => r.toLowerCase().includes(slice));
    if (titledHit >= 0) return titledHit;
  }
  return receipts.findIndex((_, i) => !used.has(i));
}

// Writer often ships extra News chairs as a kicker only (INVESTMENT FUND
// / empty body) when token pressure or "omit unverified" hits. Put the
// unused IN START into the body so Redo is not the only fix.
// A headline that already names the START does not count as filled —
// that is how token-pressure decks kept empty bodies after lockLength.
export function fillEmptyNewsFromDesk(slides, context) {
  if (!Array.isArray(slides)) return slides;
  const receipts = inPlayReceiptsFromContext(context);
  if (!receipts.length) return slides;
  const used = new Set();
  for (const slide of slides) {
    receipts.forEach((r, i) => {
      if (receiptInBody(r, slide)) used.add(i);
    });
  }
  return slides.map((slide) => {
    if (!slide || slide.type !== "news") return slide;
    if (String(slide.newsBody || "").trim()) return slide;
    const idx = emptyNewsMatchIndex(receipts, slide, used);
    if (idx < 0) return slide;
    used.add(idx);
    const body = receipts[idx];
    return {
      ...slide,
      newsHeadline: String(slide.newsHeadline || "").trim() || headlineFromReceipt(body),
      newsBody: body,
    };
  });
}

export function dropEmptyNewsChairs(slides) {
  if (!Array.isArray(slides)) return slides;
  const next = slides.filter((s) => s?.type !== "news" || String(s.newsBody || "").trim());
  return next.length ? next : slides;
}

export function attachEmptyNewsWarnings(slides) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((slide) => {
    const extras = emptyNewsWarnings(slide);
    if (!extras.length) return slide;
    const existing = Array.isArray(slide?._warnings) ? slide._warnings : [];
    return { ...slide, _warnings: [...existing, ...extras] };
  });
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
