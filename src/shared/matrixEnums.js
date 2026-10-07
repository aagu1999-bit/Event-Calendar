// Single source of truth for every enum value in the Curatorial Matrix.
// UI dropdowns, validators, generation prompts, and any downstream JSON
// exports all read from here — change a label in one place and every
// surface picks it up. Adding a new corridor / cluster / emotion is a
// one-line change; no consumer needs to be updated as long as it reads
// from these arrays.
//
// Tier and pipeline status are objects (not bare strings) because their
// keys are stable identifiers used in code branches (e.g. "ANCHOR" vs
// "ORBIT" for the send-to-website filter) while their labels can be
// re-copied without a code change.

export const EVENT_TIERS = {
  ANCHOR: {
    key: "ANCHOR",
    label: "Anchor",
    desc: "In-house CGE event · premium placement",
  },
  ORBIT: {
    key: "ORBIT",
    label: "Orbit",
    desc: "Partner event · community-vetted",
  },
  FEATURE: {
    key: "FEATURE",
    label: "Feature",
    desc: "Cultural content · events as the door, not the product · no calendar date",
  },
};

// Order matters — this is the order the segmented control renders.
export const EVENT_TIER_ORDER = ["ANCHOR", "ORBIT", "FEATURE"];

export const CORRIDORS = [
  "Urban / Commuter Core",       // Essex · Hudson · Union
  "Route 1 Central Crossroads",  // Middlesex · Somerset · Mercer commuter belt
  "Transit Village Suburbs",
  "Shore / Southern Arteries",
  "Decentralized Borderlands",
];

// Legacy corridor labels that appear in older records. The modal
// normalizes a stored value through this map so a pre-rename record
// still highlights the right dropdown option.
export const LEGACY_CORRIDOR_ALIASES = {
  "Route 1 Crossroads": "Route 1 Central Crossroads",
};

export const CLUSTERS = [
  "Suburban Third-Place Crisis",
  "Diaspora Infrastructure",
  "Nightlife Dilemma",
  "Daytime Play",
  "Gathering Logistics",
  "Regional Demographics",
  "State & Sonic History",
  "Policy Mechanics",
  "Civic Tech",
  "Philosophy of Gathering",
];

export const EMOTIONS = [
  "Curiosity/Epiphany",
  "Validation/Relatability",
  "Skepticism/Irreverence",
  "Nostalgia/Yearning",
  "Urgency/Insider Access",
  "Ambition/Sovereignty",
];

// Preset demographic archetypes — CGE-specific cultural segments the
// operator uses regularly. Rendered as click-to-add chips in the
// Matrix modal. Custom demographics the operator adds persist to
// localStorage so they surface as presets on subsequent records.
// Order is the display order in the chip row.
export const DEMOGRAPHIC_PRESETS = [
  "Young Working Professionals",
  "Diaspora Networks",
  "Corporate-to-Creative Hybrids",
  "Low-Decibel / Alcohol-Conscious",
  "Sonic Purists",
  "Kinetic / Adult Play",
  "Creatives & DJs",
];

// Legacy demographic labels — normalize old records that stored the
// long parenthetical variant to the new short form.
export const LEGACY_DEMOGRAPHIC_ALIASES = {
  "Sonic Purists (House / Afrobeats / R&B)": "Sonic Purists",
};

export const PIPELINE_STATUS = {
  DRAFT:     { key: "DRAFT",     label: "Draft" },
  READY:     { key: "READY",     label: "Ready" },
  PUBLISHED: { key: "PUBLISHED", label: "Published" },
};

export const PIPELINE_STATUS_ORDER = ["DRAFT", "READY", "PUBLISHED"];

// Character + item-count limits. Enforced by validators + shown as live
// hints in the UI. Numbers here so they change in exactly one place.
export const LIMITS = {
  HOOK_MAX: 220,      // A-side and B-side: fits an IG carousel opener
  POV_MAX: 500,       // curatorial thesis; keeps it thesis, not article
  BULLET_MAX: 700,    // starting-point paragraph; AI Mode briefs need more than a venue fact
  BULLETS_MIN: 1,     // at least one data point to mark Ready
  BULLETS_MAX: 8,     // thesis + starting points a writer can dive; trim before the carousel if it overloads
  TRIGGER_MAX: 20,    // DM trigger — short and shoutable
  FACETS_MAX: 5,      // largest cluster's facet count; empty ≠ syllabus — Select all or pick topics
  LOCALES_MAX: 3,     // subject-lock corridor locales (empty = geography context, not a spend)
};

// Every matrix field name the store knows about — used by completeness
// checks and the JSON export pipeline. Kept here so a new field lands
// in one place without hunting for "everywhere that lists fields."
export const MATRIX_FIELDS = [
  "event_tier",
  "corridor",
  "cluster",
  // Subject lock — named sub-versions. Empty facets = cluster is a
  // desk, not the syllabus. Select all or pick the topics this piece
  // spends. Locales are geography context, not a story spend.
  "subject_facets",
  "corridor_locales",
  "join_facet",
  // Per-matrix LENS override. Empty = live LENS is the facet lock
  // (or nothing if no chips). Populated = narrowing that downstream
  // synths read. Cluster is optional — Narrowing does not require it.
  "editorial_lens",
  "target_emotion",
  "target_demographic",
  "hook_a_side",
  "hook_b_side",
  "editorial_pov",
  "data_points",
  "keyword_trigger",
  "pipeline_status",
  // Voice params — Distance × Cadence × Stance (see voiceParams.js).
  // Stored as canonical enum keys; empty string / undefined = unset,
  // writer falls back to mode's register block alone.
  "voice_distance",
  "voice_cadence",
  "voice_stance",
  // Last Coherence check (critic output, not editorial content).
  // Completeness ignores this the same way it ignores pipeline_status.
  "argument_check",
];
