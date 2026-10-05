// Server-only Agent API adapter for the existing Matrix Fuel Research UI.
//
// Google AI Mode order — not desk-first clerk work:
//   Phase 1 — SCOUT: open-web NJ brief. Thesis + starting points a
//             writer can steal. No 20-domain cap. Focus the query on
//             New Jersey and ask for real examples, programs, pieces.
//   Phase 2 — DIVE: desks open those starting points (official record,
//             Black-NJ argument, leftover press / apparent halls).
//             Thicken. Do not drop the brief because a cafe homepage
//             also exists.
//
// If the dive fails, the scout brief still ships (phase: "scout").
// That brief is the product. The desks are homework on it.
import Perplexity from "@perplexity-ai/perplexity_ai";
import { getClusterDirective, getClusterLabel, isHistoricalCluster, resolveEditorialLens } from "./src/shared/matrixCompass.js";
import {
  OFFICIAL_SEARCH_DOMAINS,
  CULTURAL_SEARCH_DOMAINS,
  classifySources,
  countSourceClasses,
  argumentDeskEmpty,
  preferDeskSources,
  clusterSearchQueries,
  lensDiscoveryQueries,
  apparentLookthroughDomains,
  lookthroughSearchQueries,
  sourceDoctrineForPrompt,
} from "./src/shared/cgeSources.js";

export function isPerplexityConfigured() {
  return !!process.env.PERPLEXITY_API_KEY?.trim();
}

// Shared response schema for both phases — same shape, different jobs.
const BULLETS_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "research_bullets",
    schema: {
      type: "object",
      properties: {
        thesis: { type: "string" },
        bullets: { type: "array", items: { type: "string" } },
        citations: { type: "array", items: { type: "string" } },
      },
      required: ["bullets"],
      additionalProperties: false,
    },
  },
};

// Build the user-facing context block once — both phases see the same
// matrix dimensions. Only the instructions differ.
function buildUserPayload({ cluster = "", topic = "", pov = "", existingBullets = [], tier = "", corridor = "", demographics = [], lensOverride = "", extraSearches = [] } = {}) {
  const clusterLabel = getClusterLabel(cluster) || String(cluster || "").trim();
  const resolvedLens = resolveEditorialLens({ cluster, override: lensOverride });
  const clusterDirective = resolvedLens.base;
  const narrowingClause = resolvedLens.override;
  const workingTitle = String(topic || "").trim();
  const povLine = String(pov || "").trim();
  const demoList = Array.isArray(demographics)
    ? demographics.filter((d) => typeof d === "string" && d.trim()).map((d) => d.trim())
    : [];
  const demoLine = demoList.length ? demoList.join(", ") : "";
  const userLines = [
    `Topic: ${workingTitle || "(none)"}.`,
    `Corridor: ${String(corridor || "").trim() || "(none)"}.`,
    `Editorial Cluster: ${clusterLabel || "(none)"}.`,
    `Target Audience (who these venues must serve): ${demoLine || "(none specified — infer from cluster)"}.`,
    `Brand thesis: ${povLine || "N/A"}.`,
  ];
  if (clusterDirective) userLines.push(`Analytical lens (base — cluster identity): ${clusterDirective}`);
  if (narrowingClause) userLines.push(`Analytical lens NARROWING (operator override for THIS piece — narrows the base to a specific angle, does NOT replace it; every fact must satisfy BOTH clauses): ${narrowingClause}`);
  if (existingBullets.length) {
    userLines.push("Do NOT repeat these bullets already on the matrix:");
    for (const b of existingBullets.slice(0, 12)) {
      if (typeof b === "string" && b.trim()) userLines.push(`- ${b.trim().slice(0, 500)}`);
    }
  }
  if (tier) userLines.push(`Tier: ${tier}.`);
  const named = [...clusterSearchQueries(cluster), ...(Array.isArray(extraSearches) ? extraSearches : [])];
  if (named.length) {
    userLines.push("NAMED SEARCHES — run these queries, do not only riff on the topic:");
    for (const q of named) userLines.push(`- ${q}`);
  }
  return userLines.join("\n");
}

function webSearchTool(domains) {
  return {
    type: "web_search",
    filters: { search_domain_filter: (domains || []).slice(0, 20) },
    user_location: { country: "US", region: "NJ" },
  };
}

function openWebSearch() {
  return { type: "web_search", user_location: { country: "US", region: "NJ" } };
}

// ─── PHASE 1: NJ AI MODE SCOUT ───────────────────────────────────
// Open web. New Jersey first. A thesis plus starting points — the
// shape Google AI Mode already produced for the suburban-strip hook.
export function researchAiModeRequest(input = {}) {
  const historicalOverride = isHistoricalCluster(input.cluster);
  const hook = String(input.topic || "").trim() || "Black New Jersey gathering";
  const extraSearches = [
    `${hook} New Jersey real-world examples programs downtowns corridors`,
    `${hook} New Jersey thesis starting points what is already happening`,
    ...lensDiscoveryQueries(input),
  ];
  const instructions = [
    "You are an NJ-focused research brief — the Google AI Mode pass for a Black New Jersey cultural magazine.",
    "Search the OPEN web. Do not restrict yourself to a 20-site list. Focus every query on New Jersey. The desks come AFTER this brief, to dive the starting points you name.",
    sourceDoctrineForPrompt(),
    "Write the way a good AI search writes when someone asks a pattern question and says 'in NJ': a short thesis, then several real starting points a writer can steal and dive. Cranford + Transit Village + an NJ Monthly downtowns piece is the shape. Four cafe addresses is the failure.",
    "THESIS: 1–2 sentences. The NJ friction a cold reader already feels + the named thing already moving (a state program, a town that retrofitted, a rule, a disappearance). This is the editorial thesis. Put it in the thesis field.",
    "STARTING POINTS: 5–8 bullets. Each is a named thread to dive later — a program, a town, a corridor, a magazine piece, a tension, a parallel Saturday. Give enough that the operator knows WHY it matters, not just a URL label. Different threads. Not four angles on the same brewery.",
    "Land Black New Jersey in the thesis or in at least one starting point: who this is for, which Saturday still feels like the strip, who owns vs who programs. Influence may leave the state. The specimen lands back in New Jersey.",
    "PRIMARY RESEARCH LENS: honor the Analytical lens, but do not shrink the brief to clerk facts that only satisfy the lens. The lens is the door. The brief is the map.",
    "BANNED AS THE THESIS: Timeout, Yelp, TripAdvisor, Eventbrite listicles, a Brooklyn weekender calendar, invented towns, condo flyers.",
    ...(historicalOverride ? [
      "This cluster is historically anchored: a closed room or a past program is a valid starting point if a living remnant or archive still holds it.",
    ] : []),
    "If you cannot find at least 1 verifiable NJ-tied starting point, return an empty bullets array.",
    "Output strict JSON with 'thesis', 'bullets', and 'citations'. Prefix starting-point bullets 'START — '. Do not prefix the thesis field.",
  ];
  return {
    preset: "low",
    tools: [openWebSearch()],
    instructions: instructions.join(" "),
    input: buildUserPayload({ ...input, extraSearches }),
    response_format: BULLETS_RESPONSE_SCHEMA,
  };
}

export function researchOfficialRequest(input = {}) {
  const instructions = [
    "You are DESK A — the OFFICIAL RECORD desk for a Black New Jersey cultural publication.",
    sourceDoctrineForPrompt(),
    "Search ONLY the official / institutional sources available to you. Find the NAMED PROGRAM or statute that is already the mechanism — Transit Village, an ABC cap, a municipal SID, a clerk filing — not a pile of occupancy codes.",
    "Cite the desk page. Do not lead with a venue homepage or tourism listing when an official page exists.",
    "KEEP bureaucratic language. Quote the program name, the statute number, the agency, the year. Do not translate a law into a cafe. The writer will cook; you will not pre-chew.",
    "PRIMARY RESEARCH LENS: Every candidate must still pass the Analytical lens in the user payload — but a named program that explains the lens is valid even if it names no venue.",
    "BANNED: Timeout, Yelp, TripAdvisor, Eventbrite listicles, 'best of' roundups, residential real-estate listings.",
    String(input.tier || "").toUpperCase() === "FEATURE"
      ? "FEATURE: prefix each official bullet with 'DOCUMENT — '. A Feature piece without an official document is not ready to speak."
      : "Prefix official facts with 'DOCUMENT — ' when they are a statute, program, number, year, or archive holding.",
    "OUTPUT: Return 1–3 candidate bullets. Each names ONE program, statute, or filing plus the causal tail. Do not ship four permit facts. New Jersey specific. Never invent.",
    "If you cannot verify at least 1 official NJ-tied fact from official sources, return an empty bullets array.",
    "Output strict JSON with 'bullets' and 'citations'.",
  ];
  return {
    preset: "low",
    tools: [webSearchTool(OFFICIAL_SEARCH_DOMAINS)],
    instructions: instructions.join(" "),
    input: buildUserPayload(input),
    response_format: BULLETS_RESPONSE_SCHEMA,
  };
}

export function researchCulturalRequest(input = {}) {
  const historicalOverride = isHistoricalCluster(input.cluster);
  const instructions = [
    "You are DESK B — the ARGUMENT desk for a Black New Jersey cultural publication.",
    sourceDoctrineForPrompt(),
    "Write the research brief a good AI search would write — not a venue list and not four clerk facts.",
    "Search Black New Jersey press first: Echo News, Front Runner, Five Wards, Public Square, The Positive Community, West Ward Beans, NJ Urban News, Black In Jersey, Anointed, Atlantic City Focus. Then Rutgers / Montclair / Princeton pages, then Current Affairs for a pop-culture or societal MECHANISM, then leftover local press. CGE's own published guide is the house archive. Essence recaps and a Brooklyn weekender calendar still do not authorize.",
    "Cite those desk pages first. After you have the friction and the named mechanism, you MAY use open web search to find ONE real NJ specimen (Cranford's downtown retrofit, not a collage of cafe homepages).",
    "FINDING LOGIC: hunt the PATTERN the way a magazine scout would. Name the NJ friction the reader already feels. Name the program or practice already in motion. Name ONE place that already did it. Then ask the Black-NJ question that specimen opens. Prefer opinion / column / commentary over listings.",
    "Do not write about Nigerian civic climate or masculinity media criticism. Those accounts are the altitude. Find the equivalent Black-NJ argument for this specimen.",
    "PRIMARY RESEARCH LENS: Every candidate must pass the Analytical lens in the user payload.",
    "TARGET AUDIENCE: the specimen must plausibly serve the Target Audience. A downtown retrofit whose people do not overlap is a DOOR confirmation, not the argument.",
    "BANNED AS THE LENS: Timeout, Yelp, TripAdvisor, Eventbrite, NJPAC, Essence, The Root, WBGO program notes, museum wall text. They may confirm a door is open; they cannot be the cultural source.",
    "BANNED DATA — REAL ESTATE unit counts and developer flyers unless the Topic is housing policy. A Special Improvement District or Transit Village designation is a mechanism, not a condo flyer.",
    ...(String(input.tier || "").toUpperCase() === "FEATURE" ? [
      "FEATURE / CONTENT METHOD: the NEXT bullet is the join — a question NOT about the same primary entity as the Topic (who the retrofit is for, the Saturday that still feels like the strip, the parallel room). Prefix it 'NEXT — ' or 'JOIN — '.",
      "A JOIN that is another selling point of the same downtown is invalid.",
    ] : []),
    "OUTPUT: Return 3–4 bullets in this kit, each prefixed: 'FRICTION — ' (the NJ layout or pressure a cold reader already sees), 'MECHANISM — ' (the named program, statute, or practice already moving), 'SPECIMEN — ' (ONE real NJ place that already did the thing — Cranford, not five cafes), 'NEXT — ' (the question this opens for Black New Jersey). Different jobs, one story. Never invent.",
    ...(historicalOverride ? [
      "This cluster is historically anchored: the SPECIMEN may be a closed room if a living remnant or archive still holds it — do not drop history because the door is shut.",
    ] : []),
    "If you cannot find at least 1 verifiable NJ-tied argument (opinion, column, university page, named program, or independent page), return an empty bullets array.",
    "Output strict JSON with 'bullets' and 'citations'.",
  ];
  return {
    preset: "low",
    tools: [
      webSearchTool(CULTURAL_SEARCH_DOMAINS),
      { type: "web_search", user_location: { country: "US", region: "NJ" } },
    ],
    instructions: instructions.join(" "),
    input: buildUserPayload({ ...input, extraSearches: lensDiscoveryQueries(input) }),
    response_format: BULLETS_RESPONSE_SCHEMA,
  };
}

// Look-through — leftover argument pages that missed Desk B's 20-cap,
// plus halls/national magazines only when the topic would show up there.
// Overflow local press CAN authorize. Essence / NJPAC still cannot.
export function researchLookthroughRequest(input = {}) {
  const { argument, press } = apparentLookthroughDomains(input);
  const tools = [webSearchTool(argument)];
  if (press.length) tools.push(webSearchTool(press));
  const instructions = [
    "You are LOOK-THROUGH — not a third authorizing desk. Desk A holds the record. Desk B holds the argument. You open the leftover pages we already named and the halls/magazines the topic would actually appear on.",
    sourceDoctrineForPrompt(),
    "FIRST: search leftover Black-NJ press and independent pages — More Jersey, South Jersey Journal, We Are Jersey Ent, Ark Republic, Shelterforce, Trenton Journal, Jewel Justice, fayemi shakur, ENVERT, Hassan Ghanny. Those ARE argument if they already asked this question. Cite them as CULTURAL.",
    "THEN: look through halls and national magazines ONLY when they are apparent for THIS specimen — NJ Monthly, WBGO, NJPAC, Newark Museum, New Jersey Stage, Essence, The Root, The Grio, Okayplayer, Caribbean Life, Amsterdam News, NYT, WaPo. They may confirm a door, a date, or that a night existed. Prefix those confirmations 'DOOR — '. They cannot authorize the new question.",
    "Cite the leftover press before a hall recap. A brewery homepage is still last-resort address confirmation.",
    "PRIMARY RESEARCH LENS: Every candidate must pass the Analytical lens in the user payload.",
    "If you only find Essence / NJPAC / museum wall text and no leftover press, return the door facts as 'DOOR — ' or an empty bullets array. Do not dress a season brochure as the argument.",
    "OUTPUT: Return 1–3 distinct candidate bullets. Atomic facts. New Jersey specific. Never invent.",
    "Output strict JSON with 'bullets' and 'citations'.",
  ];
  return {
    preset: "low",
    tools,
    instructions: instructions.join(" "),
    input: buildUserPayload({ ...input, extraSearches: lookthroughSearchQueries(input) }),
    response_format: BULLETS_RESPONSE_SCHEMA,
  };
}

// Legacy name — the first research pass is now the NJ AI Mode scout.
export function researchHypothesisRequest(input = {}) {
  return researchAiModeRequest(input);
}

// ─── PHASE 2: DIVE THE STARTING POINTS ───────────────────────────
// The scout already wrote the brief. Desks open the threads it named.
// Thicken. Do not throw the brief away.
export function researchDiveRequest({ candidates = [], thesis = "", ...input } = {}) {
  return researchVerificationRequest({ candidates, thesis, ...input });
}

export function researchVerificationRequest({ candidates = [], thesis = "", ...input } = {}) {
  const historicalOverride = isHistoricalCluster(input.cluster);
  const instructions = [
    "You are diving an NJ research brief for a Black New Jersey cultural magazine.",
    "This is PHASE 2. Phase 1 already wrote the Google-style brief — a thesis and starting points. Your job is to OPEN those threads on the desks and THICKEN them. You are NOT starting over. You are NOT dropping the brief because a cafe homepage also exists.",
    "PROCESS: For each starting point, search official (.gov, ABC, clerk, university archive) and argument (Echo, Front Runner, Five Wards, Public Square, The Positive Community, NJ Urban News, Black In Jersey, leftover local press) and look through apparent halls (NJ Monthly, WBGO, NJPAC) when the thread would show up there. Keep the starting point if it is still true AS STATED. A hall that closed in 1992 is true as history. A statute from 1947 is true as law. Do NOT drop a fact because the door is not open today.",
    "You MAY tighten a starting point with the citation you found. You MAY add 1–3 extra bullets prefixed 'DOCUMENT — ' or 'ARGUMENT — ' when a desk page gives the operator more to dive. You may NOT replace Cranford with a brewery, or Transit Village with a tourism listing.",
    "KEEP every starting point that is still true. Better to return the whole brief plus one official page than two 'verified' venue facts.",
    "Do NOT collapse two different threads (a state program AND a town AND a magazine piece) into one venue. Those are starting points, not duplicate slides.",
    "PRIMARY LENS + AUDIENCE: honor them, but do not delete a real NJ program because it is not a venue.",
    "BANNED DATA — REAL ESTATE unit counts and developer flyers unless the Topic is housing policy. A Transit Village designation or a SID is a mechanism, not a condo flyer.",
    ...(historicalOverride ? [
      "A historical starting point may stay. Prefer also keeping one living remnant if the scout named one.",
    ] : []),
    "PREFER THE DESKS FIRST when diving. Lead citations with desk URLs. A brewery homepage may confirm an address AFTER you looked. Do not let montclairbrewery.com be the only citation if nj.gov or NJ Monthly exists.",
    "Prefer OFFICIAL and CULTURAL sources when thickening. A Timeout page may confirm a door; it cannot authorize the argument.",
    "Output strict JSON with 'thesis' (keep or tighten the scout thesis), 'bullets', and 'citations'.",
  ];
  const candidateBlock = Array.isArray(candidates) && candidates.length
    ? [
        thesis ? `SCOUT THESIS: ${String(thesis).trim().slice(0, 500)}` : "",
        "STARTING POINTS FROM THE NJ BRIEF — keep each that is still true. Thicken from the desks. Do not drop the brief.",
        ...candidates.slice(0, 8).map((c, i) => `Start ${i + 1}: ${String(c || "").trim().slice(0, 700)}`),
      ].filter(Boolean).join("\n")
    : "(no starting points supplied — return empty bullets array)";
  const lookthrough = apparentLookthroughDomains(input);
  return {
    preset: "low",
    tools: [
      webSearchTool(OFFICIAL_SEARCH_DOMAINS),
      webSearchTool(CULTURAL_SEARCH_DOMAINS),
      webSearchTool(lookthrough.all),
      { type: "web_search", user_location: { country: "US", region: "NJ" } },
    ],
    instructions: instructions.join(" "),
    input: `${buildUserPayload(input)}\n\n${candidateBlock}`,
    response_format: BULLETS_RESPONSE_SCHEMA,
  };
}

// Retained for callers still using the single-phase name. Now dispatches
// to the hypothesis-only prompt so behavior is defined for legacy callers.
export function researchRequest(input = {}) {
  return researchHypothesisRequest(input);
}

// ─── ENTITY OVERLAP DETECTOR ────────────────────────────────────
// Detects when a research payload's bullets share the same primary
// named entity (a venue, operator, or place appearing in 2+ bullets).
// The failure mode this catches: Perplexity returns 4 "distinct atomic
// facts" that are all about Village Brewing — its opening hours, its
// address, its parking, its downstairs room. Editorially those collapse
// to ONE point, and the writer routes them onto 4 slides that all say
// the same thing about the same place.
//
// Heuristic: extract 2-5-word title-case proper-noun phrases from each
// bullet, dedupe within bullet, then check for entities that appear in
// 2+ bullets. Common false positives (New Jersey, Central Jersey,
// Downtown Somerville — geographic containers that legitimately
// repeat across bullets in the same corridor) are filtered out.
//
// Returns an array of { entity, bulletIndices } — empty when there's
// no problematic overlap.
const GEOGRAPHIC_STOPWORDS = new Set([
  "new jersey", "central jersey", "north jersey", "south jersey",
  "downtown somerville", "downtown newark", "downtown asbury park",
  "asbury park", "jersey city", "atlantic city", "long branch",
  "asbury boardwalk", "the boardwalk",
]);
export function detectEntityOverlap(bullets = []) {
  if (!Array.isArray(bullets) || bullets.length < 2) return [];
  const entityToIndices = {};
  bullets.forEach((raw, i) => {
    const text = String(raw || "");
    // Match 2-5 consecutive Title-Case words (a proper noun phrase).
    // Allows an internal &, of, at, on, the (lowercased connectors).
    const matches = text.match(/\b[A-Z][a-z0-9]+(?:\s+(?:[A-Z][a-z0-9]+|of|at|on|the|and|&)){1,4}\b/g) || [];
    const inThisBullet = new Set();
    for (const m of matches) {
      const norm = m.toLowerCase().trim();
      // Skip pure geographic containers — they aren't the "entity" of a bullet.
      if (GEOGRAPHIC_STOPWORDS.has(norm)) continue;
      // Skip very short (single-word) matches after normalization.
      if (norm.split(/\s+/).length < 2) continue;
      inThisBullet.add(norm);
    }
    for (const e of inThisBullet) {
      if (!entityToIndices[e]) entityToIndices[e] = [];
      entityToIndices[e].push(i);
    }
  });
  const overlaps = [];
  for (const [entity, indices] of Object.entries(entityToIndices)) {
    if (indices.length >= 2) {
      overlaps.push({ entity, bulletIndices: indices });
    }
  }
  // Sort by severity (most-shared entity first) so the UI can lead with
  // the worst offender.
  overlaps.sort((a, b) => b.bulletIndices.length - a.bulletIndices.length);
  return overlaps;
}

// Parse a single Perplexity response into the shared bullet/citation
// shape. Used by both phases; the phase-specific min/max policy is
// enforced by the caller since it differs between phases (Phase 1
// wants 4–6; Phase 2 wants 0–5 verified).
function parsePerplexityResponse(response, { minBullets = 2, maxBullets = 8 } = {}) {
  let parsed;
  try { parsed = JSON.parse(response.output_text || ""); }
  catch { return { ok: false, code: "bad_response", message: "Perplexity returned invalid structured output. Please retry." }; }
  if (!Array.isArray(parsed?.bullets)
      || parsed.bullets.some(b => typeof b !== "string" || !b.trim() || b.length > 700)
      || parsed.bullets.length > maxBullets) {
    return { ok: false, code: "bad_response", message: "Perplexity returned an unexpected research format. Please retry." };
  }
  if (parsed.bullets.length < minBullets) {
    return { ok: false, code: "empty", message: "Not enough NJ-tied starting points found. Try a sharper New Jersey hook." };
  }
  const urls = new Set();
  const addUrl = value => {
    try {
      const url = new URL(value);
      if (["http:", "https:"].includes(url.protocol)) urls.add(url.href);
    } catch { /* Ignore non-URL source metadata. */ }
  };
  for (const item of response.output || []) {
    if (item.type === "search_results") for (const source of item.results || []) addUrl(source.url);
    for (const content of item.content || []) {
      for (const annotation of content.annotations || []) addUrl(annotation.url);
    }
  }
  if (!urls.size) return { ok: false, code: "empty", message: "Research returned no verifiable source links. Please retry before using these facts." };
  const cleanedBullets = parsed.bullets.map(b => b.trim());
  const thesis = typeof parsed.thesis === "string" ? parsed.thesis.trim().slice(0, 500) : "";
  const overlaps = detectEntityOverlap(cleanedBullets);
  return {
    ok: true,
    thesis,
    bullets: cleanedBullets,
    citations: [...urls].slice(0, 16),
    model: response.model || "preset:low",
    overlaps,
  };
}

// Retained for backward compat with any importer. Phase 1's parser.
export function parseResearchResponse(response) {
  return parsePerplexityResponse(response, { minBullets: 2, maxBullets: 8 });
}

function packThesisBullet(thesis, bullets = []) {
  const cleaned = (bullets || []).map((b) => String(b || "").trim()).filter(Boolean);
  const line = String(thesis || "").trim();
  if (!line) return cleaned.slice(0, 8);
  if (cleaned.some((b) => /^THESIS\s—/i.test(b) || b.includes(line.slice(0, 40)))) {
    return cleaned.slice(0, 8);
  }
  return [`THESIS — ${line}`, ...cleaned].slice(0, 8);
}

function decorateResearchResult(result, extraUrls = [], desks = null) {
  const urls = [...(result.citations || []), ...extraUrls];
  const sources = preferDeskSources(classifySources(urls));
  const sourceCounts = countSourceClasses(sources);
  return {
    ...result,
    thesis: result.thesis || "",
    citations: sources.map((s) => s.uri).slice(0, 16),
    sources,
    sourceCounts,
    officialEmpty: sourceCounts.OFFICIAL === 0,
    culturalEmpty: argumentDeskEmpty(sources),
    desks: desks || result.desks || null,
  };
}

function mergeDeskCandidates(officialParsed, culturalParsed, lookthroughParsed) {
  const official = officialParsed?.ok ? officialParsed.bullets.slice(0, 3) : [];
  const cultural = culturalParsed?.ok ? culturalParsed.bullets.slice(0, 3) : [];
  const lookthrough = lookthroughParsed?.ok ? lookthroughParsed.bullets.slice(0, 2) : [];
  const citations = [
    ...(officialParsed?.ok ? officialParsed.citations || [] : []),
    ...(culturalParsed?.ok ? culturalParsed.citations || [] : []),
    ...(lookthroughParsed?.ok ? lookthroughParsed.citations || [] : []),
  ];
  const desks = {
    official: { ok: !!officialParsed?.ok, count: official.length, error: officialParsed?.ok ? null : officialParsed?.message || null },
    cultural: { ok: !!culturalParsed?.ok, count: cultural.length, error: culturalParsed?.ok ? null : culturalParsed?.message || null },
    lookthrough: { ok: !!lookthroughParsed?.ok, count: lookthrough.length, error: lookthroughParsed?.ok ? null : lookthroughParsed?.message || null },
  };
  return { bullets: [...official, ...cultural, ...lookthrough], citations, desks };
}

export async function fuelResearchViaPerplexity(input = {}) {
  if (!isPerplexityConfigured()) return { ok: false, code: "not_configured", message: "Configure PERPLEXITY_API_KEY on the server to use Fuel Research." };
  if (!input.cluster?.trim()) return { ok: false, code: "no_seed", message: "Pick a Cluster before running Fuel Research — it is the primary frame for on-brand research." };
  try {
    const client = new Perplexity({ apiKey: process.env.PERPLEXITY_API_KEY, timeout: 60_000, maxRetries: 1 });

    async function runPass(buildRequest, emptyMessage, limits) {
      try {
        const response = await client.responses.create(buildRequest());
        return parsePerplexityResponse(response, limits);
      } catch (err) {
        return { ok: false, bullets: [], citations: [], thesis: "", message: err?.message || emptyMessage };
      }
    }

    const scoutParsed = await runPass(
      () => researchAiModeRequest(input),
      "NJ brief failed.",
      { minBullets: 3, maxBullets: 8 }
    );
    if (!scoutParsed.ok || !scoutParsed.bullets.length) {
      return {
        ok: false,
        code: "empty",
        message: "The NJ brief came back empty. Sharpen the hook around a New Jersey pattern — a program, a town, a corridor — not a venue address.",
      };
    }

    const scoutBullets = packThesisBullet(scoutParsed.thesis, scoutParsed.bullets);
    const scoutDesks = {
      scout: { ok: true, count: scoutBullets.length, error: null },
      official: { ok: false, count: 0, error: null },
      cultural: { ok: false, count: 0, error: null },
      lookthrough: { ok: false, count: 0, error: null },
    };

    try {
      const diveParsed = await runPass(
        () => researchDiveRequest({
          ...input,
          thesis: scoutParsed.thesis,
          candidates: scoutBullets,
        }),
        "Desk dive failed.",
        { minBullets: 3, maxBullets: 8 }
      );
      if (diveParsed.ok && diveParsed.bullets.length) {
        const dived = packThesisBullet(diveParsed.thesis || scoutParsed.thesis, diveParsed.bullets);
        return decorateResearchResult({
          ok: true,
          thesis: diveParsed.thesis || scoutParsed.thesis,
          bullets: dived,
          citations: [...(diveParsed.citations || []), ...(scoutParsed.citations || [])],
          model: diveParsed.model,
          phase: "dived",
          droppedCount: 0,
          overlaps: diveParsed.overlaps || [],
          desks: {
            ...scoutDesks,
            official: { ok: true, count: dived.filter((b) => /^DOCUMENT\s—/i.test(b)).length, error: null },
            cultural: { ok: true, count: dived.filter((b) => /^ARGUMENT\s—/i.test(b)).length, error: null },
            lookthrough: { ok: true, count: scoutDesks.lookthrough.count, error: null },
          },
        });
      }
      return decorateResearchResult({
        ok: true,
        thesis: scoutParsed.thesis,
        bullets: scoutBullets,
        citations: scoutParsed.citations,
        model: scoutParsed.model,
        phase: "scout",
        verificationError: diveParsed.message || "Desk dive did not thicken the brief.",
        overlaps: scoutParsed.overlaps || [],
        desks: scoutDesks,
      });
    } catch (diveErr) {
      return decorateResearchResult({
        ok: true,
        thesis: scoutParsed.thesis,
        bullets: scoutBullets,
        citations: scoutParsed.citations,
        model: scoutParsed.model,
        phase: "scout",
        verificationError: diveErr?.message || "Desk dive failed.",
        overlaps: scoutParsed.overlaps || [],
        desks: scoutDesks,
      });
    }
  } catch (err) {
    if ([401, 403].includes(err?.status)) return { ok: false, code: "auth", message: "Perplexity rejected the API key. Check its configuration in the API Console." };
    if (err?.status === 429) return { ok: false, code: "rate_limit", message: "Perplexity is rate-limited. Please wait before retrying.", retryAfter: err.headers?.get?.("retry-after") || "60" };
    if (err?.name === "APIConnectionTimeoutError") return { ok: false, code: "timeout", message: "Perplexity timed out. Try a narrower topic." };
    return { ok: false, code: err?.status ? "upstream" : "network", message: "Perplexity research is unavailable. Please try again later." };
  }
}
