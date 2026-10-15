// Deterministic checks for the storytelling eval (docs/storytelling-plan.md,
// Phase 0). Each takes a finished deck — the slide objects Generate returns —
// and reports what a reader would trip on. Model-judged checks (the deletion
// test) live in scripts/story-eval.mjs; nothing here calls a model.

import { detectPhantomEntities } from "./aiContent.js";

// Mirrors the schema cap on cover / News / Text titles in aiContent.js.
const TITLE_CAP = 60;

function count(t, re) {
  return (t.match(re) || []).length;
}

export function titleLooksChopped(text, cap = TITLE_CAP) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length >= cap - 3) return true;
  if (count(t, /\(/g) > count(t, /\)/g)) return true;
  if (count(t, /"/g) % 2 === 1) return true;
  return count(t, /“/g) > count(t, /”/g);
}

const TITLE_BY_TYPE = {
  cover: ["headline"],
  news: ["newsKicker", "newsHeadline"],
  text: ["textTitle"],
  cta: ["ctaKicker", "ctaDate"],
};
const BODY_BY_TYPE = {
  cover: ["subtitle"],
  news: ["newsBody"],
  text: ["textBody"],
  cta: ["ctaVenue"],
};
const CAPPED_TITLES = { cover: "headline", news: "newsHeadline", text: "textTitle" };

const STOPWORDS = new Set(`a an the of and or to in on at for with from by as into that which who
its their his her is are was were be been it this these those than then so but not no
also has have had will would can could about over under through without while such
both each one two more most other same very just only`.split(/\s+/));

const DOC_NOUN_RE = /\b(?:dissertation|thesis|guide|project|piece|article|study|report|book|memoir|archive|exhibition|exhibit|press|column|oral history|research|scholarship|page|paper|essay)\b/i;
const DOC_VERB_RE = /\b(?:uses?|offers?|identif(?:y|ies)|references?|points? to|traces?|tracks?|expands?|examines?|explores?|investigates?|analy[sz]es|analy[sz]e|situates?|highlights?|documents?|catalogs?|records?|argues?|presents?|puts?)\b/i;
const QUOTED_TITLE_RE = /["“][^"”]{6,}["”]/;

export function slideTitle(slide) {
  const fields = TITLE_BY_TYPE[String(slide?.type || "").toLowerCase()] || [];
  return fields.map((f) => String(slide?.[f] || "").trim()).filter(Boolean).join(" — ");
}

export function slideBody(slide) {
  const fields = BODY_BY_TYPE[String(slide?.type || "").toLowerCase()] || [];
  return fields.map((f) => String(slide?.[f] || "").trim()).filter(Boolean).join("\n");
}

export function slideText(slide) {
  return [slideTitle(slide), slideBody(slide)].filter(Boolean).join("\n");
}

function contentWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

function shingles(text, n = 5) {
  const ws = String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= ws.length; i += 1) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

// Cards that make the same claim. Two signals: a shared 5-word run (a
// repeated phrase like "without collapsing distinct scenes into one"), or
// most of the smaller card's content words also on the other card.
export function findRestatements(slides, { overlap = 0.5, minWords = 8 } = {}) {
  const cards = (slides || []).map((s, i) => ({ i, text: slideText(s) }));
  const pairs = [];
  for (let a = 0; a < cards.length; a += 1) {
    for (let b = a + 1; b < cards.length; b += 1) {
      const sa = shingles(cards[a].text);
      const shared = [...shingles(cards[b].text)].filter((g) => sa.has(g));
      const wa = new Set(contentWords(cards[a].text));
      const wb = new Set(contentWords(cards[b].text));
      const small = Math.min(wa.size, wb.size);
      const inter = [...wa].filter((w) => wb.has(w)).length;
      const ratio = small >= minWords ? inter / small : 0;
      if (shared.length || ratio >= overlap) {
        pairs.push({
          slides: [cards[a].i + 1, cards[b].i + 1],
          sharedPhrase: shared[0] || null,
          wordOverlap: Math.round(ratio * 100) / 100,
        });
      }
    }
  }
  return pairs;
}

export function findClippedTitles(slides) {
  const out = [];
  (slides || []).forEach((s, i) => {
    const field = CAPPED_TITLES[String(s?.type || "").toLowerCase()];
    if (field && titleLooksChopped(s?.[field])) out.push({ slide: i + 1, field, text: s[field] });
  });
  return out;
}

// A sentence end is . ! ? followed by space, except after a lone capital
// ("Jasmine A. Henry").
export function firstSentence(text) {
  return String(text || "").trim().split(/(?<=(?<!\b[A-Z])[.!?])\s+/)[0] || "";
}

// A card whose job is introducing a document: the first sentence's subject
// is a dissertation / guide / project (or a quoted title) and its verb is
// what the document does ("uses", "points to", "identifies").
export function findSourceDumpCards(slides) {
  const out = [];
  (slides || []).forEach((s, i) => {
    const type = String(s?.type || "").toLowerCase();
    if (type !== "news" && type !== "text") return;
    const first = firstSentence(slideBody(s));
    const opening = first.split(/\s+/).slice(0, 14).join(" ");
    const namesDocument = DOC_NOUN_RE.test(opening) || QUOTED_TITLE_RE.test(opening);
    if (namesDocument && DOC_VERB_RE.test(first)) out.push({ slide: i + 1, opening: first.slice(0, 140) });
  });
  return out;
}

// Names on the deck that are not on the desk. The app's own check only
// scans Text and Spotlight bodies; this runs it over every body field so
// News cards and cover subtitles count.
export function findUnsupportedNames(slides, deskContext) {
  const asText = (slides || []).map((s) => ({ type: "text", textBody: slideBody(s) }));
  const seq = asText.map(() => "text");
  const warn = console.warn;
  console.warn = () => {};
  let flagged;
  try {
    flagged = detectPhantomEntities(asText, String(deskContext || ""), [], seq);
  } finally {
    console.warn = warn;
  }
  // The app's matcher reads names in five-word windows and treats ’ and '
  // as different, so a desk name can fail to match itself. A name that
  // appears verbatim on the desk is supported.
  const desk = normalizeForMatch(deskContext);
  const out = [];
  flagged.forEach((s, i) => {
    const w = (s._warnings || []).find((x) => x.type === "phantom_entity");
    const names = (w?.entities || []).filter((n) => !desk.includes(normalizeForMatch(n)));
    if (names.length) out.push({ slide: i + 1, names });
  });
  return out;
}

function normalizeForMatch(text) {
  return String(text || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
}

export function deskContextText(desk) {
  const c = desk?.context;
  return Array.isArray(c) ? c.join("\n") : String(c || "");
}

export function deskLines(deskContext) {
  return String(deskContext || "")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(?:[-•*]|\d+[.)])\s+(.+?)\s*$/))
    .filter(Boolean)
    .map((m) => m[1]);
}

export function scoreDeck(slides, { deskContext = "" } = {}) {
  const restatements = findRestatements(slides);
  const clipped = findClippedTitles(slides);
  const sourceDumps = findSourceDumpCards(slides);
  const unsupported = findUnsupportedNames(slides, deskContext);
  const lines = deskLines(deskContext).length;
  return {
    slideCount: (slides || []).length,
    deskLineCount: lines,
    restatementPairs: restatements.length,
    clippedTitles: clipped.length,
    sourceDumpCards: sourceDumps.length,
    cardsWithUnsupportedNames: unsupported.length,
    details: { restatements, clipped, sourceDumps, unsupported },
  };
}
