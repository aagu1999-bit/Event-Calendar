import { useState, useMemo, useEffect, useRef } from "react";
import {
  IG_PUBLISH_BLOCKLIST,
  IG_MAX_TAGS_PER_SLIDE,
  buildPublishPlan,
  collectHandlesFromEvents,
  computeSlideSchedule,
  formatScheduleTime,
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
  slideEvents,       // [[event,...], [event,...], ...] — events PER slide
  slideDays,         // ["Fri", "Sat", "Sun", ...] — the day each slide belongs to
  friDate,           // "MM/DD" of the Friday this weekend starts on
  weekendLabel,
  defaultCaption,
  onGenerateCaption, // optional async () => string. Called on open when
                     // defaultCaption is empty — gives us the "modal is
                     // always pre-filled" behavior without the operator
                     // having to click Generate Caption separately.
  renderSlideToBlob, // async (slideIndex) => Blob  (JPEG)
}) {
  const [account, setAccount] = useState(IG_ACCOUNTS[0].alias);
  const [caption, setCaption] = useState("");
  const [captionBusy, setCaptionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text, permalink? }
  const [alsoPostStory, setAlsoPostStory] = useState(false);
  // "now" = post everything as one carousel immediately (default).
  // "schedule" = each selected slide posts as its OWN feed post on the
  //              day it corresponds to (Fri 11a / Sat 9a / Sun 9a local).
  const [mode, setMode] = useState("now");
  // Per-slide picker. Index → boolean. Default all on. Operator can
  // uncheck slides they don't want to send in either mode.
  const [slideChecked, setSlideChecked] = useState({});
  const captionTouchedRef = useRef(false);

  // Reset state when the modal opens — stale captions / errors / story
  // toggle / schedule mode shouldn't persist across opens.
  useEffect(() => {
    if (!open) return;
    captionTouchedRef.current = false;
    setCaption(defaultCaption || "");
    setMsg(null);
    setBusy(false);
    setAlsoPostStory(false);
    setMode("now");
    // Every slide checked by default. Operator can uncheck what they
    // don't want to send.
    const checked = {};
    const count = Array.isArray(slideEvents) ? slideEvents.length : 0;
    for (let i = 0; i < count; i++) checked[i] = true;
    setSlideChecked(checked);
    // Auto-generate the caption if none exists yet, so the modal always
    // opens with a usable draft. Mirrors the ZIP download's behavior.
    if (!defaultCaption && typeof onGenerateCaption === "function") {
      let cancelled = false;
      (async () => {
        setCaptionBusy(true);
        try {
          const generated = await onGenerateCaption();
          if (!cancelled && !captionTouchedRef.current) {
            setCaption(String(generated || ""));
          }
        } catch (err) {
          if (!cancelled) {
            setMsg({ ok: false, text: `Caption auto-gen failed: ${err?.message || err}. Type one and publish anyway.` });
          }
        } finally {
          if (!cancelled) setCaptionBusy(false);
        }
      })();
      return () => { cancelled = true; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep caption in sync with upstream default UNTIL the operator types
  // in it. First keystroke marks it dirty and we stop auto-syncing.
  useEffect(() => {
    if (!open) return;
    if (captionTouchedRef.current) return;
    if (!defaultCaption) return;
    setCaption(defaultCaption);
  }, [defaultCaption, open]);

  const plan = useMemo(() => buildPublishPlan({
    slideEvents: slideEvents || [],
    maxPerSlide: IG_MAX_TAGS_PER_SLIDE,
    exclude: IG_PUBLISH_BLOCKLIST,
  }), [slideEvents]);

  // For schedule mode: compute each slide's target time based on its
  // day. Recomputes when mode toggles to "schedule" so the operator
  // sees fresh "in N hours" math if the modal's been open a while.
  const schedules = useMemo(() => {
    if (mode !== "schedule") return [];
    const days = Array.isArray(slideDays) ? slideDays : [];
    return (plan.perSlide || []).map((_, i) =>
      computeSlideSchedule({ day: days[i], friDate, now: new Date() })
    );
  }, [mode, slideDays, friDate, plan.perSlide]);

  const flatSlideEvents = useMemo(
    () => (slideEvents || []).flat(),
    [slideEvents]
  );
  const allHandles = useMemo(
    () => collectHandlesFromEvents(flatSlideEvents, { exclude: [] }),
    [flatSlideEvents]
  );
  const blockedCount = allHandles.filter((h) =>
    IG_PUBLISH_BLOCKLIST.includes(h)
  ).length;

  // Which slide indices are checked (operator-picked).
  const selectedIndices = useMemo(() =>
    (plan.perSlide || [])
      .map((_, i) => i)
      .filter((i) => slideChecked[i] !== false),
    [plan.perSlide, slideChecked]
  );

  // Carousel requires 2+. If the operator picked just one in "now"
  // mode, we post a single-image feed post instead (server handles
  // both). In "schedule" mode EVERY slide fires as its own feed post,
  // so a single pick is fine there.
  const canSubmitNow = selectedIndices.length >= 1;
  const canSubmitSchedule = selectedIndices.length >= 1;

  const publish = async () => {
    if (busy) return;
    if (!canSubmitNow && mode === "now") {
      setMsg({ ok: false, text: "Pick at least one slide." });
      return;
    }
    if (!canSubmitSchedule && mode === "schedule") {
      setMsg({ ok: false, text: "Pick at least one slide to schedule." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // Render each SELECTED slide to a JPEG blob. One at a time —
      // the renderer uses a shared canvas DOM element and parallelism
      // would race on it.
      const selected = [];
      for (const i of selectedIndices) {
        const blob = await renderSlideToBlob(i);
        if (!blob) throw new Error(`slide ${i + 1} failed to render`);
        selected.push({
          slideIndex: i,
          imageBase64: await blobToBase64(blob),
          userTags: plan.userTagsPerSlide[i] || [],
          day: Array.isArray(slideDays) ? slideDays[i] || null : null,
        });
      }

      if (mode === "schedule") {
        // Each selected slide posts as its own feed post at the
        // auto-computed time for its day. Server queues, scheduler
        // fires.
        const items = selected.map((s, idx) => ({
          slideIndex: s.slideIndex,
          day: s.day,
          imageBase64: s.imageBase64,
          userTags: s.userTags,
          scheduledAt: schedules[s.slideIndex]?.scheduledAt || Date.now(),
          immediate: !!schedules[s.slideIndex]?.immediate,
        }));
        const res = await fetch("/api/instagram/schedule-slides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountAlias: account,
            caption,
            alsoPostStory,
            items,
          }),
        });
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch {}
        if (!res.ok) {
          const detail = data?.message || data?.error || text?.slice(0, 500) || `HTTP ${res.status}`;
          throw new Error(detail);
        }
        const scheduledCount = Array.isArray(data?.scheduled) ? data.scheduled.length : 0;
        const immediateCount = Array.isArray(data?.scheduled) ? data.scheduled.filter((x) => x.immediate).length : 0;
        const parts = [];
        parts.push(`${scheduledCount} slide${scheduledCount === 1 ? "" : "s"} queued.`);
        if (immediateCount) parts.push(`${immediateCount} will fire within the minute (past-due).`);
        if (alsoPostStory) parts.push(`Each will ${scheduledCount === 1 ? "post" : "also post"} to Story.`);
        setMsg({ ok: true, text: parts.join(" ") });
      } else {
        // Immediate mode. Carousel if ≥2 picked, single-image if 1.
        const res = await fetch("/api/instagram/publish-carousel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountAlias: account,
            caption,
            alsoPostStory,
            slides: selected.map((s) => ({
              imageBase64: s.imageBase64,
              userTags: s.userTags,
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
        const storyCount = Array.isArray(data?.stories) ? data.stories.filter((s) => s?.ok).length : 0;
        const storyFailed = Array.isArray(data?.stories) ? data.stories.filter((s) => !s?.ok).length : 0;
        const parts = [];
        parts.push(data?.permalink ? "Posted to Instagram feed." : "Posted to feed (no permalink returned).");
        if (alsoPostStory) {
          if (storyCount && !storyFailed) parts.push(`+ ${storyCount} slide${storyCount === 1 ? "" : "s"} posted as Stories.`);
          else if (storyCount && storyFailed) parts.push(`+ ${storyCount} slide Stories posted, ${storyFailed} failed.`);
          else parts.push("Stories step failed — see server logs.");
        }
        setMsg({
          ok: true,
          text: parts.join(" "),
          permalink: data?.permalink || null,
        });
      }
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

        {/* Mode toggle — either everything ships now as one carousel, or
            each selected slide fires as its own feed post on the day it
            corresponds to. */}
        <label style={{ display: "block", fontSize: "0.65rem", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(245,240,232,0.6)", marginBottom: 6 }}>
          When
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[
            { key: "now", label: "📱 Post now (carousel)", title: "All picked slides post together as one feed carousel, immediately." },
            { key: "schedule", label: "📅 Schedule per day", title: "Each picked slide posts as its OWN feed post on the matching day (Fri 11AM / Sat 9AM / Sun 9AM local)." },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMode(opt.key)}
              disabled={busy}
              title={opt.title}
              style={{
                flex: 1, padding: "8px 10px", borderRadius: 4, fontSize: "0.72rem", fontWeight: 700,
                letterSpacing: "0.3px", cursor: busy ? "wait" : "pointer",
                background: mode === opt.key ? "rgba(236,72,153,0.18)" : "rgba(245,240,232,0.04)",
                color: mode === opt.key ? "#F472B6" : "rgba(245,240,232,0.7)",
                border: `1px solid ${mode === opt.key ? "rgba(236,72,153,0.5)" : "rgba(245,240,232,0.1)"}`,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Tag + slide-picker plan. Each slide gets a checkbox so the
            operator can exclude any from the batch. Schedule mode also
            shows the computed target time per slide. */}
        <label style={{ display: "block", fontSize: "0.65rem", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(245,240,232,0.6)", marginBottom: 6 }}>
          Slides ({selectedIndices.length} / {plan.perSlide.length} picked · {plan.uniqueAcrossSlides.length} unique accounts)
        </label>
        <div style={{
          background: "#0e0e10", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4,
          padding: "8px 10px", fontSize: "0.72rem", color: "rgba(245,240,232,0.75)",
          marginBottom: 6, maxHeight: 180, overflowY: "auto", lineHeight: 1.5,
        }}>
          {plan.perSlide.length === 0 ? (
            <em style={{ color: "rgba(245,240,232,0.4)" }}>No slides.</em>
          ) : plan.perSlide.map((slideTags, i) => {
            const day = Array.isArray(slideDays) ? slideDays[i] : null;
            const sched = mode === "schedule" ? schedules[i] : null;
            const isChecked = slideChecked[i] !== false;
            return (
              <label
                key={i}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 4,
                  cursor: busy ? "not-allowed" : "pointer", opacity: isChecked ? 1 : 0.4,
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => setSlideChecked((prev) => ({ ...prev, [i]: e.target.checked }))}
                  disabled={busy}
                  style={{ accentColor: "#F472B6", marginTop: 3 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <span style={{ color: "#E5BC4F", fontWeight: 700 }}>
                      Slide {i + 1}{day ? ` · ${day}` : ""}:
                    </span>{" "}
                    {slideTags.length ? slideTags.map((h) => `@${h}`).join(" · ") : (
                      <em style={{ color: "rgba(245,240,232,0.35)" }}>(no tags)</em>
                    )}
                  </div>
                  {sched && (
                    <div style={{ fontSize: "0.6rem", color: sched.immediate ? "#FBBF24" : "rgba(52,211,153,0.9)", marginTop: 2 }}>
                      {sched.immediate
                        ? "⚡ Past due — will post ASAP after scheduler picks it up"
                        : `📅 ${formatScheduleTime(sched.scheduledAt)}`}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
        <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", marginBottom: 14, lineHeight: 1.4 }}>
          Tags per slide come from the handles of events on that slide (up to {plan.maxPerSlide} per slide — IG's hard cap).
          {blockedCount > 0 && ` ${blockedCount} blocked (${plan.blocked.join(", ")}).`}
          {mode === "now" && selectedIndices.length === 1 && " Single-image feed post (not carousel)."}
          {mode === "schedule" && " Each picked slide posts as its own feed post at the time shown."}
        </div>

        {/* Story posting — optional. When checked, every carousel slide
            is ALSO posted as its own Story with the same per-slide
            mentions. Stories are published one at a time (not a
            container) so the count in the status reflects how many
            went through. */}
        <label
          style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
            fontSize: "0.75rem", color: "rgba(245,240,232,0.85)", cursor: busy ? "not-allowed" : "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={alsoPostStory}
            onChange={(e) => setAlsoPostStory(e.target.checked)}
            disabled={busy}
            style={{ accentColor: "#F472B6" }}
          />
          Also post each slide to Story with the same mentions
          {alsoPostStory && (
            <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", marginLeft: 6 }}>
              · {plan.perSlide.length} Stor{plan.perSlide.length === 1 ? "y" : "ies"}
            </span>
          )}
        </label>

        {/* Caption — pre-filled from the Calendar's current caption, fully
            editable. If no caption exists yet when the modal opens we
            auto-generate a draft so the box is never blank. First
            keystroke flips captionTouchedRef so later re-renders don't
            overwrite what the operator typed. */}
        <label style={{ display: "block", fontSize: "0.65rem", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(245,240,232,0.6)", marginBottom: 6 }}>
          Caption {captionBusy && <span style={{ color: "#C084FC", textTransform: "none", letterSpacing: 0, fontSize: "0.6rem" }}>· ✨ drafting…</span>}
        </label>
        <textarea
          value={captionBusy && !caption ? "✨ drafting caption, hold on…" : caption}
          onChange={(e) => { captionTouchedRef.current = true; setCaption(e.target.value); }}
          disabled={busy || captionBusy}
          rows={8}
          style={{
            width: "100%", padding: "10px", background: "#0e0e10", color: "#F5F0E8",
            border: "1px solid rgba(245,240,232,0.15)", borderRadius: 4, fontSize: "0.82rem",
            fontFamily: "inherit", resize: "vertical", marginBottom: 6, lineHeight: 1.5,
            fontStyle: captionBusy && !caption ? "italic" : "normal",
            opacity: captionBusy && !caption ? 0.6 : 1,
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
            disabled={busy || captionBusy || caption.length > 2200 || !caption.trim() || selectedIndices.length === 0}
            style={{
              padding: "8px 16px",
              background: (busy || captionBusy) ? "rgba(99,179,237,0.3)" : "#63B3ED",
              color: (busy || captionBusy) ? "rgba(14,14,16,0.6)" : "#0e0e10",
              border: "none", borderRadius: 4, fontSize: "0.78rem", fontWeight: 700,
              cursor: busy ? "wait" : (captionBusy || caption.length > 2200 || !caption.trim() || selectedIndices.length === 0 ? "not-allowed" : "pointer"),
              letterSpacing: "0.3px",
            }}
          >
            {busy
              ? (mode === "schedule" ? "Scheduling…" : "Publishing…")
              : captionBusy
                ? "Drafting caption…"
                : mode === "schedule"
                  ? `📅 Schedule ${selectedIndices.length} slide${selectedIndices.length === 1 ? "" : "s"}`
                  : selectedIndices.length === 1
                    ? "📱 Post 1 slide now"
                    : `📱 Post carousel now`}
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
