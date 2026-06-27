import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

// Fix Flags — single-event triage for warnings that AREN'T partner
// conflicts (those go through ConflictSweepModal / Sweep).
//
// Flags it handles:
//   Required (red/yellow "NO X"): NO NAME, NO DAY, NO TIME, NO VENUE,
//     NO REGION, NO CITY, NO TYPE. Resolved by filling the field.
//   Soft warnings: WRONG DAY?, REGION? (...), ALREADY IN STORE, SAME
//     VENUE/DAY IN STORE. ✓ always allowed as "Keep anyway" — user
//     confirms the warning is intentional.
//
// UX (Tinder-card pattern, same as Sweep):
//   - One event per screen, big card, takes most of the viewport
//   - Bottom row: [← Back] [✗ Delete] [✓ Approve] full-width
//   - Swipe right = Approve, swipe left = Delete
//   - Required-field flags highlight the input(s) in red; ✓ button is
//     disabled until all required fields for THIS event are non-empty
//   - Edits live-commit via onEdit (warnings recompute upstream, flags
//     clear in real-time)
//   - Approve/Delete decisions accumulate; commit batch on Apply at the
//     end of the queue
//   - ↶ Undo reverses the most recent Approve/Delete decision
//
// Props:
//   open        — boolean
//   events      — pending Event[] (the FULL pending list; modal filters
//                  to the flagged subset internally)
//   warnings    — { eventId: [{type, msg}, ...] } from computeWarnings
//   onEdit(id, patch) — apply field edits live so warnings recompute
//   onApply({approveIds, deleteIds}) — commit decisions on close
//   onClose()

// === Field metadata ===
// Maps a warning's "NO X" message to (a) the field name on the event,
// (b) the input control type, and (c) a label for the UI.
const FIELD_FOR_FLAG = {
  "NO NAME":   { field: "name",   label: "Name",   type: "text" },
  "NO DAY":    { field: "day",    label: "Day",    type: "select", options: ["Fri", "Sat", "Sun"] },
  "NO TIME":   { field: "time",   label: "Time",   type: "text",   placeholder: "e.g. 8 PM" },
  "NO VENUE":  { field: "venue",  label: "Venue",  type: "text" },
  "NO REGION": { field: "region", label: "Region", type: "select", options: ["North", "Central", "South"] },
  "NO CITY":   { field: "area",   label: "City",   type: "text" },
  "NO TYPE":   { field: "type",   label: "Type",   type: "text",   placeholder: "e.g. PARTY · MIXER · BRUNCH" },
};

// All editable fields shown on the card, in display order. The flagged
// ones get a red border + jump-to-top treatment; the rest sit below as
// "context fields" the user can still tweak.
const ALL_FIELDS = ["name", "day", "time", "venue", "area", "region", "type", "link", "igHandle"];
const FIELD_LABEL = {
  name: "Name", day: "Day", time: "Time", venue: "Venue", area: "City",
  region: "Region", type: "Type", link: "Link", igHandle: "IG Handle",
};
const FIELD_TYPE = {
  name: "text", day: "select", time: "text", venue: "text", area: "text",
  region: "select", type: "text", link: "text", igHandle: "text",
};
const FIELD_OPTIONS = {
  day: ["Fri", "Sat", "Sun"],
  region: ["North", "Central", "South"],
};

// For each event's warning list, return the set of fields that are
// flagged as missing. The ✓ button only activates when every flagged
// field has a non-empty value.
function fieldsNeedingFix(eventWarnings) {
  const need = new Set();
  for (const w of eventWarnings || []) {
    const meta = FIELD_FOR_FLAG[w.msg];
    if (meta) need.add(meta.field);
  }
  return need;
}

// Soft warnings (no field to fix — user just confirms). Listed here so
// the ✓ button stays enabled even when they're the only flags present.
const SOFT_WARNING_PATTERNS = [
  /^WRONG DAY\?/,
  /^REGION\?/,
  /^ALREADY IN STORE/,
  /^SAME VENUE\/DAY IN STORE/,
];
function isSoftWarning(msg) {
  return SOFT_WARNING_PATTERNS.some(re => re.test(String(msg || "")));
}

// Partner-conflict warnings — these have their own modal (Sweep) and
// should NOT bring an event into Fix Flags scope.
function isPartnerConflict(msg) {
  return /^(DUPE|VENUE|MULTI)\s+#\d+/.test(String(msg || ""));
}

export function FixFlagsModal({ open, events, warnings, onEdit, onApply, onClose }) {
  // === Compute the flagged-event queue ===
  // An event qualifies if it has at least one non-partner warning.
  // Sorted: required-field flags first, then soft warnings.
  const flaggedQueue = useMemo(() => {
    if (!open) return [];
    const byId = new Map();
    events.forEach(e => byId.set(String(e.id), e));
    const rows = [];
    Object.entries(warnings || {}).forEach(([eventId, ws]) => {
      const ev = byId.get(String(eventId));
      if (!ev) return;
      const relevant = (ws || []).filter(w => !isPartnerConflict(w.msg));
      if (relevant.length === 0) return;
      rows.push({ event: ev, warnings: relevant });
    });
    // Sort: events with required-field flags first (most blocking)
    rows.sort((a, b) => {
      const aReq = a.warnings.some(w => FIELD_FOR_FLAG[w.msg]) ? 0 : 1;
      const bReq = b.warnings.some(w => FIELD_FOR_FLAG[w.msg]) ? 0 : 1;
      return aReq - bReq;
    });
    return rows;
  }, [open, events, warnings]);

  // === Carousel state ===
  const [currentIdx, setCurrentIdx] = useState(0);
  // Decisions accumulate per session: eventId → "approve" | "delete".
  // Applied as a batch when the user finishes the last event (or
  // dismisses early via Apply now).
  const [decisions, setDecisions] = useState({});
  // History stack for ↶ Undo — { id, prev: prior decision or null }
  const [history, setHistory] = useState([]);

  // === Swipe state ===
  const [swipingId, setSwipingId] = useState(null);
  const [swipeX, setSwipeX] = useState(0);
  const swipeStartRef = useRef({});
  const rafRef = useRef(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setCurrentIdx(0);
      setDecisions({});
      setHistory([]);
      setSwipingId(null);
      setSwipeX(0);
    }
  }, [open]);

  // Final cleanup on unmount — cancel any in-flight animation frame
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Reset swipe state when the current event changes (auto-advance or
  // Back/Next). Without this, a stale translateX could carry over.
  useEffect(() => {
    setSwipingId(null);
    setSwipeX(0);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [currentIdx]);

  // Record an approve/delete decision, pushing the previous value onto
  // history so ↶ Undo can revert.
  const setDecisionWithHistory = useCallback((eventId, action) => {
    setDecisions(prev => {
      const prevAction = prev[eventId] ?? null;
      if (prevAction === action) return prev;
      setHistory(h => [...h, { id: eventId, prev: prevAction }]);
      return { ...prev, [eventId]: action };
    });
  }, []);

  const undoLast = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setDecisions(d => {
        const next = { ...d };
        if (last.prev === null) delete next[last.id];
        else next[last.id] = last.prev;
        return next;
      });
      // Step back to the event that was undone so the user lands on it.
      const idx = flaggedQueue.findIndex(r => String(r.event.id) === String(last.id));
      if (idx >= 0) setCurrentIdx(idx);
      return h.slice(0, -1);
    });
  }, [flaggedQueue]);

  // Apply decisions to the parent and close. Approve = mark as vetted;
  // Delete = remove from pending. Events with no decision stay
  // untouched in pending.
  const applyAndClose = useCallback(() => {
    const approveIds = Object.entries(decisions).filter(([, a]) => a === "approve").map(([id]) => id);
    const deleteIds = Object.entries(decisions).filter(([, a]) => a === "delete").map(([id]) => id);
    onApply({ approveIds, deleteIds });
    onClose();
  }, [decisions, onApply, onClose]);

  // === Current event computations (computed ALWAYS — never inside an
  // early-return so the hook order stays stable) ===
  const safeIdx = Math.min(currentIdx, Math.max(0, flaggedQueue.length - 1));
  const currentRow = flaggedQueue[safeIdx];
  const currentEvent = currentRow?.event;
  const currentWarnings = currentRow?.warnings || [];
  const requiredFields = currentEvent ? fieldsNeedingFix(currentWarnings) : new Set();
  // ✓ enabled when every required field has a non-empty value. Soft-
  // warning-only events are always ✓-able.
  const allRequiredFilled = currentEvent
    ? Array.from(requiredFields).every(f => String(currentEvent[f] || "").trim() !== "")
    : true;
  const hasOnlySoftWarnings = currentWarnings.length > 0 && currentWarnings.every(w => isSoftWarning(w.msg));
  const approveEnabled = currentEvent && (allRequiredFilled || hasOnlySoftWarnings);
  const isLast = currentIdx >= flaggedQueue.length - 1;
  const decidedCount = Object.keys(decisions).length;
  const deleteCount = Object.values(decisions).filter(a => a === "delete").length;
  const approveCount = Object.values(decisions).filter(a => a === "approve").length;

  // === Auto-advance: when the user decides on the current event, fire
  // a brief timeout then move forward (so they can see the decision
  // register before the card swaps). Cancel if user undoes mid-delay
  // or navigates. ===
  const prevStateRef = useRef({ idx: 0, hasDecision: false });
  useEffect(() => {
    const hasDecision = !!(currentEvent && decisions[currentEvent.id]);
    const prev = prevStateRef.current;
    prevStateRef.current = { idx: currentIdx, hasDecision };
    if (prev.idx !== currentIdx) return; // navigation — skip
    if (!prev.hasDecision && hasDecision) {
      const t = setTimeout(() => {
        if (currentIdx < flaggedQueue.length - 1) {
          setCurrentIdx(i => i + 1);
        }
        // On the last event, do NOT auto-apply — leave the user on the
        // final card so they can review their decision count + tap Apply
        // (or undo) deliberately.
      }, 450);
      return () => clearTimeout(t);
    }
  }, [currentIdx, decisions, currentEvent, flaggedQueue.length]);

  // === Swipe handlers ===
  const SWIPE_THRESHOLD = 80;
  const onTouchStart = (id) => (e) => {
    if (e.touches?.[0]) {
      swipeStartRef.current[id] = e.touches[0].clientX;
      setSwipingId(id);
      setSwipeX(0);
    }
  };
  const onTouchMove = (id) => (e) => {
    if (swipingId !== id) return;
    const startX = swipeStartRef.current[id];
    if (startX == null || !e.touches?.[0]) return;
    const next = e.touches[0].clientX - startX;
    // rAF-throttle the setState so 60+ touchmoves/sec don't flood React
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      setSwipeX(next);
      rafRef.current = null;
    });
  };
  const onTouchEnd = (id) => () => {
    if (swipingId !== id) return;
    if (swipeX > SWIPE_THRESHOLD && approveEnabled) {
      setDecisionWithHistory(id, "approve");
    } else if (swipeX < -SWIPE_THRESHOLD) {
      setDecisionWithHistory(id, "delete");
    }
    setSwipingId(null);
    setSwipeX(0);
  };

  // === Inline edit ===
  // Live-edits commit to the parent. warnings recompute upstream → the
  // requiredFields set + approveEnabled update without modal state.
  const handleFieldChange = (field, value) => {
    if (!currentEvent) return;
    onEdit(currentEvent.id, { [field]: value });
  };

  // Now we can do the early returns — all hooks above have already run
  // unconditionally on every render.
  if (!open) return null;

  if (flaggedQueue.length === 0) {
    return createPortal(
      <div onClick={onClose} style={overlayStyle}>
        <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, padding: 32 }}>
          <div style={{ fontSize: "1.05rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, marginBottom: 10 }}>
            ✓ No flags to fix
          </div>
          <div style={{ fontSize: "0.8rem", color: "rgba(245,240,232,0.7)", marginBottom: 18, lineHeight: 1.5 }}>
            Every flagged event is a partner conflict — those clear through <strong>⚡ Sweep</strong>, not here. Or your pending list is fully clean.
          </div>
          <button onClick={onClose} style={primaryBtnStyle}>Close</button>
        </div>
      </div>,
      document.body
    );
  }

  // Empty event edge case — flaggedQueue out of bounds
  if (!currentEvent) {
    return createPortal(
      <div onClick={onClose} style={overlayStyle}>
        <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, padding: 32 }}>
          <div style={{ fontSize: "1.05rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, marginBottom: 10 }}>
            ✓ All flags handled
          </div>
          <button onClick={applyAndClose} style={primaryBtnStyle}>Apply {decidedCount} decisions</button>
        </div>
      </div>,
      document.body
    );
  }

  const dx = swipingId === currentEvent.id ? swipeX : 0;
  const decision = decisions[currentEvent.id];
  const swipeRatio = Math.max(-1, Math.min(1, dx / SWIPE_THRESHOLD));
  const swipeBgColor = dx > 0 ? `rgba(52,211,153,${0.06 + Math.abs(swipeRatio) * 0.16})`
                    : dx < 0 ? `rgba(251,113,133,${0.06 + Math.abs(swipeRatio) * 0.16})`
                    : null;

  // Determine if this event's flags are all soft (no field-fix needed)
  // — affects the approve button label ("Keep anyway" vs "✓ Approve").
  const approveLabel = (allRequiredFilled || requiredFields.size === 0)
    ? "✓ Approve"
    : `${requiredFields.size} field${requiredFields.size === 1 ? "" : "s"} left`;

  return createPortal(
    <div style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(245,240,232,0.08)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>
                Fix Flags · {currentIdx + 1} of {flaggedQueue.length}
              </div>
              <div style={{ fontSize: "0.85rem", fontFamily: "'Syne',sans-serif", fontWeight: 800, letterSpacing: 1, marginTop: 3, color: "#E5BC4F" }}>
                {currentWarnings.length} flag{currentWarnings.length === 1 ? "" : "s"} on this event
              </div>
            </div>
            <button onClick={onClose} style={closeBtnStyle} title="Close (decisions discarded unless you Apply)">×</button>
          </div>
          {/* Active flag chips — name what's wrong concisely */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {currentWarnings.map((w, i) => {
              const severity = w.type === "red" ? "#FB7185"
                            : w.type === "yellow" ? "#E5BC4F"
                            : "rgba(245,240,232,0.55)";
              return (
                <span key={i} style={{
                  padding: "3px 7px",
                  background: `${severity}15`,
                  color: severity,
                  border: `1px solid ${severity}55`,
                  borderRadius: 3,
                  fontSize: "0.55rem",
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  fontFamily: "'Syne',sans-serif",
                }}>{w.msg}</span>
              );
            })}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: "rgba(245,240,232,0.08)" }}>
          <div style={{
            width: `${((decidedCount) / flaggedQueue.length) * 100}%`,
            height: "100%",
            background: "#E5BC4F",
            transition: "width 0.2s",
          }} />
        </div>

        {/* Swipe hint — only first event */}
        {currentIdx === 0 && (
          <div style={{ padding: "8px 16px", fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", textAlign: "center", borderBottom: "1px solid rgba(245,240,232,0.05)", letterSpacing: 0.5 }}>
            💡 Edit highlighted fields. Swipe <strong style={{ color: "#34D399" }}>right</strong> to approve · <strong style={{ color: "#FB7185" }}>left</strong> to delete
          </div>
        )}

        {/* Editable card — fills the body */}
        <div
          onTouchStart={onTouchStart(currentEvent.id)}
          onTouchMove={onTouchMove(currentEvent.id)}
          onTouchEnd={onTouchEnd(currentEvent.id)}
          onTouchCancel={onTouchEnd(currentEvent.id)}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 16px 8px",
            position: "relative",
            transform: dx ? `translateX(${dx}px)` : "translateX(0)",
            transition: swipingId === currentEvent.id ? "none" : "transform 0.22s",
            background: swipeBgColor || "transparent",
            touchAction: "pan-y",
          }}
        >
          {/* Swipe direction hint overlay */}
          {swipingId === currentEvent.id && Math.abs(dx) > 12 && (
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: dx > 0 ? "flex-start" : "flex-end",
              paddingLeft: dx > 0 ? 24 : 0, paddingRight: dx < 0 ? 24 : 0,
              fontSize: "1.8rem", fontFamily: "'Syne',sans-serif", fontWeight: 900,
              color: dx > 0 ? "#34D399" : "#FB7185",
              pointerEvents: "none",
              letterSpacing: 1,
            }}>
              {dx > 0 ? "✓ APPROVE" : "✗ DELETE"}
            </div>
          )}

          {/* Field stack — flagged fields first (highlighted), then
              context fields below */}
          {ALL_FIELDS.map(field => {
            const isFlagged = requiredFields.has(field);
            const value = currentEvent[field] || "";
            const ftype = FIELD_TYPE[field];
            const opts = FIELD_OPTIONS[field];
            return (
              <div key={field} style={{ marginBottom: 10 }}>
                <label style={{
                  display: "block",
                  fontSize: "0.55rem",
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  color: isFlagged ? "#FB7185" : "rgba(245,240,232,0.45)",
                  marginBottom: 3,
                  fontWeight: 700,
                  fontFamily: "'Syne',sans-serif",
                }}>
                  {FIELD_LABEL[field]}{isFlagged && " ⚠"}
                </label>
                {ftype === "select" ? (
                  <select
                    value={value}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    style={inputStyle(isFlagged)}
                  >
                    <option value="" style={{ color: "#000" }}>—</option>
                    {opts.map(o => <option key={o} value={o} style={{ color: "#000" }}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => handleFieldChange(field, e.target.value)}
                    placeholder={FIELD_FOR_FLAG[`NO ${FIELD_LABEL[field].toUpperCase()}`]?.placeholder || ""}
                    style={inputStyle(isFlagged)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer — Back / Undo / Delete / Approve */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(245,240,232,0.08)", display: "grid", gridTemplateColumns: "auto auto 1fr 1fr", gap: 6, alignItems: "stretch" }}>
          <button
            onClick={() => currentIdx > 0 && setCurrentIdx(i => i - 1)}
            disabled={currentIdx === 0}
            style={iconBtnStyle(currentIdx === 0)}
            title="Previous event"
          >←</button>
          <button
            onClick={undoLast}
            disabled={history.length === 0}
            style={{
              ...iconBtnStyle(history.length === 0),
              background: history.length === 0 ? "transparent" : "rgba(192,132,252,0.08)",
              color: history.length === 0 ? "rgba(245,240,232,0.25)" : "#C084FC",
              borderColor: history.length === 0 ? "rgba(245,240,232,0.12)" : "rgba(192,132,252,0.4)",
            }}
            title="Undo the most recent Approve/Delete"
          >↶</button>
          <button
            onClick={() => setDecisionWithHistory(currentEvent.id, "delete")}
            style={bottomActionBtnStyle(decision === "delete", "#FB7185")}
            title="Delete this event"
          >✗ Delete</button>
          <button
            onClick={() => approveEnabled && setDecisionWithHistory(currentEvent.id, "approve")}
            disabled={!approveEnabled}
            style={{
              ...bottomActionBtnStyle(decision === "approve", "#34D399"),
              opacity: approveEnabled ? 1 : 0.4,
              cursor: approveEnabled ? "pointer" : "not-allowed",
            }}
            title={approveEnabled ? "Approve as fixed" : "Fill the highlighted fields first"}
          >{approveLabel}</button>
        </div>

        {/* Apply bar — shows up once the user has decided on at least
            one event. Gives them a way to commit + close without
            walking through every remaining flagged event. */}
        {decidedCount > 0 && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(245,240,232,0.05)", display: "flex", alignItems: "center", gap: 8, background: "#0a0a0a" }}>
            <div style={{ flex: 1, fontSize: "0.6rem", color: "rgba(245,240,232,0.55)", letterSpacing: 0.5 }}>
              <span style={{ color: "#34D399" }}>{approveCount} approve</span>
              <span style={{ margin: "0 6px", opacity: 0.4 }}>·</span>
              <span style={{ color: "#FB7185" }}>{deleteCount} delete</span>
              {isLast && <span style={{ marginLeft: 6, opacity: 0.6 }}>· last event</span>}
            </div>
            <button
              onClick={applyAndClose}
              style={{
                padding: "8px 14px",
                background: "#E5BC4F",
                color: "#000",
                border: "none",
                borderRadius: 4,
                fontSize: "0.7rem",
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
              }}
            >Apply ({decidedCount})</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// === styles ===
const overlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 9999,
  background: "rgba(0,0,0,0.92)",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
};
const modalStyle = {
  display: "flex",
  flexDirection: "column",
  background: "#0f0f0f",
  color: "#F5F0E8",
  fontFamily: "'DM Sans',sans-serif",
  width: "100%",
  maxWidth: 520,
  maxHeight: "100vh",
};
const closeBtnStyle = {
  background: "transparent",
  border: "none",
  color: "rgba(245,240,232,0.55)",
  fontSize: "1.5rem",
  cursor: "pointer",
  lineHeight: 1,
  padding: "0 4px",
};
const primaryBtnStyle = {
  padding: "10px 18px",
  background: "#E5BC4F",
  color: "#000",
  border: "none",
  borderRadius: 4,
  fontSize: "0.72rem",
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
  cursor: "pointer",
  fontFamily: "'Syne',sans-serif",
};
const inputStyle = (flagged) => ({
  width: "100%",
  padding: "10px 12px",
  background: flagged ? "rgba(251,113,133,0.08)" : "#111",
  border: flagged ? "1.5px solid rgba(251,113,133,0.55)" : "1px solid rgba(245,240,232,0.08)",
  borderRadius: 4,
  color: "#F5F0E8",
  fontFamily: "'DM Sans',sans-serif",
  fontSize: "0.85rem",
  outline: "none",
  boxSizing: "border-box",
});
const iconBtnStyle = (disabled) => ({
  width: 40,
  padding: "10px 0",
  background: "transparent",
  color: disabled ? "rgba(245,240,232,0.25)" : "rgba(245,240,232,0.7)",
  border: "1px solid rgba(245,240,232,0.12)",
  borderRadius: 4,
  fontSize: "0.95rem",
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: "'Syne',sans-serif",
});
const bottomActionBtnStyle = (active, color) => ({
  padding: "10px 8px",
  borderRadius: 6,
  border: "1.5px solid " + (active ? color : `${color}55`),
  background: active ? `${color}22` : "transparent",
  color: active ? color : `${color}cc`,
  fontSize: "0.72rem",
  fontWeight: 800,
  letterSpacing: 0.8,
  textTransform: "uppercase",
  cursor: "pointer",
  fontFamily: "'Syne',sans-serif",
});
