import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { FlyerPreview } from "./FlyerPreview.jsx";
import { chronoCompare } from "./parseEvents";

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

// Priority order for the "primary" flag — the one rendered BIG and
// centered in the header (the "name on a dating profile" treatment).
// Required-field flags win over soft warnings; among required flags,
// red (NO NAME / NO DAY) beats yellow (NO TIME etc) beats gray
// (NO CITY / NO TYPE). Falls back to the first warning if nothing in
// the priority list matches.
const FLAG_PRIORITY = [
  "NO NAME", "NO DAY",                                    // red — required
  "NO TIME", "NO VENUE", "NO REGION",                     // yellow — strongly recommended
  "NO CITY", "NO TYPE",                                   // gray — recommended
  "WRONG DAY?",                                           // soft — name/day mismatch
  "ALREADY IN STORE", "SAME VENUE/DAY IN STORE",          // advisory — store collision
];
function pickPrimaryFlag(warnings) {
  if (!warnings || warnings.length === 0) return null;
  for (const pri of FLAG_PRIORITY) {
    const found = warnings.find(w => w.msg === pri);
    if (found) return found;
  }
  // REGION? carries city detail in parens — match as prefix
  const region = warnings.find(w => /^REGION\?/.test(w.msg));
  if (region) return region;
  return warnings[0];
}

// Plain-English descriptions for the big primary-flag headline. Reads
// like a directive — what the user needs to actually DO.
const FLAG_DESCRIPTION = {
  "NO NAME":   "This event needs a name",
  "NO DAY":    "Pick a day — Fri / Sat / Sun",
  "NO TIME":   "What time does it start?",
  "NO VENUE":  "Where is this event?",
  "NO REGION": "Tag a region — North / Central / South",
  "NO CITY":   "Which city?",
  "NO TYPE":   "Add a type — Party / Mixer / Brunch / …",
  "WRONG DAY?": "Event name mentions a different day than what's tagged",
  "ALREADY IN STORE": "Same name + day is already in your saved events",
  "SAME VENUE/DAY IN STORE": "Possible double-booking with something already saved",
};
function describeFlag(msg) {
  if (!msg) return "";
  if (FLAG_DESCRIPTION[msg]) return FLAG_DESCRIPTION[msg];
  if (/^REGION\?/.test(msg)) return "City might be in a different region than tagged";
  return "Review and approve when ready";
}

export function FixFlagsModal({ open, events, warnings, onEdit, onApply, onClose }) {
  // === Stable queue (frozen on open) ===
  // queueIds is built ONCE when the modal opens — never re-sorted during
  // a session. Critical for editing: when the user fills in a missing
  // field, warnings recompute upstream. If the queue re-sorted on every
  // keystroke (events without required flags get re-prioritized), the
  // currently-displayed event would silently swap to a DIFFERENT event,
  // and the user's edit would feel "lost" (it actually applied to the
  // prior event, just no longer visible). Freezing the order keeps the
  // user on the SAME event no matter what happens upstream.
  const [queueIds, setQueueIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    const byId = new Map();
    events.forEach(e => byId.set(String(e.id), e));
    const rows = [];
    Object.entries(warnings || {}).forEach(([eventId, ws]) => {
      const ev = byId.get(String(eventId));
      if (!ev) return;
      const relevant = (ws || []).filter(w => !isPartnerConflict(w.msg));
      if (relevant.length === 0) return;
      rows.push({ id: String(eventId), ev, hasRequired: ws.some(w => FIELD_FOR_FLAG[w.msg]) });
    });
    // Sort once: earliest → latest (day, then time) so the sweep is trackable;
    // events sharing a slot break the tie with required-field flags first.
    rows.sort((a, b) => {
      const c = chronoCompare(a.ev, b.ev);
      if (c !== 0) return c;
      return (a.hasRequired ? 0 : 1) - (b.hasRequired ? 0 : 1);
    });
    setQueueIds(rows.map(r => r.id));
    // We intentionally don't depend on events/warnings — the queue is a
    // snapshot of the flagged set at open-time. Live data (current event
    // values, current warnings) is read fresh in render below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live event lookup — built fresh each render from the current events
  // array. O(1) per-event lookups via the Map.
  const eventsById = useMemo(() => {
    const m = new Map();
    events.forEach(e => m.set(String(e.id), e));
    return m;
  }, [events]);

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

  // View: "table" = every flagged event listed at once (fix fields inline +
  // approve/delete per row, no swiping); "cards" = the original one-at-a-time
  // swipe flow. Table is the default — it's what "see them all at once" means.
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem("cge-flagsweep-view") === "cards" ? "cards" : "table"; } catch { return "table"; }
  });
  const changeView = (m) => { setViewMode(m); try { localStorage.setItem("cge-flagsweep-view", m); } catch {} };
  // How many rows to render initially in table mode (flagged lists can be
  // hundreds; a "show more" reveals the rest so we don't jank on open).
  const MAX_ROWS_INITIAL = 12;
  const [showAllRows, setShowAllRows] = useState(false);

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
      const idx = queueIds.findIndex(id => String(id) === String(last.id));
      if (idx >= 0) setCurrentIdx(idx);
      return h.slice(0, -1);
    });
  }, [queueIds]);

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
  // Look up the current event from the LIVE events array via the
  // stable queue ID. As the user edits, eventsById is fresh while
  // queueIds stays frozen — the user stays on the same event.
  const safeIdx = Math.min(currentIdx, Math.max(0, queueIds.length - 1));
  const currentEventId = queueIds[safeIdx];
  const currentEvent = currentEventId ? eventsById.get(String(currentEventId)) : null;
  // Live warnings for the current event. Includes BOTH non-partner
  // warnings (the ones Fix Flags is built to resolve) AND any newly-
  // formed partner conflicts (if the user's edits accidentally
  // created a DUPE/VENUE/MULTI). The non-partner ones drive the UI;
  // partner ones surface as a "→ resolve in Sweep" hint.
  const allWarningsForEvent = currentEvent ? (warnings[currentEvent.id] || []) : [];
  const currentWarnings = allWarningsForEvent.filter(w => !isPartnerConflict(w.msg));
  const newPartnerConflicts = allWarningsForEvent.filter(w => isPartnerConflict(w.msg));
  const primaryFlag = pickPrimaryFlag(currentWarnings);
  const otherFlags = currentWarnings.filter(w => w !== primaryFlag);
  const requiredFields = currentEvent ? fieldsNeedingFix(currentWarnings) : new Set();
  // ✓ enabled when every required field has a non-empty value. Soft-
  // warning-only events are always ✓-able.
  const allRequiredFilled = currentEvent
    ? Array.from(requiredFields).every(f => String(currentEvent[f] || "").trim() !== "")
    : true;
  const hasOnlySoftWarnings = currentWarnings.length > 0 && currentWarnings.every(w => isSoftWarning(w.msg));
  const approveEnabled = currentEvent && (allRequiredFilled || hasOnlySoftWarnings);
  const isLast = currentIdx >= queueIds.length - 1;
  const decidedCount = Object.keys(decisions).length;
  const deleteCount = Object.values(decisions).filter(a => a === "delete").length;
  const approveCount = Object.values(decisions).filter(a => a === "approve").length;

  // === Auto-advance: when the user decides on the current event, fire
  // a brief timeout then move forward (so they can see the decision
  // register before the card swaps). Cancel if user undoes mid-delay
  // or navigates. ===
  const prevStateRef = useRef({ idx: 0, hasDecision: false });
  useEffect(() => {
    if (viewMode !== "cards") return; // table view has no "current card" to advance
    const hasDecision = !!(currentEvent && decisions[currentEvent.id]);
    const prev = prevStateRef.current;
    prevStateRef.current = { idx: currentIdx, hasDecision };
    if (prev.idx !== currentIdx) return; // navigation — skip
    if (!prev.hasDecision && hasDecision) {
      const t = setTimeout(() => {
        if (currentIdx < queueIds.length - 1) {
          setCurrentIdx(i => i + 1);
        }
        // On the last event, do NOT auto-apply — leave the user on the
        // final card so they can review their decision count + tap Apply
        // (or undo) deliberately.
      }, 450);
      return () => clearTimeout(t);
    }
  }, [currentIdx, decisions, currentEvent, queueIds.length]);

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

  if (queueIds.length === 0) {
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

  // Empty event edge case — queueIds out of bounds (event was deleted
  // externally, or queue is empty after all decisions applied)
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

  // Per-event flag info — used by the Table view to render each flagged row
  // (its warnings, which required fields still need filling, whether Approve
  // is unlocked). Same logic the card view computes for the current event.
  const flagInfo = (ev) => {
    const all = warnings[ev.id] || [];
    const warns = all.filter(w => !isPartnerConflict(w.msg));
    const partners = all.filter(w => isPartnerConflict(w.msg));
    const required = fieldsNeedingFix(warns);
    const allFilled = Array.from(required).every(f => String(ev[f] || "").trim() !== "");
    const softOnly = warns.length > 0 && warns.every(w => isSoftWarning(w.msg));
    return { warns, partners, required, approveEnabled: allFilled || softOnly, allFilled, softOnly };
  };

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
        {/* Header — big centered primary flag, profile-name style */}
        <div style={{ padding: "12px 16px 16px", borderBottom: "1px solid rgba(245,240,232,0.08)" }}>
          {/* Top row — counter + view toggle + close button */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>
              Fix Flags · {viewMode === "table" ? `${queueIds.length} flagged` : `${currentIdx + 1} of ${queueIds.length}`}
            </div>
            <div style={{ display: "flex", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 5, overflow: "hidden" }}>
              {[["table", "▤ List"], ["cards", "▢ Cards"]].map(([k, lbl]) => (
                <button key={k} onClick={() => changeView(k)} style={{ padding: "4px 10px", border: "none", cursor: "pointer", fontSize: "0.5rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "'Syne',sans-serif", background: viewMode === k ? "rgba(229,188,79,0.2)" : "transparent", color: viewMode === k ? "#E5BC4F" : "rgba(245,240,232,0.4)" }}>{lbl}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={closeBtnStyle} title="Close (decisions discarded unless you Apply)">×</button>
          </div>
          {/* Table-mode one-liner (the big per-event flag hero below is
              cards-only — meaningless when every event is listed at once). */}
          {viewMode === "table" && (
            <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
              Fill the <span style={{ color: "#FB7185", fontWeight: 700 }}>red missing fields</span> right in each row, then <span style={{ color: "#34D399", fontWeight: 700 }}>✓ Approve</span> — or <span style={{ color: "#FB7185", fontWeight: 700 }}>✗ Delete</span>. Soft warnings (WRONG DAY?, …) approve as-is.
            </div>
          )}
          {/* PRIMARY FLAG — big, centered, color-coded by severity. This
              is the "what am I looking at" hero of the card, so it reads
              instantly on a quick mobile glance. */}
          {viewMode === "cards" && primaryFlag && (
            <>
              <div style={{
                textAlign: "center",
                fontSize: "1.6rem",
                fontFamily: "'Syne',sans-serif",
                fontWeight: 900,
                letterSpacing: 1.5,
                lineHeight: 1.1,
                color: primaryFlag.type === "red" ? "#FB7185"
                     : primaryFlag.type === "yellow" ? "#E5BC4F"
                     : "rgba(245,240,232,0.8)",
                marginBottom: 6,
              }}>
                {primaryFlag.msg}
              </div>
              <div style={{
                textAlign: "center",
                fontSize: "0.75rem",
                color: "rgba(245,240,232,0.65)",
                lineHeight: 1.4,
                marginBottom: otherFlags.length > 0 || newPartnerConflicts.length > 0 ? 10 : 0,
              }}>
                {describeFlag(primaryFlag.msg)}
              </div>
            </>
          )}
          {/* Secondary flag chips — when the event has >1 flag, the
              extras render below as small pills (centered to match the
              hero treatment above). The primary is excluded so it
              doesn't duplicate. */}
          {viewMode === "cards" && otherFlags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center", marginBottom: newPartnerConflicts.length > 0 ? 8 : 0 }}>
              {otherFlags.map((w, i) => {
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
                  }}>also: {w.msg}</span>
                );
              })}
            </div>
          )}
          {/* New partner-conflict warning — fires when the user's edits
              accidentally CREATE a DUPE/VENUE/MULTI with another event.
              Shown as a distinct gray banner so they know the change
              made things complicated. Resolving the new conflict is a
              Sweep concern, not Fix Flags — hint clearly says so. */}
          {viewMode === "cards" && newPartnerConflicts.length > 0 && (
            <div style={{
              marginTop: 6,
              padding: "8px 10px",
              background: "rgba(192,132,252,0.08)",
              border: "1px dashed rgba(192,132,252,0.45)",
              borderRadius: 4,
              fontSize: "0.65rem",
              color: "#C084FC",
              textAlign: "center",
              lineHeight: 1.4,
            }}>
              ⚠ Your edits created {newPartnerConflicts.length === 1 ? "a new conflict" : `${newPartnerConflicts.length} new conflicts`}: {newPartnerConflicts.map(w => w.msg).join(", ")} — resolve in ⚡ Sweep after.
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: "rgba(245,240,232,0.08)" }}>
          <div style={{
            width: `${(decidedCount / Math.max(1, queueIds.length)) * 100}%`,
            height: "100%",
            background: "#E5BC4F",
            transition: "width 0.2s",
          }} />
        </div>

        {/* Swipe hint — only first event, cards view */}
        {viewMode === "cards" && currentIdx === 0 && (
          <div style={{ padding: "8px 16px", fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", textAlign: "center", borderBottom: "1px solid rgba(245,240,232,0.05)", letterSpacing: 0.5 }}>
            💡 Edit highlighted fields. Swipe <strong style={{ color: "#34D399" }}>right</strong> to approve · <strong style={{ color: "#FB7185" }}>left</strong> to delete
          </div>
        )}

        {/* === TABLE VIEW — every flagged event as a row: its flags, inline
            inputs for the missing fields, and per-row Approve/Delete. Rip
            through them all without swiping one at a time. === */}
        {viewMode === "table" && (
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {(showAllRows ? queueIds : queueIds.slice(0, MAX_ROWS_INITIAL)).map((id, i) => {
              const ev = eventsById.get(String(id));
              if (!ev) return null;
              const info = flagInfo(ev);
              const dec = decisions[ev.id];
              const src = (ev.link && ev.link.trim()) || (ev.igHandle && `https://instagram.com/${String(ev.igHandle).replace(/^@+/, "").trim()}`) || "";
              // Read-only context line of the fields that AREN'T being fixed inline.
              const ctxFields = ["day", "time", "venue", "area", "region", "type"].filter(f => !info.required.has(f));
              return (
                <div key={id} style={{
                  marginBottom: 10, padding: "11px 12px", borderRadius: 8,
                  background: dec === "delete" ? "rgba(251,113,133,0.06)" : dec === "approve" ? "rgba(52,211,153,0.08)" : "rgba(245,240,232,0.03)",
                  border: "1.5px solid " + (dec === "delete" ? "rgba(251,113,133,0.4)" : dec === "approve" ? "rgba(52,211,153,0.5)" : "rgba(245,240,232,0.08)"),
                  opacity: dec === "delete" ? 0.62 : 1,
                }}>
                  <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <FlyerPreview flyerUrl={ev.flyerUrl} postUrl={src} size="thumb" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.48rem", color: "rgba(245,240,232,0.4)", letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>
                    #{i + 1}
                    {dec === "approve" && <span style={{ color: "#34D399" }}> · ✓ approving</span>}
                    {dec === "delete" && <span style={{ color: "#FB7185" }}> · ✗ deleting</span>}
                  </div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.95rem", fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.15, color: info.required.has("name") ? "#FB7185" : "#F5F0E8", marginBottom: 6 }}>
                    {ev.name || "(no name)"}
                  </div>
                  {/* Flag badges */}
                  {info.warns.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: info.required.size > 0 || ctxFields.length ? 8 : 0 }}>
                      {info.warns.map((w, wi) => {
                        const c = w.type === "red" ? "#FB7185" : w.type === "yellow" ? "#E5BC4F" : "rgba(245,240,232,0.55)";
                        return <span key={wi} style={{ padding: "2px 6px", background: `${c}18`, color: c, border: `1px solid ${c}55`, borderRadius: 3, fontSize: "0.5rem", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", fontFamily: "'Syne',sans-serif" }}>{w.msg}</span>;
                      })}
                    </div>
                  )}
                  {/* Inline fix — one control per MISSING required field */}
                  {info.required.size > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "58px 1fr", gap: "6px 8px", alignItems: "center", marginBottom: 8 }}>
                      {[...info.required].map(field => {
                        const opts = FIELD_OPTIONS[field];
                        return (
                          <div key={field} style={{ display: "contents" }}>
                            <label style={{ color: "#FB7185", fontSize: "0.55rem", letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 700 }}>{FIELD_LABEL[field]} ⚠</label>
                            {FIELD_TYPE[field] === "select" ? (
                              <select value={ev[field] || ""} onChange={e => onEdit(ev.id, { [field]: e.target.value })} style={{ ...inputStyle(true), padding: "6px 8px", fontSize: "0.78rem" }}>
                                <option value="" style={{ color: "#000" }}>—</option>
                                {opts.map(o => <option key={o} value={o} style={{ color: "#000" }}>{o}</option>)}
                              </select>
                            ) : (
                              <input value={ev[field] || ""} onChange={e => onEdit(ev.id, { [field]: e.target.value })} placeholder={FIELD_FOR_FLAG[`NO ${FIELD_LABEL[field].toUpperCase()}`]?.placeholder || ""} style={{ ...inputStyle(true), padding: "6px 8px", fontSize: "0.78rem" }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* Context line — the fields that are already filled */}
                  {ctxFields.length > 0 && (
                    <div style={{ fontSize: "0.68rem", color: "rgba(245,240,232,0.45)", marginBottom: 9, lineHeight: 1.5 }}>
                      {ctxFields.map((f, fi) => (
                        <span key={f}>{fi > 0 && <span style={{ opacity: 0.4 }}> · </span>}<span style={{ color: String(ev[f] || "").trim() ? "rgba(245,240,232,0.7)" : "rgba(245,240,232,0.28)" }}>{String(ev[f] || "").trim() || "—"}</span></span>
                      ))}
                    </div>
                  )}
                  {/* Per-row actions */}
                  <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <button onClick={() => setDecisionWithHistory(ev.id, "delete")} style={{ ...bottomActionBtnStyle(dec === "delete", "#FB7185"), flex: 1 }} title="Delete this event">✗ Delete</button>
                    <button onClick={() => info.approveEnabled && setDecisionWithHistory(ev.id, "approve")} disabled={!info.approveEnabled} style={{ ...bottomActionBtnStyle(dec === "approve", "#34D399"), flex: 1, opacity: info.approveEnabled ? 1 : 0.4, cursor: info.approveEnabled ? "pointer" : "not-allowed" }} title={info.approveEnabled ? "Approve as fixed" : "Fill the red fields first"}>
                      {info.approveEnabled ? "✓ Approve" : `${info.required.size} left`}
                    </button>
                    {src && <a href={src} target="_blank" rel="noopener noreferrer" title="Open source / IG" style={{ padding: "0 12px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", color: "#63B3ED", border: "1.5px solid rgba(99,179,237,0.4)", borderRadius: 6, fontSize: "0.75rem", fontWeight: 800, textDecoration: "none", fontFamily: "'Syne',sans-serif" }}>↗</a>}
                  </div>
                  </div>
                  </div>
                </div>
              );
            })}
            {!showAllRows && queueIds.length > MAX_ROWS_INITIAL && (
              <button onClick={() => setShowAllRows(true)} style={{ width: "100%", padding: "10px 14px", background: "rgba(192,132,252,0.08)", color: "#C084FC", border: "1px dashed rgba(192,132,252,0.45)", borderRadius: 6, fontSize: "0.7rem", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", fontFamily: "'Syne',sans-serif" }}>
                Show {queueIds.length - MAX_ROWS_INITIAL} more flagged events
              </button>
            )}
          </div>
        )}

        {/* Editable card — fills the body (cards view only) */}
        {viewMode === "cards" && (
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

          {/* Source link — open the event's IG post / profile in a new
              tab so the user can verify the source before approving /
              deleting. Hidden when no link or handle is available. */}
          {(() => {
            const url = (currentEvent.link && currentEvent.link.trim())
                     || (currentEvent.igHandle && `https://instagram.com/${String(currentEvent.igHandle).replace(/^@+/, "").trim()}`)
                     || "";
            if (!url) return null;
            return (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  marginBottom: 12,
                  padding: "6px 10px",
                  background: "rgba(99,179,237,0.08)",
                  color: "#63B3ED",
                  border: "1px solid rgba(99,179,237,0.4)",
                  borderRadius: 4,
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  textDecoration: "none",
                  fontFamily: "'Syne',sans-serif",
                }}
                title="Open the source post / IG profile in a new tab"
              >↗ Source</a>
            );
          })()}

          {/* Flyer preview — read the actual poster to confirm the details. */}
          {currentEvent.flyerUrl && (
            <div style={{ marginBottom: 14 }}>
              <FlyerPreview
                flyerUrl={currentEvent.flyerUrl}
                postUrl={(currentEvent.link && currentEvent.link.trim()) || (currentEvent.igHandle && `https://instagram.com/${String(currentEvent.igHandle).replace(/^@+/, "").trim()}`) || ""}
                size="hero"
              />
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
        )}

        {/* Footer — cards view: Back / Undo / Delete / Approve on the current
            event. Table view approves/deletes per row, so it just needs Undo. */}
        {viewMode === "cards" ? (
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
        ) : (
          <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(245,240,232,0.08)", display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={undoLast} disabled={history.length === 0} style={{ ...iconBtnStyle(history.length === 0), width: "auto", padding: "10px 14px", background: history.length === 0 ? "transparent" : "rgba(192,132,252,0.08)", color: history.length === 0 ? "rgba(245,240,232,0.25)" : "#C084FC", borderColor: history.length === 0 ? "rgba(245,240,232,0.12)" : "rgba(192,132,252,0.4)" }} title="Undo the most recent Approve/Delete">↶ Undo</button>
            <div style={{ flex: 1, textAlign: "center", fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: 0.5 }}>
              {decidedCount === 0 ? "Approve or delete each flagged event above" : <><span style={{ color: "#34D399" }}>{approveCount} approve</span> · <span style={{ color: "#FB7185" }}>{deleteCount} delete</span></>}
            </div>
          </div>
        )}

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
