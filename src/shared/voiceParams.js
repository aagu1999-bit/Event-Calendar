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

// ─── VOICE PREVIEW ────────────────────────────────────────────────
// Renders one sample paragraph in the current voice-params combination
// so the operator can hear the voice BEFORE generating a full carousel.
// Uses a FIXED neutral subject (a Friday night at a small NJ music
// room) so every preview across every combo can be compared like-for-
// like — the voice, not the topic, is what's demonstrated.
//
// Same client-side Gemini Flash-Lite architecture as synthesizeHook +
// synthesizeThesis. Requires Distance AND Cadence to be set (Stance
// optional).
export async function previewVoice({ apiKey, distance, cadence, stance } = {}) {
  if (!apiKey || !String(apiKey).trim()) {
    throw new Error("Missing Gemini API key");
  }
  const dKey = resolveDistanceKey(distance);
  const cKey = resolveCadenceKey(cadence);
  if (!dKey) {
    throw new Error("Pick a Distance first — it's the primary voice knob.");
  }
  if (!cKey) {
    throw new Error("Pick a Cadence first — Distance + Cadence together shape the voice.");
  }
  const sKey = resolveStanceKey(stance);

  // Fixed subject so preview isolates voice from topic. Kept generic
  // enough that any Distance × Cadence × Stance combo can write to
  // it, specific enough that the voice has something to grip.
  const FIXED_SUBJECT = "a Friday night at a 150-capacity music room somewhere in New Jersey — the crowd, the sound, the door, one thing you notice about the room";

  const prompt = [
    "ROLE: You are a master cultural writer for a niche New Jersey magazine. Right now you are producing ONE sample paragraph — a preview — so an editor can hear this voice combination before commissioning a full piece.",
    "TASK: Write a single paragraph (80-120 words) about the SUBJECT below, in the exact voice combination specified.",
    "",
    `SUBJECT: ${FIXED_SUBJECT}`,
    "",
    "VOICE COMBINATION — follow all applicable specs strictly:",
    DISTANCE_SPECS[dKey],
    CADENCE_SPECS[cKey],
    ...(sKey ? [STANCE_SPECS[sKey]] : []),
    "",
    "CONSTRAINTS:",
    "1. Do NOT name a specific real venue, town, DJ, promoter, or ordinance. This is a preview of VOICE, not reporting — invent no proper nouns beyond generic references ('the corner', 'the room', 'the door').",
    "2. Do NOT explain the voice or reference the fact that this is a sample. Just write the paragraph.",
    "3. Length: 80-120 words. One paragraph. If cadence is Stacked, the paragraph can be a block of short stacked lines separated by newlines within one paragraph — still counts as one paragraph.",
    "4. No marketing tropes, no scaffolding, no register slippage.",
    "",
    'Return ONLY JSON in this exact shape: {"preview": "..."}',
  ].join("\n");

  const MODEL = "gemini-2.5-flash-lite";
  const URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.85,
      maxOutputTokens: 512,
      responseSchema: {
        type: "object",
        properties: { preview: { type: "string", maxLength: 900 } },
        required: ["preview"],
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
  const preview = String(parsed?.preview || "").trim();
  if (!preview) throw new Error("Gemini returned no preview text — retry.");
  return preview.slice(0, 900);
}
