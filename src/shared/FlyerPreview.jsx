import { useState } from "react";
import { createPortal } from "react-dom";

// Flyer preview for the review sweeps. The scraper imports each event's
// DISPLAY URL (a direct Instagram image link) as event.flyerUrl; this shows it
// so the user can read the actual poster — date, venue, vibe — before they
// approve / fix / cut. Tap opens a full-size lightbox for the fine print.
// Falls back to a "view post" link when there's no flyer image (or it fails to
// load — IG CDN links can expire, so onError degrades gracefully).
//
// Props:
//   flyerUrl — direct image URL (event.flyerUrl). Optional.
//   postUrl  — the source post/IG link, used for the fallback + a corner link.
//   size     — "thumb" (list rows) | "hero" (big, clean-sweep card).
export function FlyerPreview({ flyerUrl, postUrl, size = "thumb", alt = "event flyer" }) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const hasImg = !!flyerUrl && !broken;

  const box = size === "hero"
    ? { width: 150, minHeight: 150 }
    : { width: 74, height: 92 };

  if (!hasImg) {
    return (
      <div style={{
        ...box, height: box.height || 92, flex: "0 0 auto",
        borderRadius: 8, border: "1px dashed rgba(245,240,232,0.12)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 5, color: "rgba(245,240,232,0.3)", fontSize: "0.5rem", textAlign: "center", padding: 6, lineHeight: 1.3,
      }}>
        <span>no flyer</span>
        {postUrl && (
          <a href={postUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
             style={{ color: "#63B3ED", textDecoration: "none", fontWeight: 800 }}>↗ view post</a>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Tap to enlarge the flyer"
        style={{
          ...box, flex: "0 0 auto", padding: 0, borderRadius: 8, overflow: "hidden",
          border: "1px solid rgba(245,240,232,0.1)", background: "#000", cursor: "zoom-in", position: "relative",
        }}
      >
        <img
          src={flyerUrl}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          style={{ width: "100%", height: size === "hero" ? "auto" : "100%", display: "block", objectFit: "cover" }}
        />
        <span style={{
          position: "absolute", top: 4, right: 4, width: 16, height: 16, borderRadius: "50%",
          background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: "0.55rem",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>⤢</span>
      </button>
      {open && createPortal(
        <div
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}
        >
          <img src={flyerUrl} alt={alt} onError={() => { setBroken(true); setOpen(false); }}
               style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 8, boxShadow: "0 10px 50px rgba(0,0,0,0.6)" }} />
        </div>,
        document.body
      )}
    </>
  );
}
