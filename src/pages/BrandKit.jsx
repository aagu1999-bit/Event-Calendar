import { useState } from "react";
import { useBrandStore } from "../store";

// FONT_PAIRS mirrors the constant in MediaTool.jsx — keep keys in sync.
// Listed here as display names so the user picks by what they see, not
// by the internal slug.
const FONT_PAIR_OPTIONS = [
  { key: "default", name: "Syne + DM Sans", display: "Syne", body: "DM Sans" },
  { key: "bold",    name: "Bebas + Inter", display: "Bebas Neue", body: "Inter" },
  { key: "serif",   name: "Playfair + Inter", display: "Playfair Display", body: "Inter" },
  { key: "modern",  name: "Space Grotesk + Inter", display: "Space Grotesk", body: "Inter" },
];

// Curated palette presets — small set so users can pick without
// drowning in options. Brand colors live first; alt tones follow.
const PALETTE_PRESETS = [
  { name: "CGE Classic",  bg: "#0a0a0a", text: "#F5F0E8", accent: "#E5BC4F" },
  { name: "Editorial",    bg: "#F5F0E8", text: "#0a0a0a", accent: "#E5BC4F" },
  { name: "News Charcoal", bg: "#1a1a1a", text: "#F5F0E8", accent: "#FB7185" },
  { name: "Ivory + Ink",  bg: "#F5F0E8", text: "#0a0a0a", accent: "#7C3AED" },
  { name: "Deep Plum",    bg: "#1F1233", text: "#F5F0E8", accent: "#FBBF24" },
  { name: "Night Blue",   bg: "#0B1226", text: "#F5F0E8", accent: "#63B3ED" },
];

const Section = ({ title, children }) => (
  <div style={{
    background: "rgba(245,240,232,0.03)",
    border: "1px solid rgba(245,240,232,0.06)",
    borderRadius: 8,
    padding: 20,
    marginBottom: 16,
  }}>
    <div style={{
      fontSize: "0.65rem",
      letterSpacing: "2px",
      textTransform: "uppercase",
      color: "#E5BC4F",
      marginBottom: 14,
      fontWeight: 700,
    }}>{title}</div>
    {children}
  </div>
);

const Label = ({ children }) => (
  <div style={{
    fontSize: "0.7rem",
    color: "rgba(245,240,232,0.65)",
    marginBottom: 5,
    letterSpacing: "0.5px",
  }}>{children}</div>
);

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  background: "#111",
  border: "1px solid rgba(245,240,232,0.08)",
  borderRadius: 4,
  color: "#F5F0E8",
  fontFamily: "'DM Sans',sans-serif",
  fontSize: "0.8rem",
  outline: "none",
  boxSizing: "border-box",
};

function ColorField({ label, value, onChange }) {
  return (
    <div style={{ flex: 1, minWidth: 130 }}>
      <Label>{label}</Label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 38, height: 32, border: "1px solid rgba(245,240,232,0.1)",
            borderRadius: 4, background: "#111", cursor: "pointer", padding: 2,
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, fontFamily: "monospace", fontSize: "0.72rem" }}
        />
      </div>
    </div>
  );
}

export default function BrandKit() {
  const palette = useBrandStore((s) => s.palette);
  const alternateColors = useBrandStore((s) => s.alternateColors);
  const fontPairKey = useBrandStore((s) => s.fontPairKey);
  const creator = useBrandStore((s) => s.creator);
  const defaults = useBrandStore((s) => s.defaults);
  const voice = useBrandStore((s) => s.voice);

  const setPalette = useBrandStore((s) => s.setPalette);
  const setAlternateColors = useBrandStore((s) => s.setAlternateColors);
  const setFontPairKey = useBrandStore((s) => s.setFontPairKey);
  const setCreator = useBrandStore((s) => s.setCreator);
  const setDefaults = useBrandStore((s) => s.setDefaults);
  const setVoice = useBrandStore((s) => s.setVoice);
  const addExemplar = useBrandStore((s) => s.addExemplar);
  const removeExemplar = useBrandStore((s) => s.removeExemplar);
  const resetToDefaults = useBrandStore((s) => s.resetToDefaults);

  const [exemplarDraft, setExemplarDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  const fp = FONT_PAIR_OPTIONS.find((p) => p.key === fontPairKey) || FONT_PAIR_OPTIONS[0];

  return (
    <div style={{
      minHeight: "calc(100vh - 60px)",
      background: "#080808",
      color: "#F5F0E8",
      fontFamily: "'DM Sans',sans-serif",
      padding: "30px 40px",
    }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
          <h1 style={{
            fontSize: "1.8rem",
            fontWeight: 700,
            letterSpacing: "1px",
            margin: 0,
            fontFamily: "'Syne',sans-serif",
          }}>
            Brand Kit
          </h1>
          <span style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>
            Reactive core — every tool reads from here
          </span>
        </div>
        <p style={{ color: "rgba(245,240,232,0.55)", fontSize: "0.82rem", marginTop: 4, marginBottom: 24, maxWidth: 720 }}>
          Set your brand identity once. Watermarks, accent colors, font pair, and creator info on every Media / Flyer / Newsletter slide pull from these values — overrides are still allowed per slide, this is the starting point.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
          {/* LEFT COLUMN — Identity + Palette + Typography */}
          <div>
            {/* Identity */}
            <Section title="Identity">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <Label>Brand Name</Label>
                  <input
                    type="text"
                    value={creator.brandName}
                    onChange={(e) => setCreator({ brandName: e.target.value })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <Label>Handle</Label>
                  <input
                    type="text"
                    value={creator.handle}
                    onChange={(e) => setCreator({ handle: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <Label>Logo Letters</Label>
                  <input
                    type="text"
                    maxLength={4}
                    value={creator.logoText}
                    onChange={(e) => setCreator({ logoText: e.target.value.toUpperCase() })}
                    style={{ ...inputStyle, letterSpacing: "2px", textAlign: "center", fontFamily: "'Syne',sans-serif", fontWeight: 700 }}
                  />
                </div>
                <div>
                  <Label>Footer URL</Label>
                  <input
                    type="text"
                    value={creator.url}
                    onChange={(e) => setCreator({ url: e.target.value })}
                    style={inputStyle}
                  />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", color: "rgba(245,240,232,0.7)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={creator.showWatermark}
                  onChange={(e) => setCreator({ showWatermark: e.target.checked })}
                />
                Show watermark + footer on slides by default
              </label>
            </Section>

            {/* Palette */}
            <Section title="Color Palette">
              <Label>Presets</Label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
                {PALETTE_PRESETS.map((p) => {
                  const isSelected = palette.background === p.bg && palette.text === p.text && palette.accent === p.accent;
                  return (
                    <button
                      key={p.name}
                      onClick={() => setPalette({ background: p.bg, text: p.text, accent: p.accent })}
                      style={{
                        background: "transparent",
                        border: isSelected ? "1.5px solid #E5BC4F" : "1px solid rgba(245,240,232,0.08)",
                        borderRadius: 6,
                        padding: 8,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 3, background: p.bg, border: "1px solid rgba(245,240,232,0.15)" }} />
                        <span style={{ width: 18, height: 18, borderRadius: 3, background: p.text, border: "1px solid rgba(245,240,232,0.15)" }} />
                        <span style={{ width: 18, height: 18, borderRadius: 3, background: p.accent, border: "1px solid rgba(245,240,232,0.15)" }} />
                      </div>
                      <div style={{ fontSize: "0.7rem", color: isSelected ? "#E5BC4F" : "rgba(245,240,232,0.7)" }}>
                        {p.name}
                      </div>
                    </button>
                  );
                })}
              </div>

              <Label>Custom</Label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                <ColorField label="Background" value={palette.background} onChange={(v) => setPalette({ background: v })} />
                <ColorField label="Text" value={palette.text} onChange={(v) => setPalette({ text: v })} />
                <ColorField label="Accent" value={palette.accent} onChange={(v) => setPalette({ accent: v })} />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", color: "rgba(245,240,232,0.7)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={alternateColors}
                  onChange={(e) => setAlternateColors(e.target.checked)}
                />
                Alternate background ↔ accent on every other slide
              </label>
            </Section>

            {/* Typography */}
            <Section title="Typography">
              <Label>Default font pair</Label>
              <select
                value={fontPairKey}
                onChange={(e) => setFontPairKey(e.target.value)}
                style={{ ...inputStyle, marginBottom: 14 }}
              >
                {FONT_PAIR_OPTIONS.map((p) => (
                  <option key={p.key} value={p.key} style={{ color: "#000" }}>
                    {p.name}
                  </option>
                ))}
              </select>

              {/* Live font preview */}
              <div style={{
                background: palette.background,
                color: palette.text,
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: 6,
                padding: 18,
                textAlign: "center",
              }}>
                <div style={{ fontFamily: `'${fp.display}',sans-serif`, fontWeight: 800, fontSize: "1.6rem", letterSpacing: "0.5px" }}>
                  HEADLINE LOOKS LIKE THIS
                </div>
                <div style={{ fontFamily: `'${fp.body}',sans-serif`, fontSize: "0.85rem", marginTop: 8, color: palette.text + "cc" }}>
                  Body copy reads like this — the editorial voice your carousel paragraphs sit in.
                </div>
                <div style={{
                  display: "inline-block",
                  marginTop: 12,
                  padding: "4px 12px",
                  background: palette.accent,
                  color: palette.background,
                  fontFamily: `'${fp.display}',sans-serif`,
                  fontSize: "0.7rem",
                  letterSpacing: "1.5px",
                  fontWeight: 800,
                  borderRadius: 3,
                }}>
                  ACCENT CHIP
                </div>
              </div>
            </Section>
          </div>

          {/* RIGHT COLUMN — Defaults + Voice */}
          <div>
            <Section title="Editorial Defaults">
              <Label>Region</Label>
              <input
                type="text"
                value={defaults.region}
                onChange={(e) => setDefaults({ region: e.target.value.toUpperCase() })}
                style={{ ...inputStyle, marginBottom: 14 }}
              />

              <Label>Default category tag</Label>
              <input
                type="text"
                value={defaults.defaultCategoryTag}
                onChange={(e) => setDefaults({ defaultCategoryTag: e.target.value.toUpperCase() })}
                style={{ ...inputStyle, marginBottom: 14 }}
              />

              <Label>Category tag presets</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {defaults.categoryTagPresets.map((tag, i) => (
                  <span key={i} style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    background: "rgba(229,188,79,0.10)",
                    border: "1px solid rgba(229,188,79,0.3)",
                    color: "#E5BC4F",
                    fontSize: "0.68rem",
                    letterSpacing: "1px",
                    borderRadius: 3,
                  }}>
                    {tag}
                    <button
                      onClick={() => setDefaults({
                        categoryTagPresets: defaults.categoryTagPresets.filter((_, j) => j !== i),
                      })}
                      style={{
                        background: "transparent", border: "none", color: "#E5BC4F",
                        cursor: "pointer", padding: 0, fontSize: "0.8rem", lineHeight: 1,
                      }}
                    >×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  placeholder="Add preset (e.g. TONIGHT IN NJ)"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = tagDraft.trim().toUpperCase();
                      if (v && !defaults.categoryTagPresets.includes(v)) {
                        setDefaults({ categoryTagPresets: [...defaults.categoryTagPresets, v] });
                      }
                      setTagDraft("");
                    }
                  }}
                  style={inputStyle}
                />
                <button
                  onClick={() => {
                    const v = tagDraft.trim().toUpperCase();
                    if (v && !defaults.categoryTagPresets.includes(v)) {
                      setDefaults({ categoryTagPresets: [...defaults.categoryTagPresets, v] });
                    }
                    setTagDraft("");
                  }}
                  style={{
                    padding: "6px 14px",
                    background: "rgba(229,188,79,0.15)",
                    border: "1px solid rgba(229,188,79,0.35)",
                    color: "#E5BC4F",
                    borderRadius: 4,
                    fontSize: "0.72rem",
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >Add</button>
              </div>
            </Section>

            <Section title="Voice Fingerprint">
              <div style={{ fontSize: "0.68rem", color: "rgba(245,240,232,0.4)", marginBottom: 10, fontStyle: "italic" }}>
                Phase 2 — saved, prepended to every Gemini caption call once wiring lands.
              </div>

              <Label>Voice description</Label>
              <textarea
                rows={3}
                placeholder='e.g. "Editorial. NJ-first. News-headline framing. Conversational but never slangy. Three-beat sentences."'
                value={voice.description}
                onChange={(e) => setVoice({ description: e.target.value })}
                style={{ ...inputStyle, resize: "vertical", marginBottom: 14, fontFamily: "inherit" }}
              />

              <Label>Past captions ({voice.exemplars.length})</Label>
              {voice.exemplars.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {voice.exemplars.map((cap, i) => (
                    <div key={i} style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      padding: 8,
                      marginBottom: 6,
                      background: "rgba(245,240,232,0.02)",
                      border: "1px solid rgba(245,240,232,0.06)",
                      borderRadius: 4,
                    }}>
                      <div style={{ flex: 1, fontSize: "0.75rem", color: "rgba(245,240,232,0.75)", whiteSpace: "pre-wrap" }}>
                        {cap}
                      </div>
                      <button
                        onClick={() => removeExemplar(i)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "rgba(251,113,133,0.7)",
                          cursor: "pointer",
                          fontSize: "0.9rem",
                          padding: 0,
                          lineHeight: 1,
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                rows={2}
                placeholder="Paste a past caption you're proud of, hit ⏎"
                value={exemplarDraft}
                onChange={(e) => setExemplarDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (exemplarDraft.trim()) {
                      addExemplar(exemplarDraft);
                      setExemplarDraft("");
                    }
                  }
                }}
                style={{ ...inputStyle, resize: "vertical", marginBottom: 8, fontFamily: "inherit" }}
              />
              <button
                onClick={() => {
                  if (exemplarDraft.trim()) {
                    addExemplar(exemplarDraft);
                    setExemplarDraft("");
                  }
                }}
                disabled={!exemplarDraft.trim()}
                style={{
                  padding: "6px 14px",
                  background: exemplarDraft.trim() ? "rgba(229,188,79,0.15)" : "rgba(245,240,232,0.04)",
                  border: "1px solid " + (exemplarDraft.trim() ? "rgba(229,188,79,0.35)" : "rgba(245,240,232,0.06)"),
                  color: exemplarDraft.trim() ? "#E5BC4F" : "rgba(245,240,232,0.3)",
                  borderRadius: 4,
                  fontSize: "0.72rem",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  cursor: exemplarDraft.trim() ? "pointer" : "not-allowed",
                  fontFamily: "inherit",
                }}
              >+ Add caption</button>
            </Section>

            <div style={{ marginTop: 20, padding: "12px 16px", background: "rgba(251,113,133,0.04)", border: "1px solid rgba(251,113,133,0.15)", borderRadius: 6 }}>
              <button
                onClick={() => {
                  if (confirm("Reset Brand Kit to CGE defaults? Your custom palette, voice, and presets will be lost.")) {
                    resetToDefaults();
                  }
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#FB7185",
                  fontSize: "0.72rem",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >↺ Reset to CGE defaults</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
