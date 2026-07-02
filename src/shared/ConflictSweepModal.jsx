import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

// Condensed, highly legible display face for the event name — scoped to the
// Sweep only (not tool-wide) so the title is easy to read at a glance while
// triaging. 'Oswald Local' is bundled (see index.css @font-face).
// Bebas Neue (loaded via the Google Fonts link in index.html) is the tall,
// condensed, high-legibility face for the event name. 'Oswald Local' is the
// bundled fallback so the title stays readable OFFLINE, where the CDN font
// can't load.
const SWEEP_TITLE_FONT = "'Bebas Neue', 'Oswald Local', 'Oswald', 'Syne', sans-serif";

// Mobile Sweep Mode — one-conflict-group-at-a-time triage modal.
// Renders full-screen on mobile so users with small screens can resolve
// DUPE / VENUE / MULTI conflict groups without scrolling through the
// full pending list.
//
// Flow:
//   1. Open modal → extracts groups from warnings (only #N-tagged
//      clusters: DUPE, VENUE, MULTI — these have partner events to
//      compare against)
//   2. Show ONE group at a time as a card stack, with field-level
//      analysis: chips showing which fields all events share + which
//      differ; per-event badges call out "stands alone on X" outliers
//   3. User marks each event "Keep" or "Delete" via:
//      · Tap the ✓ / ✗ buttons
//      · Swipe right (Keep) / left (Delete) — Tinder-style
//      · Group shortcuts: Keep First / Keep All / Delete All
//      · Undo to reverse the most recent decision
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

// === Field analysis helpers ===
// Pretty labels for the fields the analyzer inspects.
const FIELD_LABEL = {
  name:   "Name",
  day:    "Day",
  time:   "Time",
  venue:  "Venue",
  area:   "Area",
  region: "Region",
  type:   "Type",
};
const FIELDS_TO_ANALYZE = ["name", "day", "time", "venue", "area", "region", "type"];

// Normalize a field value for comparison — lower-case, strip non-alphanumeric.
// Matches the normalize() used by validateEvents so what we report as
// "matching" actually matches the flagger's logic.
function normField(v) {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// For each field in the group, is it "in conflict" (i.e., at least
// one event has a different value from the others)? Returns a map
// { fieldName: true|false }. Used to color-code field values in the
// event cards: a value renders green if the field is consistent across
// the whole group, orange if it differs. Empty values render dim.
function computeFieldConflict(events) {
  const status = {};
  if (events.length < 2) return status;
  for (const field of FIELDS_TO_ANALYZE) {
    const values = events.map(e => normField(e[field]));
    const nonEmptyUnique = new Set(values.filter(Boolean));
    // Treat as conflict if there's more than one distinct non-empty value
    // OR if some events have a value and others don't.
    const someEmpty = values.some(v => !v);
    const someNonEmpty = values.some(v => v);
    status[field] = (nonEmptyUnique.size > 1) || (someEmpty && someNonEmpty);
  }
  return status;
}

// Derive a clickable source URL for an event. Prefers the explicit
// IG post link (set by the scraper when staging from Weekend_Review),
// falls back to the IG handle's profile URL. Returns "" when neither
// exists so the caller can hide the link button.
function linkForEvent(ev) {
  const link = String(ev?.link || "").trim();
  if (link) return link;
  const ig = String(ev?.igHandle || "").trim().replace(/^@+/, "");
  if (ig) return `https://instagram.com/${ig}`;
  return "";
}

export function ConflictSweepModal({ open, events, warnings, onClose, onApplyDeletions }) {
  // Extract conflict groups — only the #N-tagged kind have partners.
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
    const ORDER = { DUPE: 0, MULTI: 1, VENUE: 2 };
    return Object.values(groupMap)
      .filter(g => g.ids.length >= 2)
      .sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9));
  }, [warnings, open]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [decisions, setDecisions] = useState({}); // eventId → "keep" | "delete"
  // Stack of recent decision changes for Undo: { id, prev: "keep"|"delete"|null }
  const [history, setHistory] = useState([]);

  // === Swipe state ===
  // Only one card may be actively swiping at a time. swipingId holds
  // which event is in-drag; swipeX is the current horizontal delta.
  // swipeStartRef.current maps eventId → original touch X so we can
  // compute delta from any touchmove event.
  const [swipingId, setSwipingId] = useState(null);
  const [swipeX, setSwipeX] = useState(0);
  const swipeStartRef = useRef({});

  // === Auto-advance state ===
  // Tracks previous (idx, allDecided) so we only auto-advance on the
  // TRANSITION from "not all decided" → "all decided" within the same
  // group. Navigating back to a previously-resolved group does NOT
  // re-advance; undoing a decision while the timer is queued cancels it.
  const prevStateRef = useRef({ idx: 0, allDecided: false });

  // === Card render cap ===
  // For pathological groups (a venue/day collision with 30+ events),
  // rendering every card up-front is what was crashing mobile Safari
  // during big imports. Initial render shows up to MAX_CARDS_INITIAL;
  // a "Show N more" button reveals the rest. Resets on group change.
  const MAX_CARDS_INITIAL = 10;
  const [showAllCards, setShowAllCards] = useState(false);

  // === Performance refs ===
  // Throttle touchmove via requestAnimationFrame — touchmove can fire
  // 100+ times/sec on some devices, each setSwipeX triggered a whole
  // modal re-render (every card, every footer). Now max 1 update per
  // browser frame ≈ 60Hz, dropping the load 40-60%.
  const rafRef = useRef(null);

  // O(1) event lookup map — was doing events.find() per id per render,
  // which is O(N×M) for N groups events and M total events. With 200+
  // pending events this added measurable jank during swipes.
  const eventsById = useMemo(() => {
    const m = new Map();
    (events || []).forEach(e => m.set(String(e.id), e));
    return m;
  }, [events]);

  useEffect(() => {
    if (open) {
      setCurrentIdx(0);
      setDecisions({});
      setHistory([]);
      setSwipingId(null);
      setSwipeX(0);
      prevStateRef.current = { idx: 0, allDecided: false };
    }
  }, [open]);

  // Clean any pending RAF + swipe state when the group changes (auto-
  // advance or Back/Next). Without this, a stale swipingId could leave
  // the next group's matching card stuck mid-translate. Also reset the
  // card-cap toggle so each fresh group starts collapsed (next group
  // might be small and not need it).
  useEffect(() => {
    setSwipingId(null);
    setSwipeX(0);
    setShowAllCards(false);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [currentIdx]);

  // Final cleanup on unmount — cancel any in-flight animation frame
  // so we don't leave a queued setState that fires after the modal
  // is gone.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Record a decision AND push the previous value onto history so Undo
  // can revert it. Used by ✓/✗ taps, swipes, AND the group shortcuts.
  const setDecisionWithHistory = useCallback((eventId, action) => {
    setDecisions(prev => {
      const prevAction = prev[eventId] ?? null;
      // No-op if the user already set this same decision
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
      return h.slice(0, -1);
    });
  }, []);

  // === Computed values (NOT hooks — safe to define after hooks but
  //     must be defined BEFORE the useEffects below that consume them).
  // All values use safe defaults when state isn't fully populated so
  // they don't throw when the modal is closed (open=false) or pre-data. ===
  const safeIdx = Math.min(currentIdx, Math.max(0, groups.length - 1));
  const currentGroup = groups[safeIdx] || null;
  const groupEvents = currentGroup
    ? currentGroup.ids.map(id => eventsById.get(String(id))).filter(Boolean)
    : [];
  const fieldConflict = computeFieldConflict(groupEvents);
  const anyConflictedFields = Object.values(fieldConflict).some(Boolean);
  const allDecided = groupEvents.length > 0 && groupEvents.every(ev => decisions[ev.id]);
  const isLast = currentIdx >= groups.length - 1;

  // === All remaining hooks must be unconditional too — must run on
  //     every render in the same order, no early returns above them.
  //     They guard their work internally instead of relying on early
  //     returns. (Rules of Hooks fix — previous version placed these
  //     after `if (!open) return null` and the empty-group early
  //     return, causing "Rendered more hooks than during the previous
  //     render" crashes when the modal opened.) ===

  // Defensive: if the current group's events have all disappeared from
  // the parent's pending list (rare — could happen if user has multiple
  // tabs open and deletes from elsewhere), auto-advance past it instead
  // of getting stuck on a blank card section.
  useEffect(() => {
    if (!open || groups.length === 0) return;
    if (currentGroup && groupEvents.length === 0) {
      if (currentIdx < groups.length - 1) {
        setCurrentIdx(i => i + 1);
      } else {
        onClose();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupEvents.length, groups.length, currentIdx]);

  // Clamp currentIdx if groups shrunk underneath us.
  useEffect(() => {
    if (!open) return;
    if (groups.length > 0 && currentIdx >= groups.length) {
      setCurrentIdx(groups.length - 1);
    }
  }, [open, groups.length, currentIdx]);

  // Auto-advance: once every event in the current group is decided,
  // jump to the next group after a brief beat. The pause lets the
  // user's last decision register visually AND gives a window to hit
  // Undo if they swiped wrong. Last group does NOT auto-apply — we
  // require an explicit Apply tap so deletions aren't accidental.
  // Skipped when the user just NAVIGATED to a previously-decided group
  // (Back button) — we compare to the previous render's idx+allDecided.
  useEffect(() => {
    if (!open) return;
    const prev = prevStateRef.current;
    prevStateRef.current = { idx: currentIdx, allDecided };
    if (prev.idx !== currentIdx) return;
    if (!prev.allDecided && allDecided && !isLast) {
      const t = setTimeout(() => setCurrentIdx(i => i + 1), 450);
      return () => clearTimeout(t);
    }
  }, [open, allDecided, currentIdx, isLast]);

  // === Early returns ALL go here (after every hook). === //

  if (!open) return null;

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

  if (!currentGroup) {
    return createPortal(
      <div onClick={onClose} style={overlayStyle}>
        <div onClick={(e) => e.stopPropagation()} style={{ ...modalStyle, padding: 32 }}>
          <div style={{ fontSize: "1.05rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, marginBottom: 10 }}>
            ✓ All conflicts resolved
          </div>
          <div style={{ fontSize: "0.8rem", color: "rgba(245,240,232,0.7)", marginBottom: 18, lineHeight: 1.5 }}>
            Looks like everything in the queue cleared up. You can close this and continue in Review.
          </div>
          <button onClick={onClose} style={primaryBtnStyle}>Close</button>
        </div>
      </div>,
      document.body
    );
  }

  // === Plain functions (not hooks) — safe here, after early returns. === //

  // Group-shortcut handlers — bulk-decide every event in the group.
  // Each one pushes one history entry per event so Undo can rewind
  // the whole sweep one tap at a time.
  const keepFirstOnly = () => {
    groupEvents.forEach((ev, i) => setDecisionWithHistory(ev.id, i === 0 ? "keep" : "delete"));
  };
  const keepAll = () => groupEvents.forEach(ev => setDecisionWithHistory(ev.id, "keep"));
  const deleteAll = () => groupEvents.forEach(ev => setDecisionWithHistory(ev.id, "delete"));

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

  const handleBack = () => { if (currentIdx > 0) setCurrentIdx(prev => prev - 1); };

  const decidedCount = Object.values(decisions).length;
  const deleteCount = Object.values(decisions).filter(a => a === "delete").length;

  const severityColor = currentGroup.type === "DUPE" ? "#E5BC4F"
                      : currentGroup.type === "MULTI" ? "#FB923C"
                      : "rgba(245,240,232,0.45)";

  // === Swipe handlers ===
  const SWIPE_THRESHOLD = 80; // px — commit a decision past this delta
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
    // Capture the touch position synchronously (the React SyntheticEvent
    // gets pooled — reading it inside the RAF callback fails). Then
    // coalesce updates to one per frame so we don't re-render the whole
    // modal 100x/sec on fast touchmove streams.
    const x = e.touches[0].clientX;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setSwipeX(x - startX);
    });
  };
  const onTouchEnd = (id) => () => {
    if (swipingId !== id) return;
    // Cancel any pending RAF before reading swipeX so we don't apply
    // a stale post-release move.
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (swipeX > SWIPE_THRESHOLD) setDecisionWithHistory(id, "keep");
    else if (swipeX < -SWIPE_THRESHOLD) setDecisionWithHistory(id, "delete");
    setSwipingId(null);
    setSwipeX(0);
  };

  return createPortal(
    <div style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(245,240,232,0.08)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
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

          {/* Tiny one-line color legend — replaces the old 7-chip row.
              Each field value in the cards below is colored directly:
              green = same across this group, orange = differs. The user
              can scan one card and see the comparison without hopping
              between header chips and card content. */}
          {anyConflictedFields && (
            <div style={{ marginTop: 8, fontSize: "0.55rem", color: "rgba(245,240,232,0.55)", letterSpacing: 0.5 }}>
              <span style={{ color: "#34D399", fontWeight: 700 }}>● Same</span>
              <span style={{ margin: "0 8px" }}>·</span>
              <span style={{ color: "#FB923C", fontWeight: 700 }}>● Differs</span>
              <span style={{ marginLeft: 8, opacity: 0.6 }}>(across these events)</span>
            </div>
          )}
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

        {/* Swipe hint — only shown on first group of the session */}
        {currentIdx === 0 && (
          <div style={{ padding: "8px 16px", fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", textAlign: "center", borderBottom: "1px solid rgba(245,240,232,0.05)", letterSpacing: 0.5 }}>
            💡 Tap ✓/✗ <strong style={{ color: "rgba(245,240,232,0.75)" }}>or swipe</strong> — right keeps · left deletes
          </div>
        )}

        {/* Event cards — capped at MAX_CARDS_INITIAL for huge groups
            (a venue-collision group could have 30+ events; rendering all
            at once was crashing mobile Safari). User can expand. */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {(showAllCards ? groupEvents : groupEvents.slice(0, MAX_CARDS_INITIAL)).map((ev, i) => {
            const decision = decisions[ev.id];
            const isSwiping = swipingId === ev.id;
            // Per-field color: green if everyone agrees on this field's
            // value, orange if the group has differing values, dim if
            // this event's value is empty. Replaces the separate
            // "Stands alone on" badge — colors carry the same signal
            // inline with less eye travel.
            const fieldColor = (field) => {
              const myVal = normField(ev[field]);
              if (!myVal) return "rgba(245,240,232,0.30)";
              return fieldConflict[field] ? "#FB923C" : "#34D399";
            };
            const sep = <span style={{ color: "rgba(245,240,232,0.25)" }}> · </span>;
            const dx = isSwiping ? swipeX : 0;
            const swipeRatio = Math.max(-1, Math.min(1, dx / SWIPE_THRESHOLD));
            const swipeBgColor = dx > 0 ? `rgba(52,211,153,${0.06 + Math.abs(swipeRatio) * 0.12})`
                              : dx < 0 ? `rgba(251,113,133,${0.06 + Math.abs(swipeRatio) * 0.12})`
                              : null;
            return (
              <div key={ev.id} style={{ position: "relative", marginBottom: 10 }}>
                {/* Swipe-direction backdrop hint — fades in as user drags */}
                {isSwiping && Math.abs(dx) > 12 && (
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: 6,
                    display: "flex", alignItems: "center", justifyContent: dx > 0 ? "flex-start" : "flex-end",
                    paddingLeft: dx > 0 ? 16 : 0, paddingRight: dx < 0 ? 16 : 0,
                    fontSize: "1.4rem", fontFamily: "'Syne',sans-serif", fontWeight: 800,
                    color: dx > 0 ? "#34D399" : "#FB7185",
                    pointerEvents: "none",
                  }}>
                    {dx > 0 ? "✓ KEEP" : "✗ DELETE"}
                  </div>
                )}
                <div
                  onTouchStart={onTouchStart(ev.id)}
                  onTouchMove={onTouchMove(ev.id)}
                  onTouchEnd={onTouchEnd(ev.id)}
                  onTouchCancel={onTouchEnd(ev.id)}
                  style={{
                    padding: 18,
                    background: swipeBgColor
                              ?? (decision === "delete" ? "rgba(251,113,133,0.06)"
                              : decision === "keep" ? "rgba(52,211,153,0.06)"
                              : "rgba(245,240,232,0.03)"),
                    border: "1.5px solid " + (decision === "delete" ? "rgba(251,113,133,0.45)"
                                            : decision === "keep" ? "rgba(52,211,153,0.45)"
                                            : "rgba(245,240,232,0.08)"),
                    borderRadius: 8,
                    opacity: decision === "delete" ? 0.65 : 1,
                    transform: isSwiping ? `translateX(${dx}px)` : "translateX(0)",
                    transition: isSwiping ? "none" : "transform 0.22s, all 0.15s",
                    touchAction: "pan-y",
                  }}
                >
                  {/* Event label — small caps tag */}
                  <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6, fontWeight: 600 }}>
                    Event {i + 1}{i === 0 ? " · first" : ""}
                  </div>
                  {/* Name — color-coded: green if all events in
                      group share this name, orange if it differs.
                      Bumped up to read as the card hero. */}
                  <div style={{ fontSize: "1.3rem", fontFamily: SWEEP_TITLE_FONT, fontWeight: 600, letterSpacing: "0.5px", lineHeight: 1.15, color: fieldColor("name"), marginBottom: 12 }}>
                    {ev.name || "(no name)"}
                  </div>
                  {/* Each field value inline-colored against group
                      consensus. Scan one card top-to-bottom — green
                      means "this matches the group", orange means
                      "this is one of the differences". Sized up so
                      the comparison stays readable at arm's length. */}
                  <div style={{ fontSize: "0.85rem", lineHeight: 1.7, marginBottom: 14 }}>
                    <div>
                      <span style={{ color: fieldColor("day") }}>{ev.day || "—"}</span>
                      {sep}
                      <span style={{ color: fieldColor("time") }}>{ev.time || "—"}</span>
                    </div>
                    <div>
                      <span style={{ color: fieldColor("venue") }}>{ev.venue || "—"}</span>
                      {sep}
                      <span style={{ color: fieldColor("area") }}>{ev.area || "—"}</span>
                      {sep}
                      <span style={{ color: fieldColor("region") }}>{ev.region || "—"}</span>
                    </div>
                    {ev.type && (
                      <div style={{ marginTop: 4, fontSize: "0.75rem", color: fieldColor("type") }}>
                        {ev.type}
                      </div>
                    )}
                  </div>
                  {/* Per-card decision row — full-width buttons at the
                      bottom of the card so the thumb has a big target.
                      Tinder-style: keep on the right (green), delete
                      on the left (red). The earlier top-right corner
                      buttons made decisions feel like a side-action;
                      bottom-row puts them front and center. */}
                  <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <button
                      onClick={() => setDecisionWithHistory(ev.id, "delete")}
                      style={bottomActionBtnStyle(decision === "delete", "#FB7185")}
                      title="Delete this event"
                    >✗ Delete</button>
                    <button
                      onClick={() => setDecisionWithHistory(ev.id, "keep")}
                      style={bottomActionBtnStyle(decision === "keep", "#34D399")}
                      title="Keep this event"
                    >✓ Keep</button>
                    {/* IG / source link — opens the event's original
                        post (or IG profile) in a new tab so the user
                        can verify what they're keeping/deleting. */}
                    {linkForEvent(ev) && (
                      <a
                        href={linkForEvent(ev)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Open the source post / IG profile in a new tab"
                        style={{
                          padding: "0 12px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "transparent",
                          color: "#63B3ED",
                          border: "1.5px solid rgba(99,179,237,0.4)",
                          borderRadius: 6,
                          fontSize: "0.75rem",
                          fontWeight: 800,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                          textDecoration: "none",
                          fontFamily: "'Syne',sans-serif",
                        }}
                      >↗</a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {/* Show-more toggle — appears when group has > MAX_CARDS_INITIAL
              events and we're rendering the capped subset. Lets the user
              expand on demand without paying the render cost up-front. */}
          {!showAllCards && groupEvents.length > MAX_CARDS_INITIAL && (
            <button
              onClick={() => setShowAllCards(true)}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: "rgba(192,132,252,0.08)",
                color: "#C084FC",
                border: "1px dashed rgba(192,132,252,0.45)",
                borderRadius: 6,
                fontSize: "0.7rem",
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
                marginTop: 4,
              }}
            >
              Show {groupEvents.length - MAX_CARDS_INITIAL} more events in this group
            </button>
          )}
        </div>

        {/* Footer — back / undo / next */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(245,240,232,0.08)", display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={handleBack}
            disabled={currentIdx === 0}
            style={{
              padding: "10px 12px",
              background: "transparent",
              color: currentIdx === 0 ? "rgba(245,240,232,0.25)" : "rgba(245,240,232,0.7)",
              border: "1px solid rgba(245,240,232,0.12)",
              borderRadius: 4,
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: currentIdx === 0 ? "not-allowed" : "pointer",
              fontFamily: "'Syne',sans-serif",
            }}
          >← Back</button>
          <button
            onClick={undoLast}
            disabled={history.length === 0}
            title="Reverse the most recent Keep/Delete decision"
            style={{
              padding: "10px 12px",
              background: history.length === 0 ? "transparent" : "rgba(192,132,252,0.08)",
              color: history.length === 0 ? "rgba(245,240,232,0.25)" : "#C084FC",
              border: "1px solid " + (history.length === 0 ? "rgba(245,240,232,0.12)" : "rgba(192,132,252,0.4)"),
              borderRadius: 4,
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: history.length === 0 ? "not-allowed" : "pointer",
              fontFamily: "'Syne',sans-serif",
            }}
          >↶ Undo</button>
          <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", flex: 1, textAlign: "center", letterSpacing: 0.5 }}>
            {allDecided && !isLast
              ? <span style={{ color: "#34D399" }}>↳ auto-advancing…</span>
              : <>
                  {decidedCount} decided
                  {deleteCount > 0 && <> · <span style={{ color: "#FB7185" }}>{deleteCount} delete</span></>}
                </>
            }
          </div>
          <button
            onClick={handleNext}
            disabled={!allDecided}
            style={{
              padding: "10px 14px",
              background: allDecided ? "#E5BC4F" : "rgba(229,188,79,0.25)",
              color: "#000",
              border: "none",
              borderRadius: 4,
              fontSize: "0.7rem",
              fontWeight: 800,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: allDecided ? "pointer" : "not-allowed",
              fontFamily: "'Syne',sans-serif",
              opacity: allDecided ? 1 : 0.7,
            }}
          >{isLast ? `Apply (${deleteCount})` : "Next →"}</button>
        </div>
        {/* Early-apply bar — only renders mid-queue when the user has
            decided at least one event. Lets them commit partial work
            and bail without walking through every remaining group.
            On the LAST group the main Apply button covers this; no
            need to duplicate. */}
        {decidedCount > 0 && !isLast && (
          <div style={{
            padding: "10px 16px",
            borderTop: "1px solid rgba(245,240,232,0.05)",
            display: "flex", alignItems: "center", gap: 8,
            background: "#0a0a0a",
          }}>
            <div style={{ flex: 1, fontSize: "0.6rem", color: "rgba(245,240,232,0.55)", letterSpacing: 0.5 }}>
              {decidedCount} decided
              {deleteCount > 0 && <> · <span style={{ color: "#FB7185" }}>{deleteCount} delete</span></>}
              <span style={{ marginLeft: 6, opacity: 0.5 }}>· apply and exit early?</span>
            </div>
            <button
              onClick={() => {
                const toDelete = Object.entries(decisions)
                  .filter(([, action]) => action === "delete")
                  .map(([id]) => id);
                onApplyDeletions(toDelete);
                onClose();
              }}
              style={{
                padding: "8px 14px",
                background: "#E5BC4F",
                color: "#000",
                border: "none",
                borderRadius: 4,
                fontSize: "0.65rem",
                fontWeight: 800,
                letterSpacing: 1,
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
              }}
            >Apply now ({deleteCount})</button>
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
// Full-width per-card action buttons (Tinder-style row at the bottom
// of each event card). Big tap targets for thumb-driven mobile use.
// Active state fills the button so the user's last decision is obvious
// at a glance even before swipe ends.
const bottomActionBtnStyle = (active, color) => ({
  flex: 1,
  padding: "12px 10px",
  borderRadius: 6,
  border: "1.5px solid " + (active ? color : `${color}55`),
  background: active ? `${color}22` : "transparent",
  color: active ? color : `${color}cc`,
  fontSize: "0.78rem",
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
  cursor: "pointer",
  fontFamily: "'Syne',sans-serif",
});
