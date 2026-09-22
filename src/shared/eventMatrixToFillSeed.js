// Maps a curated event's Curatorial Matrix into the seed shape the AI
// Fill Template modal accepts. Pure — no side effects, safe to call from
// anywhere (Matrix modal's "Preview Carousel" button, MediaTool's own
// entry points, tests, future JSON exports).
//
// The mapping is intentionally deterministic so operators can predict
// what a Preview Carousel click will do. If they want a different register
// they can flip it inside the fill modal itself — the seed is a starting
// point, not a lock.

import { EVENT_TIERS } from "./matrixEnums.js";

// Register (mode) mapping — matches the state variable `mode` in
// AiTemplateFillModal. Valid values: "promo", "editorial", "story".
//
// Rules:
//   Anchor  → promo    (in-house event, promotional intent)
//   Feature → story    (evergreen editorial, letter tone)
//   Orbit + Nostalgia/Yearning → story
//   Orbit + Curiosity/Epiphany → editorial
//   Orbit (default) → editorial
//
// Returns null when there's no confident mapping — the modal falls back
// to its own default ("editorial").
export function pickRegisterFromMatrix(m) {
  if (!m) return null;
  if (m.event_tier === EVENT_TIERS.ANCHOR.key) return "promo";
  if (m.event_tier === EVENT_TIERS.FEATURE.key) return "story";
  if (m.event_tier === EVENT_TIERS.ORBIT.key) {
    if (m.target_emotion === "Nostalgia/Yearning") return "story";
    if (m.target_emotion === "Curiosity/Epiphany") return "editorial";
    return "editorial";
  }
  return null;
}

// Tier-driven template preset default. Returned values are template ID
// strings — actual IDs live in the template registry, so callers can
// pass null through to let the modal keep the operator's last-used
// template if the tier doesn't have a strong opinion.
//
// Anchor stays free-form (last-used) because in-house events run through
// varied surfaces. Feature and Orbit have clearer editorial homes.
export function pickTemplateFromMatrix(m) {
  if (!m) return null;
  if (m.event_tier === EVENT_TIERS.FEATURE.key) return "FEATURE_DROP_8";
  if (m.event_tier === EVENT_TIERS.ORBIT.key) return "EDITORIAL_ROUNDUP_7";
  return null;
}

// Assemble the full seed the modal wants. Returns null when the event
// has no matrix data worth seeding from — the caller (Matrix modal's
// Preview Carousel button, MediaTool page) treats that as "open blank"
// so the seedless click keeps working exactly like the plain ✨ AI Fill.
export function eventMatrixToFillSeed(event) {
  if (!event) return null;
  const m = event.matrix || {};
  const hookA = String(m.hook_a_side || "").trim();
  const pov = String(m.editorial_pov || "").trim();
  const bullets = Array.isArray(m.data_points)
    ? m.data_points.map((b) => String(b || "").trim()).filter(Boolean)
    : [];

  // Nothing to work with → let the caller open the modal empty.
  if (!hookA && !pov && !bullets.length) return null;

  // Topic falls back to event.name so the seed is never empty when the
  // matrix has been touched at all — Gemini can generate from a bare
  // event name in a pinch.
  const topic = hookA || String(event.name || "").trim() || "";

  // Context is structured: POV on top, then a blank line, then one
  // dashed bullet per data point. Consistent format across seed calls
  // means the prompt-assembly rules can rely on it later.
  const contextLines = [];
  if (pov) contextLines.push(`POV: ${pov}`);
  if (bullets.length) {
    if (contextLines.length) contextLines.push("");
    for (const b of bullets) contextLines.push(`- ${b}`);
  }
  const context = contextLines.join("\n");

  return {
    topic,
    context,
    register: pickRegisterFromMatrix(m),   // → mode: promo | editorial | story | null
    templateId: pickTemplateFromMatrix(m), // → preset id | null
    // arrange: true means "AI, pick and arrange the layout" — which is
    // what we want when the operator is coming from Matrix (they've done
    // the editorial thinking; let the AI handle sequence).
    arrange: true,
  };
}
