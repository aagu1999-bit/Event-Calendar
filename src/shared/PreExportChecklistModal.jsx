import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

// Pre-flight checklist shown before "Send to website" or "Download ZIP" so
// the operator confirms they've pulled from every intake source that has
// pending items for the reviewed weekend. Non-blocking — the operator can
// always click "Ship anyway" — but a nudge that catches "I forgot to pull
// bookings before I shipped" is worth its weight.
//
// Sources currently checked:
//   - Regulars auto-pull (whether the auto-pull toggle ran for this friDate)
//   - Screenshot pool (raw + extracted, weekend-filtered when possible)
//   - Website bookings (whether there are fresh promoter bookings to import)
//
// Props:
//   open, onCancel, onConfirm  — modal controls
//   title                       — the destination action name (e.g. "Send to website")
//   weekendDates                — { Fri, Sat, Sun } for weekend-filter counts
//   sources                     — [{ key, label, status, count?, hint?, action? }, …]
//                                 status: "ok" | "warn" | "empty"
//                                 action: optional { label, onClick }

export function PreExportChecklistModal({ open, title, sources = [], onCancel, onConfirm }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { if (open) setConfirming(false); }, [open]);

  if (!open) return null;

  const warnCount = sources.filter((s) => s.status === "warn").length;

  const handleConfirm = () => { setConfirming(true); onConfirm && onConfirm(); };

  return createPortal(
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 9100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "#141416", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 14, padding: "22px 22px 18px", color: "#F5F0E8", fontFamily: "'DM Sans', ui-sans-serif, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontFamily: "'Syne', ui-sans-serif, sans-serif", fontWeight: 800, fontSize: "1.15rem", flex: 1 }}>Ship this weekend's calendar?</h2>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.5)", fontSize: "1.1rem", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: "0.78rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
          {title ? <><b style={{ color: "#F5F0E8" }}>{title}</b> — c</> : "C"}heck each source below so you don't leave events behind.{warnCount > 0 && <> <span style={{ color: "#FBBF24", fontWeight: 700 }}>{warnCount} source{warnCount === 1 ? " has" : "s have"} pending items you may want to pull first.</span></>}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {sources.map((s) => {
            const color = s.status === "warn" ? "#FBBF24" : s.status === "ok" ? "#34D399" : "rgba(245,240,232,0.4)";
            const icon = s.status === "warn" ? "⚠" : s.status === "ok" ? "✓" : "—";
            const bg = s.status === "warn" ? "rgba(251,191,36,0.08)" : s.status === "ok" ? "rgba(52,211,153,0.06)" : "rgba(245,240,232,0.02)";
            return (
              <div key={s.key} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 6,
                background: bg,
                border: `1px solid ${s.status === "warn" ? "rgba(251,191,36,0.3)" : s.status === "ok" ? "rgba(52,211,153,0.25)" : "rgba(245,240,232,0.06)"}`,
              }}>
                <span style={{ color, fontSize: "1rem", fontWeight: 800, minWidth: 18, textAlign: "center" }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#F5F0E8" }}>{s.label}</div>
                  {s.hint && <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.55)", marginTop: 2 }}>{s.hint}</div>}
                </div>
                {s.action && (
                  <button
                    onClick={s.action.onClick}
                    style={{ padding: "4px 10px", borderRadius: 4, background: "rgba(99,179,237,0.12)", color: "#63B3ED", border: "1px solid rgba(99,179,237,0.4)", fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.3px", textTransform: "uppercase", cursor: "pointer" }}
                  >
                    {s.action.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: 6, background: "transparent", color: "rgba(245,240,232,0.7)", border: "1px solid rgba(245,240,232,0.15)", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
            Wait — let me check
          </button>
          <button onClick={handleConfirm} disabled={confirming} style={{ flex: 1, padding: "10px", borderRadius: 6, border: "none", cursor: confirming ? "wait" : "pointer", background: warnCount > 0 ? "rgba(251,191,36,0.85)" : "#34D399", color: warnCount > 0 ? "#3d2c00" : "#06281d", fontSize: "0.8rem", fontWeight: 800, letterSpacing: "0.3px" }}>
            {confirming ? "Shipping…" : warnCount > 0 ? "Ship anyway →" : "Ship it →"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
