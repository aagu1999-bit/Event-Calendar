import { useState, useMemo, useEffect, useRef } from "react";
import {
  IG_PUBLISH_BLOCKLIST,
  IG_PUBLISH_DEFAULT_MAX_TOTAL,
  buildPublishPlan,
  collectHandlesFromEvents,
} from "./igPublish.js";

// Modal that publishes the finished weekend carousel to Instagram.
//
// How it fits together:
//   1. Operator opens the modal from the Calendar page after slides are ready.
//   2. We compute the publish plan client-side — which handles get tagged on
//      which slides — and render it so there are no surprises.
//   3. Operator can edit the caption and pick which account to post from.
//   4. On Publish, each slide renders to a JPEG blob, the whole payload
//      goes to /api/instagram/publish-carousel, which calls Composio.
//   5. Success → we show the post permalink. Error → we show the server's
//      error message verbatim so the operator can decide whether to retry.

// Default accounts. Aliases match what Composio knows them as.
// Order matters: the first is the default pick.
const IG_ACCOUNTS = [
  { alias: "cge",            label: "@centralgroupevents (CGE)" },
  { alias: "happyhourhqnj",  label: "@happyhourhqnj" },
];

export function PublishInstagramModal({
  open,
  onClose,
  events,
  slideCount,
  weekendLabel,
  defaultCaption,
  renderSlideToBlob,  // async (slideIndex) => Blob  (JPEG)
}) {
  const [account, setAccount] = useState(IG_ACCOUNTS[0].alias);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text, permalink? }
  const captionTouchedRef = useRef(false);

  // Reset state when the modal opens — we don't want stale captions or
  // last-run errors sticking around across opens.
  useEffect(() => {
    if (!open) return;
    captionTouchedRef.current = false;
    setCaption(defaultCaption || "");
    setMsg(null);
    setBusy(false);
  }, [open, defaultCaption]);

  // Keep caption in sync with upstream default UNTIL the operator types
  // in it. First keystroke marks it dirty and we stop auto-syncing.
  useEffect(() => {
    if (!open) return;
    if (captionTouchedRef.current) return;
    setCaption(defaultCaption || "");
  }, [defaultCaption, open]);

  const plan = useMemo(() => buildPublishPlan({
    events: events || [],
    slideCount: Math.max(1, Number(slideCount) || 1),
    maxTotal: IG_PUBLISH_DEFAULT_MAX_TOTAL,
    exclude: IG_PUBLISH_BLOCKLIST,
  }), [events, slideCount]);

  const allHandles = useMemo(
    () => collectHandlesFromEvents(events || [], { exclude: [] }),
    [events]
  );
  const blockedCount = allHandles.length - plan.uniqueHandles.length;

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      // Render each slide to a JPEG blob. We do this one at a time
      // because the renderer uses a shared canvas DOM element and
      // parallelism would race on it.
      const slideJpegs = [];
      for (let i = 0; i < plan.perSlide.length; i++) {
        const blob = await renderSlideToBlob(i);
        if (!blob) throw new Error(`slide ${i + 1} failed to render`);
        slideJpegs.push(await blobToBase64(blob));
      }

      const res = await fetch("/api/instagram/publish-carousel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountAlias: account,
          caption: caption,
          slides: slideJpegs.map((b64, i) => ({
            imageBase64: b64,
            userTags: plan.userTagsPerSlide[i],
          })),
        }),
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}

      if (!res.ok) {
        const detail = data?.message || data?.error || text?.slice(0, 500) || `HTTP ${res.status}`;
        throw new Error(detail);
      }
      setMsg({
        ok: true,
        text: data?.permalink
          ? "Posted to Instagram."
          : "Posted. (No permalink returned — check Instagram app.)",
        permalink: data?.permalink || null,
      });
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(14,14,16,0.82)", zIndex: 9000,
        display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "40px 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1a1a1e", color: "#F5F0E8", borderRadius: 10, maxWidth: 560, width: "100%",
          padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", border: "1px solid rgba(245,240,232,0.1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", letterSpacing: "0.5px" }}>
            📱 Post to Instagram
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "rgba(245,240,232,0.5)", fontSize: "1.3rem", cursor: "pointer" }}
            title="Close"
          >×</button>
        </div>

        {/* Account picker */}
        <label style={{ display: "block", fontSize: "0.65rem", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(245,240,232,0.6)", marginBottom: 6 }}>
          Post as
        </label>
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          disabled={busy}
          style={{
            width: "100%", padding: "8px 10px", background: "#0e0e10", color: "#F5F0E8",
            border: "1px solid rgba(245,240,232,0.15)", borderRadius: 4, fontSize: "0.85rem",
            marginBottom: 14,
          }}
        >
          {IG_ACCOUNTS.map((a) => (
            <option key={a.alias} value={a.alias}>{a.label}</option>
          ))}
        </select>

        {/* Tag plan summary — operator sees exactly what will be tagged
            on which slide before they commit. */}
        <label style={{ display: "block", fontSize: "0.65rem", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(245,240,232,0.6)", marginBottom: 6 }}>
          Tags ({plan.totalTagged} / {plan.cap})
        </label>
        <div style={{
          background: "#0e0e10", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4,
          padding: "8px 10px", fontSize: "0.72rem", color: "rgba(245,240,232,0.75)",
          marginBottom: 6, maxHeight: 140, overflowY: "auto", lineHeight: 1.5,
        }}>
          {plan.perSlide.length === 0 ? (
            <em style={{ color: "rgba(245,240,232,0.4)" }}>No slides.</em>
          ) : plan.perSlide.map((slideTags, i) => (
            <div key={i} style={{ marginBottom: 2 }}>
              <span style={{ color: "#E5BC4F", fontWeight: 700 }}>Slide {i + 1}:</span>{" "}
              {slideTags.length ? slideTags.map((h) => `@${h}`).join(" · ") : (
                <em style={{ color: "rgba(245,240,232,0.35)" }}>(no tags)</em>
              )}
            </div>
          ))}
        </div>
        <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", marginBottom: 14, lineHeight: 1.4 }}>
          Up to {plan.cap} tags spread evenly across {plan.perSlide.length} slides.
          {blockedCount > 0 && ` ${blockedCount} blocked (${plan.blocked.join(", ")}).`}
          {plan.droppedForCap > 0 && ` ${plan.droppedForCap} dropped at ${plan.cap}-tag cap.`}
        </div>

        {/* Caption — pre-filled from the Calendar's current caption, fully
            editable. First keystroke flips captionTouchedRef so later
            re-renders don't overwrite what the operator typed. */}
        <label style={{ display: "block", fontSize: "0.65rem", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(245,240,232,0.6)", marginBottom: 6 }}>
          Caption
        </label>
        <textarea
          value={caption}
          onChange={(e) => { captionTouchedRef.current = true; setCaption(e.target.value); }}
          disabled={busy}
          rows={8}
          style={{
            width: "100%", padding: "10px", background: "#0e0e10", color: "#F5F0E8",
            border: "1px solid rgba(245,240,232,0.15)", borderRadius: 4, fontSize: "0.82rem",
            fontFamily: "inherit", resize: "vertical", marginBottom: 6, lineHeight: 1.5,
          }}
        />
        <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", marginBottom: 14 }}>
          {caption.length} / 2200 characters · hashtags still count
        </div>

        {/* Status */}
        {msg && (
          <div style={{
            padding: "8px 10px", borderRadius: 4, fontSize: "0.72rem", marginBottom: 14,
            background: msg.ok ? "rgba(52,211,153,0.12)" : "rgba(239,68,68,0.12)",
            color: msg.ok ? "#34D399" : "#F87171",
            border: `1px solid ${msg.ok ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}>
            {msg.text}
            {msg.permalink && (
              <div style={{ marginTop: 4 }}>
                <a href={msg.permalink} target="_blank" rel="noreferrer" style={{ color: "#34D399" }}>
                  Open post →
                </a>
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "8px 16px", background: "transparent", color: "rgba(245,240,232,0.7)",
              border: "1px solid rgba(245,240,232,0.2)", borderRadius: 4, fontSize: "0.78rem",
              cursor: busy ? "wait" : "pointer", letterSpacing: "0.3px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={publish}
            disabled={busy || caption.length > 2200}
            style={{
              padding: "8px 16px",
              background: busy ? "rgba(99,179,237,0.3)" : "#63B3ED",
              color: busy ? "rgba(14,14,16,0.6)" : "#0e0e10",
              border: "none", borderRadius: 4, fontSize: "0.78rem", fontWeight: 700,
              cursor: busy ? "wait" : (caption.length > 2200 ? "not-allowed" : "pointer"),
              letterSpacing: "0.3px",
            }}
          >
            {busy ? "Publishing…" : "📱 Publish to Instagram"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Convert a Blob to a base64 string (no data: prefix). We strip the
// prefix because server treats the field as raw payload. Server adds
// the mime type back from `image/jpeg` when it POSTs to Composio.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const s = String(reader.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.readAsDataURL(blob);
  });
}
