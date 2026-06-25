import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useBrandStore, useCarouselTemplatesStore, BUILTIN_CAROUSEL_TEMPLATES } from "../store";
import { generateTemplateFill } from "./aiContent.js";

// Modal for AI-assisted whole-carousel generation. Pick a template,
// type a topic + context, Gemini fills every slot in the sequence in
// one coherent call. Output → preview cards → "Push to carousel".
//
// Props:
//   open               — boolean
//   apiKey             — Gemini key (from MediaTool)
//   initialTemplateId  — preselect a template
//   onClose()
//   onAccept(slides)   — slides array matching the template's sequence

export function AiTemplateFillModal({ open, apiKey, initialTemplateId, onClose, onAccept }) {
  const voice = useBrandStore((s) => s.voice);
  const slotPrompts = useBrandStore((s) => s.slotPrompts);
  const customs = useCarouselTemplatesStore((s) => s.customs);
  const allTemplates = [...BUILTIN_CAROUSEL_TEMPLATES, ...customs];

  const [templateId, setTemplateId] = useState(initialTemplateId || allTemplates[0]?.id || "");
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [slides, setSlides] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setSlides([]);
      setError("");
      setBusy(false);
      if (initialTemplateId) setTemplateId(initialTemplateId);
    }
  }, [open, initialTemplateId]);

  if (!open) return null;

  const template = allTemplates.find(t => t.id === templateId) || allTemplates[0];
  const voiceOn = (voice?.description && voice.description.trim()) ||
                  (Array.isArray(voice?.exemplars) && voice.exemplars.some(e => e && e.trim()));

  const handleGenerate = async () => {
    if (!apiKey) { setError("Paste your Gemini API key in the MediaTool toolbar first."); return; }
    if (!template) { setError("Pick a template first."); return; }
    if (!topic.trim()) { setError("Type a topic first."); return; }
    setBusy(true);
    setError("");
    setSlides([]);
    try {
      const result = await generateTemplateFill({
        apiKey,
        sequence: template.sequence,
        topic,
        context,
        voice,
        slotPrompts,
      });
      setSlides(result);
    } catch (err) {
      console.error(err);
      setError(err.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePush = () => {
    onAccept(slides, template);
    onClose();
  };

  // Small per-type preview renderer for the result cards.
  const renderPreview = (slot, idx) => {
    const num = idx + 1;
    if (slot.type === "cover") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Cover
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1rem", fontWeight: 800, lineHeight: 1.15 }}>
            {(slot.headline || "").split(/\s+/).map((w, wi) => (
              <span key={wi} style={{ color: slot.accentWord && w.toLowerCase() === String(slot.accentWord).toLowerCase() ? "#E5BC4F" : "inherit" }}>
                {w}{" "}
              </span>
            ))}
          </div>
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)", marginTop: 4 }}>
            {slot.subtitle}
          </div>
        </div>
      );
    }
    if (slot.type === "text") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Text (manifesto)
          </div>
          {slot.textTitle && (
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.9rem", fontWeight: 800, marginBottom: 6 }}>
              {slot.textTitle}
            </div>
          )}
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.75)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {slot.textBody}
          </div>
        </div>
      );
    }
    if (slot.type === "spotlight") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · Spotlight
          </div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "0.95rem", fontWeight: 800, marginBottom: 4 }}>
            {slot.spotName}
          </div>
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)" }}>
            {slot.spotMeta}
          </div>
          {(slot.spotTime || slot.spotPrice || slot.spotCta) && (
            <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", marginTop: 4 }}>
              {[slot.spotTime, slot.spotPrice, slot.spotCta].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>
      );
    }
    if (slot.type === "cta") {
      return (
        <div>
          <div style={{ fontSize: "0.5rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
            Slide {num} · CTA
          </div>
          {slot.ctaKicker && (
            <div style={{ display: "inline-block", padding: "2px 8px", background: "#E5BC4F", color: "#000", fontSize: "0.5rem", fontWeight: 800, letterSpacing: 1.5, marginBottom: 6, borderRadius: 3, fontFamily: "'Syne',sans-serif" }}>
              {(slot.ctaKicker || "").toUpperCase()}
            </div>
          )}
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "1rem", fontWeight: 800, marginBottom: 4 }}>
            {slot.ctaDate}
          </div>
          <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)" }}>
            {slot.ctaVenue}
          </div>
          {slot.ctaUrl && (
            <div style={{ fontSize: "0.6rem", color: "#E5BC4F", marginTop: 4 }}>
              {slot.ctaUrl}
            </div>
          )}
        </div>
      );
    }
    return (
      <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.5)" }}>
        Slide {num} · {slot.type} (no preview)
      </div>
    );
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.78)",
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
          maxWidth: 820,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          color: "#F5F0E8",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: "1.15rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 1, margin: 0 }}>
            ✨ AI Fill Template
          </h2>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.55)", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}
            title="Close"
          >×</button>
        </div>

        <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)", marginBottom: 14, lineHeight: 1.5 }}>
          Pick a template, type your topic + context. Gemini fills every slide in the sequence in one coherent pass — Cover headline, Text manifesto, Spotlight cards (one per angle), CTA listings (one per event). Per-slot rules from <strong>/brand → Slide Content Rules</strong> apply.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.65)", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>
              Template
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "#111",
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: 4,
                color: "#F5F0E8",
                fontFamily: "inherit",
                fontSize: "0.78rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            >
              <optgroup label="Built-in" style={{ color: "#000" }}>
                {BUILTIN_CAROUSEL_TEMPLATES.map(t => (
                  <option key={t.id} value={t.id} style={{ color: "#000" }}>{t.name} ({t.sequence.length})</option>
                ))}
              </optgroup>
              {customs.length > 0 && (
                <optgroup label="Your saved" style={{ color: "#000" }}>
                  {customs.map(t => (
                    <option key={t.id} value={t.id} style={{ color: "#000" }}>{t.name} ({t.sequence.length})</option>
                  ))}
                </optgroup>
              )}
            </select>
            {template && (
              <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", marginTop: 4, letterSpacing: 0.5 }}>
                {template.sequence.join(" → ")}
              </div>
            )}
          </div>
          <div>
            <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.65)", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>
              Topic (carousel headline subject)
            </label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder='"Juneteenth 2026 weekend in NJ"'
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "#111",
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: 4,
                color: "#F5F0E8",
                fontFamily: "inherit",
                fontSize: "0.78rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.65)", display: "block", marginBottom: 5, letterSpacing: 0.5 }}>
          Context — event details / selling points / lineup / description
        </label>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={6}
          placeholder='For Feature Drop: "Live DJ, Bachata lessons, DJ JdaBachata and DJ Carlita, Luzz Pickleball Paddle 2025 Glider giveaway, gift baskets, 100+ singles, Pickleball HQ Aberdeen, July 11"

For Editorial Roundup: 5 events with name · day · time · venue · URL each, one per line.'
          style={{
            width: "100%",
            padding: "8px 10px",
            background: "#111",
            border: "1px solid rgba(245,240,232,0.08)",
            borderRadius: 4,
            color: "#F5F0E8",
            fontFamily: "inherit",
            fontSize: "0.78rem",
            outline: "none",
            boxSizing: "border-box",
            resize: "vertical",
            marginBottom: 12,
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <button
            onClick={handleGenerate}
            disabled={busy || !topic.trim()}
            style={{
              padding: "9px 18px",
              background: busy ? "rgba(229,188,79,0.4)" : (topic.trim() ? "#E5BC4F" : "rgba(229,188,79,0.25)"),
              color: "#000",
              border: "none",
              borderRadius: 4,
              fontSize: "0.72rem",
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: busy ? "wait" : (topic.trim() ? "pointer" : "not-allowed"),
              fontFamily: "'Syne',sans-serif",
            }}
          >{busy ? "Generating…" : (slides.length ? "↻ Regenerate" : `✨ Generate ${template?.sequence?.length || 0} slides`)}</button>

          <span style={{ fontSize: "0.6rem", color: voiceOn ? "#34D399" : "rgba(245,240,232,0.4)", letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>
            {voiceOn ? "🎙 Voice: ON" : "🎙 Voice: off"}
          </span>
        </div>

        {error && (
          <div style={{ marginBottom: 14, padding: "10px 12px", background: "rgba(251,113,133,0.08)", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 4, fontSize: "0.7rem", color: "rgba(251,113,133,0.9)" }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {slides.length > 0 && (
          <>
            <div style={{ fontSize: "0.55rem", color: "#E5BC4F", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif", marginBottom: 8 }}>
              Preview · {slides.length} slides
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {slides.map((slot, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 12,
                    background: "rgba(229,188,79,0.04)",
                    border: "1px solid rgba(229,188,79,0.20)",
                    borderRadius: 6,
                  }}
                >
                  {renderPreview(slot, idx)}
                </div>
              ))}
            </div>

            <button
              onClick={handlePush}
              style={{
                width: "100%",
                padding: "12px 18px",
                background: "#34D399",
                color: "#000",
                border: "none",
                borderRadius: 4,
                fontSize: "0.78rem",
                fontWeight: 800,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
              }}
            >→ Push {slides.length} slides to carousel</button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
