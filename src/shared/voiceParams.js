// Voice Parameters — three orthogonal knobs that compose into a
// writer-facing voice directive.
//
// The parametric-persona pattern from the hook synthesizer applied at
// carousel-writer scope: Distance × Cadence × Stance. Distance is
// how close the writer stands to the reader; Cadence is the sentence
// shape; Stance is the writer's attitude toward the subject (optional
// override that reshapes tone).
//
// Composition rule: Distance + Cadence combine multiplicatively (16
// cells). Stance is independent and either sits alongside (adds an
// attitude directive) or is left blank (Distance + Cadence carry the
// tone unassisted).
//
// This file is the source of truth. The matrix modal reads the enums
// for dropdown options; buildTemplatePrompt reads composeVoiceParams
// to inject the directive block. Edit specs here → all downstream
// surfaces reflect it on next render.

// ─── ENUM OPTIONS ────────────────────────────────────────────────
// Each option is a stable key (uppercase snake) + display label.
// Keys persist to disk on matrix.voice_distance / voice_cadence /
// voice_stance; labels only render in the UI. Order matters for the
// dropdown display order.

export const DISTANCE_OPTIONS = [
  { key: "CONFIDANT", label: "Confidant" },
  { key: "REPORTER", label: "Reporter" },
  { key: "EDITORIAL_WE", label: "Editorial We" },
  { key: "BROADCASTER", label: "Broadcaster" },
];

export const CADENCE_OPTIONS = [
  { key: "STACKED", label: "Stacked" },
  { key: "ROLLING", label: "Rolling" },
  { key: "CONVERSATIONAL", label: "Conversational" },
  { key: "BRAIDED", label: "Braided" },
];

export const STANCE_OPTIONS = [
  { key: "DEADPAN", label: "Deadpan" },
  { key: "AWED", label: "Awed" },
  { key: "WARM", label: "Warm" },
  { key: "SARDONIC", label: "Sardonic" },
  { key: "PROPHETIC", label: "Prophetic" },
];

// ─── SPECS ───────────────────────────────────────────────────────
// Each spec is a paragraph the writer prompt quotes verbatim. Same
// authoring register as the EMOTION_STANCES in the hook synthesizer
// — describe what the voice DOES, not just what it is.

const DISTANCE_SPECS = {
  CONFIDANT:
    "Voice stance: you are speaking directly to the reader as if they already know the block. Second-person throughout ('you know the corner I mean', 'you've felt this'). Assume shared context — the reader is inside the scene, not being introduced to it. Skip explanations of what a listening bar is or why a curfew matters; the reader knows. Address them like a friend passing information across the table.",
  REPORTER:
    "Voice stance: you are a newsroom writer covering the scene from the outside. Third-person, declarative sentences. Sources named or paraphrased; claims supported. No 'I' or 'we' and no 'you' addressed to the reader. Observational — you are reporting what is happening, not participating in it. Every fact stands on its own sourcing.",
  EDITORIAL_WE:
    "Voice stance: you are speaking on behalf of a publication and its audience simultaneously. 'We' means CGE and the reader together — the shared perspective of people who care about this scene. First-person plural throughout. Use 'we' as agency ('we spent last Friday counting cars', 'we've been watching this room for a year') — never as a rhetorical crutch or a royal we.",
  BROADCASTER:
    "Voice stance: you are narrating what is happening RIGHT NOW as if the reader is watching it unfold. Present tense throughout. Sensory specifics: what the room sounds like at this hour, what people are wearing, what is on the bar. The reader is standing next to you in the scene. Past and future tense are BANNED except where past tense is used to CONTRAST with the present moment.",
};

const CADENCE_SPECS = {
  STACKED:
    "Cadence: short lines. Each carrying one image or one fact. Line breaks between them — not because it is poetry but because each image gets its own beat. Two to five words per line, often. Never more than one sentence per line. Blank lines signal a shift in the beat. This is the insider-dispatch rhythm — clipped, confident, no filler.",
  ROLLING:
    "Cadence: subordinated sentences that develop and turn. Semicolons and em-dashes doing structural work. Sentences average 25 to 40 words. The reader breathes through the piece rather than punching through it. Metaphors are allowed to unfold across a clause. This is the essayist register — patience without softness.",
  CONVERSATIONAL:
    "Cadence: fragments allowed. Contractions expected. A shrug in the middle is fine ('so, yeah'). Sentences run one or two lines long, often broken by an aside in dashes. Rhythm mimics spoken thought, not planned prose. Sound like you are texting someone smart, not writing to be read aloud.",
  BRAIDED:
    "Cadence: two or three threads running simultaneously through the paragraph, cutting between them mid-sentence or between clauses. The scene, the history behind it, and the argument all sharing the same paragraph. Reader holds multiple pieces at once. This trusts the reader — not for every slide, pick one paragraph to braid and keep others plainer.",
};

const STANCE_SPECS = {
  DEADPAN:
    "Stance: dry, understated. The humor rises from the flatness — name the absurd fact and let it sit. Never punch a joke; never lean on the laugh. If something is remarkable, describe it as if it isn't.",
  AWED:
    "Stance: unafraid of the big word when the scene earns it. Sincerity without sentimentality. This is what happens when you find something worth writing about and refuse to pretend it isn't worth writing about. Never crosses into worship.",
  WARM:
    "Stance: rooting for the room. Care visible in the phrasing. Not neutral reporting; you are on the side of the people described. Warmth as respect, not pity — never patronizing.",
  SARDONIC:
    "Stance: skeptical of the surface story. Every polished claim gets one eyebrow raised. Not cynical — sardonic. The piece names what everyone pretends not to notice.",
  PROPHETIC:
    "Stance: future tense as rhetorical mode. Names what is coming without hedging. This is the register of the piece that says 'this is the next thing' and stands behind the claim. Rare — use only when the material actually earns a claim about what is next.",
};

// Resolve a stored key (case + whitespace tolerant) to a canonical
// key from the enum. Returns null when the value doesn't match any
// entry, so callers can treat missing/invalid the same way (unset).
function resolveKey(value, enumList) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return null;
  return enumList.some((e) => e.key === trimmed) ? trimmed : null;
}

export function resolveDistanceKey(value) { return resolveKey(value, DISTANCE_OPTIONS); }
export function resolveCadenceKey(value)  { return resolveKey(value, CADENCE_OPTIONS); }
export function resolveStanceKey(value)   { return resolveKey(value, STANCE_OPTIONS); }

// Compose the writer-facing directive block from a { distance,
// cadence, stance } pick. Returns an empty string when nothing is
// set (writer falls back to mode's register block alone). Any
// combination of set/unset knobs works — Distance alone, Cadence
// alone, Distance + Cadence + Stance, all three, etc.
export function composeVoiceParamsDirective({ distance, cadence, stance } = {}) {
  const dKey = resolveDistanceKey(distance);
  const cKey = resolveCadenceKey(cadence);
  const sKey = resolveStanceKey(stance);

  const parts = [];
  if (dKey) parts.push(DISTANCE_SPECS[dKey]);
  if (cKey) parts.push(CADENCE_SPECS[cKey]);
  if (sKey) parts.push(STANCE_SPECS[sKey]);
  if (!parts.length) return "";

  const header = [
    "═════════════════════════════",
    "VOICE PARAMETERS — how this piece sounds within the brand voice. Compose these instructions with (do not override) the brand voice fingerprint above. If a rule here conflicts with the mode's register block, the VOICE PARAMETERS win at the sentence-shape level; the mode's register wins at the structural-arc level.",
    "",
  ];
  const footer = [
    "",
    "═════════════════════════════",
  ];
  return [...header, ...parts, ...footer].join("\n");
}

// A short one-liner for logging + status pills in the UI, so the
// operator can see at a glance which voice params landed on this
// carousel. Never used in prompt scaffolding.
export function formatVoiceParamsLabel({ distance, cadence, stance } = {}) {
  const bits = [];
  const d = resolveDistanceKey(distance);
  const c = resolveCadenceKey(cadence);
  const s = resolveStanceKey(stance);
  if (d) bits.push(DISTANCE_OPTIONS.find((o) => o.key === d).label);
  if (c) bits.push(CADENCE_OPTIONS.find((o) => o.key === c).label);
  if (s) bits.push(STANCE_OPTIONS.find((o) => o.key === s).label);
  return bits.join(" · ");
}
