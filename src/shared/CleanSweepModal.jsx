import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Clean Sweep — one-clean-event-at-a-time keep/cut triage.
//
// The Conflict Sweep and Fix Flags handle FLAGGED events. What's left after
// them is "clean" (no warnings) — but clean isn't the same as wanted. This
// modal lets the user rip through the clean pile fast, deciding Keep vs Cut
// per event, so they finish with exactly the events they chose instead of
// everything that merely lacked a flag.
//
// Flow:
//   1. Open → snapshots the clean events into a stable deck.
//   2. Show ONE event at a time. Keep (→) / Cut (←) via buttons or swipe.
//   3. Keep-rest / Cut-rest shortcuts + Undo.
//   4. After the last card → summary → "Apply" emits the decisions.
//
// Props:
//   open              — boolean
//   events            — the CLEAN events array (already filtered by caller)
//   onClose()         — modal dismissed
//   onApply({keepIds, cutIds}) — fires once: cut = delete, keep = mark vetted

// Condensed, highly legible display face for the event name — scoped to the
// sweep only (not tool-wide) so the title is easy to read at a glance while
// triaging. 'Oswald Local' is bundled (see index.css @font-face).
// Bebas Neue (loaded via the Google Fonts link in index.html) is the tall,
// condensed, high-legibility face for the event name. 'Oswald Local' is the
// bundled fallback so the title stays readable OFFLINE (subway / no signal),
// where the CDN font can't load.
const TITLE_FONT = "'Bebas Neue', 'Oswald Local', 'Oswald', 'Syne', sans-serif";
const SWIPE_THRESHOLD = 90;

const DETAIL_FIELDS = [
  ["day", "Day"],
  ["time", "Time"],
  ["venue", "Venue"],
  ["area", "City"],
  ["region", "Region"],
  ["type", "Type"],
];

export function CleanSweepModal({ open, events, onClose, onApply }) {
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [decisions, setDecisions] = useState({}); // id → "keep" | "cut"
  const [history, setHistory] = useState([]);      // ids in decision order
  const [drag, setDrag] = useState(0);             // live swipe offset (px)
  const dragRef = useRef({ active: false, startX: 0 });

  // Snapshot the clean events when the modal opens so live deletions /
  // re-validation elsewhere don't reshuffle the deck mid-sweep.
  useEffect(() => {
    if (open) {
      setQueue(Array.isArray(events) ? events.slice() : []);
      setIdx(0);
      setDecisions({});
      setHistory([]);
      setDrag(0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const total = queue.length;
  const current = queue[idx] || null;
  const done = idx >= total && total > 0;

  const keptSoFar = Object.values(decisions).filter(v => v === "keep").length;
  const cutSoFar = Object.values(decisions).filter(v => v === "cut").length;

  const decide = (verdict) => {
    if (!current) return;
    const id = current.id;
    setDecisions(d => ({ ...d, [id]: verdict }));
    setHistory(h => [...h, id]);
    setIdx(i => i + 1);
    setDrag(0);
  };

  const undo = () => {
    if (history.length === 0) return;
    const lastId = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setDecisions(d => { const n = { ...d }; delete n[lastId]; return n; });
    setIdx(i => Math.max(0, i - 1));
    setDrag(0);
  };

  const decideRest = (verdict) => {
    setDecisions(d => {
      const n = { ...d };
      for (let i = idx; i < total; i++) n[queue[i].id] = verdict;
      return n;
    });
    setIdx(total);
    setDrag(0);
  };

  const apply = () => {
    const keepIds = [], cutIds = [];
    Object.entries(decisions).forEach(([id, v]) => {
      (v === "cut" ? cutIds : keepIds).push(id);
    });
    onApply?.({ keepIds, cutIds });
    onClose();
  };

  // --- Swipe (pointer) ---
  const onDown = (e) => { dragRef.current = { active: true, startX: e.clientX ?? 0 }; };
  const onMove = (e) => { if (dragRef.current.active) setDrag((e.clientX ?? 0) - dragRef.current.startX); };
  const onUp = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    if (drag > SWIPE_THRESHOLD) decide("keep");
    else if (drag < -SWIPE_THRESHOLD) decide("cut");
    else setDrag(0);
  };

  const leaning = drag > 30 ? "keep" : drag < -30 ? "cut" : null;

  const btn = (label, color, onClick, extra = {}) => (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px", borderRadius: 6, cursor: "pointer",
        fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "0.7rem",
        letterSpacing: "1px", textTransform: "uppercase",
        background: `${color}1f`, color, border: `1.5px solid ${color}`,
        ...extra,
      }}
    >{label}</button>
  );

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.82)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#0d0d0d", border: "1px solid rgba(245,240,232,0.12)",
          borderRadius: 10, width: "min(560px, 100%)", maxHeight: "88vh",
          display: "flex", flexDirection: "column",
          color: "#F5F0E8", fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid rgba(245,240,232,0.08)",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "#8B5CF6" }}>
            ✨ Clean Sweep
          </div>
          <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
            Keep only the clean events you actually want
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              padding: "4px 10px", borderRadius: 4,
              background: "rgba(245,240,232,0.04)", color: "#F5F0E8",
              border: "1px solid rgba(245,240,232,0.1)", fontSize: "0.7rem",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >Close</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {total === 0 && (
            <div style={{ padding: "3rem 1rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.8rem", lineHeight: 1.6 }}>
              No clean events to sweep.<br />
              Clear the flagged ones first — what's left lands here.
            </div>
          )}

          {total > 0 && !done && current && (
            <>
              {/* Progress */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.6rem", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(245,240,232,0.5)" }}>
                <span>{idx + 1} / {total}</span>
                <div style={{ flex: 1, height: 4, background: "rgba(245,240,232,0.1)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(idx / total) * 100}%`, height: "100%", background: "#8B5CF6" }} />
                </div>
                <span style={{ color: "#34D399" }}>{keptSoFar} kept</span>
                <span style={{ color: "#FB7185" }}>{cutSoFar} cut</span>
              </div>

              {/* Card */}
              <div
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
                style={{
                  position: "relative", touchAction: "pan-y", userSelect: "none",
                  padding: "22px 20px", borderRadius: 10,
                  background: leaning === "keep" ? "rgba(52,211,153,0.10)"
                    : leaning === "cut" ? "rgba(251,113,133,0.10)"
                    : "rgba(245,240,232,0.05)",
                  border: `1.5px solid ${leaning === "keep" ? "#34D399" : leaning === "cut" ? "#FB7185" : "rgba(245,240,232,0.14)"}`,
                  transform: `translateX(${drag}px) rotate(${drag * 0.02}deg)`,
                  transition: dragRef.current.active ? "none" : "transform 160ms ease, background 120ms, border-color 120ms",
                  cursor: "grab",
                }}
              >
                {leaning && (
                  <div style={{
                    position: "absolute", top: 12, [leaning === "keep" ? "right" : "left"]: 12,
                    fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "0.7rem",
                    letterSpacing: "2px", textTransform: "uppercase",
                    color: leaning === "keep" ? "#34D399" : "#FB7185",
                  }}>{leaning === "keep" ? "KEEP ✓" : "✗ CUT"}</div>
                )}

                {/* Event name — condensed readable title font, sweep-only */}
                <div style={{
                  fontFamily: TITLE_FONT, fontWeight: 600, fontSize: "1.7rem",
                  lineHeight: 1.1, letterSpacing: "0.5px", marginBottom: 12,
                  wordBreak: "break-word",
                }}>
                  {current.name || "(no name)"}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: "0.75rem" }}>
                  {DETAIL_FIELDS.map(([key, label]) => (
                    (current[key] != null && String(current[key]).trim() !== "") ? (
                      <div key={key} style={{ display: "contents" }}>
                        <span style={{ color: "rgba(245,240,232,0.4)", letterSpacing: "0.5px", textTransform: "uppercase", fontSize: "0.6rem", alignSelf: "center" }}>{label}</span>
                        <span style={{ color: "rgba(245,240,232,0.9)" }}>{String(current[key])}</span>
                      </div>
                    ) : null
                  ))}
                </div>
              </div>

              {/* Keep / Cut */}
              <div style={{ display: "flex", gap: 10 }}>
                {btn("✗ Cut", "#FB7185", () => decide("cut"), { flex: 1, padding: "14px", fontSize: "0.85rem" })}
                {btn("Keep ✓", "#34D399", () => decide("keep"), { flex: 1, padding: "14px", fontSize: "0.85rem" })}
              </div>

              {/* Shortcuts */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {btn("↩ Undo", "#63B3ED", undo, { opacity: history.length ? 1 : 0.4, cursor: history.length ? "pointer" : "not-allowed" })}
                {btn("Keep rest", "#34D399", () => decideRest("keep"))}
                {btn("Cut rest", "#FB7185", () => decideRest("cut"))}
              </div>

              <div style={{ textAlign: "center", fontSize: "0.55rem", color: "rgba(245,240,232,0.35)", letterSpacing: "1px", textTransform: "uppercase" }}>
                Swipe right to keep · left to cut
              </div>
            </>
          )}

          {done && (
            <div style={{ textAlign: "center", padding: "1.5rem 0.5rem" }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "1.1rem", marginBottom: 10 }}>
                Sweep complete
              </div>
              <div style={{ fontSize: "0.85rem", color: "rgba(245,240,232,0.7)", marginBottom: 20, lineHeight: 1.6 }}>
                <span style={{ color: "#34D399", fontWeight: 700 }}>{keptSoFar} kept</span>
                {" · "}
                <span style={{ color: "#FB7185", fontWeight: 700 }}>{cutSoFar} cut</span>
                <br />
                Applying removes the cut events and marks the kept ones ✓ vetted.
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                {btn("↩ Undo last", "#63B3ED", undo, { opacity: history.length ? 1 : 0.4, cursor: history.length ? "pointer" : "not-allowed" })}
                {btn(`Apply · cut ${cutSoFar}, keep ${keptSoFar}`, "#8B5CF6", apply, { padding: "14px 18px", fontSize: "0.8rem" })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
