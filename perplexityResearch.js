// Server-side wrapper around Perplexity's Sonar API for the Matrix
// modal's 🔮 Fuel Research button. Given a cluster + topic + optional POV
// and the operator's existing bullets, returns 3-4 concise, factually
// grounded data points plus source URLs so the operator can vet them
// before they land on the matrix.
//
// Requires PERPLEXITY_API_KEY in Replit Secrets. Returns null (with a
// distinguishing error code) on every failure mode so the client can
// paint a specific message. The token stays server-side — the browser
// never sees it.
//
// Model choice: `sonar-pro` — web-grounded + reasoning + citations in
// one call. Overridable via PERPLEXITY_MODEL env var if the operator
// wants to swap to `sonar` for cheaper research or `sonar-reasoning`
// for deeper analysis.

const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";
const DEFAULT_MODEL = (process.env.PERPLEXITY_MODEL || "sonar-pro").trim();

// The prompt is deliberately tight. Sonar is good but chatty by
// default; we tell it exactly what shape to return so the client can
// parse without a second round-trip.
//
// Guardrails (added after the "Let Me Know" incident where a 15-char
// ambiguous hook made sonar-pro return song-lyrics facts instead of
// NJ-culture context):
//   - Lead with CGE's NJ Black-culture beat so Sonar knows the frame
//     before it sees any user field.
//   - Explicit refusal instruction: 0 bullets is better than off-topic
//     bullets. Never fill quota with unrelated entertainment/celebrity
//     facts to hit the "3-4" number.
//   - Cluster and Tier are elevated to the FIRST user-message lines
//     because they're the least ambiguous signals of intent.
//   - Short hooks (<40 chars) get a specific instruction: treat as
//     rhetorical/emotive framing, NOT as a literal title lookup.
function buildResearchMessages({ cluster, topic, pov, existingBullets, tier }) {
  const existing = Array.isArray(existingBullets) ? existingBullets.filter(Boolean) : [];
  const isShortHook = typeof topic === "string" && topic.trim().length > 0 && topic.trim().length < 40;
  const systemLines = [
    "You are a research assistant for Central Group Events (CGE) — a media brand covering Black cultural, social, and civic life in New Jersey.",
    "Every bullet you return MUST connect to New Jersey specifically (a NJ neighborhood, transit corridor, municipality, historical event, policy, venue, community, or demographic pattern) AND to the editorial cluster the operator names.",
    "",
    "STRICT REFUSAL RULE — this is the most important rule:",
    "  - If you cannot find at least 2 verified NJ-tied, cluster-relevant facts, return ZERO bullets. Do NOT fill the quota with generic entertainment, celebrity, song-lyric, national politics, or non-NJ historical facts.",
    "  - Returning nothing is BETTER than returning off-topic content. The operator would rather see 'no bullets — try broadening' than get pulled off-brand.",
    "",
    "FORMAT RULES:",
    "  - Return 2–4 concise factual bullet points. Each bullet under 200 characters.",
    "  - Format each as one line starting with '- '.",
    "  - Every bullet must be a verifiable fact grounded in reputable sources: municipal records, transit/demographic data, NJ history, verified news, policy documents, cultural archives.",
    "  - Never invent, never speculate.",
    "  - If existing bullets are listed, do NOT repeat them — add complementary NJ-tied facts.",
    "  - No preamble, no closing summary, no headings. ONLY dashed bullet lines.",
  ];
  const userLines = [];
  // Cluster and tier lead — the least ambiguous signals of what the
  // operator actually wants. Sonar reads top-to-bottom weightily.
  if (cluster) userLines.push(`EDITORIAL CLUSTER (primary frame): ${cluster}`);
  if (tier) userLines.push(`Tier: ${tier}`);
  userLines.push("");
  if (topic) {
    if (isShortHook) {
      // Explicit: don't literal-lookup a short hook. The operator meant
      // it as a curated angle, not a search query.
      userLines.push(`Editorial hook (short/rhetorical — treat as thematic framing, NOT a literal title to look up): "${topic}"`);
    } else {
      userLines.push(`Editorial hook: ${topic}`);
    }
  }
  if (pov) userLines.push(`Operator POV (thesis): ${pov}`);
  if (existing.length) {
    userLines.push("");
    userLines.push("Bullets already on the matrix (do NOT repeat):");
    for (const b of existing) userLines.push(`- ${b}`);
  }
  userLines.push("");
  userLines.push(`Return 2–4 NEW dashed bullets that are strictly NJ-tied and strictly aligned with the "${cluster || "(cluster missing)"}" cluster. Return NOTHING if you can't meet both bars.`);
  return [
    { role: "system", content: systemLines.join("\n") },
    { role: "user", content: userLines.join("\n") },
  ];
}

// Parse Sonar's assistant reply back into an array of bullet strings.
// Recognizes '-', '•', '*', and numeric list markers so a stray format
// choice by the model doesn't drop useful output on the floor.
function parseBullets(text) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:[-•*]|\d+[.)])\s+(.+?)\s*$/);
    if (m && m[1]) out.push(m[1].trim());
  }
  return out;
}

// Sonar returns citations as an array of URLs on the response's
// `citations` field. We keep them as-is; the client renders them as a
// small vetting strip under the added bullets.
function pickCitations(json) {
  if (Array.isArray(json?.citations)) return json.citations.filter((u) => typeof u === "string");
  // Older responses sometimes nest citations under choices[0].message.citations
  const nested = json?.choices?.[0]?.message?.citations;
  if (Array.isArray(nested)) return nested.filter((u) => typeof u === "string");
  return [];
}

export async function fuelResearchViaPerplexity({ cluster, topic, pov, existingBullets, tier } = {}) {
  const key = (process.env.PERPLEXITY_API_KEY || "").trim();
  if (!key) return { ok: false, code: "not_configured", message: "Set PERPLEXITY_API_KEY in Replit Secrets to enable Fuel Research." };
  if (!cluster) {
    return { ok: false, code: "no_seed", message: "Pick a Cluster before running Fuel Research — it's the primary frame Sonar uses to stay on-brand." };
  }
  const messages = buildResearchMessages({ cluster, topic, pov, existingBullets, tier });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const resp = await fetch(PERPLEXITY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        temperature: 0.2,
      }),
      signal: ctrl.signal,
    });
    const text = await resp.text().catch(() => "");
    if (resp.status === 401 || resp.status === 403) {
      return { ok: false, code: "auth", message: "Perplexity rejected the key. Check PERPLEXITY_API_KEY in Replit Secrets." };
    }
    if (!resp.ok) {
      return { ok: false, code: "upstream", message: `Perplexity ${resp.status}: ${text.slice(0, 240)}` };
    }
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (!json) return { ok: false, code: "bad_response", message: "Perplexity returned an unparseable response." };
    const assistantText = json?.choices?.[0]?.message?.content || "";
    const bullets = parseBullets(assistantText).filter((b) => b.length && b.length <= 400);
    if (!bullets.length) {
      return { ok: false, code: "empty", message: "Perplexity returned no usable bullets — try broadening the cluster or hook." };
    }
    return {
      ok: true,
      bullets,
      citations: pickCitations(json),
      model: DEFAULT_MODEL,
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, code: "timeout", message: "Perplexity timed out (45s). Retry, or try a narrower cluster/topic." };
    }
    return { ok: false, code: "network", message: `Couldn't reach Perplexity: ${String(err?.message || err)}` };
  } finally {
    clearTimeout(timer);
  }
}

// Small helper the /apify-status pattern uses too — the client hits this
// to know whether to render the button as enabled or as a "set the key"
// pointer.
export function isPerplexityConfigured() {
  return !!(process.env.PERPLEXITY_API_KEY || "").trim();
}
