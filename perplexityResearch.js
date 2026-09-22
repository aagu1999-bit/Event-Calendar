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
function buildResearchMessages({ cluster, topic, pov, existingBullets, tier }) {
  const existing = Array.isArray(existingBullets) ? existingBullets.filter(Boolean) : [];
  const systemLines = [
    "You are a research assistant for Central Group Events (CGE), a Black-culture events media brand in New Jersey.",
    "Return 3–4 concise factual bullet points relevant to the operator's editorial angle. Each bullet under 200 characters. Format each as one line starting with '- '.",
    "Every bullet must be a verifiable fact grounded in reputable sources: municipal data, transit info, historical records, verified news, policy documents. Never invent, never speculate.",
    "If the operator lists existing bullets, do NOT repeat them — add complementary facts that broaden the angle.",
    "No preamble, no closing summary, no headings. ONLY the dashed bullet lines.",
  ];
  const userLines = [];
  if (tier) userLines.push(`Tier: ${tier}`);
  if (cluster) userLines.push(`Editorial cluster: ${cluster}`);
  if (topic) userLines.push(`Topic / hook: ${topic}`);
  if (pov) userLines.push(`Operator POV (thesis): ${pov}`);
  if (existing.length) {
    userLines.push("");
    userLines.push("Bullets already on the matrix (do NOT repeat):");
    for (const b of existing) userLines.push(`- ${b}`);
  }
  userLines.push("");
  userLines.push("Return 3–4 NEW dashed bullets that complement the above.");
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
  if (!cluster && !topic) {
    return { ok: false, code: "no_seed", message: "Add a cluster or a hook A-side before running Fuel Research — the model needs an angle to research." };
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
