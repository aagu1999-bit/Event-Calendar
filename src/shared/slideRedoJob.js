// What Redo will actually do on THIS chair — named before the click.
//
// Default Redo used to say "make it clearly DIFFERENT" and nothing else,
// so the operator could not tell whether it would fix the cut-off title,
// drop a URL, or just reshuffle the same Fuel line. Diagnose the leaks
// on the card, show them, and send that job into the rewrite.
//
// Two repair layers, not one stuffed Generate prompt:
//   1. First-pass (deterministic): strip URLs / mid-body stars, ALL CAPS
//      news labels. Leave a real last-line *payoff* and plant.
//   2. Auto-repair (Generate, after the writer): at most AUTO_REPAIR_CAP
//      single-slot Redos on dump / cut-title / grant chairs. Missing
//      plant stays a warning — firing it on every News card is why the
//      operator was clicking Redo on every slide.
// Attach whatever is still wrong as a warning.

import { plantZone, landingZone } from "./slideBridge.js";

const URL_RE = /https?:\/\/\S+/i;
const MD_STAR_RE = /\*[^*\n]{2,}\*/;
const SOURCE_TAG_RE = /\((?:UNIVERSITY|CULTURAL|SPECIALIST|COMMUNITY\s+HIST)[^)]*\)/i;
const SCAFFOLD_RE = /\b(?:KEEP THE SCOUT THESIS|SCOUT THESIS|\bTHESIS\b|\bBEAT:|\bTHE LOG\b|\bTHE BIGGER PICTURE\b|\bTHE STORY\b|\bTHE FRAME\b|\bTHE CONTEXT\b)\b/i;
const BROCHURE_RE = /\b(?:explore the|legacy continues|learn more|find out more|link in bio|the journey|must-visit)\b/i;
const GRANT_RE = /\b(?:starting point for encountering|burgeoning|highlights the|future potential|vibrant community)\b/i;
const OMIT_RE = /\b(?:USE AS omit|NONE beyond same city|do not mash|NOT RELATED AS)\b/i;

const BODY_FIELDS = ["subtitle", "newsBody", "textBody", "ctaVenue", "ctaDate"];
const TITLE_FIELDS = [
  "headline", "newsKicker", "newsHeadline", "textTitle", "ctaKicker", "ctaDate",
];

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

function headlineLooksCut(text) {
  const h = String(text || "").trim();
  if (!h) return false;
  // newsHeadline maxLength is 60 — hitting the rail is a chop, not a style.
  if (h.length >= 55) return true;
  if (/\([^)]*$/.test(h) && !h.endsWith(")")) return true;
  return false;
}

function headlineIsASentence(text) {
  const h = String(text || "").trim();
  if (words(h).length > 12) return true;
  return /[.!?].+/.test(h);
}

function bodyRepeatsHeadline(headline, body) {
  const h = String(headline || "").trim().toLowerCase().replace(/[.!?]$/, "");
  const b = String(body || "").trim().toLowerCase();
  if (h.length < 22 || !b) return false;
  return b.startsWith(h.slice(0, Math.min(40, h.length)));
}

function blobOf(slide) {
  if (!slide || typeof slide !== "object") return "";
  return [
    slide.headline, slide.subtitle,
    slide.newsKicker, slide.newsHeadline, slide.newsBody,
    slide.textTitle, slide.textBody,
    slide.ctaKicker, slide.ctaDate, slide.ctaVenue,
  ].map((s) => String(s || "")).join("\n");
}

function nextName(slides, idx) {
  const next = Array.isArray(slides) ? slides[idx + 1] : null;
  const t = String(next?.type || "").toLowerCase();
  if (t !== "news" && t !== "text") return "";
  return String(
    next.newsHeadline || next.textTitle || next.newsKicker || "",
  ).replace(/\s+/g, " ").trim().slice(0, 80);
}

function isPayoffLine(last, before) {
  if (!String(before || "").trim()) return false;
  const t = String(last || "").trim();
  if (!/^\*[\s\S]+\*$/.test(t)) return false;
  if (words(t).length > 18) return false;
  if (URL_RE.test(t) || SOURCE_TAG_RE.test(t)) return false;
  return true;
}

function receiptHasMarkdown(headline, kicker, body) {
  const { before, last } = plantZone(body);
  const hay = [
    headline, kicker, before,
    isPayoffLine(last, before) ? "" : last,
  ].join("\n");
  return MD_STAR_RE.test(hay);
}

function distinctiveTokens(text) {
  return String(text || "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 6);
}

function relatednessBlocksPlant(context, nextHeadline) {
  const tokens = distinctiveTokens(nextHeadline).slice(0, 2);
  if (!tokens.length) return false;
  return String(context || "").split("\n").some((line) => {
    if (!OMIT_RE.test(line)) return false;
    const l = line.toLowerCase();
    return tokens.some((w) => l.includes(w));
  });
}

function lastIsMash(last, nextHeadline) {
  const t = String(last || "").trim();
  if (!t) return false;
  if (URL_RE.test(t) || SOURCE_TAG_RE.test(t)) return true;
  if (words(t).length > 22) return true;
  const tokens = distinctiveTokens(nextHeadline);
  if (tokens.length && tokens.some((w) => t.toLowerCase().includes(w)) && words(t).length > 12) {
    return true;
  }
  return false;
}

function isQuestionCloser(slide) {
  const date = String(slide?.ctaDate || "").trim();
  const venue = String(slide?.ctaVenue || "").trim();
  const hay = `${date} ${venue}`;
  if (/\?\s*$/.test(date) || /\?\s*$/.test(venue)) return true;
  return /^(how|why|what|who|does|is|are|can)\b/i.test(date);
}

export function diagnoseSlideRedo(slide, { index = 0, slides = [], context = "" } = {}) {
  const leaks = [];
  const type = String(slide?.type || "").toLowerCase();
  const blob = blobOf(slide);
  const headline = String(
    type === "cover" ? slide?.headline
      : type === "news" ? slide?.newsHeadline
        : type === "text" ? slide?.textTitle
          : type === "cta" ? slide?.ctaDate
            : "",
  ).trim();
  const kicker = String(
    type === "news" ? slide?.newsKicker
      : type === "cta" ? slide?.ctaKicker
        : "",
  ).trim();
  const body = String(
    type === "cover" ? slide?.subtitle
      : type === "news" ? slide?.newsBody
        : type === "text" ? slide?.textBody
          : type === "cta" ? slide?.ctaVenue
            : "",
  ).trim();
  const zones = plantZone(body);
  const dump = URL_RE.test(blob) || SOURCE_TAG_RE.test(blob);

  if (SCAFFOLD_RE.test(blob)) {
    leaks.push({
      key: "scaffold",
      see: "Homework or outline copy is on the card (THESIS / scout / THE LOG).",
      fix: "Write finished copy. Do not print THESIS, BEAT, scout notes, or THE LOG.",
    });
  }
  if (URL_RE.test(blob)) {
    leaks.push({
      key: "url",
      see: "A URL is on the image — nobody can tap it, and it is probably cut off.",
      fix: "Drop the URL. Name the source (the dissertation, the oral history, the radio show) in the body.",
    });
  }
  if (receiptHasMarkdown(headline, kicker, body)) {
    leaks.push({
      key: "markdown",
      see: "Markdown stars are showing as stars.",
      fix: "Drop the *asterisks* in the receipt. A closing *payoff* line may stay. Do not wrap the whole body.",
    });
  }
  if (SOURCE_TAG_RE.test(blob)) {
    leaks.push({
      key: "source-tag",
      see: "A catalog tag is in the title — (UNIVERSITY — …), (CULTURAL / SPECIALIST).",
      fix: "Title names the work. Body says what it is (a library guide, an oral history, a radio account). No parenthetical source-type stamp.",
    });
  }
  if (headlineLooksCut(headline)) {
    leaks.push({
      key: "truncated",
      see: "The headline is cut off mid-word.",
      fix: "Shorten the headline to a name that fits. Move the rest into the body.",
    });
  } else if (headlineIsASentence(headline)) {
    leaks.push({
      key: "title-as-body",
      see: "The headline is a sentence, not a label.",
      fix: "Headline is 2–7 words naming the thing. Body carries the sentence.",
    });
  }
  if (bodyRepeatsHeadline(headline, body)) {
    leaks.push({
      key: "repeat",
      see: "The body repeats the headline.",
      fix: "Body adds the receipt. Do not open by restating the title.",
    });
  }
  if (type === "cover" && words(body).length > 22) {
    leaks.push({
      key: "cover-wall",
      see: "Cover subtitle is a paragraph. On export it stacks above the title and buries the hook.",
      fix: "Headline is the hook. Subtitle is one connecting line — who / where / when — not the essay.",
    });
  }
  if (GRANT_RE.test(blob)) {
    leaks.push({
      key: "grant",
      see: "Grantwriter / brochure phrasing is on the card.",
      fix: "Name the installation, the club, the year. No 'encountering' / 'burgeoning' / 'highlights the'.",
    });
  }
  if (type === "cta" && BROCHURE_RE.test(blob)) {
    leaks.push({
      key: "brochure-cta",
      see: "The closer is a brochure door.",
      fix: "A next step already on the desk (the named installation, a night, comment EVENTS). Not 'explore' / 'legacy continues'.",
    });
  }
  if (type === "cta" && isQuestionCloser(slide)) {
    leaks.push({
      key: "question-cta",
      see: "The closer is a question.",
      fix: "Done is a next step already on the desk, not 'How does X inform Y?'.",
    });
  }
  if (type === "news" && !String(slide?.newsBody || "").trim()) {
    leaks.push({
      key: "empty-news",
      see: "News body is empty.",
      fix: "Write this START into the body. Kicker is only the eyebrow.",
    });
  }

  const prev = Array.isArray(slides) ? slides[index - 1] : null;
  if ((type === "news" || type === "text") && prev && String(prev.type || "").toLowerCase() === "cover" && body) {
    const tokens = distinctiveTokens(prev.headline || prev.newsHeadline);
    const first = landingZone(body).first.toLowerCase();
    if (tokens.length && !tokens.some((t) => first.includes(t))) {
      leaks.push({
        key: "landing",
        see: "This card does not open on the cover's fact.",
        fix: "First sentence names the cover's news (the club, the exhibition, the week). Do not recap the dek. Cover does not plant — this card lands.",
      });
    }
  }

  const next = nextName(slides, index);
  const blocked = relatednessBlocksPlant(context, next);
  const canPlant = (type === "news" || type === "text") && next
    && !dump
    && !leaks.some((l) => l.key === "scaffold")
    && !blocked;
  if (canPlant) {
    const last = zones.last;
    if (lastIsMash(last, next)) {
      leaks.push({
        key: "plant-mash",
        see: "The last line is a second receipt, not a pointer.",
        fix: `End by naming the next START and what it is ("${next}"), not by telling its whole story.`,
      });
    } else {
      const planted = distinctiveTokens(next).some((w) => last.toLowerCase().includes(w));
      if (!planted) {
        leaks.push({
          key: "plant",
          see: "Last line does not hand the next card to the reader.",
          fix: `Last sentence names the next START and what it is ("${next}"), not a second receipt. Keep a closing *payoff* if the desk already has that line.`,
        });
      }
    }
  }
  if ((type === "news" || type === "text") && next && blocked) {
    const planted = distinctiveTokens(next).some((w) => zones.last.toLowerCase().includes(w));
    if (planted) {
      leaks.push({
        key: "plant-blocked",
        see: "Relatedness said omit — this card still plants the next START.",
        fix: "End on this receipt. Do not plant an unjoined next card.",
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const leak of leaks) {
    if (seen.has(leak.key)) continue;
    seen.add(leak.key);
    unique.push(leak);
  }

  if (!unique.length) {
    return {
      leaks: [],
      see: "No named leak on this chair.",
      redo: next && (type === "news" || type === "text") && !blocked
        ? `Rewrite this chair only. Keep the same Fuel receipt. Different wording, not a rephrase. Last sentence plants "${next}" and says what it is.`
        : "Rewrite this chair only. Keep the same Fuel receipt. Different wording, not a rephrase.",
    };
  }

  return {
    leaks: unique,
    see: unique.map((l) => l.see).join(" "),
    redo: unique.map((l) => l.fix).join(" "),
  };
}

export function formatRedoWriterJob(diag, { index = 0, slotType = "news" } = {}) {
  const d = diag && typeof diag === "object" ? diag : { see: "", redo: "" };
  return [
    `YOUR JOB: rewrite ONLY slide ${index + 1} as a ${slotType} card.`,
    `WHAT IS WRONG ON THIS CARD: ${d.see || "no named leak."}`,
    `WHAT REDO MUST DO: ${d.redo}`,
    "Keep every other slide's facts off this body except a last-line plant of the next In START when relatedness allows.",
    "A last-line plant is a name plus what it is, not a second receipt. Do not invent a join. Do not print URLs. Do not print THESIS / scout / UNIVERSITY tags.",
    "Do not strip a closing *payoff* line. Cover does not plant; the first News card lands the cover's fact.",
  ].join(" ");
}

function stripUrls(s) {
  return String(s || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function stripReceiptStars(text) {
  const raw = String(text || "");
  const trail = raw.match(/^(.*?)(\s+\*[^*]{2,}\*\s*[.!]?\s*)$/);
  if (trail && trail[1].trim()) {
    const before = trail[1].replace(/\*([^*]+)\*/g, "$1").replace(/\s+/g, " ").trim();
    return `${before} ${trail[2].trim()}`.trim();
  }
  const { before, last } = plantZone(raw);
  const cleanBefore = String(before || "").replace(/\*([^*]+)\*/g, "$1");
  const cleanLast = isPayoffLine(last, before)
    ? last
    : String(last || "").replace(/\*([^*]+)\*/g, "$1");
  return [cleanBefore, cleanLast].filter((p) => String(p || "").trim()).join(" ").trim();
}

export function normalizeNewsLabel(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.toUpperCase();
}

export function repairSlideLeaks(slide) {
  if (!slide || typeof slide !== "object") return slide;
  const next = { ...slide };
  for (const field of TITLE_FIELDS) {
    if (typeof next[field] !== "string" || !next[field]) continue;
    let v = stripUrls(next[field]).replace(SOURCE_TAG_RE, "").replace(/\*+/g, "").trim();
    next[field] = v;
  }
  for (const field of BODY_FIELDS) {
    if (typeof next[field] !== "string" || !next[field]) continue;
    next[field] = stripReceiptStars(stripUrls(next[field]));
  }
  if (String(next.type || "").toLowerCase() === "news") {
    if (typeof next.newsHeadline === "string" && next.newsHeadline) {
      next.newsHeadline = normalizeNewsLabel(next.newsHeadline);
    }
    if (typeof next.newsKicker === "string" && next.newsKicker) {
      next.newsKicker = normalizeNewsLabel(next.newsKicker);
    }
  }
  return next;
}

// Rewrite jobs worth a Generate auto-Redo. `plant` is left out on
// purpose: almost every News chair fails it, and auto-firing it is how
// first-pass "repair" became another stuffed request.
const AUTO_REPAIR_KEYS = new Set([
  "url", "markdown", "source-tag", "truncated", "title-as-body",
  "scaffold", "grant", "brochure-cta", "question-cta",
  "landing", "plant-mash", "plant-blocked", "repeat", "cover-wall",
]);
const AUTO_REPAIR_CAP = 4;

function autoRepairRank(keys) {
  if (keys.includes("scaffold") || keys.includes("url") || keys.includes("source-tag")) return 0;
  if (keys.includes("truncated") || keys.includes("title-as-body")) return 1;
  if (keys.includes("cover-wall") || keys.includes("grant") || keys.includes("question-cta") || keys.includes("brochure-cta")) return 2;
  return 3;
}

export function chairsNeedingAutoRepair(slides, { context = "", cap = AUTO_REPAIR_CAP } = {}) {
  if (!Array.isArray(slides)) return [];
  const empty = [];
  const dump = [];
  for (let i = 0; i < slides.length; i++) {
    const diag = diagnoseSlideRedo(slides[i], { index: i, slides, context });
    const keys = (diag.leaks || []).map((l) => l.key);
    const dumpKeys = keys.filter((k) => AUTO_REPAIR_KEYS.has(k));
    if (keys.includes("empty-news")) {
      empty.push({ index: i, keys: [...new Set(["empty-news", ...dumpKeys])], diag });
      continue;
    }
    if (!dumpKeys.length) continue;
    dump.push({ index: i, keys: dumpKeys, diag });
  }
  dump.sort((a, b) => autoRepairRank(a.keys) - autoRepairRank(b.keys) || a.index - b.index);
  // Empty bodies are token-pressure leftovers, not optional dumps —
  // fill every one. Dump chairs stay capped so Generate does not Redo
  // the whole deck.
  return [...empty, ...dump.slice(0, Math.max(0, cap))];
}

export function repairCarouselLeaks(slides) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((s) => repairSlideLeaks(s));
}

// Title fields share a 60-char schema cap. The schema truncates mid-word
// ("…EXHIBITION PUTS A SPECIFI"), and an auto-Redo runs under the same cap,
// so it can chop again. This runs after auto-repair: turn the chop into a
// whole name, or drop it, and say so on the card.
export const TITLE_CAP = 60;
const TITLE_FIELD_BY_TYPE = { cover: "headline", news: "newsHeadline", text: "textTitle" };
const BODY_FIELD_BY_TYPE = { cover: "subtitle", news: "newsBody", text: "textBody" };
const TITLE_NOUNS = new Set([
  "EXHIBITION", "EXHIBIT", "SHOW", "FILM", "BOOK", "PROJECT", "SERIES", "ALBUM",
  "PARTY", "NIGHT", "FESTIVAL", "DOCUMENTARY", "ARCHIVE", "INSTALLATION",
  "MEMOIR", "DISSERTATION", "GUIDE", "RETROSPECTIVE", "PODCAST", "MURAL",
]);
const TAIL_STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "to", "in", "on", "at", "for", "with",
  "from", "by", "as", "into", "that", "which", "who", "its", "their", "his",
  "her", "is", "are", "was", "were", "—", "–", "-", ":", "&",
]);

function countChar(s, re) {
  return (String(s).match(re) || []).length;
}

function hasUnbalancedMarks(t) {
  if (countChar(t, /\(/g) > countChar(t, /\)/g)) return true;
  if (countChar(t, /"/g) % 2 === 1) return true;
  if (countChar(t, /“/g) > countChar(t, /”/g)) return true;
  return false;
}

export function titleLooksChopped(text, cap = TITLE_CAP) {
  const t = String(text || "").trim();
  if (!t) return false;
  return t.length >= cap - 3 || hasUnbalancedMarks(t);
}

function trimTail(tokens) {
  const out = tokens.slice();
  while (out.length && TAIL_STOPWORDS.has(out[out.length - 1].toLowerCase().replace(/[,;]+$/, ""))) out.pop();
  if (out.length) out[out.length - 1] = out[out.length - 1].replace(/[,;:—–-]+$/, "");
  return out.filter(Boolean);
}

function fitsAsName(tokens) {
  return tokens.length >= 2 && tokens.length <= 7 && tokens.join(" ").length <= 50;
}

export function rescueChoppedTitle(text, cap = TITLE_CAP) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const quoted = t.match(/(\S+\s+)?(["“])([^"“”]{3,}?)(["”])(\s+\S+)?/);
  if (quoted) {
    const before = (quoted[1] || "").trim();
    const after = (quoted[5] || "").trim();
    const parts = [];
    if (/['’]S$/i.test(before)) parts.push(before);
    parts.push(`${quoted[2]}${quoted[3].trim()}${quoted[4]}`);
    if (TITLE_NOUNS.has(after.toUpperCase().replace(/[^A-Z]/g, ""))) parts.push(after);
    const name = parts.join(" ");
    if (name.split(/\s+/).length <= 8 && name.length <= 50) return name;
  }

  const paren = t.lastIndexOf("(");
  const cutAtParen = paren > 0 && countChar(t, /\(/g) > countChar(t, /\)/g);
  if (cutAtParen) t = t.slice(0, paren).trim();
  let tokens = t.split(/\s+/).filter(Boolean);
  if (!cutAtParen && String(text).trim().length >= cap - 3 && tokens.length > 1) tokens = tokens.slice(0, -1);
  tokens = trimTail(tokens);
  if (fitsAsName(tokens)) return tokens.join(" ");

  const clause = t.split(/\s+[—–]\s+|:\s+|,\s+/)[0];
  const clauseTokens = trimTail(clause.split(/\s+/).filter(Boolean));
  if (clause !== t && fitsAsName(clauseTokens)) return clauseTokens.join(" ");
  return null;
}

export function rescueCutTitles(slides, { cap = TITLE_CAP } = {}) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((slide) => {
    if (!slide || typeof slide !== "object") return slide;
    const type = String(slide.type || "").toLowerCase();
    const field = TITLE_FIELD_BY_TYPE[type];
    if (!field) return slide;
    const original = String(slide[field] || "").trim();
    if (!titleLooksChopped(original, cap)) return slide;

    const next = { ...slide };
    const name = rescueChoppedTitle(original, cap);
    let message;
    if (name) {
      next[field] = name;
      message = `The headline was cut off at the length limit ("${original}"). Shortened to "${name}".`;
    } else if (type === "cover") {
      const whole = original.split(/\s+/).slice(0, -1).join(" ").trim();
      next[field] = whole || original;
      message = `The cover headline was cut off at the length limit. Kept the whole words: "${next[field]}".`;
    } else {
      next[field] = "";
      const bodyField = BODY_FIELD_BY_TYPE[type];
      if (bodyField && !String(next[bodyField] || "").trim()) {
        next[bodyField] = original.split(/\s+/).slice(0, -1).join(" ");
      }
      message = `The headline was cut off at the length limit ("${original}") and had no clean short name, so it was removed.`;
    }
    const existing = Array.isArray(slide._warnings) ? slide._warnings : [];
    next._warnings = [...existing, { type: "title_rescued", message }];
    return next;
  });
}

export function attachRedoLeakWarnings(slides, { context = "" } = {}) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((slide, i) => {
    const diag = diagnoseSlideRedo(slide, { index: i, slides, context });
    if (!diag.leaks.length) return slide;
    const existing = Array.isArray(slide._warnings) ? slide._warnings : [];
    return {
      ...slide,
      _warnings: [
        ...existing,
        {
          type: "redo_leak",
          message: diag.see,
          fix: diag.redo,
        },
      ],
    };
  });
}
