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

const MODEL = "gemini-2.5-flash-lite";
const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

export async function generateSlideContent({ apiKey, slotType, topic, voice, slotPrompts }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!slotType) throw new Error("Missing slotType");
  if (!topic || !topic.trim()) throw new Error("Missing topic");

  const slotRule = slotPrompts?.[slotType];
  if (!slotRule) throw new Error(`No prompt defined for slot type "${slotType}"`);

  const prompt = buildPrompt({ slotType, topic, voice, slotRule });

  const res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.9,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from Gemini");

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Gemini did not return valid JSON"); }

  const options = Array.isArray(parsed?.options) ? parsed.options : [];
  if (!options.length) throw new Error("Got 0 options back");
  return options;
}

// AI Template Picker — given a topic + context, ask Gemini which of
// the available Carousel Templates fits best. Returns {templateId,
// reasoning}. Used by AI Fill Template when the user toggles "Let AI
// pick the template" — saves them from having to guess which sequence
// fits their content best.
//
// candidates is an array of { id, name, sequence, intent } drawn from
// BUILTIN_CAROUSEL_TEMPLATES + custom user templates.

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

  const res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from Gemini");

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Gemini did not return valid JSON"); }

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

export async function generateTemplateFill({ apiKey, sequence, topic, context, voice, slotPrompts, templateMeta }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(sequence) || !sequence.length) throw new Error("Missing template sequence");
  if (!topic || !topic.trim()) throw new Error("Missing topic");

  const prompt = buildTemplatePrompt({ sequence, topic, context, voice, slotPrompts, templateMeta });

  const res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.85,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 240)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from Gemini");

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Gemini did not return valid JSON"); }

  const slides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (slides.length !== sequence.length) {
    throw new Error(`Expected ${sequence.length} slides, got ${slides.length}`);
  }
  return slides;
}

function buildTemplatePrompt({ sequence, topic, context, voice, slotPrompts, templateMeta }) {
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
      extra = `\n\nThis is Spotlight ${spotIdxAmong} of ${spotlightCount}. Each Spotlight MUST cover a DIFFERENT angle/selling-point/feature from the context. Don't repeat across Spotlights. Together they should feel like a listicle that maps the full context onto ${spotlightCount} distinct ideas.`;
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
    `Carousel topic: ${topic.trim()}`,
    "",
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
    `{"slides":[${sequence.map(t => {
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
    }).join(",")}]}`,
  ].join("\n");
}

function buildPrompt({ slotType, topic, voice, slotRule }) {
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
  const schemaOverride = shape ? [
    "FINAL OUTPUT SCHEMA — IGNORE any schema mentioned in the rule above; use ONLY this shape:",
    `{"options":[${shape},${shape},${shape}]}`,
    "",
    "Return exactly 3 distinct variations in the options array.",
  ] : ["Output ONLY the JSON, no prose, no markdown fences."];

  return [
    ...voiceBlock,
    `You are generating content for a ${slotType.toUpperCase()} slide in a CGE social media carousel.`,
    "",
    `Topic: ${topic.trim()}`,
    "",
    ...(slotRefBlock.length ? [...slotRefBlock, "─────────────────────────────", ""] : []),
    "Apply the rule below STRICTLY:",
    "",
    slotRule,
    "",
    ...schemaOverride,
  ].join("\n");
}
