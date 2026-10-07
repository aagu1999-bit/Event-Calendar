// AI Slide Generator — Gemini-backed content generator for individual
// carousel slots (currently Cover + CTA). Reusable across MediaTool
// forms; called from a ✨ AI Generate button next to the relevant slot.
//
// Inputs:
//   apiKey       — user's BYOK Gemini key (from MediaTool localStorage)
//   slotType     — "cover" | "cta"
//   topic        — what the carousel is about (user-supplied)
//   voice        — useBrandStore.voice { description, exemplars }
//   slotPrompts  — useBrandStore.slotPrompts { cover, cta } — strong CGE defaults
//
// Output: array of option objects matching the slot's schema:
//   cover → [{headline, subtitle, accentWord}, ...]
//   cta   → [{kicker, mainLine, subLine}, ...]
//
// Returns 3 options per call so the user can choose.

import { SLOT_META, SLOT_OUTPUT_SHAPES } from "../store.js";
import { extractJson, extractResponseText } from "./aiJson.js";
import {
  SLOT_DOCTRINE,
  SLOT_ANTIPATTERN_TOKENS,
  formatSlotDoctrineForPrompt,
  slotCanBeSupported,
} from "./slotDoctrine.js";
import { composeVoiceParamsDirective } from "./voiceParams.js";
import {
  isContentRegister,
  platformThesisBlock,
  contentRegisterBlock,
  contentCreativeDirection,
  contentSpineMandate,
  cadenceRotationBlock,
  editorialBuildFormulaBlock,
  editorialBuildFormulaLines,
} from "./cgeThesis.js";
import {
  contentMethodBlock,
  contentMethodResearchPrompt,
  parseMethodBrief,
  appendMethodBriefToContext,
  contextHasMethodBrief,
  contextHasFuelBrief,
  methodHasJoin,
  contentArrangerLines,
  CONTENT_ESSAY_SLOTS,
  CONTENT_FLYER_SLOTS,
  CONTENT_ESSAY_ARC,
} from "./cgeMethod.js";
import { generateGstCarousel } from "./gstPipeline.js";
import { conversationWriterBlock } from "./conversationMaps.js";

const MODEL = "gemini-2.5-flash-lite";
const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Transient errors from Gemini — 429 (rate limit), 500, 503 (model
// overloaded / "high demand"), plus network drops — usually clear within a
// few seconds. Retry those with exponential backoff so a momentary spike
// doesn't abort a generation the user is waiting on. Real errors (400 bad
// request, 401/403 bad key) are NOT retried — they'd fail identically every
// time, so we surface them immediately.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// POST a request body to Gemini and return the parsed JSON response,
// retrying transient failures. Replaces the raw fetch + res.ok check that
// every generator here duplicated (and which gave up after one attempt).
async function geminiGenerate(apiKey, requestBody, { tries = 4, model } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  // Per-call model override — most calls use the cheap flash-lite default, but
  // the grounded research calls pass a stronger model for better web reasoning.
  const url = model
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    : URL_BASE;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) {
      // 0.8s → 1.6s → 3.2s. Enough for a "high demand" spike to pass.
      await new Promise(r => setTimeout(r, 800 * 2 ** (attempt - 1)));
    }
    let res;
    try {
      res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      lastErr = e;          // network/CORS drop — transient, retry
      continue;
    }
    if (res.ok) return res.json();
    const errText = await res.text();
    lastErr = new Error(`Gemini ${res.status}: ${errText.slice(0, 240)}`);
    if (!RETRYABLE_STATUS.has(res.status)) throw lastErr;   // permanent — fail fast
  }
  throw lastErr;
}

// Render a slot's reference metadata (audience, examples, anti-patterns)
// as a labeled prompt block. Concrete examples drive output style more
// than prose rules; anti-patterns prevent the well-known failure modes.
// Returns [] if the slot has no metadata (custom or unmapped slot type).
function formatSlotReferenceBlock(slotType) {
  const meta = SLOT_META[slotType];
  if (!meta) return [];
  const lines = [
    `SLOT REFERENCE — ${slotType.toUpperCase()} — quality bar for this slot.`,
    "",
  ];
  if (meta.audience) {
    lines.push("Audience reading this slot:", meta.audience, "");
  }
  if (Array.isArray(meta.examples) && meta.examples.length) {
    lines.push(`Examples of GOOD output for this slot (study shape + voice + concreteness):`, "");
    meta.examples.forEach((ex, i) => lines.push(`Example ${i + 1}: ${ex}`));
    lines.push("");
  }
  if (Array.isArray(meta.antiPatterns) && meta.antiPatterns.length) {
    lines.push("ANTI-PATTERNS — NEVER write output that matches any of these:");
    meta.antiPatterns.forEach(p => lines.push(`- ${p}`));
    lines.push("");
  }
  return lines;
}

// Render a template's metadata as a labeled block for prompts. Built-in
// templates carry rich fields (audience, tone, bestFor, notFor, keyMove,
// example). Custom user templates only have name + sequence, so we
// degrade gracefully.
function formatTemplateForPicker(t) {
  const lines = [
    `id: ${t.id}`,
    `name: ${t.name}`,
    `sequence: ${t.sequence.join(" → ")} (${t.sequence.length} slides)`,
  ];
  if (t.audience)  lines.push(`audience: ${t.audience}`);
  if (t.tone)      lines.push(`tone: ${t.tone}`);
  if (t.bestFor)   lines.push(`best for: ${t.bestFor}`);
  if (t.notFor)    lines.push(`NOT for: ${t.notFor}`);
  if (t.keyMove)   lines.push(`key move: ${t.keyMove}`);
  if (!t.audience && !t.bestFor && t.intent) lines.push(`intent: ${t.intent}`);
  if (!t.audience && t.custom) lines.push("intent: user-saved custom sequence (no metadata)");
  return lines.join("\n");
}

// Render a template's metadata as the "TEMPLATE PURPOSE" block at the
// top of the fill prompt. Tells Gemini what this WHOLE carousel is
// trying to do before it sees the per-slot rules.
function formatTemplatePurposeBlock(meta) {
  if (!meta) return [];
  const lines = ["TEMPLATE PURPOSE — this is the frame around every slide. Honor it.", ""];
  if (meta.name)     lines.push(`Template: ${meta.name}`);
  if (meta.audience) lines.push(`Audience: ${meta.audience}`);
  if (meta.tone)     lines.push(`Tone: ${meta.tone}`);
  if (meta.bestFor)  lines.push(`Best for: ${meta.bestFor}`);
  if (meta.notFor)   lines.push(`NOT for: ${meta.notFor}`);
  if (meta.keyMove)  lines.push(`Key structural move: ${meta.keyMove}`);
  if (meta.example)  lines.push("", `Concrete example of what good output looks like:`, meta.example);
  lines.push("", "─────────────────────────────", "");
  return lines;
}

// === WEB RESEARCH (Google Search grounding) ===
// Gemini can't ground on Google Search AND return strict JSON in the same
// call, so research is a separate step: a grounded, plain-text call that
// gathers factual background on the event. The brief is then fed into the
// normal (JSON) generation as extra context — so the model isn't a black box
// that only knows what the user typed; it knows what e.g. "Juneteenth" or a
// named festival actually is. Opt-in (costs an extra call + uses grounding
// quota) and best-effort (callers continue without it if it fails).
export async function researchEvent({ apiKey, topic, context }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const subject = [topic, context].map(s => (s || "").trim()).filter(Boolean).join(" — ");
  if (!subject) throw new Error("Add a topic or event details to research first");
  const prompt = [
    "You are a researcher gathering BACKGROUND for a social-media carousel about an event.",
    "Search the web for useful context on the event/topic below, then write a tight brief.",
    "",
    `EVENT / TOPIC: ${subject}`,
    "",
    "Return 6-12 plain-text bullet points of factual, usable background — for example:",
    "- what the event / holiday / genre is about and why it matters;",
    "- cultural or local (NJ / Garden State) significance;",
    "- typical activities, vibe, or format;",
    "- notable history or widely-known facts that would make a post richer.",
    "",
    "RULES:",
    "- Prefer specific, verifiable facts. Note the source site in parentheses when helpful.",
    "- If you CANNOT confirm details about THIS specific event (exact venue / date / lineup /",
    "  host), say so plainly and give GENERAL background instead — never invent specifics.",
    "- Plain text bullets only. No preamble, no markdown headers.",
  ].join("\n");

  // Note: no responseMimeType here — JSON mode is incompatible with the
  // Google Search tool. We read the grounded plain text back out. Uses the
  // stronger flash model (not flash-lite) since grounded research benefits.
  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4 },
  }, { model: "gemini-2.5-flash" });
  return (extractResponseText(data) || "").trim();
}

// Content / Feature research — locate THIS specimen. Pattern, document,
// and join are optional if the specimen already shows them. Promo and
// editorial still use researchEvent (flyer/background). Skip this pass
// when Fuel already wrote the brief.
export async function researchContentMethod({ apiKey, topic, context, clusterDirective = "", clusterLabel = "" } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const prompt = contentMethodResearchPrompt({ topic, context, clusterDirective, clusterLabel });
  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.35 },
  }, { model: "gemini-2.5-flash" });
  const brief = (extractResponseText(data) || "").trim();
  const parsed = parseMethodBrief(brief);
  return {
    brief,
    parsed,
    sources: extractGroundingSources(data),
    hasJoin: methodHasJoin(parsed),
  };
}

async function ensureContentMethodBrief({ apiKey, topic, context, clusterDirective, clusterLabel, mode, isEvergreen }) {
  const ctx = context || "";
  if (!isContentRegister(mode, isEvergreen)) return { context: ctx, researched: null };
  if (contextHasMethodBrief(ctx) || contextHasFuelBrief(ctx)) return { context: ctx, researched: null };
  try {
    const researched = await researchContentMethod({ apiKey, topic, context: ctx, clusterDirective, clusterLabel });
    if (researched?.brief) {
      return { context: appendMethodBriefToContext(ctx, researched), researched };
    }
  } catch (e) {
    if (typeof console !== "undefined") {
      console.warn("Content method research failed, generating without join brief:", e?.message || e);
    }
  }
  return { context: ctx, researched: null };
}

// Pull the REAL source URLs Gemini used out of the grounding metadata so the
// user can see + verify what fed the research (instead of trusting a black box).
// Grounding URIs are often Google redirect links, but they still resolve and
// carry the site title. Deduped, capped.
function extractGroundingSources(data) {
  try {
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const seen = new Set(); const out = [];
    for (const c of chunks) {
      const uri = c?.web?.uri; const title = c?.web?.title;
      if (uri && !seen.has(uri)) { seen.add(uri); out.push({ uri, title: (title || uri).trim() }); }
    }
    return out.slice(0, 12);
  } catch { return []; }
}

// === TIMELY NEWS LOOKUP (Google Search grounding) ===
// Oriented at what's HAPPENING NOW rather than evergreen background. Runs a
// stronger model (gemini-2.5-flash, not the flash-lite default) and asks it to
// search SEVERAL angles, then returns { brief, sources } — the plain-text brief
// plus the real source links so the caller can show them for verification.
// `today` anchors recency so the model doesn't surface stale items.
export async function researchNews({ apiKey, topic, context, today = null }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const subject = [topic, context].map(s => (s || "").trim()).filter(Boolean).join(" — ");
  if (!subject) throw new Error("Add a topic or area to look up news for first");
  const stamp = today || (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();
  const prompt = [
    "You are a LOCAL news researcher gathering TIMELY, CURRENT happenings for a same-week",
    "social-media carousel. Do SEVERAL focused web searches (not just one) to cover the",
    "topic/area from multiple angles, then write a tight, verifiable brief.",
    "",
    `TOPIC / AREA: ${subject}`,
    ...(stamp ? ["", `TODAY: ${stamp}. Only surface items dated within roughly the last 10 days, or UPCOMING within ~3 weeks. Skip anything older.`] : []),
    "",
    "SEARCH THESE ANGLES (adapt the wording to the topic/area — run each as its own search):",
    "- \"<area> events this weekend / this week\"",
    "- \"<area> new openings / closings / launches\"",
    "- \"<topic> <current month> <year>\"",
    "- \"things to do <area>\", plus any specific venue/organizer/name mentioned in the context",
    "",
    "Then return 6-12 plain-text bullets, each a DISTINCT, DATED happening. For each bullet give:",
    "WHAT is happening, WHERE (venue + town), WHEN in [brackets] e.g. [Jul 5], a one-line WHY IT",
    "MATTERS, and the SOURCE (the site/publication name).",
    "",
    "RULES:",
    "- Every bullet must trace to a REAL search result. If you can't confirm a date/venue/price, say so — never invent one.",
    "- Prefer NJ / Garden State and the named area. Rank by timeliness first, then relevance.",
    "- Merge duplicates. Plain-text bullets only — no preamble, no markdown headers.",
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.3 },
  }, { model: "gemini-2.5-flash" });
  return { brief: (extractResponseText(data) || "").trim(), sources: extractGroundingSources(data) };
}

// === NEWS SCOUT — beat-aware story discovery (v1 of the "news agent") ===
// On demand, hunt the web for TIMELY, EVENT-BASED, Black-culture / Black-
// community happenings in New Jersey that fit what Central Group Events
// covers, then return a RANKED shortlist of story candidates the user can
// drop straight into a News slide. Two steps, because Google Search grounding
// can't be combined with a forced-JSON response:
//   1. Grounded discovery (gemini-2.5-flash + google_search) — several angle
//      searches across the beat → a bulleted brief + REAL source links.
//   2. Structuring pass (flash-lite, JSON mode) — score each candidate against
//      an explicit beat rubric and return clean, ranked cards.
// `area` narrows the geography; `focus` is an optional one-run steer
// ("Juneteenth", "Newark", "day parties"); `today` anchors recency.
const CGE_BEAT = [
  "Central Group Events (CGE) covers Black culture, Black community, and",
  "Black-owned / Black-led happenings across New Jersey — festivals, day",
  "parties, brunches, cookouts, concerts, comedy, markets, art, cultural",
  "celebrations (Juneteenth, Caribbean/African diaspora, HBCU), new Black-owned",
  "venue/restaurant openings, and community milestones. The tone is that of a",
  "street-level local critic—no-nonsense, authentic, and anti-hype. Ground the",
  "writing in specific neighborhoods and real community impact, rejecting generic",
  "marketing/influencer fluff ('hidden gem', 'movie', 'unforgettable', 'good vibes', 'can't-miss') in favor of",
  "raw, honest, direct observation. Strictly adapt this style to the specific input topic provided by",
  "the user (whether event, news, business, or guide)—do not pivot to unrelated topics (like food or parties)",
  "unless they are in the input context.",
].join(" ");

export async function scoutNews({ apiKey, area = "New Jersey", focus = "", today = null } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const stamp = today || (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();
  const areaLine = (area || "").trim() || "New Jersey";
  const focusLine = (focus || "").trim();

  // --- Step 1: grounded discovery across the beat ---
  const searchPrompt = [
    "You are a local-culture news scout for a Black events media page in New Jersey. Your voice is a street-level local insider—opinionated, direct, and anti-hype.",
    "Run SEVERAL distinct web searches (not just one) to find TIMELY, EVENT-BASED happenings that fit this beat:",
    CGE_BEAT,
    "",
    `AREA FOCUS: ${areaLine}.`,
    ...(focusLine ? [`EXTRA FOCUS THIS RUN: ${focusLine}.`] : []),
    ...(stamp ? ["", `TODAY: ${stamp}. Only surface items announced/happening within roughly the last 10 days, or UPCOMING within ~4 weeks. Skip stale items.`] : []),
    "",
    "SEARCH THESE ANGLES (adapt the wording; run each as its own search):",
    "- \"Black events New Jersey this weekend / this month\"",
    "- \"<NJ city> Black-owned OR day party OR brunch OR festival\"",
    "- \"Juneteenth OR Caribbean OR African OR HBCU culture event New Jersey\"",
    "- \"new Black-owned restaurant OR venue opening New Jersey\"",
    "- \"things to do Newark / Jersey City / Montclair / East Orange / Trenton this week\"",
    "",
    "Return 8-14 plain-text bullets, each a DISTINCT happening. For each bullet give:",
    "WHAT is happening, WHERE (venue + town), WHEN in [brackets] e.g. [Jul 12], a one-line WHY IT",
    "MATTERS, the SOURCE (site/publication name), and the SOURCE URL if available.",
    "",
    "RULES:",
    "- Every bullet must trace to a REAL search result. Never invent a date/venue/price — if unconfirmed, say so.",
    "- Prefer NJ / Garden State and the named area. Rank by timeliness first, then beat-fit.",
    "- Merge duplicates. Plain-text bullets only — no preamble, no markdown headers.",
  ].join("\n");

  const searchData = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: searchPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.35 },
  }, { model: "gemini-2.5-flash" });
  const brief = (extractResponseText(searchData) || "").trim();
  const sources = extractGroundingSources(searchData);
  if (!brief) return { candidates: [], sources, brief: "" };

  // --- Step 2: score + structure against the beat rubric ---
  const rubricPrompt = [
    "Below is a research brief of New Jersey happenings. Turn it into a RANKED shortlist of story",
    "candidates for a Black events/culture Instagram page (Central Group Events).",
    "",
    "THE BEAT: " + CGE_BEAT,
    "",
    "Score each candidate 0-100 on FIT for this beat, weighing:",
    "- Black culture / community / Black-owned relevance (most important)",
    "- Event-based AND in New Jersey",
    "- Timeliness (happening soon / just announced)",
    "- Authentic, street-level relevance over commercialized hype (avoid generic PR copy, reward real neighborhood resonance)",
    "DROP anything that clearly isn't a fit (generic national news, non-NJ, not event/culture).",
    "",
    "For each surviving candidate return:",
    "- headline: a punchy 4-9 word hook, Title Case, no ending period",
    "- kicker: a 1-3 word ALL-CAPS eyebrow (e.g. THIS WEEKEND, JUST OPENED, BREAKING)",
    "- body: 1-2 tight sentences — what it is + why it matters, ready to drop into a slide",
    "- whenWhere: a short 'venue · town · [date]' line, or \"\" if unknown",
    "- sourceUrl: the source URL link if present in the brief, else \"\"",
    "- score: the 0-100 number",
    "Rank best-first. Return 5-10 candidates.",
    "",
    "BRIEF:",
    brief,
    "",
    'Return ONLY JSON in this exact shape: {"candidates":[{"headline":"...","kicker":"...","body":"...","whenWhere":"...","sourceUrl":"...","score":88}]}',
  ].join("\n");

  let candidates = [];
  try {
    const data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: rubricPrompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    });
    const parsed = extractJson(extractResponseText(data));
    candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  } catch { candidates = []; }
  candidates = candidates
    .filter(c => c && (c.headline || c.body))
    .map(c => ({
      headline: String(c.headline || "").trim(),
      kicker: String(c.kicker || "").trim(),
      body: String(c.body || "").trim(),
      whenWhere: String(c.whenWhere || "").trim(),
      sourceUrl: String(c.sourceUrl || "").trim(),
      score: typeof c.score === "number" ? c.score : Number(c.score) || 0,
    }))
    .sort((a, b) => b.score - a.score);
  return { candidates, sources, brief };
}

// === EVENT SCOUT — find upcoming NJ events worth a carousel ===
// Sibling of scoutNews, pointed at EVENTS instead of news. Two grounded steps:
//   1. Discovery (gemini-2.5-flash + google_search): hunt for TIMELY, upcoming
//      Black-culture / Black-owned NJ events across several search angles.
//   2. Score + structure (JSON): rank each against CGE_BEAT and return a
//      calendar-shaped candidate the Scout page can preview, add to the
//      calendar, or hand to the carousel builder.
// `existingNames` (lowercased event names already on the user's calendar) lets
// the scorer mark net-new finds and reward them — the user is hunting for
// events they don't already have. Nothing here posts or saves; it only proposes.
export async function scoutEvents({ apiKey, area = "New Jersey", focus = "", existingNames = [], today = null } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const stamp = today || (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();
  const areaLine = (area || "").trim() || "New Jersey";
  const focusLine = (focus || "").trim();
  const known = new Set((existingNames || []).map(n => String(n || "").toLowerCase().trim()).filter(Boolean));

  // --- Step 1: grounded discovery of upcoming events ---
  const searchPrompt = [
    "You are an events scout for a Black-culture events media page in New Jersey (Central Group Events).",
    "Run SEVERAL distinct web searches (not just one) to find UPCOMING, real events that fit this beat:",
    CGE_BEAT,
    "",
    `AREA FOCUS: ${areaLine}.`,
    ...(focusLine ? [`EXTRA FOCUS THIS RUN: ${focusLine}.`] : []),
    ...(stamp ? ["", `TODAY: ${stamp}. Only surface events happening from today through the next ~5 weeks. Skip anything already past.`] : []),
    "",
    "RUN AT LEAST 8-10 DISTINCT SEARCHES (more is better) so you surface a DEEP list — aim to",
    "gather AT LEAST 25 candidate events before trimming. Cover these angles and vary the city each time:",
    "- \"Black events New Jersey this weekend / this month\" + Eventbrite / Instagram / Fever / Dice",
    "- \"<NJ city> day party OR brunch OR rooftop OR festival OR mixer\" upcoming (repeat per city below)",
    "- \"Juneteenth OR Caribbean OR Afrobeats OR Amapiano OR HBCU OR soca OR reggae event New Jersey\"",
    "- \"new Black-owned restaurant OR lounge OR bar OR venue opening New Jersey\"",
    "- \"<NJ city> comedy show OR concert OR live music OR open mic OR poetry Black\"",
    "- \"<NJ city> paint and sip OR market OR pop-up OR skate night OR game night\"",
    "- \"things to do <NJ city> this week / this weekend\"",
    "CITIES TO ROTATE THROUGH: Newark, Jersey City, East Orange, Irvington, Montclair, Elizabeth,",
    "Paterson, New Brunswick, Trenton, Plainfield, Orange, Hillside, Union, Atlantic City.",
    "",
    "Return AT LEAST 20 plain-text bullets (aim for 25-30), each a DISTINCT upcoming event. For each give:",
    "the EVENT NAME, WHAT it is (party / brunch / festival / opening / comedy / etc.), the VENUE + TOWN,",
    "the DATE in [brackets] e.g. [Jun 19] and a start time if known, a one-line WHY IT'S EXCITING,",
    "and the SOURCE URL if available.",
    "",
    "RULES:",
    "- Every bullet must trace to a REAL search result. Never invent a name/date/venue to pad the list —",
    "  if you genuinely can't find 20 real ones, return every real one you found (quantity never justifies fabrication).",
    "- Prefer NJ and the named area. Merge duplicates. Plain-text bullets only — no preamble, no markdown headers.",
  ].join("\n");

  const searchData = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: searchPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.35 },
  }, { model: "gemini-2.5-flash" });
  const brief = (extractResponseText(searchData) || "").trim();
  const sources = extractGroundingSources(searchData);
  if (!brief) return { candidates: [], sources, brief: "" };

  // --- Step 2: score + structure against the beat rubric ---
  const rubricPrompt = [
    "Below is a research brief of UPCOMING New Jersey events. Turn it into a RANKED shortlist of",
    "carousel candidates for a Black events/culture Instagram page (Central Group Events).",
    "",
    "THE BEAT: " + CGE_BEAT,
    "",
    "Score each event 0-100 for how much it deserves a CGE carousel, weighing roughly:",
    "- Brand fit (×40): Black culture / community / Black-owned relevance, in New Jersey (most important)",
    "- Excitement (×25): event type, venue, headliners — would people stop scrolling and tag a friend?",
    "- Freshness & timing (×20): happening soon / just announced, not stale",
    "- Newness (×15): reward events that feel fresh and discover-worthy",
    "DROP anything that clearly isn't a fit (not NJ, not event/culture, generic).",
    "",
    "For each surviving event return an object with:",
    "- name: the event name, Title Case, no ending period",
    "- type: a short event type (Day Party, Brunch, Festival, Venue Opening, Comedy, Concert, Market, etc.)",
    "- venue: venue name or \"\"",
    "- city: NJ town or \"\"",
    "- region: one of \"North\" / \"Central\" / \"South\" (NJ) — best guess from the town, or \"\"",
    "- date: \"M/D\" if known (e.g. \"6/19\"), else \"\"",
    "- time: start time like \"3 PM\" if known, else \"\"",
    "- kicker: a 1-3 word ALL-CAPS eyebrow (THIS WEEKEND, JUST ANNOUNCED, NEW OPENING, BUZZING)",
    "- why: one tight sentence — why it's a CGE post, ready to show the user",
    "- chips: array of 2-4 short beat-match tags (e.g. [\"Juneteenth\",\"Black-owned\",\"Day party\"])",
    "- buzz: true only if the brief suggests real hype/demand (headliners, selling out), else false",
    "- sourceUrl: the source link if present in the brief, else \"\"",
    "- score: the 0-100 number",
    "Rank best-first. Return AT LEAST 20 events (include every real one from the brief that fits — keep the",
    "lower-scoring ones too; the UI hides sub-70 picks behind a show-more, so more coverage is better). Only",
    "return fewer than 20 if the brief genuinely doesn't contain that many distinct real events.",
    "",
    "BRIEF:",
    brief,
    "",
    'Return ONLY JSON in this exact shape: {"events":[{"name":"...","type":"...","venue":"...","city":"...","region":"...","date":"...","time":"...","kicker":"...","why":"...","chips":["..."],"buzz":false,"sourceUrl":"...","score":88}]}',
  ].join("\n");

  let events = [];
  try {
    const data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: rubricPrompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    });
    const parsed = extractJson(extractResponseText(data));
    events = Array.isArray(parsed?.events) ? parsed.events : [];
  } catch { events = []; }

  const candidates = events
    .filter(e => e && e.name)
    .map(e => {
      const name = String(e.name || "").trim();
      const isNew = !known.has(name.toLowerCase());
      return {
        name,
        type: String(e.type || "").trim(),
        venue: String(e.venue || "").trim(),
        city: String(e.city || "").trim(),
        region: String(e.region || "").trim(),
        date: String(e.date || "").trim(),
        time: String(e.time || "").trim(),
        kicker: String(e.kicker || "").trim(),
        why: String(e.why || "").trim(),
        chips: Array.isArray(e.chips) ? e.chips.map(c => String(c || "").trim()).filter(Boolean).slice(0, 4) : [],
        buzz: !!e.buzz,
        sourceUrl: String(e.sourceUrl || "").trim(),
        score: typeof e.score === "number" ? e.score : Number(e.score) || 0,
        isNew,
      };
    })
    .sort((a, b) => b.score - a.score);
  return { candidates, sources, brief };
}

// === EVENT BREAKDOWN — deep per-event research for the carousel context ===
// Called when the user hits "Make Carousel" on a scout pick. Runs a grounded
// web search on that ONE event and returns a structured breakdown (THE TWIST /
// WHAT HAPPENS / PROOF / WHY NOW / WHO IT'S FOR) — the raw material the AI Fill
// carousel builder turns into slides. Returns plain text ready to drop into the
// Context field. Falls back to a thin summary if research fails or is thin.
export async function researchEventBreakdown({ apiKey, event, today = null } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const ev = event || {};
  const stamp = today || (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();
  const idLine = [
    ev.name && `Event: ${ev.name}`,
    ev.type && `Type: ${ev.type}`,
    ev.venue && `Venue: ${ev.venue}`,
    ev.city && `City: ${ev.city}`,
    [ev.date, ev.time].filter(Boolean).join(" "),
    ev.sourceUrl && `Source: ${ev.sourceUrl}`,
  ].filter(Boolean).join("\n");

  const prompt = [
    "You are researching ONE upcoming New Jersey event for Central Group Events (a Black-culture events",
    "media page) so they can build an Instagram carousel about it. Run SEVERAL web searches on THIS event",
    "(search the event name, the venue, the host/DJ handles, the flyer text) and pull the real details.",
    "",
    "THE EVENT:",
    idLine,
    ...(stamp ? ["", `TODAY: ${stamp}.`] : []),
    "",
    "Return a breakdown in EXACTLY this plain-text shape (keep the labels, fill each in):",
    "",
    `Event Breakdown: ${ev.name || "(event)"}`,
    "",
    "* THE TWIST: the single most distinctive hook — what makes this event different from a generic night (a live drummer, a rare headliner, a first-of-its-kind theme, a cause).",
    "* WHAT HAPPENS: what actually goes down — the vibe, the activities, the sets/performances, the crowd.",
    "* PROOF:",
    "   * Venue/Location: venue name + full address if findable.",
    "   * Date: day + date (+ start time if known).",
    "   * Lineup: the DJs / hosts / performers with their @handles if findable.",
    "   * Incentive/Pricing: free-before-X, RSVP, ticket price, giveaways — whatever applies.",
    "* WHY NOW: the timeliness / the organizers' pitch — why people should care right now (quote the flyer or caption angle if there is one).",
    "* WHO IT'S FOR: the specific audience this speaks to.",
    "",
    "RULES:",
    "- Use ONLY real details you can confirm from search. If a PROOF field is unknown, write \"not listed\" — never invent a lineup, address, or price.",
    "- Keep @handles exactly as written. Plain text only, no markdown headers, no preamble — start at \"Event Breakdown:\".",
  ].join("\n");

  try {
    const data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.35 },
    }, { model: "gemini-2.5-flash" });
    const text = (extractResponseText(data) || "").trim();
    if (text) return { breakdown: text, sources: extractGroundingSources(data) };
  } catch { /* fall through to thin summary */ }

  // Fallback: a thin but usable context built from what the scout already knows.
  const thin = [
    `Event Breakdown: ${ev.name || "(event)"}`,
    "",
    `* WHAT HAPPENS: ${ev.type || "Event"}${ev.why ? ` — ${ev.why}` : ""}.`,
    "* PROOF:",
    `   * Venue/Location: ${ev.venue || "not listed"}${ev.city ? `, ${ev.city}` : ""}.`,
    `   * Date: ${[ev.date, ev.time].filter(Boolean).join(" · ") || "not listed"}.`,
    ev.sourceUrl ? `   * Source: ${ev.sourceUrl}` : null,
  ].filter(Boolean).join("\n");
  return { breakdown: thin, sources: [] };
}

// === READ A FLYER — turn an uploaded poster into a carousel brief ===
// Gemini Vision reads an event flyer/poster image and extracts the same
// structured breakdown the scout produces (name + THE TWIST / WHAT HAPPENS /
// PROOF / WHY NOW / WHO IT'S FOR), so the AI Fill builder can make a post out
// of a flyer the user already has — no scrape or web lookup needed. `image` is
// a data URL or bare base64. Returns { name, breakdown }.
export async function readFlyer({ apiKey, image, mimeType = "image/png" } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!image) throw new Error("No flyer image provided");
  const b64 = String(image).startsWith("data:") ? String(image).split(",")[1] : String(image);
  const mt = String(image).startsWith("data:")
    ? (String(image).slice(5).split(";")[0] || mimeType)
    : mimeType;

  const prompt = [
    "You are reading an event FLYER / poster for Central Group Events (a Black-culture events media",
    "page in New Jersey) so they can build an Instagram carousel about it. Read EVERYTHING on the",
    "flyer — the event name, date, time, venue, address, the DJ/host/performer names and @handles,",
    "pricing / RSVP / free-before, and any tagline or hook.",
    "",
    "Return ONLY JSON in this exact shape:",
    '{"name":"<the event name, Title Case>","breakdown":"<the breakdown text>"}',
    "",
    "The breakdown string must be plain text in EXACTLY this shape (keep the labels, fill each in from the flyer):",
    "Event Breakdown: <name>\\n\\n* THE TWIST: <the single most distinctive hook>\\n* WHAT HAPPENS: <what goes down — vibe, sets, activities>\\n* PROOF:\\n   * Venue/Location: <venue + address>\\n   * Date: <day + date + start time>\\n   * Lineup: <DJs/hosts/performers with @handles>\\n   * Incentive/Pricing: <free-before / RSVP / ticket price / giveaways>\\n* WHY NOW: <the timeliness / the flyer's pitch or tagline>\\n* WHO IT'S FOR: <the specific audience>",
    "",
    "RULES:",
    "- Use ONLY what's actually on the flyer. If a field isn't shown, write \"not listed\" — never invent a lineup, address, or price.",
    "- Keep @handles exactly as written on the flyer.",
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mt, data: b64 } }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
  }, { model: "gemini-2.5-flash" });

  const parsed = extractJson(extractResponseText(data)) || {};
  const name = String(parsed.name || "").trim();
  let breakdown = String(parsed.breakdown || "").trim();
  if (!breakdown && !name) throw new Error("Couldn't read that flyer — try a clearer image.");
  if (!breakdown) breakdown = `Event Breakdown: ${name}`;
  return { name, breakdown };
}

// === SCREENSHOT → EVENT ROW(S) — Vision-extract one OR MORE events from a
// poster / IG post / story so the operator can add them to the Review queue
// without retyping. Most posters are a single event → returns [1]. Weekly
// schedule flyers ("Mondays: Trivia · Tuesdays: Karaoke") and series posters
// listing several dated events → returns N distinct cards. Careful NOT to
// split single events that just happen to list multiple DJs / performers /
// price tiers / tour locations.
//
// Each item in the returned array is { event, aiFilled, recurring }. aiFilled
// lists which fields the AI populated so the modal can ✨-mark them for
// preview-and-edit; recurring pre-ticks "also add as weekly regular". Only
// NAME is required per event — everything else is best-effort.
export async function screenshotToEvents({ apiKey, image, images, mimeType = "image/png", weekendDates = null, extraText = "" } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const rawList = [];
  if (Array.isArray(images) && images.length) rawList.push(...images);
  else if (image) rawList.push(image);
  const slides = rawList.filter((x) => typeof x === "string" && String(x).trim()).slice(0, 10);
  if (!slides.length) throw new Error("No screenshot provided");

  const toPart = (rawImg) => {
    const s = String(rawImg);
    const b64 = s.startsWith("data:")
      ? s.split(",").slice(1).join(",").replace(/\s/g, "")
      : s.replace(/\s/g, "");
    let mt = s.startsWith("data:")
      ? (s.slice(5).split(";")[0] || mimeType)
      : mimeType;
    if (mt === "image/jpg") mt = "image/jpeg";
    return { mime: mt, b64 };
  };
  const partsImgs = slides.map(toPart);

  const anchor = (weekendDates && (weekendDates.Fri || weekendDates.Sat || weekendDates.Sun))
    ? `The operator is reviewing this weekend: Fri ${weekendDates.Fri || "?"}, Sat ${weekendDates.Sat || "?"}, Sun ${weekendDates.Sun || "?"} (M/D). If the image only says a day of week (e.g. "Friday") with no explicit date, that day maps to the corresponding date above.`
    : "";

  const carouselNote = partsImgs.length > 1
    ? [
        `You are looking at ${partsImgs.length} images. These are slides 1–${partsImgs.length} of ONE Instagram carousel, attached in order after this prompt.`,
        "Treat them as one post. Extract DISTINCT events across the WHOLE set — do not emit one event per slide just because there are N slides.",
        "",
        "CAROUSEL — WHEN TO SPLIT:",
        "- Different slides advertise DIFFERENT events (a weekend lineup of separate parties, a venue's Fri vs Sat flyer, a promoter posting 3 unrelated nights).",
        "",
        "CAROUSEL — WHEN NOT TO SPLIT (return ONE object):",
        "- Different slides of the SAME event (cover / lineup / venue photo / tickets / dress code / map).",
        "- A recap or mood-board carousel for one night.",
        "",
      ].join("\n")
    : "";

  const prompt = [
    "You are extracting event details from a screenshot (Instagram post/story, flyer, graphic) for Central Group Events — a Black-culture events media brand in New Jersey. The result drops into the operator's review queue.",
    "",
    "Return ONLY JSON in this exact shape — an `events` ARRAY:",
    '{"events":[{"name":"","day":"","date":"","time":"","venue":"","area":"","region":"","type":"","igHandle":"","link":"","recurring":false}]}',
    "",
    "MOST posters are ONE event → the array has one object. Only split into multiple objects when the poster shows DISTINCT events (e.g. a weekly schedule listing different events on different days, or a series flyer showing several dated events).",
    "",
    carouselNote,
    "WHEN TO SPLIT (return multiple objects):",
    "- Weekly-schedule flyer: \"Mondays — Trivia\", \"Tuesdays — Karaoke\", \"Wednesdays — Live Music\" → 3 events, one per weekday shown.",
    "- Series poster listing multiple dated events with different names (e.g. \"Aug 1: Neo-Soul Sundays\", \"Aug 8: Reggae Night\") → one event per line.",
    "- Multi-event promo card advertising two or more distinct parties on different dates or times.",
    "",
    "WHEN NOT TO SPLIT (return ONE object):",
    "- One event with a lineup of multiple DJs / hosts / performers.",
    "- One event with multiple price tiers or promo levels (\"free before 10\", \"$20 after\").",
    "- A tour or franchise with multiple city dates on the same poster — pick the one clearly promoted, or leave as one event.",
    "- A recurring event happening every week — that's ONE object with `recurring: true`, not 52 events.",
    "- Multiple flyer designs showing the SAME event from different angles.",
    "",
    "Cap: never return more than 10 events per screenshot even if the poster shows more (calendar-view posters etc.).",
    "",
    "FIELDS (per event object):",
    "- name: the EVENT name in ALL CAPS (e.g. \"SUNDAY AFROBEATS BRUNCH\"). Not the venue, not the poster's handle.",
    "- day: exactly \"Fri\", \"Sat\", or \"Sun\" (from the day-of-week shown). Empty if unclear.",
    "- date: M/D only (e.g. \"7/31\"). Only if a specific date is visible.",
    "- time: the START time only, formatted as \"<hour>[:<min>] AM|PM\" (e.g. \"9 PM\", \"1 PM\", \"7:30 PM\"). NEVER a range — if the poster shows \"1-4 PM\" or \"10PM-2AM\" or \"5:30 to 8 PM\", return only the START (\"1 PM\", \"10 PM\", \"5:30 PM\").",
    "- venue: venue NAME in ALL CAPS (e.g. \"CAFE BELLO\"). Not the city.",
    "- area: CITY only, no state, ALL CAPS (e.g. \"NEWARK\", \"ELIZABETH\").",
    "- region: exactly \"North\", \"Central\", or \"South\" for the NJ region. IMPORTANT: Union County cities (Elizabeth, Union, Hillside, Clark, Linden, Rahway, Kenilworth, Roselle, Roselle Park, Cranford, Summit, Berkeley Heights, Garwood, Mountainside, New Providence, Plainfield, Scotch Plains, Springfield, Westfield) are LOCALLY North per the operator's convention — not Central. Empty if outside NJ or unclear.",
    "- type: one of these categories if it fits (uppercase): DJ NIGHT, PARTY, DAY PARTY, BRUNCH, HAPPY HOUR, LIVE MUSIC, CONCERT, KARAOKE, COMEDY, TRIVIA, POP-UP, MARKET, YOGA, FITNESS, ART, WORKSHOP, MOVIE SCREENING, MIXER, SPEED DATING, FESTIVAL, CAR SHOW, LOUNGE, GAME NIGHT, OPEN MIC, SIP AND PAINT. Empty if none fits.",
    "- igHandle: primary account's @handle (host/organizer/DJ). Include the @. Empty if none visible.",
    "- link: a full event URL (tickets, RSVP) only if a clear URL is shown. Empty otherwise.",
    "- recurring: TRUE if this specific event happens weekly — phrases like \"Every Friday\", \"Every Sat\", \"Sundays\", \"Weekly\", \"Each Saturday\", or a plural day-of-week (\"Fridays\") that clearly means recurring. FALSE for one-time events or when only a specific date is given. Set per-event when splitting a weekly schedule (each split event is `recurring: true`).",
    "",
    "SHARED FIELDS: when splitting, if the venue / city / region / IG handle is shared across the events (typical for a weekly schedule at one venue), repeat those fields on every event object.",
    "",
    "",
    extraText
      ? `ADDITIONAL TEXT from the post caption / URL metadata. Use it to fill fields the image doesn't show (handle, date, venue). Prefer what's visible on the flyer when they disagree:\n${String(extraText).slice(0, 1500)}`
      : "",
    "",
    anchor,
    "",
    "RULES:",
    "- Only include what's actually visible in the image(s). Never invent a date, venue, price, handle, or URL.",
    "- If unsure, leave the field as \"\" — the operator will fill it in.",
  ].filter(Boolean).join("\n");

  const geminiParts = [{ text: prompt }];
  partsImgs.forEach((img, i) => {
    if (partsImgs.length > 1) geminiParts.push({ text: `SLIDE ${i + 1} of ${partsImgs.length}:` });
    geminiParts.push({ inline_data: { mime_type: img.mime, data: img.b64 } });
  });

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: geminiParts }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  }, { model: "gemini-2.5-flash" });

  const parsed = extractJson(extractResponseText(data)) || {};
  const clean = (v) => String(v || "").trim();
  const upper = (v) => clean(v).toUpperCase();
  const dayMap = { friday: "Fri", saturday: "Sat", sunday: "Sun", fri: "Fri", sat: "Sat", sun: "Sun" };
  // Safety net for time: even with the prompt asking for start-only, strip any
  // range the model slips through. "1-4 PM" → "1 PM" (borrow the meridiem from
  // the tail if the start has none). "10PM-2AM" → "10PM". "9 PM" → "9 PM".
  const stripToStartTime = (raw) => {
    const s = clean(raw);
    if (!s) return "";
    const parts = s.split(/\s*(?:[-–—]|\bto\b)\s*/i);
    let start = parts[0].trim();
    if (parts.length === 1) return start;
    const hasMeridiem = /\b(am|pm|a\.m\.|p\.m\.)\b/i.test(start);
    if (!hasMeridiem) {
      const tailMatch = s.slice(start.length).match(/\b(am|pm|a\.m\.|p\.m\.)\b/i);
      if (tailMatch) start = `${start} ${tailMatch[1].toUpperCase()}`;
    }
    return start;
  };

  // Accept either shape defensively — the AI usually returns `{events: […]}` but
  // sometimes emits a bare single object under stress. Normalize both to an
  // array we can iterate.
  const rawEvents = Array.isArray(parsed.events) ? parsed.events
    : (parsed.name || parsed.day || parsed.venue) ? [parsed]
    : [];

  const results = [];
  for (const raw of rawEvents.slice(0, 10)) {
    if (!raw || typeof raw !== "object") continue;
    const day = dayMap[clean(raw.day).toLowerCase()] || "";
    const rawRegion = clean(raw.region);
    const region = /^n/i.test(rawRegion) ? "North" : /^c/i.test(rawRegion) ? "Central" : /^s/i.test(rawRegion) ? "South" : "";
    const event = {
      name: upper(raw.name),
      day,
      date: clean(raw.date),
      time: stripToStartTime(raw.time),
      venue: upper(raw.venue),
      area: upper(raw.area),
      region,
      type: upper(raw.type),
      igHandle: clean(raw.igHandle),
      link: clean(raw.link),
    };
    if (!event.name) continue; // skip anything without a name — nothing to add
    const aiFilled = Object.entries(event).filter(([, v]) => v).map(([k]) => k);
    const recurring = raw.recurring === true || raw.recurring === "true";
    results.push({ event, aiFilled, recurring });
  }

  if (results.length === 0) throw new Error("Couldn't read an event from that screenshot — try a clearer image.");
  return results;
}

// === WEEKEND CAPTION — Instagram caption for a downloaded calendar post ===
// Voiced from Brand Kit, anchored by a few-shot set of operator-approved
// captions so the model stays in-voice. The model only writes the opening
// (1–2 sentences). CTA + hashtags are assembled in code so they never
// drift: in-app "Comment EVENTS" (no off-app link), fixed brand tags.
// Event count is NOT mentioned — a 60-item sample cap used to leak
// "sixty events" into every caption even when the weekend wasn't 60.

// The operator's REAL approved caption examples — used as few-shot fuel to
// anchor register, rhythm, and casualness. Kept intentionally to the three
// captions the operator actually wrote (from screenshots). Earlier revs
// added 5 imitation drafts here and it back-fired: the drafts over-used
// "the motion" and the AI started opening every caption with it. Fewer,
// real examples > many, imitation ones — the AI generalizes better from
// the operator's actual voice than from a synthetic pastiche.
export const CAPTION_EXAMPLES = [
  `the rain isn't stopping the snow 🌊\n\nJersey has the motion right now & we're not slowing up anytime soon.`,
  `Dont think too hard about it gang.\nFeel a vibe? Catch a vibe. Bless up 😎`,
  `Jersey has MOTION, but don't get lost in the sauce 😉 We BEEN a vibe\n\nMake sure you support your people and find the curators that move you. The ones that bring something fresh to the table. There's no rush… it's just warming up.`,
];

// Detect a seasonal/holiday moment for the reviewed weekend so the AI can
// pick a genuinely relevant tail hashtag and (subtly) reference the moment
// in the body. friDateStr is "M/D" (year-agnostic — the operator's convention).
function detectSeasonalMoment(friDateStr) {
  const m = String(friDateStr || "").match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const mo = parseInt(m[1]), d = parseInt(m[2]);
  const fri = { mo, d };
  const sat = { mo: d + 1 > 31 ? mo + 1 : mo, d: d + 1 > 31 ? 1 : d + 1 };
  const sun = { mo: d + 2 > 31 ? mo + 1 : mo, d: d + 2 > 31 ? 2 : d + 2 };
  const covers = (targetMo, targetD) =>
    [fri, sat, sun].some((x) => x.mo === targetMo && x.d === targetD);
  const inRange = (fromMo, fromD, toMo, toD) => {
    const cur = mo * 100 + d;
    const from = fromMo * 100 + fromD;
    const to = toMo * 100 + toD;
    return cur >= from && cur <= to;
  };
  // Labor Day = first Monday of September; weekend before spans late Aug or
  // early Sept. Simple heuristic: Friday between Aug 29 and Sept 5 = Labor Day weekend.
  if (inRange(8, 29, 9, 5)) return { name: "Labor Day weekend", tag: "#LaborDayWeekend" };
  // Memorial Day = last Monday of May; weekend before spans late May.
  if (inRange(5, 22, 5, 30)) return { name: "Memorial Day weekend", tag: "#MemorialDayWeekend" };
  // Juneteenth
  if (covers(6, 19) || inRange(6, 17, 6, 21)) return { name: "Juneteenth weekend", tag: "#Juneteenth" };
  // 4th of July
  if (covers(7, 4) || inRange(7, 2, 7, 6)) return { name: "4th of July weekend", tag: "#4thOfJulyWeekend" };
  // HBCU homecoming season — mid-Sept through Oct
  if (inRange(9, 15, 10, 31)) return { name: "HBCU homecoming season", tag: "#HBCUSeason" };
  // Halloween
  if (inRange(10, 24, 11, 1)) return { name: "Halloween weekend", tag: "#HalloweenWeekend" };
  // Thanksgiving — 4th Thursday of November; approximate
  if (inRange(11, 20, 11, 28)) return { name: "Thanksgiving weekend", tag: "#ThanksgivingWeekend" };
  // NYE
  if (inRange(12, 29, 12, 31) || (mo === 1 && d <= 2)) return { name: "New Year's weekend", tag: "#NewYearsWeekend" };
  // Valentine's
  if (inRange(2, 12, 2, 16)) return { name: "Valentine's weekend", tag: "#ValentinesWeekend" };
  // MLK Day — 3rd Monday of Jan
  if (inRange(1, 15, 1, 21)) return { name: "MLK Day weekend", tag: "#MLKWeekend" };
  // Pride
  if (mo === 6) return { name: "Pride month", tag: "#Pride" };
  // Black History Month
  if (mo === 2) return { name: "Black History Month", tag: "#BlackHistoryMonth" };
  // Soft-fall — first weekend after Labor Day
  if (inRange(9, 6, 9, 14)) return { name: "first weekend after Labor Day (soft-launch fall)", tag: "#SoftFall" };
  return null;
}

export async function generateWeekendCaption({ apiKey, weekendDates = null, events = [], voice = null, examples = null } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const clean = (v) => String(v || "").trim();
  const anchorFri = clean(weekendDates?.Fri);
  const seasonal = detectSeasonalMoment(anchorFri);
  // Sample a handful of events for concrete venue/day texture. Do NOT
  // pass a total count into the prompt — the old slice(0, 60) leaked
  // "sixty events" into the caption even when the weekend wasn't 60.
  const allEvents = Array.isArray(events) ? events : [];
  const sampleEvents = allEvents.slice(0, 18);

  const byDay = { Fri: [], Sat: [], Sun: [] };
  for (const e of sampleEvents) if (byDay[e.day]) byDay[e.day].push(e);
  const daySummary = ["Fri", "Sat", "Sun"].filter((d) => byDay[d].length).map((d) => {
    const sample = byDay[d].slice(0, 4).map((e) => `${e.name}${e.venue ? ` @ ${e.venue}` : ""}${e.area ? `, ${e.area}` : ""}`);
    return `- ${d}: ${sample.join(" · ")}${byDay[d].length > 4 ? " …" : ""}`;
  }).join("\n");

  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const voiceExemplars = Array.isArray(voice?.exemplars) ? voice.exemplars.filter((e) => e && e.trim()).slice(0, 3) : [];
  const captionExamples = Array.isArray(examples) && examples.length ? examples : CAPTION_EXAMPLES;

  // Prompt priorities (top → bottom):
  //   1. Brand Voice from Brand Kit — the operator's REAL configured tone.
  //   2. A few operator-written examples for rhythm/register only.
  //   3. Explicit anti-repetition rules (openings, keywords) — earlier revs
  //      caused every caption to start with "Jersey has motion" because the
  //      examples over-used it.
  //   4. Weekend context (events, day mix, region, holiday moment).
  const prompt = [
    "You write Instagram captions for Central Group Events — a Black-culture events media brand in New Jersey. This caption ships with a downloaded weekend calendar carousel.",
    "",
    ...(hasVoiceDesc
      ? ["THE OPERATOR'S BRAND VOICE (this is the primary reference — match it more than any other input below):", voice.description.trim(), ""]
      : ["THE OPERATOR'S BRAND VOICE: (not configured — infer from the caption examples below, but keep them as ONE reference point among many possible openings, not the template).", ""]),
    ...(voiceExemplars.length ? ["BRAND-KIT VOICE EXAMPLES:", ...voiceExemplars.map((x) => `"${x}"`), ""] : []),
    "OPERATOR-WRITTEN CAPTION EXAMPLES (for RHYTHM and REGISTER only — do NOT copy their phrases, keywords, or opening lines):",
    ...captionExamples.map((c) => `"""${c}"""`),
    "",
    "RULES TO AVOID SOUNDING FORMULAIC (critical — earlier drafts failed this):",
    "- DO NOT start the caption with 'Jersey has motion', 'the motion', 'we BEEN', or any phrase that mimics a specific example's opening. Vary your opening every time.",
    "- DO NOT force keywords from the examples ('the motion', 'a vibe', 'gang', 'BEEN'). Use them only if they emerge naturally for THIS specific weekend's context. Most captions should NOT contain 'motion' at all.",
    "- Vary your opening angle: a weather/season detail, a specific event vibe, the day of week, a question, an observation, a call-out to a subgroup, etc.",
    "- Reference a real venue, day, or city from THIS weekend where it lands — stay concrete and warm. Do not list a tour of regions ('from North to South', 'from here to there').",
    "- NEVER hype-clichés: 'unforgettable', 'must-visit', 'hidden gem', 'something for everyone', 'you don't want to miss', 'the vibes were unmatched'.",
    "- Say 'Jersey' not 'NJ' in the body.",
    "- Write ONE or TWO sentences. That's the whole body. The opening is the part that works — stop there.",
    "- Do NOT mention how many events there are. No 'sixty events', no 'X events this weekend', no headcount.",
    "- Do NOT write a CTA, a link, a URL, 'link in bio', 'comment EVENTS', hashtags, or 'where we landing'. Those are added in code.",
    "- 1 emoji is fine, at the end of a thought — never decorative.",
    "- One ALL-CAPS word for emphasis if it FITS the moment (not required).",
    "",
    `THIS WEEKEND: Fri ${weekendDates?.Fri || "?"} · Sat ${weekendDates?.Sat || "?"} · Sun ${weekendDates?.Sun || "?"}`,
    seasonal ? `SEASONAL CONTEXT: ${seasonal.name} — reference it if it fits, don't force it.` : "",
    daySummary ? "SAMPLE EVENTS (texture only — do not count them, do not list them all):" : "",
    daySummary,
    "",
    "Return ONLY JSON in this exact shape (no markdown, no code fences, no preamble):",
    '{"body":"<1 or 2 sentences — plain text>"}',
  ].filter(Boolean).join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.95 },
  }, { model: "gemini-2.5-flash" });

  const parsed = extractJson(extractResponseText(data)) || {};
  const body = keepWeekendCaptionOpening(clean(parsed.body));
  if (!body) throw new Error("Caption came back empty — try Regenerate.");
  return { body, seasonal: seasonal?.name || null };
}

// Keep the opening that works: first 1–2 sentences. Drops leftover
// paragraphs, hashtag tails, and any CTA the model sneaks in.
export function keepWeekendCaptionOpening(body) {
  let t = String(body || "").trim();
  if (!t) return "";
  t = t.replace(/(?:^|\n)\s*#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+)*\s*$/g, "").trim();
  const firstPara = t.split(/\n\s*\n/)[0].trim();
  const pieces = firstPara.split(/\n+/).flatMap((line) => {
    const m = line.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
    return m && m.length ? m : [line];
  }).map((s) => s
    .replace(/\b(?:sixty|\d+|seventy|forty|fifty|eighty|ninety|hundred)\s+events\b[^.!?]*/gi, "")
    .replace(/where we landing[^.!?]*/gi, "")
    .replace(/link in bio[^.!?]*/gi, "")
    .replace(/from (?:here|north) to (?:here|there|south)[^.!?]*/gi, "")
    .replace(/centralgroupevents\.com[^.!?]*/gi, "")
    .replace(/comment\s+events[^.!?]*/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.!?])/g, "$1")
    .replace(/[.!?]{2,}/g, (m) => m[0])
    .replace(/^[,;:\-\s]+|[,\s]+$/g, "")
    .trim()
  ).filter((s) => /[A-Za-z0-9]/.test(s));
  return pieces.slice(0, 2).join(" ").trim();
}

// In-app keyword ask — never a link, URL, or "link in bio". Commenting
// EVENTS keeps people in Instagram; sending them to the site was hurting
// reach. Hashtags are a fixed four-tag set, not model-generated.
export const WEEKEND_CAPTION_CTA = "Comment EVENTS to get the full listing details.";
export const WEEKEND_CAPTION_HASHTAGS = ["#NJWeekend", "#OnlyInJersey", "#EventsInNewJersey", "#NJ"];

// Assembles the final caption: opening body + comment-EVENTS CTA + tags.
// `hashtags` is ignored (kept on the signature so older callers don't break).
export function assembleWeekendCaption({ body } = {}) {
  const opening = keepWeekendCaptionOpening(body);
  const tags = WEEKEND_CAPTION_HASHTAGS.join(" ");
  return `${opening}\n\n${WEEKEND_CAPTION_CTA}\n\n${tags}`;
}

// === GUIDE COMMENTARY — the editorial write-up for a website guide page ===
// Writes the 2-3 paragraph intro that sits above a guide's event listings (the
// centralgroupevents.com "Pages" body). Voiced from the Brand Kit so it reads
// like CGE, grounded in NJ + Black culture. Returns HTML <p> paragraphs ready
// to drop into the page's editor_content. Does NOT enumerate the events — they
// render as cards below — it sets the scene and sends the reader into them.
export async function generateGuideCommentary({ apiKey, title, theme = "", events = [], voice = null } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!title || !String(title).trim()) throw new Error("Give the guide a title first");

  const list = (Array.isArray(events) ? events : []).slice(0, 40).map(e =>
    `- ${e.name || "(event)"}${e.venue ? ` @ ${e.venue}` : ""}${e.area ? `, ${e.area}` : ""}${e.region ? ` (${e.region})` : ""}`
  ).join("\n");
  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const exemplars = Array.isArray(voice?.exemplars) ? voice.exemplars.filter(e => e && e.trim()).slice(0, 3) : [];

  const prompt = [
    "You write the editorial intro for a guide page on Central Group Events — a Black-culture events",
    "media brand covering New Jersey. This intro sits ABOVE a list of event cards on the page.",
    "",
    `GUIDE TITLE: ${String(title).trim()}`,
    ...(String(theme).trim() ? [`THEME / OCCASION: ${String(theme).trim()}`] : []),
    ...(hasVoiceDesc ? ["", "WRITE IN THIS BRAND VOICE:", voice.description.trim()] : []),
    ...(exemplars.length ? ["", "VOICE EXAMPLES (match this register, don't copy):", ...exemplars.map(x => `"${x}"`)] : []),
    "",
    "The events featured in this guide (for CONTEXT ONLY — do NOT list them out, they render as cards below):",
    list || "(none provided)",
    "",
    "Write 2-3 tight paragraphs: why this moment/theme matters to the community, what the reader will",
    "find here, and a nudge to explore the listings and claim their spot. Ground it in real NJ + Black",
    "culture. No hype clichés ('hidden gem', 'unforgettable', 'something for everyone'). 120-220 words.",
    "",
    "Return ONLY HTML paragraphs — <p>…</p> — no markdown, no code fences, no <html>/<head>, no preamble.",
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.85 },
  }, { model: "gemini-2.5-flash" });
  let html = (extractResponseText(data) || "").trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!html) throw new Error("Couldn't generate commentary — try again.");
  // If the model returned bare text without tags, wrap paragraphs.
  if (!/<p[\s>]/i.test(html)) {
    html = html.split(/\n{2,}/).map(p => `<p>${p.trim()}</p>`).join("\n");
  }
  return html;
}

// === CONNECT THE DOTS — thesis + evidence carousel ===
// The njdotcom "Is the Trump sports curse real? Here's the evidence" pattern:
// ONE claim/pattern, welded together from several SEPARATE real, dated news
// events (the "dots"). Two grounded steps:
//   1. Gather the dots (gemini-2.5-flash + google_search). If a thesis is
//      given, find 3-5 real events that illustrate it; if not (discover), the
//      model proposes a thread from current beat news and gathers its evidence.
//   2. Structure into a carousel plan (flash-lite, JSON): a claim-as-question
//      cover, one News beat per dot, a verdict beat, and a closing cta.
// Guardrail: the FRAMING may be a playful/observational lens (a "curse", a
// "moment", a "trend"), but every dot must be a REAL, sourced event and it must
// never assert fabricated causation.
export async function connectDots({ apiKey, thesis = "", area = "New Jersey", beat = CGE_BEAT, anchorEvent = "", today = null } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const stamp = today || (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();
  const seed = (thesis || "").trim();
  const anchor = (anchorEvent || "").trim();
  const areaLine = (area || "").trim() || "New Jersey";

  // --- Step 1: gather the dots (grounded) ---
  const searchPrompt = [
    anchor
      ? "You are building a PROBLEM → SOLUTION promo carousel disguised as coverage: surface a real TREND / DEMAND / TENSION with several separate real, dated events (the SETUP), so THE USER'S OWN EVENT can land as the answer to it. Do SEVERAL distinct web searches — not one."
      : "You are building a CONNECT-THE-DOTS evidence carousel — a single THESIS backed by several SEPARATE, REAL, DATED news events. (Model: 'Is the Trump sports curse real? Here's the evidence' → three different games he attended or predicted that went wrong, each its own headline.) Do SEVERAL distinct web searches — not one.",
    "",
    ...(anchor ? [
      `THE EVENT WE'RE ULTIMATELY PROMOTING (the ANSWER — do NOT treat it as a dot, do NOT search for it): ${anchor}`,
      "It may be written loosely — read its genre/theme (the vibe, the music, the crowd) so the trend you hunt is COHERENTLY tied to it.",
      seed
        ? `Gather 3-5 REAL, dated events/signals that prove the TREND OR DEMAND this event answers: "${seed}".`
        : "Figure out the TREND / DEMAND / GAP this event is the answer to — one genuinely connected to its genre, not a stretch — then gather 3-5 REAL, dated events/signals that prove that demand is real and rising.",
      "The dots are the SETUP that makes the reader want exactly what this event offers — they must NOT include or describe the event itself, and every dot should point toward the SAME need the event fills.",
    ] : [
      seed
        ? `THE THESIS / PATTERN to support: "${seed}". Gather 3-5 REAL, dated events that illustrate it.`
        : [
            "No thesis was given — DISCOVER one. Scan CURRENT news for a PATTERN worth a carousel: a claim you",
            "can back with 3-5 real, dated events. Propose ONE thread, then gather its evidence.",
            `BEAT to hunt in: ${beat}`,
            `AREA: ${areaLine}.`,
          ].join("\n"),
    ]),
    ...(stamp ? ["", `TODAY: ${stamp}. Prefer events from the last several months; each must be real and dated.`] : []),
    "",
    "For EACH dot give: WHAT happened, WHERE, WHEN [date], the SOURCE (publication), and one line on HOW IT",
    anchor ? "FEEDS THE DEMAND the event answers." : "CONNECTS to the thesis.",
    "",
    "RULES:",
    "- Every dot MUST trace to a real search result — never invent an event, date, score, or quote.",
    "- The framing may be a playful/observational LENS (a 'curse', a 'moment', a 'trend', a 'takeover'), but",
    "  the events must be TRUE and you must NOT assert fabricated causation — it's a pattern, not a lie.",
    "- If you can't find at least 3 real dots, say so plainly instead of padding.",
    "- Plain-text only, no markdown headers.",
  ].join("\n");

  const searchData = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: searchPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4 },
  }, { model: "gemini-2.5-flash" });
  const brief = (extractResponseText(searchData) || "").trim();
  const sources = extractGroundingSources(searchData);
  if (!brief) return { thesis: seed, cover: null, dots: [], verdict: null, cta: null, sources, brief: "" };

  // --- Step 2: structure into a carousel plan ---
  const planPrompt = [
    anchor
      ? "Turn this research brief into a PROBLEM → SOLUTION promo carousel for a CGE Instagram post: the dots build the demand, and THE EVENT is the answer that brings it home."
      : "Turn this research brief into a CONNECT-THE-DOTS carousel plan for a CGE Instagram post.",
    seed ? `The trend/thesis is: "${seed}".` : "First settle on the trend/thesis the brief best supports.",
    ...(anchor ? [
      `THE EVENT TO PROMOTE (the ANSWER — this is the destination, NOT a dot): ${anchor}`,
      "The event may be written as a loose DESCRIPTION — piece its real details together (name, date, time,",
      "venue, city, @handle, ticket link) and use them exactly; invent nothing that isn't stated.",
      "COHERENCE IS EVERYTHING: the trend and the event must be ONE throughline. The trend you build has to be",
      "genuinely tied to THIS event's genre/theme (a Y2K night → the Y2K-fashion wave, not a random pattern),",
      "so the reveal feels inevitable — 'of course THIS is the answer' — not a bolted-on pivot.",
      "RELEASE VALVE — do NOT force it: if there's no honest trend that truly fits this event, say the",
      "connection is thin and lean on the event's OWN strength instead. A stretched or overstated trend is",
      "worse than none. Keep the dots MODEST so the event still lands as the payoff — the buildup must not",
      "outshine the reveal.",
    ] : []),
    "",
    "Shape it:",
    "- cover: a CLAIM-AS-QUESTION hook. headline = the question ('Is the Y2K revival taking over nightlife?'),",
    "  subtitle = a short 'Here's the evidence' style promise, accentWord = the most charged word in the headline.",
    "- dots: 3-5 items, one per real event/signal, in escalating order. Each = { kicker (1-3 word ALL-CAPS label like",
    "  'EXHIBIT A', 'THE EVIDENCE', 'DOT ONE'), body, whenWhere }. body = SHORT STACKED LINES (one thought per",
    "  line, '\\n' between; a blank '\\n\\n' before the payoff) — what happened + how it fits, ending in ONE line",
    "  wrapped in *asterisks* to bold it. Reported and true; no invented specifics." + (anchor ? " Do NOT put the promoted event here — the dots are only the setup/demand." : ""),
    anchor
      ? "- verdict: THE ANSWER. { kicker (e.g. 'THE ANSWER', 'SO WE'RE DOING IT', 'ENTER'), body (short stacked lines that REVEAL the promoted event as the solution to everything the dots set up — name it, say why it's THE one, end on a *bold* line). This is the turn where coverage becomes promo. }"
      : "- verdict: { kicker (e.g. 'THE VERDICT', 'SO…'), body (short stacked lines — does the pattern hold? what it actually means, honestly; a pattern/observation, not proven causation) }.",
    anchor
      ? "- cta: drive to the event. { kicker (1-3 word pill like 'PULL UP', 'TICKETS', 'THIS SATURDAY'), line (the event name or the date, big and bold), sub (venue + how to get in — date · venue · @handle · link, pulled from the event details above; invent nothing) }."
      : "- cta: { kicker (1-3 word pill), line (a short closing statement), sub (one line inviting a reaction/follow) }.",
    "",
    "BRIEF:",
    brief,
    "",
    'Return ONLY JSON: {"thesis":"...","cover":{"headline":"...","subtitle":"...","accentWord":"..."},"dots":[{"kicker":"...","body":"...","whenWhere":"..."}],"verdict":{"kicker":"...","body":"..."},"cta":{"kicker":"...","line":"...","sub":"..."}}',
  ].join("\n");

  let plan = {};
  try {
    const data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: planPrompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.5 },
    });
    plan = extractJson(extractResponseText(data)) || {};
  } catch { plan = {}; }

  const dots = (Array.isArray(plan.dots) ? plan.dots : [])
    .map(d => ({ kicker: String(d?.kicker || "").trim(), body: String(d?.body || "").trim(), whenWhere: String(d?.whenWhere || "").trim() }))
    .filter(d => d.body);
  return {
    thesis: String(plan.thesis || seed || "").trim(),
    cover: plan.cover ? { headline: String(plan.cover.headline || "").trim(), subtitle: String(plan.cover.subtitle || "").trim(), accentWord: String(plan.cover.accentWord || "").trim() } : null,
    dots,
    verdict: plan.verdict ? { kicker: String(plan.verdict.kicker || "").trim(), body: String(plan.verdict.body || "").trim() } : null,
    cta: plan.cta ? { kicker: String(plan.cta.kicker || "").trim(), line: String(plan.cta.line || "").trim(), sub: String(plan.cta.sub || "").trim() } : null,
    sources, brief,
  };
}

// Map a connectDots() plan into the slide array shape onAccept expects:
// cover → N news dots → a verdict news beat → cta.
export function dotsPlanToSlides(plan) {
  if (!plan) return [];
  const slides = [];
  if (plan.cover) slides.push({ type: "cover", headline: plan.cover.headline, subtitle: plan.cover.subtitle, accentWord: plan.cover.accentWord });
  for (const d of plan.dots || []) {
    slides.push({ type: "news", newsKicker: d.kicker || "THE EVIDENCE", newsHeadline: "", newsBody: d.body, newsBold: false, newsCaption: d.whenWhere || "" });
  }
  if (plan.verdict && plan.verdict.body) {
    slides.push({ type: "news", newsKicker: plan.verdict.kicker || "THE VERDICT", newsHeadline: "", newsBody: plan.verdict.body, newsBold: false });
  }
  if (plan.cta) slides.push({ type: "cta", ctaKicker: plan.cta.kicker || "", ctaDate: plan.cta.line || "", ctaVenue: plan.cta.sub || "", ctaUrl: "" });
  return slides;
}

export async function generateSlideContent({ apiKey, slotType, topic, voice, slotPrompts, count = 3, context, mode }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!slotType) throw new Error("Missing slotType");
  // Topic OR context is enough — when "Build from your carousel" is on, the
  // carousel arrives as context and the subject is inferred from it.
  if ((!topic || !topic.trim()) && (!context || !context.trim())) {
    throw new Error("Add a topic — or turn on 'Build from your carousel' so it can infer one");
  }

  const slotRule = slotPrompts?.[slotType];
  if (!slotRule) throw new Error(`No prompt defined for slot type "${slotType}"`);

  const prompt = buildPrompt({ slotType, topic, voice, slotRule, count, context, mode });

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 1.0,
    },
  });
  const raw = extractResponseText(data);
  if (!raw) throw new Error("Empty response from Gemini");

  const parsed = extractJson(raw);

  const options = Array.isArray(parsed?.options) ? parsed.options : [];
  if (!options.length) throw new Error("Got 0 options back");
  return options;
}

// === HOOK JUDGE (cover) ===
// Second-pass ranker for cover headlines. Generation is creative but noisy —
// some of the N candidates land flat. This asks Gemini to swap the writer hat
// for an editor hat and score each candidate on scroll-stopping power, then
// returns the top `keep` best-first, each annotated with _hookScore (0-100)
// and _hookReason. Low temperature on purpose: we want judgment, not more
// creativity.
export async function rankHooks({ apiKey, topic, candidates, keep = 3, context }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("No candidates to rank");
  const keepN = Math.min(keep, candidates.length);

  const list = candidates.map((c, i) =>
    `#${i}\nheadline: ${(c.headline || "").trim()}\nsubtitle: ${(c.subtitle || "").trim()}`
  ).join("\n\n");

  const prompt = [
    "You are a ruthless social-media editor for CGE, an NJ news-media outlet.",
    "Below are candidate Instagram COVER headlines for the SAME post. Rank them",
    "on SCROLL-STOPPING POWER — would a thumb actually stop on it during a",
    "1.5-second scroll?",
    "",
    `Topic: ${topic?.trim() || "(unspecified)"}`,
    ...((context && context.trim()) ? [
      "",
      "Event facts (judge honesty against these — a hook that overpromises vs.",
      "these facts must score LOW):",
      context.trim(),
    ] : []),
    "",
    "Candidates:",
    "",
    list,
    "",
    "Score each 0-100. REWARD: a real curiosity gap / open loop, a concrete",
    "specific (a number, a named place, a before→after), and an honest hook the",
    "post can actually pay off. NJ / Garden State specificity is a plus. PUNISH:",
    "flyer language ('join us', \"don't miss\"), generic vagueness, and any hook",
    "that lies or overpromises what the post can deliver.",
    "",
    `Return the TOP ${keepN} ONLY, best first, as JSON (no prose, no fences):`,
    `{"ranked":[{"index":<the # of a candidate above>,"score":<0-100>,"reason":"<max 12 words on why it stops the scroll>"}]}`,
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
  });
  const raw = extractResponseText(data);
  if (!raw) throw new Error("Empty response from Gemini");

  const parsed = extractJson(raw);

  const ranked = Array.isArray(parsed?.ranked) ? parsed.ranked : [];
  const out = [];
  const seen = new Set();
  for (const r of ranked) {
    const idx = Number(r?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length || seen.has(idx)) continue;
    seen.add(idx);
    out.push({ ...candidates[idx], _hookScore: Number(r.score) || null, _hookReason: (r.reason || "").trim() });
    if (out.length >= keepN) break;
  }
  // Judge returned nothing usable — fall back to the first keepN raw candidates.
  return out.length ? out : candidates.slice(0, keepN);
}

// Generate cover options, then rank them. Generates `genCount` candidates
// (the cover rule spreads them across hook archetypes), then the hook judge
// trims to the `keep` strongest. Falls back to raw candidates if the judge
// call fails, so a ranker hiccup never blocks generation.
export async function generateRankedCovers({ apiKey, topic, voice, slotPrompts, genCount = 6, keep = 3, context, mode }) {
  const candidates = await generateSlideContent({ apiKey, slotType: "cover", topic, voice, slotPrompts, count: genCount, context, mode });
  if (candidates.length <= keep) return candidates;
  try {
    return await rankHooks({ apiKey, topic, candidates, keep, context });
  } catch (e) {
    if (typeof console !== "undefined") console.warn("Hook ranking failed, showing unranked:", e?.message || e);
    return candidates.slice(0, keep);
  }
}

// AI Template Picker — given a topic + context, ask Gemini which of
// the available Carousel Templates fits best. Returns {templateId,
// reasoning}. Used by AI Fill Template when the user toggles "Let AI
// pick the template" — saves them from having to guess which sequence
// fits their content best.
//
// candidates is an array of { id, name, sequence, intent } drawn from
// BUILTIN_CAROUSEL_TEMPLATES + custom user templates.

// === AI SEQUENCE DESIGNER ===
// Goes beyond pickTemplate (which chooses among fixed templates): this DESIGNS a
// bespoke slide sequence for the specific story — which slot types, in what order,
// for the strongest narrative arc (hook → build → payoff → close). The result
// feeds generateTemplateFill like any other sequence, so it also gets the critic pass.
const ARRANGEABLE_SLOTS = ["cover", "text", "news", "spotlight", "stat", "features", "countdown", "cta", "photo", "poster", "press"];

// Probe the source context for the capability signals each slot type
// in the Slot Doctrine requires. Returns a bag of booleans the
// arranger passes into designSequence and forwards to slotCanBeSupported.
// Kept in aiContent.js (not slotDoctrine.js) because it depends on
// parseContextBullets, extractCitiesFromBullet, and other in-file
// helpers — the doctrine module stays a leaf.
function probeSourceCapabilities(context) {
  const bullets = parseContextBullets(context || "");
  const joined = bullets.join(" ");
  // physicalVenue: any bullet names a NJ city (proxy for "a real
  // place is described here"). Rough but effective — venues in
  // bullets almost always sit inside one of the canonical cities.
  const physicalVenue = bullets.some((b) => extractCitiesFromBullet(b).length > 0)
    || /\b\d{1,5}\s+[A-Z][a-zA-Z]+\s+(?:St|Ave|Blvd|Rd|Ln|Dr|Pkwy|Way|Ct|Pl|Ter|Street|Avenue|Boulevard|Road|Lane|Drive|Parkway)\b\.?/.test(joined);
  // actionableDetail: any bullet contains a date, a time, or a price.
  const actionableDetail = /\$\s*\d[\d,]*(?:\.\d+)?/.test(joined)
    || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i.test(joined)
    || /\b\d{1,2}\s*(?:a|p)\.?m\.?\b/i.test(joined)
    || /\b\d{1,2}:\d{2}\b/.test(joined)
    || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(joined);
  // specificNumber: any bullet contains a numeric fact (price,
  // percentage, count with a unit, or bare 2+ digit integer near a
  // meaningful word).
  const specificNumber = /\$\s*\d[\d,]*(?:\.\d+)?/.test(joined)
    || /\b\d+(?:\.\d+)?\s*%/.test(joined)
    || /\b\d{2,}\s*(?:vendors|venues|clubs|acts|artists|residents|people|attendees|capacity|seats|units|licenses)\b/i.test(joined)
    || /\b1\s*in\s*\d/i.test(joined);
  // framingContext: at least one bullet exists at all (news needs
  // context material to frame from).
  const framingContext = bullets.length >= 1;
  // causalChain: the arranger doesn't know yet whether the spine will
  // produce causalSynthesis — treat as available when there are 2+
  // bullets to relate. The spine step downstream will still produce it.
  const causalChain = bullets.length >= 2;
  return { physicalVenue, actionableDetail, specificNumber, framingContext, causalChain };
}

// Format the capability probe for the arranger prompt. Names which
// slot types the source material can currently support, so Gemini
// doesn't pick a Spotlight when there's no venue to spotlight.
function formatCapabilityBlockForArranger(capabilities, { content = false } = {}) {
  const lines = ["SOURCE CAPABILITY PROBE — what the bullets actually support:"];
  const supportedSlots = [];
  const unsupportedSlots = [];
  const catalog = content ? CONTENT_ESSAY_SLOTS : Object.keys(SLOT_DOCTRINE);
  for (const slotType of catalog) {
    if (slotCanBeSupported(slotType, capabilities)) supportedSlots.push(slotType);
    else unsupportedSlots.push(slotType);
  }
  lines.push(`  - Slot types the source CAN support: ${supportedSlots.join(", ") || "(none)"}`);
  if (content) {
    lines.push(`  - Flyer slots are banned on Content even if the brief names a venue or a number: ${CONTENT_FLYER_SLOTS.join(", ")}`);
  }
  if (unsupportedSlots.length) {
    lines.push(`  - Slot types the source CANNOT currently support (do NOT pick these): ${unsupportedSlots.join(", ")}`);
    for (const s of unsupportedSlots) {
      const desc = SLOT_DOCTRINE[s]?.inputRequirements?.description;
      if (desc) lines.push(`      ${s}: ${desc}`);
    }
  }
  return lines.join("\n");
}

export async function designSequence({ apiKey, topic, context, mode, targetCount = null, letterMode = false }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if ((!topic || !topic.trim()) && (!context || !context.trim())) throw new Error("Add a topic or event details first");
  const capabilities = probeSourceCapabilities(context);
  const contentMode = mode === "content";
  const capabilityBlock = formatCapabilityBlockForArranger(capabilities, { content: contentMode });

  // targetCount: when the user pins a slide count, aim for exactly that (3..12);
  // otherwise let the AI size the arc to the story (up to 10).
  const wantCount = (typeof targetCount === "number" && targetCount > 0)
    ? Math.min(Math.max(Math.round(targetCount), 3), 12)
    : null;
  const countRule = wantCount
    ? `- EXACTLY ${wantCount} slides total (the user asked for this many — hit it: expand the story with more spotlights/beats/stats if you're short, trim the weakest if you're over).`
    : "- 4 to 10 slides total — as many as the story genuinely needs to breathe, and no more. A rich, multi-angle story SHOULD run long; a single beat stays short.";

  const registerLine =
    mode === "promo"
      ? "Register: PROMO — this is CGE's OWN event. More energy, a confident push, real FOMO. Still curated, never a cheap flyer."
      : mode === "story"
        ? "Register: STORY — narrative and human. Lead with people, scenes and stakes; let the facts ride inside the story, not a list."
        : mode === "content"
          ? "Register: CONTENT — cultural infrastructure for Black New Jersey. Events are the door, not the product. Understanding + an archive/directory closer. Never a flyer."
          : "Register: EDITORIAL — restrained newsroom voice. Report it, frame it, don't sell it.";

  const prompt = [
    "You are the art director AND the editor for CGE, a New Jersey Black-culture news-media page.",
    contentMode
      ? "Design the SLIDE SEQUENCE that teaches THIS brief as an essay. Not an Instagram carousel formula."
      : "Design the SLIDE SEQUENCE that tells THIS story best as an Instagram carousel.",
    "",
    ...(contentMode
      ? contentArrangerLines()
      : [
        "THINK LIKE A DIRECTOR, NOT A TEMPLATE-STITCHER. Before you pick any slide type, decide the",
        "READER'S EMOTIONAL JOURNEY:",
        "  1. What should they FEEL in the first 1.5s of the cover? (curiosity / disbelief / pride /",
        "     FOMO / recognition / 'wait, what?')",
        "  2. What unresolved tension yanks them to slide 2 — and how do you DEEPEN it before you",
        "     start paying it off?",
        "  3. How does that feeling ESCALATE through the middle (rising specifics, stakes, or surprise)?",
        "  4. What emotional PAYOFF does the last slide deliver so reaching the end feels earned?",
        "The slide types are just instruments; the arc of FEELING is the composition. Choose each slide",
        "for the beat it creates in that arc, and order them so momentum builds toward the end.",
        "",
        "THE PROVEN SPINE — the same arc Netflix, films, and the best creators run on:",
        "OPEN A LOOP → CREATE TENSION → DELIVER THE PAYOFF. Lay your sequence over this backbone:",
        "  HOOK (cover — open the loop) → PROBLEM / STAKES (why this matters, what's at risk) →",
        "  STORY (the human, scene, or backstory beat) → INSIGHT (the turn — the non-obvious point) →",
        "  FRAMEWORK / SPECIFICS (the concrete how, the what's-actually-there) → PAYOFF (deliver what the",
        "  hook promised) → CTA (end with a clear action). These are the JOBS each slide does, NOT slide-type",
        "  names — map them onto real slide types. You don't need every beat, but the carousel MUST open a",
        "  curiosity loop on the cover, escalate tension through the middle, and pay it off at the end. Never",
        "  resolve the loop early; never end without both the payoff AND the action.",
      ]),
    "",
    ...((topic && topic.trim()) ? [`Topic: ${topic.trim()}`] : []),
    ...(context && context.trim() ? ["", "Event facts:", context.trim()] : []),
    "",
    registerLine,
    ...platformThesisBlock({ mode }),
    ...(mode === "promo" ? [
      "CENTER ON THE EVENT (promo). This carousel is about ONE specific event — it is the hero and the",
      "destination. EVERY slide serves THIS event: its hook, its draws, its concrete specifics (lineup /",
      "what's included / date / venue), its vibe. Favor cover → (a text/news 'why this one' beat) →",
      "spotlight/features for the draws → optionally countdown/stat → a cta that closes on the event's real",
      "date · venue · @handle · link. Do NOT drift into covering OTHER events or an abstract trend — if you",
      "borrow a wider moment, it's only a hook that hands right back to this event. Bring it home.",
    ] : []),
    ...(mode === "story" ? [
      "TELL IT AS A STORY (story). The hero is a PERSON, a MOMENT, or a CHANGE — not logistics. Commit to a",
      "real ARC: open on a scene/person → tension or the turn → payoff → what it MEANS. Every slide is a BEAT,",
      "not a bullet. Favor cover → news/text beats (this is their home) → a quiet closing beat; hold event",
      "logistics (date/venue) until the very end, if at all. NO MANUFACTURED EMOTION — the feeling must be true",
      "to what actually happened; if there's no real emotional beat, tell it plainer rather than faking one.",
    ] : []),
    ...(mode === "editorial" ? [
      "REPORT IT (editorial). The hero is a DEVELOPMENT or a QUESTION; the destination is UNDERSTANDING, not a",
      "sale. Structure: lead (what's happening) → context (how we got here) → significance (why it matters) →",
      "what's next. NO cta pressure, no 'you should go', no selling. Curiosity comes from concrete specifics and",
      "real sourcing, never enthusiasm. This is the natural home for a coverage/evidence arc and web research.",
      "PLAIN TALK: intellectual but relevant. Do the reading. Keep the mechanism. Say what a rule or night",
      "does to a person on a Saturday. No statute numbers, no seminar words, no 'N.J.S.A.'. Smart, not dumbed",
      "down. If you cannot say it at a kitchen table, rewrite it.",
      ...editorialBuildFormulaLines(),
    ] : []),
    ...(mode === "content" ? [
      "WRITE IT AS CONTENT (content). Locate the specimen (who / what / where / when), then name a tension already on the desk.",
      "Do not default to memory, ownership vs programming, or same-city diaspora tension unless the LENS, POV, or an anchor named it.",
      "An event or room may open the piece; it is not the product.",
      `BANNED slot types: ${CONTENT_FLYER_SLOTS.join(", ")}. A venue or a number inside the brief is not permission to pick those slots.`,
      "Prefer: cover → text → text → text → cta. Each text slide is a connecting paragraph, not a manifesto and not a venue card.",
      "The CTA is the NEXT QUESTION the explanation opened. Never RSVP / pull up / this weekend / find your next gathering spot / THE ARCHIVE.",
      "Starting points (THESIS / START / GAP / FRICTION / MECHANISM) are what you explain. Do not peel them into a listicle or a stat.",
      "The COVER names the contrast those starting points already proved (Strip Malls vs Urban Cafes). Never 'discover surprising gathering spots'. Never 'is gone'.",
    ] : []),
    ...(letterMode ? [
      "LETTER MODE is ON — favor a short, flowing, human arc: mostly cover + text + news beats and a",
      "soft closing cta. AVOID rigid multi-cta directories, features grids, and stat/countdown blocks —",
      "they shatter the one-continuous-letter voice. 4-6 slides is usually right.",
    ] : []),
    "",
    // Slot Doctrine capability gate — tell the arranger which slot
    // types the source material can actually deliver on. Prevents the
    // "Spotlight when there are no venues to spotlight" pathology.
    // See slotDoctrine.js for the requirement contracts.
    capabilityBlock,
    "",
    ...(contentMode
      ? [
        "Available slide types (use ONLY these):",
        "- cover: the contrast title + connecting subtitle. ALWAYS slide 1. Do not open a withheld loop.",
        "- text: a SECTION of the essay. Title names the section. Body is a connecting paragraph that explains.",
        "- news: allowed only if it continues the explanation as prose. Not a stacked card. Not 'THE BIGGER PICTURE'.",
        "- cta: the next question the explanation opened. Not an invite. Not a directory.",
      ]
      : [
        "Available slide types (use ONLY these) — pick each for the FEELING it creates:",
        "- cover: the hook. ALWAYS slide 1. Its job is to stop the scroll and open a loop.",
        "- text: a short manifesto/thesis — the 'why this matters', the emotional stakes.",
        "- news: a punchy news-card + photo — short stacked lines that open a loop and land a bold payoff, over",
        "  an image. This is your STRONGEST middle-of-carousel beat: an insider dispatch beat that lands like reporting. PREFER it over",
        "  a plain 'text' slide for any backstory / why-it-matters / breaking / human-context beat. A healthy",
        "  carousel carries 1-3 'news' beats — lean on it, but don't make EVERY slide news (keep some variety).",
        "- spotlight: ONE venue/feature/angle per slide; several in a row build a listicle rhythm.",
        "- stat: one big number + label — a beat of impact or proof.",
        "- features: 3-5 concrete promises — what's actually included (best for a single event with draws).",
        "- countdown: urgency toward a date (T-minus).",
        "- cta: the close — the invite, or a directory listing (one per event in a roundup).",
        "- photo: a recap caption — POST-EVENT recaps only.",
        "- poster: an editorial event FLYER — a giant stacked title with venue, host, an agenda/menu list,",
        "  dress code and date. Use when you're ANNOUNCING one event that has lots of concrete details to lay",
        "  out (a brunch, wellness fair, day party, dinner, mixer). The draw is the EVENT and its specifics.",
        "- press: a music-NIGHT flyer — a one-word brand title + the DJ/artist LINEUP + genre tags + a date bar.",
        "  Reach for it ONLY when the real draw is the LINEUP (who's performing/spinning). If there's no actual",
        "  lineup to name, do NOT use press.",
      ]),
    "",
    "Rules:",
    countRule,
    "- Slide 1 is ALWAYS 'cover'. End on a 'cta'.",
    ...(contentMode
      ? [
        "- Every slide must earn its place by advancing CONTRAST → CAUSE → EXPLAIN → NEXT. No venue cards. No number cards. No padding.",
      ]
      : [
        "- Match the mix to the STORY AND THE FEELING, never a formula: a single event with many draws →",
        "  a few spotlights or a features slide; a multi-event roundup → several ctas; one strong human",
        "  beat → keep it short with text/news. A PRE-event promo must NOT use 'photo'.",
        "- poster vs press is a PURPOSE call, not a coin flip: poster = a details-rich event flyer; press =",
        "  a lineup-driven music night. Pick the one the story actually needs, and don't reach for press just",
        "  because it looks cool — only when there's a genuine lineup.",
        "- VARY YOUR CHOICES. Don't fall back on the same safe shape (cover → text → 3×spotlight → cta) every",
        "  time. When the specific story genuinely fits a less-common slide — a stat beat, a countdown, a news",
        "  card, a poster — use it. Two carousels about different events should look meaningfully different.",
        "- Every slide must earn its place and MOVE THE FEELING FORWARD — no flat, equal-weight lists, no padding.",
      ]),
    ...(contentMode
      ? [
        "- Do not ration explanation. Slide 2 explains the cause. Later slides explain the expressions. The closer asks what that explanation made possible.",
      ]
      : [
        "- RETENTION: if the cover opens a loop, slide 2 DEEPENS it (rule out the obvious), it does NOT",
        "  resolve it. Escalate concrete specifics through the middle; save the single biggest payoff for",
        "  the last content slide; end on a cta that rewards reaching the end.",
      ]),
    "",
    "Return JSON ONLY (no fences, no prose):",
    `{"sequence":["cover","...","cta"],"rationale":"<1-2 sentences naming the emotional arc you built (what the reader feels cover → middle → end) and why this exact sequence delivers it>"}`,
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    // Slightly higher temperature for genuine variety in the arrangement — the
    // low-temp version kept returning the same safe cover/text/spotlight shape.
    generationConfig: { responseMimeType: "application/json", temperature: 0.75 },
  });
  const raw = extractResponseText(data);
  const parsed = extractJson(raw);

  let seq = Array.isArray(parsed?.sequence)
    ? parsed.sequence.map(s => String(s).toLowerCase().trim()).filter(s => ARRANGEABLE_SLOTS.includes(s))
    : [];
  // STRUCTURAL ENFORCEMENT — mathematically verify the arranger's output.
  // Prior versions had partial guards (cover-first, cta-last-or-appended) but
  // no dedupe on multiple ctas OR covers. The arranger at temp 0.75 could —
  // and did — return [cover, news, cta, cta, cta, cta]. Now:
  //   1. Exactly ONE cover at index 0. Strip any duplicates.
  //   2. Exactly ONE cta at the final index. Strip any duplicates.
  //   3. Cap length after dedupe.
  const cap = wantCount || 10;
  // Strip ALL cta and cover slots from the middle; we'll rebuild the shell.
  const middle = seq.filter((s, i) => s !== "cover" && s !== "cta");
  // Reserve 2 slots (cover + cta), fill the middle up to (cap - 2).
  const middleBudget = Math.max(1, cap - 2);
  const middleSliced = middle.slice(0, middleBudget);
  seq = ["cover", ...middleSliced, "cta"];
  // Content / Feature: flyer slots (spotlight, stat, poster…) cannot
  // articulate a brief. Convert every one to text so names stay inside
  // the explanation.
  if (mode === "content") {
    seq = seq.map((slot) => (CONTENT_FLYER_SLOTS.includes(slot) ? "text" : slot));
  }
  if (seq.length < 2) throw new Error("Designed sequence too short");
  // Post-enforcement assertion — should always hold; belt-and-suspenders log.
  const coverCount = seq.filter(s => s === "cover").length;
  const ctaCount = seq.filter(s => s === "cta").length;
  if (coverCount !== 1 || ctaCount !== 1 || seq[0] !== "cover" || seq[seq.length - 1] !== "cta") {
    if (typeof console !== "undefined") {
      console.warn(`Arranger structural check failed post-enforcement: cover=${coverCount} cta=${ctaCount} first=${seq[0]} last=${seq[seq.length - 1]}`);
    }
  }
  return { sequence: seq, rationale: (parsed?.rationale || "").trim() };
}

// Full "AI arranges the carousel" flow: design the sequence, then fill + polish it.
export async function generateArrangedCarousel({
  apiKey, topic, context, voice, slotPrompts, mode, targetCount = null, letterMode = false,
  clusterDirective = "", clusterLabel = "", keywordTrigger = null, voiceParams = null,
  behavioralTags = null, isEvergreen = false, rejectedDrafts = [], approvedDrafts = [],
}) {
  // GST / Pop Culture Detective pipeline is the arranged path now.
  // Stages 1–3 (critical theory → 10-slide storyboard → micro-copy).
  // Promo still wants a flyer-shaped arc — keep the legacy designer there.
  if (mode !== "promo") {
    const gst = await generateGstCarousel({ apiKey, topic, context });
    return {
      slides: gst.slides,
      sequence: gst.sequence,
      originalSequence: gst.originalSequence,
      rationale: gst.rationale,
      compressionEvent: null,
      gst: gst.gst,
    };
  }

  const evergreen = isEvergreen || isContentRegister(mode);
  const prepared = await ensureContentMethodBrief({
    apiKey, topic, context, clusterDirective, clusterLabel, mode, isEvergreen: evergreen,
  });
  const filledContext = prepared.context;
  const design = await designSequence({ apiKey, topic, context: filledContext, mode, targetCount, letterMode });
  const slides = await generateTemplateFill({
    apiKey, sequence: design.sequence, topic, context: filledContext, voice, slotPrompts,
    templateMeta: { name: "AI-arranged carousel", keyMove: design.rationale }, mode, letterMode,
    clusterDirective, clusterLabel, keywordTrigger, voiceParams, behavioralTags,
    isEvergreen, rejectedDrafts, approvedDrafts,
  });
  // Compression honesty: if the writer pipeline compressed the sequence
  // (spine's recommendedSlideCount fired), the rendered slides array is
  // SHORTER than the arranger's original plan. Detect passively and
  // expose the event so the UI can name it instead of showing a stale
  // pre-compression rationale. This fixes the "sequence says 7, we
  // rendered 5" phantom-slot honesty bug.
  const renderedLen = Array.isArray(slides) ? slides.length : 0;
  const originalLen = Array.isArray(design.sequence) ? design.sequence.length : 0;
  const compressionEvent = (renderedLen > 0 && originalLen > renderedLen) ? {
    from: originalLen,
    to: renderedLen,
    reason: "spine.recommendedSlideCount",
    droppedSlots: design.sequence.slice(renderedLen),
  } : null;
  // Return the ACTUAL rendered sequence, not the arranger's original,
  // so downstream consumers (preview grid, rationale display) match
  // the slides they're rendering. originalSequence is preserved so the
  // banner can name what was cut.
  const renderedSequence = compressionEvent
    ? design.sequence.slice(0, renderedLen)
    : design.sequence;
  return {
    slides,
    sequence: renderedSequence,
    originalSequence: design.sequence,
    rationale: design.rationale,
    compressionEvent,
  };
}

export async function pickTemplate({ apiKey, topic, context, candidates }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("No candidate templates");
  if (!topic || !topic.trim()) throw new Error("Missing topic");

  // Built-in templates carry rich metadata (audience/tone/bestFor/notFor/
  // keyMove). Custom user templates only have name + sequence. Format
  // both into a uniform block so Gemini can compare like-with-like.
  const list = candidates.map(t => formatTemplateForPicker(t)).join("\n\n─────\n\n");

  const prompt = [
    "You are picking the best carousel template for a CGE Instagram post.",
    "CGE = Central Group Events, a cultural infrastructure platform for Black New Jersey.",
    "Events are the door into the conversation, not the product. If the topic is a Feature /",
    "cultural thesis (memory, ownership, diaspora, lineage) prefer Editorial Insight —",
    "NEVER Feature Drop (selling-points flyer) and NEVER Local Guide (a cafe directory).",
    "",
    `Topic: ${topic.trim()}`,
    "",
    ...(context && context.trim() ? [
      "Context (what the carousel covers):",
      context.trim(),
      "",
    ] : []),
    "Available templates (with audience, tone, and when each fits):",
    "",
    list,
    "",
    "Pick the ONE template whose audience + bestFor + keyMove best fits the topic + context.",
    "Pay attention to the 'NOT for' line on each — that's the disqualifier.",
    "",
    "Return JSON ONLY:",
    `{"templateId":"<one of the ids above>","reasoning":"<1 sentence explaining the pick, citing the matching audience/bestFor/keyMove>"}`,
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });
  const raw = extractResponseText(data);
  if (!raw) throw new Error("Empty response from Gemini");

  const parsed = extractJson(raw);

  const templateId = parsed?.templateId;
  if (!templateId) throw new Error("Gemini did not return a templateId");

  // Validate that the picked id actually exists in candidates
  const match = candidates.find(c => c.id === templateId);
  if (!match) throw new Error(`Gemini picked unknown templateId "${templateId}"`);

  return { templateId, reasoning: parsed.reasoning || "", template: match };
}

// === SCAFFOLDING LABEL SANITIZER ===
// Post-generation belt-and-suspenders for PR #147's ANTI-LITERALISM prompt
// rule. Even with the prompt begging the model not to write internal outline
// labels as visible copy, the occasional "THE MECHANISM" or "THE PARADOX:"
// still leaks into a headline or kicker field. This regex pass strips those
// labels from a targeted set of TITLE-shaped fields before the slides
// reach the UI, so an operator never sees "THE PARADOX" rendered.
//
// Applies ONLY to title / label / kicker fields (not body copy — body text
// legitimately might use the words "paradox" or "friction" in a sentence).
// Also skips fields that just happen to CONTAIN a beat label as part of a
// longer phrase — only strips when the field IS the label (or the label +
// a trailing colon / dash).
const SCAFFOLDING_LABEL_PATTERN = /^\s*(?:the\s+)?(paradox|friction|mechanism|gate|thesis|beat|specimen|pattern|join|door|remnant|contrast|cause|explain|next)\s*[:\-–—]?\s*$/i;
const SCAFFOLDING_PREFIX_PATTERN = /^\s*(?:the\s+)?(paradox|friction|mechanism|gate|thesis|beat|specimen|pattern|join|door|remnant|contrast|cause|explain|next)\s*[:\-–—]\s*/i;
const TITLE_FIELDS = new Set([
  "headline", "textTitle", "spotName", "kicker", "ctaKicker", "statLabel",
  "newsHeadline", "newsKicker", "accentWord", "pressTitle", "pressBadge",
  "countEvent", "countCta", "spotTime", "spotPrice", "spotCta", "title",
  "topLine", "featuresTitle",
]);
function sanitizeScaffoldingLabels(slides) {
  if (!Array.isArray(slides)) return slides;
  let stripped = 0;
  const cleaned = slides.map((slide) => {
    if (!slide || typeof slide !== "object") return slide;
    const next = { ...slide };
    for (const field of TITLE_FIELDS) {
      const val = next[field];
      if (typeof val !== "string" || !val) continue;
      // Whole-field-is-a-label case: replace with empty string so the
      // UI falls back to whatever its default rendering is (rather than
      // showing the scaffolding word as if it were the title).
      if (SCAFFOLDING_LABEL_PATTERN.test(val)) {
        next[field] = "";
        stripped++;
        continue;
      }
      // Prefix case: "The Mechanism: Newark's Portuguese social clubs..."
      // → "Newark's Portuguese social clubs..."
      const withoutPrefix = val.replace(SCAFFOLDING_PREFIX_PATTERN, "");
      if (withoutPrefix !== val) {
        next[field] = withoutPrefix.trim();
        stripped++;
      }
    }
    // Also scan features[].headline recursively.
    if (Array.isArray(next.features)) {
      next.features = next.features.map((f) => {
        if (!f || typeof f !== "object" || typeof f.headline !== "string") return f;
        if (SCAFFOLDING_LABEL_PATTERN.test(f.headline)) {
          stripped++;
          return { ...f, headline: "" };
        }
        const cleanedHead = f.headline.replace(SCAFFOLDING_PREFIX_PATTERN, "").trim();
        if (cleanedHead !== f.headline) {
          stripped++;
          return { ...f, headline: cleanedHead };
        }
        return f;
      });
    }
    return next;
  });
  if (stripped && typeof console !== "undefined") {
    console.warn(`sanitizeScaffoldingLabels: stripped ${stripped} scaffolding-label leak(s) from title fields.`);
  }
  return cleaned;
}

// === PHANTOM ENTITY DETECTOR ===
// Extract Capitalized 2+word proper nouns from each slide's text fields,
// check against a whitelist built from the context bullets + a small
// common-NJ allowlist. Anything unmatched attaches as a warning on the
// slide (never scrubbed — auto-scrub would leave broken sentences).
// The UI reads slide._warnings and shows a red badge so the operator
// can REDO the specific slide.
const COMMON_ENTITY_ALLOWLIST = new Set([
  // Geographic (broadly used in CGE content)
  "new jersey", "new york", "nj", "ny", "nyc", "new brunswick",
  "north jersey", "central jersey", "south jersey", "the shore", "jersey shore",
  "route 1", "route 22", "route 78", "route 1 corridor",
  // Transit
  "path", "njt", "nj transit", "port authority",
  // Time / day words that might read as proper nouns
  "friday", "saturday", "sunday", "monday", "tuesday", "wednesday", "thursday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  // Brand / operator terms
  "central group events", "cge", "instagram", "spotify", "eventbrite",
]);
// Extract proper nouns from prose text. Three refinements over the naive
// pass:
//   1. Split on sentence + line boundaries FIRST, so a matched run can
//      never span a period, "!", "?", or newline. This fixes the
//      "THE HIGH BRIDGE SHIFT Seven" false positive where a kicker's
//      trailing word merged with the next sentence's opening word.
//   2. Reject 100%-uppercase runs. LLMs writing a fake venue produce
//      "Tokyo Listening Room" (Title Case), never "TOKYO LISTENING ROOM"
//      — an all-caps run is stylistic formatting, not a hallucinated
//      entity. This is the biggest false-positive killer.
//   3. Within each sentence, ignore the first word: sentence-initial
//      capitalization is grammar, not proper-noun signal ("Seven" at
//      the start of a sentence looked like an entity under the old rule).
function extractProperNouns(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  // Split on sentence terminators (. ! ?) AND newlines so a run can't
  // cross either boundary. Keep the split cheap — this runs per slide.
  const segments = text.split(/[.!?\n\r]+/);
  const runRe = /\b[A-Z][a-zA-Z0-9']*(?:\s+(?:[A-Z][a-zA-Z0-9']*|of|the|de|la|le|and|&|at|on|for)){1,4}\b/g;
  const out = [];
  for (const rawSeg of segments) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    // Drop the FIRST word of the segment before matching — a
    // capitalized sentence-opener is grammar, not entity signal.
    // We strip it by advancing past the first whitespace, so the
    // remaining span still contains any true multi-word entity.
    const firstWs = seg.search(/\s/);
    const trimmedSeg = firstWs === -1 ? "" : seg.slice(firstWs + 1);
    if (!trimmedSeg) continue;
    const matches = trimmedSeg.match(runRe) || [];
    for (const m of matches) {
      const clean = m.trim();
      if (clean.length < 4) continue;
      // 100%-uppercase run → stylistic (KICKER, THE HIGH BRIDGE SHIFT).
      // Anything with even one lowercase letter is a real proper-noun
      // candidate ("Tokyo Listening Room").
      if (clean === clean.toUpperCase()) continue;
      out.push(clean);
    }
  }
  return out;
}
// Only scan the prose fields where a hallucinated venue would actually
// hide. Headline + kicker rely on capitalization + all-caps for
// stylistic impact and were the source of the "TOKYO SESSIONS" style
// false positives. Everything else is either data (dates, prices),
// scaffolding (labels, section headers), or CTA text — none of which
// carries the kind of proper-noun claim the operator needs to vet.
const PHANTOM_SCAN_FIELDS = ["textBody", "spotMeta"];
function extractPhantomScanText(slide) {
  if (!slide || typeof slide !== "object") return "";
  const parts = [];
  for (const field of PHANTOM_SCAN_FIELDS) {
    const v = slide[field];
    if (typeof v === "string" && v) parts.push(v);
  }
  return parts.join("\n");
}
function detectPhantomEntities(slides, contextText, historicalText, sequence = []) {
  if (!Array.isArray(slides) || !slides.length) return slides;
  // Build whitelist from context bullets + historical bullets + common allowlist.
  const contextNouns = new Set([
    ...extractProperNouns(String(contextText || "")).map(n => n.toLowerCase()),
    ...(Array.isArray(historicalText) ? historicalText : [historicalText])
      .flatMap(t => extractProperNouns(String(t || "")))
      .map(n => n.toLowerCase()),
    ...COMMON_ENTITY_ALLOWLIST,
  ]);
  return slides.map((slide, i) => {
    // Skip CTA slots entirely — they're stitched from the keyword
    // trigger or a fixed template, not free prose, so any proper-noun
    // appearance is intentional.
    const slotType = String(sequence?.[i] || slide?.type || "").toLowerCase();
    if (slotType === "cta") return slide;
    const slideText = extractPhantomScanText(slide);
    const slideNouns = extractProperNouns(slideText);
    const phantoms = [];
    for (const n of slideNouns) {
      const nLower = n.toLowerCase();
      // Substring match: if any whitelisted noun contains our slide noun,
      // or our slide noun contains a whitelisted noun, it's considered a
      // match (handles "Chamber 43" vs "Chamber 43 on Main St." etc).
      let matched = false;
      for (const w of contextNouns) {
        if (w.includes(nLower) || nLower.includes(w)) { matched = true; break; }
      }
      if (!matched) phantoms.push(n);
    }
    if (!phantoms.length) return slide;
    const dedupedPhantoms = Array.from(new Set(phantoms));
    if (typeof console !== "undefined") {
      console.warn(`Phantom entity on slide ${i + 1}: ${dedupedPhantoms.map(p => `"${p}"`).join(", ")}`);
    }
    const existingWarnings = Array.isArray(slide._warnings) ? slide._warnings : [];
    return {
      ...slide,
      _warnings: [
        ...existingWarnings,
        { type: "phantom_entity", entities: dedupedPhantoms, message: `Unverified entity detected: ${dedupedPhantoms.join(", ")}. Not present in the supplied context.` },
      ],
    };
  });
}

// === ATOMICITY DETECTOR ===
// Flag single fields that stack multiple discrete facts. Signature: more
// than two `·` or `|` separators, OR more than one date pattern, OR both
// an address and a date pattern jammed into one field. The Metuchen +
// Aug 7 + address + Album Club + Crossroads example maps here.
const DATE_PATTERN_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+\d{1,2}\b/gi;
const SLASH_DATE_RE = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
const ADDRESS_HINT_RE = /\b\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\s+(?:St|Ave|Blvd|Rd|Ln|Dr|Pkwy|Way|Ct|Pl|Ter)\b\.?/g;
const FIELDS_TO_CHECK_ATOMICITY = new Set([
  "spotMeta", "spotCta", "subtitle", "textBody", "statSub", "caption",
  "captionSecondary", "pressLineup", "pressGenres", "countText",
]);
function detectAtomicityViolations(slides) {
  if (!Array.isArray(slides)) return slides;
  return slides.map((slide, i) => {
    if (!slide || typeof slide !== "object") return slide;
    const violations = [];
    for (const field of FIELDS_TO_CHECK_ATOMICITY) {
      const val = slide[field];
      if (typeof val !== "string" || !val) continue;
      const sepCount = (val.match(/[·|]/g) || []).length;
      const dateMatches = (val.match(DATE_PATTERN_RE) || []).length + (val.match(SLASH_DATE_RE) || []).length;
      const addressMatches = (val.match(ADDRESS_HINT_RE) || []).length;
      if (sepCount > 2 || dateMatches > 1 || (addressMatches >= 1 && dateMatches >= 1 && sepCount >= 1)) {
        violations.push({ field, sepCount, dateMatches, addressMatches, sample: val.slice(0, 120) });
      }
    }
    if (!violations.length) return slide;
    if (typeof console !== "undefined") {
      console.warn(`Atomicity violation on slide ${i + 1}:`, violations.map(v => `${v.field} (${v.sepCount} separators, ${v.dateMatches} dates)`).join("; "));
    }
    const existingWarnings = Array.isArray(slide._warnings) ? slide._warnings : [];
    return {
      ...slide,
      _warnings: [
        ...existingWarnings,
        { type: "atomicity_violation", violations, message: `Data-dump detected in ${violations.map(v => v.field).join(", ")} — multiple facts stacked in one field.` },
      ],
    };
  });
}

// === SLOT DOCTRINE VIOLATION DETECTOR ===
// Reads SLOT_ANTIPATTERN_TOKENS from slotDoctrine.js and flags any
// returned slide whose field content matches a banned pattern for its
// slot type. Attaches a `slot_doctrine_violation` warning per hit so
// the UI renders the same red badge treatment as the other detectors.
//
// This is the belt-and-suspenders side of the doctrine — the writer
// prompt now shows the reader-job spec on every slot, so most
// violations should be pre-empted. This detector catches the ones
// that slip through.
function detectSlotDoctrineViolations(slides, sequence = []) {
  if (!Array.isArray(slides) || !slides.length) return slides;
  return slides.map((slide, i) => {
    const slotType = String(sequence?.[i] || slide?.type || "").toLowerCase();
    if (!slotType) return slide;
    const patterns = SLOT_ANTIPATTERN_TOKENS[slotType];
    if (!patterns || !patterns.length) return slide;
    const violations = [];
    for (const p of patterns) {
      const val = slide?.[p.field];
      if (typeof val !== "string" || !val) continue;
      if (p.re.test(val)) {
        violations.push({ field: p.field, message: p.message, sample: val.slice(0, 120) });
      }
    }
    if (!violations.length) return slide;
    if (typeof console !== "undefined") {
      console.warn(`Slot doctrine violation on slide ${i + 1} (${slotType}):`, violations.map(v => `${v.field}: ${v.message}`).join("; "));
    }
    const existingWarnings = Array.isArray(slide._warnings) ? slide._warnings : [];
    return {
      ...slide,
      _warnings: [
        ...existingWarnings,
        {
          type: "slot_doctrine_violation",
          slotType,
          violations,
          message: `Slot doctrine violation on ${slotType}: ${violations.map(v => v.message).join(" · ")}`,
        },
      ],
    };
  });
}

// === GEOGRAPHIC CITY EXTRACTION ===
// Small canonical set of NJ cities operators commonly write about.
// Used by the geographic-grouping spine directive and the whiplash
// detector below. Case-insensitive matching, whole-word boundaries,
// multi-word cities allowed. Extend this set as the beat map grows.
// === VENUE TYPE TAGGER ===
// Lightweight regex tagger for the spine's Typology Diversity rule.
// Maps a bullet's text to a venue-type label so the spine can enforce
// spread across types before doubling. The failure this fixes: three
// bullets covering brewery + cafe + cafe get proof-assigned as
// cafe + cafe, dropping the brewery entirely and collapsing the
// day-to-night ecosystem the POV promised.
//
// Order matters — first match wins. More specific patterns go first
// (kafe/café before restaurant, brewery before bar).
const VENUE_TYPE_PATTERNS = [
  { type: "brewery", re: /\b(brewery|brewing|taproom|beer garden)\b/i },
  { type: "cafe", re: /\b(cafe|café|coffee|kafe|espresso|roastery|roaster)\b/i },
  { type: "lounge", re: /\b(lounge|speakeasy|cocktail bar|listening bar|night ?club|dive bar)\b/i },
  { type: "bar", re: /\b(bar|pub|tavern|beer hall|wine bar)\b/i },
  { type: "restaurant", re: /\b(restaurant|kitchen|diner|eatery|bistro|osteria|trattoria)\b/i },
  { type: "hall", re: /\b(hall|ballroom|theater|theatre|auditorium|amphitheater|amphitheatre|arena|opera)\b/i },
  { type: "park", re: /\b(park|garden|commons|plaza|square|greenway|waterfront|boardwalk|beach)\b/i },
  { type: "venue", re: /\b(venue|club|room|space|studio|warehouse|loft)\b/i },
  { type: "market", re: /\b(market|farmer'?s market|food hall|marketplace|bazaar)\b/i },
  { type: "transit", re: /\b(station|stop|junction|terminal|light rail|subway)\b/i },
  { type: "shop", re: /\b(shop|store|boutique|record shop|bookstore|bookshop|barber)\b/i },
  { type: "religious", re: /\b(church|synagogue|mosque|temple|masjid|gurudwara)\b/i },
];
function tagBulletVenueType(bullet) {
  if (typeof bullet !== "string" || !bullet.trim()) return "generic";
  for (const { type, re } of VENUE_TYPE_PATTERNS) {
    if (re.test(bullet)) return type;
  }
  return "generic";
}
// Return { typeCounts: {brewery: 1, cafe: 2, ...}, taggedBullets: [{bullet, type}, ...] }
// for a corpus of bullets. Used by the spine prompt to enforce
// typology diversity when proof bullets span distinct venue types.
function analyzeBulletTypology(bullets) {
  const typeCounts = {};
  const taggedBullets = [];
  for (const b of bullets) {
    const type = tagBulletVenueType(b);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    taggedBullets.push({ bullet: b, type });
  }
  return { typeCounts, taggedBullets };
}

const NJ_CITIES = [
  // Urban / Commuter Core (Essex · Hudson · Union)
  "Newark", "Jersey City", "Hoboken", "Bayonne", "Union City", "West New York",
  "Elizabeth", "Kearny", "Weehawken",
  // Route 1 Central Crossroads (Middlesex · Somerset · Mercer)
  "New Brunswick", "Princeton", "Trenton", "Somerville", "Perth Amboy",
  "Edison", "Metuchen", "Rahway", "Highland Park", "South Brunswick",
  // Transit Village Suburbs (mostly Essex + Union suburbs)
  "Montclair", "Bloomfield", "Maplewood", "South Orange", "West Orange",
  "East Orange", "Cranford", "Summit", "Millburn", "Westfield",
  // Shore / Southern Arteries
  "Asbury Park", "Long Branch", "Red Bank", "Ocean Grove", "Belmar",
  "Bradley Beach", "Point Pleasant", "Manasquan", "Ocean City",
  // South Jersey (Decentralized Borderlands + South)
  "Camden", "Atlantic City", "Cherry Hill", "Collingswood", "Hammonton",
];

// Which corridor group(s) each city belongs to. Fuzzy — most NJ towns
// legitimately fit multiple corridors (Newark has train stations AND
// is the urban core; Princeton is Route 1 AND a walkable transit-
// village town; Metuchen sits on Route 1 AND has a station operators
// treat as transit-village). The transition detector reads these as
// SETS and only flags a cross-corridor jump when TWO adjacent cities
// have ZERO overlap in their tag sets. That way Metuchen→Princeton
// (both share route-1 + transit-suburbs) doesn't false-fire, but
// Newark→Asbury Park (urban-core only vs shore only) still does.
const NJ_CITY_CORRIDOR = {
  // Urban / Commuter Core — several also legit as transit-suburbs
  // because their PATH/rail stops carry the same commuter-village feel.
  "Newark": ["urban-core", "transit-suburbs"],
  "Jersey City": ["urban-core", "transit-suburbs"],
  "Hoboken": ["urban-core", "transit-suburbs"],
  "Bayonne": ["urban-core"],
  "Union City": ["urban-core"],
  "West New York": ["urban-core"],
  "Elizabeth": ["urban-core", "transit-suburbs"],
  "Kearny": ["urban-core"],
  "Weehawken": ["urban-core"],
  // Route 1 Central Crossroads — the walkable ones also legit as
  // transit-suburbs (Princeton, Metuchen, New Brunswick, Highland Park).
  "New Brunswick": ["route-1", "transit-suburbs"],
  "Princeton": ["route-1", "transit-suburbs"],
  "Trenton": ["route-1"],
  "Somerville": ["route-1", "transit-suburbs"],
  "Perth Amboy": ["route-1"],
  "Edison": ["route-1"],
  "Metuchen": ["route-1", "transit-suburbs"],
  "Rahway": ["route-1", "transit-suburbs"],
  "Highland Park": ["route-1", "transit-suburbs"],
  "South Brunswick": ["route-1"],
  // Transit Village Suburbs (Essex/Union spine) — most legit as urban-
  // adjacent too because they run on Newark/NYC commutes.
  "Montclair": ["transit-suburbs"],
  "Bloomfield": ["transit-suburbs"],
  "Maplewood": ["transit-suburbs"],
  "South Orange": ["transit-suburbs"],
  "West Orange": ["transit-suburbs"],
  "East Orange": ["transit-suburbs", "urban-core"],
  "Cranford": ["transit-suburbs"],
  "Summit": ["transit-suburbs"],
  "Millburn": ["transit-suburbs"],
  "Westfield": ["transit-suburbs"],
  // Shore
  "Asbury Park": ["shore"],
  "Long Branch": ["shore"],
  "Red Bank": ["shore"],
  "Ocean Grove": ["shore"],
  "Belmar": ["shore"],
  "Bradley Beach": ["shore"],
  "Point Pleasant": ["shore"],
  "Manasquan": ["shore"],
  "Ocean City": ["shore"],
  // South
  "Camden": ["south", "urban-core"],
  "Atlantic City": ["south", "shore"],
  "Cherry Hill": ["south"],
  "Collingswood": ["south"],
  "Hammonton": ["south"],
};
// Compile once — startsWith / whole-word regex per city, in a single
// pass so extractCitiesFromBullet stays O(cities) per bullet.
const NJ_CITY_MATCHERS = NJ_CITIES.map(name => ({
  name,
  re: new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
}));
function extractCitiesFromBullet(bullet) {
  if (typeof bullet !== "string" || !bullet.trim()) return [];
  const found = new Set();
  for (const { name, re } of NJ_CITY_MATCHERS) {
    if (re.test(bullet)) found.add(name);
  }
  return [...found];
}
// For a slide's scan text, return the SET of cities named in it.
// Used by detectGeographicWhiplash to compare adjacent slides.
function extractCitiesFromText(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  const found = new Set();
  for (const { name, re } of NJ_CITY_MATCHERS) {
    if (re.test(text)) found.add(name);
  }
  return [...found];
}

// === GEOGRAPHIC WHIPLASH DETECTOR ===
// Flags carousels that ping-pong between cities: Slide 2 = Newark,
// Slide 3 = Asbury Park, Slide 4 = Newark. Reader gets thrown around
// the state instead of following a coherent geographic arc.
//
// Algorithm:
//   1. Extract cities named in each slide's scan text (textBody +
//      spotMeta only — headline/kicker often carry stylized capitals
//      that don't count as geographic claims).
//   2. If the sequence of primary cities alternates (A → B → A over
//      3+ slides), that's whiplash — flag the middle slide.
//   3. CTA slots skipped by position.
//
// Attaches a `geographic_whiplash` warning on the offending slide.
function detectGeographicWhiplash(slides, sequence = []) {
  if (!Array.isArray(slides) || slides.length < 2) return slides;
  // Build a per-slide primary city (the first city found in scan
  // text, or null). Multiple cities on one slide → still whiplash if
  // the primary one alternates.
  const slideCities = slides.map((slide, i) => {
    const slotType = String(sequence?.[i] || slide?.type || "").toLowerCase();
    if (slotType === "cta") return null;
    const scanText = extractPhantomScanText(slide);
    const cities = extractCitiesFromText(scanText);
    return cities[0] || null;
  });
  // Per-slide slot type — used to decide whether a slide can act as a
  // BRIDGE (news/text with no city named counts as a corridor bridge).
  const slotTypes = slides.map((slide, i) => String(sequence?.[i] || slide?.type || "").toLowerCase());
  return slides.map((slide, i) => {
    const existingWarnings = Array.isArray(slide._warnings) ? slide._warnings : [];
    const warnings = [];

    // Pattern 1 — ping-pong A → B → A across 3 consecutive slides.
    if (i > 0 && i < slides.length - 1) {
      const prev = slideCities[i - 1];
      const curr = slideCities[i];
      const next = slideCities[i + 1];
      if (prev && curr && next && prev === next && curr !== prev) {
        warnings.push({
          type: "geographic_whiplash",
          pattern: `${prev} → ${curr} → ${next}`,
          message: `Geographic whiplash: slide ${i} is ${prev}, this slide is ${curr}, slide ${i + 2} jumps back to ${prev}. Group same-city slides adjacent — don't teleport the reader across the state.`,
        });
      }
    }

    // Pattern 2 — one-way cross-corridor jump without a bridge.
    // Fires on the SECOND of two adjacent content slides whose cities
    // sit in different corridor groups (urban-core / route-1 /
    // transit-suburbs / shore / south) and there's no bridge slide
    // (news/text with no city) between them. This is the Montclair →
    // Hoboken failure the operator flagged.
    if (i > 0) {
      const prev = slideCities[i - 1];
      const curr = slideCities[i];
      if (prev && curr && prev !== curr) {
        const prevGroups = NJ_CITY_CORRIDOR[prev];
        const currGroups = NJ_CITY_CORRIDOR[curr];
        // Fuzzy check — cities can legitimately belong to multiple
        // corridor groups. Only flag when the TWO cities share ZERO
        // groups in common (a true corridor jump), not when they
        // happen to have different PRIMARY tags but share a secondary.
        if (Array.isArray(prevGroups) && Array.isArray(currGroups) && prevGroups.length && currGroups.length) {
          const overlap = prevGroups.some((g) => currGroups.includes(g));
          if (!overlap) {
            const prevType = slotTypes[i - 1];
            const currType = slotTypes[i];
            const isContentPair = ["spotlight", "text", "stat", "features"].includes(prevType)
              && ["spotlight", "text", "stat", "features"].includes(currType);
            if (isContentPair) {
              warnings.push({
                type: "geographic_transition",
                pattern: `${prev} (${prevGroups.join("+")}) → ${curr} (${currGroups.join("+")})`,
                message: `Cross-corridor jump: slide ${i} is ${prev} (${prevGroups.join("/")}), this slide is ${curr} (${currGroups.join("/")}). Zero corridor overlap. Consider inserting a news/text bridge slide between them so the reader isn't teleported across corridors without transitional cue.`,
              });
            }
          }
        }
      }
    }

    if (!warnings.length) return slide;
    if (typeof console !== "undefined") {
      for (const w of warnings) console.warn(`Slide ${i + 1}: ${w.message}`);
    }
    return { ...slide, _warnings: [...existingWarnings, ...warnings] };
  });
}

// === CROSS-CONTAMINATION DETECTOR ===
// Geographic Whiplash guard. When the spine's proofAssignments map
// bullet A → slide X, any proper-noun venue named in bullet A must NOT
// appear in the text body of slide Y (which was assigned bullet B).
// Prevents "Newark venues bleeding into Asbury Park slides" — the
// specific failure mode the operator called Cross-Contamination.
//
// Algorithm:
//   1. For each proof-assigned bullet, extract its proper-noun entities
//      (using the same regex + all-caps + first-word-of-sentence
//      filters as the phantom detector, so the two never disagree).
//   2. For each slide, look up which bullet SHOULD have contaminated it
//      (the one proofAssignments maps to this slide index).
//   3. If any OTHER bullet's proper nouns appear in this slide's
//      scan text (textBody + spotMeta), attach a warning naming which
//      bullet leaked into which slide.
//
// Attached warnings — the UI reads slide._warnings and renders the
// same red badge treatment as phantom-entity + atomicity findings.
function detectCrossContamination(slides, narrativeSpine, contextText, sequence = []) {
  if (!Array.isArray(slides) || !slides.length) return slides;
  if (!narrativeSpine || !narrativeSpine.proofAssignments) return slides;
  const proofAssignments = narrativeSpine.proofAssignments || {};
  const bulletKeys = Object.keys(proofAssignments).filter(k => k && typeof k === "string");
  if (!bulletKeys.length) return slides;

  // Build the source bullet text corpus so we can map each key back
  // to its full bullet text (proofAssignment keys are the first 60
  // chars of the bullet — we match by prefix).
  const contextBullets = parseContextBullets(String(contextText || ""));
  const bulletByKey = {};
  for (const key of bulletKeys) {
    const keyLower = key.toLowerCase();
    const match = contextBullets.find(b => String(b).toLowerCase().startsWith(keyLower));
    bulletByKey[key] = match || key; // fall back to the key itself if no match
  }
  // Extract each bullet's proper nouns once, up front.
  const nounsByKey = {};
  for (const key of bulletKeys) {
    nounsByKey[key] = extractProperNouns(bulletByKey[key]).map(n => n.toLowerCase());
  }
  // Invert proofAssignments: for a given slide index, which bullet key
  // is its assigned proof? Slide numbers in proofAssignments are 1-based.
  const bulletByAssignedSlide = {};
  for (const [bkey, slotRaw] of Object.entries(proofAssignments)) {
    const slot = Number(slotRaw);
    if (Number.isInteger(slot) && slot >= 1 && slot <= slides.length) {
      bulletByAssignedSlide[slot] = bkey;
    }
  }
  return slides.map((slide, i) => {
    // CTA slots don't carry proof bullets — skip.
    const slotType = String(sequence?.[i] || slide?.type || "").toLowerCase();
    if (slotType === "cta") return slide;
    const slideText = extractPhantomScanText(slide).toLowerCase();
    if (!slideText) return slide;
    const assignedBulletKey = bulletByAssignedSlide[i + 1] || null;
    const contaminations = [];
    for (const key of bulletKeys) {
      if (key === assignedBulletKey) continue;
      const nouns = nounsByKey[key] || [];
      for (const noun of nouns) {
        if (noun.length < 4) continue;
        if (slideText.includes(noun)) {
          contaminations.push({ leakedFrom: bulletByKey[key].slice(0, 80), entity: noun });
        }
      }
    }
    if (!contaminations.length) return slide;
    // De-dupe on entity string so the same leaked noun only flags once
    // per slide.
    const dedup = [];
    const seen = new Set();
    for (const c of contaminations) {
      if (seen.has(c.entity)) continue;
      seen.add(c.entity);
      dedup.push(c);
    }
    if (typeof console !== "undefined") {
      console.warn(`Cross-contamination on slide ${i + 1}:`, dedup.map(c => `"${c.entity}" leaked from bullet "${c.leakedFrom.slice(0, 40)}…"`).join("; "));
    }
    const existingWarnings = Array.isArray(slide._warnings) ? slide._warnings : [];
    return {
      ...slide,
      _warnings: [
        ...existingWarnings,
        {
          type: "cross_contamination",
          contaminations: dedup,
          message: `Cross-Contamination Detected: ${dedup.map(c => `"${c.entity}"`).join(", ")} appears here but was assigned to a different slide. Rewrite or REDO to keep 1:1 bullet routing.`,
        },
      ],
    };
  });
}

// === RESPONSE SCHEMA (Gemini Structured Outputs) ===
// Enforces field length caps at the API's token-generation layer, not at
// the prompt layer. maxLength stops the model mid-generation before it
// can emit two sentences into a headline field.
//
// PR #148 shipped a schema that enumerated EVERY possible field across
// every slot type — 40+ fields, each with a maxLength constraint.
// Gemini's structured-output constraint compiler counts states-per-
// constraint and rejected the schema with "too many states for serving".
// Fix: adapt the schema to the CURRENT sequence — only include fields
// for the slot types that actually appear. A typical carousel touches
// 4-6 slot types → ~15 fields → well under Gemini's state cap.
//
// Falls back to no schema if Gemini rejects even the compact one — see
// the try/catch in generateTemplateFill.
const FIELDS_BY_SLOT = {
  cover:     { headline: 60, subtitle: 200, accentWord: 25 },
  text:      { textTitle: 60, textBody: 400 },
  spotlight: { spotName: 60, spotMeta: 120, spotTime: 30, spotPrice: 30, spotCta: 40 },
  cta:       { ctaKicker: 30, ctaDate: 100, ctaVenue: 220, ctaUrl: 100 },
  stat:      { statNumber: 30, statLabel: 60, statSub: 200 },
  news:      { newsKicker: 30, newsHeadline: 60, newsBody: 700 }, // newsBold is boolean, added separately
  photo:     { caption: 400, captionSecondary: 400 },
  countdown: { countText: 200, countEvent: 60, countWhen: 60, countCta: 60 },
  poster:    { topLine: 60, hosts: 120, kicker: 30, title: 80, subtitle: 200, leftList: 200, rightList: 200, dressCode: 100, dateLine: 60 },
  press:     { pressTitle: 80, pressBadge: 30, pressLineup: 200, pressGenres: 120, pressDateLine: 60 }, // pressTopMeta array added separately
  features:  { featuresTitle: 60 }, // features array added separately
};
function buildFillResponseSchema(sequence) {
  // Collect the union of fields for the slot types in this sequence only.
  const slotTypesInSeq = new Set(sequence);
  const properties = {
    // Every slide carries a type discriminator.
    type: { type: "string" },
  };
  for (const slotType of slotTypesInSeq) {
    const fields = FIELDS_BY_SLOT[slotType];
    if (!fields) continue;
    for (const [field, maxLength] of Object.entries(fields)) {
      // If two slot types share a field name (e.g. `subtitle` on both
      // cover and poster), the LARGER maxLength wins so we don't cap
      // legitimate longer body on the wider one.
      const existing = properties[field];
      if (!existing || (existing.maxLength && existing.maxLength < maxLength)) {
        properties[field] = { type: "string", maxLength };
      }
    }
  }
  // Slot-specific non-string fields — only include when their slot is present.
  if (slotTypesInSeq.has("news")) properties.newsBold = { type: "boolean" };
  if (slotTypesInSeq.has("press")) {
    properties.pressTopMeta = { type: "array", items: { type: "string", maxLength: 40 } };
  }
  if (slotTypesInSeq.has("features")) {
    properties.features = {
      type: "array",
      items: {
        type: "object",
        properties: {
          emoji:    { type: "string", maxLength: 8 },
          headline: { type: "string", maxLength: 30 },
          sub:      { type: "string", maxLength: 100 },
          featured: { type: "boolean" },
        },
        required: ["headline"],
      },
    };
  }
  return {
    type: "object",
    properties: {
      slides: {
        type: "array",
        items: {
          type: "object",
          properties,
          required: ["type"],
        },
        minItems: sequence.length,
        maxItems: sequence.length,
      },
      // POLISH-CRITIC REFUSAL — optional array of 1-based slide
      // indices the critic has flagged as unrecoverable (voice-flat,
      // schema-shaped, meta-writing pileup — the kinds of failures
      // rewriting can't fix without starting over). generateTemplateFill
      // reads this after polish returns and respawns exactly those
      // slots with stricter voice constraints. Used only by the polish
      // call; ignored on the initial writer call, which has no critic
      // step yet.
      unrecoverable: {
        type: "array",
        items: { type: "integer" },
      },
    },
    required: ["slides"],
  };
}

// AI Template Fill — generates content for an ENTIRE carousel template
// in a single Gemini call. Each slide in the template's sequence gets
// its own per-slot rule applied, but Gemini sees the whole sequence at
// once so the slides cohere as one story.
//
// Inputs:
//   apiKey       — BYOK Gemini key
//   sequence     — array of slot types ["cover","text","cta","cta",...]
//   topic        — short carousel topic ("Juneteenth 2026 weekend")
//   context      — long-form context: event details, descriptions, etc.
//                   For Editorial Roundup: paste 5 events with their
//                   day/time/venue/url. For Feature Drop: paste selling
//                   points like "Live DJ, Bachata Lessons, Pickleball,
//                   gift baskets, 100+ singles".
//   voice        — Brand Kit voice fingerprint
//   slotPrompts  — Brand Kit slot rules (cover, text, cta, spotlight)
//
// Output: { slides: [{ type, ...slot-fields }, ...] }

export async function generateTemplateFill({ apiKey, sequence, topic, context, voice, slotPrompts, templateMeta, mode, polish = true, letterMode = false, clusterDirective = "", clusterLabel = "", keywordTrigger = null, spine = true, voiceParams = null, behavioralTags = null, isEvergreen = false, rejectedDrafts = [], approvedDrafts = [] }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(sequence) || !sequence.length) throw new Error("Missing template sequence");
  if ((!topic || !topic.trim()) && (!context || !context.trim())) throw new Error("Add a topic or event details first");

  // Content / Feature: run the method research BEFORE thin-input so a
  // document + join can thicken a 2-bullet matrix into an honest piece.
  // Skips when the caller already appended a CGE METHOD BRIEF.
  const evergreenEarly = isEvergreen || isContentRegister(mode);
  const prepared = await ensureContentMethodBrief({
    apiKey, topic, context, clusterDirective, clusterLabel, mode, isEvergreen: evergreenEarly,
  });
  context = prepared.context;

  // THIN_INPUT guard — refuse to write a 7-slide dispatch from 2 facts.
  // Without this the fill's response-shape enforcement ("expected N slides,
  // got M") is asymmetric: it lets the model return exactly N slides, but
  // when the raw material is thinner than the shape demands, the model
  // resolves the mismatch by paraphrasing 2 facts across 5 extra slots.
  const atomicContentSlots = sequence.filter(t => t === "text" || t === "spotlight" || t === "stat" || t === "news").length;
  const suppliedBullets = parseContextBullets(context || "").length;
  const THIN_MATERIAL_FLOOR = 3;
  if (spine && sequence.length >= 3 && atomicContentSlots >= 5 && suppliedBullets > 0 && suppliedBullets < THIN_MATERIAL_FLOOR) {
    const err = new Error(`THIN_INPUT: this sequence has ${atomicContentSlots} slots that carry facts, but only ${suppliedBullets} bullet${suppliedBullets === 1 ? "" : "s"} were supplied. Add at least ${THIN_MATERIAL_FLOOR - suppliedBullets} more data point${THIN_MATERIAL_FLOOR - suppliedBullets === 1 ? "" : "s"}, or pick a shorter template — anything less and the engine will echo the same facts across slides instead of building an argument.`);
    err.code = "THIN_INPUT";
    err.needed = THIN_MATERIAL_FLOOR;
    err.supplied = suppliedBullets;
    throw err;
  }

  // HARD CAP — deterministic, no LLM involved. Content slots (text /
  // spotlight / stat / news) MUST NOT exceed the number of supplied
  // bullets. Rule: "one bullet, one slide; never more content slots than
  // facts." Non-content slots (cover, cta, photo, features, poster) are
  // additive on top. This is the fix for the $1.25M echo carousel:
  // the LLM's soft `recommendedSlideCount` was too generous ("this
  // material can carry 7 slides") and the model paraphrased to fill.
  // In code we drop excess content slots from the sequence tail so the
  // spine + writer only ever see a shape that CAN'T echo.
  let cappedSequence = sequence.slice();
  if (!evergreenEarly && suppliedBullets > 0 && atomicContentSlots > suppliedBullets) {
    const kept = [];
    let contentSeen = 0;
    for (const t of sequence) {
      const isContent = (t === "text" || t === "spotlight" || t === "stat" || t === "news");
      if (isContent) {
        if (contentSeen < suppliedBullets) {
          kept.push(t);
          contentSeen++;
        }
        // else: drop this content slot — we've hit the bullet count cap
      } else {
        kept.push(t);
      }
    }
    cappedSequence = kept;
    if (typeof console !== "undefined") {
      console.info(`Hard cap: ${suppliedBullets} bullets → capped content slots at ${suppliedBullets}. Sequence ${sequence.length} → ${cappedSequence.length}.`);
    }
  }

  const today = (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();

  // TEMPORAL FILTER — split context bullets into current-facts vs
  // historical-facts (bullets whose dates have already passed relative to
  // today). Historical bullets get their own labeled block in the writer
  // prompt with a strict "never treat as active/upcoming" mandate,
  // instead of silently flowing into the general context where the writer
  // treated them as calendar drops.
  const allBullets = parseContextBullets(context || "");
  const currentBullets = [];
  const historicalBullets = [];
  if (today) {
    for (const b of allBullets) {
      if (isBulletDatePast(b, today)) historicalBullets.push(b);
      else currentBullets.push(b);
    }
  } else {
    currentBullets.push(...allBullets);
  }
  // Rebuild a filtered context string with only the current bullets +
  // any non-bullet prose (POV lines etc). The writer will see a
  // separate historicalContext block via buildTemplatePrompt.
  let filteredContext = context || "";
  if (historicalBullets.length) {
    filteredContext = context
      .split(/\r?\n/)
      .filter(line => {
        const m = line.match(/^\s*(?:[-•*]|\d+[.)])\s+(.+?)\s*$/);
        if (!m) return true;
        return !historicalBullets.includes(m[1].trim());
      })
      .join("\n");
    if (typeof console !== "undefined") {
      console.info(`Temporal filter: ${historicalBullets.length} past-dated bullet(s) routed to historicalContext.`);
    }
  }

  // Feature-tier / Content register: dateless, thesis-first. Declare BEFORE
  // the spine so prod minification cannot TDZ `evergreen`.
  const evergreen = isEvergreen || isContentRegister(mode);

  // Narrative spine pre-pass — the outline step a human editor takes before
  // writing a single slide. Without it the model jumps from raw bullets to
  // formatted JSON in one call, improvising the argument arc on the fly while
  // also counting characters and honoring 800 tokens of voice rules. The
  // spine gives it (and the polish pass) a fixed thesis + Paradox → Friction
  // → Mechanism → Gate beat map, and it flags which context bullets prove
  // the thesis vs. which are candidates for the RELEVANCE VETO. Runs at low
  // temperature for a stable outline; skipped for very short sequences
  // (single-slot regen, 2-slide teasers) and when the caller opts out.
  // CTA slot drop — when a keyword trigger is set AND the sequence ends
  // in `cta`, we're going to overwrite that slide with stitchKeywordCta
  // after generation anyway. Skip asking the LLM to generate it: saves
  // Gemini tokens, removes all model drift on the ask, and lets the
  // narrative spine focus its outline on the beats that will actually
  // appear as generated copy. Operates on the hard-capped sequence so
  // the drop is relative to the compressed shape, not the original.
  const willStitchCta = !!(keywordTrigger && String(keywordTrigger).trim() && cappedSequence[cappedSequence.length - 1] === "cta");
  const generationSequence = willStitchCta ? cappedSequence.slice(0, -1) : cappedSequence.slice();

  let narrativeSpine = null;
  if (spine && generationSequence.length >= 3) {
    try {
      narrativeSpine = await generateNarrativeSpine({
        apiKey, topic, context: filteredContext, clusterDirective, clusterLabel, sequence: generationSequence, mode, today, letterMode, isEvergreen: evergreen,
      });
    } catch (e) {
      // The spine is an assist, not a blocker — if it fails the pipeline
      // falls back to the pre-spine behavior (one-shot generation).
      if (typeof console !== "undefined") console.warn("Narrative spine failed, generating without outline:", e?.message || e);
      narrativeSpine = null;
    }
  }

  // Editorial compression — if the spine's Editor pass thinks fewer slides
  // are honest for this material than the operator picked, compress the
  // sequence to that count. Preserves the cover (position 0) and drops
  // from the tail of the middle so the arc endpoints stay intact.
  // Compression fires only when spine ran successfully AND the operator's
  // sequence contains an atomic-content majority (otherwise compressing a
  // photo-heavy template makes no sense). If spine failed, no compression.
  let workingSequence = generationSequence;
  let workingSpine = narrativeSpine;
  if (narrativeSpine && narrativeSpine.recommendedSlideCount < generationSequence.length) {
    const atomicSlotsInSeq = generationSequence.filter(t => t === "text" || t === "spotlight" || t === "stat" || t === "news").length;
    if (atomicSlotsInSeq >= 3) {
      const targetLen = narrativeSpine.recommendedSlideCount;
      // Keep slide 1 (cover if present, else the first slot) + first
      // (targetLen - 1) additional slots. Simple front-truncate — the
      // outline's slideAssignments already prioritized the strongest
      // beats early, so a front-truncate honors the outline's ordering.
      workingSequence = generationSequence.slice(0, targetLen);
      // Re-plan the spine at the compressed length so slideAssignments
      // and proofAssignments match the sequence Gemini will actually see.
      try {
        workingSpine = await generateNarrativeSpine({
          apiKey, topic, context: filteredContext, clusterDirective, clusterLabel, sequence: workingSequence, mode, today, letterMode, isEvergreen: evergreen,
        });
      } catch (e) {
        // If the re-plan fails, fall back to the compressed sequence with
        // the original spine truncated to match — better than aborting.
        if (typeof console !== "undefined") console.warn("Compressed spine replan failed, truncating original spine:", e?.message || e);
        workingSpine = {
          ...narrativeSpine,
          slideAssignments: narrativeSpine.slideAssignments.slice(0, targetLen),
        };
      }
      if (typeof console !== "undefined") console.info(`Editorial compression: ${generationSequence.length} → ${targetLen} slides (material didn't earn more).`);
    }
  }

  // TIMELY ACTION detection — surface bullets whose dates fall within
  // 14 days of today (including today itself) so the writer's prompt
  // can name them explicitly. The failure mode this fixes: NJPAC has
  // an event tomorrow; the model turned it into abstract poetry
  // about "the echoes of the beats". This block gives the writer the
  // specific bullets that MUST land verbatim (date + venue) if
  // assigned to a slide, and forbids replacement with historical
  // musing.
  const imminentBullets = today
    ? currentBullets.filter(b => isBulletDateImminent(b, today, 14))
    : [];

  // Writer signature is deliberately narrower as of the #2+#4 refactor.
  // Cluster wording, voice params, and demographic no longer reach the
  // writer — they were absorbed by the spine (which the writer reads)
  // or moved to polish (voice params). Imminent bullets still flow in
  // so the per-slide reserved-proof line can carry a [TIMELY] flag.
  // Feature-tier evergreen guard: when evergreen is true (tier === FEATURE
  // or Content register), suppress both TIMELY ACTION and HISTORICAL
  // CONTEXT downstream. Feature carousels are dateless by definition —
  // imminent OR past dates get filtered from the bullets reaching the writer.
  const evergreenFilteredHistorical = evergreen ? [] : historicalBullets;
  const evergreenFilteredImminent = evergreen ? [] : imminentBullets;
  const prompt = buildTemplatePrompt({
    sequence: workingSequence,
    topic,
    context: filteredContext,
    historicalContext: evergreenFilteredHistorical,
    imminentBullets: evergreenFilteredImminent,
    voice, slotPrompts, templateMeta, mode, today, letterMode,
    narrativeSpine: workingSpine,
    behavioralTags,
    isEvergreen: evergreen,
    rejectedDrafts,
    approvedDrafts,
  });

  // Temperature split by register — story/editorial write at 0.70
  // (analytical curator, systemic tension, no purple prose overhang);
  // promo stays at 0.95 (energy matters). Polish is still 0.4.
  const fillTemperature = (mode === "story" || mode === "editorial" || mode === "content") ? 0.70 : 0.95;
  // Structured Output — enforces field length caps at the token-
  // generation layer. Two failure modes we defend against:
  //   (a) Gemini rejects the schema at the HTTP layer with a specific
  //       "too many states" / "invalid schema" error.
  //   (b) Gemini accepts the schema but the constrained response comes
  //       back truncated (max_output_tokens hit, model bailed, or
  //       thinking-model reasoning ate the budget) → extractJson fails.
  // Both retry the same prompt WITHOUT the schema so generation isn't
  // blocked. Prompt-level FIELD DISCIPLINE + post-generation sanitizer
  // still catch the common failure modes in that path.
  // maxOutputTokens set explicitly to 8192 so a heavy prompt + schema
  // constraints don't silently truncate the JSON response.
  const baseConfig = {
    responseMimeType: "application/json",
    temperature: fillTemperature,
    maxOutputTokens: 8192,
  };
  const withSchema = { ...baseConfig, responseSchema: buildFillResponseSchema(workingSequence) };
  const isSchemaRejection = (err) => {
    const msg = String(err?.message || err || "");
    return /too many states/i.test(msg) || /schema.*constraint/i.test(msg) || /invalid schema/i.test(msg);
  };
  let data;
  let raw;
  let parsed;
  try {
    data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: withSchema,
    });
    raw = extractResponseText(data);
    if (!raw) throw new Error("Empty response from Gemini");
    parsed = extractJson(raw);
  } catch (err) {
    const msg = String(err?.message || err || "");
    // Retry without schema if:
    //   - Gemini rejected the schema (HTTP-layer error), OR
    //   - We got a response but couldn't parse it (schema likely
    //     truncated the JSON output). Both paths point at schema.
    const isParseFailure = /did not return valid JSON|Empty response/i.test(msg);
    if (isSchemaRejection(err) || isParseFailure) {
      if (typeof console !== "undefined") {
        console.warn(`Schema-attached generation failed (${isSchemaRejection(err) ? "schema-rejection" : "parse-failure"}), retrying without schema:`, msg.slice(0, 240));
        // Log the raw response when we have one — helps future debugging.
        if (raw) console.warn("Truncated/invalid raw response (first 500 chars):", String(raw).slice(0, 500));
      }
      data = await geminiGenerate(apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: baseConfig,
      });
      raw = extractResponseText(data);
      if (!raw) throw new Error("Empty response from Gemini");
      parsed = extractJson(raw);
    } else {
      throw err;
    }
  }

  let slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (slides.length !== workingSequence.length) {
    throw new Error(`Expected ${workingSequence.length} slides, got ${slides.length}`);
  }
  // If we dropped the CTA slot from the generation sequence, restore it now
  // as the deterministic stitched CTA. This is the "removed from the LLM
  // loop entirely" path — the model never wrote CTA copy, we append the
  // canonical ask ourselves.
  const appendStitchedCtaIfNeeded = (arr) => {
    if (!willStitchCta) return arr;
    const trigger = String(keywordTrigger || "").trim().toUpperCase();
    return [...arr, {
      type: "cta",
      ctaKicker: "INSIDER ACCESS",
      ctaDate: "GET THE UNLISTED\nMAP & DISPATCH",
      ctaVenue: `Comment "${trigger}" below and we'll DM you the full breakdown + direct ticket access.`,
      ctaUrl: "centralgroupevents.com",
    }];
  };
  // NODE 2 — VOICE PASS. Runs whether or not polish is on. Node 1 (the
  // writer above) built structure + facts + routing under schema pressure;
  // Node 2 rewrites text-string field values in-place to match the voice
  // fingerprint / voice params / behavioral tags without touching JSON
  // shape, facts, or routing. Failure keeps Node 1's slides — voice is
  // enrichment, structure is load-bearing.
  try {
    const voiceResult = await generateVoicePass({ apiKey, slides, sequence: workingSequence, voice, voiceParams, mode, letterMode, behavioralTags });
    if (voiceResult?.changed && Array.isArray(voiceResult.slides) && voiceResult.slides.length === workingSequence.length) {
      slides = voiceResult.slides;
    }
  } catch (e) {
    if (typeof console !== "undefined") console.warn("Node 2 voice pass failed, keeping Node 1 draft:", e?.message || e);
  }
  if (!polish) {
    // Even without polish, deterministic CTA stitch runs (drift-removal).
    // Sanitizer runs too — belt-and-suspenders on scaffolding-label leaks.
    // Phantom + atomicity detectors run last so warnings attach to
    // whatever the pipeline finally emits.
    let sanitized = sanitizeScaffoldingLabels(slides);
    sanitized = detectPhantomEntities(sanitized, filteredContext, historicalBullets, workingSequence);
    sanitized = detectAtomicityViolations(sanitized);
    if (!evergreen) sanitized = detectCrossContamination(sanitized, workingSpine, filteredContext, workingSequence);
    sanitized = detectGeographicWhiplash(sanitized, workingSequence);
    sanitized = detectSlotDoctrineViolations(sanitized, workingSequence);
    return willStitchCta ? appendStitchedCtaIfNeeded(sanitized) : stitchKeywordCta(sanitized, workingSequence, keywordTrigger);
  }
  // Deterministic pre-polish dedup: scan adjacent slides for a shared numeric
  // token (a "1 in 5", "$1M", "28.5%", "1979", etc.). If any is repeated,
  // prepend a targeted rewrite instruction to the polish prompt so the editor
  // has a concrete order to follow, not just a vague "escalate" rule.
  const dedupPreamble = buildDedupPreamble(slides);
  // Critic pass — raise every slide to its quality bar. The spine is passed
  // through so the editor checks arc adherence (is slide N still doing the
  // beat the outline assigned it?), not just per-slide polish. As of the
  // #2 refactor the critic can also REFUSE a slide as unrecoverable, and
  // the pipeline respawns that slot from scratch instead of shipping a
  // half-rewritten dead slide.
  try {
    const polishResult = await polishCarousel({ apiKey, topic, context: filteredContext, historicalContext: historicalBullets, voice, sequence: workingSequence, slides, mode, today, letterMode, dedupPreamble, narrativeSpine: workingSpine, voiceParams });
    const improved = polishResult?.slides;
    const unrecoverable = polishResult?.unrecoverable || [];
    if (Array.isArray(improved) && improved.length === workingSequence.length) {
      slides = improved;
    }
    // Respawn any refused slots with stricter voice constraints. Each
    // is a single-slot generateSlideContent call with the same context
    // + spine, but at a higher temperature and with an explicit
    // "the previous draft was refused as voice-flat / meta-writing"
    // clause layered into the prompt so the retry doesn't reproduce
    // the same failure. Bounded to at most 3 respawns per generation
    // so a critic hallucinating "everything is unrecoverable" can't
    // trigger a runaway loop.
    for (const oneBased of unrecoverable.slice(0, 3)) {
      const idx = oneBased - 1;
      const slotType = workingSequence[idx];
      if (!slotType || slotType === "cta") continue; // CTA stitched, not respawned
      try {
        const respawnCtx = filteredContext + "\n\n[RESPAWN NOTE — the previous draft of this slide was refused by the polish critic as unrecoverable (voice-flat, meta-writing pileup, or structurally wrong for the slot). Write a new draft in cultural-dispatch register only. Do NOT sound like a grant proposal, a sociology paper, or a museum wall label. If the material for this slot is genuinely thin, keep the slide short and specific rather than expanding into abstraction.]";
        const respawnCandidates = await generateSlideContent({
          apiKey,
          slotType,
          topic,
          voice,
          slotPrompts,
          count: 1,
          context: respawnCtx,
          mode,
        });
        const respawned = Array.isArray(respawnCandidates) && respawnCandidates[0];
        if (respawned) {
          slides = slides.map((s, i) => (i === idx ? { ...respawned, type: slotType } : s));
          if (typeof console !== "undefined") console.info(`Respawned slide ${oneBased} (${slotType}) after polish refusal.`);
        }
      } catch (e) {
        if (typeof console !== "undefined") console.warn(`Respawn of slide ${oneBased} failed, keeping polish draft: ${e?.message || e}`);
      }
    }
  } catch (e) {
    if (typeof console !== "undefined") console.warn("Carousel polish failed, returning draft:", e?.message || e);
  }
  // Structural post-processing runs LAST (after polish, before CTA stitch):
  //   1. Sanitizer strips scaffolding-label leaks in title fields.
  //   2. Phantom-entity detector attaches _warnings when a proper noun in
  //      a slide isn't present in the context.
  //   3. Atomicity detector attaches _warnings when a single field stacks
  //      multiple discrete facts.
  // Warnings are attached to slides, not scrubbed — the UI renders them
  // as red badges so the operator can decide whether to REDO or keep.
  let sanitized = sanitizeScaffoldingLabels(slides);
  sanitized = detectPhantomEntities(sanitized, filteredContext, historicalBullets, workingSequence);
  sanitized = detectAtomicityViolations(sanitized);
  if (!evergreen) sanitized = detectCrossContamination(sanitized, workingSpine, filteredContext, workingSequence);
  sanitized = detectGeographicWhiplash(sanitized, workingSequence);
  sanitized = detectSlotDoctrineViolations(sanitized, workingSequence);
  return willStitchCta ? appendStitchedCtaIfNeeded(sanitized) : stitchKeywordCta(sanitized, workingSequence, keywordTrigger);
}

// === NARRATIVE SPINE — the outline step (the missing intermediate) ===
// A human editor never jumps from raw notes to formatted slides in one pass.
// They first pin down: what's the singular tension, what's the escalation,
// which facts prove the thesis, which are noise. This function makes the
// model do that step FIRST, at low temperature, before the high-temperature
// generation writes copy. The returned spine is threaded into both
// buildTemplatePrompt and polishCarousel so the arc is fixed BEFORE the
// pretty writing starts, not improvised while formatting JSON.
//
// Uses the operator's four-beat schema by default (Paradox → Friction →
// Mechanism → Gate) but lets the model adapt the beats when the topic calls
// for a different arc (e.g., historical → sonic-lineage arcs may run
// Origin → Break → Legacy → Now). Explicitly asks the model to sort context
// bullets by role (proves the thesis / macro context / veto candidate) so
// the fill call gets an authoritative discard list instead of feeling
// obligated to consume every bullet.
// Spine mode inference — detects whether this carousel wants an
// INSIGHT arc (one argument escalating across slides — PARADOX →
// FRICTION → MECHANISM → GATE) or a SHOWCASE directory (multiple
// peer entities carrying equal editorial weight — OVERTURE →
// SPOTLIGHT × N → CODA). The trigger is the slot sequence itself:
// a template with 3+ spotlight slots is a showcase by construction
// (Feature Drop, Editorial Roundup, city guide), and forcing it
// through a four-beat argument makes each spotlight read as a
// different phase of one thesis instead of a peer entry.
//
// The distinction was previously implicit — the spine always used
// the INSIGHT beat map regardless of template, and the writer's
// per-slot spotlight instructions carried the "each covers a
// distinct entity" contract. That worked for the writer but the
// spine's proofAssignments still felt argument-shaped ("this proof
// escalates the argument"), which fought showcase templates at the
// outline layer.
//
// Explicit here → downstream can also render the mode as a badge if
// useful, and the spine's prompt is properly matched to the shape.
export function inferSpineMode(sequence = [], { mode, isEvergreen } = {}) {
  if (isContentRegister(mode, isEvergreen)) return "insight";
  const spotlightCount = sequence.filter((t) => t === "spotlight").length;
  return spotlightCount >= 3 ? "showcase" : "insight";
}

export async function generateNarrativeSpine({ apiKey, topic, context, clusterDirective, clusterLabel, sequence, mode, today, letterMode, isEvergreen = false }) {
  const slideCount = sequence.length;
  const spineMode = inferSpineMode(sequence, { mode, isEvergreen });

  // Geographic grouping pre-pass — extract cities from each context
  // bullet. If 2+ distinct cities appear, we inject a GEOGRAPHIC
  // CLUSTERING directive into the spine so proofAssignments group
  // same-city bullets on adjacent slides instead of interleaving
  // (Newark → Asbury → Newark reader-whiplash). Runs before the
  // prompt is composed so the directive is contextual, not generic.
  const bulletList = parseContextBullets(context || "");
  const cityBuckets = {};
  for (const b of bulletList) {
    const cities = extractCitiesFromBullet(b);
    if (!cities.length) continue;
    const primary = cities[0];
    if (!cityBuckets[primary]) cityBuckets[primary] = [];
    cityBuckets[primary].push(b);
  }
  const distinctCityCount = Object.keys(cityBuckets).length;
  const geographicClusteringBlock = (distinctCityCount >= 2) ? [
    "GEOGRAPHIC CLUSTERING — MANDATE (this carousel's bullets span multiple cities):",
    ...Object.entries(cityBuckets).map(([city, bullets]) =>
      `  - ${city} (${bullets.length}): ${bullets.map(b => `"${b.slice(0, 40)}…"`).join(", ")}`
    ),
    "  When you build proofAssignments, group same-city bullets onto ADJACENT slides. Do NOT interleave cities (e.g., slide 2 = Newark, slide 3 = Asbury Park, slide 4 = Newark) — that gives the reader geographic whiplash. Instead: all Newark bullets in a contiguous block, then all Asbury Park bullets in a contiguous block, then GATE. If you must break clustering to serve the beat map, name the reason in your causalSynthesis so the writer knows the geographic jump is intentional.",
    "",
  ] : [];

  // TYPOLOGY DIVERSITY — when proof bullets span distinct venue types
  // (cafe / brewery / lounge / park / etc.), the spine must assign
  // one from each type before doubling on a type. Fixes the failure
  // where a brewery + 2 cafes gets proof-assigned as 2 cafes, dropping
  // the brewery and collapsing the day-to-night ecosystem promise.
  const { typeCounts: bulletTypeCounts, taggedBullets: bulletsByType } = analyzeBulletTypology(bulletList);
  const distinctTypeCount = Object.keys(bulletTypeCounts).filter((t) => t !== "generic").length;
  const typologyDiversityBlock = (distinctTypeCount >= 2) ? [
    "TYPOLOGY DIVERSITY — MANDATE (this carousel's bullets span multiple venue types):",
    ...Object.entries(bulletTypeCounts)
      .filter(([t]) => t !== "generic")
      .map(([type, count]) => `  - ${type} (${count}): ${bulletsByType.filter((tb) => tb.type === type).map((tb) => `"${tb.bullet.slice(0, 40)}…"`).join(", ")}`),
    "  When you build proofAssignments, spread across venue types before doubling on any one type. A carousel whose POV promises an ECOSYSTEM (e.g. 'the parking-lot brewery, the strip-mall speakeasy, and the accidental cafe takeover') is BROKEN when its proof slots are all cafes — you have collapsed the ecosystem the POV promised. Rule: pick ONE bullet per venue type first, then only double up on a type if you have unused slots AND every distinct type is already covered. If typology forces you to demote a beat-preferred bullet, name it in causalSynthesis so the writer knows the ecosystem coverage is intentional and beat-adherence took second priority.",
    "",
  ] : [];

  const promptLines = [
    "You are the OUTLINING editor for a CGE Instagram carousel — the step before any copy is written.",
    "Your job is NOT to write slides. Your job is to pin down the argument arc so the writer can't improvise it on the fly.",
    "",
    `Topic: ${topic?.trim() || "(unspecified)"}`,
    ...(clusterDirective ? [`Cluster: ${clusterLabel || "(cluster)"} — Analytical lens: ${clusterDirective}`] : []),
    `Register: ${mode || "editorial"}${letterMode ? " (letter/manifesto mode)" : ""}`,
    `Slide count: ${slideCount}`,
    ...(today ? [`Today: ${today}`] : []),
    "",
    ...platformThesisBlock({ mode, isEvergreen }),
    ...conversationWriterBlock(context),
    ...(isContentRegister(mode, isEvergreen) ? contentSpineMandate() : []),
    ...(context && context.trim() ? [
      "Raw context (the writer will draw from these; you decide which serve the thesis and which are noise):",
      context.trim(),
      "",
    ] : []),
    ...geographicClusteringBlock,
    ...typologyDiversityBlock,
    ...(spineMode === "showcase" ? [
      "═════════════════════════════",
      "SPINE MODE — SHOWCASE (this carousel has 3+ spotlight slots).",
      "═════════════════════════════",
      "This is NOT an argument arc; it is a DIRECTORY. Each spotlight slide is a PEER ENTRY — a distinct entity carrying equal editorial weight, not a phase of one thesis. Do NOT force PARADOX → FRICTION → MECHANISM onto peer spotlights; each spotlight stands on its own as ONE unit in the collection.",
      "",
    ] : []),
    "Return a spine with:",
    ...(spineMode === "showcase" ? [
      '  - thesis: ONE sentence naming the PATTERN this collection represents. Not a claim about one entity but the through-line across the spotlights ("Six NJ listening bars where the vinyl is on speakers you can actually hear," "The Central Jersey run clubs that replaced Hinge"). Concrete pattern → concrete collection.',
      "  - beats: an ordered array mapping to the showcase shape:",
      "      1. OVERTURE — the umbrella framing on slide 1: names the pattern and opens the loop, without anchoring on any single entity.",
      "      2. SHOWCASE — each spotlight slide carries ONE peer entity. Beats 2..N-1 are all SHOWCASE — no argument escalation between them; they are equal-weight entries. If a bridge slide (news/text) sits between spotlights it can be labeled CONTEXT (background on the pattern) or omit a beat entirely.",
      isContentRegister(mode, isEvergreen)
        ? "      3. CODA — the closing: last slide is the DOOR (who holds this, where it lives). Never a ticket or 'link in bio'."
        : "      3. CODA — the closing: last slide is the ask (CTA / GATE / directory close). Never a limp 'link in bio'.",
      "    Use SHOWCASE as the beat label for every peer entry — do NOT invent per-entity labels ('SHOWCASE_A', 'ROSE_PICK'). The identical label is correct; the ENTITY inside each spotlight is what varies.",
      "  - slideAssignments: an array of length equal to slide count. Slide 1 = OVERTURE; every spotlight slide = SHOWCASE; a non-spotlight bridge slide = CONTEXT; last slide = CODA. Peer entries share the same label by design.",
    ] : isContentRegister(mode, isEvergreen) ? [
      '  - thesis: ONE sentence locating THIS specimen (who / what / where / when). Name a CONTRAST only if Fuel / THESIS / START already proved two expressions. Concrete, not abstract. Not a topic ("Diaspora Infrastructure") and not a flyer line. Do not invent Strip Malls vs Urban Cafes so the brief feels like CGE.',
      "  - beats: ordered beats mapping to the slides you actually earned:",
      "      If the brief already named a contrast: CONTRAST → CAUSE → EXPLAIN → NEXT.",
      "      If the brief only locates: LOCATE (cover) → NEWS (what is on this desk) → NEXT (the question already on the desk).",
      "      Do not invent CAUSE / MECHANISM / JOIN / FRICTION / PATTERN beats to fill four slots.",
      "      CONTRAST — the two expressions already proved. NO withheld loop. NO 'is gone'.",
      "      CAUSE — only if the brief named a pressure. Numbers live in this sentence.",
      "      EXPLAIN — one section that makes an expression undeniable. Place-names live inside the paragraph.",
      "      NEXT — the question already on the desk. Never a ticket, RSVP, archive kicker, or 'find your next gathering spot'.",
      `    Outline as ${CONTENT_ESSAY_ARC} only when the desk earned a contrast. Otherwise Cover + News locates.`,
      "  - slideAssignments: an array of length equal to slide count. Last slide is NEXT. Do not pad with invented CAUSE slides.",
    ] : [
      '  - thesis: ONE sentence locating THIS specimen, or naming the singular tension the brief already exposed. Concrete, not abstract. Not a topic ("Diaspora Infrastructure"). Do not invent a hidden machine so the carousel feels like an argument.',
      "  - beats: ordered beats mapping to the slides you actually earned:",
      "      If the brief already named a fight or a trick: PARADOX → FRICTION → MECHANISM → GATE.",
      "      If the brief only locates: LOCATE → NEWS → GATE. Do not invent PARADOX / FRICTION / MECHANISM to fill four slots.",
      "      1. PARADOX — only if the brief named a conflict. NO stats, NO conclusions.",
      "      2. FRICTION — only if the brief named why the obvious answer fails.",
      "      3. MECHANISM — the unseen infrastructure ONLY if the brief already named it. Do not hunt an access illusion.",
      "      4. GATE — the ask: the specific action or keyword access. Never a limp 'link in bio'.",
      "    If the topic genuinely calls for a different arc (e.g. sonic-history: ORIGIN → BREAK → LEGACY → NOW), use those beats instead — keep the shape honest to the desk, not a forced count of 4.",
      "  - slideAssignments: an array of length equal to slide count. Last slide is GATE. Distribute only the beats the brief earned.",
    ]),
    ...(spineMode === "showcase" ? [
      "  - bulletRoles: object mapping each context bullet (verbatim, first 60 chars as key) to ONE role: 'proof' (a peer entity that will fill a spotlight slot), 'context' (background on the pattern, may be used in bridge slides or the overture), or 'veto' (doesn't fit the pattern's collection — DISCARD, must NOT appear in any slide). In showcase mode, EVERY spotlight slot expects a distinct proof entity — the ecosystem of peer entries IS the carousel.",
      "  - proofAssignments: object mapping each PROOF bullet (same 60-char key) to the SINGLE slide index (1-based, 2 or later — see Macro-Cover Mandate) where that peer entity lands. In showcase mode: one proof entity per spotlight slot, one spotlight slot per proof entity. No spotlight gets two entities, no entity gets two spotlights. If you have MORE proof entities than spotlight slots, downgrade the least-fitting entities to 'context' (they may still appear as background); NEVER stack two entities on one spotlight.",
    ] : [
      "  - bulletRoles: object mapping each context bullet (verbatim, first 60 chars as key) to ONE role: 'proof' (proves the thesis, must be used), 'context' (background, may be used), or 'veto' (breaks the argument's geographic/thematic focus — DISCARD, must NOT appear in any slide). Every context bullet must be classified. Be willing to VETO — a bullet from Hasbrouck Heights in a Somerset County carousel is a veto; a bullet about restaurants in a nightlife carousel is a veto.",
      "  - proofAssignments: object mapping each PROOF bullet (same 60-char key) to the SINGLE slide index (1-based, 2 or later — see Macro-Cover Mandate) where that specific fact should land. Every PROOF bullet MUST be assigned to exactly ONE slide — no bullet appears on two slides, no slide gets two PROOFS. If two facts belong on the same beat, pick the stronger one for the primary slide and either assign the second to a different beat or downgrade it to 'context'. This is the deduplication contract — the fill call is not allowed to spread one bullet across multiple slides in different words.",
    ]),
    "",
    "MACRO-COVER MANDATE — this rule OVERRIDES any other bullet-assignment instinct:",
    "  Slide 1 (COVER) locates THIS specimen. If Fuel already proved two expressions, it is the UMBRELLA CONTRAST — Strip Malls vs Urban Cafes, Walker's Paradise vs strip-mall geography. If Fuel only located, the cover locates who / what / where / when. Do not invent a contrast. Do not open a withheld loop. Do not write 'is gone'.",
    "  Slide 1 MUST NOT appear as a value anywhere in proofAssignments — the cover CANNOT be assigned a specific PROOF bullet, EVER. If you assign a run-club bullet to slide 1, the whole carousel gets anchored on that one venue and the reader expects the rest to be about it. That's narrative whiplash when slide 4 introduces a different venue.",
    "  Cover = locate, or a named contrast the brief already proved. Specifics (one cafe, one hall) = slides 2+.",
    "  A corridor, a score-vs-strip contrast, or two named geographies IS the umbrella when those are on the desk. 'Discover surprising new gathering spots' is not — that is a listing.",
    "  Concretely: if there are 3 proof bullets and 3 content slots (slides 2, 3, and 4), each bullet lands on ONE of those three slides. Slide 1 stays the locate-or-contrast umbrella, not a generic mush and not one venue. Slide 5 (or wherever CTA sits) is not a content slot.",
    "",
    "ENTITY PRIORITIZATION — the second override:",
    "  Every bullet classified as 'proof' in bulletRoles MUST have an entry in proofAssignments. A proof bullet with no slide assignment is a DROPPED entity — that's how a Asbury Park bullet ends up in the trash while slide 2 gets a filler summary sentence.",
    "  If you have MORE proof-role bullets than available non-cover, non-CTA content slots, DOWNGRADE the excess bullets to 'context' role (not 'proof'). Never leave a proof bullet unassigned.",
    "  If you have FEWER proof bullets than content slots, that's fine — leave the extra slots without proofAssignments and the writer will carry them with framing / context bullets. That's a separate case from dropping a proof.",
    `  - recommendedSlideCount: the honest number of slides this material can support without repeating facts (integer, between 3 and ${slideCount} inclusive). If the operator picked ${slideCount} slides but you only have 3 proof bullets and no additional tension already on the desk, return 4 or 5, NOT ${slideCount}. This is the editorial compression call — better to ship a tight 4-slide carousel than a stretched 7 that paraphrases the same 3 facts. Only return the operator's full count if the material genuinely earns it (rich proof list, distinct beats already on the desk). Do not invent a mechanism to justify more slides.`,
    ...(spineMode === "showcase" ? [
      isContentRegister(mode, isEvergreen)
        ? "  - causalSynthesis: EXACTLY 2 sentences. Sentence 1 names the PATTERN this collection already shows. Sentence 2 names a JOIN only if a document, disappearance, or pressure is already on the desk — otherwise locate the collection. NOT venue-responds-to-liquor-cap unless the bullets actually are that story."
        : "  - causalSynthesis: EXACTLY 2 sentences that model the ECOSYSTEM this collection represents. Sentence 1 names the through-line — what distinguishes THESE entities from adjacent options ('quiet listening rooms that treat vinyl as the headliner, not the atmosphere', 'run clubs that outgrew a hobby and became social infrastructure'). Sentence 2 names one shared TRAIT or SIGNAL the peer entries carry ('curated speaker rigs, low-decibel licensing, small capacities under 100', 'consistent Saturday cadence, a coffee handoff after, a founding operator who runs it as a project not a business'). Concrete pattern → concrete shared trait. NO abstract musing, NO 'this shows how community forms', NO grantwriter register. This is the ecosystem the writer will characterize.",
    ] : isContentRegister(mode, isEvergreen) ? [
      "  - causalSynthesis: EXACTLY 2 sentences. If the brief named a contrast: sentence 1 names the CONTRAST (the two expressions); sentence 2 names the CAUSE (how they are the same pressure). If the brief only located: two sentences that locate THIS specimen. Example when earned: 'Strip-mall breweries and urban-core cafes are the same hijack of commercial space. Sprawl plus the liquor cap produced a third-place deficit, so parking lots and coffee counters became the Saturday.' Do not invent a liquor cap, access illusion, or pressure so the synthesis feels like CGE.",
    ] : [
      "  - causalSynthesis: EXACTLY 2 sentences. If the brief named a rule: sentence 1 names that SYSTEMIC RULE, PRESSURE, or CONSTRAINT; sentence 2 names how a VENUE / OPERATOR / SOLUTION on THIS desk responds. If the brief only located: two sentences that locate THIS specimen. Do not invent a policy, zoning cap, or unseen hand. Example when earned: 'State decibel caps make big sound rigs a liability in mixed-use neighborhoods. In response, venues like LoFi pivot to low-decibel, high-margin vinyl nights to keep the crowd without breaking the law.' NO abstract musing, NO 'this shows how culture adapts', NO grantwriter register.",
    ]),
    "",
    'Return ONLY JSON in this exact shape:',
    (spineMode === "showcase"
      ? '{"thesis":"...","beats":[{"label":"OVERTURE","description":"..."},{"label":"SHOWCASE","description":"..."},{"label":"CODA","description":"..."}],"slideAssignments":["OVERTURE","SHOWCASE","SHOWCASE","SHOWCASE","SHOWCASE","CODA"],"bulletRoles":{"first 60 chars of bullet":"proof|context|veto"},"proofAssignments":{"first 60 chars of bullet":3},"recommendedSlideCount":6,"causalSynthesis":"Pattern sentence. Join or shared-trait sentence."}'
      : isContentRegister(mode, isEvergreen)
        ? '{"thesis":"...","beats":[{"label":"LOCATE","description":"..."},{"label":"NEWS","description":"..."},{"label":"NEXT","description":"..."}],"slideAssignments":["LOCATE","NEWS","NEXT"],"bulletRoles":{"first 60 chars of bullet":"proof|context|veto"},"proofAssignments":{"first 60 chars of bullet":3},"recommendedSlideCount":3,"causalSynthesis":"Locate sentence. Locate or earned-cause sentence."}'
        : '{"thesis":"...","beats":[{"label":"LOCATE","description":"..."},{"label":"NEWS","description":"..."},{"label":"GATE","description":"..."}],"slideAssignments":["LOCATE","NEWS","GATE"],"bulletRoles":{"first 60 chars of bullet":"proof|context|veto"},"proofAssignments":{"first 60 chars of bullet":3},"recommendedSlideCount":3,"causalSynthesis":"Locate sentence. Locate or earned-response sentence."}'
    ),
  ];
  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: promptLines.join("\n") }] }],
    // Spine wants editorial judgment (which bullets to VETO, honest slide
    // count, non-obvious beat labels) — 0.3 keeps the outline grounded but
    // not so deterministic that it always picks the first-instinct answer.
    // maxOutputTokens explicit so a long prompt + thinking-model reasoning
    // doesn't silently truncate the JSON and produce a malformed spine.
    generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 8192 },
  });
  const raw = extractResponseText(data);
  if (!raw) throw new Error("Empty spine response");
  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("Spine JSON parse failed — raw response first 500 chars:", String(raw).slice(0, 500));
    }
    throw err;
  }
  const thesis = String(parsed?.thesis || "").trim();
  const beats = Array.isArray(parsed?.beats) ? parsed.beats.map(b => ({
    label: String(b?.label || "").trim().toUpperCase(),
    description: String(b?.description || "").trim(),
  })).filter(b => b.label && b.description) : [];
  const slideAssignments = Array.isArray(parsed?.slideAssignments)
    ? parsed.slideAssignments.map(a => String(a || "").trim().toUpperCase()).slice(0, slideCount)
    : [];
  const bulletRoles = (parsed?.bulletRoles && typeof parsed.bulletRoles === "object") ? parsed.bulletRoles : {};
  const proofAssignments = (parsed?.proofAssignments && typeof parsed.proofAssignments === "object") ? parsed.proofAssignments : {};
  // Editorial compression signal — if the outliner thinks fewer slides are
  // honest for the material, the caller can compress the sequence before
  // asking the writer to fill it. Clamped to [3, slideCount] so a bad
  // outline can't request a 1-slide or over-count carousel.
  let recommendedSlideCount = Number(parsed?.recommendedSlideCount);
  if (!Number.isInteger(recommendedSlideCount) || recommendedSlideCount < 3 || recommendedSlideCount > slideCount) {
    recommendedSlideCount = slideCount;
  }
  // Causal synthesis — the completed causal reasoning the writer executes
  // against. Soft-required: an empty string is acceptable (spine still
  // returns, writer degrades gracefully to inferring the argument from
  // thesis + beats). Length-bound to keep it from being a paragraph:
  // it's supposed to be 2 sentences, not an essay.
  const causalSynthesis = String(parsed?.causalSynthesis || "").trim().slice(0, 800);
  if (!thesis || beats.length < 3 || slideAssignments.length !== slideCount) {
    throw new Error("Malformed spine — missing thesis, beats, or slideAssignments");
  }
  // PROOF DISTINCTNESS ENFORCEMENT — if the outliner assigned two proof
  // bullets to the same slide, or one proof bullet to two slides, that
  // violates the deduplication contract that keeps the fill from
  // paraphrasing. We reject rather than paper over, so the caller either
  // retries the spine call or falls back to no-spine generation (which
  // still has RELEVANCE VETO in the fill prompt).
  const slotToProof = {};
  const proofToSlot = {};
  for (const [bulletKey, slotRaw] of Object.entries(proofAssignments)) {
    const slot = Number(slotRaw);
    if (!Number.isInteger(slot) || slot < 1 || slot > slideCount) continue;
    // MACRO-COVER MANDATE ENFORCEMENT — slide 1 is the umbrella. A proof
    // bullet on the cover anchors the whole carousel on one specific
    // entity, then the rest of the slides feel like non-sequiturs
    // (boardwalk run club cover, roller rink slide 4 = narrative whiplash).
    if (slot === 1) {
      throw new Error(`Spine violated Macro-Cover Mandate: bullet "${bulletKey}" was assigned to slide 1 (cover). Cover is the umbrella — PROOFs go to slides 2+.`);
    }
    if (slotToProof[slot]) {
      throw new Error(`Spine PROOF collision: slide ${slot} was assigned two proof bullets ("${slotToProof[slot]}" and "${bulletKey}")`);
    }
    if (proofToSlot[bulletKey]) {
      throw new Error(`Spine PROOF collision: bullet "${bulletKey}" was assigned to two slides (${proofToSlot[bulletKey]} and ${slot})`);
    }
    slotToProof[slot] = bulletKey;
    proofToSlot[bulletKey] = slot;
  }
  // ENTITY PRIORITIZATION ENFORCEMENT — every bullet the outliner
  // classified as 'proof' MUST have landed on a slide. An unassigned
  // proof is a DROPPED entity: that's how "Asbury Park sober socials"
  // gets erased while slide 2 fills with generic summary filler.
  const proofBullets = Object.entries(bulletRoles)
    .filter(([, r]) => String(r || "").toLowerCase() === "proof")
    .map(([k]) => k);
  const assignedBulletKeys = new Set(Object.keys(proofAssignments));
  const dropped = proofBullets.filter(b => !assignedBulletKeys.has(b));
  if (dropped.length) {
    throw new Error(`Spine violated Entity Prioritization: ${dropped.length} proof bullet(s) were classified 'proof' but not assigned to any slide — dropped entities: ${dropped.map(b => `"${b}"`).join(", ")}. Every proof MUST land on slides 2+, or be downgraded to 'context'.`);
  }
  return { thesis, beats, slideAssignments, bulletRoles, proofAssignments, recommendedSlideCount, causalSynthesis, spineMode };
}

// Deterministic CTA stitch — when the operator has set a DM keyword trigger,
// the LLM has no reserved slot for it and generates a limp "link in bio"
// fallback (or invents an @handle it wasn't told about). We replace the FINAL
// slide in code IFF the sequence ends in a `cta` slot and a trigger is set.
//
// The CTA render contract (see renderCTA in MediaTool.jsx) uses four fields:
//   ctaKicker → uppercased top pill
//   ctaDate   → biggest centered text (multi-line via \n)
//   ctaVenue  → subtitle text (wraps if long)
//   ctaUrl    → accent-colored link line
// The operator spec used aspirational `headline`/`textBody` field names for
// this stitch — we map their intent to the actual four fields so the slide
// actually renders. If the final slot isn't `cta`, we don't stitch (a
// features/news ending would break under a forced replacement).
function stitchKeywordCta(slides, sequence, keywordTrigger) {
  if (!Array.isArray(slides) || !slides.length) return slides;
  const trigger = String(keywordTrigger || "").trim().toUpperCase();
  if (!trigger) return slides;
  const lastIdx = sequence.length - 1;
  if (sequence[lastIdx] !== "cta") return slides;
  const stitched = slides.slice();
  stitched[lastIdx] = {
    type: "cta",
    ctaKicker: "INSIDER ACCESS",
    ctaDate: "GET THE UNLISTED\nMAP & DISPATCH",
    ctaVenue: `Comment "${trigger}" below and we'll DM you the full breakdown + direct ticket access.`,
    ctaUrl: "centralgroupevents.com",
  };
  return stitched;
}

// Pull "numeric tokens" out of a slide's copy — the class of specifics most
// likely to visibly repeat across adjacent slides ("1 in 5", "$1M", "28.5%",
// "1979", "150-cap", "1:3,000", etc.). Returns lower-cased strings for cheap
// set comparison. Deliberately narrow: we're catching visible duplication a
// reader would notice, not chasing every noun.
function extractNumericTokens(slide) {
  if (!slide || typeof slide !== "object") return [];
  const parts = [];
  for (const v of Object.values(slide)) {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) {
      for (const inner of v) {
        if (typeof inner === "string") parts.push(inner);
        else if (inner && typeof inner === "object") {
          for (const iv of Object.values(inner)) if (typeof iv === "string") parts.push(iv);
        }
      }
    }
  }
  const text = parts.join(" \n ");
  const tokens = new Set();
  const patterns = [
    /\d+\s*(?:in|of)\s*\d+/gi,        // "1 in 5", "3 of 10"
    /\d+\s*:\s*[\d,]+/g,               // "1:3,000"
    /\$\s*[\d.,]+\s*(?:M|B|K)?/gi,     // "$1M", "$500K", "$1.2B"
    /[\d.]+\s*%/g,                     // "28.5%", "20 %"
    /\d{4}(?!\d)/g,                    // years like "1979", "2026"
    /\d+[-–]\s*(?:cap|seat|room|person|people|year|hour|min)\w*/gi, // "150-cap", "10-year"
    /\d[\d,]*\s+(?:towns|cities|venues|municipalities|residents|businesses|clubs|people|attendees)/gi,
  ];
  for (const re of patterns) {
    const matches = text.match(re) || [];
    for (const m of matches) tokens.add(m.trim().toLowerCase().replace(/\s+/g, " "));
  }
  return Array.from(tokens);
}

// Compare adjacent slides for a shared numeric token; when one repeats,
// build a targeted rewrite preamble that names the exact token and the
// exact slide index that must drop it. Returns "" when nothing repeats,
// so the polish pass runs with its normal prompt.
export function buildDedupPreamble(slides) {
  if (!Array.isArray(slides) || slides.length < 2) return "";
  const lines = [];
  const tokensPerSlide = slides.map(extractNumericTokens);
  for (let i = 1; i < slides.length; i++) {
    const prev = new Set(tokensPerSlide[i - 1]);
    for (const t of tokensPerSlide[i]) {
      if (prev.has(t)) {
        lines.push(`CRITICAL DEDUP: Slide ${i + 1} repeated "${t}" from Slide ${i}. Rewrite Slide ${i + 1} WITHOUT using "${t}" — pick a DIFFERENT specific from the context, or a ground-level observation that continues the thread without restating the same number.`);
      }
    }
  }
  if (!lines.length) return "";
  return [
    "═════════════════════════════",
    "PRE-POLISH DEDUP INSTRUCTIONS — these take precedence over anything else in this prompt:",
    ...lines,
    "═════════════════════════════",
    "",
  ].join("\n");
}

// The per-slide JSON shape the Template Fill (and its critic pass) must return
// for each slot type. Includes the "type" tag and the Fill-specific field names
// (e.g. cta uses ctaKicker/ctaDate/ctaVenue/ctaUrl, not the single-slot shape).
function fillSlotShape(t) {
  if (t === "cover")     return '{"type":"cover","headline":"...","subtitle":"...","accentWord":"..."}';
  if (t === "text")      return '{"type":"text","textTitle":"...","textBody":"..."}';
  if (t === "news")      return '{"type":"news","newsKicker":"<short eyebrow like BREAKING or THE BIGGER PICTURE>","newsHeadline":"<optional short heading, or empty>","newsBody":"<1-2 short paragraphs of supporting copy>","newsBold":false}';
  if (t === "spotlight") return '{"type":"spotlight","spotName":"...","spotMeta":"...","spotTime":"","spotPrice":"","spotCta":""}';
  if (t === "cta")       return '{"type":"cta","ctaKicker":"","ctaDate":"...","ctaVenue":"...","ctaUrl":"..."}';
  if (t === "photo")     return '{"type":"photo","caption":"...","captionSecondary":"..."}';
  if (t === "stat")      return '{"type":"stat","statNumber":"...","statLabel":"...","statSub":"..."}';
  if (t === "countdown") return '{"type":"countdown","countText":"...","countEvent":"...","countWhen":"...","countCta":"..."}';
  if (t === "poster")    return '{"type":"poster","topLine":"...","hosts":"...","kicker":"...","title":"...","subtitle":"...","leftList":"...","rightList":"...","dressCode":"...","dateLine":"..."}';
  if (t === "press")     return '{"type":"press","pressTopMeta":["...","...","...","..."],"pressTitle":"...","pressBadge":"...","pressLineup":"...","pressGenres":"...","pressDateLine":"..."}';
  if (t === "features")  return '{"type":"features","featuresTitle":"...","features":[{"emoji":"...","headline":"...","sub":"...","featured":false}]}';
  return `{"type":"${t}"}`;
}

// === NODE 2 · VOICE PASS ===
// The second pass in the decoupled architecture. Node 1 (the writer)
// fills the JSON structure with FACTS + correct bullet routing. Node
// 2 takes those slides and rewrites ONLY the text-field values to
// match the voice combination. Never touches JSON shape, never adds
// or drops facts, never re-routes bullets. Single job = voice.
//
// This is the fix for the wall-of-text-on-slide-2 / empty-slide-3
// failure mode: when the writer had to do structure AND voice in one
// call, it starved slots to satisfy voice on others. Split the jobs,
// each pass gets to concentrate.
//
// Falls back gracefully — if Node 2 returns a mangled schema or
// fails outright, generateTemplateFill keeps Node 1's slides. Voice
// pass is enrichment; structure is the load-bearing pass.
export async function generateVoicePass({ apiKey, slides, sequence, voice, voiceParams = null, mode, letterMode = false, behavioralTags = null }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(slides) || !slides.length) throw new Error("No slides to voice-pass");

  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const exemplars = Array.isArray(voice?.exemplars) ? voice.exemplars.filter((e) => e && e.trim()) : [];
  const voiceDirective = composeVoiceParamsDirective(voiceParams);

  // Skip Node 2 entirely when there's nothing voice-shaped to do —
  // no fingerprint, no voice params, no override. The Node 1 output
  // is already the best we've got. Signal by returning the input
  // slides unchanged so the caller can proceed without special
  // handling.
  if (!hasVoiceDesc && !exemplars.length && !voiceDirective) {
    return { slides, changed: false, reason: "no-voice-inputs" };
  }

  const draft = slides.map((s, i) => `SLIDE ${i + 1} (${s?.type || sequence[i]}):\n${JSON.stringify(s)}`).join("\n\n");

  const prompt = [
    "═════════════════════════════",
    "NODE 2 — VOICE PASS",
    "═════════════════════════════",
    "",
    "You are the VOICE editor. A prior Node 1 (Structure Pass) has already:",
    "  - Filled every slide's JSON with the correct facts",
    "  - Routed each proof bullet to its correct slide",
    "  - Hit the schema constraints (field names, types, maxLengths)",
    "",
    "Your job is EXCLUSIVELY to rewrite text-field values so the copy sounds like the voice combination below. You have ONE job: voice.",
    "",
    "STRICT RULES:",
    "  1. Preserve JSON shape EXACTLY. Same slide count. Same slot types. Same field names per slide. Same non-string field types (booleans, arrays, numbers). Never add fields, never drop fields.",
    "  2. Preserve FACTS EXACTLY. Every venue name, address, price, date, hour, capacity, number, proper noun MUST remain identical to the Node 1 draft. You are rewriting the WORDING around them, not the facts.",
    "  3. Preserve routing. Each slide's subject stays the same — do not swap a Live Love Skate spotlight into a Fleet Feet spotlight.",
    "  4. Rewrite text-string field values IN PLACE. Change how the copy sounds, not what it says.",
    "  5. Do NOT add new facts, invent details, or extrapolate. If Node 1 didn't have a number, Node 2 doesn't add one.",
    "  6. Do NOT re-route bullets to different slides. Whatever slide 3 was about, it stays about.",
    "  7. SENTENCE CADENCE — how the sentences sit, not the source. If VOICE PARAMETERS name STACKED, rewrite body fields as one thought / one sentence / one line. If cadence is CONVERSATIONAL, ROLLING, BRAIDED, or unset, write flowing sentences. Do not introduce one-sentence-per-line breaks unless cadence is STACKED. That stacked beat is the one that reads as less plain text.",
    "",
    ...(hasVoiceDesc ? [
      "BRAND VOICE FINGERPRINT (the enduring brand voice):",
      voice.description.trim(),
      "",
    ] : []),
    ...(exemplars.length ? [
      `Past captions in this voice (${exemplars.length} examples — study cadence, sentence length, what gets named vs implied, then imitate at the sentence level):`,
      "",
      ...exemplars.map((e, i) => `=== Example ${i + 1} ===\n${e.trim()}`),
      "",
    ] : []),
    ...(voiceDirective ? [voiceDirective, ""] : []),
    ...(behavioralTags && (behavioralTags.emotion || (behavioralTags.demographics && behavioralTags.demographics.length)) ? [
      "BEHAVIORAL TAGS — these are HOW the piece should feel, not vocabulary to quote:",
      ...(behavioralTags.emotion ? [`  Target Emotion (write in this register): ${behavioralTags.emotion}`] : []),
      ...(behavioralTags.demographics && behavioralTags.demographics.length ? [`  Target Demographic (audience mental model): ${behavioralTags.demographics.join(", ")}`] : []),
      "  BANNED: quoting any of these labels verbatim in the shipped copy. Do NOT write 'Tag the [demographic]' or paste labels as vocabulary. The tags are HOW you write, not WHAT you write.",
      "",
    ] : []),
    ...(letterMode ? [
      "LETTER MODE: the carousel is one continuous letter. Voice pass carries the letter's voice across every slide — each rewrite hands off to the next slide's beat.",
      "",
    ] : []),
    "DRAFT FROM NODE 1 — rewrite each slide's text-field values in voice:",
    "",
    draft,
    "",
    "Return JSON ONLY (no fences, no prose) in this exact shape (same slide count, same slot types, same field names as the draft above):",
    `{"slides":[${sequence.map(fillSlotShape).join(",")}]}`,
  ].join("\n");

  const voicePassTemperature = (mode === "story" || mode === "editorial" || mode === "content") ? 0.72 : 0.85;
  const voiceBaseConfig = { responseMimeType: "application/json", temperature: voicePassTemperature, maxOutputTokens: 8192 };
  const voiceWithSchema = { ...voiceBaseConfig, responseSchema: buildFillResponseSchema(sequence) };
  const isSchemaRejection = (err) => {
    const msg = String(err?.message || err || "");
    return /too many states/i.test(msg) || /schema.*constraint/i.test(msg) || /invalid schema/i.test(msg);
  };
  let data;
  let raw;
  let parsed;
  try {
    data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: voiceWithSchema,
    });
    raw = extractResponseText(data);
    if (!raw) throw new Error("Empty response from Gemini");
    parsed = extractJson(raw);
  } catch (err) {
    const msg = String(err?.message || err || "");
    const isParseFailure = /did not return valid JSON|Empty response/i.test(msg);
    if (isSchemaRejection(err) || isParseFailure) {
      if (typeof console !== "undefined") {
        console.warn(`Voice pass schema-attached generation failed (${isSchemaRejection(err) ? "schema-rejection" : "parse-failure"}), retrying without schema:`, msg.slice(0, 240));
        if (raw) console.warn("Truncated/invalid voice pass raw response (first 500 chars):", String(raw).slice(0, 500));
      }
      data = await geminiGenerate(apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: voiceBaseConfig,
      });
      raw = extractResponseText(data);
      if (!raw) throw new Error("Empty response from Gemini");
      parsed = extractJson(raw);
    } else {
      throw err;
    }
  }
  const out = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (out.length !== sequence.length) throw new Error(`Voice pass returned ${out.length} slides, expected ${sequence.length}`);
  return { slides: out, changed: true, reason: "voice-rewritten" };
}

// === CAROUSEL CRITIC (whole-carousel polish) ===
// Second pass over a generated Template Fill — the Fill analog of the cover
// hook-judge. The Fill writes each slide one-shot with no selection, so weak or
// generic slides slip through. This hands the whole draft to a low-temp editor
// that raises EVERY slide to its quality bar (kill filler, make the cover hook,
// keep facts honest) while preserving each slide's type, order, and JSON shape.
// Returns the improved slides; throws on failure so the caller falls back to the draft.
export async function polishCarousel({ apiKey, topic, context, historicalContext = [], voice, sequence, slides, mode, today, letterMode = false, dedupPreamble = "", narrativeSpine = null, voiceParams = null }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(slides) || !slides.length) throw new Error("No slides to polish");

  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const voiceLine = hasVoiceDesc ? `Brand voice: ${voice.description.trim()}` : "";

  const draft = slides.map((s, i) => {
    const beat = (narrativeSpine && Array.isArray(narrativeSpine.slideAssignments))
      ? narrativeSpine.slideAssignments[i]
      : null;
    const beatTag = beat ? ` [BEAT: ${beat}]` : "";
    return `SLIDE ${i + 1} (${s?.type || sequence[i]})${beatTag}:\n${JSON.stringify(s)}`;
  }).join("\n\n");

  // Spine block for polish — the editor checks not just per-slide quality
  // but whether each slide is still serving the beat the outline assigned it.
  const spineBlock = (narrativeSpine && narrativeSpine.thesis) ? [
    "═════════════════════════════",
    "NARRATIVE SPINE THE DRAFT WAS BUILT AGAINST — enforce arc adherence:",
    `THESIS: ${narrativeSpine.thesis}`,
    ...(narrativeSpine.causalSynthesis ? [
      `CAUSAL SYNTHESIS: ${narrativeSpine.causalSynthesis}`,
    ] : []),
    "BEATS:",
    ...narrativeSpine.beats.map((b, i) => `  ${i + 1}. ${b.label}: ${b.description}`),
    "",
    "If a slide labeled PARADOX contains the MECHANISM's metric, MOVE the metric to the mechanism slide and rewrite paradox as tension only.",
    "If a slide labeled FRICTION states the resolution, rewrite it as the obstacle.",
    "If a slide restates the thesis instead of advancing its beat, rewrite it to do the beat's actual job.",
    ...(narrativeSpine.causalSynthesis ? [
      "If any slide contradicts the CAUSAL SYNTHESIS above (states a different rule → response chain, or inverts the causality), REWRITE the slide to align with the synthesis. The synthesis is the ground truth for the argument; slides support it, not the other way around.",
    ] : []),
    "═════════════════════════════",
    "",
  ] : [];

  const prompt = [
    dedupPreamble,
    "You are a ruthless CGE editor reviewing a DRAFT Instagram carousel before it",
    "ships. Raise EVERY slide to the quality bar, then return the full carousel.",
    "",
    "QUALITY BAR:",
    "- Concrete over generic. KILL filler: 'educate/inspire/uplift', 'for all',",
    "  'something for everyone', 'come out and enjoy', 'delicious food', 'great vibes'.",
    "- KILL civic-grant / nonprofit register too: 'authentic cultural spaces',",
    "  'keep diverse traditions alive', 'outside the mainstream', 'vibrant community',",
    "  'preserve', 'celebrate', 'showcase', 'highlights the', 'diverse traditions',",
    "  and the whole '-ing verb + abstract noun' pattern. Rewrite to street-level",
    "  cultural dispatch — a moment, a name, a specific detail — not a grant report.",
    "- KILL sociological fluff — the specific 'academic essayist' register that",
    "  produces nothing you can verify: 'the unseen hand', 'access dictates who',",
    "  'dictates who shows up', 'the fabric of the community', 'the very essence of',",
    "  'at its core', 'speaks to', 'a testament to', 'a reflection of', 'writ large',",
    "  'the way we gather', 'invisible architecture', 'the geography of'. These are",
    "  filler that masquerades as insight. REPLACE with a named transit line, a",
    "  named venue, a named intersection, a specific time, or a specific behavior.",
    "- KILL MFA-workshop purple prose too: 'the sound of silence', 'felt like a ghost",
    "  town', 'now it has a pulse', 'the hum of activity', 'the murmur of conversation',",
    "  'the shared breath of a room', 'a pin drop', 'time stood still', body-metaphor",
    "  for space ('the neighborhood breathes'). These are internet-fiction defaults,",
    "  not observation. Replace with a specific concrete moment: a name, a sound source,",
    "  a real behavior, an actual time of day.",
    "- TEMPORAL INTEGRITY (revival hallucination): If any slide claims a historical",
    "  venue, party, or scene has 'returned', is 'back', 'reopened', or is running a",
    "  'revival' AND the Context bullets do NOT explicitly state that revival, DELETE",
    "  the claim. Rewrite the slide around lasting INFLUENCE, not a fabricated return.",
    "  A room that closed in 2007 does not come back because the copy needs a hook.",
    ...(Array.isArray(historicalContext) && historicalContext.length && today ? [
      `- PAST-DATE PROMOTION BAN (today is ${today}): the following bullets have dates ALREADY IN THE PAST — ${historicalContext.map(b => `"${b.slice(0, 80)}${b.length > 80 ? "..." : ""}"`).join(", ")}. If any slide promotes these dates as UPCOMING, uses "this weekend" / "tonight" / "RSVP" / "save the date" / "don't miss" for them, or treats them as an active calendar drop, REWRITE the slide to frame the date historically ("back in [month]", "[event] kicked off", "the [date] release marked"). Past-tense verbs. Never render a past date as a promo.`,
    ] : []),
    "- ANTI-REGURGITATION: If any slide's headline, kicker, textTitle, or body copy",
    "  quotes the Editorial POV or Cluster Directive verbatim (or with only trivial",
    "  edits), REWRITE it to synthesize the same argument in original prose. POV and",
    "  directive are creative direction, not shipped copy.",
    "- ENTITY ISOLATION: If any slide blends unrelated cities, decades, or venues into",
    "  the same body copy (Newark 1979 + Asbury Park 2024 in one sentence, or two",
    "  named venues from different eras stacked side-by-side), REWRITE to one slide,",
    "  one time, one place, one specific.",
    "- CROSS-SLIDE RESTATEMENT BAN — read the draft end-to-end. If any two slides make",
    "  the SAME CLAIM in different words (a stat paraphrased, a proof restated with new",
    "  adjectives, the same specific dressed up twice), ONE OF THEM IS WRONG. Rewrite the",
    "  later occurrence to advance the argument with something the earlier slide did NOT",
    "  say — a different fact, a different angle, an obstacle, an actor, a mechanism.",
    "  If you genuinely cannot find a distinct thing to say on the later slide, that slide",
    "  has no reason to exist — say so plainly in its copy ('More below.' + one sharper",
    "  line) rather than fill it with a paraphrase.",
    "- The COVER slide must open with a real HOOK — curiosity gap, before→after, a",
    "  number, or a question. Never a bland label like 'First Annual X'.",
    "- Every slide honest (a claim the event actually delivers) and on the CGE voice.",
    "- Name concrete specifics — numbers, places, moments — over vague description.",
    "- PULL-THROUGH (the swipe is the product): read the carousel end-to-end and engineer",
    "  it so a reader can't stop mid-way. Slide 2 continues the cover's hook (pays off its",
    "  curiosity, doesn't restate it). RATION the information — if the draft front-loads",
    "  everything by slide 2 so there's no reason to keep swiping, FIX IT: hold the best",
    "  specific back and move it to the last content slide. Each middle slide should END on a",
    "  fresh open loop the next slide answers, and ESCALATE over the one before it. The FINAL",
    "  slide must reward reaching the end with the payoff it was teasing. Rewrite any slide",
    "  that closes the thread early or leaves the reader with nothing left to wonder.",
    "- CHECK THE SEAMS: read each pair of adjacent slides back-to-back. If slide N+1 doesn't",
    "  obviously CONTINUE slide N (a callback, a bridge word, an echoed phrase), rewrite N+1's",
    "  opening so the handoff is seamless. The set must feel authored as one piece, with a single",
    "  motif running through it — not a stack of on-topic but disconnected cards.",
    ...(today ? [`- Today is ${today}. Correct current year everywhere; never a past year.`] : []),
    ...(letterMode ? [
      "- LETTER / MANIFESTO MODE is ON: the carousel is ONE continuous first-person letter.",
      "  Preserve that — one flowing voice, thoughts that carry slide to slide (ellipses ok),",
      "  intimate 'I/we/you', short beats. Don't chop it back into standalone cards.",
    ] : []),
    ...((mode === "promo")
      ? ["- REGISTER: PROMO — own-event push, more energy, a time pull, a soft invite. No 'don't miss out' clichés."]
      : (mode === "story")
        ? ["- REGISTER: STORY — narrative + human. Keep the arc (setup → tension → turn → payoff), a scene or moment on each beat, emotional truth over hype. Don't flatten it back into dry reporting."]
        : (mode === "content")
          ? ["- REGISTER: CONTENT — cultural infrastructure, not a flyer. 15% curator / 85% observational. Events are the door. Closer is a directory/archive, never RSVP. Do not flatten this back into event promo or memoir."]
          : ["- REGISTER: EDITORIAL — restrained newsroom confidence. Inform, don't sell. PLAIN TALK: intellectual but relevant, kitchen-table wording, no statute numbers."]),
    voiceLine,
    "",
    // Voice params — Distance × Cadence × Stance. Enforced by the
    // polish critic too, so it can catch a slide that drifted to a
    // different distance / cadence than the writer was told to use.
    ...(voiceParams ? [composeVoiceParamsDirective(voiceParams), ""].filter(Boolean) : []),
    ...spineBlock,
    ...(context && context.trim() ? ["Event facts (do NOT invent beyond these):", context.trim(), ""] : []),
    `Topic: ${topic?.trim() || "(unspecified)"}`,
    "",
    "DRAFT (fix in place — a slide that already clears the bar can stay as-is):",
    "",
    draft,
    "",
    "Rules: keep the SAME number of slides in the SAME order, and each slide's SAME",
    "type + JSON fields. Rewrite only the copy.",
    "INVENTION LIMITS (split by category):",
    "  - You MAY NOT invent NUMBERS, DATES, PRICES, PROPER NAMES, CITED FACTS,",
    "    STREET NAMES, CROSS-STREETS, or VENUE NAMES that aren't in the context.",
    "    These are the load-bearing specifics; the operator has to be able to vouch",
    "    for them. Never invent one.",
    "  - You SHOULD add SENSORY / ATMOSPHERIC TEXTURE when a slide reads abstract:",
    "    basslines, late-night door energy, the way a corridor sounds at 11pm,",
    "    what people are actually wearing / drinking / doing. Consistent with the",
    "    cluster + corridor, never a fabricated fact. This is what pulls the copy",
    "    out of civic-report register and into cultural dispatch.",
    // POLISH-CRITIC REFUSAL — new affordance as of the #2 refactor.
    // The critic can now flag a slide as UNRECOVERABLE instead of
    // rewriting it, and the pipeline will respawn that specific slot
    // from scratch with stricter voice constraints. Use sparingly.
    "REFUSAL — you have permission to REFUSE a slide when rewriting won't fix it.",
    "  Refuse when the slide is:",
    "  - Voice-flat: sounds like a grant proposal, a sociology paper, or a museum wall label, and no word-level rewrite would save it.",
    "  - Meta-writing pileup: the slide is fundamentally about the piece / the reader / the pattern instead of the subject.",
    "  - Structurally wrong for its slot type (e.g., a Spotlight whose spotName is an abstract concept instead of a physical entity, and there's no venue in the source to substitute).",
    "  - Empty of specifics: the slide has no name, no date, no metric, no location — nothing to hold onto — and adding one would be fabrication.",
    "  When you refuse a slide, leave its object in the slides array AS THE DRAFT WAS (unchanged), and append its 1-based index to the `unrecoverable` array. The pipeline will respawn it from scratch with a stricter voice constraint. Refuse means 'do not attempt' — do not half-rewrite a slide you're refusing.",
    "  Do NOT abuse this. A slide that just needs a tighter headline is NOT unrecoverable. Refuse only when the whole slide is dead.",
    "",
    "Return JSON ONLY (no fences, no prose) in this exact shape:",
    `{"slides":[${sequence.map(fillSlotShape).join(",")}], "unrecoverable": []}`,
  ].join("\n");

  // Same schema + fallback as the fill call — retry without schema when
  // Gemini rejects it (HTTP layer) OR when the schema-constrained
  // response comes back truncated / unparseable. maxOutputTokens set
  // explicitly so polish doesn't silently truncate.
  const polishBaseConfig = { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 8192 };
  const polishWithSchema = { ...polishBaseConfig, responseSchema: buildFillResponseSchema(sequence) };
  const isSchemaRejection = (err) => {
    const msg = String(err?.message || err || "");
    return /too many states/i.test(msg) || /schema.*constraint/i.test(msg) || /invalid schema/i.test(msg);
  };
  let data;
  let raw;
  let parsed;
  try {
    data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: polishWithSchema,
    });
    raw = extractResponseText(data);
    if (!raw) throw new Error("Empty response from Gemini");
    parsed = extractJson(raw);
  } catch (err) {
    const msg = String(err?.message || err || "");
    const isParseFailure = /did not return valid JSON|Empty response/i.test(msg);
    if (isSchemaRejection(err) || isParseFailure) {
      if (typeof console !== "undefined") {
        console.warn(`Polish schema-attached generation failed (${isSchemaRejection(err) ? "schema-rejection" : "parse-failure"}), retrying without schema:`, msg.slice(0, 240));
        if (raw) console.warn("Truncated/invalid polish raw response (first 500 chars):", String(raw).slice(0, 500));
      }
      data = await geminiGenerate(apiKey, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: polishBaseConfig,
      });
      raw = extractResponseText(data);
      if (!raw) throw new Error("Empty response from Gemini");
      parsed = extractJson(raw);
    } else {
      throw err;
    }
  }
  const out = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (out.length !== sequence.length) throw new Error(`Polish returned ${out.length} slides, expected ${sequence.length}`);
  // Normalize unrecoverable list — 1-based indices, filter to what's
  // actually in range so a critic hallucinating slide 12 in a 6-slide
  // carousel doesn't cause a respawn loop crash.
  const unrecoverableRaw = Array.isArray(parsed?.unrecoverable) ? parsed.unrecoverable : [];
  const unrecoverable = Array.from(new Set(
    unrecoverableRaw
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= sequence.length)
  ));
  if (unrecoverable.length && typeof console !== "undefined") {
    console.info(`Polish critic refused ${unrecoverable.length} slide(s): ${unrecoverable.join(", ")}. Respawning with stricter voice constraints.`);
  }
  return { slides: out, unrecoverable };
}

// A per-call variation token so regenerating with the SAME topic/context
// still produces a genuinely different result instead of the model's single
// "most likely" answer. Math.random is fine here — this is browser app code,
// not the workflow sandbox. Paired with a directive that tells the model to
// diverge, this is what makes "regenerate" actually change the output.
function variationDirective() {
  let seed = "X";
  try { seed = Math.random().toString(36).slice(2, 8).toUpperCase(); } catch { /* noop */ }
  return [
    `FRESH-TAKE TOKEN ${seed} — treat this as a brand-new attempt, not a rerun.`,
    "Deliberately diverge from the most obvious / first-instinct answer: a",
    "different hook archetype, a different opening word, a different sentence",
    "shape. Do NOT reproduce a headline you'd predictably generate first.",
    "─────────────────────────────",
    "",
  ];
}

// Editorial vs Promo must read DIFFERENTLY. A one-liner wasn't enough — these
// give the model a concrete, contrasting spec for voice, POV, energy, and how
// the closer behaves, so the two registers produce visibly different copy.
function registerBlock(mode) {
  if (mode === "content") return [
    "REGISTER: CONTENT — Cover + News in the conversation map the operator ranked, not a 10-slide GST stance hunt.",
    "- If SOURCE MATERIAL has a CONVERSATION MAP, that is the talk. Write Cover + News in that talk.",
    "- Do not import who-benefits / who-owns / diaspora unless the map is Injustice and the desk named that fight.",
    "- GST 10 is optional. Off: essay slots. On: the ranked map still names the talk — GST must not replace it with a who-benefits hunt.",
    "─────────────────────────────",
    "",
  ];
  if (mode === "story") return [
    "REGISTER: STORY — tell this like a STORY, not a listing or a pitch.",
    "- Hero is a PERSON, a MOMENT, or a CHANGE — not logistics. Open on a scene, a moment, or a turn.",
    "- Voice: narrative and human — first- or close-third person ('we', 'here's what happened').",
    "- Arc over facts: set up → tension / stakes → turn → payoff → what it MEANS. Each slide is a BEAT, not a bullet.",
    "- NO MANUFACTURED EMOTION: the feeling must be true to what actually happened. Don't invent 'the room went",
    "  quiet' beats or sentiment the facts don't support — if there's no real emotional turn, tell it plainer.",
    "- NO MFA-WORKSHOP PURPLE PROSE. Story does NOT mean sentimental. Banned tropes: 'the sound of silence',",
    "  'felt like a ghost town', 'now it has a pulse', 'the hum of activity', 'the murmur of conversation',",
    "  'the shared breath of a room', 'a pin drop', 'you could hear a heartbeat', 'the air was thick with',",
    "  'time stood still', body-metaphor for space ('the neighborhood breathes', 'the corridor's heartbeat'),",
    "  '[topic] is dying', 'stitching the community together', 'against the odds', 'the last of its kind'",
    "  (unless the context contains a documented end-of-something specific), and any variant of 'community",
    "  in mourning' framing. These are internet-fiction defaults, not observation. If a slide reads like a",
    "  creative-writing exercise, rewrite it as a specific concrete moment — a name, a sound source, a real",
    "  behavior — instead of a mood.",
    "- TENSION IN THIS BRAND MEANS SYSTEMIC PRESSURE. Full stop. The specific sources of tension for CGE are:",
    "  rent per square foot, permit deadlines, transit gaps and headway, cultural gatekeeping, zoning",
    "  collision, headcount caps, insurance costs, alcohol quotas, curfew ordinances, sound ordinances,",
    "  parking economics, gentrification pricing. NEVER narrative death (dying / silence / ghost town / pulse).",
    "  If your instinct is to eulogize the subject, you are writing the wrong story — the CGE story is that",
    "  the SYSTEMS are visible and mappable, not that the culture is doomed. A story about libraries filling a",
    "  third-place gap reads as 'commercial third places cost $18 a drink; the library is free and open till 9'",
    "  — that is systemic tension. It does NOT read as 'the community was silent until the library opened its",
    "  doors and gave them a home' — that is eulogy.",
    "- Concrete and honest: real details, real people, real stakes; the story must be true to the event.",
    "- Leans into the News slide and Letter/Manifesto mode — 'here's the story behind it'. Logistics last, if at all.",
    "─────────────────────────────",
    "",
  ];
  if (mode === "promo") return [
    "REGISTER: PROMO — this is OUR event and we want people to COME.",
    "- CENTER ON THE EVENT. This whole carousel is about ONE specific event — it is the hero and the",
    "  destination. EVERY slide serves it (its angle, its draw, its details, its vibe). Do NOT wander into",
    "  covering other events, venues, or an abstract trend; if you reference a wider moment, it's only a hook",
    "  that hands straight back to THIS event.",
    "- PIECE THE EVENT TOGETHER FROM THE DESCRIPTION. The details may be written loosely in the context /",
    "  facts — read it and pull out the event's NAME, DATE, TIME, VENUE, CITY, @handle, and TICKET LINK, then",
    "  use them EXACTLY. If a detail isn't stated, leave it out — never invent a date, price, or venue.",
    "- Voice: warm, direct, second-person ('you', 'your weekend'). Speak TO the reader.",
    "- Energy: higher. Use a time pull ('this Saturday', 'doors at 8') and a soft, confident invite.",
    "- BRING IT HOME. The closer makes the next step obvious and carries the event's REAL details",
    "  (date · venue · @handle · link, as pulled from the description) — never a generic 'tag a friend'.",
    "- Still honest and editorial-grade — NEVER 'don't miss out!', 'link in bio!!!', or hype-spam.",
    "─────────────────────────────",
    "",
  ];
  return [
    "REGISTER: GST EDITORIAL — audiovisual science communication for the humanities.",
    "- Destination is UNDERSTANDING + a reusable lens + a clear stance — not a sale and not a recap.",
    "- Pattern + teach + stance under charge and stakes. Omniscient, not neutral fog.",
    "- Inverse hook: thesis up front. Show a mundane NJ moment, then zoom to the structure.",
    "- Sharp, direct, anti-establishment. Kitchen-table wording. No statute numbers.",
    "- Banned sludge: delve, testament, moreover, landscape, unpack, nuanced, vibrant community, hidden gem, don't miss, both sides.",
    "- Closing note / engagement keyword that aims the lens — never urgency, never flyer CTA.",
    "─────────────────────────────",
    "",
  ];
}

// Genre-adaptive creativity. The same open-loop formula makes a nutrition
// fair, a singles mixer, and a 2000s party all read alike. This tells the
// model to FIRST read the event's genre + energy and match the hook, tone,
// and rhythm to IT — and to invent vivid, on-genre specifics when the input
// is thin, so a topic + template alone yields a fully-formed carousel with
// minimal input from the user.
function creativeDirection() {
  return [
    "CREATIVE DIRECTION — read before writing a single line:",
    "- FIRST infer this event's GENRE + ENERGY from the topic. Examples:",
    "    wellness / civic → calm, meaningful, restorative;",
    "    food / market → sensory, communal, abundant;",
    "    singles / social → playful, a little flirty, low-stakes fun;",
    "    nightlife / party → loud, FOMO, after-dark energy;",
    "    arts / culture → curatorial, considered;   sports → stakes, hype.",
    "- MATCH the hook, vocabulary, and rhythm to THAT genre. A wellness fair, a",
    "  singles mixer, and a 2000s throwback party must NOT sound like the same",
    "  post — same brand voice, completely different energy and angle.",
    "- ROTATE hook archetypes to fit the genre; never default to one formula:",
    "  open loop, then→now, a pointed question, a hard number, a contrarian flip,",
    "  a single vivid scene detail. Be clever and surprising, not templated.",
    "- Come with MORE than the input gives you. If details are thin, invent vivid,",
    "  on-genre, realistic specifics (a believable time, a concrete activity, a",
    "  venue mood) so the carousel feels fully-formed and effective on its own —",
    "  the user will fine-tune. Favor concrete texture over generic filler, and",
    "  don't assert unverifiable facts as hard guarantees.",
    "─────────────────────────────",
    "",
  ];
}

// Proven open-loop / scroll-stopping hook frameworks for the COVER. Give the
// model a menu of named structures to rotate through (matched to the event's
// genre) instead of one repeated formula — drawn from what actually works on
// IG carousels. Injected only when the generation involves a cover.
function hookFrameworks() {
  return [
    "COVER SLIDE MANDATE — read before picking a framework:",
    "A statistic is NEVER a hook by itself. Slide 1 must tease the UNSPOKEN REALITY,",
    "PARADOX, or TENSION behind the number — not the number itself. If the source",
    "material is 'X% of Y', the cover names what that number MEANS at street level,",
    "and holds the number itself back for a later slide. A number on the cover is a",
    "flat report; a paradox on the cover is a swipe.",
    "─────────────────────────────",
    "",
    "COVER HOOK FRAMEWORKS — pick the one that fits THIS event's genre; rotate across posts, never reuse the same one every time:",
    "- TEASED OUTCOME: a setup + a withheld payoff. \"We're playing ONE song at midnight that will officially cause a noise complaint…\"",
    "- THE 'WHY' HOOK: name a behavior, promise the reason. \"The [group] does [action] — here's exactly why.\"",
    "- COUNTER-INTUITIVE CLAIM: flip the expectation. \"This isn't what most [X] do — but it's why [result].\"",
    "- UNREVEALED ELEMENT: \"The hidden [thing] nobody tells you about…\"",
    "- INFORMATION ASYMMETRY (status play): imply insiders know a secret. \"The one rule we're forcing every single to follow at Friday's mixer…\"",
    "- INCOMPLETE LISTICLE: promise a list, withhold the best item for later slides (\"the boldest one is on the next slide\") — great for multi-slide swipe.",
    "- PATTERN INTERRUPT: open with something jarring, absurd, or a corrected 'lie' that stops autopilot scrolling.",
    "- THEN → NOW / NUMBER-ANCHORED / SCENE DETAIL are also fair game when they fit.",
    "",
    "CONDITIONAL-ONLY FRAMEWORK (do NOT reach for this by default):",
    "- LOSS / STAKES FRAME is BANNED unless the CONTEXT contains a documented",
    "  end-of-something specific — a real closing date, a permit denial, a lease",
    "  non-renewal, a documented shutdown. If no such specific exists in the material",
    "  the operator supplied, you MAY NOT open on 'dying', 'the last one', 'ghost town',",
    "  'silence', 'we almost lost'. Reach for OPEN LOOP, THEN → NOW, or NUMBER-ANCHORED",
    "  instead. Loss framing without a real loss is manufactured melodrama — the exact",
    "  failure mode this brand refuses to ship.",
    "Hard rules: the open loop MUST be honestly paid off by the rest of the carousel — tease, never mislead. Match the framework to the vibe: a 2000s throwback, a singles mixer, and a wellness fair each demand a DIFFERENT framework and energy.",
    "─────────────────────────────",
    "",
  ];
}

// Nested-open-loop / retention engineering for MULTI-SLIDE carousels. This is
// the fix for the "by slide 2 you already know everything" failure — it forces
// the model to ration information, chain a fresh curiosity gap onto every
// slide, and save the best payoff for the end so there's a reason to swipe all
// the way through. Injected only when there's more than one slide.
function retentionEngineering(slideCount) {
  return [
    `INSIDER DISPATCH ARCHITECTURE — this is a ${slideCount}-slide SWIPE, not ${slideCount} standalone cards. You are writing as an ANALYTICAL CURATOR — an insider whose job is to make systems visible, not to entertain. Build the swipe so a reader can't comfortably stop mid-way; do it through concrete specifics and analytical escalation, NOT through sensationalist storytelling. The word 'retention' as it's used in influencer training pattern-matches to BuzzFeed emotional pageant — that is NOT the register here. The register is a local critic's dispatch:`,
    "- THE FORMULA (the backbone every great carousel runs on): OPEN A LOOP → CREATE TENSION → DELIVER",
    "  THE PAYOFF. In beats: Hook curiosity → tell a story → teach a framework / land the concrete takeaway",
    "  → end with action. Curiosity opens it, the story carries it, a real framework or specific makes it",
    "  worth SAVING, and the close turns attention into action. Aim to earn a save, not just a scroll.",
    "- RATION the information. Do NOT front-load. The single most surprising or valuable",
    "  specific — the payoff — is WITHHELD until the last content slide, never dumped on",
    "  slide 1 or 2. If everything worth knowing fits on the first two slides, it's wrong:",
    "  hold something back and make them swipe for it.",
    "- CHAIN THE LOOPS. Every slide except the last must END by opening a NEW curiosity gap",
    "  that only the NEXT slide answers, while paying off the previous one. The reader should",
    "  finish each slide with a fresh unanswered question, not a closed, complete thought.",
    "- HANDOFFS — make the SEAMS invisible. Each slide's last beat tees up the next, and each",
    "  slide OPENS by continuing the previous one (a callback, a 'but…', a 'here's how…', or by",
    "  echoing a key word/phrase from the slide before). Read any two adjacent slides back-to-",
    "  back: they must sound like consecutive sentences of ONE thought, never two unrelated cards.",
    "- ONE THROUGHLINE — commit to a single motif, phrase, or central image and thread it from",
    "  the cover to the final CTA, so the whole set reads as one authored piece, not N separate posts.",
    "- RULE OUT THE OBVIOUS (especially slide 2). When the cover opens a 'why / what' loop, do",
    "  NOT answer it on slide 2 — instead ELIMINATE the obvious guesses ('This isn't about a",
    "  lack of X. It's not about Y either.'). Killing the easy explanations sharpens the mystery",
    "  and pushes the reader toward the real, non-obvious answer, which you save for later.",
    "- ESCALATE. Each slide raises the stakes, specificity, or surprise over the one before —",
    "  never a flat list of equal-weight facts. Order the beats small→big, ordinary→wild, so",
    "  momentum builds toward the end instead of peaking early.",
    "- SLIDE 2 IS STRICTLY FORBIDDEN from reusing the primary statistic, phrase, or",
    "  named specific from Slide 1. Slide 2's job is to introduce FRICTION or the",
    "  ground obstacle — the wall, the constraint, the trap — that makes the cover's",
    "  tease worth swiping into. If you catch yourself restating slide 1's number in a",
    "  longer sentence, you've written the wrong slide 2: throw it out and write the",
    "  obstacle instead.",
    "- MODERN ANCHOR (historical carousels only): If the material is HISTORICAL —",
    "  the Context bullets reference events, venues, or eras more than 10 years",
    "  past — the FINAL content slide (the beat before the CTA) MUST bridge the",
    "  history to a currently active MODERN physical space: a currently operating",
    "  venue, an active residency, a running collective, a scene that still meets.",
    "  Use a modern-anchor bullet from the Context if one was supplied. Never end",
    "  a historical carousel purely in the past — a carousel that dead-ends in 1979",
    "  reads as museum copy. The final content beat is the 'here's where that",
    "  lineage lives now' payoff, without which the whole arc feels academic.",
    "- THE 'AND?' TEST: after each middle slide the reader should think 'okay… and?'. If a",
    "  slide leaves them fully satisfied with nothing left to wonder, it's in the wrong spot",
    "  or it gave away too much — move the reveal later.",
    "- REWARD THE END. The final slide delivers the payoff the whole carousel was teasing",
    "  (the reveal + the invite), so reaching the end feels earned, not anticlimactic.",
    "- NO MANUFACTURED TENSION. This is the difference between a real hook and a cheesy one.",
    "  Do NOT invent stakes, drama, or rhetorical 'can they pull it off? / will it deliver?'",
    "  questions the facts don't actually raise — that reads as engineered filler. Every open",
    "  loop must be a question a reader GENUINELY wonders given the real material, answered by a",
    "  real fact you're holding back. If the only tension you can find is fake, DON'T force one:",
    "  let a concrete, specific, surprising detail carry the pull instead. Curiosity from truth,",
    "  never contrived suspense. When in doubt, state the vivid real thing rather than tease a",
    "  hollow question.",
    "- Honest always: every loop you open must be truthfully paid off later. Tease, never bait.",
    "─────────────────────────────",
    "",
  ];
}

// Letter / manifesto continuity mode. When on, the whole carousel is written
// as ONE continuous first-person letter (a confession / open letter) whose
// thought flows slide to slide, instead of separate standalone cards — the
// @summerblockfest "This may be the last one…" structure, minus the sad-story
// skin (works for a celebratory or announcement arc just as well). Opt-in.
function letterModeBlock() {
  return [
    "LETTER / MANIFESTO MODE — write the ENTIRE carousel as ONE continuous first-person letter, not separate cards:",
    "- One unbroken voice and one flowing thought across all slides. Sentences may CARRY OVER between slides — a slide can end mid-thought on an ellipsis and the next slide finishes it. It should read like turning the pages of one letter.",
    "- Intimate and direct — 'I', 'we', 'you'. Vulnerable, candid, human. It should feel like a real person talking, not a brand announcing.",
    "- Keep each slide SHORT — a beat or two with lots of breathing room. Slide 1 especially: a single line.",
    "- Emotional arc, not a feature list: a quiet open → the real stakes / the turn → the point → the ask. The last slide lands the message and the invite.",
    "- Do NOT restate the same idea on every slide; each one MOVES the letter forward a step.",
    "- Keep each slot's required JSON fields, but treat the copy as consecutive paragraphs of the same letter (a cover headline is the opening line; a text slide is the next paragraph; the final cta is the sign-off + ask).",
    "This is a STRUCTURE, not a mood — it can carry an exciting announcement or a grateful recap, not only a somber one. Never manufacture fake stakes.",
    "─────────────────────────────",
    "",
  ];
}

// === TEMPORAL FILTER ===
// Detect past dates inside a bullet text. Handles the common patterns
// operators paste in: "Aug 7", "Aug. 23", "August 23", "8/7", "8/7/26".
// If the date's month+day (assuming CURRENT year) is before `today`, the
// bullet is classified as historical. Bullets with no date default to
// current (safe assumption — the writer treats them as evergreen).
//
// Deliberately narrow: we're catching visibly dated bullets, not doing
// full NLP date resolution. Year-less dates default to current year;
// year-with-past-value is also caught. A "Saturday 8pm" without a
// month/day stays current — that's fine (evergreen weekly, not past).
const MONTH_MAP = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};
// Return true when the bullet contains a date within `windowDays` of
// `today` (INCLUDING today itself), so the writer knows this is
// tomorrow's plan, not next month's abstraction. Mirror of
// isBulletDatePast — same regex, same MONTH_MAP, opposite direction.
// Only returns true when we actually found a parseable date; bullets
// with no dates at all fall through as neither past nor imminent.
function isBulletDateImminent(bullet, today, windowDays = 14) {
  if (!bullet || !today) return false;
  const now = new Date(today);
  if (Number.isNaN(now.getTime())) return false;
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const nowDay = now.getDate();
  const nowMs = Date.UTC(nowYear, nowMonth, nowDay);
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const check = (year, month, day) => {
    // Sanity: the parsed date has to be a real one.
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
    if (month < 0 || month > 11 || day < 1 || day > 31) return false;
    const targetMs = Date.UTC(year, month, day);
    const diff = targetMs - nowMs;
    // Imminent = today or up to windowDays in the future.
    return diff >= 0 && diff <= windowMs;
  };
  const monthDayRe = /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/gi;
  let m;
  while ((m = monthDayRe.exec(bullet)) !== null) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : nowYear;
    if (check(year, month, day)) return true;
  }
  const slashRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = slashRe.exec(bullet)) !== null) {
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    let year;
    if (m[3]) {
      const y = parseInt(m[3], 10);
      year = y < 100 ? 2000 + y : y;
    } else {
      year = nowYear;
    }
    if (check(year, month, day)) return true;
  }
  return false;
}

function isBulletDatePast(bullet, today) {
  if (!bullet || !today) return false;
  const now = new Date(today);
  if (Number.isNaN(now.getTime())) return false;
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth();
  const nowDay = now.getDate();
  // Pattern 1: "Aug 7" / "Aug. 23" / "August 23"
  const monthDayRe = /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/gi;
  let m;
  while ((m = monthDayRe.exec(bullet)) !== null) {
    const month = MONTH_MAP[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = m[3] ? parseInt(m[3], 10) : nowYear;
    if (year < nowYear) return true;
    if (year > nowYear) continue;
    if (month < nowMonth) return true;
    if (month > nowMonth) continue;
    if (day < nowDay) return true;
  }
  // Pattern 2: "8/7" / "8/7/26" / "8/7/2026" (US month-first)
  const slashRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  while ((m = slashRe.exec(bullet)) !== null) {
    const month = parseInt(m[1], 10) - 1;
    const day = parseInt(m[2], 10);
    if (month < 0 || month > 11 || day < 1 || day > 31) continue;
    let year;
    if (m[3]) {
      const y = parseInt(m[3], 10);
      year = y < 100 ? 2000 + y : y;
    } else {
      year = nowYear;
    }
    if (year < nowYear) return true;
    if (year > nowYear) continue;
    if (month < nowMonth) return true;
    if (month > nowMonth) continue;
    if (day < nowDay) return true;
  }
  return false;
}

// Parse matrix-shaped context — dashed bullets that each carry one
// atomic fact — so buildTemplatePrompt can steer the model into a
// 1:1 bullet→slot mapping instead of concatenating facts.
//
// Recognizes both "- " and "• " openings (some pipelines normalize
// dashes to bullets). Trims each bullet, drops empties. Returns an
// empty array when the context has no structured bullets, so callers
// can safely check .length.
function parseContextBullets(context) {
  if (typeof context !== "string" || !context.trim()) return [];
  const lines = context.split(/\r?\n/);
  const bullets = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*(?:[-•*]|\d+[.)])\s+(.+?)\s*$/);
    if (m && m[1]) bullets.push(m[1]);
  }
  return bullets;
}

// Writer parameter surface — deliberately narrow as of the #2+#4 refactor.
// Absorbed upstream (into the spine) or moved downstream (to polish):
// clusterDirective + clusterLabel (spine absorbs), voiceParams (polish
// only). Kept: sequence, topic, context, historicalContext,
// imminentBullets (used per-slide as a [TIMELY] flag on reserved proofs),
// voice (brand fingerprint), slotPrompts, templateMeta, mode, today,
// letterMode, narrativeSpine. Every field the writer sees here has a
// direct impact on how a slide is written. If it doesn't, cut it.
function buildTemplatePrompt({ sequence, topic, context, historicalContext = [], imminentBullets = [], voice, slotPrompts, templateMeta, mode, today, letterMode = false, narrativeSpine = null, behavioralTags = null, isEvergreen = false, rejectedDrafts = [], approvedDrafts = [] }) {
  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const exemplars = Array.isArray(voice?.exemplars) ? voice.exemplars.filter(e => e && e.trim()) : [];
  const hasExemplars = exemplars.length > 0;

  // Detect matrix-shaped context (POV: ... + "- bullet" lines) so we can
  // teach the model to map each bullet 1:1 to a slot instead of cramming
  // multiple facts onto one slide. Seeded from CuratorialMatrixModal's
  // Preview Carousel via eventMatrixToFillSeed — the seed helper writes
  // exactly this format. Any other caller that happens to use dashed
  // bullets in context benefits too; the directive is bullet-shape
  // agnostic beyond that.
  const atomicBullets = parseContextBullets(context);
  const atomicSlotCount = sequence.filter((t) => t === "text" || t === "spotlight" || t === "stat").length;

  const voiceBlock = (hasVoiceDesc || hasExemplars) ? [
    "BRAND VOICE FINGERPRINT — every slide MUST sound like this voice.",
    "",
    ...(hasVoiceDesc ? [
      "Voice description:",
      voice.description.trim(),
      "",
    ] : []),
    ...(hasExemplars ? [
      `Past captions in this voice (${exemplars.length} examples — study cadence, sentence length, what gets named vs implied):`,
      "",
      ...exemplars.map((e, i) => `=== Example ${i + 1} ===\n${e.trim()}`),
      "",
    ] : []),
    "─────────────────────────────",
    "",
  ] : [];

  // Build per-slot instructions. Count spotlight occurrences so the
  // prompt can hint at numbered/listicle structure when there are many.
  const spotlightCount = sequence.filter(t => t === "spotlight").length;

  const slotInstructionBlock = sequence.map((slotType, idx) => {
    const rule = slotPrompts?.[slotType];
    const refBlock = formatSlotReferenceBlock(slotType);
    const refPrefix = refBlock.length ? refBlock.join("\n") + "\n" : "";
    // SLOT PURPOSE DOCTRINE — quote the reader-job spec at the top of
    // each per-slot instruction so the writer is writing FOR a reader
    // outcome ("what the reader walks away with"), not just filling
    // JSON fields. The doctrine lives in slotDoctrine.js; only slots
    // registered there get the block, so unknown / legacy slot types
    // fall through cleanly.
    const doctrinePrompt = formatSlotDoctrineForPrompt(slotType, {
      content: isContentRegister(mode, isEvergreen),
    });
    const doctrinePrefix = doctrinePrompt ? `${doctrinePrompt}\n` : "";
    // Per-slide beat + proof prefix from the narrative spine — reminds the
    // model AT the slot instruction site (where recency bias is strongest)
    // which beat this slide serves AND which single proof bullet (if any)
    // is reserved for this slide. Reserving proof per-slide is what stops
    // the paraphrase-across-slides failure mode when material is thin.
    const beatLabel = (narrativeSpine && Array.isArray(narrativeSpine.slideAssignments))
      ? narrativeSpine.slideAssignments[idx]
      : null;
    const slideNum = idx + 1;
    const reservedProof = (narrativeSpine && narrativeSpine.proofAssignments)
      ? Object.entries(narrativeSpine.proofAssignments).find(([, s]) => Number(s) === slideNum)?.[0]
      : null;
    // TIMELY per-slide flag — cheap prefix scan against imminentBullets
    // (matches proofAssignments' first-60-char key). Set when the
    // reserved proof for this specific slide is one of the imminent
    // ones. The writer sees the flag exactly where it needs to act.
    const reservedProofIsTimely = reservedProof && Array.isArray(imminentBullets)
      && imminentBullets.some((b) => String(b || "").toLowerCase().startsWith(String(reservedProof).toLowerCase()));
    const timelyClause = reservedProofIsTimely
      ? ` [TIMELY — this bullet's date falls within 14 days${today ? ` of ${today}` : ""}; this slide MUST name the date AND entity verbatim as written in the reserved proof, no abstract substitutes, no historical framing, no sensory poetry replacement.]`
      : "";
    // Cover slots get the Macro-Cover Mandate directive — umbrella, no
    // specific-entity anchor. All other slots get the standard beat +
    // Reserved PROOF (or the no-proof fallback) directive.
    //
    // SHOWCASE mode override: when the spine is in showcase mode, non-
    // cover peer entries share the "SHOWCASE" beat label by design.
    // A generic "this slide advances ONLY this beat" clause reads as
    // "make it different from slides 2 and 4 that ALSO advance
    // SHOWCASE" — that fights the whole point of a directory carousel.
    // Reword to signal peer-entry semantics instead.
    const spineMode = narrativeSpine?.spineMode || "insight";
    const isShowcasePeer = spineMode === "showcase" && beatLabel === "SHOWCASE";
    const beatPrefix = beatLabel
      ? (slotType === "cover"
          ? `>>> BEAT: ${beatLabel} — MACRO-COVER: locate THIS specimen. If this beat is CONTRAST, title the two expressions Fuel already proved. If this beat is LOCATE, name who / what / where / when. Subtitle connects. Do NOT invent a contrast. Do NOT write "is gone". Do NOT write category mush ("discover surprising gathering spots"). Do NOT withhold the point so they swipe. Instances land on later slides, inside paragraphs — not peeled onto venue cards. <<<\n`
          : isShowcasePeer
            ? `>>> BEAT: SHOWCASE — this is a PEER ENTRY in a directory. Slides sharing this label are equal-weight entries in the collection — do NOT position this one as "the next phase" of an argument the previous slide started. Each SHOWCASE slide carries ONE distinct entity from the collection. ${reservedProof ? `Reserved PROOF (entity) for this slide: "${reservedProof}..." — this entity lands HERE and NOWHERE ELSE in the carousel.${timelyClause}` : "NO proof entity is reserved for this slide — do NOT reach for an entity already assigned to another peer slot; carry this entry with a specific from context marked 'context' or leave it lighter than the sibling entries."} <<<\n`
            : `>>> BEAT: ${beatLabel} — this slide advances ONLY this beat, no other.${reservedProof ? ` Reserved PROOF for this slide: "${reservedProof}..." — this bullet lands HERE and NOWHERE ELSE in the carousel.${timelyClause}` : " NO proof bullet is reserved for this slide — do NOT reach for a proof already assigned to another slide; carry the beat with tension, framing, or a specific from context marked 'context' (not 'proof')."} <<<\n`)
      : "";
    if (!rule) {
      return `SLIDE ${idx + 1} (${slotType.toUpperCase()}) — no rule defined; produce reasonable defaults matching brand voice.\n${doctrinePrefix}${beatPrefix}${refPrefix}`;
    }
    let extra = "";
    if (letterMode) {
      // In letter mode the directory / features-grid / spotlight-burst
      // instructions fight the one-continuous-letter voice, so they visibly
      // "don't work". Replace them with a paragraph-of-the-letter instruction.
      extra = "\n\nLETTER MODE: write this slot as the NEXT PARAGRAPH of one continuous letter — carry the thought from the slide before and hand off to the next. Keep this slot's JSON fields, but the copy is a beat of the letter, NOT a standalone card, directory listing, or feature grid.";
    } else if (slotType === "spotlight" && spotlightCount > 1) {
      // For multi-Spotlight templates (Feature Drop), tell Gemini to break
      // the context into N distinct angles and have each Spotlight cover
      // ONE angle. This is the Spotlight Burst behavior — automatic.
      const spotIdxAmong = sequence.slice(0, idx).filter(t => t === "spotlight").length + 1;
      extra = `\n\nThis is Spotlight ${spotIdxAmong} of ${spotlightCount}. Each Spotlight MUST cover a DIFFERENT unit from the context, and they must not repeat. Follow the TEMPLATE's key move for what a Spotlight IS here: for a single-event template each Spotlight is a distinct selling-point/feature of that ONE event; for a list/guide template each Spotlight is a distinct PLACE/venue (spotName = the place's name, spotMeta = its neighborhood/town, and spotTime/spotPrice/spotCta carry a practical detail like hours, price range, or 'get the X'). Vary what you praise across the ${spotlightCount} so they don't blur together.`;
    } else if (slotType === "cta" && sequence.filter(t => t === "cta").length > 1) {
      // Multi-CTA (Editorial Roundup directory pattern). Each CTA maps
      // to ONE event from the context.
      const ctaIdxAmong = sequence.slice(0, idx).filter(t => t === "cta").length + 1;
      const ctaTotal = sequence.filter(t => t === "cta").length;
      extra = `\n\nThis is CTA ${ctaIdxAmong} of ${ctaTotal}. Each CTA is a DIRECTORY LISTING for ONE event. ctaKicker stays BLANK. ctaDate slot becomes the EVENT NAME (uppercased big-bold headline of the card). ctaVenue slot is "<venue> · <day> · <time>". ctaUrl is that event's URL or page link. Pick a DIFFERENT event from the context for each CTA — don't repeat. If context lists fewer events than CTAs, invent plausible ones grounded in the topic.`;
    } else if (slotType === "news") {
      extra = "\n\nNEWS slide — a SUPPORTING explainer beat, not a cover. Open a small loop, hold a beat, land the payoff. newsKicker = a 1-3 word eyebrow (BREAKING / THE BACKSTORY / WHY IT MATTERS / THE BIGGER PICTURE). newsHeadline = an optional short heading, or empty. newsBody follows SENTENCE CADENCE — do NOT default to one sentence per line. Conversational or rolling (the default): 1-2 short paragraphs of supporting copy. Stacked (only when that cadence is chosen): one thought per line, blank line before the payoff. End on ONE payoff line wrapped in *asterisks* so it bolds (exactly one). Real reported substance, not a repeat of the cover. Every specific must be true; never manufacture drama. newsBold true only for a genuinely urgent breaking beat.";
    } else if (slotType === "features") {
      // The Features slot is the one most prone to filler because each card is
      // tiny — force concrete promises and a single standout card.
      extra = `\n\nFEATURES: give 3-5 cards. Each card is ONE concrete, specific promise — name the REAL thing (the actual DJ, the exact activity, the real giveaway/prize, the specific format), never a vague benefit. BAN 'good vibes', 'great music', 'fun for all', 'something for everyone', 'good food'. headline = 2-4 punchy words; sub = one concrete detail (a name, a time, a number). Set featured:true on exactly ONE card — the single biggest draw (the headliner / the giveaway) — and featured:false on the rest. Still give each card an apt emoji in case the icon style is used.`;
    }
    // SPOTLIGHT PHYSICAL-FOOTPRINT CONTRACT — always applies to spotlight
    // slots (single or multi), regardless of letter mode override above.
    // A Spotlight represents a real thing with an address, not a concept.
    // Without this, the model uses Spotlight for abstractions like
    // "THE 10:51 PM DEPARTURE" or "THE THIRD PLACE VOID", which is
    // rendered as a directory-card format wanting an entity name.
    if (slotType === "spotlight" && !letterMode) {
      extra += "\n\nSPOTLIGHT CONTRACT — non-negotiable: a Spotlight slot represents a CONCRETE ENTITY with a PHYSICAL FOOTPRINT. Valid Spotlight subjects: a specific venue with an address, a transit station with a stop name, a park with a location, a business with a storefront, an organization with a membership address, a specific piece of infrastructure. INVALID Spotlight subjects: an abstract concept ('The Third Place Void'), a policy or ordinance ('1:3,000 Liquor Cap'), a price ('$1.25M License Cost'), a schedule constraint ('The 10:51 PM Departure'), a demographic pattern, a market trend. spotName MUST be a proper name of a real thing. spotMeta MUST be its physical location (neighborhood, corner, or transit stop). If the Reserved PROOF bullet for this slide is abstract, ELEVATE it to the physical space it manifests in — and if no physical space exists in the context, this slot is the wrong shape for this material and you should carry the beat with concrete descriptive text (still naming a real place, not the abstraction itself).";
    }
    // Anti-Haiku formatting rule — scoped to text and spotlight, NOT news
    // (news is designed as stacked lines with a bold payoff and needs to
    // stay that way). Prevents the "haiku spacing" leak where the model
    // renders textBody as one-sentence-per-line stanzas separated by hard
    // returns, which reads as a formatting hack, not writing.
    if ((slotType === "text" || slotType === "spotlight") && !letterMode) {
      extra += "\n\nANTI-HAIKU FORMATTING: write this slot's body copy as ONE cohesive flowing thought — a paragraph, or one to two connected sentences. NO disjointed single-sentence stanzas, NO hard returns between every sentence, NO stacked-line 'haiku' layout. Hard returns between sentences read as a formatting hack; write it as prose.";
    }
    return `SLIDE ${idx + 1} (${slotType.toUpperCase()}):\n${doctrinePrefix}${beatPrefix}${refPrefix}${rule}${extra}`;
  }).join("\n\n─────────────────────────────\n\n");

  const purposeBlock = formatTemplatePurposeBlock(templateMeta);

  return [
    ...voiceBlock,
    ...purposeBlock,
    "You are generating an ENTIRE editorial Instagram carousel for CGE. The slides will be exported in order — write them as ONE coherent story, not isolated cards.",
    "",
    "NODE 1 — STRUCTURE PASS: your primary job here is STRUCTURE, FACTS, and ROUTING under schema pressure. The BRAND VOICE FINGERPRINT block above is signal, not a straitjacket — a downstream Node 2 (Voice Pass) will rewrite text-string field values to lock voice cadence, stance, and distance without touching JSON shape, facts, or routing. So: hit the schema, honor the beat + reserved proof for each slide. One beat per slide. A starting point may color a beat — do not turn the carousel into a directory of starting points. If a slot's material is thin, keep it short and specific rather than padding — Node 2 can only rewrite what you route correctly, it cannot rescue empty structure or misrouted facts.",
    "",
    // FEEDBACK MEMORY — operator's Reject / Approve history for THIS matrix.
    // Rejections come with a reason ("wall of text on cover", "slide 3 empty",
    // "voice drifted grantwriter") so the writer can specifically avoid the
    // named failure mode. Approvals hold the quality bar without a reason.
    // Injected near the TOP so recency bias amplifies it — this is
    // per-matrix training signal from the human editor, not decoration.
    ...(Array.isArray(rejectedDrafts) && rejectedDrafts.length ? [
      "═════════════════════════════",
      "FEEDBACK MEMORY — REJECTED DRAFTS OF THIS MATRIX",
      "═════════════════════════════",
      `The operator rejected ${rejectedDrafts.length} previous draft${rejectedDrafts.length === 1 ? "" : "s"} of this matrix. DO NOT reproduce the named failure modes.`,
      "",
      ...rejectedDrafts.slice(-3).map((r, i) => {
        const reason = String(r?.reason || "(no reason recorded)").trim();
        const digestLines = Array.isArray(r?.digest)
          ? r.digest.slice(0, 8).map((d) => `    Slide ${d?.idx ?? "?"} (${d?.type ?? "unknown"}): ${String(d?.digest || "").slice(0, 80)}`)
          : [];
        return [
          `Rejected draft ${i + 1} — REASON: ${reason}`,
          ...digestLines,
        ].join("\n");
      }),
      "",
      "The reasons above are the OPERATOR's exact complaint. Fix each named failure mode in this new draft — a wall-of-text complaint means shorter, punchier copy on that slide; an empty-slide complaint means the routing for that slot needs to land a real fact; a voice-drift complaint means avoiding the flagged register (grantwriter / marketer / museum copy).",
      "═════════════════════════════",
      "",
    ] : []),
    ...(Array.isArray(approvedDrafts) && approvedDrafts.length ? [
      "═════════════════════════════",
      "FEEDBACK MEMORY — APPROVED DRAFTS OF THIS MATRIX",
      "═════════════════════════════",
      `The operator approved ${approvedDrafts.length} previous draft${approvedDrafts.length === 1 ? "" : "s"} of this matrix. Hold at least this quality bar — study the digest to match the SHAPE (how much per slide, which fields carry which weight, how facts are compressed) even though this is a fresh draft.`,
      "",
      ...approvedDrafts.slice(-2).map((a, i) => {
        const digestLines = Array.isArray(a?.digest)
          ? a.digest.slice(0, 8).map((d) => `    Slide ${d?.idx ?? "?"} (${d?.type ?? "unknown"}): ${String(d?.digest || "").slice(0, 80)}`)
          : [];
        return [
          `Approved draft ${i + 1}:`,
          ...digestLines,
        ].join("\n");
      }),
      "",
      "═════════════════════════════",
      "",
    ] : []),
    "QUALITY BAR — applies to EVERY slide, not just the cover:",
    "- ANTI-LITERALISM: The prompt uses labels like PARADOX, FRICTION, MECHANISM, GATE, SPECIMEN, PATTERN, JOIN, DOOR, CONTRAST, CAUSE, EXPLAIN, NEXT, and marker lines like '>>> BEAT: X <<<' as INTERNAL SCAFFOLDING for the outline. These are concepts, NOT visible copy. NEVER write these labels as text, headlines, kickers, or body — a cover headline that reads 'THE PARADOX' or 'THE JOIN' or a textTitle that reads 'FRICTION' or a kicker that reads 'THE CONTRAST' is failed output. Same rule for the words 'THESIS' and 'BEAT' — those are outline metadata. Every field you emit should be finished editorial copy that stands on its own.",
    "- DATA SYNTHESIS (not transcription): The Context bullets are RAW EVIDENCE, not a script. You must WEAVE these facts naturally into the narrative argument defined by the Editorial POV. Do NOT copy or paste a bullet verbatim into a slide slot. Do NOT paraphrase a bullet as its own slide-length sentence. Subordinate the facts to the story — a bullet like 'Club Zanzibar, 1979, Lincoln Motel Newark' becomes 'the Newark motel ballroom that rewrote the Jersey Sound in '79', not a repeat of the raw bullet. The bullets are ingredients; you're cooking.",
    "- ANTI-REGURGITATION: The Editorial POV and Cluster Directive are INVISIBLE creative direction — they steer your tone and framing. DO NOT copy or paste the POV or directive text verbatim into any slide's headline, kicker, title, or body. If a reader sees the exact string of the POV appear on a slide, you failed. Synthesize original prose that EMBODIES the POV's argument instead of quoting it.",
    "- TEMPORAL INTEGRITY: NEVER invent modern revivals, reopenings, comebacks, or 'it's back' claims for historical entities unless the Context bullets EXPLICITLY state the revival. If a venue was demolished, closed, or ended decades ago and no supplied bullet names a modern successor, frame the tension around lasting INFLUENCE, not a fabricated return. A defunct room can shape today's rooms without being 'back'.",
    ...(isContentRegister(mode, isEvergreen)
      ? [
        "- CONNECTION MANDATE: names and numbers live INSIDE the explanation. Sunken Silo and Autodidact belong in the same Route 22 paragraph when they are the same expression. Do not isolate one venue per slide. Do not peel 1:3000 onto its own card.",
        "- PARAGRAPH MANDATE: textBody / newsBody / subtitle are 2-5 connecting sentences that explain WHY. textTitle / newsHeadline name the SECTION ('Route 22's Parking Lot Breweries'), not a stacked manifesto. Five short sentences banging the same point is a failed slide.",
        "- BANNED sociological fluff still applies: 'the unseen hand', 'the fabric of the community', 'the very essence of', 'at its core', 'speaks to', 'a testament to'. Explain with the brief's names instead.",
      ]
      : [
        "- ENTITY ISOLATION: Do NOT blend unrelated cities, decades, or venues into a single slide — EXCEPT a JOIN beat IF the brief already named a sideways document, parallel room, or disappearance. JOIN is optional. If there is no JOIN beat, every slide stays one time, one place, one specific. A JOIN slide that only restates the specimen failed. A non-JOIN slide that montages two cities failed.",
        "- FACT-DENSITY MANDATE: every slide MUST name a specific concrete entity from the material — a transit line, a venue, an intersection, a corridor, a specific ordinance number, a named collective, a specific time-of-day, an actual price point. BANNED sociological fluff: 'the unseen hand', 'access dictates who shows up', 'the fabric of the community', 'the very essence of', 'at its core', 'speaks to', 'a testament to', 'invisible architecture', 'the geography of', 'the way we gather'. These read as academic essay filler and mask the absence of specifics. If your instinct is to write one of those phrases, you're missing a concrete anchor — pull one from the assigned bullet or a context bullet marked 'context', or name the physical place / time / rule the material implies.",
        "- ATOMICITY MANDATE: EACH FIELD CARRIES ONE ATOMIC UNIT. One venue name in spotName, one address in spotMeta, one date in ctaDate, one time in spotTime. If your instinct is to stack Metuchen + Aug 7 + address + Album Club pitch + Crossroads into a single spotMeta separated by `·` or `|`, you're using the WRONG SLOT TYPE for the material and the field will be flagged as a data-dump. Split into multiple slides, or leave the extras out. Rule of thumb: if a field would contain more than TWO `·` separators, or more than ONE date, or BOTH an address AND a date, it's a violation.",
      ]),
    "- FIELD DISCIPLINE: Title / headline / label / kicker fields (headline, textTitle, spotName, kicker, ctaKicker, statLabel, newsHeadline, newsKicker, accentWord, pressTitle, pressBadge, countEvent, countCta, spotTime, spotPrice, spotCta) are SHORT LABELS — one clause, aim under 60 characters. Body fields (textBody, newsBody, subtitle, spotMeta, subLine, statSub, countText, caption, pressLineup) carry the sentences. If a title field reads like body copy — two sentences separated by a period, multiple ideas stacked — you're in the wrong field: move it to the body and shorten the title. Example of failed output: `textTitle: \"Young's Skating Center keeps a hardwood ritual alive. Forget the casino strip.\"` That's two sentences of body prose stuffed into a title slot. Correct: `textTitle: \"THE HARDWOOD RITUAL\"`, `textBody: \"Young's Skating Center keeps Friday nights alive off the casino strip.\"`",
    "- TEXT SLOT — worked examples (title is a LABEL, body is the PROSE):",
    "    FAILED: `textTitle: \"Route 1 is trading volume for curated sound. Here's why.\"` `textBody: \"\"` — title carries the whole thought, body is empty. Reader has nothing to read.",
    "    FAILED: `textTitle: \"THE OLD PLAYBOOK IS GETTING COMPLICATED\"` `textBody: \"THE OLD PLAYBOOK IS GETTING COMPLICATED. Route 1 is trading volume for curated sound.\"` — body repeats the title verbatim.",
    "    CORRECT: `textTitle: \"THE OLD PLAYBOOK\"` `textBody: \"Route 1's nightlife is trading volume for curated sound — small rooms, quiet systems, deliberate curation. The mega-clubs kept the branding; they lost the ear.\"` — title is a 2-4 word LABEL that names the beat; body carries the actual sentence(s) that pay it off.",
    "- COVER SLOT — worked examples (headline is the HOOK, subtitle is the PROMISE):",
    "    FAILED: `headline: \"CENTRAL GROUP EVENTS. HERE'S WHY. THE OLD PLAYBOOK IS GETTING COMPLICATED. TAP THROUGH FOR THE FULL STORY.\"` — whole caption dumped into headline; not a hook, four different sentences fused together.",
    "    FAILED: `headline: \"Village Brewing Underground opens Friday 9pm-2am\"` — anchored on ONE specific venue (Macro-Cover Mandate violation — cover is umbrella, specifics land on slides 2+).",
    "    FAILED: `headline: \"Did your commuter community? Discover surprising new gathering spots.\"` — listicle mush. Google already named Route 22, the strip, Cranford. Teach that contrast.",
    "    CORRECT: `headline: \"ROUTE 1'S NIGHTLIFE IS WHISPERING AGAIN.\"` `subtitle: \"The rooms that replaced the mega-clubs — and what they know that the old playbook forgot.\"` — headline is the umbrella claim, opens the curiosity loop; subtitle sets the promise the rest of the carousel pays off.",
    "    CORRECT: `headline: \"WALKER'S PARADISE VS THE STRIP.\"` `subtitle: \"Route 22 still gathers in a parking lot. Cranford retrofitted the downtown.\"` — named NJ contrast, not a listing.",
    "- Write in the register of street-level neighborhood critique (anti-hype, no-nonsense local insider). Focus strictly on the input topic/event—do not pivot to unrelated domains (like food/restaurants or party vibes) unless the input specifically describes them.",
    "- BANNED CLICHÉS: Never use 'hidden gem', 'must-visit', 'good vibes', 'scenic view', 'great music', 'experience like no other', 'unforgettable', 'movie', 'can't-miss', 'movie vibes', 'something for everyone', 'discover surprising', 'new gathering spots', 'did your community', or 'did you know'. If you write these, the editor will reject it.",
    "- Be extremely specific about location: name the neighborhood (e.g., Ironbound, Heights, Downtown) or specific cross-streets/landmarks rather than just a generic town name.",
    "- Concrete over generic. Name the real thing — a number, a place, a moment.",
    "  BAN vague filler: 'educate, inspire, and uplift', 'for all', 'something for",
    "  everyone', 'fun for the whole family', 'come out and enjoy'.",
    "- The COVER must open with a real HOOK — a named NJ contrast, a before→after, a",
    "  number, or a pointed question. NEVER a bland label like 'First Annual X'. NEVER",
    "  a listicle ('discover surprising gathering spots'). NEVER 'THE SOCIAL LIFE IS GONE'.",
    ...(isContentRegister(mode, isEvergreen)
      ? [
        "- Cover = contrast title + connecting subtitle. Do not withhold the point so they swipe. Slide 2 explains the cause. The FINAL slide is the next question that explanation opened — never a directory door, never 'find your next gathering spot'.",
      ]
      : [
        "- PREFER AN OPEN LOOP on the cover whenever the story supports it: a setup +",
        "  a withheld payoff that forces the swipe ('This Jersey mall was left for",
        "  dead. Saturday, it wakes up.'). It outperforms a plain descriptive line.",
        "- Honest always: a hook the rest of the carousel actually pays off. Tease, never mislead.",
        "- PULL-THROUGH (hold attention to the END): SLIDE 2 must CONTINUE the cover's hook —",
        "  open by paying off its curiosity ('Here's what happened…', 'How it came back…'), not",
        "  a generic thesis. Every slide should make the reader want the next; escalate concrete",
        "  specifics through the middle. The FINAL slide must REWARD reaching the end (a payoff +",
        "  the invite), not a limp 'link in bio'.",
      ]),
    ...(today ? [`- Today is ${today}. Use the correct current year everywhere; never default to a past year.`] : []),
    "",
    ...(isContentRegister(mode, isEvergreen) ? contentMethodBlock() : []),
    ...(isContentRegister(mode, isEvergreen) ? contentCreativeDirection() : creativeDirection()),
    ...(!isContentRegister(mode, isEvergreen) && mode === "editorial" ? editorialBuildFormulaBlock() : []),
    ...(!isContentRegister(mode, isEvergreen) && mode === "editorial" ? cadenceRotationBlock() : []),
    ...(sequence.includes("cover") && !isContentRegister(mode, isEvergreen) ? hookFrameworks() : []),
    ...(sequence.length > 2 && !isContentRegister(mode, isEvergreen) ? retentionEngineering(sequence.length) : []),
    ...(letterMode ? letterModeBlock() : []),
    ...platformThesisBlock({ mode, isEvergreen }),
    ...conversationWriterBlock(context),
    ...registerBlock(mode),
    // BEHAVIORAL TAGS — the operator's dimension picks (Emotion,
    // Demographic, Cluster label) are BEHAVIORAL CONSTRAINTS for the
    // writer, not vocabulary the reader is meant to see. This block
    // names them explicitly and forbids literal quotation, preventing
    // the "Tag the young working professionals" or "for diaspora
    // networks and corporate-to-creative hybrids" leakage into
    // shipped copy.
    ...(behavioralTags && (behavioralTags.emotion || (behavioralTags.demographics && behavioralTags.demographics.length) || behavioralTags.clusterLabel) ? [
      "═════════════════════════════",
      "BEHAVIORAL TAGS — these define who this piece is FOR and what emotional register to write in. They are INSTRUCTIONS to you, not vocabulary to reuse.",
      ...(behavioralTags.emotion ? [`  Target Emotion (write in this register): ${behavioralTags.emotion}`] : []),
      ...(behavioralTags.demographics && behavioralTags.demographics.length ? [`  Target Demographic (audience mental model): ${behavioralTags.demographics.join(", ")}`] : []),
      ...(behavioralTags.clusterLabel ? [`  Content Cluster (editorial identity): ${behavioralTags.clusterLabel}`] : []),
      "",
      "STRICTLY BANNED: quoting any of these labels verbatim in the shipped copy. Do NOT write phrases like 'Tag the [demographic]', 'For [demographic] and [demographic]', 'For diaspora networks and corporate-to-creative hybrids', or any variant that names the audience as if the reader is a demographic bucket. Do NOT paste the cluster label into a slide title. Do NOT name the emotion ('urgency', 'nostalgia') as vocabulary — the emotion is HOW you write, not WHAT you write. If you find yourself typing any of these tags into a slide, you've broken the rule.",
      "═════════════════════════════",
      "",
    ] : []),
    // FEATURE-TIER EVERGREEN GUARD — when isEvergreen (tier === FEATURE),
    // the whole carousel is a dateless editorial piece. Ban all
    // promotional and calendar language explicitly. This is stronger
    // than the mode's register block alone.
    ...(isEvergreen ? [
      "═════════════════════════════",
      "EVERGREEN MANDATE — this carousel is a FEATURE / Content piece: cultural coverage, no calendar attached. Every slide must be dateless in intent.",
      "  STRICTLY BANNED across every slide:",
      "  - Specific dates ('September 19', 'Sept 26', 'Friday the 27th') anywhere in copy",
      "  - Future-tense promo language ('come out', 'save the date', 'RSVP', 'don't miss', 'this weekend', 'tonight', 'coming up', 'pull up', 'doors at')",
      "  - Calendar drops ('happening [date]', 'on [day]')",
      "  - Countdown framing ('T-minus', 'in [N] days')",
      "  REQUIRED framing instead: durable present tense that describes what THESE PLACES / PATTERNS / LINEAGES ARE, not when to catch a night. 'The hall still opens on Sundays' is fine. 'Come through this Sunday' is banned.",
      "  If a slot type would normally carry a date field (ctaDate, spotTime), fill it with the DURABLE HOURS pattern ('Sundays 2-6 PM', 'Weekends from 8 AM') — never a specific calendar date.",
      "═════════════════════════════",
      "",
    ] : []),
    // WRITER PARAMETER SURFACE — cut deliberately as of the #2+#4
    // refactor. The writer no longer sees: the cluster LENS text
    // (spine's causalSynthesis absorbs it), voice params (they run
    // at the polish stage where voice-level rewrite belongs), the
    // TIMELY ACTION top-level block (annotated per-slide on the
    // reserved-proof line instead), or the RELEVANCE VETO block
    // (spine's proofAssignments already routed bullets). Every
    // additional instruction here is a token of attention stolen
    // from voice. If a rule needs to reach the writer, it goes
    // through the spine.
    // NARRATIVE SPINE — the outline the model must follow. Rendered as its
    // own top-level block above topic + context so the beat map anchors the
    // model's attention before the raw material lands. Each slide gets a
    // per-slide beat label injected into slotInstructionBlock (see below).
    ...(narrativeSpine && narrativeSpine.thesis ? [
      "═════════════════════════════",
      "NARRATIVE SPINE — the outline every slide must serve. Do NOT improvise a different arc:",
      "",
      `THESIS: ${narrativeSpine.thesis}`,
      ...(narrativeSpine.causalSynthesis ? [
        "",
        isContentRegister(mode, isEvergreen)
          ? "CAUSAL SYNTHESIS — the completed reasoning behind this carousel. Your job as writer is VOICE + FORMAT, NOT re-derivation. Do NOT rewrite this reasoning; every slide must be consistent with it. If it names a contrast, explain that connection. If it only locates, stay on that specimen — do not invent a cause, a venue card, or a stat:"
          : "CAUSAL SYNTHESIS — the completed reasoning behind this carousel. Your job as writer is VOICE + FORMAT, NOT re-derivation. Do NOT rewrite this reasoning; every slide must be consistent with it. If it names a rule → response, dramatize that chain. If it only locates, stay on that specimen — do not invent a hidden machine:",
        `  ${narrativeSpine.causalSynthesis}`,
      ] : []),
      "",
      "BEATS (in order):",
      ...narrativeSpine.beats.map((b, i) => `  ${i + 1}. ${b.label}: ${b.description}`),
      "",
      "SLIDE-TO-BEAT ASSIGNMENT — each slide serves ONE beat and only that beat:",
      ...narrativeSpine.slideAssignments.map((a, i) => `  Slide ${i + 1}: ${a}`),
      "",
      "Rules that follow from the spine:",
      "- Do not restate the thesis on every slide — the thesis is the frame, not the copy. Each slide advances ONE beat.",
      ...(isContentRegister(mode, isEvergreen) ? [
        "- A slide labeled LOCATE names who / what / where / when. Not a contrast you invented.",
        "- A slide labeled NEWS is the proving paragraph for what is already on this desk.",
        "- A slide labeled CONTRAST names the two expressions already on the brief. Not 'is gone'. Not a withheld loop.",
        "- A slide labeled CAUSE articulates how a pressure the brief already named produced those expressions. The number lives in the paragraph. Do not invent a cause.",
        "- A slide labeled EXPLAIN is a section. Place-names live inside the paragraph. Two names of the same expression is correct.",
        "- A slide labeled NEXT asks the question already on the desk. Not an archive door. Not 'find your next gathering spot'.",
      ] : [
        "- A slide labeled LOCATE names who / what / where / when. Not a paradox you invented.",
        "- A slide labeled NEWS is the proving paragraph for what is already on this desk.",
        "- A slide labeled PARADOX must NOT contain the metric that belongs to MECHANISM. Hold the number. Skip PARADOX if the brief did not name a fight.",
        "- A slide labeled FRICTION must name the OBSTACLE, not the resolution. If you write the resolution here, you've written the wrong beat.",
        "- A slide labeled MECHANISM is allowed only if the brief already named that infrastructure. Do not hunt an access illusion.",
        "- A slide labeled GATE ends the arc; it is the ask, not another explainer.",
      ]),
      "═════════════════════════════",
      "",
    ] : []),
    ...variationDirective(),
    ...((topic && topic.trim()) ? [`Carousel topic: ${topic.trim()}`, ""] : []),
    ...(context && context.trim() ? [
      isContentRegister(mode, isEvergreen)
        ? "Context (research evidence — locate THIS specimen first. Pattern, document, join only if they are already on the desk — NOT selling points or lineup). Break this up across slides as the method dictates:"
        : "Context (event details, selling points, lineup — break this up across slides as the rules below dictate):",
      context.trim(),
      "",
      "─────────────────────────────",
      "",
    ] : []),
    // TIMELY ACTION now annotated per-slide on the reserved-proof
    // line (see slotInstructionBlock below), not as a top-level block
    // — the flag reaches the writer exactly where it needs to act.
    // HISTORICAL CONTEXT — bullets whose dates are already in the past.
    // Separated from the primary context so the writer treats them as
    // legacy/origin material, NOT as active calendar drops. This is the
    // fix for "publishing an Instagram carousel telling people to attend
    // an event that happened a month ago."
    ...(Array.isArray(historicalContext) && historicalContext.length ? [
      "═════════════════════════════",
      `HISTORICAL CONTEXT — ${historicalContext.length} bullet${historicalContext.length === 1 ? "" : "s"} whose date${historicalContext.length === 1 ? " is" : "s are"} in the PAST (compared to today, ${today || "the current date"}):`,
      ...historicalContext.map(b => `- ${b}`),
      "",
      "These facts occurred in the past. Use them to establish LEGACY, ORIGIN STORY, or HISTORICAL BACKDROP only.",
      "STRICTLY BANNED language when referring to these entities:",
      "  - 'upcoming', 'this weekend', 'this Saturday', 'tonight', 'happening [past date]'",
      "  - 'RSVP', 'save the date', 'don't miss', 'coming up', 'save this'",
      "  - Any framing that implies the reader can still attend the event as-scheduled.",
      "REQUIRED framing when referring to these entities:",
      "  - 'back in [month]', '[event] kicked off', 'the [date] release marked', 'the room that hosted'",
      "  - Past-tense verbs. Historical construction. Legacy references.",
      "If a slide's assigned PROOF is historical, its beat is BACKSTORY, not CALENDAR — treat it as scene-setting for a currently active thing.",
      "═════════════════════════════",
      "",
    ] : []),
    // RELEVANCE VETO cut — spine's proofAssignments already routed
    // which bullet lands on which slide, and vetoed bullets simply
    // don't appear in any reserved-proof line. The writer no longer
    // needs to be told to ignore bullets; the routing did that.
    `Template sequence (${sequence.length} slides): ${sequence.join(" → ")}`,
    "",
    // TOP-LEVEL CTA VALUE-EXCHANGE MANDATE — enforced even if the operator's
    // stored slotPrompts.cta rule is stale or omits the mandate. Covers the
    // case where an old browser cache still has the legacy "link in bio"
    // slot prompt and would otherwise reintroduce the passive-CTA failure.
    ...(sequence.includes("cta") && isContentRegister(mode, isEvergreen) ? [
      "═════════════════════════════",
      "CTA AS NEXT QUESTION (Content / Feature — overrides any conflicting per-slot instruction):",
      "The last slide asks the question the explanation just made possible — not a ticket, not an RSVP, not a directory, not 'find your next gathering spot'.",
      "BANNED on any CTA field: 'link in bio', 'pull up', 'RSVP', 'don't miss', 'this weekend', 'join us', 'limited spots', 'tag a friend' as the whole ask, 'stay tuned', 'find your next gathering spot', 'THE ARCHIVE', 'THE MAP', 'START HERE', 'explore NJ's emergent social infrastructure'.",
      "REQUIRED shape: NAME THE NEXT QUESTION.",
      "  - kicker/ctaKicker: a short label for the question ('THE LIQUOR BARRIER', 'WHO GETS THE RETROFIT') — never 'THE ARCHIVE'.",
      "  - mainLine/ctaDate: the question itself, 8-16 words.",
      "  - subLine/ctaVenue: ONE sentence that continues the argument, not a sell and not a list of places.",
      "If a keyword_trigger was supplied, it may appear as the unlock — still framed as the next question, not as event promo.",
      "═════════════════════════════",
      "",
    ] : sequence.includes("cta") ? [
      "═════════════════════════════",
      "CTA VALUE-EXCHANGE MANDATE (top-level rule — overrides any conflicting per-slot instruction):",
      "The CTA slide is a VALUE-EXCHANGE ASK. It MUST offer the reader a specific unlock in exchange for a specific action.",
      "BANNED phrasings on any CTA slot (kicker, mainLine, subLine, ctaKicker, ctaDate, ctaVenue): 'link in bio', 'stay tuned', 'stay informed', 'explore', 'pull up' as CTA verb, 'stand with the scene', 'honor the day', 'keep watching', 'keep following', 'keep listening', 'more soon', 'catch us next time'. These are passive redirects, not asks.",
      "REQUIRED shape: NAME THE ACTION → NAME THE UNLOCK.",
      "  - kicker/ctaKicker: an insider label (e.g. 'INSIDER ACCESS', 'THE DISPATCH', 'GATE OPEN', 'ON THE LIST') — NEVER 'LINK IN BIO' or 'STAY TUNED'.",
      "  - mainLine/ctaDate: 3-7 words naming what the reader GETS (an unlisted list, a map, a full breakdown, the invite, the routing).",
      "  - subLine/ctaVenue: ONE sentence stating the exact ask + the exact unlock ('Comment X below for the full breakdown', 'DM X for the dispatch', 'Save this and tag the friend who needs the map').",
      "If no specific keyword or link is available in the context, DEFAULT to a save-and-share ask ('Save this — the [thing] drops [when]'), NEVER to a passive redirect.",
      "═════════════════════════════",
      "",
    ] : []),
    "For EACH slide, apply the per-slot rule below. Return ONE big JSON payload.",
    "",
    "─────────────────────────────",
    "",
    slotInstructionBlock,
    "",
    "─────────────────────────────",
    "",
    "Return JSON ONLY in this exact shape (no markdown fences, no prose):",
    `{"slides":[${sequence.map(fillSlotShape).join(",")}]}`,
  ].join("\n");
}

function buildPrompt({ slotType, topic, voice, slotRule, count = 3, context, mode }) {
  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const exemplars = Array.isArray(voice?.exemplars) ? voice.exemplars.filter(e => e && e.trim()) : [];
  const hasExemplars = exemplars.length > 0;

  const voiceBlock = (hasVoiceDesc || hasExemplars) ? [
    "BRAND VOICE FINGERPRINT — every word you write MUST sound like this voice.",
    "",
    ...(hasVoiceDesc ? [
      "Voice description:",
      voice.description.trim(),
      "",
    ] : []),
    ...(hasExemplars ? [
      `Past captions in this voice (${exemplars.length} examples — study cadence, sentence length, what gets named vs implied):`,
      "",
      ...exemplars.map((e, i) => `=== Example ${i + 1} ===\n${e.trim()}`),
      "",
    ] : []),
    "─────────────────────────────",
    "",
  ] : [];

  const slotRefBlock = formatSlotReferenceBlock(slotType);

  // Wrap the canonical per-slot shape in {options:[3 of these]} so
  // single-slot ✨ AI Generate always returns 3 variations regardless
  // of what schema the user's editable rule embeds. Falls back to {}
  // for unknown slot types (rule must self-describe).
  const shape = SLOT_OUTPUT_SHAPES[slotType];
  const n = Math.max(1, count || 3);
  const schemaOverride = shape ? [
    "FINAL OUTPUT SCHEMA — IGNORE any schema mentioned in the rule above; use ONLY this shape:",
    `{"options":[${Array.from({ length: n }, () => shape).join(",")}]}`,
    "",
    `Return exactly ${n} DISTINCT variations in the options array — each meaningfully different, not slight rewordings.`,
    ...((slotType === "cover" && n > 1) ? [`Across the ${n}, use DIFFERENT hook archetypes — don't repeat the same archetype twice.`] : []),
  ] : ["Output ONLY the JSON, no prose, no markdown fences."];

  return [
    ...voiceBlock,
    `You are generating content for a ${slotType.toUpperCase()} slide in a CGE social media carousel.`,
    "",
    ...((topic && topic.trim())
      ? [`Topic: ${topic.trim()}`, ""]
      : ["No explicit topic was typed — INFER the subject from the details / current carousel below, and write this slide to fit that SAME story (same event, voice, and specifics).", ""]),
    ...((context && context.trim()) ? [
      "Event details / facts — ground every option in THESE specifics (names,",
      "dates, numbers, history). This turns a generic hook into a concrete one,",
      "and it's what an honest curiosity gap actually pays off:",
      context.trim(),
      "",
    ] : []),
    ...platformThesisBlock({ mode }),
    ...(isContentRegister(mode) ? contentCreativeDirection() : creativeDirection()),
    ...(slotType === "cover" && !isContentRegister(mode) ? hookFrameworks() : []),
    ...registerBlock(mode),
    ...variationDirective(),
    ...(slotRefBlock.length ? [...slotRefBlock, "─────────────────────────────", ""] : []),
    "Apply the rule below STRICTLY:",
    "",
    slotRule,
    "",
    ...schemaOverride,
  ].join("\n");
}
