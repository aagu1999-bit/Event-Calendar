// Server-side News Scout — the autonomous half of the "news agent".
//
// The browser Scout (src/shared/aiContent.js → scoutNews) can only run while
// a tab is open. This module is the same two-step beat search, reimplemented
// standalone (no client-store / localStorage coupling) so a cron on the
// server can run it every morning and drop results into an inbox.
//
// Uses Node's global fetch (Node 18+). No new deps.

const CGE_BEAT = [
  "Central Group Events (CGE) covers Black culture, Black community, and",
  "Black-owned / Black-led happenings across New Jersey — festivals, day",
  "parties, brunches, cookouts, concerts, comedy, markets, art, cultural",
  "celebrations (Juneteenth, Caribbean/African diaspora, HBCU), new Black-owned",
  "venue/restaurant openings, and community milestones. The vibe is exciting,",
  "social, celebratory and share-worthy — the kind of thing you stop scrolling",
  "for and tag a friend in.",
].join(" ");

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function geminiFetch(apiKey, body, { tries = 4, model = "gemini-2.5-flash-lite" } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(`${url}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) { lastErr = e; continue; }
    if (res.ok) return res.json();
    const txt = await res.text().catch(() => "");
    lastErr = new Error(`Gemini ${res.status}: ${txt.slice(0, 240)}`);
    if (!RETRYABLE.has(res.status)) throw lastErr;
  }
  throw lastErr;
}

function responseText(data) {
  try {
    return (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p?.text || "").join("").trim();
  } catch { return ""; }
}

function groundingSources(data) {
  try {
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const seen = new Set(); const out = [];
    for (const c of chunks) {
      const uri = c?.web?.uri, title = c?.web?.title;
      if (uri && !seen.has(uri)) { seen.add(uri); out.push({ uri, title: (title || uri).trim() }); }
    }
    return out.slice(0, 12);
  } catch { return []; }
}

function parseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { /* fall through */ }
  // Tolerate ```json fences or leading/trailing prose.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(body.slice(start, end + 1)); } catch { /* give up */ }
  }
  return null;
}

// Run the two-step scout. Returns { candidates, sources, brief }.
export async function runScout({ apiKey, area = "New Jersey", focus = "", today = null } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  const stamp = today || new Date().toISOString().slice(0, 10);
  const areaLine = (area || "").trim() || "New Jersey";
  const focusLine = (focus || "").trim();

  // Step 1 — grounded discovery.
  const searchPrompt = [
    "You are a local-culture news scout for a Black events media page in New Jersey.",
    "Run SEVERAL distinct web searches (not just one) to find TIMELY, EVENT-BASED happenings that fit this beat:",
    CGE_BEAT,
    "",
    `AREA FOCUS: ${areaLine}.`,
    ...(focusLine ? [`EXTRA FOCUS THIS RUN: ${focusLine}.`] : []),
    "",
    `TODAY: ${stamp}. Only surface items announced/happening within roughly the last 10 days, or UPCOMING within ~4 weeks. Skip stale items.`,
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
    "MATTERS, and the SOURCE (site/publication name).",
    "",
    "RULES:",
    "- Every bullet must trace to a REAL search result. Never invent a date/venue/price.",
    "- Prefer NJ / Garden State and the named area. Rank by timeliness first, then beat-fit.",
    "- Merge duplicates. Plain-text bullets only — no preamble, no markdown headers.",
  ].join("\n");

  const searchData = await geminiFetch(apiKey, {
    contents: [{ parts: [{ text: searchPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.35 },
  }, { model: "gemini-2.5-flash" });
  const brief = responseText(searchData);
  const sources = groundingSources(searchData);
  if (!brief) return { candidates: [], sources, brief: "" };

  // Step 2 — score + structure against the beat rubric.
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
    "- Excitement / share-worthiness",
    "DROP anything that clearly isn't a fit (generic national news, non-NJ, not event/culture).",
    "",
    "For each surviving candidate return:",
    "- headline: a punchy 4-9 word hook, Title Case, no ending period",
    "- kicker: a 1-3 word ALL-CAPS eyebrow (e.g. THIS WEEKEND, JUST OPENED, BREAKING)",
    "- body: 1-2 tight sentences — what it is + why it matters",
    "- whenWhere: a short 'venue · town · [date]' line, or \"\" if unknown",
    "- score: the 0-100 number",
    "Rank best-first. Return 5-10 candidates.",
    "",
    "BRIEF:",
    brief,
    "",
    'Return ONLY JSON in this exact shape: {"candidates":[{"headline":"...","kicker":"...","body":"...","whenWhere":"...","score":88}]}',
  ].join("\n");

  let candidates = [];
  try {
    const data = await geminiFetch(apiKey, {
      contents: [{ parts: [{ text: rubricPrompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    });
    const parsed = parseJson(responseText(data));
    candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  } catch { candidates = []; }

  candidates = candidates
    .filter((c) => c && (c.headline || c.body))
    .map((c) => ({
      headline: String(c.headline || "").trim(),
      kicker: String(c.kicker || "").trim(),
      body: String(c.body || "").trim(),
      whenWhere: String(c.whenWhere || "").trim(),
      score: typeof c.score === "number" ? c.score : Number(c.score) || 0,
    }))
    .sort((a, b) => b.score - a.score);
  return { candidates, sources, brief };
}

// A stable-ish dedup key for a story — lowercased alphanumerics of the
// headline, so tiny wording drift across days still collapses to one item.
export function storyKey(c) {
  return String(c?.headline || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60);
}

// Rotate the daily focus so successive runs hunt different corners of the beat
// instead of resurfacing the same "this weekend" list every day. Indexed by
// day-of-week so it's deterministic (no Math.random needed).
const FOCUS_ROTATION = [
  "",                                   // Sun — general sweep
  "new Black-owned restaurant or venue openings",  // Mon
  "live music, concerts and nightlife", // Tue
  "day parties, brunches and cookouts", // Wed
  "art, markets and cultural celebrations", // Thu
  "this weekend — everything happening", // Fri
  "family, community and festival events", // Sat
];
export function focusForDay(dow) {
  return FOCUS_ROTATION[((dow % 7) + 7) % 7] || "";
}

export { CGE_BEAT };
