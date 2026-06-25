const MODEL = "gemini-2.5-flash";
const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export async function generateCaptions(apiKey, eventCtx, images = [], options = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");

  const hasVision = Array.isArray(images) && images.length > 0;
  const voice = options.voice || null;
  const prompt = buildCaptionPrompt(eventCtx, hasVision, voice);

  const parts = [{ text: prompt }];
  if (hasVision) {
    for (const img of images) {
      const b64 = img.startsWith("data:") ? img.split(",")[1] : img;
      parts.push({ inline_data: { mime_type: "image/png", data: b64 } });
    }
  }

  const res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
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

  return Array.isArray(parsed?.captions) ? parsed.captions : [];
}

function buildCaptionPrompt(ctx, hasVision = false, voice = null) {
  // Voice fingerprint priming — when the user has filled in the Brand Kit
  // voice section, prepend it so every caption sounds like THIS brand,
  // not Gemini's generic register. Description sets cadence/tone; exemplars
  // give the model concrete texture to imitate.
  const hasVoiceDesc = voice && typeof voice.description === "string" && voice.description.trim();
  const exemplars = Array.isArray(voice?.exemplars) ? voice.exemplars.filter(e => e && e.trim()) : [];
  const hasExemplars = exemplars.length > 0;
  const voiceBlock = (hasVoiceDesc || hasExemplars) ? [
    "BRAND VOICE FINGERPRINT — read this BEFORE writing anything.",
    "Every caption you write must sound like the brand voice described below,",
    "regardless of which tone variant (HYPE / PROFESSIONAL / etc.) it is.",
    "The tone variant changes the energy; the voice stays the same.",
    "",
    ...(hasVoiceDesc ? [
      "Voice description:",
      voice.description.trim(),
      "",
    ] : []),
    ...(hasExemplars ? [
      `Past captions in this voice (${exemplars.length} examples — study sentence length, cadence, hashtag style, what gets named vs implied):`,
      "",
      ...exemplars.map((e, i) => `=== Example ${i + 1} ===\n${e.trim()}`),
      "",
      "Now write the new captions in the same voice as those examples.",
      "",
    ] : []),
    "─────────────────────────────",
    "",
  ] : [];

  // The caller may pass either a flat form-field ctx (old behavior, used
  // when the carousel is empty) OR a `carouselSummary` block (preferred
  // when the carousel has slides). The latter gives the model a much
  // richer picture across all templates.
  const facts = [];
  if (ctx.headline) facts.push(`Cover headline: "${ctx.headline}"`);
  if (ctx.subtitle) facts.push(`Subtitle: "${ctx.subtitle}"`);
  if (ctx.ribbon) facts.push(`Ribbon kicker: "${ctx.ribbon}"`);
  if (ctx.problemTitle) facts.push(`Hook title: "${ctx.problemTitle}"`);
  if (ctx.problemBody) facts.push(`Hook body: "${ctx.problemBody}"`);
  if (ctx.benefits) facts.push(`What the night includes:\n${ctx.benefits.replace(/\*/g, "")}`);
  if (ctx.statNumber || ctx.statLabel) facts.push(`Stat: ${ctx.statNumber || ""} ${ctx.statLabel || ""}`.trim());
  if (ctx.statSub) facts.push(`Stat sub: "${ctx.statSub}"`);
  if (ctx.ctaDate) facts.push(`Date: ${ctx.ctaDate}`);
  if (ctx.ctaVenue) facts.push(`Venue: ${ctx.ctaVenue}`);
  if (ctx.ctaUrl) facts.push(`URL: ${ctx.ctaUrl}`);

  const hasCarouselContext = Boolean(ctx.carouselSummary);

  return [
    ...voiceBlock,
    "You are writing Instagram captions for an event promo carousel.",
    "",
    hasCarouselContext
      ? "Here is every slide in the carousel, in order, with all of its text content. Treat this as the full content of the post:"
      : "Event context:",
    "",
    hasCarouselContext ? ctx.carouselSummary : facts.map(f => `- ${f}`).join("\n"),
    "",
    ...(hasVision ? [
      "I'm also attaching the actual rendered carousel slide images in order.",
      "Use visual details from the slides — colors, photography, layout, what's visible —",
      "to write captions that feel grounded in the real artwork, not just the text above.",
      "If a slide has a strong photo, you can reference it specifically (e.g. \"the golden-hour shot\").",
      "",
    ] : []),
    "Write 8 caption variants for the SAME event, each in a different tone.",
    "Follow each spec precisely — these tones are DIFFERENT and should feel different:",
    "",
    "1. HYPE — high energy, urgency, punchy short sentences. Light emoji ok.",
    "",
    "2. PROFESSIONAL — clean, declarative, polished. No emoji.",
    "",
    "3. MYSTERIOUS — intrigue-led, sparse, makes them want to know more. Few words. No emoji.",
    "",
    "4. CONVERSATIONAL — first-person, casual, like texting a friend.",
    "",
    "5. QUESTION HOOK — opens with a question that grabs attention.",
    "",
    "6. DATA DROP — bulleted, scannable, recap/conference vibe. Use emoji as bullets.",
    "   Pattern: 1 short opening line, then 3–5 emoji-led bullets of standout facts,",
    '   then a CTA line. Example bullet: "🎤 5 incredible guest speakers".',
    "",
    "7. VIBE CHECK — minimalist, 1–2 short lines max, evocative. Let the photo do the talking.",
    '   Example length: "Moments like this. 🖤✨" then "#EventName #City". That short.',
    "",
    "8. SYMBOL STORY — long-form storytelling with symbol-separated paragraphs.",
    "   Structure: Hook paragraph, Context paragraph, Meaning paragraph, CTA paragraph.",
    "   Separate paragraphs with a line containing a single symbol like ─ or • or a line break with a dash.",
    "   Each paragraph 2–3 sentences. Reads like a deliberate story arc.",
    "",
    "Universal rules for every caption:",
    "- Stay under 2,000 characters",
    "- Mention the date and venue naturally (except VIBE CHECK — that one stays minimal)",
    "- End with 5–8 relevant hashtags on their own lines (except VIBE CHECK — fewer is fine)",
    "- Include a call-to-action line referencing the URL (except VIBE CHECK — optional)",
    "- Read like a human wrote it for Instagram, not a template",
    "",
    "Return ONLY valid JSON in this exact shape:",
    '{"captions":[{"tone":"HYPE","text":"..."},{"tone":"PROFESSIONAL","text":"..."},{"tone":"MYSTERIOUS","text":"..."},{"tone":"CONVERSATIONAL","text":"..."},{"tone":"QUESTION HOOK","text":"..."},{"tone":"DATA DROP","text":"..."},{"tone":"VIBE CHECK","text":"..."},{"tone":"SYMBOL STORY","text":"..."}]}',
  ].join("\n");
}
