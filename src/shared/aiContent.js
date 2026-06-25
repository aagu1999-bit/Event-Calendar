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
