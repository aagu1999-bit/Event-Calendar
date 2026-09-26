import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useEventsStore, useCarouselSeedStore } from "../store.js";
import {
  EVENT_TIERS, EVENT_TIER_ORDER,
  CORRIDORS, LEGACY_CORRIDOR_ALIASES,
  EMOTIONS, DEMOGRAPHIC_PRESETS, LEGACY_DEMOGRAPHIC_ALIASES,
  PIPELINE_STATUS, PIPELINE_STATUS_ORDER,
  LIMITS,
} from "./matrixEnums.js";
import {
  CONTENT_CLUSTER_LIST,
  resolveClusterKey,
  getClusterDirective,
  getClusterDefaultPOV,
  composePOV,
  COMPASS_TOPICS,
} from "./matrixCompass.js";
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

export function CuratorialMatrixModal({ open, event, onClose, onFeatureToggle }) {
  const updateEventMatrix = useEventsStore((s) => s.updateEventMatrix);
  const upsertEvent = useEventsStore((s) => s.upsertEvent);
  const syncError = useEventsStore((s) => s.syncError);
  const setCarouselSeed = useCarouselSeedStore((s) => s.setSeed);
  const navigate = useNavigate();

  // Fuel Research (Perplexity) state — one research call at a time,
  // errors and citations render inline in the Data Points group so the
  // operator can vet sources before adding.
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState(null);
  const [citations, setCitations] = useState([]);
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
  const [local, setLocal] = useState(() => ({ ...(event?.matrix || {}) }));
  useEffect(() => {
    setLocal({ ...(event?.matrix || {}) });
    setResearchError(null);
    setCitations([]);
    setPreResearchSnapshot(null);
    setSourcesExpanded(false);
    setNameEdit(null);
    setDemographicInput("");
    setAddingDemographic(false);
    setCompassOpen(false);
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
  const bullets = Array.isArray(local.data_points) ? local.data_points : [];

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
  const fuelResearch = async () => {
    if (researching) return;
    // Snapshot the bullets we have now so a bad research can be undone
    // in one tap via the sources strip's ↺ Discard button.
    setPreResearchSnapshot(bullets);
    setResearching(true);
    setResearchError(null);
    try {
      const r = await fetch("/api/matrix/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cluster: local.cluster || "",
          topic: local.hook_a_side || event?.name || "",
          pov: local.editorial_pov || "",
          existingBullets: bullets,
          tier: local.event_tier || "",
          corridor: local.corridor || "",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setResearchError(j.message || j.error || `Server ${r.status}`);
        return;
      }
      const incoming = Array.isArray(j.bullets) ? j.bullets : [];
      if (!incoming.length) {
        setResearchError("No bullets returned. Try broadening the cluster or hook.");
        return;
      }
      // Append while respecting BULLETS_MAX; the operator can trim later.
      const merged = [...bullets, ...incoming].slice(0, LIMITS.BULLETS_MAX);
      applyPatch({ data_points: merged });
      setCitations(Array.isArray(j.citations) ? j.citations.slice(0, 8) : []);
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
    setResearchError(null);
  };

  // Demographic chip helpers. Demographics are stored as an array on
  // matrix.target_demographic; normalizeDemographic() handles legacy
  // comma-string values transparently.
  const selectedDemographics = normalizeDemographic(local.target_demographic);
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
  }, [local.cluster, local.corridor, local.target_emotion, demographicsKey]);

  // Keep the modal hidden without skipping hooks; it remains mounted so
  // editing state survives close/reopen while the hook order stays stable.
  if (!open || !event) return null;

  const toggleDemographic = (value) => {
    const clean = String(value || "").trim();
    if (!clean) return;
    if (selectedDemographics.includes(clean)) {
      setDemographics(selectedDemographics.filter((v) => v !== clean));
    } else {
      setDemographics([...selectedDemographics, clean]);
    }
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
    applyPatch(patch);
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
              <span><strong>Feature</strong> · this record is evergreen editorial. Date and venue are optional; it won't push to the consumer calendar.</span>
            </div>
          )}

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
                onChange={(e) => applyPatch({ corridor: e.target.value || undefined })}
              >
                <option value="">— pick corridor —</option>
                {CORRIDORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
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
                  applyPatch({ cluster: e.target.value || undefined });
                }}
              >
                <option value="">— pick cluster —</option>
                {CONTENT_CLUSTER_LIST.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              {getClusterDirective(local.cluster) ? (
                <div style={{ ...hintStyle, color: muted, fontStyle: "italic", lineHeight: 1.55 }}>
                  <span style={{ color: orbit, fontStyle: "normal", fontWeight: 700, letterSpacing: "0.06em" }}>◆ LENS</span>{" "}
                  {getClusterDirective(local.cluster)}
                </div>
              ) : (
                <div style={hintStyle}>Editorial axis · locks the AI's analytical lens for research + carousel copy</div>
              )}
            </div>
          </div>

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

          {/* Hook A */}
          <div>
            <div style={groupLabelStyle}><span style={{ width: 3, height: 12, background: anchor, borderRadius: 2, display: "inline-block" }} />Hook A-side · Primary Carousel Opener</div>
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
              {(() => {
                // "Compose from picks" — regenerates the POV from
                // whatever cluster + corridor + emotion + demographics
                // are currently selected. Shows when a composed POV is
                // possible AND it differs from what's in the textarea
                // (so we don't ask the operator to click a no-op).
                const composed = composePOV({
                  cluster: local.cluster,
                  corridor: local.corridor,
                  emotion: local.target_emotion,
                  demographics: selectedDemographics,
                });
                if (!composed) return null;
                const current = String(local.editorial_pov || "").trim();
                if (current === composed.trim()) return null;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      lastAutoPOVRef.current = composed;
                      applyPatch({ editorial_pov: composed });
                    }}
                    title={current ? "Replace your POV with one composed from the current cluster + corridor + emotion + demographics" : "Compose an editorial POV from the current picks"}
                    style={{
                      background: "transparent",
                      border: `1px solid ${whisper}`,
                      color: muted,
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontFamily: "inherit",
                      fontSize: "0.58rem",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    ↺ {current ? "Recompose from picks" : "Compose from picks"}
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
          </div>

          {/* Data Points */}
          <div>
            <div style={{ ...groupLabelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 3, height: 12, background: orbit, borderRadius: 2, display: "inline-block" }} />
                Data Points · {LIMITS.BULLETS_MIN}–{LIMITS.BULLETS_MAX} atomic bullets
              </span>
              <button
                type="button"
                onClick={fuelResearch}
                disabled={researching || !local.cluster}
                title={
                  researching ? "Researching…"
                  : !local.cluster ? "Pick a cluster first — Perplexity needs an editorial frame"
                  : "Ask Perplexity for 3–4 verified factual bullets"
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
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {bullets.map((b, i) => {
                const over = (b || "").length > LIMITS.BULLET_MAX;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "#0e0e10",
                    border: `1px solid ${over ? warn : whisper}`,
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: orbit, flexShrink: 0 }} />
                    <input
                      type="text"
                      value={b || ""}
                      onChange={(e) => setBullet(i, e.target.value)}
                      style={{ flex: 1, background: "transparent", border: "none", color: cream, fontFamily: "inherit", fontSize: "0.82rem", outline: "none" }}
                      placeholder="One atomic fact — transit, capacity, price, vibe, historical note"
                    />
                    <span style={{ fontSize: "0.6rem", color: over ? warn : faint, fontVariantNumeric: "tabular-nums" }}>
                      {(b || "").length}/{LIMITS.BULLET_MAX}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBullet(i)}
                      style={{ background: "transparent", border: "none", color: faint, cursor: "pointer", padding: "2px 6px", borderRadius: 3, fontSize: "0.8rem" }}
                      aria-label="Remove data point"
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
                >+ Add data point</button>
              )}
            </div>
            {errorsByField.data_points && (
              <div style={{ fontSize: "0.68rem", color: warn, marginTop: 6 }}>⚠ {errorsByField.data_points}</div>
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
                    {sourcesExpanded ? "▾" : "▸"} ◆ {citations.length} source{citations.length === 1 ? "" : "s"} · vet before shipping
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
                    {citations.map((u) => hostnameOf(u)).join(" · ")}
                  </div>
                )}
                {/* Expanded: the full URL list, one per line */}
                {sourcesExpanded && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                    {citations.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{
                          color: orbit,
                          textDecoration: "none",
                          wordBreak: "break-all",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      ><b style={{ color: cream }}>{hostnameOf(url)}</b> · {i + 1}. {url}</a>
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
                setCarouselSeed(seed);
                onClose && onClose();
                navigate("/media");
              }}
              disabled={!isMatrixReadyForGeneration(local)}
              title={isMatrixReadyForGeneration(local)
                ? "Hand off matrix data to the AI Fill modal on Media"
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
    </div>,
    document.body
  );
}
