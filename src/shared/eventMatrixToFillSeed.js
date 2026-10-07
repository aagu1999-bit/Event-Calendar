// Maps a curated event's Curatorial Matrix into the seed shape the AI
// Fill Template modal accepts. Pure — no side effects, safe to call from
// anywhere (Matrix modal's "Preview Carousel" button, MediaTool's own
// entry points, tests, future JSON exports).
//
// FEEDBACK MEMORY (Reject / Approve bank):
// Each matrix carries two capped feedback logs — matrix.rejected_drafts
// and matrix.approved_drafts — populated when the operator taps the
// Reject or Approve buttons on a generated preview. Rather than storing
// full slides (JSONB bloat), we store a compact digest per slide (type +
// 60-char preview of the main text field) plus a reason for rejections.
// summarizeSlidesForFeedback below produces the digest; it lives here
// because both the modal (writing) and buildTemplatePrompt (reading)
// need the same shape.

// Compact one-line-per-slide summary for feedback storage. Digest goal:
// enough shape for the writer to recognize "don't reproduce this failure"
// or "hold this bar", without shipping full JSON payloads across every
// subsequent generation.
export function summarizeSlidesForFeedback(slides) {
  if (!Array.isArray(slides)) return [];
  return slides.map((s, i) => {
    if (!s || typeof s !== "object") return { idx: i + 1, type: "unknown", digest: "" };
    const type = String(s.type || "unknown");
    // Field priority: pick the most visible / distinctive text field per slot type.
    const fieldByType = {
      cover: s.headline || s.subtitle,
      news: s.newsHeadline || s.newsBody,
      spotlight: s.spotName || s.spotMeta,
      stat: s.statNumber ? `${s.statNumber} ${s.statLabel || ""}`.trim() : s.statSub,
      text: s.textTitle || s.textBody,
      cta: s.ctaDate || s.ctaVenue,
      features: Array.isArray(s.features) && s.features.length
        ? s.features.map((f) => f?.headline || "").filter(Boolean).slice(0, 2).join(" · ")
        : "",
    };
    const raw = String(fieldByType[type] || s.headline || s.textTitle || s.spotName || "").trim();
    const digest = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
    return { idx: i + 1, type, digest };
  });
}
//
// The mapping is intentionally deterministic so operators can predict
// what a Preview Carousel click will do. If they want a different register
// they can flip it inside the fill modal itself — the seed is a starting
// point, not a lock.

import { EVENT_TIERS, DEMOGRAPHIC_PRESETS, LEGACY_DEMOGRAPHIC_ALIASES } from "./matrixEnums.js";
import { getClusterLabel, getClusterDefaultPOV, resolveEditorialLens, isListicleHook } from "./matrixCompass.js";
import { buildSubjectLock, lockLensDirective } from "./subjectLock.js";
import { CONTENT_DEFAULT_VOICE } from "./cgeThesis.js";

// Register (mode) mapping — matches the state variable `mode` in
// AiTemplateFillModal. Valid values: "promo", "editorial", "story", "content".
//
// Rules:
//   Anchor  → promo     (in-house event, promotional intent)
//   Feature → content   (evergreen cultural thesis; events are the door)
//   Orbit + Nostalgia/Yearning → story
//   Orbit + Curiosity/Epiphany → editorial
//   Orbit (default) → editorial
//
// Returns null when there's no confident mapping — the modal falls back
// to its own default ("editorial").
export function pickRegisterFromMatrix(m) {
  if (!m) return null;
  if (m.event_tier === EVENT_TIERS.ANCHOR.key) return "promo";
  if (m.event_tier === EVENT_TIERS.FEATURE.key) return "content";
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
// varied surfaces. Feature defaults to Editorial Insight — teach one
// idea. Local Guide is a cafe directory; Feature Drop is a pickleball
// flyer. Orbit stays the weekend roundup. Feature Preview does NOT
// send the piece through the Instagram arranger.
export function pickTemplateFromMatrix(m) {
  if (!m) return null;
  if (m.event_tier === EVENT_TIERS.FEATURE.key) return "editorial-insight";
  if (m.event_tier === EVENT_TIERS.ORBIT.key) return "editorial-roundup";
  return null;
}

// Preview Carousel used to send hook_a_side as the Topic. A listicle
// hook ("Discover surprising new gathering spots") then becomes the
// generation brief and the Fuel START names never reach the cover.
// Prefer the argument: a non-listicle hook, else POV, else a THESIS /
// START line, else the event name.
export function pickGenerationTopic(m = {}, event = {}) {
  const hookA = String(m.hook_a_side || "").trim();
  const typedPOV = String(m.editorial_pov || "").trim();
  const bullets = Array.isArray(m.data_points)
    ? m.data_points.map((b) => String(b || "").trim()).filter(Boolean)
    : [];
  if (hookA && !isListicleHook(hookA)) return hookA;
  if (typedPOV) return typedPOV.slice(0, 220);
  const fuel = bullets.find((b) => /^(?:THESIS|START)\s*—/i.test(b.replace(/^[-•*]\s+/, "")));
  if (fuel) return fuel.replace(/^(?:[-•*]\s+)?(?:THESIS|START)\s*—\s*/i, "").slice(0, 220);
  return hookA || String(event.name || "").trim() || "";
}

// Leftover event brands (AFROFEVER on a suburban-strip Feature) must
// not become the CTA keyword. Feature only keeps a trigger that already
// appears in the hook or POV.
export function pickKeywordTrigger(m = {}) {
  const trigger = String(m.keyword_trigger || "").trim();
  if (!trigger) return null;
  if (m.event_tier !== EVENT_TIERS.FEATURE.key) return trigger;
  const corpus = [m.hook_a_side, m.editorial_pov].join(" ").toLowerCase();
  if (corpus.includes(trigger.toLowerCase())) return trigger;
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
  const lock = buildSubjectLock({
    cluster: m.cluster,
    corridor: m.corridor,
    subjectFacets: m.subject_facets,
    corridorLocales: m.corridor_locales,
    joinFacet: m.join_facet,
  });
  const lockDirective = lockLensDirective(lock);
  // POV fallback: when the operator leaves Editorial POV blank, use the
  // cluster's brand-voice default POV from the Compass Bank so the Editor
  // pass has at least a thesis to work from. A facet lock parks that
  // default — Oldenburg must not leak into a social-friction piece.
  const typedPOV = String(m.editorial_pov || "").trim();
  const pov = typedPOV || (lock.facets.length ? "" : getClusterDefaultPOV(m.cluster));
  const bullets = Array.isArray(m.data_points)
    ? m.data_points.map((b) => String(b || "").trim()).filter(Boolean)
    : [];

  // Nothing to work with → let the caller open the modal empty.
  if (!hookA && !pov && !bullets.length) return null;

  // Topic is the argument, not a listicle hook. A leftover
  // "discover surprising gathering spots" line used to become the
  // generation brief and shred the Fuel START geography.
  const topic = pickGenerationTopic(m, event);

  // Context is structured: POV on top, then a blank line, then one
  // dashed bullet per data point. Consistent format across seed calls
  // means the prompt-assembly rules can rely on it later.
  //
  // The CLUSTER DIRECTIVE is NO LONGER embedded here — as of the
  // architectural override it gets its own top-level block in
  // buildTemplatePrompt (rendered after registerBlock, before context)
  // so it reads as a voice/framing constraint rather than one line
  // buried under academic research bullets. We surface it as its own
  // seed field instead.
  // Resolved LENS: base cluster directive + optional per-matrix
  // narrowing (matrix.editorial_lens). Base stays canonical; the
  // narrowing layers on top with a labeled clause.
  const { base: clusterDirectiveBase, override: lensOverride, combined: clusterDirective } = resolveEditorialLens({
    cluster: m.cluster,
    override: m.editorial_lens,
    base: lockDirective || undefined,
  });
  // clusterDirectiveBase is preserved as a distinct seed field so
  // downstream consumers (Perplexity, spine) can quote the base
  // separately from the narrowing when useful.
  void clusterDirectiveBase; void lensOverride;
  const clusterLabel = m.cluster ? (getClusterLabel(m.cluster) || m.cluster) : "";
  const contextLines = [];
  if (pov) contextLines.push(`POV: ${pov}`);
  if (!lock.empty) {
    contextLines.push(`SUBJECT LOCK: ${lock.summary}. Stay on these sub-versions. Do not mash overlapping cluster topics unless JOIN is named.`);
  }
  if (hookA && isListicleHook(hookA)) {
    contextLines.push(`OPERATOR HOOK (listicle — do not teach this; write the contrast the START / THESIS lines named): ${hookA}`);
  } else if (hookA && hookA !== topic) {
    contextLines.push(`OPERATOR HOOK: ${hookA}`);
  }
  if (bullets.length) {
    if (contextLines.length) contextLines.push("");
    for (const b of bullets) contextLines.push(`- ${b}`);
  }
  const context = contextLines.join("\n");

  return {
    topic,
    context,
    register: pickRegisterFromMatrix(m),   // → mode: promo | editorial | story | content | null
    templateId: pickTemplateFromMatrix(m), // → preset id | null
    // Feature stays on Editorial Insight. The Instagram arranger is
    // the hardcoded spine that cannot articulate a brief.
    arrange: m.event_tier !== EVENT_TIERS.FEATURE.key,
    // Cluster directive as its own field — buildTemplatePrompt renders it
    // as a top-level VOICE + FRAMING block, not a context footnote.
    clusterDirective,
    clusterLabel,
    // DM keyword trigger — if set, generateTemplateFill deterministically
    // stitches the final CTA slide with this token, bypassing LLM drift
    // that produces limp "link in bio" fallbacks when the trigger is
    // orphaned from the prompt.
    keywordTrigger: pickKeywordTrigger(m),
    // Voice parameters — Distance × Cadence × Stance. Passed to the
    // writer as its own directive block so the mode's register block
    // stays about ARC and these govern SENTENCE SHAPE + STANCE.
    // Empty strings when unset; the composer treats them as
    // "don't inject" and the writer falls back to mode alone.
    voiceParams: (() => {
      const isFeature = m.event_tier === EVENT_TIERS.FEATURE.key;
      const distance = String(m.voice_distance || "").trim() || (isFeature ? CONTENT_DEFAULT_VOICE.distance : null);
      const cadence = String(m.voice_cadence || "").trim() || (isFeature ? CONTENT_DEFAULT_VOICE.cadence : null);
      const stance = String(m.voice_stance || "").trim() || null;
      return { distance, cadence, stance };
    })(),
    // Behavioral tags — the operator's dimension picks, forwarded to
    // the writer as BEHAVIORAL CONSTRAINTS (not vocabulary). The
    // buildTemplatePrompt reader-facing block names them and forbids
    // literal quotation in the shipped copy.
    behavioralTags: {
      emotion: String(m.target_emotion || "").trim() || "",
      demographics: Array.isArray(m.target_demographic)
        ? m.target_demographic.filter(Boolean).map((d) => LEGACY_DEMOGRAPHIC_ALIASES[d] || d)
        : (typeof m.target_demographic === "string" && m.target_demographic.trim()
          ? m.target_demographic.split(",").map((d) => d.trim()).filter(Boolean)
          : []),
      clusterLabel,
    },
    // Feature-tier evergreen flag — when true, downstream
    // buildTemplatePrompt suppresses TIMELY ACTION + HISTORICAL
    // CONTEXT blocks and injects an EVERGREEN MANDATE that bans
    // specific dates and future-tense promo language across every
    // slide. Feature carousels are dateless by definition.
    isEvergreen: m.event_tier === EVENT_TIERS.FEATURE.key,
    // FEEDBACK MEMORY — carries previous Reject / Approve entries
    // for THIS matrix so the writer prompt can inject "don't
    // reproduce these failures" and "hold this bar" blocks. Each
    // entry is { at, reason?, digest: [{idx, type, digest}, ...] }.
    // Empty arrays when the matrix has no history.
    rejectedDrafts: Array.isArray(m.rejected_drafts) ? m.rejected_drafts.slice(-3) : [],
    approvedDrafts: Array.isArray(m.approved_drafts) ? m.approved_drafts.slice(-3) : [],
  };
}
// Reference DEMOGRAPHIC_PRESETS to keep the import for future use
// (typed narrowing on unknown demographics) without unused-var warns.
void DEMOGRAPHIC_PRESETS;
