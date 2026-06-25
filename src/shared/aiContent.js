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

const MODEL = "gemini-2.5-flash";
const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

  const list = candidates.map(t => {
    const intent = t.intent || (t.custom ? "User-saved sequence." : "");
    return `- id: ${t.id}\n  name: ${t.name}\n  sequence: ${t.sequence.join(" → ")} (${t.sequence.length} slides)\n  best for: ${intent}`;
  }).join("\n\n");

  const prompt = [
    "You are picking the best carousel template for a CGE Instagram post.",
    "",
    `Topic: ${topic.trim()}`,
    "",
    ...(context && context.trim() ? [
      "Context (what the carousel covers):",
      context.trim(),
      "",
    ] : []),
    "Available templates:",
    "",
    list,
    "",
    "Pick the ONE template whose structure best fits the topic + context. Consider:",
    "- Editorial Roundup (cover + text + cta×N) fits roundups of multiple distinct events",
    "- Feature Drop (cover + spotlight×N + cta) fits ONE event broken into selling-points",
    "- List Tour (poster + spotlight×N + cta) fits curated lists of places/venues",
    "- Single Beat (cover only) fits one-image scene reports or partner spotlights",
    "- Recap (cover + photo×N + stat + cta) fits post-event content",
    "",
    "Return JSON ONLY:",
    `{"templateId":"<one of the ids above>","reasoning":"<1 sentence explaining the pick>"}`,
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

export async function generateTemplateFill({ apiKey, sequence, topic, context, voice, slotPrompts }) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  if (!Array.isArray(sequence) || !sequence.length) throw new Error("Missing template sequence");
  if (!topic || !topic.trim()) throw new Error("Missing topic");

  const prompt = buildTemplatePrompt({ sequence, topic, context, voice, slotPrompts });

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

function buildTemplatePrompt({ sequence, topic, context, voice, slotPrompts }) {
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
    if (!rule) {
      return `SLIDE ${idx + 1} (${slotType.toUpperCase()}) — no rule defined; produce reasonable defaults matching brand voice.`;
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
    return `SLIDE ${idx + 1} (${slotType.toUpperCase()}):\n${rule}${extra}`;
  }).join("\n\n─────────────────────────────\n\n");

  return [
    ...voiceBlock,
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

  return [
    ...voiceBlock,
    `You are generating content for a ${slotType.toUpperCase()} slide in a CGE social media carousel.`,
    "",
    `Topic: ${topic.trim()}`,
    "",
    "Apply the rule below STRICTLY:",
    "",
    slotRule,
    "",
    "Output ONLY the JSON, no prose, no markdown fences.",
  ].join("\n");
}
