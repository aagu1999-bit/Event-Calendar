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
async function geminiGenerate(apiKey, requestBody, { tries = 4 } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) {
      // 0.8s → 1.6s → 3.2s. Enough for a "high demand" spike to pass.
      await new Promise(r => setTimeout(r, 800 * 2 ** (attempt - 1)));
    }
    let res;
    try {
      res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
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
  // Google Search tool. We read the grounded plain text back out.
  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4 },
  });
  return (extractResponseText(data) || "").trim();
}

// === TIMELY NEWS LOOKUP (Google Search grounding) ===
// Like researchEvent, but oriented at what's HAPPENING NOW rather than
// evergreen background. Given a topic/area, it searches for recent, dated
// news + upcoming happenings so the user can spin a timely post out of the
// current moment. Returns a plain-text brief (grounded → no JSON mode).
// `today` anchors "recent" so the model doesn't surface stale items.
export async function researchNews({ apiKey, topic, context, today = null }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const subject = [topic, context].map(s => (s || "").trim()).filter(Boolean).join(" — ");
  if (!subject) throw new Error("Add a topic or area to look up news for first");
  const stamp = today || (() => { try { return new Date().toISOString().slice(0, 10); } catch { return null; } })();
  const prompt = [
    "You are a news researcher gathering TIMELY, CURRENT happenings for a same-week",
    "social-media carousel. Search the web for what's happening NOW and coming up soon",
    "for the topic/area below, then write a tight brief a writer can turn into a post.",
    "",
    `TOPIC / AREA: ${subject}`,
    ...(stamp ? ["", `TODAY'S DATE: ${stamp}. Only surface items that are RECENT (last ~2 weeks) or UPCOMING. Skip anything stale.`] : []),
    "",
    "Return 5-10 plain-text bullets, each a distinct, DATED happening — for example:",
    "- new openings, closings, launches, announcements;",
    "- upcoming events, festivals, markets, shows (with the date);",
    "- notable local news beats relevant to the topic/area (NJ / Garden State when applicable).",
    "",
    "For each bullet include, when known: WHAT happened / is happening, WHERE (venue + town),",
    "WHEN (date), and a one-line WHY IT MATTERS. Put the date in brackets, e.g. [Jul 5].",
    "",
    "RULES:",
    "- Prefer specific, verifiable, recent facts. Note the source site in parentheses when helpful.",
    "- If you cannot confirm a date or specific, say so plainly — never invent a date, venue, or price.",
    "- Rank by timeliness + relevance. Plain-text bullets only. No preamble, no markdown headers.",
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4 },
  });
  return (extractResponseText(data) || "").trim();
}

export async function generateSlideContent({ apiKey, slotType, topic, voice, slotPrompts, count = 3, context, mode }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!slotType) throw new Error("Missing slotType");
  if (!topic || !topic.trim()) throw new Error("Missing topic");

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
const ARRANGEABLE_SLOTS = ["cover", "text", "spotlight", "stat", "features", "countdown", "cta", "photo", "poster", "press"];

export async function designSequence({ apiKey, topic, context, mode, targetCount = null }) {
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

  const prompt = [
    "You are an Instagram art director for CGE, an NJ news-media outlet. Design the",
    "best SLIDE SEQUENCE to tell THIS story as a carousel — which slide types, in what",
    "order, for maximum narrative pull (hook → build → payoff → close). Do NOT use a",
    "fixed template; design for this specific content.",
    "",
    ...((topic && topic.trim()) ? [`Topic: ${topic.trim()}`] : []),
    ...(context && context.trim() ? ["", "Event facts:", context.trim()] : []),
    (mode === "promo") ? "\nRegister: PROMO (own-event push, more energy)." : "\nRegister: EDITORIAL (restrained newsroom voice).",
    "",
    "Available slide types (use ONLY these):",
    "- cover: the opening hook. ALWAYS slide 1.",
    "- text: a short manifesto/thesis — the 'why it matters'.",
    "- spotlight: ONE venue/feature/angle per slide; use several for a listicle feel.",
    "- stat: one big number + label — an impact/bragging beat.",
    "- features: 3-5 emoji + concrete promises (what's included).",
    "- countdown: urgency dial toward a date (T-minus).",
    "- cta: the closing invite, or a directory listing (one per event in a roundup).",
    "- photo: a recap photo caption — POST-EVENT recaps only.",
    "- poster / press: magazine-flyer format — music/nightlife/visually-loud events.",
    "",
    "Rules:",
    countRule,
    "- Slide 1 is ALWAYS 'cover'. End on a 'cta'.",
    "- Match the mix to the STORY: a single event with many selling points → a few",
    "  spotlights or a features slide; a multi-event roundup → several ctas; a single",
    "  strong beat → keep it short. A PRE-event promo should NOT use 'photo'.",
    "- Don't pad. Every slide must earn its place.",
    "- RETENTION — build for the swipe-through: if the cover is an open-loop hook,",
    "  make SLIDE 2 the payoff/reveal that starts answering it (not a generic thesis).",
    "  Each slide should tease the next; escalate concrete specifics through the middle;",
    "  end on a slide that REWARDS reaching the end (payoff + invite), not a limp CTA.",
    "",
    "Return JSON ONLY (no fences, no prose):",
    `{"sequence":["cover","...","cta"],"rationale":"<1 sentence: why this arc fits this story>"}`,
  ].join("\n");

  const data = await geminiGenerate(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.5 },
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
  const design = await designSequence({ apiKey, topic, context, mode, targetCount });
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
  if (t === "spotlight") return '{"type":"spotlight","spotName":"...","spotMeta":"...","spotTime":"","spotPrice":"","spotCta":""}';
  if (t === "cta")       return '{"type":"cta","ctaKicker":"","ctaDate":"...","ctaVenue":"...","ctaUrl":"..."}';
  if (t === "photo")     return '{"type":"photo","caption":"...","captionSecondary":"..."}';
  if (t === "stat")      return '{"type":"stat","statNumber":"...","statLabel":"...","statSub":"..."}';
  if (t === "countdown") return '{"type":"countdown","countText":"...","countEvent":"...","countWhen":"...","countCta":"..."}';
  if (t === "poster")    return '{"type":"poster","topLine":"...","hosts":"...","kicker":"...","title":"...","subtitle":"...","leftList":"...","rightList":"...","dressCode":"...","dateLine":"..."}';
  if (t === "press")     return '{"type":"press","pressTopMeta":["...","...","...","..."],"pressTitle":"...","pressBadge":"...","pressLineup":"...","pressGenres":"...","pressDateLine":"..."}';
  if (t === "features")  return '{"type":"features","featuresTitle":"...","features":[{"emoji":"...","headline":"...","sub":"..."}]}';
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
    ...(today ? [`- Today is ${today}. Correct current year everywhere; never a past year.`] : []),
    ...(letterMode ? [
      "- LETTER / MANIFESTO MODE is ON: the carousel is ONE continuous first-person letter.",
      "  Preserve that — one flowing voice, thoughts that carry slide to slide (ellipses ok),",
      "  intimate 'I/we/you', short beats. Don't chop it back into standalone cards.",
    ] : []),
    ...((mode === "promo")
      ? ["- REGISTER: PROMO — own-event push, more energy, a time pull, a soft invite. No 'don't miss out' clichés."]
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
  if (mode === "promo") return [
    "REGISTER: PROMO — this is OUR event and we want people to COME.",
    "- Voice: warm, direct, second-person ('you', 'your weekend'). Speak TO the reader.",
    "- Energy: higher. Use a time pull ('this Saturday', 'doors at 8') and a soft, confident invite.",
    "- The closer makes the next step obvious (RSVP, pull up, save the date).",
    "- Still honest and editorial-grade — NEVER 'don't miss out!', 'link in bio!!!', or hype-spam.",
    "─────────────────────────────",
    "",
  ];
  return [
    "REGISTER: EDITORIAL — we are the newsroom reporting on the scene, not selling it.",
    "- Voice: third-person, observational, understated. Report; don't invite.",
    "- Energy: restrained. NO urgency words, NO CTA pressure, NO 'you should go'.",
    "- The hook pulls through curiosity and concrete specifics, never enthusiasm.",
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
    "- RATION the information. Do NOT front-load. The single most surprising or valuable",
    "  specific — the payoff — is WITHHELD until the last content slide, never dumped on",
    "  slide 1 or 2. If everything worth knowing fits on the first two slides, it's wrong:",
    "  hold something back and make them swipe for it.",
    "- CHAIN THE LOOPS. Every slide except the last must END by opening a NEW curiosity gap",
    "  that only the NEXT slide answers, while paying off the previous one. The reader should",
    "  finish each slide with a fresh unanswered question, not a closed, complete thought.",
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
    if (slotType === "spotlight" && spotlightCount > 1) {
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
    `Topic: ${topic.trim()}`,
    "",
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
