// Compass — cluster lenses for the CGE editorial worldview.
//
// The PLATFORM THESIS (Black NJ as intersection; events as the door;
// 15/85 curator/observation; archive closer) lives in cgeThesis.js and
// sits ABOVE these clusters. A cluster is the analytical door (nightlife
// math, liquor cap, diaspora halls). The thesis is what the piece is
// actually about. Writers, spines, and the POV synthesizer all inherit it
// when the record is Feature / Content.
//
// This module supersedes the flat CLUSTERS array in matrixEnums.js: every
// cluster now carries a `directive` — a specific analytical lens the AI
// (Perplexity for research, Gemini for carousel copy) is FORCED to adopt
// when that cluster is picked. The directive is the whole point: without
// it, "Nightlife Dilemma" is just a label; with it, Sonar knows to look
// for mega-club closures, bottle-service fatigue, and hi-fi listening
// rooms rather than generic "party" facts.
//
// Compass also ships a curated `COMPASS_TOPICS` list — pre-shaped
// editorial angles the operator can one-tap to auto-fill the matrix
// (cluster + corridor + hook + emotion + demographic in one click). Think
// of it as the operator's own "assigned beats" board.
//
// Storage model: matrix.cluster now stores the KEY (uppercase snake,
// e.g. "NIGHTLIFE_DILEMMA") going forward. Legacy records saved the
// human-readable label from the old CLUSTERS array; `resolveClusterKey`
// handles both shapes transparently, so nothing on disk breaks.

import { CGE_SUBJECT, CGE_THESIS_SHORT, CGE_VOICE_RATIO } from "./cgeThesis.js";

export const CONTENT_CLUSTERS = {
  SUBURBAN_THIRD_PLACE: {
    key: "SUBURBAN_THIRD_PLACE",
    label: "Suburban Third-Place Crisis",
    directive: "Focus on the deficit of walkable social infrastructure, car-dependent commercial strips, strip mall speakeasies, and how suburban spots accidentally become gathering hubs.",
    defaultPOV: "Suburban New Jersey outsourced gathering to commercial strips and the commute killed spontaneous hangs — what survives is the parking-lot brewery, the strip-mall speakeasy, and the accidental cafe takeover.",
  },
  DIASPORA_INFRASTRUCTURE: {
    key: "DIASPORA_INFRASTRUCTURE",
    label: "Diaspora Infrastructure & Cultural Epicenters",
    directive: "Highlight second-gen identity spaces, immigrant business ecosystems, civic halls, and authentic cultural spaces (Afrobeats, Caribbean, Latin house) outside mainstream commercial circuits.",
    defaultPOV: "The scenes that carry culture forward in New Jersey were built outside the mainstream circuit — second-gen halls, immigrant business ecosystems, and diaspora residencies that operate on referral rather than press.",
  },
  NIGHTLIFE_DILEMMA: {
    key: "NIGHTLIFE_DILEMMA",
    label: "Nightlife Dilemma & Sound Curation",
    directive: "Dissect the collapse of commercial mega-clubs, bottle service fatigue, early curfews, acoustic audits, and the rise of intimate hi-fi or vinyl listening rooms.",
    defaultPOV: "The mega-club era is over — what's winning are 150-capacity rooms with real sound systems, hi-fi listening bars, and residencies that treat the crowd as a scene, not a checkout line.",
  },
  DAYTIME_PLAY: {
    key: "DAYTIME_PLAY",
    label: "Daytime Play & Kinetic Wellness",
    directive: "Explore adult recess, field days, run clubs as social hubs, roller rinks, sober socializing, and non-alcohol-centric kinetic community gatherings.",
    defaultPOV: "Adult recess isn't a joke anymore — run clubs replaced Hinge, roller rinks replaced happy hours, and field days moved the social calendar out of the bar and onto the grass.",
  },
  GATHERING_LOGISTICS: {
    key: "GATHERING_LOGISTICS",
    label: "Economics & Logistics of Gathering",
    directive: "Examine the raw operational math: venue rental splits, food truck coordination, rain contingencies, permit red tape, check-in bottlenecks, and door economics.",
    defaultPOV: "Every gathering runs on math the audience never sees — venue splits, food-truck routing, weather contingencies, permit red tape, check-in bottlenecks — and the operators who make it look easy are running spreadsheets no one sees.",
  },
  REGIONAL_DEMOGRAPHICS: {
    key: "REGIONAL_DEMOGRAPHICS",
    label: "Regional Demographics & Transit Shifts",
    directive: "Analyze commuter rail habits, reverse-commute patterns, transit village gentrification, suburban brain drain, and geographic identity across NJ corridors.",
    defaultPOV: "New Jersey's commuter corridors sort culture by transit access — the reverse-commute pattern reshuffles who shows up where, and the identity of a town is now a function of its train stop.",
  },
  STATE_SONIC_HISTORY: {
    key: "STATE_SONIC_HISTORY",
    label: "State & Sonic History",
    directive: "Anchor the narrative in regional musical legacy, historic ballroom culture, early house movements (e.g., Club Zanzibar), and coastal resort boom history.",
    defaultPOV: "Sonic history in New Jersey was authored by the venues that never made the tourism map — the motel ballrooms, waterfront rooms, and unmarked warehouses that lived and died in the margins — and the codes those margins wrote still shape every room built since.",
  },
  POLICY_MECHANICS: {
    key: "POLICY_MECHANICS",
    label: "Policy Mechanics & Municipal Architecture",
    directive: "Break down statutory quotas (like the 1947 1:3,000 NJ liquor license cap), 'home rule' fragmentation across 564 towns, zoning restrictions, and public park permitting.",
    defaultPOV: "The 1:3,000 liquor cap, home rule fragmentation across 564 municipalities, and layered curfew ordinances are the actual authors of how New Jersey nightlife looks — policy is architecture.",
  },
  DIGITAL_NETWORKS: {
    key: "DIGITAL_NETWORKS",
    label: "Digital Networks & Civic Tech",
    directive: "Explore algorithmic ticketing queues, the death of street flyering, private WhatsApp/Telegram community networks, and automation for independent operators.",
    defaultPOV: "The street flyer is dead — the private WhatsApp group and the algorithmic ticketing queue replaced it, and independent operators live or die by how well they run those channels.",
  },
  PHILOSOPHY_OF_GATHERING: {
    key: "PHILOSOPHY_OF_GATHERING",
    label: "Philosophy & Behavioral Psychology of Gathering",
    directive: "Ground in sociology: Ray Oldenburg third-place theory, the propinquity effect, collective effervescence, social friction, and the psychological cost of being outside.",
    defaultPOV: "Ray Oldenburg's third-place theory maps directly onto New Jersey's crisis — home and work are covered; the third place is where identity gets negotiated, and its absence is why so many suburban weekends feel hollow.",
  },
};

// Display order — matches the operator's mental model of the beat map.
// The dropdown iterates in this order; do NOT rely on Object.values()
// iteration order for UI (works today but non-portable across runtimes
// with older Map/Object semantics).
export const CONTENT_CLUSTER_ORDER = [
  "SUBURBAN_THIRD_PLACE",
  "DIASPORA_INFRASTRUCTURE",
  "NIGHTLIFE_DILEMMA",
  "DAYTIME_PLAY",
  "GATHERING_LOGISTICS",
  "REGIONAL_DEMOGRAPHICS",
  "STATE_SONIC_HISTORY",
  "POLICY_MECHANICS",
  "DIGITAL_NETWORKS",
  "PHILOSOPHY_OF_GATHERING",
];

// Array form for `map`-heavy UI (dropdowns, chip rows). Ordered per
// CONTENT_CLUSTER_ORDER so consumers can just iterate.
export const CONTENT_CLUSTER_LIST = CONTENT_CLUSTER_ORDER.map((k) => CONTENT_CLUSTERS[k]);

// Legacy label → key map. Records saved before the compass switch stored
// the label string on matrix.cluster (e.g. "Nightlife Dilemma"). We map
// each legacy label to its new canonical key so old data keeps working.
// Includes both the OLD short labels (from matrixEnums.CLUSTERS) and the
// NEW full labels so a mixed-vintage database heals in one place.
const LEGACY_LABEL_TO_KEY = {
  // Old short labels from the pre-compass CLUSTERS array
  "Suburban Third-Place Crisis": "SUBURBAN_THIRD_PLACE",
  "Diaspora Infrastructure": "DIASPORA_INFRASTRUCTURE",
  "Nightlife Dilemma": "NIGHTLIFE_DILEMMA",
  "Daytime Play": "DAYTIME_PLAY",
  "Gathering Logistics": "GATHERING_LOGISTICS",
  "Regional Demographics": "REGIONAL_DEMOGRAPHICS",
  "State & Sonic History": "STATE_SONIC_HISTORY",
  "Policy Mechanics": "POLICY_MECHANICS",
  "Civic Tech": "DIGITAL_NETWORKS",
  "Philosophy of Gathering": "PHILOSOPHY_OF_GATHERING",
  // New full labels (defensive — should already resolve via CONTENT_CLUSTERS)
  "Diaspora Infrastructure & Cultural Epicenters": "DIASPORA_INFRASTRUCTURE",
  "Nightlife Dilemma & Sound Curation": "NIGHTLIFE_DILEMMA",
  "Daytime Play & Kinetic Wellness": "DAYTIME_PLAY",
  "Economics & Logistics of Gathering": "GATHERING_LOGISTICS",
  "Regional Demographics & Transit Shifts": "REGIONAL_DEMOGRAPHICS",
  "Policy Mechanics & Municipal Architecture": "POLICY_MECHANICS",
  "Digital Networks & Civic Tech": "DIGITAL_NETWORKS",
  "Philosophy & Behavioral Psychology of Gathering": "PHILOSOPHY_OF_GATHERING",
};

// Resolve any stored `matrix.cluster` value — key, current label, or
// legacy label — to a canonical CONTENT_CLUSTERS key, or null if we
// can't map it. Callers use this before looking up label/directive.
export function resolveClusterKey(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (CONTENT_CLUSTERS[trimmed]) return trimmed;
  if (LEGACY_LABEL_TO_KEY[trimmed]) return LEGACY_LABEL_TO_KEY[trimmed];
  // Last-resort loose match — some legacy records may have accumulated
  // whitespace or case drift. Compare against every known label ci.
  const lower = trimmed.toLowerCase();
  for (const entry of CONTENT_CLUSTER_LIST) {
    if (entry.label.toLowerCase() === lower) return entry.key;
  }
  for (const [label, key] of Object.entries(LEGACY_LABEL_TO_KEY)) {
    if (label.toLowerCase() === lower) return key;
  }
  return null;
}

// Return the directive for whatever the operator picked. Empty string on
// miss so prompt builders can concat unconditionally without null checks.
export function getClusterDirective(value) {
  const key = resolveClusterKey(value);
  if (!key) return "";
  return CONTENT_CLUSTERS[key].directive || "";
}

// Return the display label for whatever the operator picked. Falls back
// to the raw stored value on miss so the UI never shows an empty cell
// while a legacy record with an unknown cluster is loaded.
export function getClusterLabel(value) {
  const key = resolveClusterKey(value);
  if (key) return CONTENT_CLUSTERS[key].label;
  return String(value || "");
}

// Clusters whose analytical lens is predominantly historical or
// policy-anchored — the research for these tends to drift into
// museum-copy / dry-history register unless Sonar is forced to
// anchor at least one bullet in a currently-operating venue or
// operator. Perplexity's system prompt reads this set to decide
// whether to append the TEMPORAL BALANCE mandate.
export const HISTORICAL_CLUSTERS = new Set([
  "STATE_SONIC_HISTORY",
  "POLICY_MECHANICS",
]);
export function isHistoricalCluster(value) {
  const key = resolveClusterKey(value);
  return key ? HISTORICAL_CLUSTERS.has(key) : false;
}

// Return the cluster's brand-voice default POV — used by
// eventMatrixToFillSeed as a fallback when the operator leaves the
// Editorial POV field blank. Gives the Editor pass at least a brand
// thesis to work from so a matrix without a typed POV doesn't collapse
// to "no POV, no arc." Empty string when the value doesn't resolve.
export function getClusterDefaultPOV(value) {
  const key = resolveClusterKey(value);
  if (!key) return "";
  return CONTENT_CLUSTERS[key].defaultPOV || "";
}

// ─── VOICE PREVIEW SUBJECTS (per cluster) ────────────────────────
// Voice preview writes ONE sample paragraph so the operator can hear
// a Distance × Cadence × Stance combo before generating a real
// carousel. The previous implementation used a single fixed subject
// ("Friday night at a 150-cap music room") for every preview, which
// isolated the voice from topic — good for a like-for-like compare,
// but bad for telling the operator "here's how your voice will sound
// on THIS piece."
//
// Each entry is a short, generic-but-shaped subject that lives in
// the cluster's own terrain. No proper nouns, no real venues —
// still anonymous enough that the voice, not the reporting, is what
// the operator hears — but the shape (a run club, a home-rule
// council chamber, a hi-fi listening room) grips on the cluster's
// actual material.
//
// Falls back to the generic music-room subject when no cluster is
// picked, so the preview still works from the standalone Voice
// Params panel with nothing else set.
export const VOICE_PREVIEW_SUBJECTS = {
  SUBURBAN_THIRD_PLACE:
    "a Saturday afternoon at a strip-mall coffee shop that's become the accidental gathering hub of its ZIP code — the parking lot, the door count, one thing the room does that no one planned",
  DIASPORA_INFRASTRUCTURE:
    "a Sunday evening at a second-gen cultural hall on a corridor no press outlet covers — the referral chain that filled the room, the sound system's job, one detail that marks this scene as its own",
  NIGHTLIFE_DILEMMA:
    "a Friday night at a 150-capacity hi-fi listening room somewhere in New Jersey — the sound system, the door policy, one thing the room does differently than the mega-club it replaced",
  DAYTIME_PLAY:
    "a Saturday morning run club that turned into the town's new social hub — the pace, the after-run coffee, the one social pattern that formed around it",
  GATHERING_LOGISTICS:
    "the two hours before a 300-person outdoor gathering opens — the venue split, the food-truck routing call, the weather contingency, one operator detail the crowd will never see",
  REGIONAL_DEMOGRAPHICS:
    "the last inbound train of the night at a transit-village stop — the reverse-commute crowd that got off, the local crowd that's already there, one thing the platform tells you about the town's identity",
  STATE_SONIC_HISTORY:
    "an unmarked ballroom that shaped the state's sonic history and closed decades ago — what the room did that the mainstream circuit never absorbed, and one code the margins wrote that every current room still runs on",
  POLICY_MECHANICS:
    "a municipal council chamber the night a liquor-cap variance is debated — the room, the two positions in tension, and one specific piece of statutory architecture doing the shaping",
  DIGITAL_NETWORKS:
    "the private WhatsApp group that replaced the street flyer for a scene's ticketing — the queue mechanics, the algorithmic gate, one thing the channel does that a flyer never could",
  PHILOSOPHY_OF_GATHERING:
    "a suburban weekend that feels hollow — a third-place theorist would name what's missing; write the moment through that lens, naming the absence without pontificating",
};

// Return the cluster's preview subject, or the generic fallback when
// no cluster resolves. previewVoice reads this to pick the SUBJECT
// line at prompt-build time.
export function getVoicePreviewSubject(value) {
  const key = resolveClusterKey(value);
  if (!key) return "";
  return VOICE_PREVIEW_SUBJECTS[key] || "";
}

// ─── Compositional POV fragments ─────────────────────────────────────
// Each dimension (cluster, corridor, emotion, demographic) contributes
// a phrase; composePOV stitches them into a two-sentence editorial
// thesis. This is what makes the POV textarea move when the operator
// changes Corridor / Emotion / Demographic — not just Cluster.
//
// Authoring rule: each fragment reads as CULTURAL DISPATCH, never
// grant-application or municipal-report register. The whole point is
// that the composed POV sounds like an editorial writer's opening
// paragraph, not a form auto-filled from dropdowns.

// Corridor → the geographic anchor phrase for sentence 2. Written so
// it fits naturally at sentence start: "Along the Shore's Southern
// Arteries, ..."
const CORRIDOR_ANCHORS = {
  "Urban / Commuter Core": "In the Essex / Hudson / Union urban core",
  "Route 1 Central Crossroads": "Along the Route 1 commuter belt through Middlesex + Somerset",
  "Transit Village Suburbs": "In the transit-village suburbs whose identity now rides on their train stop",
  "Shore / Southern Arteries": "Down the Shore's Southern Arteries",
  "Decentralized Borderlands": "Out in the decentralized borderlands where town lines blur",
};

// Emotion → the reader-stance modifier that closes the POV. Sets the
// piece's angle: is this validating what the reader already feels, or
// naming a pattern they hadn't seen?
const EMOTION_STANCES = {
  "Curiosity/Epiphany": "This piece names the pattern the audience has felt but never had a word for.",
  "Validation/Relatability": "If the reader's own weekends feel like this, they're not imagining it — the shape of it is real.",
  "Skepticism/Irreverence": "The polished version is a lie; the piece surfaces what actually holds the scene together.",
  "Nostalgia/Yearning": "The rooms lost weren't accidents, and the rooms replacing them owe those originals everything.",
  "Urgency/Insider Access": "This is what the operators already know that the audience doesn't — and the window on acting on it is not open forever.",
  "Ambition/Sovereignty": "For anyone building the next room, this is the operating system.",
};

// Demographic → short noun phrase that names who the piece is speaking
// TO. Used to compose the "For X, this hits particular" clause. Keep
// each entry LOWERCASE and grammatically ready to slot after "for".
const DEMOGRAPHIC_PHRASES = {
  "Young Working Professionals": "young working professionals still learning where their weekends actually live",
  "Diaspora Networks": "diaspora networks operating on referral rather than press",
  "Corporate-to-Creative Hybrids": "the corporate-to-creative hybrids trying to stitch a second identity outside the office",
  "Low-Decibel / Alcohol-Conscious": "the low-decibel, alcohol-conscious crowd building the parallel nightlife",
  "Sonic Purists": "sonic purists who chase rooms with real sound systems",
  "Kinetic / Adult Play": "the adult-recess crowd putting run clubs and roller rinks back on the social calendar",
  "Creatives & DJs": "the creatives and DJs authoring the rooms nobody else has built yet",
};

// Compose a two-sentence editorial POV from the operator's dimension
// picks. Sentence 1: cluster's defaultPOV (the thesis skeleton).
// Sentence 2: corridor anchor + demographic wedge + emotion stance.
// Any missing dimension is elided gracefully — the composed POV still
// reads if only cluster is set. Returns "" if there's not even a
// cluster to build on.
export function composePOV({ cluster, corridor, emotion, demographics, lockSentence = "", thesisOverride = "" } = {}) {
  const clusterKey = resolveClusterKey(cluster);
  if (!clusterKey) return "";
  const thesis = String(thesisOverride || "").trim() || CONTENT_CLUSTERS[clusterKey].defaultPOV || "";
  if (!thesis) return "";

  const anchor = corridor ? CORRIDOR_ANCHORS[corridor] : "";
  const stance = emotion ? EMOTION_STANCES[emotion] : "";
  const demoList = Array.isArray(demographics) ? demographics.filter(Boolean) : [];
  const demoPhrases = demoList
    .map((d) => DEMOGRAPHIC_PHRASES[d] || String(d || "").toLowerCase().trim())
    .filter(Boolean);

  // Compose sentence 2 from whichever pieces are present. Grammar has
  // to hold up even when one or two dimensions are missing.
  const s2Parts = [];
  if (anchor && demoPhrases.length) {
    s2Parts.push(`${anchor}, that reckoning lands on ${joinDemographics(demoPhrases)}.`);
  } else if (anchor) {
    s2Parts.push(`${anchor}, this argument plays out on the ground.`);
  } else if (demoPhrases.length) {
    s2Parts.push(`It lands hardest on ${joinDemographics(demoPhrases)}.`);
  }
  if (stance) s2Parts.push(stance);

  const s2 = s2Parts.join(" ").trim();
  const body = s2 ? `${thesis} ${s2}` : thesis;
  const lock = String(lockSentence || "").trim();
  return lock ? `${body} ${lock}` : body;
}

// English list join for the demographic phrases in sentence 2.
// One item → as is. Two → "A and B". Three+ → "A, B, and C".
function joinDemographics(list) {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
}

// ─── DYNAMIC POV SYNTHESIZER ──────────────────────────────────────
// The deterministic composePOV works but it's structurally the same
// sentence every time — 10 clusters × 5 corridors etc. is still
// paste-together text, not writerly synthesis. synthesizeThesis fires
// a small Gemini Flash call to find the underlying cultural tension
// between the four picks and return a 1–2 sentence editorial thesis
// that reads like an executive-editor draft, not a template fill.
//
// Client-side: uses the operator's own Gemini key (same one used for
// the carousel writer), matching the existing app architecture.
// Structured JSON output enforces the length + shape contract.

// Import inside the function so this file stays free of a hard
// dependency on the Gemini helper when consumers only need the
// static clusters + composePOV. Callers pass an apiKey; empty
// apiKey → throw so the caller can surface a clear error UI.
export async function synthesizeThesis({ apiKey, cluster, corridor, emotion, demographics = [], editorialLens = "", subjectLock = null, lensBase = "" } = {}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("Missing Gemini API key");
  }
  const clusterKey = resolveClusterKey(cluster);
  if (!clusterKey) {
    throw new Error("Pick a Content Cluster first — it anchors the LENS the synthesizer works through.");
  }
  const clusterLabel = CONTENT_CLUSTERS[clusterKey].label;
  const clusterDirective = String(lensBase || "").trim() || CONTENT_CLUSTERS[clusterKey].directive;
  const cleanLens = String(editorialLens || "").trim();
  const demoList = Array.isArray(demographics)
    ? demographics.filter((d) => typeof d === "string" && d.trim()).map((d) => d.trim())
    : [];

  const prompt = [
    "ROLE: You are an executive editor at a cultural infrastructure platform for Black New Jersey. Events are the door, not the product.",
    "TASK: The operator has picked four combinatorial variables. Synthesize them into a single, cohesive 1–2 sentence Editorial POV.",
    "",
    "CGE PLATFORM THESIS (always in force, ABOVE the cluster):",
    `  Subject: ${CGE_SUBJECT}`,
    `  Thesis: ${CGE_THESIS_SHORT}`,
    `  Voice: ${CGE_VOICE_RATIO}`,
    "  The cluster is the analytical door into that thesis. Do not collapse the POV into generic gathering-magazine copy (third places, liquor caps, 150-cap rooms) unless the cluster + bullets actually are that story.",
    "",
    "THE VARIABLES:",
    `- Content Cluster: ${clusterLabel}`,
    `- Cluster Analytical Lens (this piece — a facet lock replaces the cluster syllabus): ${clusterDirective}`,
    ...(cleanLens ? [`- LENS Narrowing (operator's per-piece override — LAYERS UNDER the base; the thesis MUST honor BOTH the base lens AND this narrowing): ${cleanLens}`] : []),
    `- Corridor (geography): ${corridor || "(not set — write for the whole state)"}`,
    `- Target Emotion (reader stance): ${emotion || "(not set — default to Curiosity/Epiphany)"}`,
    `- Target Demographic (audience): ${demoList.length ? demoList.join(", ") : "(not set — write broadly)"}`,
    ...(Array.isArray(subjectLock?.promptLines) && subjectLock.promptLines.length ? ["", ...subjectLock.promptLines] : []),
    "",
    "CONSTRAINTS:",
    "1. Do NOT just list the variables. Find the underlying cultural TENSION that connects the specific geography to the specific sociological topic. If no natural tension exists between the picks, name what would have to be true for one to matter, then write from that.",
    "2. No Proper Nouns: do NOT invent specific venue names, town names, ordinance names, statute years, or era labels the operator did not supply. Keep the thesis structural and geographically agnostic so it applies to the entire named Corridor, not one town within it. If you name a specific NJ policy, it must be one that necessarily applies to the whole Corridor.",
    "3. No filler, no introductory remarks, no 'this piece argues that…' scaffolding, no grantwriter register.",
    "4. The demographic is the AUDIENCE — write the thesis so it lands with THEM. It's not the subject of the piece, it's who's reading it.",
    "5. Length: EXACTLY 1–2 sentences of punchy, opinionated thesis text. Second sentence, when present, extends the tension into a payoff or a wager; it never restates sentence 1.",
    // ANTI-META-WRITING — the synthesizer was leaking its own task
    // description into the output ("This piece validates…", "This
    // post explores…"). The POV is a THESIS ABOUT THE WORLD, not
    // metadata about the article that quotes it. Ban all self-
    // reference outright.
    "6. NO META-WRITING: You are strictly banned from referring to the content, the carousel, the piece, the post, the article, or the reader. Never use phrases like 'This piece explores', 'This post shows', 'This validates', 'The reader learns', or any variant. State the cultural thesis as an objective, standalone fact — as if you were writing the pull-quote a magazine sets in 48pt, not the editor's memo that explains it.",
    "7. SUBJECT LOCK: If SUBJECT LOCK lines appear above, write ONLY about those sub-versions and locales. Adjacent cluster topics are out of bounds unless JOIN names them. Do not mash a brewery piece into liquor-cap math or Afrobeats residencies because they share a ZIP.",
    "",
    'Return ONLY JSON in this exact shape: {"thesis": "..."}',
  ].join("\n");

  // Hit the Gemini endpoint directly rather than importing from
  // gemini.js — that helper's geminiGenerate isn't exported, and
  // keeping the fetch inline means matrixCompass stays a leaf module
  // (no cross-file dependency for what is essentially one API call).
  const MODEL = "gemini-2.5-flash-lite";
  const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.75,
      maxOutputTokens: 512,
      responseSchema: {
        type: "object",
        properties: { thesis: { type: "string", maxLength: 500 } },
        required: ["thesis"],
      },
    },
  };

  let res;
  try {
    res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error(`Network error contacting Gemini: ${err?.message || err}`);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((p) => p && !p.thought && typeof p.text === "string") || parts[0];
  const raw = textPart?.text || "";
  if (!raw) throw new Error("Gemini returned an empty response.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fallback: some responses come back with stray whitespace or a
    // JSON blob wrapped in code fences despite the schema.
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(trimmed);
  }
  const thesis = String(parsed?.thesis || "").trim();
  if (!thesis) throw new Error("Gemini returned no thesis text — retry.");
  // Hard length cap regardless of what the model returned. 500 chars
  // matches LIMITS.POV_MAX — keeps the field the operator sees fillable
  // and the downstream editor pass grounded.
  return thesis.slice(0, 500);
}

// ─── REFRAME LENS SYNTHESIZER ────────────────────────────────────
// The cluster's base directive is hardcoded (an anchor per cluster).
// This synthesizer produces a NARROWING lens — a per-matrix angle
// grounded in the operator's current Corridor × Emotion × Demographic
// picks — that layers ON TOP of the base directive, not replacing it.
// Downstream prompts inject both: base for cluster identity, narrowing
// for this-piece specificity.
//
// Same client-side Gemini Flash-Lite architecture as synthesizeThesis
// and synthesizeHook. Explicit button click only.
export async function synthesizeLensReframe({ apiKey, cluster, corridor, emotion, demographics = [], subjectLock = null, lensBase = "" } = {}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("Missing Gemini API key");
  }
  const clusterKey = resolveClusterKey(cluster);
  if (!clusterKey) {
    throw new Error("Pick a Content Cluster first — the base LENS is what the reframe narrows.");
  }
  const clusterLabel = CONTENT_CLUSTERS[clusterKey].label;
  const baseDirective = String(lensBase || "").trim() || CONTENT_CLUSTERS[clusterKey].directive;
  const demoList = Array.isArray(demographics)
    ? demographics.filter((d) => typeof d === "string" && d.trim()).map((d) => d.trim())
    : [];

  const prompt = [
    "ROLE: You are a senior editor at a regional culture magazine covering New Jersey. Your job is NOT to replace the cluster's editorial identity — that's the base directive below. Your job is to NARROW the base directive through the operator's current picks so this specific piece has a specific angle within the cluster.",
    "TASK: Write a 1-3 sentence reframed LENS that reads as a specific angle inside the base cluster directive, calibrated to the Corridor + Emotion + Demographic below. Do NOT rewrite the cluster's identity; do NOT drift into a different cluster's territory. Narrow, don't replace.",
    "",
    "BASE DIRECTIVE (this stays the anchor — don't contradict it):",
    `  Cluster: ${clusterLabel}`,
    `  Directive: ${baseDirective}`,
    "",
    "OPERATOR'S CURRENT PICKS (what to narrow through):",
    `  Corridor: ${corridor || "(not set — write for the whole state)"}`,
    `  Target Emotion: ${emotion || "(not set — default to Curiosity/Epiphany)"}`,
    `  Target Demographic: ${demoList.length ? demoList.join(", ") : "(not set — write broadly)"}`,
    ...(Array.isArray(subjectLock?.promptLines) && subjectLock.promptLines.length ? ["", ...subjectLock.promptLines] : []),
    "",
    "CONSTRAINTS:",
    "1. NARROW, DO NOT REPLACE. The base directive is what THIS piece sees. If it is a facet lock, do not widen back to sibling facets or the cluster syllabus. If it is the whole-cluster directive, stay inside that cluster — do not drift into a different cluster's territory.",
    "2. GROUND IN THE CORRIDOR + AUDIENCE. The reframe should name what SPECIFICALLY matters about this cluster for this corridor's readers of this demographic. Example: Policy Mechanics through Urban / Commuter Core + Young Working Professionals + Ambition might narrow the base directive from liquor licenses toward rent-cap ordinances, transit-funding formulas, and workforce-housing policy — still Policy Mechanics, but the SPECIFIC policies these readers actually care about.",
    "3. NO META-WRITING. Do not refer to the piece, the carousel, or the reader. State the narrowing as an editorial angle, not as memo scaffolding.",
    "4. NO INVENTED SPECIFICS. Do not name specific ordinances, statutes, venues, or towns the base directive didn't already mention. Stay at the level of CATEGORIES (rent ordinances, transit formulas, permit thresholds) — the writer will source the specifics.",
    "5. LENGTH: 1 to 3 sentences. Reads as an angle, not a paragraph.",
    "6. SUBJECT LOCK: If SUBJECT LOCK lines appear above, the reframe must name those sub-versions. Do not widen back to the whole cluster, and do not import a different cluster's territory unless JOIN names it.",
    "",
    'Return ONLY JSON in this exact shape: {"reframe": "..."}',
  ].join("\n");

  const MODEL = "gemini-2.5-flash-lite";
  const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
      maxOutputTokens: 512,
      responseSchema: {
        type: "object",
        properties: { reframe: { type: "string", maxLength: 800 } },
        required: ["reframe"],
      },
    },
  };

  let res;
  try {
    res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error(`Network error contacting Gemini: ${err?.message || err}`);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((p) => p && !p.thought && typeof p.text === "string") || parts[0];
  const raw = textPart?.text || "";
  if (!raw) throw new Error("Gemini returned an empty response.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(trimmed);
  }
  const reframe = String(parsed?.reframe || "").trim();
  if (!reframe) throw new Error("Gemini returned no reframe text — retry.");
  return reframe.slice(0, 800);
}

// Compose the resolved LENS block for downstream prompts. When the
// operator has typed or generated an editorial_lens override, layer
// it as narrowing under the base directive (both remain visible).
// When empty, return just the base. Callers use this instead of
// getClusterDirective when they need the full resolved LENS.
export function resolveEditorialLens({ cluster, override, base } = {}) {
  const baseDirective = String(base || "").trim() || getClusterDirective(cluster);
  const clean = String(override || "").trim();
  if (!baseDirective) return { base: "", override: "", combined: clean };
  if (!clean) return { base: baseDirective, override: "", combined: baseDirective };
  return {
    base: baseDirective,
    override: clean,
    combined: `${baseDirective}\n\nOPERATOR NARROWING — this piece narrows the LENS this piece already sees (a facet lock replaces the cluster syllabus): ${clean}`,
  };
}

// ─── DRAFT HOOK SYNTHESIZER ─────────────────────────────────────────
// Cover line for a magazine brief — not an Instagram listicle.
// Emotion still sets tone; Fuel START / THESIS lines authorize the
// named NJ geography Google already found. Without those names the
// model writes "discover surprising gathering spots."
const FUEL_LINE = /^(?:[-•*]\s+)?(?:THESIS|START|GAP|FRICTION|MECHANISM|SPECIMEN|NEXT|DOCUMENT|ARGUMENT|JOIN)\s*—/i;

const LISTICLE_HOOK_TROPES = [
  /\bdiscover\s+(surprising|new|hidden)\b/i,
  /\bsurprising\s+(new\s+)?gathering\s+spots?\b/i,
  /\bnew\s+gathering\s+spots?\b/i,
  /\bdid\s+you(?:r)?\s+(?:know|commuter|community)\b/i,
  /\bhere'?s\s+why\b/i,
  /\bthe\s+real\s+reason\b/i,
  /\beverything\s+you\s+know\s+is\s+wrong\b/i,
  /\byou\s+won'?t\s+believe\b/i,
  /\blet'?s\s+talk\s+about\b/i,
  /\bhidden\s+gems?\b/i,
  /\bmust-?visit\b/i,
  /\bspots?\s+you\s+(?:need|have)\s+to\s+(?:see|know|try)\b/i,
  /\bthe\s+truth\s+is\b/i,
];

export function isListicleHook(text) {
  const s = String(text || "").trim();
  if (!s) return false;
  return LISTICLE_HOOK_TROPES.some((re) => re.test(s));
}

export function hookEvidenceLines(anchors = []) {
  const clean = (Array.isArray(anchors) ? anchors : [])
    .map((a) => String(a || "").trim())
    .filter(Boolean);
  const fuel = clean.filter((a) => FUEL_LINE.test(a));
  return (fuel.length ? fuel : clean).slice(0, 12);
}

export function buildHookPrompt({
  pov,
  emotion,
  demographics = [],
  editorialLens = "",
  anchors = [],
  subjectLock = null,
  lensBase = "",
} = {}) {
  const cleanPOV = String(pov || "").trim();
  const cleanEmotion = String(emotion || "").trim();
  const cleanLens = String(editorialLens || "").trim();
  const cleanBase = String(lensBase || "").trim();
  const demoList = Array.isArray(demographics)
    ? demographics.filter((d) => typeof d === "string" && d.trim()).map((d) => d.trim())
    : [];
  const evidence = hookEvidenceLines(anchors);
  return [
    "ROLE: You write magazine cover lines for a Black New Jersey cultural publication. You are not an Instagram listicle copywriter.",
    "TASK: Write one 10-to-18 word cover line that NAMES THE CONTRAST the brief already proved.",
    "",
    "THE INPUTS:",
    `- The Core Argument: ${cleanPOV}`,
    ...(cleanBase ? [`- Analytical lens (this piece — a facet lock replaces the cluster syllabus): ${cleanBase}`] : []),
    ...(cleanLens ? [`- LENS Narrowing: ${cleanLens}`] : []),
    ...(evidence.length
      ? [
        "- Fuel starting points (authorized proper nouns — use at least one named road, town, retrofit, or geography from these lines):",
        ...evidence.map((line) => `  • ${line}`),
      ]
      : ["- Fuel starting points: (none — stay inside the POV; do not invent a town or road.)"]),
    `- The Voice/Emotion: ${cleanEmotion || "(not set — use a neutral curious register)"}`,
    `- The Audience: ${demoList.length ? demoList.join(", ") : "(not set — write for the general reader)"}`,
    ...(Array.isArray(subjectLock?.promptLines) && subjectLock.promptLines.length ? ["", ...subjectLock.promptLines] : []),
    "",
    "QUALITY BAR — Google AI Mode, not a listing:",
    "  GOOD: \"Walker's Paradise vs the strip-mall geography Route 22 actually built.\"",
    "  GOOD: \"Cranford retrofitted the downtown. Route 22 still gathers in a parking lot.\"",
    "  FAILED: \"Did your commuter community? Discover surprising new gathering spots.\"",
    "",
    "STRICT CONSTRAINTS:",
    '1. Emotion sets TONE only. Curiosity/Epiphany means name the contrast the brief proved — Walkable vs strip, Route 22 vs a Cranford retrofit, parking-lot hub vs downtown. Do NOT pose a vague "did you know" or "discover surprising spots" observation.',
    "2. Audience sets vocabulary. Speak to them. Do not sound like a marketer.",
    '3. No listicle tropes: NEVER "Discover surprising", "new gathering spots", "Did your community", "Did you know", "Here\'s why", "The real reason", "hidden gems", "spots you need to know", "Let\'s talk about", "You won\'t believe", "The truth is", "Everything you know is wrong".',
    "4. Proper nouns: you MAY and SHOULD name towns, roads, corridors, and patterns that already appear in the POV, LENS, or Fuel starting points. Do NOT invent names that are not there.",
    "4b. If the analytical lens is a facet lock, do not name sibling theories or the rest of the cluster syllabus even if the POV still lists them. Stay on the locked sub-version.",
    "5. Format: one sentence. No quotes, no preamble, no framing.",
    "",
    'Return ONLY JSON in this exact shape: {"hook": "..."}',
  ].join("\n");
}

export async function synthesizeHook({ apiKey, cluster, pov, emotion, demographics = [], editorialLens = "", anchors = [], subjectLock = null, lensBase = "" } = {}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("Missing Gemini API key");
  }
  const clusterKey = resolveClusterKey(cluster);
  if (!clusterKey) {
    throw new Error("Pick a Content Cluster first — the LENS anchors the hook synthesis.");
  }
  const cleanPOV = String(pov || "").trim();
  if (!cleanPOV) {
    throw new Error("Write or draft an Editorial POV first — the hook is the POV compressed into a scroll-stopper.");
  }

  const prompt = buildHookPrompt({ pov: cleanPOV, emotion, demographics, editorialLens, anchors, subjectLock, lensBase });

  const MODEL = "gemini-2.5-flash-lite";
  const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.85,
      maxOutputTokens: 256,
      responseSchema: {
        type: "object",
        properties: { hook: { type: "string", maxLength: 220 } },
        required: ["hook"],
      },
    },
  };

  let res;
  try {
    res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new Error(`Network error contacting Gemini: ${err?.message || err}`);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((p) => p && !p.thought && typeof p.text === "string") || parts[0];
  const raw = textPart?.text || "";
  if (!raw) throw new Error("Gemini returned an empty response.");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(trimmed);
  }
  const hook = String(parsed?.hook || "").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  if (!hook) throw new Error("Gemini returned no hook text — retry.");
  if (isListicleHook(hook)) {
    throw new Error("Gemini wrote a listicle cover. Redraft Hook — the line has to name the contrast the Fuel brief already proved.");
  }
  // Word-count guard — the spec says 10-18 words. A one-liner outside
  // that range violates the parametric contract; log a warning but
  // still return so the operator can decide whether to redraft.
  const wordCount = hook.split(/\s+/).filter(Boolean).length;
  if (typeof console !== "undefined" && (wordCount < 8 || wordCount > 22)) {
    console.warn(`Hook word count ${wordCount} is outside the 10-18 target — consider redrafting.`);
  }
  // Hard length cap — hook_a_side is a 220-char field, so match it.
  return hook.slice(0, 220);
}

// ─── ARGUMENT COHERENCE CHECK ──────────────────────────────────
// Adversarial pre-generation check. Reads the matrix as-is (hook,
// POV, anchors) and returns whether the anchors can genuinely SUPPORT
// the argument the hook + POV set up. Catches the failure mode the
// operator flagged: "slides 2 and 3 metaphors need insightful
// explanation — if the AI can't put the pieces together, that needs
// to be flagged before the carousel is generated."
//
// The check is CRITIC-role, not generator-role — same discipline as
// polishCarousel's refuse mechanism. It answers ONE question: given
// this hook, this POV, and these anchors, does the argument stand?
//
// Returns { verdict, reason, gaps }:
//   verdict: "coherent" | "thin" | "mismatched"
//     - coherent = the anchors carry the argument; generation will succeed
//     - thin = the anchors are on-topic but too few / too shallow to
//       carry the argument through 5+ slides without paraphrasing
//     - mismatched = the anchors don't support (or contradict) the
//       hook's specific claim; generation will produce a bait-and-switch
//   reason: one-sentence explanation of the verdict
//   gaps: array of specific missing pieces (each 60-120 chars)
//     for "thin" and "mismatched" verdicts; empty for "coherent"
//
// Bounded to one Flash-Lite call so the check is cheap enough to
// run automatically. Failure returns null; caller treats null as
// "check unavailable, proceed" — the check is a warning, not a gate.
export async function checkArgumentCoherence({ apiKey, hook, pov, anchors = [], cluster, clusterDirective } = {}) {
  if (!apiKey || !String(apiKey).trim()) return null;
  const cleanHook = String(hook || "").trim();
  const cleanPOV = String(pov || "").trim();
  const cleanAnchors = Array.isArray(anchors)
    ? anchors.map((a) => String(a || "").trim()).filter(Boolean)
    : [];
  // The check requires all three inputs — thesis, hook, and anchors —
  // to have anything to critique. Missing any means the matrix isn't
  // ready for the coherence question yet.
  if (!cleanHook || !cleanPOV || cleanAnchors.length < 2) return null;

  const clusterKey = resolveClusterKey(cluster);
  const clusterLine = clusterKey ? CONTENT_CLUSTERS[clusterKey].label : "";
  const directiveLine = clusterDirective || (clusterKey ? CONTENT_CLUSTERS[clusterKey].directive : "") || "";

  const prompt = [
    "ROLE: You are a critical newsroom editor reading a proposed carousel outline BEFORE any slide is written.",
    "TASK: Answer ONE question — can these anchors support this argument?",
    "",
    "You are NOT proposing better anchors, NOT rewriting the hook, NOT generating slides. You are answering: given what is on the desk, does the argument stand?",
    "",
    "THE ARGUMENT:",
    `  Hook (slide 1 promise): ${cleanHook}`,
    `  POV (thesis): ${cleanPOV}`,
    ...(clusterLine ? [`  Editorial cluster: ${clusterLine}`] : []),
    ...(directiveLine ? [`  Cluster lens: ${directiveLine}`] : []),
    "",
    "THE ANCHORS (raw facts the writer will build slides from):",
    ...cleanAnchors.map((a, i) => `  ${i + 1}. ${a.slice(0, 400)}`),
    "",
    "VERDICTS (pick ONE):",
    '  "coherent" — the anchors carry the argument. Different entities, different angles, each proving part of the thesis. Generation will succeed.',
    '  "thin" — the anchors are on-topic but too few or too shallow. The writer will have to paraphrase the same fact across slides 2-4 to fill the count, or write metaphors it can\'t ground. Fixable by adding 1-2 more distinct anchors OR compressing to fewer slides.',
    '  "mismatched" — the anchors don\'t actually support the hook\'s specific claim (or one anchor contradicts another). Generation will produce a bait-and-switch — the cover promises one thing, the middle slides deliver another. Fixable by revising the hook OR swapping anchors.',
    "",
    "For 'thin' and 'mismatched': also return 1-3 specific GAPS — each a short (60-120 char) sentence naming what's missing or what's off. Concrete, not vague. Example: 'No anchor names a currently-operating venue — every specific is either historical or a policy metric.' NOT: 'anchors are weak.'",
    "For 'coherent': return an empty gaps array.",
    "",
    "Be adversarial. It is better to flag a thin matrix and let the operator strengthen it than to green-light and produce a shaky carousel.",
    "",
    'Return ONLY JSON in this exact shape: {"verdict":"coherent|thin|mismatched","reason":"one sentence","gaps":["...","..."]}',
  ].join("\n");

  const MODEL = "gemini-2.5-flash-lite";
  const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3, // Critic — low temp, deterministic verdict
      maxOutputTokens: 512,
      responseSchema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["coherent", "thin", "mismatched"] },
          reason: { type: "string", maxLength: 400 },
          gaps: { type: "array", items: { type: "string", maxLength: 220 }, maxItems: 4 },
        },
        required: ["verdict", "reason"],
      },
    },
  };

  let res;
  try {
    res = await fetch(`${URL_BASE}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    if (typeof console !== "undefined") console.warn("Coherence check network error:", err?.message || err);
    return null;
  }
  if (!res.ok) {
    if (typeof console !== "undefined") console.warn(`Coherence check HTTP ${res.status}`);
    return null;
  }
  let data;
  try { data = await res.json(); } catch { return null; }
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((p) => p && !p.thought && typeof p.text === "string") || parts[0];
  const raw = textPart?.text || "";
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { parsed = JSON.parse(trimmed); } catch { return null; }
  }
  const verdict = ["coherent", "thin", "mismatched"].includes(parsed?.verdict) ? parsed.verdict : null;
  if (!verdict) return null;
  return {
    verdict,
    reason: String(parsed.reason || "").trim().slice(0, 400),
    gaps: Array.isArray(parsed.gaps)
      ? parsed.gaps.map((g) => String(g || "").trim()).filter(Boolean).slice(0, 4)
      : [],
  };
}

// Seed topics — the operator's curated beat board. Clicking one auto-
// fills cluster + corridor + hook_a_side + target_emotion +
// target_demographic on the matrix. Numbers preserve the operator's
// original topic-id scheme so future imports/exports line up.
//
// Each entry:
//   id                — stable identifier (TOPIC-##)
//   cluster           — the CONTENT_CLUSTERS label (resolveClusterKey handles it)
//   corridor          — must match a CORRIDORS entry from matrixEnums.js
//   title             — short display label for the Compass chip
//   suggestedHook     — becomes matrix.hook_a_side on click
//   targetEmotion     — must match an EMOTIONS entry
//   demographics      — array of DEMOGRAPHIC_PRESETS entries
export const COMPASS_TOPICS = [
  // Suburban Third-Place Crisis
  {
    id: "TOPIC-01",
    cluster: "Suburban Third-Place Crisis",
    corridor: "Route 1 Central Crossroads",
    title: "The Route 1 Void",
    suggestedHook: "Why Central Jersey's wealthiest commuter belt lacks organic gathering spaces.",
    targetEmotion: "Validation/Relatability",
    demographics: ["Young Working Professionals", "Corporate-to-Creative Hybrids"],
    facets: ["walkable-vs-strip"],
    locales: ["route-1"],
  },
  {
    id: "TOPIC-02",
    cluster: "Suburban Third-Place Crisis",
    corridor: "Transit Village Suburbs",
    title: "The Brewery Pivot",
    suggestedHook: "How suburban breweries accidentally became the default community centers for 20-and-30-somethings.",
    targetEmotion: "Curiosity/Epiphany",
    demographics: ["Young Working Professionals", "Creatives & DJs"],
    facets: ["parking-lot-brewery"],
  },
  {
    id: "TOPIC-04",
    cluster: "Suburban Third-Place Crisis",
    corridor: "Urban / Commuter Core",
    title: "Cafe Takeovers After 6 PM",
    suggestedHook: "Why daytime coffee shops are renting floor space to underground creative mixers.",
    targetEmotion: "Urgency/Insider Access",
    demographics: ["Creatives & DJs", "Corporate-to-Creative Hybrids"],
    facets: ["accidental-cafe"],
  },

  // Diaspora Infrastructure
  {
    id: "TOPIC-16",
    cluster: "Diaspora Infrastructure & Cultural Epicenters",
    corridor: "Urban / Commuter Core",
    title: "The Newark-JC Creative Pipeline",
    suggestedHook: "How diaspora creatives built an independent scene outside Manhattan's shadow.",
    targetEmotion: "Ambition/Sovereignty",
    demographics: ["Diaspora Networks", "Creatives & DJs"],
    facets: ["newark-jc-pipeline"],
    locales: ["newark", "jersey-city"],
  },
  {
    id: "TOPIC-17",
    cluster: "Diaspora Infrastructure & Cultural Epicenters",
    corridor: "Route 1 Central Crossroads",
    title: "The Afrobeats & Amapiano Corridor",
    suggestedHook: "Mapping the residency nights and DJ collectives owning Central and North Jersey sound systems.",
    targetEmotion: "Urgency/Insider Access",
    demographics: ["Diaspora Networks", "Sonic Purists"],
    facets: ["afrobeats-corridor"],
  },
  {
    id: "TOPIC-18",
    cluster: "Diaspora Infrastructure & Cultural Epicenters",
    corridor: "Urban / Commuter Core",
    title: "Who Programs vs Who Owns",
    suggestedHook: "The rooms are full. Who owns the night, and who just booked it?",
    targetEmotion: "Skepticism/Irreverence",
    demographics: ["Diaspora Networks", "Creatives & DJs"],
    facets: ["owns-vs-programs"],
  },
  {
    id: "TOPIC-19",
    cluster: "Diaspora Infrastructure & Cultural Epicenters",
    corridor: "Urban / Commuter Core",
    title: "Same City, Three Diasporas",
    suggestedHook: "African American, Caribbean, and African scenes sharing a ZIP code — and not always a room.",
    targetEmotion: "Curiosity/Epiphany",
    demographics: ["Diaspora Networks"],
    facets: ["same-city-diasporas"],
  },
  {
    id: "TOPIC-20",
    cluster: "Diaspora Infrastructure & Cultural Epicenters",
    corridor: "Transit Village Suburbs",
    title: "What the Kids Don't Inherit",
    suggestedHook: "The hall still opens on Sunday. The memory that used to fill it does not automatically transfer.",
    targetEmotion: "Nostalgia/Yearning",
    demographics: ["Diaspora Networks", "Young Working Professionals"],
    facets: ["memory-transfer"],
  },

  // Nightlife Dilemma & Sound Curation
  {
    id: "TOPIC-31",
    cluster: "Nightlife Dilemma & Sound Curation",
    corridor: "Urban / Commuter Core",
    title: "The Death of the Mega-Club",
    suggestedHook: "Why cavernous commercial clubs are closing and intimate 150-cap rooms are winning.",
    targetEmotion: "Skepticism/Irreverence",
    demographics: ["Sonic Purists", "Young Working Professionals"],
    facets: ["mega-club-collapse"],
  },
  {
    id: "TOPIC-32",
    cluster: "Nightlife Dilemma & Sound Curation",
    corridor: "Transit Village Suburbs",
    title: "The Hi-Fi Listening Room Concept",
    suggestedHook: "Why low-volume, hi-fi vinyl bars are attracting burnout professionals.",
    targetEmotion: "Curiosity/Epiphany",
    demographics: ["Low-Decibel / Alcohol-Conscious", "Corporate-to-Creative Hybrids"],
    facets: ["hi-fi-listening"],
  },

  // Daytime Play & Kinetic Wellness
  {
    id: "TOPIC-46",
    cluster: "Daytime Play & Kinetic Wellness",
    corridor: "Route 1 Central Crossroads",
    title: "The Adult Field Day Phenomenon",
    suggestedHook: "Why grown professionals will pay to run relay races, play tug-of-war, and touch grass together.",
    targetEmotion: "Nostalgia/Yearning",
    demographics: ["Kinetic / Adult Play", "Young Working Professionals"],
    facets: ["adult-field-day"],
  },
  {
    id: "TOPIC-47",
    cluster: "Daytime Play & Kinetic Wellness",
    corridor: "Urban / Commuter Core",
    title: "The Run Club as the New Dating App",
    suggestedHook: "How weekly 5K meetups replaced Hinge and Tinder for fitness-minded millennials.",
    targetEmotion: "Validation/Relatability",
    demographics: ["Kinetic / Adult Play", "Young Working Professionals"],
    facets: ["run-club"],
  },

  // State & Sonic History
  {
    id: "TOPIC-91",
    cluster: "State & Sonic History",
    corridor: "Urban / Commuter Core",
    title: "The Ghost of Club Zanzibar",
    suggestedHook: "How a Newark motel ballroom in 1979 birthed the Jersey Sound and rivaled NYC's Paradise Garage.",
    targetEmotion: "Nostalgia/Yearning",
    demographics: ["Sonic Purists", "Diaspora Networks"],
    facets: ["club-zanzibar"],
    locales: ["newark"],
  },
  {
    id: "TOPIC-92",
    cluster: "State & Sonic History",
    corridor: "Urban / Commuter Core",
    title: "Preserved vs Performed",
    suggestedHook: "Which Jersey rooms are keeping a lineage, and which are renting the aesthetic?",
    targetEmotion: "Skepticism/Irreverence",
    demographics: ["Sonic Purists", "Diaspora Networks"],
    facets: ["preserved-vs-performed"],
  },

  // Policy Mechanics & Municipal Architecture
  {
    id: "TOPIC-98",
    cluster: "Policy Mechanics & Municipal Architecture",
    corridor: "Transit Village Suburbs",
    title: "The 1:3,000 Liquor License Cap",
    suggestedHook: "Why New Jersey's $1M liquor license quota shaped every dining room you sit in.",
    targetEmotion: "Curiosity/Epiphany",
    demographics: ["Young Working Professionals", "Creatives & DJs"],
    facets: ["liquor-cap"],
  },
  {
    id: "TOPIC-99",
    cluster: "Policy Mechanics & Municipal Architecture",
    corridor: "Decentralized Borderlands",
    title: "Home Rule Paralysis",
    suggestedHook: "Why 564 separate municipal governments create 564 different sets of noise, parking, and permit rules.",
    targetEmotion: "Skepticism/Irreverence",
    demographics: ["Corporate-to-Creative Hybrids"],
    facets: ["home-rule"],
  },

  // Philosophy of Gathering
  {
    id: "TOPIC-113",
    cluster: "Philosophy & Behavioral Psychology of Gathering",
    corridor: "Transit Village Suburbs",
    title: "The Third-Place Void",
    suggestedHook: "Why the human brain deteriorates when restricted solely to home and work.",
    targetEmotion: "Validation/Relatability",
    demographics: ["Young Working Professionals", "Low-Decibel / Alcohol-Conscious"],
    facets: ["third-place-void"],
  },
];
