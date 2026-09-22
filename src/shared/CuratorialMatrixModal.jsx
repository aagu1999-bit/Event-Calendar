import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useEventsStore, useCarouselSeedStore } from "../store.js";
import {
  EVENT_TIERS, EVENT_TIER_ORDER,
  CORRIDORS, CLUSTERS, EMOTIONS,
  PIPELINE_STATUS, PIPELINE_STATUS_ORDER,
  LIMITS,
} from "./matrixEnums.js";
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
  const syncError = useEventsStore((s) => s.syncError);
  const setCarouselSeed = useCarouselSeedStore((s) => s.setSeed);
  const navigate = useNavigate();

  // Local mirror of matrix values so typing is snappy — we push each
  // change to the store on blur/select rather than every keystroke, and
  // sync back if the store's matrix changes from underneath us (e.g.
  // another device edits it).
  const [local, setLocal] = useState(() => ({ ...(event?.matrix || {}) }));
  useEffect(() => {
    setLocal({ ...(event?.matrix || {}) });
  }, [event?.id]);

  if (!open || !event) return null;

  const applyPatch = (patch) => {
    setLocal((prev) => {
      const next = { ...prev, ...patch };
      // Strip null/undefined for the store call so keys don't stay set-null
      const clean = { ...patch };
      for (const k of Object.keys(clean)) if (clean[k] === undefined) delete clean[k];
      updateEventMatrix(event.id, clean);
      return next;
    });
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
            <div style={{ fontSize: "0.72rem", color: muted, marginTop: 3 }}>
              {event.name || "Untitled event"}
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
                value={local.corridor || ""}
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
                value={local.cluster || ""}
                onChange={(e) => applyPatch({ cluster: e.target.value || undefined })}
              >
                <option value="">— pick cluster —</option>
                {CLUSTERS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={hintStyle}>Editorial axis · seeds the Substack angle</div>
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
              <input
                type="text"
                style={inputStyle}
                value={local.target_demographic || ""}
                onChange={(e) => applyPatch({ target_demographic: e.target.value })}
                placeholder="Young Professionals, Diaspora Networks"
              />
              <div style={hintStyle}>Comma-separated · shows on public filters</div>
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
            <div style={groupLabelStyle}><span style={{ width: 3, height: 12, background: orbit, borderRadius: 2, display: "inline-block" }} />Editorial POV · 1–2 sentence thesis</div>
            <textarea
              style={textareaStyle}
              value={local.editorial_pov || ""}
              onChange={(e) => applyPatch({ editorial_pov: e.target.value })}
              placeholder="Why does this space / event matter? The curatorial thesis the AI carousel prompt reads as brand-perspective context."
              maxLength={LIMITS.POV_MAX + 100}
            />
            <CharCounter current={(local.editorial_pov || "").length} max={LIMITS.POV_MAX} error={errorsByField.editorial_pov} />
          </div>

          {/* Data Points */}
          <div>
            <div style={groupLabelStyle}><span style={{ width: 3, height: 12, background: orbit, borderRadius: 2, display: "inline-block" }} />Data Points · {LIMITS.BULLETS_MIN}–{LIMITS.BULLETS_MAX} atomic bullets</div>
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
