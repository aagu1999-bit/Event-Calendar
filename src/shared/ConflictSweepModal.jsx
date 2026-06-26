import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

// Mobile Sweep Mode — one-conflict-group-at-a-time triage modal.
// Renders full-screen on mobile so users with small screens can resolve
// DUPE / VENUE / MULTI conflict groups without scrolling through the
// full pending list.
//
// Flow:
//   1. Open modal → extracts groups from warnings (only #N-tagged
//      clusters: DUPE, VENUE, MULTI — these have partner events to
//      compare against)
//   2. Show ONE group at a time as a card stack
//   3. User marks each event "Keep" or "Delete" — group shortcuts
//      let them blanket-decide a group in one tap (Keep First / Keep All /
//      Delete All)
//   4. Tap Next → advance to the next group
//   5. Last group → tap "Apply N decisions" → modal closes and emits
//      the IDs to delete via onApplyDeletions
//
// Props:
//   open                 — boolean
//   events               — pending events array (Event[])
//   warnings             — map { eventId: [{ type, msg }, ...] } from
//                           computeWarnings(pending)
//   onClose()            — modal dismissed
//   onApplyDeletions(ids[]) — fires once with array of event IDs to delete

export function ConflictSweepModal({ open, events, warnings, onClose, onApplyDeletions }) {
  // Extract conflict groups — only the #N-tagged kind have partners.
  // groupKey = "DUPE-3" / "VENUE-1" / "MULTI-2"
  const groups = useMemo(() => {
    if (!open) return [];
    const groupMap = {};
    Object.entries(warnings || {}).forEach(([eventId, ws]) => {
      (ws || []).forEach(w => {
        const m = String(w.msg || "").match(/^(DUPE|VENUE|MULTI)\s+#(\d+)/);
        if (!m) return;
        const key = `${m[1]}-${m[2]}`;
        if (!groupMap[key]) {
          groupMap[key] = { key, type: m[1], num: m[2], ids: [], severity: w.type };
        }
        if (!groupMap[key].ids.includes(eventId)) {
          groupMap[key].ids.push(eventId);
        }
      });
    });
    // Filter to only groups with 2+ events (a "conflict" needs partners)
    // Sort by severity (DUPE > MULTI > VENUE) so the user resolves the
    // more impactful conflicts first.
    const ORDER = { DUPE: 0, MULTI: 1, VENUE: 2 };
    return Object.values(groupMap)
      .filter(g => g.ids.length >= 2)
      .sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9));
  }, [warnings, open]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [decisions, setDecisions] = useState({}); // eventId → "keep" | "delete"

  useEffect(() => {
    if (open) {
      setCurrentIdx(0);
      setDecisions({});
    }
  }, [open]);

  const setDecision = useCallback((eventId, action) => {
    setDecisions(prev => ({ ...prev, [eventId]: action }));
  }, []);

  if (!open) return null;

  // Edge case — opened with no conflicts to resolve. Show a brief
  // confirmation screen so the user understands why nothing's there.
  if (groups.length === 0) {
    return createPortal(
      <div onClick={onClose} style={overlayStyle}>
        <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, padding: 32 }}>
          <div style={{ fontSize: "1.05rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, marginBottom: 10 }}>
            ✓ No conflicts to resolve
          </div>
          <div style={{ fontSize: "0.8rem", color: "rgba(245,240,232,0.7)", marginBottom: 18, lineHeight: 1.5 }}>
            Your pending list has no DUPE / VENUE / MULTI groups. Missing-field warnings (NO NAME, NO DAY, etc.) still need manual fixes — those don't fit Sweep mode since they aren't partner conflicts.
          </div>
          <button onClick={onClose} style={primaryBtnStyle}>Close</button>
        </div>
      </div>,
      document.body
    );
  }

  const currentGroup = groups[currentIdx];
  const groupEvents = currentGroup.ids
    .map(id => events.find(e => String(e.id) === String(id)))
    .filter(Boolean);

  const keepFirstOnly = () => {
    setDecisions(prev => {
      const next = { ...prev };
      groupEvents.forEach((ev, i) => { next[ev.id] = i === 0 ? "keep" : "delete"; });
      return next;
    });
  };
  const keepAll = () => {
    setDecisions(prev => {
      const next = { ...prev };
      groupEvents.forEach(ev => { next[ev.id] = "keep"; });
      return next;
    });
  };
  const deleteAll = () => {
    setDecisions(prev => {
      const next = { ...prev };
      groupEvents.forEach(ev => { next[ev.id] = "delete"; });
      return next;
    });
  };

  const allDecided = groupEvents.every(ev => decisions[ev.id]);
  const isLast = currentIdx >= groups.length - 1;

  const handleNext = () => {
    if (!allDecided) return;
    if (isLast) {
      const toDelete = Object.entries(decisions)
        .filter(([, action]) => action === "delete")
        .map(([id]) => id);
      onApplyDeletions(toDelete);
      onClose();
    } else {
      setCurrentIdx(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentIdx > 0) setCurrentIdx(prev => prev - 1);
  };

  const decidedCount = Object.keys(decisions).length;
  const deleteCount = Object.values(decisions).filter(a => a === "delete").length;

  // Severity colors — DUPE = yellow (likely real dupe), MULTI = orange
  // (might be both), VENUE = gray (just same place, different events)
  const severityColor = currentGroup.type === "DUPE" ? "#E5BC4F"
                      : currentGroup.type === "MULTI" ? "#FB923C"
                      : "rgba(245,240,232,0.45)";

  return createPortal(
    <div style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(245,240,232,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>
              Sweep Conflicts · Group {currentIdx + 1} of {groups.length}
            </div>
            <div style={{ fontSize: "1rem", fontFamily: "'Syne',sans-serif", fontWeight: 800, letterSpacing: 1, marginTop: 3, color: severityColor }}>
              {currentGroup.type} #{currentGroup.num}
            </div>
            <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", marginTop: 2 }}>
              {currentGroup.type === "DUPE" && "Same NAME + DAY — likely a true duplicate"}
              {currentGroup.type === "VENUE" && "Same VENUE + DAY — different events at the same spot"}
              {currentGroup.type === "MULTI" && "Same NAME + VENUE + TIME — listed twice across days"}
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle} title="Close">×</button>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: "rgba(245,240,232,0.08)" }}>
          <div style={{ width: `${((currentIdx + (allDecided ? 1 : 0)) / groups.length) * 100}%`, height: "100%", background: "#34D399", transition: "width 0.2s" }} />
        </div>

        {/* Group shortcuts */}
        <div style={{ padding: "12px 16px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid rgba(245,240,232,0.05)" }}>
          <button onClick={keepFirstOnly} style={shortcutBtnStyle("#34D399")}>↑ Keep first · ✗ rest</button>
          <button onClick={keepAll} style={shortcutBtnStyle("#63B3ED")}>✓ Keep all</button>
          <button onClick={deleteAll} style={shortcutBtnStyle("#FB7185")}>✗ Delete all</button>
        </div>

        {/* Event cards */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {groupEvents.map((ev, i) => {
            const decision = decisions[ev.id];
            return (
              <div
                key={ev.id}
                style={{
                  padding: 12,
                  marginBottom: 10,
                  background: decision === "delete" ? "rgba(251,113,133,0.06)"
                            : decision === "keep" ? "rgba(52,211,153,0.06)"
                            : "rgba(245,240,232,0.03)",
                  border: "1.5px solid " + (decision === "delete" ? "rgba(251,113,133,0.45)"
                                          : decision === "keep" ? "rgba(52,211,153,0.45)"
                                          : "rgba(245,240,232,0.08)"),
                  borderRadius: 6,
                  opacity: decision === "delete" ? 0.65 : 1,
                  transition: "all 0.15s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 3, fontWeight: 600 }}>
                      Event {i + 1}{i === 0 ? " · first" : ""}
                    </div>
                    <div style={{ fontSize: "0.95rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, lineHeight: 1.2, color: "#F5F0E8" }}>
                      {ev.name || "(no name)"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      onClick={() => setDecision(ev.id, "keep")}
                      style={actionBtnStyle(decision === "keep", "#34D399")}
                      title="Keep this event"
                    >✓</button>
                    <button
                      onClick={() => setDecision(ev.id, "delete")}
                      style={actionBtnStyle(decision === "delete", "#FB7185")}
                      title="Delete this event"
                    >✗</button>
                  </div>
                </div>
                <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.65)", lineHeight: 1.5 }}>
                  <div>{[ev.day, ev.time].filter(Boolean).join(" · ") || "no day/time"}</div>
                  <div>{[ev.venue, ev.area, ev.region].filter(Boolean).join(" · ") || "no venue"}</div>
                  {ev.type && <div style={{ marginTop: 3, color: "rgba(245,240,232,0.4)" }}>{ev.type}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer — back / next */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(245,240,232,0.08)", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={handleBack}
            disabled={currentIdx === 0}
            style={{
              padding: "10px 14px",
              background: "transparent",
              color: currentIdx === 0 ? "rgba(245,240,232,0.25)" : "rgba(245,240,232,0.7)",
              border: "1px solid rgba(245,240,232,0.12)",
              borderRadius: 4,
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: currentIdx === 0 ? "not-allowed" : "pointer",
              fontFamily: "'Syne',sans-serif",
            }}
          >← Back</button>
          <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", flex: 1, textAlign: "center", letterSpacing: 0.5 }}>
            {decidedCount} / {Object.keys(decisions).length + groupEvents.filter(e => !decisions[e.id]).length} decided
            {deleteCount > 0 && <> · <span style={{ color: "#FB7185" }}>{deleteCount} to delete</span></>}
          </div>
          <button
            onClick={handleNext}
            disabled={!allDecided}
            style={{
              padding: "10px 16px",
              background: allDecided ? "#E5BC4F" : "rgba(229,188,79,0.25)",
              color: "#000",
              border: "none",
              borderRadius: 4,
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: allDecided ? "pointer" : "not-allowed",
              fontFamily: "'Syne',sans-serif",
              opacity: allDecided ? 1 : 0.7,
            }}
          >{isLast ? `Apply (${deleteCount} delete)` : "Next →"}</button>
        </div>
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
const shortcutBtnStyle = (color) => ({
  flex: 1,
  minWidth: "30%",
  padding: "8px 6px",
  background: "transparent",
  color,
  border: `1px solid ${color}66`,
  borderRadius: 4,
  fontSize: "0.6rem",
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  cursor: "pointer",
  fontFamily: "'Syne',sans-serif",
});
const actionBtnStyle = (active, color) => ({
  width: 36,
  height: 36,
  borderRadius: 4,
  border: "1.5px solid " + (active ? color : "rgba(245,240,232,0.15)"),
  background: active ? `${color}22` : "transparent",
  color: active ? color : "rgba(245,240,232,0.4)",
  fontSize: "1.05rem",
  fontWeight: 800,
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
});
