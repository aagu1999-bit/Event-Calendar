// Evidence Extractor — Layer 1 of the three-layer rebuild under the writer.
//
// WHY THIS EXISTS
// ───────────────
// Fuel Research returns an array of bullets. Each bullet is already
// atomic-ish (a sentence a desk wrote), but each bullet is in
// RESEARCH-REGISTER grammar: "brought together teams focused on
// developing solutions", "has not been independently verified",
// "a comprehensive guide emerges as an essential tool". When the
// writer reads those bullets, two things happen:
//
//   1. REGISTER CONTAGION — the writer completes in the register of
//      what it just read. Research-register bullets → research-register
//      slides.
//   2. QUOTE-LATCH — a bullet that already contains the information
//      for a slide is cheapest to paraphrase, so the writer paraphrases
//      the bullet (hedges and all) instead of composing fresh prose.
//
// This module runs AFTER Fuel returns. It takes the bullets and
// re-shapes them into a structured evidence packet: {facts, entities,
// hedges, coverage}. Hedges are SEPARATED out, not deleted. The writer
// (in a follow-up PR) will read the packet instead of the raw bullets,
// which breaks both failure modes above.
//
// WHAT THIS DOES NOT DO
// ─────────────────────
// - Does NOT change what the writer reads. That's PR 2. This PR
//   produces the packet and shows it to the operator for inspection.
// - Does NOT change the Spine, Developer, role classifier, or polish.
//   Those are Layers 2 and 3, separate PRs.
// - Does NOT replace the data_points field. The packet is persisted
//   alongside data_points. Legacy matrices without a packet keep
//   working exactly as they did.
//
// FAILURE MODE
// ────────────
// If the extractor fails or returns garbage, the matrix keeps its
// bullets and everything downstream works as before. Zero regression.
// The operator can re-run extraction with a button.

import { extractJson, extractResponseText } from "./aiJson.js";

const MODEL = "gemini-2.5-flash-lite";
const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function geminiGenerate(apiKey, requestBody, { tries = 3 } = {}) {
  if (!apiKey) throw new Error("Missing Gemini API key");
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (res.ok) return res.json();
    const errText = await res.text();
    lastErr = new Error(`Gemini ${res.status}: ${errText.slice(0, 240)}`);
    if (!RETRYABLE_STATUS.has(res.status)) throw lastErr;
  }
  throw lastErr;
}

// Structured output schema — minimal nested requirements so Gemini
// doesn't pad every object with required fields it would otherwise
// omit. Only `claim` is required on a fact and only `name` is required
// on an entity. The normalizer fills in sensible defaults for everything
// else, so a lean response that only names claims + entities still
// produces a valid packet. This keeps output tokens honest.
const EXTRACTOR_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          claim: { type: "string" },
          entity_ids: { type: "array", items: { type: "string" } },
          source_bullets: { type: "array", items: { type: "integer" } },
          specificity: { type: "number" },
          has_hedge: { type: "boolean" },
        },
        required: ["claim"],
      },
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          attributes: { type: "object", properties: {} },
          fact_ids: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
    },
    hedges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          source_bullet: { type: "integer" },
          kind: { type: "string" },
        },
        required: ["text"],
      },
    },
    coverage: {
      type: "object",
      properties: {
        gaps: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["facts"],
};

function buildPrompt({ bullets = [], thesis = "", cluster = "", corridor = "", lensOverride = "", topic = "" } = {}) {
  const safeBullets = bullets.map((b, i) => `[${i}] ${String(b || "").trim()}`).join("\n");
  const lensLine = String(lensOverride || "").trim();
  const topicLine = String(topic || "").trim();
  const corridorLine = String(corridor || "").trim();
  const clusterLine = String(cluster || "").trim();
  const thesisLine = String(thesis || "").trim();

  return [
    "You are a FACT EXTRACTOR for a Black New Jersey cultural magazine's AI carousel pipeline.",
    "",
    "YOUR JOB is to turn research bullets into a structured evidence packet. The next step",
    "in the pipeline is a writer that will build Instagram carousel slides. The writer must",
    "see FACTS, ENTITIES, and FLAGGED HEDGES — never the research prose directly, because",
    "the writer paraphrases what it reads and would inherit any research-report register,",
    "disclaimer language, or grant-adjacent framing in the source bullets.",
    "",
    "═══════════════════════════════════",
    "EDITORIAL CONTEXT (do not quote; use to score alignment)",
    "═══════════════════════════════════",
    topicLine ? `TOPIC: ${topicLine}` : "",
    thesisLine ? `THESIS from Perplexity scout: ${thesisLine}` : "",
    clusterLine ? `CLUSTER: ${clusterLine}` : "",
    corridorLine ? `CORRIDOR: ${corridorLine}` : "",
    lensLine ? `LENS NARROWING (the question this piece answers): ${lensLine}` : "",
    "",
    "═══════════════════════════════════",
    "SOURCE BULLETS (indexed; refer to indices in your output)",
    "═══════════════════════════════════",
    safeBullets || "(no bullets supplied)",
    "",
    "═══════════════════════════════════",
    "EXTRACTION RULES",
    "═══════════════════════════════════",
    "",
    "1) ATOMIZE INTO FACTS. Each bullet may contain 1–4 distinct claims.",
    "   Split them. Each fact is ONE claim — one subject + one predicate.",
    "   A bullet like 'Rutgers iHub hosted the NJ Code & Coffee hackathon on",
    "   water safety, food access, and civic transparency' becomes 3 facts:",
    "     - NJ Code & Coffee held a hackathon at Rutgers iHub.",
    "     - The hackathon addressed water safety, food access, and civic transparency.",
    "     - The focus was Newark civic challenges.",
    "   STRIP research-register verbs: 'emerges as', 'serves as the foundational',",
    "   'brought together teams focused on', 'provides essential local context'.",
    "   Rewrite each fact in NEWS register: concrete subject, active verb, specific object.",
    "   DO NOT invent facts. Only split and clarify what the bullets ACTUALLY contain.",
    "",
    "2) RESOLVE ENTITIES. For every named entity across all bullets (venue,",
    "   person, org, event, place, program), create ONE entity record and link",
    "   facts to its id. Normalize ('Rutgers iHub', 'the iHub', 'Rutgers Innovation Hub'",
    "   are ONE entity). Capture any attributes mentioned (address, neighborhood,",
    "   date range, role, parent org).",
    "   Entity types: 'venue' | 'person' | 'org' | 'event' | 'place' | 'program' | 'other'.",
    "   Entity ids: short slugs like 'e1', 'e2'.",
    "",
    "3) SEPARATE HEDGES. If a bullet contains disclaimer / hedge language",
    "   ('has not been independently verified', 'should be confirmed with',",
    "   'as of this report', 'is strongly advised', 'subject to change',",
    "   'reportedly', 'allegedly without a named source') — extract the hedge",
    "   sentence VERBATIM into the hedges array with the source_bullet index.",
    "   Do NOT include the hedge in the fact's claim. The writer will never",
    "   see hedges; the operator will see them for inspection.",
    "   Hedge kinds: 'verification' | 'disclaimer' | 'caveat' | 'temporal'.",
    "",
    "4) SCORE SPECIFICITY (0.0 – 1.0). Score each fact on how concrete it is:",
    "     0.9+  — named entity + named date/number + verifiable detail",
    "     0.7   — named entity + one specific detail",
    "     0.5   — named entity, no quantifier",
    "     0.3   — abstraction or generalization with weak anchor",
    "     < 0.3 — no named entity, pure framing / abstraction",
    "   Facts under 0.4 should probably not be kept. Use judgment.",
    "",
    "5) LINK FACTS TO SOURCE BULLETS. Each fact's source_bullets is the array",
    "   of 0-based bullet indices that contain the fact. A fact derived from",
    "   bullet 2 has source_bullets: [2]. A fact synthesized across two",
    "   bullets has source_bullets: [1, 3].",
    "",
    "6) COVERAGE GAPS. In coverage.gaps, flag what the editorial context",
    "   (topic, lens, cluster) asked for but the bullets do NOT contain —",
    "   e.g. 'no speaker names surfaced', 'no attendance numbers',",
    "   'no named counterexample to the lens question'. This tells the",
    "   operator what to re-fuel for. Keep gaps short, one line each.",
    "",
    "═══════════════════════════════════",
    "OUTPUT BUDGET — PREFER FEWER STRONG FACTS OVER MANY WEAK ONES",
    "═══════════════════════════════════",
    "- At most 15 facts total. Prefer the 10–15 that score highest on",
    "  specificity. Dropping a 0.3-specificity fact is correct behavior,",
    "  not a loss. The writer wants concrete anchors, not an exhaustive",
    "  inventory of everything mentioned.",
    "- At most 10 entities. Collapse near-duplicates ('Rutgers iHub' /",
    "  'Rutgers Innovation Hub' / 'the iHub' = ONE entity).",
    "- At most 5 hedges. Only distinct disclaimer sentences.",
    "- At most 5 coverage gaps. The 2–3 most actionable ones.",
    "",
    "KEEP THE OUTPUT TIGHT. The schema does not require fields like",
    "entity_ids on every fact or attributes on every entity — omit them",
    "when you'd otherwise emit an empty array / object. Shorter output",
    "that captures the essentials beats a padded output that truncates.",
    "",
    "═══════════════════════════════════",
    "OUTPUT: strict JSON matching the schema. No prose outside the JSON.",
    "═══════════════════════════════════",
  ].filter(Boolean).join("\n");
}

export async function extractEvidencePacket({
  apiKey,
  bullets = [],
  citations = [],
  thesis = "",
  cluster = "",
  corridor = "",
  lensOverride = "",
  topic = "",
} = {}) {
  if (!apiKey) return { ok: false, code: "no_key", message: "Missing Gemini API key" };
  const cleanBullets = (bullets || []).map((b) => String(b || "").trim()).filter(Boolean);
  if (!cleanBullets.length) return { ok: false, code: "no_bullets", message: "No research bullets to extract from" };

  const prompt = buildPrompt({ bullets: cleanBullets, thesis, cluster, corridor, lensOverride, topic });

  // Flash-Lite burns output tokens on structured JSON padding. Give the
  // budget serious headroom (16K); the loose schema + explicit prompt
  // caps keep output nowhere near that in practice, but a MAX_TOKENS
  // truncation gives the operator garbage so we'd rather over-allocate.
  // thinkingBudget: 0 is a no-op on Flash-Lite (no thinking by default)
  // but keeps the config explicit for future model swaps.
  const baseConfig = {
    responseMimeType: "application/json",
    temperature: 0.2,
    maxOutputTokens: 16384,
    thinkingConfig: { thinkingBudget: 0 },
  };

  // Try schema call first. If it throws OR returns a response we can't
  // parse (e.g. MAX_TOKENS truncation), fall through to a no-schema
  // retry. The parse check lives inside this helper so both failure
  // modes share the fall-through path.
  const tryCall = async (useSchema) => {
    const promptText = useSchema
      ? prompt
      : "RESPOND WITH VALID JSON ONLY. No prose, no markdown fences, no commentary. Start with { and end with }. Keep output under 10KB — prefer fewer high-specificity facts over many weak ones.\n\n" + prompt;
    const generationConfig = useSchema
      ? { ...baseConfig, responseSchema: EXTRACTOR_SCHEMA }
      : baseConfig;
    const data = await geminiGenerate(apiKey, {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig,
    });
    const raw = extractResponseText(data);
    const finishReason = data?.candidates?.[0]?.finishReason || "unknown";
    if (!raw) throw new Error(`empty response (finishReason: ${finishReason})`);
    try {
      return { parsed: extractJson(raw) };
    } catch (parseErr) {
      const snippet = String(raw).slice(0, 200).replace(/\s+/g, " ").trim();
      try { console.warn("[evidenceExtractor] unparseable response:", raw); } catch { /* noop */ }
      throw new Error(`parse failed (finishReason: ${finishReason}; ${parseErr?.message || "unknown"}). First 200 chars: ${snippet || "(empty)"}`);
    }
  };

  let result;
  let schemaErr = null;
  try {
    result = await tryCall(true);
  } catch (err) {
    schemaErr = err;
    try {
      result = await tryCall(false);
    } catch (err2) {
      return {
        ok: false,
        code: "bad_response",
        message: `Extractor failed on both attempts. Schema: ${schemaErr?.message || "unknown"}. Fallback: ${err2?.message || "unknown"}`,
      };
    }
  }

  const parsed = result.parsed;

  const packet = normalizePacket(parsed, { citations });
  if (!packet) return { ok: false, code: "bad_shape", message: "Extractor returned invalid packet shape" };

  return {
    ok: true,
    packet: {
      ...packet,
      sources: Array.isArray(citations) ? citations.slice(0, 16) : [],
      source_bullet_count: cleanBullets.length,
      extracted_at: new Date().toISOString(),
      model: MODEL,
      schema_version: 1,
    },
  };
}

// Normalize a Gemini extractor response into the canonical packet shape.
// Returns null if the response is unusable. Defensive — Gemini has been
// known to drop required fields, return numbers as strings, or
// hallucinate ids that don't match across arrays.
function normalizePacket(parsed, { citations = [] } = {}) {
  if (!parsed || typeof parsed !== "object") return null;

  const rawFacts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
  const rawHedges = Array.isArray(parsed.hedges) ? parsed.hedges : [];
  const coverage = parsed.coverage && typeof parsed.coverage === "object" ? parsed.coverage : {};

  if (!rawFacts.length) return null;

  const facts = rawFacts.map((f, i) => {
    const id = (typeof f.id === "string" && f.id.trim()) || `f${i + 1}`;
    const claim = String(f.claim || "").trim();
    if (!claim) return null;
    const entity_ids = Array.isArray(f.entity_ids)
      ? f.entity_ids.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const source_bullets = Array.isArray(f.source_bullets)
      ? f.source_bullets.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0)
      : [];
    let specificity = Number(f.specificity);
    if (!Number.isFinite(specificity)) specificity = 0.5;
    specificity = Math.max(0, Math.min(1, specificity));
    const has_hedge = !!f.has_hedge;
    return { id, claim, entity_ids, source_bullets, specificity, has_hedge };
  }).filter(Boolean);

  if (!facts.length) return null;

  const entities = rawEntities.map((e, i) => {
    const id = (typeof e.id === "string" && e.id.trim()) || `e${i + 1}`;
    const name = String(e.name || "").trim();
    if (!name) return null;
    const type = String(e.type || "other").trim().toLowerCase();
    const attributes = e.attributes && typeof e.attributes === "object" ? e.attributes : {};
    const fact_ids = Array.isArray(e.fact_ids)
      ? e.fact_ids.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    return { id, name, type, attributes, fact_ids };
  }).filter(Boolean);

  const hedges = rawHedges.map((h) => {
    const text = String(h.text || "").trim();
    if (!text) return null;
    const kind = String(h.kind || "caveat").trim().toLowerCase();
    const source_bullet = Number.isInteger(h.source_bullet) ? h.source_bullet : null;
    return { text, kind, source_bullet };
  }).filter(Boolean);

  const gaps = Array.isArray(coverage.gaps)
    ? coverage.gaps.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 10)
    : [];
  const notes = typeof coverage.notes === "string" ? coverage.notes.trim().slice(0, 400) : "";

  void citations;

  return {
    facts,
    entities,
    hedges,
    coverage: { gaps, notes },
  };
}

// Convenience selector — the median specificity across all facts.
// Used by the inspection UI as a one-number quality indicator.
export function packetSpecificityMedian(packet) {
  if (!packet || !Array.isArray(packet.facts) || !packet.facts.length) return null;
  const scores = packet.facts.map((f) => Number(f.specificity)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!scores.length) return null;
  const mid = Math.floor(scores.length / 2);
  return scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];
}

export function packetSummaryCounts(packet) {
  if (!packet || typeof packet !== "object") return { facts: 0, entities: 0, hedges: 0, gaps: 0 };
  return {
    facts: Array.isArray(packet.facts) ? packet.facts.length : 0,
    entities: Array.isArray(packet.entities) ? packet.entities.length : 0,
    hedges: Array.isArray(packet.hedges) ? packet.hedges.length : 0,
    gaps: Array.isArray(packet.coverage?.gaps) ? packet.coverage.gaps.length : 0,
  };
}
