import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBrandStore } from "../store";
import { generateSlideContent } from "./aiContent.js";

// Modal for AI-assisted slot generation (Cover, CTA). Topic in →
// 3 options out → user picks → onAccept fires with the chosen option.
//
// Props:
//   open       — boolean
//   slotType   — "cover" | "cta"
//   apiKey     — Gemini API key (from MediaTool)
//   initialTopic — pre-fill the topic field (e.g., current Cover headline)
//   onClose()
//   onAccept(option) — option matches the slot's schema

export function AiSlideGeneratorModal({ open, slotType, apiKey, initialTopic, onClose, onAccept }) {
  const voice = useBrandStore((s) => s.voice);
  const slotPrompts = useBrandStore((s) => s.slotPrompts);
  const addExemplar = useBrandStore((s) => s.addExemplar);

  const [topic, setTopic] = useState(initialTopic || "");
  const [options, setOptions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Tracks which option indices have been harvested as exemplars this
  // session. Lets the button flip to a "✓ Saved" state without needing
  // to dedupe against the store.
  const [savedIdx, setSavedIdx] = useState(new Set());

  // Reset state every time the modal opens for a new slot.
  useEffect(() => {
    if (open) {
      setTopic(initialTopic || "");
      setOptions([]);
      setError("");
      setBusy(false);
      setSavedIdx(new Set());
    }
  }, [open, slotType, initialTopic]);

  // Render an option as a plain-text exemplar Gemini can model on
  // future generations. Different slots produce different prose shapes:
  // Cover → headline + subtitle. CTA → kicker · main · sub.
  const optionToExemplarText = (opt) => {
    if (slotType === "cover") {
      return [opt.headline, opt.subtitle].map(s => (s || "").trim()).filter(Boolean).join("\n\n");
    }
    if (slotType === "cta") {
      const k = (opt.kicker || "").trim();
      return [k && k.toUpperCase(), opt.mainLine, opt.subLine].map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slotType === "text") {
      return [opt.textTitle, opt.textBody].map(s => (s || "").trim()).filter(Boolean).join("\n\n");
    }
    if (slotType === "spotlight") {
      const detail = [opt.spotTime, opt.spotPrice, opt.spotCta].filter(Boolean).join(" · ");
      return [opt.spotName, opt.spotMeta, detail].map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slotType === "photo") {
      return [opt.caption, opt.captionSecondary].map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slotType === "stat") {
      return `${opt.statNumber || ""} ${opt.statLabel || ""}\n${opt.statSub || ""}`.trim();
    }
    if (slotType === "countdown") {
      return [opt.countText, opt.countEvent, opt.countWhen, opt.countCta].map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slotType === "poster") {
      return [opt.kicker, opt.title, opt.subtitle, opt.dateLine].map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slotType === "press") {
      return [opt.pressTitle, opt.pressLineup, opt.pressGenres, opt.pressDateLine].map(s => (s || "").trim()).filter(Boolean).join("\n");
    }
    if (slotType === "features") {
      const items = Array.isArray(opt.features) ? opt.features : [];
      const body = items.map(f => `${f.emoji || ""} ${f.headline || ""} — ${f.sub || ""}`.trim()).join("\n");
      return [opt.featuresTitle, body].filter(Boolean).join("\n");
    }
    return JSON.stringify(opt);
  };

  const handleSaveAsExemplar = (opt, idx) => {
    const text = optionToExemplarText(opt).trim();
    if (!text) return;
    addExemplar(text);
    setSavedIdx(prev => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
  };

  if (!open) return null;

  const SLOT_LABELS = {
    cover: "Cover", text: "Text", spotlight: "Spotlight", cta: "CTA",
    photo: "Photo Caption", stat: "Stat", countdown: "Countdown",
    poster: "Poster", press: "Press", features: "Features",
  };
  const slotLabel = SLOT_LABELS[slotType] || slotType;

  const handleGenerate = async () => {
    if (!apiKey) { setError("Paste your Gemini API key in the MediaTool toolbar first."); return; }
    if (!topic.trim()) { setError("Type a topic first."); return; }
    setBusy(true);
    setError("");
    setOptions([]);
    try {
      const opts = await generateSlideContent({ apiKey, slotType, topic, voice, slotPrompts });
      setOptions(opts);
    } catch (err) {
      console.error(err);
      setError(err.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePick = (opt) => {
    onAccept(opt);
    onClose();
  };

  const voiceOn = (voice?.description && voice.description.trim()) ||
                  (Array.isArray(voice?.exemplars) && voice.exemplars.some(e => e && e.trim()));

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
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
          maxWidth: 720,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          color: "#F5F0E8",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.1rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 1, margin: 0 }}>
            ✨ AI Generate · {slotLabel}
          </h2>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.55)", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}
            title="Close"
          >×</button>
        </div>

        <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)", marginBottom: 14, lineHeight: 1.5 }}>
          Type the topic of this carousel. Gemini will write 3 options using your Brand Kit voice + the {slotLabel} content rule. Edit the rule in <strong>/brand → Slide Content Rules</strong>.
        </div>

        <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.65)", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>
          Topic
        </label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder='e.g. "Juneteenth 2026 weekend in NJ" or "Soulja Boy at Lotus Rooftop"'
          rows={2}
          style={{
            width: "100%",
            padding: "8px 10px",
            background: "#111",
            border: "1px solid rgba(245,240,232,0.08)",
            borderRadius: 4,
            color: "#F5F0E8",
            fontFamily: "inherit",
            fontSize: "0.8rem",
            outline: "none",
            boxSizing: "border-box",
            resize: "vertical",
            marginBottom: 10,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <button
            onClick={handleGenerate}
            disabled={busy || !topic.trim()}
            style={{
              padding: "8px 16px",
              background: busy ? "rgba(229,188,79,0.4)" : (topic.trim() ? "#E5BC4F" : "rgba(229,188,79,0.25)"),
              color: "#000",
              border: "none",
              borderRadius: 4,
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: busy ? "wait" : (topic.trim() ? "pointer" : "not-allowed"),
              fontFamily: "'Syne',sans-serif",
            }}
          >{busy ? "Generating…" : (options.length ? "↻ Regenerate" : "✨ Generate 3 options")}</button>

          <span style={{ fontSize: "0.6rem", color: voiceOn ? "#34D399" : "rgba(245,240,232,0.4)", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>
            {voiceOn ? "🎙 Voice: ON" : "🎙 Voice: off"}
          </span>
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "rgba(251,113,133,0.08)", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 4, fontSize: "0.7rem", color: "rgba(251,113,133,0.9)" }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {options.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: "0.55rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>
              Pick one to fill the form
            </div>
            {options.map((opt, i) => (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => handlePick(opt)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePick(opt); } }}
                style={{
                  position: "relative",
                  textAlign: "left",
                  padding: 14,
                  paddingRight: 48,
                  background: "rgba(229,188,79,0.04)",
                  border: "1px solid rgba(229,188,79,0.20)",
                  borderRadius: 6,
                  color: "#F5F0E8",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(229,188,79,0.10)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(229,188,79,0.04)"}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); handleSaveAsExemplar(opt, i); }}
                  disabled={savedIdx.has(i)}
                  title={savedIdx.has(i) ? "Saved to Brand Voice exemplars" : "Save to Brand Voice — feeds future generations"}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    background: savedIdx.has(i) ? "rgba(52,211,153,0.15)" : "transparent",
                    border: `1px solid ${savedIdx.has(i) ? "rgba(52,211,153,0.4)" : "rgba(229,188,79,0.25)"}`,
                    color: savedIdx.has(i) ? "#34D399" : "rgba(229,188,79,0.8)",
                    fontSize: "0.55rem",
                    fontWeight: 700,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    padding: "3px 7px",
                    borderRadius: 3,
                    cursor: savedIdx.has(i) ? "default" : "pointer",
                    fontFamily: "'Syne',sans-serif",
                  }}
                >
                  {savedIdx.has(i) ? "✓ Saved" : "🔖 Save"}
                </button>
                {renderOptionPreview(slotType, opt)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// Per-slot option preview renderer. Each slot type knows how to render
// ONE option as a compact preview card inside the modal. Mirrors the
// shape of AiTemplateFillModal.renderPreview but flattened — no "Slide
// N · X" header since each card here is one option, not one slide.
function renderOptionPreview(slotType, opt) {
  if (slotType === "cover") {
    return (
      <>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.05rem", fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>
          {(opt.headline || "").split(/\s+/).map((w, wi) => (
            <span key={wi} style={{ color: opt.accentWord && w.toLowerCase() === String(opt.accentWord).toLowerCase() ? "#E5BC4F" : "inherit" }}>
              {w}{" "}
            </span>
          ))}
        </div>
        <div style={{ fontSize: "0.75rem", color: "rgba(245,240,232,0.7)", marginBottom: 4 }}>{opt.subtitle}</div>
        {opt.accentWord && (
          <div style={{ fontSize: "0.55rem", color: "rgba(229,188,79,0.7)", letterSpacing: 1, textTransform: "uppercase", marginTop: 6 }}>
            Accent word: <strong>{opt.accentWord}</strong>
          </div>
        )}
      </>
    );
  }
  if (slotType === "cta") {
    return (
      <>
        {opt.kicker && (
          <div style={{ display: "inline-block", padding: "2px 8px", background: "#E5BC4F", color: "#000", fontSize: "0.55rem", fontWeight: 800, letterSpacing: 1.5, marginBottom: 8, borderRadius: 3, fontFamily: "'Syne',sans-serif" }}>
            {opt.kicker.toUpperCase()}
          </div>
        )}
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.05rem", fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>{opt.mainLine}</div>
        <div style={{ fontSize: "0.75rem", color: "rgba(245,240,232,0.7)" }}>{opt.subLine}</div>
      </>
    );
  }
  if (slotType === "text") {
    return (
      <>
        {opt.textTitle && (
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.95rem", fontWeight: 800, letterSpacing: 0.5, marginBottom: 6 }}>{opt.textTitle}</div>
        )}
        <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.75)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{opt.textBody}</div>
      </>
    );
  }
  if (slotType === "spotlight") {
    return (
      <>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1rem", fontWeight: 800, marginBottom: 4 }}>{opt.spotName}</div>
        <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)" }}>{opt.spotMeta}</div>
        {(opt.spotTime || opt.spotPrice || opt.spotCta) && (
          <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", marginTop: 4 }}>
            {[opt.spotTime, opt.spotPrice, opt.spotCta].filter(Boolean).join(" · ")}
          </div>
        )}
      </>
    );
  }
  if (slotType === "photo") {
    return (
      <>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1rem", fontWeight: 800, marginBottom: 4 }}>{opt.caption}</div>
        {opt.captionSecondary && (
          <div style={{ fontSize: "0.6rem", color: "rgba(229,188,79,0.75)", letterSpacing: 1.5, textTransform: "uppercase" }}>{opt.captionSecondary}</div>
        )}
      </>
    );
  }
  if (slotType === "stat") {
    return (
      <>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.6rem", fontWeight: 900, color: "#F5F0E8" }}>{opt.statNumber}</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.8rem", fontWeight: 800, letterSpacing: 1.5 }}>{opt.statLabel}</div>
        </div>
        {opt.statSub && <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)" }}>{opt.statSub}</div>}
      </>
    );
  }
  if (slotType === "countdown") {
    return (
      <>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.2rem", fontWeight: 900, color: "#E5BC4F", letterSpacing: 1, marginBottom: 4 }}>{opt.countText}</div>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.9rem", fontWeight: 800, marginBottom: 4 }}>{opt.countEvent}</div>
        {opt.countWhen && <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.75)" }}>{opt.countWhen}</div>}
        {opt.countCta && <div style={{ fontSize: "0.6rem", color: "#E5BC4F", marginTop: 4 }}>{opt.countCta}</div>}
      </>
    );
  }
  if (slotType === "poster") {
    return (
      <>
        {opt.topLine && (
          <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.7)", letterSpacing: 2, marginBottom: 6, fontFamily: "ui-monospace,Menlo,monospace" }}>{opt.topLine}</div>
        )}
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.05rem", fontWeight: 900, lineHeight: 1.1, whiteSpace: "pre-wrap", marginBottom: 4 }}>{opt.title}</div>
        {opt.subtitle && <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.7)", fontStyle: "italic", marginBottom: 6 }}>{opt.subtitle}</div>}
        {opt.dateLine && (
          <div style={{ fontSize: "0.6rem", color: "rgba(229,188,79,0.85)", letterSpacing: 1, fontWeight: 700 }}>{opt.dateLine}</div>
        )}
      </>
    );
  }
  if (slotType === "press") {
    return (
      <>
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.4rem", fontWeight: 900, letterSpacing: 1, marginBottom: 4 }}>{opt.pressTitle}</div>
        {opt.pressBadge && (
          <div style={{ display: "inline-block", padding: "2px 6px", background: "rgba(212,63,47,0.85)", color: "#FFF", fontSize: "0.5rem", fontWeight: 800, letterSpacing: 1, marginBottom: 6, borderRadius: 2 }}>
            {opt.pressBadge}
          </div>
        )}
        {opt.pressLineup && (
          <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.75)", whiteSpace: "pre-wrap", marginBottom: 4, lineHeight: 1.4 }}>{opt.pressLineup}</div>
        )}
        {opt.pressGenres && (
          <div style={{ fontSize: "0.55rem", color: "rgba(242,201,76,0.85)", letterSpacing: 1.2, marginBottom: 4 }}>{opt.pressGenres}</div>
        )}
        {opt.pressDateLine && (
          <div style={{ fontSize: "0.6rem", color: "rgba(229,188,79,0.85)", letterSpacing: 1, fontWeight: 700 }}>{opt.pressDateLine}</div>
        )}
      </>
    );
  }
  if (slotType === "features") {
    const items = Array.isArray(opt.features) ? opt.features : [];
    return (
      <>
        {opt.featuresTitle && (
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.85rem", fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>{opt.featuresTitle}</div>
        )}
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {items.map((f, i) => (
            <li key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: "0.9rem" }}>{f.emoji}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.75rem" }}>{f.headline}</div>
                {f.sub && <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.65)" }}>{f.sub}</div>}
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.55)" }}>{JSON.stringify(opt)}</div>;
}
