const MODEL = "gemini-2.5-flash";
const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export async function generateCaptions(apiKey, eventCtx) {
  if (!apiKey) throw new Error("Missing Gemini API key");

  const prompt = buildCaptionPrompt(eventCtx);

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

  return Array.isArray(parsed?.captions) ? parsed.captions : [];
}

function buildCaptionPrompt(ctx) {
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

  return [
    "You are writing Instagram captions for an event promo carousel.",
    "",
    "Event context:",
    ...facts.map(f => `- ${f}`),
    "",
    "Write 5 caption variants for the SAME event, each in a different tone:",
    "1. HYPE — high energy, urgency, punchy short sentences",
    "2. PROFESSIONAL — clean, declarative, polished",
    "3. MYSTERIOUS — intrigue-led, sparse, makes them want to know more",
    "4. CONVERSATIONAL — first-person, casual, like texting a friend",
    "5. QUESTION HOOK — opens with a question that grabs attention",
    "",
    "Each caption must:",
    "- Stay under 2,000 characters",
    "- Mention the date and venue naturally",
    "- End with 5–8 relevant hashtags on their own lines",
    "- Include a call-to-action line referencing the URL",
    "- Read like a human wrote it for Instagram, not a template",
    "- No emoji unless they genuinely fit the tone",
    "",
    "Return ONLY valid JSON in this exact shape:",
    '{"captions":[{"tone":"HYPE","text":"..."},{"tone":"PROFESSIONAL","text":"..."},{"tone":"MYSTERIOUS","text":"..."},{"tone":"CONVERSATIONAL","text":"..."},{"tone":"QUESTION HOOK","text":"..."}]}',
  ].join("\n");
}
