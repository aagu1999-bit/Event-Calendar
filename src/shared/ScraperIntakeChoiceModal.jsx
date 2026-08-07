import { createPortal } from "react-dom";

// Modal that pops when scraped events land in Review while the user is
// already in an active named session. Gives the user three choices:
//   1. Append to the current session — keep triaging one big list
//   2. Start a NEW session for this batch — separates the two weekends
//   3. Cancel — drop the incoming batch (they can re-send from Scraper)
//
// The current-session case is the common one, so it's the primary
// button. New-session is offered because a scraper import is usually
// "this is the next batch, keep it separate from what I already sent."
export function ScraperIntakeChoiceModal({
  open,
  count,
  currentSessionName,
  onAppend,
  onNewSession,
  onCancel,
}) {
  if (!open) return null;

  return createPortal(
    <div
      onClick={onCancel}
      className="cge-modal-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f0f0f",
          border: "1px solid rgba(229,188,79,0.35)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 480,
          width: "100%",
          color: "#F5F0E8",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        <h2 style={{ fontSize: "1.1rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 1, margin: "0 0 8px" }}>
          📥 {count} scraped event{count === 1 ? "" : "s"} incoming
        </h2>
        <p style={{ fontSize: "0.75rem", color: "rgba(245,240,232,0.7)", lineHeight: 1.5, marginBottom: 18 }}>
          You're currently working in session <strong style={{ color: "#E5BC4F" }}>"{currentSessionName}"</strong>. Where should these events go?
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={onAppend}
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "rgba(52,211,153,0.15)",
              border: "1px solid rgba(52,211,153,0.5)",
              borderRadius: 5,
              color: "#34D399",
              fontFamily: "'Syne',sans-serif",
              fontWeight: 800,
              fontSize: "0.75rem",
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            ➕ Append to "{currentSessionName.length > 20 ? currentSessionName.slice(0, 20) + "…" : currentSessionName}"
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.6rem", color: "rgba(52,211,153,0.7)", fontWeight: 400, letterSpacing: 0, textTransform: "none", marginTop: 3 }}>
              Adds to the queue below (dedup by ID). Best if this batch is more events for the same weekend.
            </div>
          </button>

          <button
            onClick={onNewSession}
            style={{
              width: "100%",
              padding: "12px 14px",
              background: "rgba(99,179,237,0.10)",
              border: "1px solid rgba(99,179,237,0.5)",
              borderRadius: 5,
              color: "#63B3ED",
              fontFamily: "'Syne',sans-serif",
              fontWeight: 800,
              fontSize: "0.75rem",
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            🆕 Start a NEW session for this batch
            <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.6rem", color: "rgba(99,179,237,0.75)", fontWeight: 400, letterSpacing: 0, textTransform: "none", marginTop: 3 }}>
              Saves your current session, clears the review queue, prompts you to name the new one. Calendar events stay intact.
            </div>
          </button>

          <button
            onClick={onCancel}
            style={{
              width: "100%",
              padding: "10px 14px",
              background: "transparent",
              border: "1px solid rgba(245,240,232,0.15)",
              borderRadius: 5,
              color: "rgba(245,240,232,0.55)",
              fontFamily: "'DM Sans',sans-serif",
              fontSize: "0.7rem",
              cursor: "pointer",
              marginTop: 4,
            }}
          >
            Cancel (drop the batch — you can re-send from Scraper)
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
