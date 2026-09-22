// Pure validation + completeness helpers for the Curatorial Matrix.
// No React, no store deps — safe to call from any surface (server-side
// export gate, client-side UI hints, batch tools). Every check is small
// and independent so a bad field can't cascade past its own error.
//
// Two functions:
//   - validateMatrix(matrix, { targetStatus }) → { ok, errors: [...] }
//   - matrixCompleteness(matrix)               → { filled, total }
//
// Validators return per-field errors instead of throwing so the UI can
// paint each field's message inline. Ready-for-pipeline gating layers
// on top of the same errors — passing targetStatus: "READY" adds the
// minimum-viable-matrix checks needed to ship to automation.

import { LIMITS, PIPELINE_STATUS, MATRIX_FIELDS, EVENT_TIERS } from "./matrixEnums.js";

// Returns { ok: boolean, errors: [{ field, message }] }.
// Errors are surfaced in field order so the UI can render them in the
// same visual order the operator sees.
export function validateMatrix(matrix, { targetStatus } = {}) {
  const errors = [];
  const m = matrix || {};

  if (m.hook_a_side && m.hook_a_side.length > LIMITS.HOOK_MAX) {
    errors.push({ field: "hook_a_side", message: `Over ${LIMITS.HOOK_MAX} chars — trim ${m.hook_a_side.length - LIMITS.HOOK_MAX}` });
  }
  if (m.hook_b_side && m.hook_b_side.length > LIMITS.HOOK_MAX) {
    errors.push({ field: "hook_b_side", message: `Over ${LIMITS.HOOK_MAX} chars — trim ${m.hook_b_side.length - LIMITS.HOOK_MAX}` });
  }
  if (m.editorial_pov && m.editorial_pov.length > LIMITS.POV_MAX) {
    errors.push({ field: "editorial_pov", message: `Over ${LIMITS.POV_MAX} chars — trim ${m.editorial_pov.length - LIMITS.POV_MAX}` });
  }
  if (m.keyword_trigger && m.keyword_trigger.length > LIMITS.TRIGGER_MAX) {
    errors.push({ field: "keyword_trigger", message: `Over ${LIMITS.TRIGGER_MAX} chars — DM triggers stay short` });
  }

  const bullets = Array.isArray(m.data_points) ? m.data_points.filter(Boolean) : [];
  for (let i = 0; i < bullets.length; i++) {
    const b = String(bullets[i] || "");
    if (b.length > LIMITS.BULLET_MAX) {
      errors.push({ field: `data_points[${i}]`, message: `Over ${LIMITS.BULLET_MAX} chars — trim ${b.length - LIMITS.BULLET_MAX}` });
    }
  }
  if (bullets.length > LIMITS.BULLETS_MAX) {
    errors.push({ field: "data_points", message: `Max ${LIMITS.BULLETS_MAX} bullets — drop ${bullets.length - LIMITS.BULLETS_MAX}` });
  }

  // Tier value must be a known tier if set at all — protects against
  // typos when matrix data is imported from an external tool.
  if (m.event_tier && !EVENT_TIERS[m.event_tier]) {
    errors.push({ field: "event_tier", message: `Unknown tier "${m.event_tier}"` });
  }

  // Ready-for-pipeline gate: minimum viable matrix depth. Tier + one
  // hook + one data point is our line for "the carousel prompt has
  // enough to generate something useful." Feature tier adds POV as a
  // required field because evergreen editorial without a thesis just
  // becomes a listicle — the operator's take is the whole point.
  if (targetStatus === PIPELINE_STATUS.READY.key) {
    if (!m.event_tier) {
      errors.push({ field: "event_tier", message: "Pick a tier to ship" });
    }
    if (!m.hook_a_side || !m.hook_a_side.trim()) {
      errors.push({ field: "hook_a_side", message: "Hook A-side required to ship" });
    }
    if (bullets.length < LIMITS.BULLETS_MIN) {
      errors.push({ field: "data_points", message: `At least ${LIMITS.BULLETS_MIN} data point required to ship` });
    }
    // Feature-tier only: POV is the editorial thesis for evergreen
    // pieces. Anchor/Orbit stay lightweight so quick weekend listings
    // don't get blocked by a thesis requirement they don't need.
    if (m.event_tier === "FEATURE" && (!m.editorial_pov || !m.editorial_pov.trim())) {
      errors.push({ field: "editorial_pov", message: "Editorial POV required for Feature-tier pieces" });
    }
  }

  return { ok: errors.length === 0, errors };
}

// Returns { filled, total } — the fraction of matrix fields that have
// a non-empty value. Drives the completeness dot row on the pool + edit
// forms. `pipeline_status` isn't counted (it's a workflow flag, not
// editorial content).
export function matrixCompleteness(matrix) {
  const m = matrix || {};
  const countable = MATRIX_FIELDS.filter((f) => f !== "pipeline_status");
  const filled = countable.filter((f) => {
    const v = m[f];
    if (Array.isArray(v)) return v.filter(Boolean).length > 0;
    return v && String(v).trim().length > 0;
  }).length;
  return { filled, total: countable.length };
}

// Returns true if the matrix has enough content to be worth sending to
// the AI carousel generator. Currently the same rule as the Ready gate
// but split out so downstream surfaces (e.g. "Preview Carousel" button
// disable state) don't have to reconstruct the check.
export function isMatrixReadyForGeneration(matrix) {
  const { ok } = validateMatrix(matrix, { targetStatus: PIPELINE_STATUS.READY.key });
  return ok;
}
