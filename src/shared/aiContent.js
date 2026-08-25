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
export async function screenshotToEvents({ apiKey, image, mimeType = "image/png", weekendDates = null, extraText = "" } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!image) throw new Error("No screenshot provided");
  const b64 = String(image).startsWith("data:") ? String(image).split(",")[1] : String(image);
  const mt = String(image).startsWith("data:")
    ? (String(image).slice(5).split(";")[0] || mimeType)
    : mimeType;

  const anchor = (weekendDates && (weekendDates.Fri || weekendDates.Sat || weekendDates.Sun))
    ? `The operator is reviewing this weekend: Fri ${weekendDates.Fri || "?"}, Sat ${weekendDates.Sat || "?"}, Sun ${weekendDates.Sun || "?"} (M/D). If the image only says a day of week (e.g. "Friday") with no explicit date, that day maps to the corresponding date above.`
    : "";

  const prompt = [
    "You are extracting event details from a screenshot (Instagram post/story, flyer, graphic) for Central Group Events — a Black-culture events media brand in New Jersey. The result drops into the operator's review queue.",
    "",
    "Return ONLY JSON in this exact shape — an `events` ARRAY:",
    '{"events":[{"name":"","day":"","date":"","time":"","venue":"","area":"","region":"","type":"","igHandle":"","link":"","recurring":false}]}',
    "",
    "MOST posters are ONE event → the array has one object. Only split into multiple objects when the poster shows DISTINCT events (e.g. a weekly schedule listing different events on different days, or a series flyer showing several dated events).",
    "",
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
    "- Only include what's actually visible in the image. Never invent a date, venue, price, handle, or URL.",
    "- If unsure, leave the field as \"\" — the operator will fill it in.",
  ].filter(Boolean).join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mt, data: b64 } }] }],
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
// captions so the model stays in-voice. Reads the actual weekend's events for
// concrete references (venues, days, region), detects seasonal moments (Labor
// Day, Juneteenth, HBCU homecoming, etc.) so the tail hashtag can be
// weekend-specific. Returns { body, hashtags }; the modal / ZIP assembly
// wraps that in the fixed CTA + "Where we landing, folks? ✈️" line so the
// template pieces never drift with model variance.

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
  const evList = (Array.isArray(events) ? events : []).slice(0, 60);

  // Summarize the weekend's events for the model without dumping everything.
  const byDay = { Fri: [], Sat: [], Sun: [] };
  for (const e of evList) if (byDay[e.day]) byDay[e.day].push(e);
  const daySummary = ["Fri", "Sat", "Sun"].filter((d) => byDay[d].length).map((d) => {
    const sample = byDay[d].slice(0, 5).map((e) => `${e.name}${e.venue ? ` @ ${e.venue}` : ""}${e.area ? `, ${e.area}` : ""}`);
    return `- ${d} (${byDay[d].length} events): ${sample.join(" · ")}${byDay[d].length > 5 ? " …" : ""}`;
  }).join("\n");
  const regions = [...new Set(evList.map((e) => e.region).filter(Boolean))];

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
    "- Reference the actual events (a venue, day, or region) where it lands — stay concrete and warm.",
    "- NEVER hype-clichés: 'unforgettable', 'must-visit', 'hidden gem', 'something for everyone', 'you don't want to miss', 'the vibes were unmatched'.",
    "- Say 'Jersey' not 'NJ' in the body.",
    "- Roughly 5 sentences (4-6 is fine). Mix short-punch and slightly longer.",
    "- 1-3 emojis, at the end of a thought — never decorative.",
    "- One or two ALL-CAPS words for emphasis if it FITS the moment (not required).",
    "",
    `THIS WEEKEND: Fri ${weekendDates?.Fri || "?"} · Sat ${weekendDates?.Sat || "?"} · Sun ${weekendDates?.Sun || "?"}`,
    seasonal ? `SEASONAL CONTEXT: ${seasonal.name} — reference it if it fits, don't force it.` : "",
    `EVENT COUNT: ${evList.length}${regions.length ? ` across ${regions.join(", ")}` : ""}`,
    daySummary ? "SAMPLE:" : "",
    daySummary,
    "",
    "Then produce FIVE hashtags for the tail. Include the seasonal tag when relevant. Mix brand tags with weekend/vibe tags. Never generic garbage (#instagood, #followforfollow). Good candidates: #NJBlackCulture, #CGEWeekend, #WhereWeAt, #BlackNJ, #JerseySummer/#JerseyFall/#JerseyWinter, plus " + (seasonal ? seasonal.tag : "a season-appropriate tag") + ". Use #TheMotion sparingly (max once in every ~3 captions) — it's overused if it shows up every week.",
    "",
    "Return ONLY JSON in this exact shape (no markdown, no code fences, no preamble):",
    '{"body":"<the caption body — plain text, keep line breaks as \\n>","hashtags":["#tag1","#tag2","#tag3","#tag4","#tag5"]}',
  ].filter(Boolean).join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.95 },
  }, { model: "gemini-2.5-flash" });

  const parsed = extractJson(extractResponseText(data)) || {};
  const body = clean(parsed.body);
  let hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.map(clean).filter(Boolean) : [];
  // Normalize hashtags: ensure leading #, strip whitespace, cap at 5.
  hashtags = hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")).slice(0, 5);
  if (!body) throw new Error("Caption came back empty — try Regenerate.");
  return { body, hashtags, seasonal: seasonal?.name || null };
}

// Assembles the final caption block from the AI's {body, hashtags} + the
// fixed CTA and "Where we landing, folks? ✈️" line. Keeps template drift out
// of the model's job — it only writes the creative body + tags.
export function assembleWeekendCaption({ body, hashtags }) {
  const cta = "Link in bio for the full spread + event details 📎 centralgroupevents.com";
  const closer = "Where we landing, folks? ✈️";
  const tags = (Array.isArray(hashtags) ? hashtags : []).join(" ");
  return `${(body || "").trim()}\n\n${cta}\n\n${closer}${tags ? `\n\n${tags}` : ""}`;
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

export async function designSequence({ apiKey, topic, context, mode, targetCount = null, letterMode = false }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if ((!topic || !topic.trim()) && (!context || !context.trim())) throw new Error("Add a topic or event details first");

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
        : "Register: EDITORIAL — restrained newsroom voice. Report it, frame it, don't sell it.";

  const prompt = [
    "You are the art director AND the editor for CGE, a New Jersey Black-culture news-media page.",
    "Design the SLIDE SEQUENCE that tells THIS story best as an Instagram carousel.",
    "",
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
    "",
    ...((topic && topic.trim()) ? [`Topic: ${topic.trim()}`] : []),
    ...(context && context.trim() ? ["", "Event facts:", context.trim()] : []),
    "",
    registerLine,
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
    ] : []),
    ...(letterMode ? [
      "LETTER MODE is ON — favor a short, flowing, human arc: mostly cover + text + news beats and a",
      "soft closing cta. AVOID rigid multi-cta directories, features grids, and stat/countdown blocks —",
      "they shatter the one-continuous-letter voice. 4-6 slides is usually right.",
    ] : []),
    "",
    "Available slide types (use ONLY these) — pick each for the FEELING it creates:",
    "- cover: the hook. ALWAYS slide 1. Its job is to stop the scroll and open a loop.",
    "- text: a short manifesto/thesis — the 'why this matters', the emotional stakes.",
    "- news: a punchy news-card + photo — short stacked lines that open a loop and land a bold payoff, over",
    "  an image. This is your STRONGEST middle-of-carousel beat: high-retention and reported. PREFER it over",
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
    "",
    "Rules:",
    countRule,
    "- Slide 1 is ALWAYS 'cover'. End on a 'cta'.",
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
    "- RETENTION: if the cover opens a loop, slide 2 DEEPENS it (rule out the obvious), it does NOT",
    "  resolve it. Escalate concrete specifics through the middle; save the single biggest payoff for",
    "  the last content slide; end on a cta that rewards reaching the end.",
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
  // Guardrails: cover first, cta last, sane length — the render pipeline assumes these.
  // Cap at the requested count (when pinned) or 10 (auto).
  const cap = wantCount || 10;
  seq = ["cover", ...seq.filter(s => s !== "cover")].slice(0, cap);
  if (seq[seq.length - 1] !== "cta") {
    // Keep the total at the cap when pinned: replace the last slot with cta
    // rather than pushing past the requested count.
    if (wantCount && seq.length >= cap) seq[seq.length - 1] = "cta";
    else seq.push("cta");
  }
  if (seq.length < 2) throw new Error("Designed sequence too short");
  return { sequence: seq, rationale: (parsed?.rationale || "").trim() };
}

// Full "AI arranges the carousel" flow: design the sequence, then fill + polish it.
export async function generateArrangedCarousel({ apiKey, topic, context, voice, slotPrompts, mode, targetCount = null, letterMode = false }) {
  const design = await designSequence({ apiKey, topic, context, mode, targetCount, letterMode });
  const slides = await generateTemplateFill({
    apiKey, sequence: design.sequence, topic, context, voice, slotPrompts,
    templateMeta: { name: "AI-arranged carousel", keyMove: design.rationale }, mode, letterMode,
  });
  return { slides, sequence: design.sequence, rationale: design.rationale };
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
    "CGE = Central Group Events, an NJ news-media outlet that covers nightlife,",
    "events, and culture across the Garden State.",
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

export async function generateTemplateFill({ apiKey, sequence, topic, context, voice, slotPrompts, templateMeta, mode, polish = true, letterMode = false }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(sequence) || !sequence.length) throw new Error("Missing template sequence");
  if ((!topic || !topic.trim()) && (!context || !context.trim())) throw new Error("Add a topic or event details first");

  const today = (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();
  const prompt = buildTemplatePrompt({ sequence, topic, context, voice, slotPrompts, templateMeta, mode, today, letterMode });

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.95,
    },
  });
  const raw = extractResponseText(data);
  if (!raw) throw new Error("Empty response from Gemini");

  const parsed = extractJson(raw);

  const slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (slides.length !== sequence.length) {
    throw new Error(`Expected ${sequence.length} slides, got ${slides.length}`);
  }
  if (!polish) return slides;
  // Critic pass — raise every slide to its quality bar. Falls back to the draft
  // if the polish call fails or returns the wrong shape, so it never blocks output.
  try {
    const improved = await polishCarousel({ apiKey, topic, context, voice, sequence, slides, mode, today, letterMode });
    if (Array.isArray(improved) && improved.length === sequence.length) return improved;
  } catch (e) {
    if (typeof console !== "undefined") console.warn("Carousel polish failed, returning draft:", e?.message || e);
  }
  return slides;
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

// === CAROUSEL CRITIC (whole-carousel polish) ===
// Second pass over a generated Template Fill — the Fill analog of the cover
// hook-judge. The Fill writes each slide one-shot with no selection, so weak or
// generic slides slip through. This hands the whole draft to a low-temp editor
// that raises EVERY slide to its quality bar (kill filler, make the cover hook,
// keep facts honest) while preserving each slide's type, order, and JSON shape.
// Returns the improved slides; throws on failure so the caller falls back to the draft.
export async function polishCarousel({ apiKey, topic, context, voice, sequence, slides, mode, today, letterMode = false }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(slides) || !slides.length) throw new Error("No slides to polish");

  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const voiceLine = hasVoiceDesc ? `Brand voice: ${voice.description.trim()}` : "";

  const draft = slides.map((s, i) => `SLIDE ${i + 1} (${s?.type || sequence[i]}):\n${JSON.stringify(s)}`).join("\n\n");

  const prompt = [
    "You are a ruthless CGE editor reviewing a DRAFT Instagram carousel before it",
    "ships. Raise EVERY slide to the quality bar, then return the full carousel.",
    "",
    "QUALITY BAR:",
    "- Concrete over generic. KILL filler: 'educate/inspire/uplift', 'for all',",
    "  'something for everyone', 'come out and enjoy', 'delicious food', 'great vibes'.",
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
        : ["- REGISTER: EDITORIAL — restrained newsroom confidence. Inform, don't sell."]),
    voiceLine,
    "",
    ...(context && context.trim() ? ["Event facts (do NOT invent beyond these):", context.trim(), ""] : []),
    `Topic: ${topic?.trim() || "(unspecified)"}`,
    "",
    "DRAFT (fix in place — a slide that already clears the bar can stay as-is):",
    "",
    draft,
    "",
    "Rules: keep the SAME number of slides in the SAME order, and each slide's SAME",
    "type + JSON fields. Rewrite only the copy. Don't invent events or facts not in",
    "the context. Return JSON ONLY (no fences, no prose) in this exact shape:",
    `{"slides":[${sequence.map(fillSlotShape).join(",")}]}`,
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
  });
  const raw = extractResponseText(data);
  const parsed = extractJson(raw);
  const out = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (out.length !== sequence.length) throw new Error(`Polish returned ${out.length} slides, expected ${sequence.length}`);
  return out;
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
  if (mode === "story") return [
    "REGISTER: STORY — tell this like a STORY, not a listing or a pitch.",
    "- Hero is a PERSON, a MOMENT, or a CHANGE — not logistics. Open on a scene, a moment, or a turn.",
    "- Voice: narrative and human — first- or close-third person ('we', 'here's what happened').",
    "- Arc over facts: set up → tension / stakes → turn → payoff → what it MEANS. Each slide is a BEAT, not a bullet.",
    "- NO MANUFACTURED EMOTION: the feeling must be true to what actually happened. Don't invent 'the room went",
    "  quiet' beats or sentiment the facts don't support — if there's no real emotional turn, tell it plainer.",
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
    "REGISTER: EDITORIAL — we are the newsroom reporting on the scene, not selling it.",
    "- Destination is UNDERSTANDING, not a sale. Structure: lead → context → significance → what's next.",
    "- Voice: third-person, observational, understated. Report; don't invite.",
    "- REFUSE THE CTA: NO urgency words, NO ticket push, NO 'you should go' / 'pull up' / 'RSVP'. A closing",
    "  editorial slide lands on the takeaway or what's next — never a sell. If the sequence ends in a 'cta'",
    "  slot, treat it as a closing NOTE, not an invite.",
    "- The hook pulls through curiosity and concrete specifics + real sourcing, never enthusiasm.",
    "- Reads like a magazine dek, not a flyer.",
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
    "COVER HOOK FRAMEWORKS — pick the one that fits THIS event's genre; rotate across posts, never reuse the same one every time:",
    "- TEASED OUTCOME: a setup + a withheld payoff. \"We're playing ONE song at midnight that will officially cause a noise complaint…\"",
    "- THE 'WHY' HOOK: name a behavior, promise the reason. \"The [group] does [action] — here's exactly why.\"",
    "- COUNTER-INTUITIVE CLAIM: flip the expectation. \"This isn't what most [X] do — but it's why [result].\"",
    "- UNREVEALED ELEMENT: \"The hidden [thing] nobody tells you about…\"",
    "- INFORMATION ASYMMETRY (status play): imply insiders know a secret. \"The one rule we're forcing every single to follow at Friday's mixer…\"",
    "- INCOMPLETE LISTICLE: promise a list, withhold the best item for later slides (\"the boldest one is on the next slide\") — great for multi-slide swipe.",
    "- PATTERN INTERRUPT: open with something jarring, absurd, or a corrected 'lie' that stops autopilot scrolling.",
    "- LOSS / STAKES FRAME: open on something ending, at risk, or that almost didn't happen — loss aversion hits about twice as hard as any gain-framed hype line. \"This might be the last one…\" / \"We almost lost the venue three times.\" Then the carousel reveals why it matters and how it's being saved. Works for POSITIVE stories too — the near-miss or hidden cost behind a win. Use sparingly: it's a one-time card, not every post, and only when the stakes are REAL (never cry wolf).",
    "- THEN → NOW / NUMBER-ANCHORED / SCENE DETAIL are also fair game when they fit.",
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
    `RETENTION ENGINEERING — this is a ${slideCount}-slide SWIPE, not ${slideCount} standalone cards. Build it so a reader can't comfortably stop mid-way:`,
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

function buildTemplatePrompt({ sequence, topic, context, voice, slotPrompts, templateMeta, mode, today, letterMode = false }) {
  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const exemplars = Array.isArray(voice?.exemplars) ? voice.exemplars.filter(e => e && e.trim()) : [];
  const hasExemplars = exemplars.length > 0;

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
    if (!rule) {
      return `SLIDE ${idx + 1} (${slotType.toUpperCase()}) — no rule defined; produce reasonable defaults matching brand voice.\n${refPrefix}`;
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
      extra = "\n\nNEWS slide — a SUPPORTING explainer beat, not a cover, written in the HIGH-RETENTION format: open a small loop, hold a beat, land the payoff. newsKicker = a 1-3 word eyebrow (BREAKING / THE BACKSTORY / WHY IT MATTERS / THE BIGGER PICTURE). newsHeadline = an optional short heading, or empty. newsBody = SHORT STACKED LINES (one thought per line, single \\n between lines; a blank \\n\\n before the payoff), three-beat rhythm, NOT a dense paragraph and NOT a repeat of the cover — real reported substance. End on ONE payoff line wrapped in *asterisks* so it bolds (exactly one). Every specific must be true; never manufacture drama. newsBold true only for a genuinely urgent breaking beat.";
    } else if (slotType === "features") {
      // The Features slot is the one most prone to filler because each card is
      // tiny — force concrete promises and a single standout card.
      extra = `\n\nFEATURES: give 3-5 cards. Each card is ONE concrete, specific promise — name the REAL thing (the actual DJ, the exact activity, the real giveaway/prize, the specific format), never a vague benefit. BAN 'good vibes', 'great music', 'fun for all', 'something for everyone', 'good food'. headline = 2-4 punchy words; sub = one concrete detail (a name, a time, a number). Set featured:true on exactly ONE card — the single biggest draw (the headliner / the giveaway) — and featured:false on the rest. Still give each card an apt emoji in case the icon style is used.`;
    }
    return `SLIDE ${idx + 1} (${slotType.toUpperCase()}):\n${refPrefix}${rule}${extra}`;
  }).join("\n\n─────────────────────────────\n\n");

  const purposeBlock = formatTemplatePurposeBlock(templateMeta);

  return [
    ...voiceBlock,
    ...purposeBlock,
    "You are generating an ENTIRE editorial Instagram carousel for CGE. The slides will be exported in order — write them as ONE coherent story, not isolated cards.",
    "",
    "QUALITY BAR — applies to EVERY slide, not just the cover:",
    "- Write in the register of street-level neighborhood critique (anti-hype, no-nonsense local insider). Focus strictly on the input topic/event—do not pivot to unrelated domains (like food/restaurants or party vibes) unless the input specifically describes them.",
    "- BANNED CLICHÉS: Never use 'hidden gem', 'must-visit', 'good vibes', 'scenic view', 'great music', 'experience like no other', 'unforgettable', 'movie', 'can't-miss', 'movie vibes', or 'something for everyone'. If you write these, the editor will reject it.",
    "- Be extremely specific about location: name the neighborhood (e.g., Ironbound, Heights, Downtown) or specific cross-streets/landmarks rather than just a generic town name.",
    "- Concrete over generic. Name the real thing — a number, a place, a moment.",
    "  BAN vague filler: 'educate, inspire, and uplift', 'for all', 'something for",
    "  everyone', 'fun for the whole family', 'come out and enjoy'.",
    "- The COVER must open with a real HOOK — a curiosity gap, a before→after, a",
    "  number, or a question. NEVER a bland label like 'First Annual X'.",
    "- PREFER AN OPEN LOOP on the cover whenever the story supports it: a setup +",
    "  a withheld payoff that forces the swipe ('This Jersey mall was left for",
    "  dead. Saturday, it wakes up.'). It outperforms a plain descriptive line.",
    "- Honest always: a hook the rest of the carousel actually pays off. Tease, never mislead.",
    "- PULL-THROUGH (hold attention to the END): SLIDE 2 must CONTINUE the cover's hook —",
    "  open by paying off its curiosity ('Here's what happened…', 'How it came back…'), not",
    "  a generic thesis. Every slide should make the reader want the next; escalate concrete",
    "  specifics through the middle. The FINAL slide must REWARD reaching the end (a payoff +",
    "  the invite), not a limp 'link in bio'.",
    ...(today ? [`- Today is ${today}. Use the correct current year everywhere; never default to a past year.`] : []),
    "",
    ...creativeDirection(),
    ...(sequence.includes("cover") ? hookFrameworks() : []),
    ...(sequence.length > 2 ? retentionEngineering(sequence.length) : []),
    ...(letterMode ? letterModeBlock() : []),
    ...registerBlock(mode),
    ...variationDirective(),
    ...((topic && topic.trim()) ? [`Carousel topic: ${topic.trim()}`, ""] : []),
    ...(context && context.trim() ? [
      "Context (event details, selling points, lineup — break this up across slides as the rules below dictate):",
      context.trim(),
      "",
      "─────────────────────────────",
      "",
    ] : []),
    `Template sequence (${sequence.length} slides): ${sequence.join(" → ")}`,
    "",
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
    ...creativeDirection(),
    ...(slotType === "cover" ? hookFrameworks() : []),
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
