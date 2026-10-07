import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useEventsStore, useCarouselSeedStore } from "../store.js";
import { AiTemplateFillModal } from "./AiTemplateFillModal.jsx";
import {
  EVENT_TIERS, EVENT_TIER_ORDER,
  CORRIDORS, LEGACY_CORRIDOR_ALIASES,
  EMOTIONS, DEMOGRAPHIC_PRESETS, LEGACY_DEMOGRAPHIC_ALIASES,
  PIPELINE_STATUS, PIPELINE_STATUS_ORDER,
  LIMITS,
} from "./matrixEnums.js";
import { classifySources, countSourceClasses, argumentDeskEmpty } from "./cgeSources.js";
import {
  DISTANCE_OPTIONS,
  CADENCE_OPTIONS,
  STANCE_OPTIONS,
  previewVoice,
  formatVoiceParamsLabel,
  getVoiceCompatWarning,
  detectHookVoiceClash,
} from "./voiceParams.js";
import {
  CONTENT_CLUSTER_LIST,
  resolveClusterKey,
  getClusterDirective,
  resolveEditorialLens,
  getClusterDefaultPOV,
  getVoicePreviewSubject,
  composePOV,
  synthesizeThesis,
  synthesizeHook,
  isListicleHook,
  checkArgumentCoherence,
  synthesizeLensReframe,
  COMPASS_TOPICS,
} from "./matrixCompass.js";
import {
  buildSubjectLock,
  sanitizeSubjectLock,
  facetsForCluster,
  localesForCorridor,
  joinFacetOptions,
  subjectLockPromptLines,
  lockLensDirective,
  getFacet,
} from "./subjectLock.js";
import { validateMatrix, matrixCompleteness, isMatrixReadyForGeneration } from "./matrixValidation.js";
import { eventMatrixToFillSeed } from "./eventMatrixToFillSeed.js";

// The Curatorial Matrix editor — dedicated modal (not inline in the row)
// per operator preference: matrix curation is deep editorial work that
// deserves its own surface, not a cramped edit row.
//
// Reads event.matrix from the store, writes via updateEventMatrix. Everything
// is optimistic: field changes hit local state immediately, server sync fires
// in the background. Save-and-close is implicit — the ✕ closes cleanly,
// nothing to explicitly submit.
//
// Feature tier: when selected, the "no calendar date" warning strip renders
// at top and the parent-form date/venue fields collapse (via onFeatureToggle
// callback if provided).
//
// Props:
//   open              — modal visibility
//   event             — the event being curated (must have `id`)
//   onClose           — dismiss
//   onFeatureToggle   — (isFeature) => void — parent can react to tier change

const cream = "#F5F0E8";
const muted = "rgba(245,240,232,0.58)";
const faint = "rgba(245,240,232,0.4)";
const whisper = "rgba(245,240,232,0.12)";
const hair = "rgba(245,240,232,0.06)";
const orbit = "#A78BFA";
const orbitBg = "rgba(167,139,250,0.14)";
const anchor = "#E5BC4F";
const anchorBg = "rgba(229,188,79,0.14)";
const feature = "#63B3ED";
const featureBg = "rgba(99,179,237,0.14)";
const ready = "#34D399";
const readyBg = "rgba(52,211,153,0.14)";
const warn = "#FBBF24";
const warnBg = "rgba(251,191,36,0.14)";

// Normalize target_demographic to an array regardless of what shape the
// persisted matrix has. Legacy records stored it as a comma-separated
// string; new records use string[]. Both flow through this one place so
// every consumer sees the same shape.
function normalizeDemographic(raw) {
  let list;
  if (Array.isArray(raw)) list = raw.map((s) => String(s || "").trim()).filter(Boolean);
  else if (typeof raw === "string" && raw.trim()) list = raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  else list = [];
  // Fold any legacy long-form label to its canonical short form so a
  // record saved before the Compass rename doesn't render a duplicate
  // chip next to its aliased twin.
  const aliased = list.map((v) => LEGACY_DEMOGRAPHIC_ALIASES[v] || v);
  return Array.from(new Set(aliased));
}

// Custom demographics the operator has typed in past sessions live in
// localStorage so they appear as presets on subsequent records. Keeps
// personal cultural vocabulary sticky without a store field.
const CUSTOM_DEMOGRAPHICS_KEY = "cge_matrix_custom_demographics";
function loadCustomDemographics() {
  try {
    const raw = localStorage.getItem(CUSTOM_DEMOGRAPHICS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch { return []; }
}
function saveCustomDemographic(value) {
  const clean = String(value || "").trim();
  if (!clean) return;
  try {
    const existing = loadCustomDemographics();
    if (existing.includes(clean)) return;
    if (DEMOGRAPHIC_PRESETS.includes(clean)) return; // already a built-in
    localStorage.setItem(CUSTOM_DEMOGRAPHICS_KEY, JSON.stringify([...existing, clean].slice(-20)));
  } catch {}
}

// Extract hostname for the sources strip so a wall of URLs collapses
// into a scannable "wikipedia.org · genius.com · ..." row.
function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

const groupLabelStyle = {
  fontSize: "0.62rem",
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: faint,
  marginBottom: 10,
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const labelStyle = {
  fontSize: "0.65rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: muted,
  fontWeight: 700,
  marginBottom: 6,
  display: "block",
};
const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  background: "#0e0e10",
  border: `1px solid ${whisper}`,
  borderRadius: 6,
  color: cream,
  fontFamily: "inherit",
  fontSize: "0.85rem",
  outline: "none",
  boxSizing: "border-box",
};
const selectStyle = { ...inputStyle, cursor: "pointer" };
const textareaStyle = { ...inputStyle, resize: "vertical", minHeight: 72, lineHeight: 1.5 };
const hintStyle = {
  fontSize: "0.66rem",
  color: faint,
  lineHeight: 1.5,
  marginTop: 4,
};

// Per-field char counter + limit-warning line under textareas.
function CharCounter({ current, max, error }) {
  const over = current > max;
  return (
    <div style={{
      fontSize: "0.62rem",
      color: over ? warn : (error ? warn : faint),
      textAlign: "right",
      marginTop: 4,
      fontVariantNumeric: "tabular-nums",
      letterSpacing: "0.04em",
    }}>
      {current} / {max}{over ? ` · trim ${current - max}` : ""}
    </div>
  );
}

function LockChipRow({ label, hint, options, selected, onToggle, accent, max = 3, optionLabel }) {
  if (!options.length) return null;
  const picked = Array.isArray(selected) ? selected : [];
  return (
    <div style={{ marginTop: label ? 8 : 4 }}>
      {label ? <div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {options.map((opt) => {
          const on = picked.includes(opt.id);
          const atCap = !on && max > 0 && picked.length >= max;
          return (
            <button
              key={opt.id}
              type="button"
              disabled={atCap}
              onClick={() => onToggle(opt.id)}
              title={opt.hint || opt.search || opt.label}
              style={{
                padding: "4px 10px",
                background: on ? accent.bg : "transparent",
                border: `1px solid ${on ? accent.border : whisper}`,
                color: on ? accent.color : muted,
                borderRadius: 999,
                fontFamily: "inherit",
                fontSize: "0.66rem",
                fontWeight: on ? 700 : 500,
                cursor: atCap ? "not-allowed" : "pointer",
                opacity: atCap ? 0.45 : 1,
              }}
            >{on ? (optionLabel ? optionLabel(opt) : opt.label) : `+ ${optionLabel ? optionLabel(opt) : opt.label}`}</button>
          );
        })}
      </div>
      {hint ? <div style={hintStyle}>{hint}</div> : null}
    </div>
  );
}

export function CuratorialMatrixModal(props) {
  if (!props.open || !props.event) return null;
  return <CuratorialMatrixModalContent {...props} />;
}

function CuratorialMatrixModalContent({ open, event, onClose, onFeatureToggle, apiKey = "", onAiFillAccept = null }) {
  const updateEventMatrix = useEventsStore((s) => s.updateEventMatrix);
  const upsertEvent = useEventsStore((s) => s.upsertEvent);
  const syncError = useEventsStore((s) => s.syncError);
  const setCarouselSeed = useCarouselSeedStore((s) => s.setSeed);
  const navigate = useNavigate();

  // Fuel Research (Perplexity) state — one research call at a time,
  // errors and citations render inline in the Research Anchors group so the
  // operator can vet sources before adding.
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState(null);
  const [citations, setCitations] = useState([]);
  // Two-phase research status — set from the last successful Fuel Research
  // call. phase is "verified" (Phase 2 approved these bullets) or
  // "hypothesis-only" (Phase 2 failed, these are unverified Phase 1
  // candidates). droppedCount is how many Phase 1 candidates Phase 2
  // rejected. Rendered as a small status line above the citations strip.
  const [researchPhase, setResearchPhase] = useState(null);
  const [researchDroppedCount, setResearchDroppedCount] = useState(0);
  const [researchVerificationError, setResearchVerificationError] = useState(null);
  const [researchSources, setResearchSources] = useState([]);
  const [researchDesks, setResearchDesks] = useState(null);
  const [officialEmpty, setOfficialEmpty] = useState(false);
  const [culturalEmpty, setCulturalEmpty] = useState(false);
  // Entity overlap warnings — set from server-side detectEntityOverlap.
  // Each entry: { entity: "village brewing", bulletIndices: [0, 1, 2] }.
  // Rendered as an amber warning under the Research Anchors so the
  // operator can cull collapsed-carousel duplicates before shipping.
  //
  // Offset tracker: overlap indices are relative to the JUST-RECEIVED
  // Perplexity payload, but bullets get APPENDED to any existing
  // anchors (0..existing.length-1 already there before this call).
  // We snapshot the offset when the response lands so the rendered
  // warning points at the right rows in the current list.
  const [overlaps, setOverlaps] = useState([]);
  const [overlapOffset, setOverlapOffset] = useState(0);

  // Draft Thesis (Gemini Flash-Lite) state — synthesizes the four
  // matrix dimensions into a real editorial thesis instead of the
  // deterministic fragment paste. Runs on explicit click only, never
  // auto-fires. Errors render inline near the POV textarea.
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthError, setSynthError] = useState(null);

  // Draft Hook (Gemini Flash-Lite) state — writes the Instagram-cover
  // A-side hook from Editorial POV + Fuel START lines. Explicit
  // click only; errors render inline near the hook_a_side field.
  const [draftingHook, setDraftingHook] = useState(false);
  const [hookError, setHookError] = useState(null);

  // ─── SYNTHESIS SNAPSHOTS (staleness detection) ────────────────
  // The matrix looks like a top-down cascade in the UI (Cluster →
  // LENS → POV → Hook → Anchors) but the actual data-flow is
  // OPT-IN RE-SYNTHESIS: each synth button (Reframe LENS, Draft
  // Thesis, Draft Hook, Fuel Research) reads a specific set of
  // upstream fields and writes ONE downstream field. Nothing auto-
  // cascades — a downstream field just goes stale silently when an
  // upstream field changes after synthesis.
  //
  // These refs record the input signature at the moment each synth
  // succeeded. Rendering compares current inputs to the snapshot and
  // marks the derived field STALE when they diverge. The operator
  // sees a small chip that says either "◇ synthesized from …" or
  // "⚠ STALE — inputs changed, resynthesize."
  //
  // In-modal state (not persisted): survives edits during one open
  // session; resets on modal close. That's fine — staleness is a
  // now-signal, not a durable record.
  const [lensSnapshot, setLensSnapshot] = useState(null);
  const [thesisSnapshot, setThesisSnapshot] = useState(null);
  const [hookSnapshot, setHookSnapshot] = useState(null);
  const [researchSnapshot, setResearchSnapshot] = useState(null);
  const stringifyInputs = (obj) => JSON.stringify(obj || {});

  // Argument Coherence check (Gemini Flash-Lite) state — adversarial
  // pre-generation critic. Reads hook + POV + anchors and returns
  // verdict: "coherent" | "thin" | "mismatched" + gaps.
  // Explicit click only (auto-runs cost too much on every keystroke);
  // rerun any time the operator has edited enough of the matrix to
  // want another read.
  const [checkingCoherence, setCheckingCoherence] = useState(false);
  const [coherenceResult, setCoherenceResult] = useState(null);
  const [coherenceError, setCoherenceError] = useState(null);
  // Track which matrix inputs the last coherence check was run on —
  // if any of them change, the result is stale and we mark it so.
  const [coherenceCheckedAt, setCoherenceCheckedAt] = useState(null);
  // Declare the matrix before any derived hooks read it. The coherence
  // check below runs during render, so `local` and `bullets` must already
  // be initialized here.
  const [local, setLocal] = useState(() => ({ ...(event?.matrix || {}) }));
  const bullets = Array.isArray(local.data_points) ? local.data_points : [];
  // Demographics are stored on the matrix as an array; normalize legacy
  // comma-string values before staleness memos read the selection.
  const selectedDemographics = normalizeDemographic(local.target_demographic);
  const selectedFacets = Array.isArray(local.subject_facets)
    ? local.subject_facets.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const selectedLocales = Array.isArray(local.corridor_locales)
    ? local.corridor_locales.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const selectedJoin = String(local.join_facet || "").trim();
  const facetsKey = selectedFacets.join("|");
  const localesKey = selectedLocales.join("|");
  const subjectLock = useMemo(() => buildSubjectLock({
    cluster: local.cluster,
    corridor: local.corridor,
    subjectFacets: facetsKey ? facetsKey.split("|") : [],
    corridorLocales: localesKey ? localesKey.split("|") : [],
    joinFacet: selectedJoin,
  }), [local.cluster, local.corridor, facetsKey, localesKey, selectedJoin]);
  const subjectLockPrompt = useMemo(
    () => ({ promptLines: subjectLockPromptLines(subjectLock), summary: subjectLock.summary, empty: subjectLock.empty }),
    [subjectLock]
  );
  // Live LENS this piece sees. A picked facet replaces the cluster
  // syllabus so Draft Hook cannot recite every theory on the chip row.
  const liveLens = useMemo(
    () => lockLensDirective(subjectLock) || getClusterDirective(local.cluster),
    [subjectLock, local.cluster]
  );
  const coherenceIsStale = useMemo(() => {
    if (!coherenceResult || !coherenceCheckedAt) return false;
    const sig = `${local.hook_a_side || ""}|${local.editorial_pov || ""}|${bullets.join("|")}`;
    return sig !== coherenceCheckedAt;
  }, [coherenceResult, coherenceCheckedAt, local.hook_a_side, local.editorial_pov, bullets]);

  // Voice Preview (Gemini Flash-Lite) state — renders one sample
  // paragraph in the current voice-params combination so the operator
  // can hear the voice before generating a full carousel. Explicit
  // click only. Preview text renders inline below the dropdowns; new
  // clicks replace it. Errors render inline in the same slot.
  const [previewingVoice, setPreviewingVoice] = useState(false);
  const [voicePreviewText, setVoicePreviewText] = useState("");
  const [voicePreviewError, setVoicePreviewError] = useState(null);
  const [voicePreviewFor, setVoicePreviewFor] = useState(""); // labels which combo the preview shows

  // AI Fill overlay — window collapse. When true, the AI Fill modal
  // opens ON TOP of this matrix modal (compact mode: 4 controls hidden,
  // 4 stay visible). Matrix stays visible behind the overlay, non-
  // interactive while overlay is open. Replaces the old navigate-to-
  // /media hand-off.
  const [aiFillOverlayOpen, setAiFillOverlayOpen] = useState(false);
  const [aiFillOverlaySeed, setAiFillOverlaySeed] = useState(null);

  // Reframe LENS (Gemini Flash-Lite) state — layers a per-matrix
  // narrowing over the cluster's base directive. Explicit click only.
  // The reframed text lands in matrix.editorial_lens (editable
  // textarea); the base directive stays canonical in matrixCompass.js.
  const [reframingLens, setReframingLens] = useState(false);
  const [lensReframeError, setLensReframeError] = useState(null);
  // Snapshot of data_points BEFORE the last research call, so a bad
  // Fuel Research (off-topic bullets) can be discarded in one tap.
  const [preResearchSnapshot, setPreResearchSnapshot] = useState(null);
  // Sources panel starts collapsed — 8 URLs stacked vertically was a
  // wall of text. Operator expands with the toggle.
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  // Inline name edit — click the header title to rename. `null` = not
  // editing; a string = the pending edit buffer.
  const [nameEdit, setNameEdit] = useState(null);

  // 🧭 Topic Compass — collapsed by default so the modal doesn't get
  // taller than the operator's screen. Click to expand a seed-topic
  // shelf; clicking a seed one-shots cluster/corridor/hook/emotion/
  // demographic into the local matrix.
  const [compassOpen, setCompassOpen] = useState(false);

  // Demographic multi-select state — presets are static, custom values
  // load from localStorage and grow via + Add Custom.
  const [customDemographics, setCustomDemographics] = useState(() => loadCustomDemographics());
  const [demographicInput, setDemographicInput] = useState("");
  const [addingDemographic, setAddingDemographic] = useState(false);

  // Local mirror of matrix values so typing is snappy — we push each
  // change to the store on blur/select rather than every keystroke, and
  // sync back if the store's matrix changes from underneath us (e.g.
  // another device edits it).
  useEffect(() => {
    setLocal({ ...(event?.matrix || {}) });
    setResearchError(null);
    setCitations([]);
    setResearchSources([]);
    setResearchDesks(null);
    setOfficialEmpty(false);
    setCulturalEmpty(false);
    setPreResearchSnapshot(null);
    setSourcesExpanded(false);
    setNameEdit(null);
    setDemographicInput("");
    setAddingDemographic(false);
    setCompassOpen(false);
    setSynthError(null);
    setSynthesizing(false);
    setHookError(null);
    setDraftingHook(false);
    setLensReframeError(null);
    setReframingLens(false);
    setVoicePreviewText("");
    setVoicePreviewError(null);
    setVoicePreviewFor("");
    setPreviewingVoice(false);
  }, [event?.id]);

  const applyPatch = (patch) => {
    setLocal((prev) => ({ ...prev, ...patch }));
    // Keep the updater pure: React may replay it while rendering.
    const clean = { ...patch };
    for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
    updateEventMatrix(event.id, clean);
  };

  const tier = local.event_tier || null;
  const isFeature = tier === "FEATURE";
  const status = local.pipeline_status || PIPELINE_STATUS.DRAFT.key;

  const completeness = useMemo(() => matrixCompleteness(local), [local]);
  const readyValidation = useMemo(
    () => validateMatrix(local, { targetStatus: PIPELINE_STATUS.READY.key }),
    [local]
  );
  const errorsByField = useMemo(() => {
    const m = {};
    for (const e of readyValidation.errors) m[e.field] = e.message;
    return m;
  }, [readyValidation]);

  // Hook × Voice tone-clash warning — soft check that fires when the hook
  // asks for one linguistic register (hype / poetic / question / intimate)
  // and the voice params ask for another. Pure heuristic — no LLM. Fires
  // BEFORE generation so the operator adjusts either the hook or the
  // voice combo, not after.
  const hookClash = useMemo(() => detectHookVoiceClash({
    hook: local.hook_a_side,
    cadence: local.voice_cadence,
    stance: local.voice_stance,
    distance: local.voice_distance,
  }), [local.hook_a_side, local.voice_cadence, local.voice_stance, local.voice_distance]);

  // Keyword-trigger semantic warning — soft check that fires when the DM
  // trigger word looks disconnected from the piece's topic. Rationale: the
  // trigger appears on the CTA slide ("Comment 'X' below") and must FEEL
  // like it belongs to the story or the reader hesitates to type it.
  //
  // Pure derived value — no network. Heuristic: the trigger is "connected"
  // when it appears as a substring of the topic corpus (hook + event name)
  // OR shares a 4+ character token with it. Otherwise, warn softly.
  const triggerWarning = useMemo(() => {
    const trigger = String(local.keyword_trigger || "").trim().toUpperCase();
    if (!trigger || trigger.length < 3) return null;
    const corpus = [local.hook_a_side, event?.name, local.editorial_pov]
      .filter(Boolean)
      .map((s) => String(s).toUpperCase())
      .join(" ");
    if (!corpus) return null;
    if (corpus.includes(trigger)) return null;
    const tokens = corpus.match(/[A-Z]{4,}/g) || [];
    const overlap = tokens.some((t) => t === trigger || t.includes(trigger) || trigger.includes(t));
    if (overlap) return null;
    return `“${trigger}” doesn't echo the topic — the CTA reads “Comment ‘${trigger}’ below” and readers hesitate to type words that feel disconnected. Consider one that lifts a core word from the hook or event name.`;
  }, [local.keyword_trigger, local.hook_a_side, local.editorial_pov, event?.name]);

  // ─── STALENESS MEMOS (derived-field freshness) ────────────────
  // Compare each synthesizer's stored snapshot against current
  // matrix values. When any input has changed since the synth
  // ran, the derived field is stale and the UI flashes a marker.
  //
  // Same-shape signatures for cheap diff.
  const lensStale = useMemo(() => {
    if (!lensSnapshot) return false;
    return stringifyInputs({
      cluster: local.cluster,
      corridor: local.corridor,
      emotion: local.target_emotion,
      demographics: [...selectedDemographics].sort(),
      lock: subjectLock.snapshot,
    }) !== stringifyInputs(lensSnapshot);
  }, [lensSnapshot, local.cluster, local.corridor, local.target_emotion, selectedDemographics, subjectLock.snapshot]);

  const thesisStale = useMemo(() => {
    if (!thesisSnapshot) return false;
    return stringifyInputs({
      cluster: local.cluster,
      corridor: local.corridor,
      emotion: local.target_emotion,
      demographics: [...selectedDemographics].sort(),
      editorial_lens: local.editorial_lens || "",
      lock: subjectLock.snapshot,
    }) !== stringifyInputs(thesisSnapshot);
  }, [thesisSnapshot, local.cluster, local.corridor, local.target_emotion, selectedDemographics, local.editorial_lens, subjectLock.snapshot]);

  const hookStale = useMemo(() => {
    if (!hookSnapshot) return false;
    return stringifyInputs({
      cluster: local.cluster,
      pov: local.editorial_pov,
      emotion: local.target_emotion,
      demographics: [...selectedDemographics].sort(),
      editorial_lens: local.editorial_lens || "",
      lock: subjectLock.snapshot,
    }) !== stringifyInputs(hookSnapshot);
  }, [hookSnapshot, local.cluster, local.editorial_pov, local.target_emotion, selectedDemographics, local.editorial_lens, subjectLock.snapshot]);

  const researchStale = useMemo(() => {
    if (!researchSnapshot) return false;
    return stringifyInputs({
      cluster: local.cluster,
      corridor: local.corridor,
      pov: local.editorial_pov,
      hook: local.hook_a_side,
      tier: local.event_tier,
      editorial_lens: local.editorial_lens,
      demographics: [...selectedDemographics].sort(),
      lock: subjectLock.snapshot,
    }) !== stringifyInputs(researchSnapshot);
  }, [researchSnapshot, local.cluster, local.corridor, local.editorial_pov, local.hook_a_side, local.event_tier, local.editorial_lens, selectedDemographics, subjectLock.snapshot]);

  // Compact chip renderer — one line per derived field.
  //   fresh: shows "◇ synthesized from X · Y · Z" in muted color
  //   stale: shows "⚠ STALE — inputs changed since synthesis" in warn color
  //   never-synthesized: null (chip doesn't render at all)
  const renderStalenessChip = (label, snapshot, isStale, inputsLabel) => {
    if (!snapshot) return null;
    return (
      <div style={{
        fontSize: "0.6rem",
        marginTop: 4,
        letterSpacing: "0.03em",
        color: isStale ? warn : faint,
        lineHeight: 1.5,
      }}>
        {isStale
          ? `⚠ STALE — ${inputsLabel} changed since ${label} was synthesized · re-run to refresh`
          : `◇ ${label} synthesized from ${inputsLabel}`}
      </div>
    );
  };

  // Live entity-overlap detector — runs on the FULL bullet list so
  // both typed and Perplexity-returned anchors get checked. Same
  // heuristic as the server-side detectEntityOverlap: extract
  // 2-5-word Title-Case proper-noun phrases, filter geographic
  // containers, group by shared entity. When 2+ bullets share an
  // entity, render a warning under the Research Anchors panel.
  //
  // This supersedes the server-only overlaps state for the display —
  // the operator sees warnings whether they typed the anchors, ran
  // Fuel Research, or mixed both. The server-side overlaps state is
  // still used for the first render immediately after a Fuel
  // Research call (before this memo has rerun).
  const GEO_STOPS = new Set([
    "new jersey", "central jersey", "north jersey", "south jersey",
    "downtown somerville", "downtown newark", "downtown asbury park",
    "asbury park", "jersey city", "atlantic city", "long branch",
    "asbury boardwalk", "the boardwalk",
  ]);
  const liveOverlaps = useMemo(() => {
    if (!Array.isArray(bullets) || bullets.length < 2) return [];
    const entityToIndices = {};
    bullets.forEach((raw, i) => {
      const text = String(raw || "");
      const matches = text.match(/\b[A-Z][a-z0-9]+(?:\s+(?:[A-Z][a-z0-9]+|of|at|on|the|and|&)){1,4}\b/g) || [];
      const inThis = new Set();
      for (const m of matches) {
        const norm = m.toLowerCase().trim();
        if (GEO_STOPS.has(norm)) continue;
        if (norm.split(/\s+/).length < 2) continue;
        inThis.add(norm);
      }
      for (const e of inThis) {
        if (!entityToIndices[e]) entityToIndices[e] = [];
        entityToIndices[e].push(i);
      }
    });
    const out = [];
    for (const [entity, indices] of Object.entries(entityToIndices)) {
      if (indices.length >= 2) out.push({ entity, bulletIndices: indices });
    }
    out.sort((a, b) => b.bulletIndices.length - a.bulletIndices.length);
    return out;
  }, [bullets]);

  // Handlers
  const setTier = (key) => {
    applyPatch({ event_tier: key });
    if (onFeatureToggle) onFeatureToggle(key === "FEATURE");
  };
  const setStatus = (key) => {
    // Ready-gate: if switching to READY, only allow when validation passes
    if (key === PIPELINE_STATUS.READY.key && !readyValidation.ok) return;
    applyPatch({ pipeline_status: key });
  };
  const setBullet = (i, val) => {
    const next = [...bullets];
    next[i] = val;
    applyPatch({ data_points: next });
  };
  const addBullet = () => {
    if (bullets.length >= LIMITS.BULLETS_MAX) return;
    applyPatch({ data_points: [...bullets, ""] });
  };
  const removeBullet = (i) => {
    const next = bullets.filter((_, idx) => idx !== i);
    applyPatch({ data_points: next });
  };

  // Fuel Research — calls the server's /api/matrix/research endpoint,
  // which relays to Perplexity's web-grounded Agent API. Response bullets append to
  // data_points (up to BULLETS_MAX cap); citations render below the
  // list so the operator can vet before shipping. Errors surface inline.
  const fuelResearch = async (mode = "full") => {
    if (researching) return;
    // Snapshot the bullets we have now so a bad research can be undone
    // in one tap via the sources strip's ↺ Discard button.
    setPreResearchSnapshot(bullets);
    setResearching(true);
    setResearchError(null);
    try {
      const sendGaps = mode === "gap-scout";
      const r = await fetch("/api/matrix/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cluster: local.cluster || "",
          topic: (local.hook_a_side && !isListicleHook(local.hook_a_side)
            ? local.hook_a_side
            : "") || local.editorial_pov || event?.name || "",
          pov: local.editorial_pov || "",
          existingBullets: bullets,
          tier: local.event_tier || "",
          corridor: local.corridor || "",
          // Demographics get injected into Perplexity's system prompt
          // so the target audience becomes a research constraint, not
          // an afterthought applied at write time. This is what stops
          // Sonar from returning B2B real-estate metrics for a matrix
          // whose actual audience is Young Working Professionals.
          demographics: selectedDemographics,
          // LENS override — the per-matrix narrowing that layers under
          // the base cluster directive. Empty = server uses the base
          // alone (backwards-compat).
          lensOverride: local.editorial_lens || "",
          subjectFacets: selectedFacets,
          corridorLocales: selectedLocales,
          joinFacet: selectedJoin,
          coherenceGaps: sendGaps && Array.isArray(coherenceResult?.gaps) ? coherenceResult.gaps : [],
          coherenceReason: sendGaps ? (coherenceResult?.reason || "") : "",
          mode,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResearchError(j.message || j.error || `Server ${r.status}`);
        return;
      }
      const incoming = Array.isArray(j.bullets) ? j.bullets : [];
      if (!incoming.length) {
        setResearchError("No starting points returned. Try a sharper New Jersey hook.");
        return;
      }
      let merged;
      if (mode === "dive") {
        merged = incoming.slice(0, LIMITS.BULLETS_MAX);
      } else if (mode === "gap-scout") {
        // Make room for the new pieces — do not slice them off
        // because the desk is already full of history.
        const keep = Math.max(0, LIMITS.BULLETS_MAX - incoming.length);
        merged = [...bullets.slice(0, keep), ...incoming].slice(0, LIMITS.BULLETS_MAX);
      } else {
        merged = [...bullets, ...incoming].slice(0, LIMITS.BULLETS_MAX);
      }
      const thesisLine = typeof j.thesis === "string" ? j.thesis.trim() : "";
      const patch = { data_points: merged };
      if (mode !== "gap-scout" && thesisLine && !(local.editorial_pov || "").trim()) {
        patch.editorial_pov = thesisLine.slice(0, LIMITS.POV_MAX);
      }
      applyPatch(patch);
      const incomingCitations = Array.isArray(j.citations) ? j.citations.slice(0, 12) : [];
      setCitations(incomingCitations);
      const classified = Array.isArray(j.sources) && j.sources.length
        ? j.sources
        : classifySources(incomingCitations);
      setResearchSources(classified);
      setResearchDesks(j.desks && typeof j.desks === "object" ? j.desks : null);
      const classCounts = countSourceClasses(classified);
      setOfficialEmpty(!!j.officialEmpty || classCounts.OFFICIAL === 0);
      setCulturalEmpty(!!j.culturalEmpty || argumentDeskEmpty(classified));
      setResearchPhase(typeof j.phase === "string" ? j.phase : null);
      setResearchDroppedCount(typeof j.droppedCount === "number" ? j.droppedCount : 0);
      setResearchVerificationError(typeof j.verificationError === "string" ? j.verificationError : null);
      // Overlap offset = number of anchors already present BEFORE this
      // append. The server's overlap indices are 0-based against the
      // just-returned payload; add the offset to point at the rendered
      // rows in the current list.
      setOverlapOffset(bullets.length);
      setOverlaps(Array.isArray(j.overlaps) ? j.overlaps : []);
      // Snapshot Fuel Research inputs so staleness detector flags
      // the anchors when the operator later changes cluster / POV /
      // hook / demographic / lens / tier after research was fetched.
      setResearchSnapshot({
        cluster: local.cluster,
        corridor: local.corridor,
        pov: local.editorial_pov,
        hook: local.hook_a_side,
        tier: local.event_tier,
        editorial_lens: local.editorial_lens,
        demographics: [...selectedDemographics].sort(),
        lock: subjectLock.snapshot,
      });
    } catch (err) {
      setResearchError(String(err?.message || err));
    } finally {
      setResearching(false);
    }
  };

  // Undo the last Fuel Research call — restores the bullet list to
  // the snapshot taken before we appended AI-returned bullets, and
  // clears the citations panel. Useful when Sonar returns off-topic
  // results (see the "Let Me Know" incident that spawned this button).
  const discardResearch = () => {
    if (preResearchSnapshot == null) return;
    applyPatch({ data_points: preResearchSnapshot });
    setPreResearchSnapshot(null);
    setCitations([]);
    setResearchSources([]);
    setResearchDesks(null);
    setOfficialEmpty(false);
    setCulturalEmpty(false);
    setResearchError(null);
    setResearchPhase(null);
    setResearchDroppedCount(0);
    setResearchVerificationError(null);
    setOverlaps([]);
    setOverlapOffset(0);
  };

  // Resolve the Gemini API key the same way MediaTool + ReviewQueue do:
  // env var first (for local dev), then localStorage. Kept inline so
  // this modal doesn't require a new plumbing prop from its two
  // mount sites (MediaTool + ReviewQueue). Empty string when neither
  // is set — the Draft Thesis button surfaces a clear error in that
  // case rather than firing.
  const resolveGeminiKey = () => {
    let envKey = "";
    try { envKey = (import.meta.env.VITE_GEMINI_API_KEY || "").trim(); } catch { /* SSR / no import.meta */ }
    if (envKey) return envKey;
    try { return localStorage.getItem("cge_gemini_key") || ""; } catch { return ""; }
  };

  // Draft Thesis handler — fires Gemini Flash-Lite to synthesize the
  // four matrix dimensions into a real editorial POV. Explicit-click
  // only. Overwrites whatever's in the field (button IS the "replace
  // what I have" gesture) and updates lastAutoPOVRef so the
  // deterministic composer's freeze rule stays intact — if the
  // operator then edits the synthesized POV, subsequent dropdown
  // changes won't overwrite it.
  const draftThesis = async () => {
    if (synthesizing) return;
    setSynthError(null);
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      setSynthError("Paste your Gemini API key in the MediaTool toolbar first.");
      return;
    }
    const clusterKey = resolveClusterKey(local.cluster);
    if (!clusterKey) {
      setSynthError("Pick a Content Cluster first — it anchors the LENS the synthesizer works through.");
      return;
    }
    setSynthesizing(true);
    try {
      const thesis = await synthesizeThesis({
        apiKey,
        cluster: local.cluster,
        corridor: local.corridor,
        emotion: local.target_emotion,
        demographics: selectedDemographics,
        editorialLens: local.editorial_lens,
        subjectLock: subjectLockPrompt,
        lensBase: liveLens,
      });
      if (!thesis) {
        setSynthError("Gemini returned an empty thesis. Retry.");
        return;
      }
      lastAutoPOVRef.current = thesis;
      applyPatch({ editorial_pov: thesis });
      // Snapshot the exact inputs this synth ran on — staleness
      // detector compares current values to this and flashes STALE
      // when any change.
      setThesisSnapshot({
        cluster: local.cluster,
        corridor: local.corridor,
        emotion: local.target_emotion,
        demographics: [...selectedDemographics].sort(),
        editorial_lens: local.editorial_lens || "",
        lock: subjectLock.snapshot,
      });
    } catch (err) {
      setSynthError(String(err?.message || err));
    } finally {
      setSynthesizing(false);
    }
  };

  // Draft Hook handler — compresses POV + Fuel START lines into a
  // cover that names the NJ contrast the brief already proved.
  // Requires both a cluster AND a POV;
  // surfaces clear errors when either is missing so the operator
  // knows exactly what to fill in first.
  const draftHook = async () => {
    if (draftingHook) return;
    setHookError(null);
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      setHookError("Paste your Gemini API key in the MediaTool toolbar first.");
      return;
    }
    const clusterKey = resolveClusterKey(local.cluster);
    if (!clusterKey) {
      setHookError("Pick a Content Cluster first — the LENS anchors the hook synthesis.");
      return;
    }
    if (!String(local.editorial_pov || "").trim()) {
      setHookError("Draft or write an Editorial POV first — the hook is the POV compressed into a scroll-stopper.");
      return;
    }
    setDraftingHook(true);
    try {
      const hook = await synthesizeHook({
        apiKey,
        cluster: local.cluster,
        pov: local.editorial_pov,
        emotion: local.target_emotion,
        demographics: selectedDemographics,
        editorialLens: local.editorial_lens,
        anchors: bullets,
        subjectLock: subjectLockPrompt,
        lensBase: liveLens,
      });
      if (!hook) {
        setHookError("Gemini returned an empty hook. Retry.");
        return;
      }
      applyPatch({ hook_a_side: hook });
      setHookSnapshot({
        cluster: local.cluster,
        pov: local.editorial_pov,
        emotion: local.target_emotion,
        demographics: [...selectedDemographics].sort(),
        editorial_lens: local.editorial_lens || "",
        lock: subjectLock.snapshot,
      });
    } catch (err) {
      setHookError(String(err?.message || err));
    } finally {
      setDraftingHook(false);
    }
  };

  // Check Argument Coherence handler — adversarial pre-generation
  // critic that reads hook + POV + anchors and returns whether the
  // material can actually support the argument. Answers the
  // operator's core anxiety: "if the AI cannot put the pieces
  // together, that needs to be flagged BEFORE the carousel is
  // generated." Fires as an explicit click (Flash-Lite is cheap
  // enough that we could auto-run, but on-demand keeps API cost
  // predictable and gives the operator a clear "I checked" moment).
  const runCoherenceCheck = async () => {
    if (checkingCoherence) return;
    setCoherenceError(null);
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      setCoherenceError("Paste your Gemini API key in the MediaTool toolbar first.");
      return;
    }
    const cleanHook = String(local.hook_a_side || "").trim();
    const cleanPOV = String(local.editorial_pov || "").trim();
    const cleanAnchors = bullets.filter(Boolean);
    if (!cleanHook || !cleanPOV || cleanAnchors.length < 2) {
      setCoherenceError("Fill in Hook A-side, Editorial POV, and at least 2 Research Anchors first — those are what the check reads.");
      return;
    }
    setCheckingCoherence(true);
    try {
      // Pass the RESOLVED cluster directive (base + operator narrowing
      // combined) so the coherence critic evaluates the argument against
      // the whole lens, not just the cluster's base directive. Without
      // this, typing a narrowing into LENS did nothing at check time.
      const resolvedLens = resolveEditorialLens({ cluster: local.cluster, override: local.editorial_lens, base: liveLens });
      const result = await checkArgumentCoherence({
        apiKey,
        hook: cleanHook,
        pov: cleanPOV,
        anchors: cleanAnchors,
        cluster: local.cluster,
        clusterDirective: resolvedLens.combined || resolvedLens.base,
      });
      if (!result) {
        setCoherenceError("Coherence check returned no verdict — Gemini may be rate-limited. Retry.");
        return;
      }
      setCoherenceResult(result);
      // Snapshot the signature of the inputs the check ran on so the
      // UI can mark the result stale if the operator edits after.
      setCoherenceCheckedAt(`${cleanHook}|${cleanPOV}|${cleanAnchors.join("|")}`);
    } catch (err) {
      setCoherenceError(String(err?.message || err));
    } finally {
      setCheckingCoherence(false);
    }
  };

  // Reframe LENS handler — Gemini narrows the base cluster directive
  // through the operator's current picks and drops the result into
  // matrix.editorial_lens. The base directive stays canonical; this
  // just LAYERS a narrowing on top. Editable inline after fill.
  const reframeLens = async () => {
    if (reframingLens) return;
    setLensReframeError(null);
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      setLensReframeError("Paste your Gemini API key in the MediaTool toolbar first.");
      return;
    }
    const clusterKey = resolveClusterKey(local.cluster);
    if (!clusterKey) {
      setLensReframeError("Pick a Content Cluster first — the base LENS is what the reframe narrows.");
      return;
    }
    setReframingLens(true);
    try {
      const reframe = await synthesizeLensReframe({
        apiKey,
        cluster: local.cluster,
        corridor: local.corridor,
        emotion: local.target_emotion,
        demographics: selectedDemographics,
        subjectLock: subjectLockPrompt,
        lensBase: liveLens,
      });
      if (!reframe) {
        setLensReframeError("Gemini returned an empty reframe. Retry.");
        return;
      }
      applyPatch({ editorial_lens: reframe });
      setLensSnapshot({
        cluster: local.cluster,
        corridor: local.corridor,
        emotion: local.target_emotion,
        demographics: [...selectedDemographics].sort(),
        lock: subjectLock.snapshot,
      });
    } catch (err) {
      setLensReframeError(String(err?.message || err));
    } finally {
      setReframingLens(false);
    }
  };

  // Voice Preview handler — renders one sample paragraph in the
  // current Distance × Cadence [× Stance] combination so the
  // operator can hear the voice before generating a full carousel.
  // Requires both Distance AND Cadence. Stance optional. Uses a
  // fixed neutral subject so previews across combos compare
  // like-for-like.
  const runVoicePreview = async () => {
    if (previewingVoice) return;
    setVoicePreviewError(null);
    const apiKey = resolveGeminiKey();
    if (!apiKey) {
      setVoicePreviewError("Paste your Gemini API key in the MediaTool toolbar first.");
      return;
    }
    if (!local.voice_distance || !local.voice_cadence) {
      setVoicePreviewError("Pick a Distance AND a Cadence first — those are what the preview demonstrates.");
      return;
    }
    setPreviewingVoice(true);
    try {
      const paragraph = await previewVoice({
        apiKey,
        distance: local.voice_distance,
        cadence: local.voice_cadence,
        stance: local.voice_stance,
        // Cluster-driven subject: the preview grips on THIS piece's
        // terrain (a hi-fi listening room for Nightlife, a council
        // chamber for Policy, a strip-mall coffee shop for Suburban
        // Third-Place) instead of always demoing a generic music
        // room. Falls back inside previewVoice when cluster is unset.
        subject: getVoicePreviewSubject(local.cluster),
      });
      if (!paragraph) {
        setVoicePreviewError("Gemini returned an empty preview. Retry.");
        return;
      }
      setVoicePreviewText(paragraph);
      setVoicePreviewFor(formatVoiceParamsLabel({
        distance: local.voice_distance,
        cadence: local.voice_cadence,
        stance: local.voice_stance,
      }));
    } catch (err) {
      setVoicePreviewError(String(err?.message || err));
    } finally {
      setPreviewingVoice(false);
    }
  };

  // Demographic chip helpers.
  const setDemographics = (arr) => applyPatch({ target_demographic: arr });

  // ─── Compositional POV pre-fill ───────────────────────────────────
  // The Editorial POV textarea should feel alive: it moves as the
  // operator changes cluster, corridor, emotion, or demographic —
  // because each dimension carries a fragment of the thesis and the
  // whole point of the matrix is that the combination is the pick.
  //
  // Contract: we ONLY auto-fill when the current POV is either empty
  // or matches a POV WE last auto-filled. The moment the operator
  // types anything of their own, we freeze — never overwrite a real
  // editorial POV with a machine-composed one.
  //
  // Legacy compat: on mount, treat a stored POV that equals the old
  // cluster-only default (getClusterDefaultPOV) as an auto-fill too,
  // so records seeded by the previous code start recomposing when the
  // operator wiggles Corridor/Emotion/Demographic.
  const lastAutoPOVRef = useRef(null);
  const initialPOV = String(local.editorial_pov || "").trim();
  // If lastAutoPOVRef hasn't been seeded yet this event, seed it from
  // legacy cluster-default so an old auto-fill counts as "ours".
  if (lastAutoPOVRef.current === null) {
    const legacyDefault = getClusterDefaultPOV(local.cluster);
    lastAutoPOVRef.current = (legacyDefault && legacyDefault === initialPOV) ? initialPOV : "";
  }
  // Reset the ref when the caller swaps to a different event —
  // otherwise Event A's typed POV could look like Event B's auto POV.
  useEffect(() => {
    lastAutoPOVRef.current = null;
  }, [event?.id]);

  const demographicsKey = selectedDemographics.join("|");
  useEffect(() => {
    if (!open || !event) return;
    const nextAuto = composePOV({
      cluster: local.cluster,
      corridor: local.corridor,
      emotion: local.target_emotion,
      demographics: selectedDemographics,
      lockSentence: subjectLock.composeClause,
      thesisOverride: lockLensDirective(subjectLock),
    });
    if (!nextAuto) return;
    const currentPOV = String(local.editorial_pov || "").trim();
    // Overwrite only if the current POV is empty OR the operator
    // hasn't touched what we last put there. Otherwise freeze.
    const isSafeToOverwrite = !currentPOV || currentPOV === (lastAutoPOVRef.current || "");
    if (!isSafeToOverwrite) return;
    if (nextAuto === currentPOV) return; // no-op, already applied
    lastAutoPOVRef.current = nextAuto;
    applyPatch({ editorial_pov: nextAuto });
    // applyPatch is stable enough here — it reads updateEventMatrix from
    // a Zustand selector. Intentionally not listing it in deps: the
    // effect must fire on dimension changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.cluster, local.corridor, local.target_emotion, demographicsKey, facetsKey, localesKey, selectedJoin]);

  const toggleDemographic = (value) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    if (selectedDemographics.includes(clean)) {
      setDemographics(selectedDemographics.filter((v) => v !== clean));
    } else {
      setDemographics([...selectedDemographics, clean]);
    }
  };
  const applyLockPatch = (partial) => {
    applyPatch(sanitizeSubjectLock({
      cluster: partial.cluster !== undefined ? partial.cluster : local.cluster,
      corridor: partial.corridor !== undefined ? partial.corridor : local.corridor,
      subjectFacets: partial.subject_facets !== undefined ? partial.subject_facets : selectedFacets,
      corridorLocales: partial.corridor_locales !== undefined ? partial.corridor_locales : selectedLocales,
      joinFacet: partial.join_facet !== undefined ? partial.join_facet : selectedJoin,
    }));
  };
  const toggleFacet = (id) => {
    const next = selectedFacets.includes(id)
      ? selectedFacets.filter((v) => v !== id)
      : [...selectedFacets, id].slice(0, LIMITS.FACETS_MAX);
    applyLockPatch({ subject_facets: next });
  };
  const toggleLocale = (id) => {
    const next = selectedLocales.includes(id)
      ? selectedLocales.filter((v) => v !== id)
      : [...selectedLocales, id].slice(0, LIMITS.LOCALES_MAX);
    applyLockPatch({ corridor_locales: next });
  };
  const toggleJoin = (id) => {
    applyLockPatch({ join_facet: selectedJoin === id ? "" : id });
  };
  const addCustomDemographic = () => {
    const clean = String(demographicInput || "").trim();
    if (!clean) return;
    saveCustomDemographic(clean);
    setCustomDemographics(loadCustomDemographics());
    if (!selectedDemographics.includes(clean)) {
      setDemographics([...selectedDemographics, clean]);
    }
    setDemographicInput("");
    setAddingDemographic(false);
  };
  // Preset row is built-ins + any custom values the operator has added
  // in past sessions. Deduped so nothing shows twice.
  const allDemographicPresets = [...DEMOGRAPHIC_PRESETS,
    ...customDemographics.filter((c) => !DEMOGRAPHIC_PRESETS.includes(c))];

  // Apply a Compass seed topic — writes cluster (as canonical KEY),
  // corridor, hook_a_side, target_emotion, and demographics in one
  // patch. Anything already filled by the operator is preserved unless
  // the seed explicitly sets it; the seed is a starting point, not a
  // reset. Closes the drawer after so the operator can keep editing.
  const applyCompassTopic = (topic) => {
    if (!topic) return;
    const patch = {};
    const clusterKey = resolveClusterKey(topic.cluster);
    if (clusterKey) patch.cluster = clusterKey;
    if (topic.corridor) patch.corridor = topic.corridor;
    if (topic.suggestedHook) patch.hook_a_side = topic.suggestedHook;
    if (topic.targetEmotion) patch.target_emotion = topic.targetEmotion;
    // POV pre-fill is handled by the compositional-POV effect further
    // below — it fires when cluster/corridor/emotion/demographic land.
    // Nothing to seed here.
    if (Array.isArray(topic.demographics) && topic.demographics.length) {
      // Merge (not replace) — keep anything the operator already added.
      const merged = Array.from(new Set([
        ...selectedDemographics,
        ...topic.demographics.filter(Boolean),
      ]));
      patch.target_demographic = merged;
    }
    const lock = sanitizeSubjectLock({
      cluster: clusterKey || local.cluster,
      corridor: topic.corridor || local.corridor,
      subjectFacets: Array.isArray(topic.facets) ? topic.facets : [],
      corridorLocales: Array.isArray(topic.locales) ? topic.locales : [],
      joinFacet: topic.joinFacet || "",
    });
    applyPatch({ ...patch, ...lock });
    setCompassOpen(false);
  };

  // Save the inline-edited name to the store.
  const commitNameEdit = () => {
    if (nameEdit == null) return;
    const clean = String(nameEdit || "").trim();
    if (clean && clean !== event.name && upsertEvent) {
      upsertEvent({ ...event, name: clean });
    }
    setNameEdit(null);
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.76)",
        zIndex: 9200,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px 80px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 640,
          background: "#17171a",
          border: `1px solid ${whisper}`,
          borderRadius: 14,
          padding: 0,
          color: cream,
          fontFamily: "'DM Sans', ui-sans-serif, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${hair}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Syne', ui-sans-serif, sans-serif", fontWeight: 800, fontSize: "1.1rem" }}>
              ◆ Curatorial Matrix
            </div>
            <div style={{ fontSize: "0.72rem", color: muted, marginTop: 3, display: "flex", alignItems: "center", gap: 6 }}>
              {nameEdit == null ? (
                <span
                  onClick={() => setNameEdit(event.name || "")}
                  title="Click to rename"
                  style={{
                    cursor: "pointer",
                    padding: "2px 6px",
                    marginLeft: -6,
                    borderRadius: 4,
                    color: (event.name && event.name !== "Untitled Editorial" && event.name !== "Untitled event") ? cream : orbit,
                    background: "rgba(167,139,250,0.06)",
                    border: `1px solid rgba(167,139,250,0.18)`,
                    fontStyle: (event.name === "Untitled Editorial" || event.name === "Untitled event" || !event.name) ? "italic" : "normal",
                  }}
                >
                  {event.name || "Untitled event"}{" ✎"}
                </span>
              ) : (
                <input
                  type="text"
                  value={nameEdit}
                  onChange={(e) => setNameEdit(e.target.value)}
                  onBlur={commitNameEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitNameEdit(); }
                    else if (e.key === "Escape") { e.preventDefault(); setNameEdit(null); }
                  }}
                  autoFocus
                  placeholder="Name this piece…"
                  style={{
                    background: "#0e0e10",
                    border: `1px solid ${orbit}`,
                    color: cream,
                    borderRadius: 4,
                    padding: "3px 8px",
                    fontFamily: "inherit",
                    fontSize: "0.78rem",
                    outline: "none",
                    minWidth: 260,
                  }}
                />
              )}
              {event.venue ? ` · ${event.venue}` : ""}
              {event.date ? ` · ${event.date}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: "0.66rem", color: muted, display: "flex", alignItems: "center", gap: 6 }}>
              <span>{completeness.filled}/{completeness.total}</span>
              <div style={{ display: "inline-flex", gap: 2 }}>
                {Array.from({ length: completeness.total }).map((_, i) => (
                  <span key={i} style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: i < completeness.filled ? ready : "rgba(245,240,232,0.28)",
                  }} />
                ))}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: "transparent", border: "none", color: faint, fontSize: "1.2rem", cursor: "pointer", padding: "4px 8px", lineHeight: 1 }}
              aria-label="Close matrix editor"
            >×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 22 }}>

          {/* 🧭 Topic Compass — one-tap seed topics that fill cluster + corridor
              + hook + emotion + demographics from the operator's own beat board.
              Collapsed by default to keep the modal short. */}
          <div style={{
            border: `1px solid ${compassOpen ? orbit : whisper}`,
            borderRadius: 8,
            background: compassOpen ? "rgba(167,139,250,0.06)" : "transparent",
            overflow: "hidden",
          }}>
            <button
              type="button"
              onClick={() => setCompassOpen((v) => !v)}
              aria-expanded={compassOpen}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "transparent",
                border: "none",
                color: compassOpen ? orbit : muted,
                cursor: "pointer",
                padding: "10px 14px",
                fontFamily: "inherit",
                fontSize: "0.66rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              <span>🧭 Topic Compass · {COMPASS_TOPICS.length} seed angles</span>
              <span style={{ fontSize: "0.7rem" }}>{compassOpen ? "▾" : "▸"}</span>
            </button>
            {compassOpen && (
              <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: "0.66rem", color: faint, lineHeight: 1.5 }}>
                  Click any seed to auto-fill cluster, corridor, hook A-side, emotion, and demographics.
                  Anything you've already typed is preserved.
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {COMPASS_TOPICS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyCompassTopic(t)}
                      title={t.suggestedHook}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        alignItems: "center",
                        gap: 10,
                        background: "#0e0e10",
                        border: `1px solid ${whisper}`,
                        borderRadius: 6,
                        padding: "8px 12px",
                        color: cream,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        textAlign: "left",
                      }}
                    >
                      <span style={{
                        fontSize: "0.56rem",
                        color: faint,
                        letterSpacing: "0.1em",
                        fontVariantNumeric: "tabular-nums",
                      }}>{t.id}</span>
                      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                        <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: "0.82rem" }}>{t.title}</span>
                        <span style={{ fontSize: "0.68rem", color: muted, lineHeight: 1.4, whiteSpace: "normal", overflow: "hidden", textOverflow: "ellipsis" }}>{t.suggestedHook}</span>
                        <span style={{ fontSize: "0.58rem", color: faint, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          {t.cluster} · {t.corridor}
                        </span>
                      </span>
                      <span style={{
                        fontSize: "0.6rem",
                        color: orbit,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}>Fill →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {isFeature && (
            <div style={{
              padding: "10px 14px",
              background: featureBg,
              border: `1px solid rgba(99,179,237,0.32)`,
              borderRadius: 8,
              fontSize: "0.75rem",
              color: cream,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <span style={{ color: feature, fontWeight: 800 }}>◇</span>
              <span><strong>Feature</strong> · cultural content, not a calendar drop. Preview Carousel seeds the Content register (15/85 observational, archive closer). Date and venue are optional.</span>
            </div>
          )}

          {/* ═════════════════════════════
              DATA FLOW MAP
              ═════════════════════════════
              The matrix looks top-down in the UI, but the actual
              data flow is OPT-IN RE-SYNTHESIS — each synth button
              reads a specific set of upstream fields and writes ONE
              downstream field. Nothing auto-cascades. Downstream
              fields go stale silently when upstream changes.
              This panel names the dependency graph explicitly so
              the operator's mental model matches the actual code. */}
          <details style={{
            marginBottom: 12,
            border: `1px dashed ${whisper}`,
            borderRadius: 6,
            background: "rgba(99,179,237,0.02)",
          }}>
            <summary style={{
              padding: "8px 12px",
              cursor: "pointer",
              fontSize: "0.6rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: "#63B3ED",
              listStyle: "none",
            }}>
              ▸ Data flow · what reads from what (open to see the dependency graph)
            </summary>
            <div style={{ padding: "6px 14px 12px", fontSize: "0.66rem", color: "rgba(245,240,232,0.75)", lineHeight: 1.7 }}>
              <div style={{ marginBottom: 6, color: faint, fontStyle: "italic" }}>
                Nothing auto-cascades — every downstream field is written by a manual synth button. When you change an upstream field after synthesizing a downstream, the downstream goes stale and shows a "⚠ STALE" chip below it.
              </div>
              <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.62rem", lineHeight: 1.75 }}>
                <div><b style={{ color: cream }}>Cluster</b> · Facets · Corridor · Locales · Join · Emotion · Demographic  <span style={{ color: faint }}>→ (click ✨ Reframe LENS)</span>  <b style={{ color: "#A78BFA" }}>editorial_lens (narrowing)</b></div>
                <div><b style={{ color: cream }}>Cluster</b> · Facets · Corridor · Locales · Join · Emotion · Demographic · <b style={{ color: "#A78BFA" }}>LENS narrowing</b>  <span style={{ color: faint }}>→ (click ✨ Draft Thesis)</span>  <b style={{ color: "#A78BFA" }}>editorial_pov</b></div>
                <div><b style={{ color: cream }}>Cluster</b> · Facets · Join · POV · Emotion · Demographic · <b style={{ color: "#A78BFA" }}>LENS narrowing</b>  <span style={{ color: faint }}>→ (click ✨ Draft Hook)</span>  <b style={{ color: "#A78BFA" }}>hook_a_side</b></div>
                <div><b style={{ color: cream }}>Cluster</b> · Facets · Corridor · Locales · Join · POV · Hook · Tier · <b style={{ color: "#A78BFA" }}>LENS</b> · Demographic  <span style={{ color: faint }}>→ (click 🔮 Fuel Research)</span>  <b style={{ color: "#A78BFA" }}>data_points (anchors)</b></div>
                <div><b style={{ color: cream }}>Distance</b> · Cadence · Stance · Cluster  <span style={{ color: faint }}>→ (click 🎙 New Preview)</span>  <b style={{ color: "#A78BFA" }}>voice preview (not stored)</b></div>
                <div><b style={{ color: cream }}>Hook</b> · POV · Anchors · Cluster + <b style={{ color: "#A78BFA" }}>LENS narrowing</b>  <span style={{ color: faint }}>→ (click 🔎 Check argument)</span>  <b style={{ color: "#A78BFA" }}>coherence verdict</b></div>
              </div>
              <div style={{ marginTop: 8, fontSize: "0.6rem", color: "#63B3ED", fontWeight: 700, letterSpacing: "0.06em" }}>
                A picked facet REPLACES the cluster LENS for this piece. Empty chips keep the syllabus. Downstream synths read the LENS on screen, not the parked catalog.
              </div>
              <div style={{ marginTop: 10, color: faint, fontStyle: "italic" }}>
                Values you TYPE (Hook, POV, LENS narrowing, anchors) never trigger synth automatically — the button is always the trigger. That's by design so a stray edit doesn't overwrite a carefully-crafted downstream field. Downstream reads UPSTREAM: LENS/POV/Hook all read the same Cluster+Emotion+Demographic; Fuel Research reads everything above it; Coherence Check reads everything.
              </div>
            </div>
          </details>

          {/* Tier */}
          <div>
            <div style={groupLabelStyle}><span style={{ width: 3, height: 12, background: orbit, borderRadius: 2, display: "inline-block" }} />Event Tier</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {EVENT_TIER_ORDER.map((key) => {
                const t = EVENT_TIERS[key];
                const on = tier === key;
                const tierColor = key === "ANCHOR" ? anchor : key === "ORBIT" ? orbit : feature;
                const tierBg = key === "ANCHOR" ? anchorBg : key === "ORBIT" ? orbitBg : featureBg;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTier(key)}
                    style={{
                      padding: "12px 10px",
                      borderRadius: 8,
                      border: `1px solid ${on ? tierColor : whisper}`,
                      background: on ? tierBg : "transparent",
                      color: on ? cream : muted,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                    }}
                  >
                    <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "0.8rem", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 2 }}>{t.label}</div>
                    <div style={{ fontSize: "0.62rem", color: muted, lineHeight: 1.35 }}>{t.desc}</div>
                  </button>
                );
              })}
            </div>
            {errorsByField.event_tier && (
              <div style={{ fontSize: "0.68rem", color: warn, marginTop: 6 }}>⚠ {errorsByField.event_tier}</div>
            )}
          </div>

          {/* Corridor + Cluster */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>Corridor</label>
              <select
                style={selectStyle}
                value={LEGACY_CORRIDOR_ALIASES[local.corridor] || local.corridor || ""}
                onChange={(e) => {
                  const nextCorridor = e.target.value || undefined;
                  const lock = sanitizeSubjectLock({
                    cluster: local.cluster,
                    corridor: nextCorridor,
                    subjectFacets: selectedFacets,
                    corridorLocales: selectedLocales,
                    joinFacet: selectedJoin,
                  });
                  applyPatch({ corridor: nextCorridor, ...lock });
                }}
              >
                <option value="">— pick corridor —</option>
                {CORRIDORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <LockChipRow
                label="Locales · optional"
                hint={local.corridor
                  ? `Empty = the whole corridor. Max ${LIMITS.LOCALES_MAX}. Pin the towns so Fuel doesn't wander.`
                  : "Pick a corridor first — locales live inside it."}
                options={localesForCorridor(LEGACY_CORRIDOR_ALIASES[local.corridor] || local.corridor)}
                selected={selectedLocales}
                onToggle={toggleLocale}
                max={LIMITS.LOCALES_MAX}
                accent={{ bg: featureBg, border: feature, color: feature }}
              />
              <div style={hintStyle}>Geographic axis · maps to public filter on the consumer site</div>
            </div>
            <div>
              <label style={labelStyle}>Content Cluster</label>
              <select
                style={selectStyle}
                value={resolveClusterKey(local.cluster) || ""}
                onChange={(e) => {
                  // POV pre-fill is handled by the compositional-POV
                  // effect above — it re-composes whenever cluster,
                  // corridor, emotion, or demographic changes, so
                  // there is nothing to seed here beyond the cluster.
                  // Facets that don't belong to the new cluster drop.
                  const nextCluster = e.target.value || undefined;
                  const lock = sanitizeSubjectLock({
                    cluster: nextCluster,
                    corridor: local.corridor,
                    subjectFacets: selectedFacets,
                    corridorLocales: selectedLocales,
                    joinFacet: selectedJoin,
                  });
                  applyPatch({ cluster: nextCluster, ...lock });
                }}
              >
                <option value="">— pick cluster —</option>
                {CONTENT_CLUSTER_LIST.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              <LockChipRow
                label="Facets · optional"
                hint={local.cluster
                  ? `Empty = the whole cluster. Max ${LIMITS.FACETS_MAX}. Pick the sub-version so Fuel doesn't mash overlapping topics.`
                  : "Pick a cluster first — facets live inside it."}
                options={facetsForCluster(local.cluster)}
                selected={selectedFacets}
                onToggle={toggleFacet}
                max={LIMITS.FACETS_MAX}
                accent={{ bg: orbitBg, border: orbit, color: orbit }}
              />
              {liveLens ? (
                <div style={{ marginTop: 8 }}>
                  {/* Live LENS this piece sees. A facet chip replaces
                      the cluster syllabus so the operator can tell
                      what Draft Hook / Fuel will actually drink. */}
                  <div style={{ ...hintStyle, color: muted, fontStyle: "italic", lineHeight: 1.55, marginBottom: 8 }}>
                    <span style={{ color: orbit, fontStyle: "normal", fontWeight: 700, letterSpacing: "0.06em" }}>◆ LENS</span>{" "}
                    {liveLens}
                  </div>
                  {subjectLock.facets.length > 0 && (
                    <div style={{ ...hintStyle, marginTop: -4, marginBottom: 8 }}>
                      Locked to {subjectLock.summary}. Cluster syllabus is parked until you clear the chips.
                    </div>
                  )}
                  {/* Operator override textarea + Reframe/Reset buttons.
                      Empty = base directive alone reaches Perplexity +
                      Gemini. Populated = layers as a narrowing under
                      the base (both remain in prompts). Editable
                      free-text; freeze-rule respected via applyPatch. */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>
                      Narrowing · optional
                    </label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(() => {
                        const clusterKey = resolveClusterKey(local.cluster);
                        const disabled = reframingLens || !clusterKey;
                        return (
                          <button
                            type="button"
                            onClick={reframeLens}
                            disabled={disabled}
                            title={clusterKey
                              ? "Fire a Gemini Flash-Lite call to reframe the LENS this piece sees (a facet lock, or the cluster syllabus if chips are empty) through Corridor + Emotion + Demographic."
                              : "Pick a Content Cluster first — the base LENS is what the reframe narrows."}
                            style={{
                              background: disabled ? "transparent" : "rgba(167,139,250,0.14)",
                              border: `1px solid ${disabled ? whisper : orbit}`,
                              color: disabled ? faint : orbit,
                              borderRadius: 4,
                              padding: "3px 10px",
                              fontFamily: "inherit",
                              fontSize: "0.58rem",
                              letterSpacing: "0.1em",
                              textTransform: "uppercase",
                              fontWeight: 700,
                              cursor: disabled ? "not-allowed" : "pointer",
                            }}
                          >
                            {reframingLens ? "…Reframing" : String(local.editorial_lens || "").trim() ? "✨ Rereframe" : "✨ Reframe LENS"}
                          </button>
                        );
                      })()}
                      {String(local.editorial_lens || "").trim() ? (
                        <button
                          type="button"
                          onClick={() => applyPatch({ editorial_lens: undefined })}
                          title="Clear the narrowing — the LENS this piece sees (facet lock or cluster syllabus) reaches downstream prompts alone."
                          style={{
                            background: "transparent",
                            border: `1px solid ${whisper}`,
                            color: muted,
                            borderRadius: 4,
                            padding: "3px 10px",
                            fontFamily: "inherit",
                            fontSize: "0.58rem",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >↺ Reset</button>
                      ) : null}
                    </div>
                  </div>
                  <textarea
                    style={{ ...textareaStyle, minHeight: 56, fontSize: "0.78rem" }}
                    value={local.editorial_lens || ""}
                    onChange={(e) => applyPatch({ editorial_lens: e.target.value })}
                    placeholder="Optional. Narrow the LENS this piece already sees — a corridor-specific pressure, a demographic-relevant framing. Empty = the live LENS alone. Layers under a facet lock; does not restore the cluster syllabus."
                    maxLength={800}
                  />
                  {lensReframeError ? (
                    <div style={{
                      fontSize: "0.66rem",
                      color: warn,
                      marginTop: 4,
                      letterSpacing: "0.02em",
                      lineHeight: 1.5,
                    }}>
                      ⚠️ {lensReframeError}
                    </div>
                  ) : null}
                  {renderStalenessChip("LENS narrowing", lensSnapshot, lensStale, "cluster · corridor · emotion · demographic")}
                  {String(local.editorial_lens || "").trim() && (
                    <div style={{
                      fontSize: "0.6rem",
                      marginTop: 4,
                      color: "#63B3ED",
                      letterSpacing: "0.03em",
                      lineHeight: 1.5,
                    }}>
                      ◆ This narrowing feeds → Draft Thesis, Draft Hook, Fuel Research, Coherence Check, and the carousel writer. Re-run any downstream synth to pick up your edits.
                    </div>
                  )}
                </div>
              ) : (
                <div style={hintStyle}>Editorial axis · locks the AI's analytical lens for research + carousel copy</div>
              )}
            </div>
          </div>

          {resolveClusterKey(local.cluster) ? (
            <details style={{
              marginTop: 4,
              border: `1px dashed ${whisper}`,
              borderRadius: 8,
              padding: "6px 10px 8px",
              background: selectedJoin ? "rgba(251,191,36,0.06)" : "transparent",
            }}>
              <summary style={{
                cursor: "pointer",
                fontSize: "0.65rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontWeight: 700,
                color: selectedJoin ? warn : muted,
                listStyle: "none",
              }}>
                Join · optional{selectedJoin ? ` · ${getFacet(selectedJoin)?.label || selectedJoin}` : " · closed — stay inside this cluster"}
              </summary>
              <LockChipRow
                label=""
                hint="Empty = stay inside this cluster. A join is the only permitted intersection (e.g. parking-lot brewery joined to liquor cap)."
                options={joinFacetOptions(local.cluster)}
                selected={selectedJoin ? [selectedJoin] : []}
                onToggle={toggleJoin}
                max={1}
                optionLabel={(opt) => opt.joinLabel || opt.label}
                accent={{ bg: warnBg, border: warn, color: warn }}
              />
            </details>
          ) : null}

          {/* Emotion + Demographic */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>Target Emotion</label>
              <select
                style={selectStyle}
                value={local.target_emotion || ""}
                onChange={(e) => applyPatch({ target_emotion: e.target.value || undefined })}
              >
                <option value="">— pick emotion —</option>
                {EMOTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
              <div style={hintStyle}>Feeds the register block in the carousel prompt</div>
            </div>
            <div>
              <label style={labelStyle}>Target Demographic</label>
              {/* Selected chips row */}
              {selectedDemographics.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                  {selectedDemographics.map((d) => (
                    <span
                      key={d}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6,
                        padding: "4px 10px",
                        background: "rgba(52,211,153,0.14)",
                        border: `1px solid rgba(52,211,153,0.42)`,
                        color: "#34D399",
                        borderRadius: 999,
                        fontSize: "0.7rem",
                        fontWeight: 600,
                      }}
                    >
                      {d}
                      <button
                        type="button"
                        onClick={() => toggleDemographic(d)}
                        style={{ background: "transparent", border: "none", color: "#34D399", cursor: "pointer", padding: 0, fontSize: "0.85rem", lineHeight: 1 }}
                        aria-label={`Remove ${d}`}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
              {/* Preset options — click to add */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {allDemographicPresets.filter((d) => !selectedDemographics.includes(d)).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDemographic(d)}
                    style={{
                      padding: "4px 10px",
                      background: "transparent",
                      border: `1px solid ${whisper}`,
                      color: muted,
                      borderRadius: 999,
                      fontFamily: "inherit",
                      fontSize: "0.7rem",
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >+ {d}</button>
                ))}
                {!addingDemographic ? (
                  <button
                    type="button"
                    onClick={() => setAddingDemographic(true)}
                    style={{
                      padding: "4px 10px",
                      background: "transparent",
                      border: `1px dashed ${orbit}`,
                      color: orbit,
                      borderRadius: 999,
                      fontFamily: "inherit",
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >+ Add custom</button>
                ) : (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="text"
                      value={demographicInput}
                      onChange={(e) => setDemographicInput(e.target.value)}
                      onBlur={() => { if (!demographicInput.trim()) setAddingDemographic(false); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addCustomDemographic(); }
                        else if (e.key === "Escape") { e.preventDefault(); setDemographicInput(""); setAddingDemographic(false); }
                      }}
                      autoFocus
                      placeholder="New segment…"
                      style={{
                        background: "#0e0e10",
                        border: `1px solid ${orbit}`,
                        color: cream,
                        borderRadius: 999,
                        padding: "4px 10px",
                        fontFamily: "inherit",
                        fontSize: "0.7rem",
                        outline: "none",
                        minWidth: 160,
                      }}
                    />
                    <button
                      type="button"
                      onClick={addCustomDemographic}
                      disabled={!demographicInput.trim()}
                      style={{
                        padding: "4px 10px",
                        background: orbit,
                        color: "#1a0d3d",
                        border: "none",
                        borderRadius: 999,
                        fontFamily: "inherit",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        cursor: demographicInput.trim() ? "pointer" : "not-allowed",
                        opacity: demographicInput.trim() ? 1 : 0.5,
                      }}
                    >Add</button>
                  </span>
                )}
              </div>
              <div style={hintStyle}>
                Multi-select · click a preset to add, ✕ to remove · custom entries persist for next time
              </div>
            </div>
          </div>

          {/* Voice Parameters — Distance × Cadence × Stance
              (see voiceParams.js). Three orthogonal knobs the writer
              reads to shape how the piece SOUNDS within the brand
              voice. All three are optional; unset falls back to the
              mode's register block alone. */}
          <div>
            <div style={{ ...groupLabelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 3, height: 12, background: orbit, borderRadius: 2, display: "inline-block" }} />
                Voice Parameters · How this piece sounds
              </span>
              {/* Voice Preview — renders one sample paragraph in the
                  current combo. Requires Distance AND Cadence. Same
                  disabled-with-tooltip pattern as Draft Thesis /
                  Draft Hook. */}
              {(() => {
                const canPreview = !!local.voice_distance && !!local.voice_cadence;
                const disabled = previewingVoice || !canPreview;
                const label = previewingVoice
                  ? "…Previewing"
                  : voicePreviewText
                    ? "🎤 New Preview"
                    : "🎤 Voice Preview";
                return (
                  <button
                    type="button"
                    onClick={runVoicePreview}
                    disabled={disabled}
                    title={canPreview
                      ? "Hear one sample paragraph in the current Distance × Cadence × Stance combination before generating a full carousel."
                      : "Pick a Distance AND a Cadence first — those are what the preview demonstrates."}
                    style={{
                      background: disabled ? "transparent" : "rgba(167,139,250,0.14)",
                      border: `1px solid ${disabled ? whisper : orbit}`,
                      color: disabled ? faint : orbit,
                      borderRadius: 4,
                      padding: "3px 10px",
                      fontFamily: "inherit",
                      fontSize: "0.58rem",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })()}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              <div>
                <label style={labelStyle}>Distance</label>
                <select
                  style={selectStyle}
                  value={local.voice_distance || ""}
                  onChange={(e) => applyPatch({ voice_distance: e.target.value || undefined })}
                >
                  <option value="">— pick distance —</option>
                  {DISTANCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <div style={hintStyle}>How close to the reader</div>
              </div>
              <div>
                <label style={labelStyle}>Cadence</label>
                <select
                  style={selectStyle}
                  value={local.voice_cadence || ""}
                  onChange={(e) => applyPatch({ voice_cadence: e.target.value || undefined })}
                >
                  <option value="">— pick cadence —</option>
                  {CADENCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <div style={hintStyle}>Sentence shape / rhythm</div>
              </div>
              <div>
                <label style={labelStyle}>Stance · optional</label>
                <select
                  style={selectStyle}
                  value={local.voice_stance || ""}
                  onChange={(e) => applyPatch({ voice_stance: e.target.value || undefined })}
                >
                  <option value="">— none —</option>
                  {STANCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <div style={hintStyle}>Attitude toward the subject</div>
              </div>
            </div>
            {/* Emotion × Stance compatibility warning — soft yellow
                notice when the picked emotion and stance fight each
                other (see EMOTION_STANCE_TENSIONS in voiceParams.js).
                Doesn't block generation; just calibrates expectation. */}
            {(() => {
              const compat = getVoiceCompatWarning({ emotion: local.target_emotion, stance: local.voice_stance });
              if (compat.level === "natural") return null;
              const color = compat.level === "conflict" ? warn : anchor;
              const bgTint = compat.level === "conflict" ? "rgba(251,191,36,0.08)" : "rgba(229,188,79,0.06)";
              return (
                <div style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  background: bgTint,
                  border: `1px solid ${color}42`,
                  borderRadius: 4,
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                }}>
                  <span style={{ fontSize: "0.9rem", lineHeight: 1 }}>⚠️</span>
                  <div style={{ fontSize: "0.68rem", color: "rgba(245,240,232,0.82)", lineHeight: 1.5 }}>
                    <b style={{ color, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "0.6rem", fontWeight: 700 }}>
                      {compat.level === "conflict" ? "Voice conflict" : "Voice tension"}
                    </b>
                    {" "}— {compat.note}
                  </div>
                </div>
              );
            })()}
            {/* Voice preview panel — renders the sample paragraph or
                an error. Whitespace-preserving so Stacked cadence
                previews (short stacked lines) render as intended. */}
            {voicePreviewError ? (
              <div style={{
                fontSize: "0.66rem",
                color: warn,
                marginTop: 10,
                letterSpacing: "0.02em",
                lineHeight: 1.5,
              }}>
                ⚠️ {voicePreviewError}
              </div>
            ) : null}
            {voicePreviewText ? (
              <div style={{
                marginTop: 10,
                padding: "10px 12px",
                background: "rgba(167,139,250,0.06)",
                border: `1px solid rgba(167,139,250,0.28)`,
                borderRadius: 4,
                color: cream,
                fontSize: "0.78rem",
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
              }}>
                <div style={{
                  fontSize: "0.58rem",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: orbit,
                  fontWeight: 700,
                  marginBottom: 6,
                }}>
                  ◆ Preview{voicePreviewFor ? ` · ${voicePreviewFor}` : ""}
                </div>
                {voicePreviewText}
              </div>
            ) : null}
          </div>

          {/* Hook A */}
          <div>
            <div style={{ ...groupLabelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 3, height: 12, background: anchor, borderRadius: 2, display: "inline-block" }} />
                Hook A-side · Primary Carousel Opener
              </span>
              {/* Draft Hook — fires Gemini Flash-Lite to compress the
                  current POV plus Fuel START lines into a cover that
                  names the NJ contrast the brief already proved.
                  Disabled without both a cluster AND a POV. */}
              {(() => {
                const clusterKey = resolveClusterKey(local.cluster);
                const hasPOV = !!String(local.editorial_pov || "").trim();
                const disabled = draftingHook || !clusterKey || !hasPOV;
                const label = draftingHook
                  ? "…Drafting"
                  : String(local.hook_a_side || "").trim()
                    ? "✨ Redraft Hook"
                    : "✨ Draft Hook";
                return (
                  <button
                    type="button"
                    onClick={draftHook}
                    disabled={disabled}
                    title={
                      !clusterKey
                        ? "Pick a Content Cluster first — the LENS anchors the hook synthesis."
                        : !hasPOV
                          ? "Draft or write an Editorial POV first — the hook is the POV compressed into a scroll-stopper."
                          : "Compress the POV plus Fuel START points into a cover that names the contrast — not a listicle."
                    }
                    style={{
                      background: disabled ? "transparent" : "rgba(229,188,79,0.14)",
                      border: `1px solid ${disabled ? whisper : anchor}`,
                      color: disabled ? faint : anchor,
                      borderRadius: 4,
                      padding: "3px 10px",
                      fontFamily: "inherit",
                      fontSize: "0.58rem",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })()}
            </div>
            <textarea
              style={textareaStyle}
              value={local.hook_a_side || ""}
              onChange={(e) => applyPatch({ hook_a_side: e.target.value })}
              placeholder="One-line tension that opens slide 1. Sharp, specific, brand-voiced."
              maxLength={LIMITS.HOOK_MAX + 50}
            />
            <CharCounter current={(local.hook_a_side || "").length} max={LIMITS.HOOK_MAX} error={errorsByField.hook_a_side} />
            {errorsByField.hook_a_side && (
              <div style={{ fontSize: "0.68rem", color: warn }}>⚠ {errorsByField.hook_a_side}</div>
            )}
            {hookError ? (
              <div style={{
                fontSize: "0.66rem",
                color: warn,
                marginTop: 4,
                letterSpacing: "0.02em",
                lineHeight: 1.5,
              }}>
                ⚠️ {hookError}
              </div>
            ) : null}
            {hookClash ? (
              <div style={{
                fontSize: "0.66rem",
                color: hookClash.level === "conflict" ? warn : muted,
                marginTop: 6,
                padding: "8px 10px",
                background: hookClash.level === "conflict" ? warnBg : "rgba(245,240,232,0.05)",
                border: `1px solid ${hookClash.level === "conflict" ? "rgba(251,191,36,0.32)" : whisper}`,
                borderRadius: 6,
                letterSpacing: "0.01em",
                lineHeight: 1.55,
              }}>
                {hookClash.level === "conflict" ? "⚠ " : "◇ "}Hook ↔ Voice {hookClash.level}: {hookClash.note}
              </div>
            ) : null}
            {renderStalenessChip("Hook A-side", hookSnapshot, hookStale, "cluster · POV · emotion · demographic · LENS narrowing")}
          </div>

          {/* Hook B */}
          <div>
            <div style={groupLabelStyle}><span style={{ width: 3, height: 12, background: feature, borderRadius: 2, display: "inline-block" }} />Hook B-side · Alt for Substack A/B</div>
            <textarea
              style={textareaStyle}
              value={local.hook_b_side || ""}
              onChange={(e) => applyPatch({ hook_b_side: e.target.value })}
              placeholder="Alternate angle for the deeper piece — usually more editorial than the IG opener."
              maxLength={LIMITS.HOOK_MAX + 50}
            />
            <CharCounter current={(local.hook_b_side || "").length} max={LIMITS.HOOK_MAX} error={errorsByField.hook_b_side} />
          </div>

          {/* Editorial POV */}
          <div>
            <div style={{ ...groupLabelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 3, height: 12, background: orbit, borderRadius: 2, display: "inline-block" }} />
                Editorial POV · 1–2 sentence thesis
              </span>
              {/* Draft Thesis — sends the four matrix dimensions to
                  Gemini Flash-Lite for a real editorial synthesis.
                  Disabled without a cluster (no LENS = no anchor).
                  Shown always so the operator can regenerate when
                  the current thesis feels forced or off-tone. */}
              {(() => {
                const clusterKey = resolveClusterKey(local.cluster);
                const disabled = synthesizing || !clusterKey;
                const label = synthesizing
                  ? "…Synthesizing"
                  : String(local.editorial_pov || "").trim()
                    ? "✨ Redraft Thesis"
                    : "✨ Draft Thesis";
                return (
                  <button
                    type="button"
                    onClick={draftThesis}
                    disabled={disabled}
                    title={clusterKey
                      ? "Fire a Gemini Flash-Lite call to synthesize a cohesive editorial thesis from the current cluster + corridor + emotion + demographics"
                      : "Pick a Content Cluster first — it anchors the LENS the synthesizer works through."}
                    style={{
                      background: disabled ? "transparent" : "rgba(167,139,250,0.14)",
                      border: `1px solid ${disabled ? whisper : orbit}`,
                      color: disabled ? faint : orbit,
                      borderRadius: 4,
                      padding: "3px 10px",
                      fontFamily: "inherit",
                      fontSize: "0.58rem",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })()}
            </div>
            <textarea
              style={textareaStyle}
              value={local.editorial_pov || ""}
              onChange={(e) => applyPatch({ editorial_pov: e.target.value })}
              placeholder="Why does this space / event matter? The curatorial thesis the AI carousel prompt reads as brand-perspective context. Pick a cluster above and this pre-fills — editable."
              maxLength={LIMITS.POV_MAX + 100}
            />
            <CharCounter current={(local.editorial_pov || "").length} max={LIMITS.POV_MAX} error={errorsByField.editorial_pov} />
            {synthError ? (
              <div style={{
                fontSize: "0.66rem",
                color: warn,
                marginTop: 4,
                letterSpacing: "0.02em",
                lineHeight: 1.5,
              }}>
                ⚠️ {synthError}
              </div>
            ) : null}
            {renderStalenessChip("Editorial POV", thesisSnapshot, thesisStale, "cluster · corridor · emotion · demographic · LENS narrowing")}
          </div>

          {/* Research Anchors (internal field: data_points) */}
          <div>
            <div style={{ ...groupLabelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 3, height: 12, background: orbit, borderRadius: 2, display: "inline-block" }} />
                Research Anchors · NJ brief + starting points
              </span>
              <button
                type="button"
                onClick={() => fuelResearch("full")}
                disabled={researching || !local.cluster}
                title={
                  researching ? "Researching…"
                  : !local.cluster ? "Pick a cluster first — Perplexity needs an editorial frame"
                  : "Ask Perplexity for an NJ-focused brief and starting points to dive"
                }
                style={{
                  background: researching ? "rgba(167,139,250,0.06)" : "rgba(167,139,250,0.14)",
                  color: researching ? faint : orbit,
                  border: `1px solid ${orbit}`,
                  borderRadius: 4,
                  padding: "4px 10px",
                  fontFamily: "inherit",
                  fontSize: "0.6rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  cursor: researching || !local.cluster ? "not-allowed" : "pointer",
                  opacity: !local.cluster ? 0.5 : 1,
                }}
              >
                {researching ? "🔮 Researching…" : "🔮 Fuel Research"}
              </button>
              {researchPhase === "gap-scout" ? (
                <button
                  type="button"
                  onClick={() => fuelResearch("dive")}
                  disabled={researching || bullets.filter(Boolean).length < 1}
                  title="Desk-dive the specific pieces the gap search just found"
                  style={{
                    background: researching ? "rgba(52,211,153,0.06)" : "rgba(52,211,153,0.14)",
                    color: researching ? faint : ready,
                    border: `1px solid ${ready}`,
                    borderRadius: 4,
                    padding: "4px 10px",
                    fontFamily: "inherit",
                    fontSize: "0.6rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    cursor: researching ? "not-allowed" : "pointer",
                  }}
                >
                  {researching ? "Diving…" : "Dive these pieces"}
                </button>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {bullets.map((b, i) => {
                const over = (b || "").length > LIMITS.BULLET_MAX;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    background: "#0e0e10",
                    border: `1px solid ${over ? warn : whisper}`,
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: orbit, flexShrink: 0, marginTop: 8 }} />
                    <textarea
                      value={b || ""}
                      onChange={(e) => setBullet(i, e.target.value)}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                      ref={(el) => {
                        if (el) {
                          el.style.height = "auto";
                          el.style.height = `${el.scrollHeight}px`;
                        }
                      }}
                      rows={1}
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        color: cream,
                        fontFamily: "inherit",
                        fontSize: "0.82rem",
                        outline: "none",
                        resize: "none",
                        lineHeight: 1.55,
                        padding: 0,
                        overflow: "hidden",
                      }}
                      placeholder="THESIS — or START — a named NJ thread to dive. Not a venue address."
                    />
                    <span style={{ fontSize: "0.6rem", color: over ? warn : faint, fontVariantNumeric: "tabular-nums", marginTop: 4, flexShrink: 0 }}>
                      {(b || "").length}/{LIMITS.BULLET_MAX}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBullet(i)}
                      style={{ background: "transparent", border: "none", color: faint, cursor: "pointer", padding: "2px 6px", borderRadius: 3, fontSize: "0.8rem", marginTop: 2, flexShrink: 0 }}
                      aria-label="Remove research anchor"
                    >×</button>
                  </div>
                );
              })}
              {bullets.length < LIMITS.BULLETS_MAX && (
                <button
                  type="button"
                  onClick={addBullet}
                  style={{
                    background: "transparent",
                    border: `1px dashed ${whisper}`,
                    color: muted,
                    borderRadius: 6,
                    padding: "8px 12px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "0.68rem",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >+ Add research anchor</button>
              )}
            </div>
            {errorsByField.data_points && (
              <div style={{ fontSize: "0.68rem", color: warn, marginTop: 6 }}>⚠ {errorsByField.data_points}</div>
            )}
            {/* Entity overlap warning — surfaces when 2+ anchors share
                the same primary named entity (e.g. three bullets all
                about Village Brewing). Collapsed-carousel prevention. */}
            {liveOverlaps.length > 0 && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                background: "rgba(251,191,36,0.06)",
                border: `1px solid rgba(251,191,36,0.32)`,
                borderRadius: 6,
                fontSize: "0.7rem",
                color: warn,
                lineHeight: 1.55,
              }}>
                <div style={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "0.6rem", marginBottom: 4 }}>
                  ⚠ Anchor overlap detected — carousel will collapse
                </div>
                {liveOverlaps.slice(0, 3).map((o, i) => (
                  <div key={i} style={{ marginTop: 3 }}>
                    <b style={{ color: cream, textTransform: "capitalize" }}>{o.entity}</b>
                    {" "}appears in anchors #{o.bulletIndices.map((idx) => idx + 1).join(", #")} — the writer will route these onto adjacent slides that all say the same thing about the same place. Cull all but one.
                  </div>
                ))}
              </div>
            )}
            {researchError && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                background: warnBg,
                border: `1px solid rgba(251,191,36,0.32)`,
                borderRadius: 6,
                fontSize: "0.7rem",
                color: warn,
              }}>
                ⚠ Fuel Research: {researchError}
              </div>
            )}
            {renderStalenessChip("Research Anchors (last Fuel Research)", researchSnapshot, researchStale, "cluster · corridor · POV · hook · tier · lens · demographic")}
            {researchPhase && (
              <div style={{
                marginTop: 8,
                padding: "6px 10px",
                background: researchPhase === "verified" || researchPhase === "dived"
                  ? "rgba(52,211,153,0.06)"
                  : researchPhase === "gap-scout"
                    ? "rgba(167,139,250,0.08)"
                    : "rgba(251,191,36,0.06)",
                border: `1px solid ${researchPhase === "verified" || researchPhase === "dived"
                  ? "rgba(52,211,153,0.28)"
                  : researchPhase === "gap-scout"
                    ? "rgba(167,139,250,0.28)"
                    : "rgba(251,191,36,0.28)"}`,
                borderRadius: 6,
                fontSize: "0.62rem",
                color: researchPhase === "verified" || researchPhase === "dived"
                  ? ready
                  : researchPhase === "gap-scout" ? orbit : warn,
                letterSpacing: "0.06em",
                lineHeight: 1.55,
              }}>
                {researchPhase === "dived" || researchPhase === "verified" ? (
                  <>◆ NJ brief + desk dive · starting points thickened against official / argument pages</>
                ) : researchPhase === "gap-scout" ? (
                  <>◆ Gap search · specific pieces that close the check. Dive those next — do not run Fuel Research again.</>
                ) : researchPhase === "scout" ? (
                  <>◆ NJ brief · desks did not thicken these starting points
                    {researchVerificationError
                      ? ` · ${researchVerificationError.slice(0, 160)}`
                      : ""}</>
                ) : (
                  <>⚠ Unverified · Phase 2 failed — these are the NJ brief only
                    {researchVerificationError
                      ? ` · reason: ${researchVerificationError.slice(0, 160)}`
                      : ""}</>
                )}
              </div>
            )}
            {(researchDesks || officialEmpty || culturalEmpty) && (
              <div style={{
                marginTop: 8,
                padding: "6px 10px",
                background: (officialEmpty || culturalEmpty) ? "rgba(251,191,36,0.06)" : "rgba(167,139,250,0.06)",
                border: `1px solid ${(officialEmpty || culturalEmpty) ? "rgba(251,191,36,0.28)" : "rgba(167,139,250,0.18)"}`,
                borderRadius: 6,
                fontSize: "0.62rem",
                color: (officialEmpty || culturalEmpty) ? warn : muted,
                letterSpacing: "0.04em",
                lineHeight: 1.55,
              }}>
                {researchDesks ? (
                  <>Desk A official {researchDesks.official?.ok ? `· ${researchDesks.official.count} fact${researchDesks.official.count === 1 ? "" : "s"}` : "· empty"}
                    {"  ·  "}
                    Desk B argument {researchDesks.cultural?.ok ? `· ${researchDesks.cultural.count} fact${researchDesks.cultural.count === 1 ? "" : "s"}` : "· empty"}
                    {researchDesks.scout ? (
                      <>
                        {"  ·  "}
                        Scout {researchDesks.scout.ok ? `· ${researchDesks.scout.count} starting point${researchDesks.scout.count === 1 ? "" : "s"}` : "· empty"}
                      </>
                    ) : null}
                    {researchDesks.lookthrough ? (
                      <>
                        {"  ·  "}
                        Look-through {researchDesks.lookthrough.ok ? `· ${researchDesks.lookthrough.count} page${researchDesks.lookthrough.count === 1 ? "" : "s"}` : "· empty"}
                      </>
                    ) : null}</>
                ) : "Source desks ran."}
                {officialEmpty ? (
                  <div style={{ marginTop: 4, fontWeight: 700 }}>
                    Official desk did not thicken a record page yet — dive the named program on .gov next. Keep the brief.
                  </div>
                ) : null}
                {culturalEmpty ? (
                  <div style={{ marginTop: 4, fontWeight: 700 }}>
                    Argument desk did not land a Black-NJ column yet — that's the next dive, not a reason to throw the brief away.
                  </div>
                ) : null}
              </div>
            )}
            {citations.length > 0 && (
              <div style={{
                marginTop: 8,
                padding: "8px 10px",
                background: "rgba(167,139,250,0.06)",
                border: `1px solid rgba(167,139,250,0.18)`,
                borderRadius: 6,
                fontSize: "0.66rem",
                color: muted,
              }}>
                {/* Header row: title + Discard action + expand toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSourcesExpanded((v) => !v)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: orbit,
                      fontFamily: "inherit",
                      fontSize: "0.56rem",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    aria-expanded={sourcesExpanded}
                  >
                    {sourcesExpanded ? "▾" : "▸"} ◆ {citations.length} source{citations.length === 1 ? "" : "s"} · {(() => {
                      const c = countSourceClasses(researchSources.length ? researchSources : classifySources(citations));
                      return `OFFICIAL ${c.OFFICIAL} · CULTURAL ${c.CULTURAL} · PRESS ${c.PRESS} · UNRANKED ${c.UNRANKED}`;
                    })()}
                  </button>
                  {preResearchSnapshot != null && (
                    <button
                      type="button"
                      onClick={discardResearch}
                      title="Undo the last Fuel Research — restore bullets and clear sources"
                      style={{
                        background: "transparent",
                        border: `1px solid rgba(251,191,36,0.4)`,
                        color: warn,
                        fontFamily: "inherit",
                        fontSize: "0.56rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        cursor: "pointer",
                        padding: "3px 8px",
                        borderRadius: 4,
                      }}
                    >↺ Discard research</button>
                  )}
                </div>
                {/* Collapsed: just the hostname strip so wall-of-URLs
                    turns into a scannable "wikipedia.org · genius.com …" */}
                {!sourcesExpanded && (
                  <div style={{
                    marginTop: 6,
                    fontSize: "0.62rem",
                    color: faint,
                    wordBreak: "break-word",
                  }}>
                    {(researchSources.length ? researchSources : classifySources(citations)).map((s) => `${s.class} ${s.host}`).join(" · ")}
                  </div>
                )}
                {/* Expanded: the full URL list, one per line */}
                {sourcesExpanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                    {(researchSources.length ? researchSources : classifySources(citations)).map((s, i) => (
                      <a
                        key={i}
                        href={s.uri}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{
                          color: orbit,
                          textDecoration: "none",
                          wordBreak: "break-all",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      ><b style={{ color: cream }}>{s.class}</b> · {s.host} · {i + 1}. {s.uri}</a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Automation Wiring */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>Keyword Trigger</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0e0e10", border: `1px solid ${whisper}`, borderRadius: 6, padding: "8px 12px" }}>
                <span style={{ fontSize: "0.7rem", color: faint, fontFamily: "'Syne', sans-serif", fontWeight: 700, letterSpacing: "0.05em" }}>DM</span>
                <input
                  type="text"
                  value={local.keyword_trigger || ""}
                  onChange={(e) => applyPatch({ keyword_trigger: e.target.value.toUpperCase() })}
                  placeholder="AFROFEVER"
                  maxLength={LIMITS.TRIGGER_MAX}
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: cream,
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 800,
                    fontSize: "0.85rem",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    flex: 1,
                  }}
                />
              </div>
              <div style={hintStyle}>DM this word → ManyChat sends event details</div>
              {triggerWarning && (
                <div style={{
                  fontSize: "0.66rem",
                  color: warn,
                  marginTop: 6,
                  lineHeight: 1.5,
                  letterSpacing: "0.01em",
                }}>
                  ⚠ {triggerWarning}
                </div>
              )}
            </div>

            <div>
              <label style={labelStyle}>Pipeline Status</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {PIPELINE_STATUS_ORDER.map((key) => {
                  const s = PIPELINE_STATUS[key];
                  const on = status === key;
                  const disabled = key === PIPELINE_STATUS.READY.key && !readyValidation.ok && !on;
                  const color =
                    key === PIPELINE_STATUS.DRAFT.key ? warn :
                    key === PIPELINE_STATUS.READY.key ? ready :
                    cream;
                  const bg =
                    key === PIPELINE_STATUS.DRAFT.key ? warnBg :
                    key === PIPELINE_STATUS.READY.key ? readyBg :
                    "rgba(245,240,232,0.08)";
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatus(key)}
                      disabled={disabled}
                      title={disabled ? "Fill required fields first" : ""}
                      style={{
                        padding: "10px 8px",
                        borderRadius: 6,
                        border: `1px solid ${on ? color : whisper}`,
                        background: on ? bg : "transparent",
                        color: on ? color : (disabled ? "rgba(245,240,232,0.28)" : muted),
                        cursor: disabled ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                        fontSize: "0.66rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                        opacity: disabled ? 0.5 : 1,
                      }}
                    >{s.label}</button>
                  );
                })}
              </div>
              <div style={hintStyle}>
                {readyValidation.ok
                  ? "Ready to ship — gates JSON export to n8n / Python"
                  : `Fill ${readyValidation.errors.length} field${readyValidation.errors.length === 1 ? "" : "s"} to unlock Ready`}
              </div>
            </div>
          </div>

          {syncError && (
            <div style={{
              padding: "10px 12px",
              background: warnBg,
              border: `1px solid rgba(251,191,36,0.32)`,
              borderRadius: 6,
              fontSize: "0.72rem",
              color: warn,
            }}>
              ⚠ Sync error: {syncError}. Changes are still in memory — retry by editing any field.
            </div>
          )}

          {/* ═════════════════════════════
              ARGUMENT COHERENCE CHECK
              ═════════════════════════════
              Adversarial pre-generation critic — verifies the anchors
              can actually support the hook + POV before we burn a
              carousel generation on shaky material. Fires as an
              explicit click; result renders inline with verdict color
              (coherent=green, thin=amber, mismatched=red) + gaps. */}
          <div style={{ marginTop: 18, borderTop: `1px dashed ${hair}`, paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: "0.66rem", color: cream, letterSpacing: "0.06em", fontWeight: 700, textTransform: "uppercase" }}>
                🔎 Argument coherence check
              </div>
              <button
                type="button"
                onClick={runCoherenceCheck}
                disabled={checkingCoherence || !String(local.hook_a_side || "").trim() || !String(local.editorial_pov || "").trim() || bullets.filter(Boolean).length < 2}
                title="Adversarial pre-gen check: can these anchors support this argument? Runs before you burn a carousel generation."
                style={{
                  background: checkingCoherence ? "rgba(99,179,237,0.06)" : "rgba(99,179,237,0.14)",
                  color: checkingCoherence ? faint : "#63B3ED",
                  border: `1px solid rgba(99,179,237,0.4)`,
                  borderRadius: 4,
                  padding: "5px 12px",
                  fontFamily: "inherit",
                  fontSize: "0.6rem",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  cursor: checkingCoherence ? "wait" : "pointer",
                  opacity: (!String(local.hook_a_side || "").trim() || !String(local.editorial_pov || "").trim() || bullets.filter(Boolean).length < 2) ? 0.4 : 1,
                }}
              >
                {checkingCoherence ? "…Checking" : coherenceResult ? "↻ Re-check" : "Check argument"}
              </button>
            </div>
            <div style={{ fontSize: "0.62rem", color: faint, marginBottom: 8, lineHeight: 1.5 }}>
              Reads Hook A-side + Editorial POV + Research Anchors, and returns whether the pieces actually go together — flags a thin or mismatched matrix before generation, not after.
            </div>
            {coherenceError && (
              <div style={{
                padding: "8px 10px",
                background: warnBg,
                border: `1px solid rgba(251,191,36,0.32)`,
                borderRadius: 6,
                fontSize: "0.68rem",
                color: warn,
              }}>
                ⚠ {coherenceError}
              </div>
            )}
            {coherenceResult && !coherenceError && (() => {
              const v = coherenceResult.verdict;
              const bgColor = v === "coherent" ? "rgba(52,211,153,0.08)"
                : v === "thin" ? "rgba(251,191,36,0.08)"
                : "rgba(251,113,133,0.08)";
              const borderColor = v === "coherent" ? "rgba(52,211,153,0.32)"
                : v === "thin" ? "rgba(251,191,36,0.32)"
                : "rgba(251,113,133,0.32)";
              const textColor = v === "coherent" ? ready
                : v === "thin" ? warn
                : "#FB7185";
              const icon = v === "coherent" ? "✓" : v === "thin" ? "◑" : "✗";
              const label = v === "coherent" ? "Coherent — argument stands"
                : v === "thin" ? "Thin — anchors too few or too shallow"
                : "Mismatched — anchors don't back the hook";
              return (
                <div style={{
                  padding: "10px 12px",
                  background: bgColor,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 6,
                  fontSize: "0.7rem",
                  color: textColor,
                  lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "0.62rem", marginBottom: 6 }}>
                    {icon} {label}{coherenceIsStale ? " · (stale — inputs changed since last check)" : ""}
                  </div>
                  <div style={{ color: "rgba(245,240,232,0.85)", marginBottom: coherenceResult.gaps.length ? 6 : 0 }}>
                    {coherenceResult.reason}
                  </div>
                  {coherenceResult.gaps.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: "0.58rem", letterSpacing: "0.08em", textTransform: "uppercase", color: textColor, fontWeight: 700, marginBottom: 4 }}>
                        Specific gaps to close before generation
                      </div>
                      {coherenceResult.gaps.map((g, i) => (
                        <div key={i} style={{ color: "rgba(245,240,232,0.75)", marginTop: 3 }}>
                          — {g}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => fuelResearch("gap-scout")}
                        disabled={researching || !local.cluster}
                        title={!local.cluster ? "Pick a cluster first" : "Google-search these gaps for specific NJ pieces. Dive those next."}
                        style={{
                          marginTop: 10,
                          background: researching ? "rgba(167,139,250,0.06)" : "rgba(167,139,250,0.16)",
                          color: researching ? faint : orbit,
                          border: `1px solid ${orbit}`,
                          borderRadius: 4,
                          padding: "5px 10px",
                          fontFamily: "inherit",
                          fontSize: "0.58rem",
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                          cursor: researching || !local.cluster ? "not-allowed" : "pointer",
                        }}
                      >
                        {researching ? "🔮 Searching gaps…" : "🔮 Google these gaps"}
                      </button>
                      {researchPhase === "gap-scout" ? (
                        <button
                          type="button"
                          onClick={() => fuelResearch("dive")}
                          disabled={researching || bullets.filter(Boolean).length < 1}
                          title="Desk-dive the specific pieces the gap search just found"
                          style={{
                            marginTop: 8,
                            marginLeft: 8,
                            background: researching ? "rgba(52,211,153,0.06)" : "rgba(52,211,153,0.14)",
                            color: researching ? faint : ready,
                            border: `1px solid ${ready}`,
                            borderRadius: 4,
                            padding: "5px 10px",
                            fontFamily: "inherit",
                            fontSize: "0.58rem",
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            fontWeight: 700,
                            cursor: researching ? "not-allowed" : "pointer",
                          }}
                        >
                          {researching ? "Diving…" : "Dive these pieces"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

        </div>

        {/* Footer */}
        <div style={{ borderTop: `1px solid ${hair}`, padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.66rem", color: faint, letterSpacing: "0.06em" }}>
            {isMatrixReadyForGeneration(local)
              ? "✓ Matrix ready — Preview Carousel will hand off to the AI Fill modal"
              : "Fill tier + hook A + one bullet to enable Preview Carousel"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "10px 18px",
                borderRadius: 6,
                border: `1px solid ${whisper}`,
                background: "transparent",
                color: cream,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: "0.72rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >Done</button>
            <button
              onClick={() => {
                const seed = eventMatrixToFillSeed({ ...event, matrix: local });
                if (!seed) return;
                // Window collapse: open the AI Fill modal ON TOP of
                // this matrix (compact mode) instead of navigating
                // away. Matrix stays visible behind, non-interactive
                // while overlay is open. Handoff via /media route
                // only when no apiKey is passed — that lets legacy
                // mount points (ReviewQueue) keep working until they
                // adopt the new pattern.
                if (apiKey) {
                  setAiFillOverlaySeed(seed);
                  setAiFillOverlayOpen(true);
                } else {
                  setCarouselSeed(seed);
                  onClose && onClose();
                  navigate("/media");
                }
              }}
              disabled={!isMatrixReadyForGeneration(local)}
              title={isMatrixReadyForGeneration(local)
                ? (apiKey ? "Open the AI Fill overlay on top of the matrix" : "Hand off matrix data to the AI Fill modal on Media")
                : "Fill required fields first"}
              style={{
                padding: "10px 20px",
                borderRadius: 6,
                border: `1px solid ${isMatrixReadyForGeneration(local) ? orbit : whisper}`,
                background: isMatrixReadyForGeneration(local) ? orbit : "transparent",
                color: isMatrixReadyForGeneration(local) ? "#1a0d3d" : "rgba(245,240,232,0.28)",
                cursor: isMatrixReadyForGeneration(local) ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                fontSize: "0.72rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 800,
                opacity: isMatrixReadyForGeneration(local) ? 1 : 0.5,
              }}
            >🎨 Preview Carousel →</button>
          </div>
        </div>
      </div>
      {/* AI Fill Overlay — window collapse. Opens compact-mode AI Fill
          ON TOP of the matrix. Rendered inside the same portal target
          so it stacks above the matrix's own backdrop. Only mounts
          when the caller passed an apiKey (i.e. modern mount points);
          legacy mount points fall through to the /media navigation
          path above until they adopt the new pattern. */}
      {aiFillOverlayOpen && aiFillOverlaySeed && apiKey ? (
        <AiTemplateFillModal
          open={aiFillOverlayOpen}
          apiKey={apiKey}
          compactMode={true}
          initialTemplateId={aiFillOverlaySeed.templateId}
          initialTopic={aiFillOverlaySeed.topic}
          initialContext={aiFillOverlaySeed.context}
          initialArrange={aiFillOverlaySeed.arrange}
          initialRegister={aiFillOverlaySeed.register}
          initialClusterDirective={aiFillOverlaySeed.clusterDirective}
          initialClusterLabel={aiFillOverlaySeed.clusterLabel}
          initialKeywordTrigger={aiFillOverlaySeed.keywordTrigger}
          initialVoiceParams={aiFillOverlaySeed.voiceParams}
          initialBehavioralTags={aiFillOverlaySeed.behavioralTags}
          initialIsEvergreen={aiFillOverlaySeed.isEvergreen}
          initialRejectedDrafts={aiFillOverlaySeed.rejectedDrafts || []}
          initialApprovedDrafts={aiFillOverlaySeed.approvedDrafts || []}
          onClose={() => { setAiFillOverlayOpen(false); setAiFillOverlaySeed(null); }}
          onAccept={(slides) => {
            if (typeof onAiFillAccept === "function") onAiFillAccept(slides, event);
            setAiFillOverlayOpen(false);
            setAiFillOverlaySeed(null);
          }}
          onSaveFeedback={(kind, entry) => {
            // Persist to matrix.rejected_drafts / approved_drafts.
            // Cap at 3 each, FIFO. Updates flow through the store's
            // updateEventMatrix action which persists to the server
            // via the existing upsertEvent path.
            const currentMatrix = event?.matrix || {};
            const patch = {};
            if (kind === "reject") {
              const prior = Array.isArray(currentMatrix.rejected_drafts) ? currentMatrix.rejected_drafts : [];
              patch.rejected_drafts = [...prior, entry].slice(-3);
            } else if (kind === "approve") {
              const prior = Array.isArray(currentMatrix.approved_drafts) ? currentMatrix.approved_drafts : [];
              patch.approved_drafts = [...prior, entry].slice(-3);
            }
            if (Object.keys(patch).length && event?.id != null && typeof updateEventMatrix === "function") {
              updateEventMatrix(event.id, patch);
            }
          }}
        />
      ) : null}
    </div>,
    document.body
  );
}
