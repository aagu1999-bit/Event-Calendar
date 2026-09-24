// Compass — the single source of truth for the CGE editorial worldview.
//
// This module supersedes the flat CLUSTERS array in matrixEnums.js: every
// cluster now carries a `directive` — a specific analytical lens the AI
// (Perplexity for research, Gemini for carousel copy) is FORCED to adopt
// when that cluster is picked. The directive is the whole point: without
// it, "Nightlife Dilemma" is just a label; with it, Sonar knows to look
// for mega-club closures, bottle-service fatigue, and hi-fi listening
// rooms rather than generic "party" facts.
//
// Compass also ships a curated `COMPASS_TOPICS` list — 13 pre-shaped
// editorial angles the operator can one-tap to auto-fill the matrix
// (cluster + corridor + hook + emotion + demographic in one click). Think
// of it as the operator's own "assigned beats" board.
//
// Storage model: matrix.cluster now stores the KEY (uppercase snake,
// e.g. "NIGHTLIFE_DILEMMA") going forward. Legacy records saved the
// human-readable label from the old CLUSTERS array; `resolveClusterKey`
// handles both shapes transparently, so nothing on disk breaks.

export const CONTENT_CLUSTERS = {
  SUBURBAN_THIRD_PLACE: {
    key: "SUBURBAN_THIRD_PLACE",
    label: "Suburban Third-Place Crisis",
    directive: "Focus on the deficit of walkable social infrastructure, car-dependent commercial strips, strip mall speakeasies, and how suburban spots accidentally become gathering hubs.",
  },
  DIASPORA_INFRASTRUCTURE: {
    key: "DIASPORA_INFRASTRUCTURE",
    label: "Diaspora Infrastructure & Cultural Epicenters",
    directive: "Highlight second-gen identity spaces, immigrant business ecosystems, civic halls, and authentic cultural spaces (Afrobeats, Caribbean, Latin house) outside mainstream commercial circuits.",
  },
  NIGHTLIFE_DILEMMA: {
    key: "NIGHTLIFE_DILEMMA",
    label: "Nightlife Dilemma & Sound Curation",
    directive: "Dissect the collapse of commercial mega-clubs, bottle service fatigue, early curfews, acoustic audits, and the rise of intimate hi-fi or vinyl listening rooms.",
  },
  DAYTIME_PLAY: {
    key: "DAYTIME_PLAY",
    label: "Daytime Play & Kinetic Wellness",
    directive: "Explore adult recess, field days, run clubs as social hubs, roller rinks, sober socializing, and non-alcohol-centric kinetic community gatherings.",
  },
  GATHERING_LOGISTICS: {
    key: "GATHERING_LOGISTICS",
    label: "Economics & Logistics of Gathering",
    directive: "Examine the raw operational math: venue rental splits, food truck coordination, rain contingencies, permit red tape, check-in bottlenecks, and door economics.",
  },
  REGIONAL_DEMOGRAPHICS: {
    key: "REGIONAL_DEMOGRAPHICS",
    label: "Regional Demographics & Transit Shifts",
    directive: "Analyze commuter rail habits, reverse-commute patterns, transit village gentrification, suburban brain drain, and geographic identity across NJ corridors.",
  },
  STATE_SONIC_HISTORY: {
    key: "STATE_SONIC_HISTORY",
    label: "State & Sonic History",
    directive: "Anchor the narrative in regional musical legacy, historic ballroom culture, early house movements (e.g., Club Zanzibar), and coastal resort boom history.",
  },
  POLICY_MECHANICS: {
    key: "POLICY_MECHANICS",
    label: "Policy Mechanics & Municipal Architecture",
    directive: "Break down statutory quotas (like the 1947 1:3,000 NJ liquor license cap), 'home rule' fragmentation across 564 towns, zoning restrictions, and public park permitting.",
  },
  DIGITAL_NETWORKS: {
    key: "DIGITAL_NETWORKS",
    label: "Digital Networks & Civic Tech",
    directive: "Explore algorithmic ticketing queues, the death of street flyering, private WhatsApp/Telegram community networks, and automation for independent operators.",
  },
  PHILOSOPHY_OF_GATHERING: {
    key: "PHILOSOPHY_OF_GATHERING",
    label: "Philosophy & Behavioral Psychology of Gathering",
    directive: "Ground in sociology: Ray Oldenburg third-place theory, the propinquity effect, collective effervescence, social friction, and the psychological cost of being outside.",
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
  },
  {
    id: "TOPIC-02",
    cluster: "Suburban Third-Place Crisis",
    corridor: "Transit Village Suburbs",
    title: "The Brewery Pivot",
    suggestedHook: "How suburban breweries accidentally became the default community centers for 20-and-30-somethings.",
    targetEmotion: "Curiosity/Epiphany",
    demographics: ["Young Working Professionals", "Creatives & DJs"],
  },
  {
    id: "TOPIC-04",
    cluster: "Suburban Third-Place Crisis",
    corridor: "Urban / Commuter Core",
    title: "Cafe Takeovers After 6 PM",
    suggestedHook: "Why daytime coffee shops are renting floor space to underground creative mixers.",
    targetEmotion: "Urgency/Insider Access",
    demographics: ["Creatives & DJs", "Corporate-to-Creative Hybrids"],
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
  },
  {
    id: "TOPIC-17",
    cluster: "Diaspora Infrastructure & Cultural Epicenters",
    corridor: "Route 1 Central Crossroads",
    title: "The Afrobeats & Amapiano Corridor",
    suggestedHook: "Mapping the residency nights and DJ collectives owning Central and North Jersey sound systems.",
    targetEmotion: "Urgency/Insider Access",
    demographics: ["Diaspora Networks", "Sonic Purists"],
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
  },
  {
    id: "TOPIC-32",
    cluster: "Nightlife Dilemma & Sound Curation",
    corridor: "Transit Village Suburbs",
    title: "The Hi-Fi Listening Room Concept",
    suggestedHook: "Why low-volume, hi-fi vinyl bars are attracting burnout professionals.",
    targetEmotion: "Curiosity/Epiphany",
    demographics: ["Low-Decibel / Alcohol-Conscious", "Corporate-to-Creative Hybrids"],
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
  },
  {
    id: "TOPIC-47",
    cluster: "Daytime Play & Kinetic Wellness",
    corridor: "Urban / Commuter Core",
    title: "The Run Club as the New Dating App",
    suggestedHook: "How weekly 5K meetups replaced Hinge and Tinder for fitness-minded millennials.",
    targetEmotion: "Validation/Relatability",
    demographics: ["Kinetic / Adult Play", "Young Working Professionals"],
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
  },
  {
    id: "TOPIC-99",
    cluster: "Policy Mechanics & Municipal Architecture",
    corridor: "Decentralized Borderlands",
    title: "Home Rule Paralysis",
    suggestedHook: "Why 564 separate municipal governments create 564 different sets of noise, parking, and permit rules.",
    targetEmotion: "Skepticism/Irreverence",
    demographics: ["Corporate-to-Creative Hybrids"],
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
  },
];
