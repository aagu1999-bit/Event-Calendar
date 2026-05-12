import { useState, useRef } from "react";
import { toPng } from "html-to-image";
import { useEventsStore } from "../store";

// ==================== CONTROL-PANE STYLES & PRIMITIVES ====================
// Defined at module scope (NOT inside FlyerBuilder) so React doesn't
// recreate them every render and unmount focused <input>s mid-keystroke.
const STYLE_L = { fontSize: "0.6rem", color: "rgba(245,240,232,0.55)", letterSpacing: "1.5px", textTransform: "uppercase", display: "block", marginBottom: "6px" };
const STYLE_I = { width: "100%", padding: "8px 10px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.78rem" };
const STYLE_B = { padding: "7px 10px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.65rem", cursor: "pointer", letterSpacing: "1px", textTransform: "uppercase" };
const STYLE_Bact = { ...STYLE_B, background: "rgba(229,188,79,0.15)", borderColor: "#E5BC4F", color: "#E5BC4F" };
function Section({ children }) { return <div style={{ marginBottom: "16px" }}>{children}</div>; }

// Crop/reposition helper: build the style props for an <img> from a photoCrop
// {x, y, zoom}. objectPosition pans within the cover-fit; scale+origin zooms
// around the chosen point so the same control feels like "pinch + drag" UX.
function photoCropStyle(crop) {
  const c = crop || { x: 50, y: 50, zoom: 1 };
  return {
    objectFit: "cover",
    objectPosition: `${c.x}% ${c.y}%`,
    transform: `scale(${c.zoom})`,
    transformOrigin: `${c.x}% ${c.y}%`,
  };
}

// ==================== THEMES ====================
// Mirrors Calendar's COLORS palette so flyers match slide families.
// `spot` is "R,G,B" (used to compose rgba spotlights).
// Accents mirror Calendar's COLORS so the flyer's "selected" color matches
// the slide family (Gold = Gold, Yellow = Yellow, Black = Gold accent, etc).
// `promoAccent` is the contrasting "deal panel" color used by HolidayPromo —
// the bold opposite that fills the offer block (red on yellow, etc).
const THEMES = {
  purple:  { name: "Purple",  bg: "#7C3AED", title: "#FFFFFF", accent: "#C084FC", spot: "255,255,255", spotA: 0.50, light: false, promoAccent: "#FCD34D" },
  gold:    { name: "Gold",    bg: "#D4943A", title: "#FFFFFF", accent: "#D4943A", spot: "255,255,255", spotA: 0.55, light: true,  promoAccent: "#1A1A1A" },
  wine:    { name: "Wine",    bg: "#BE3A34", title: "#FFFFFF", accent: "#FB7185", spot: "255,255,255", spotA: 0.50, light: false, promoAccent: "#FCD34D" },
  emerald: { name: "Emerald", bg: "#059669", title: "#FFFFFF", accent: "#34D399", spot: "255,255,255", spotA: 0.50, light: false, promoAccent: "#FACC15" },
  yellow:  { name: "Yellow",  bg: "#EAB308", title: "#000000", accent: "#EAB308", spot: "255,255,255", spotA: 0.55, light: true,  promoAccent: "#DC2626" },
  black:   { name: "Black",   bg: "#0F0F10", title: "#F5F0E8", accent: "#E5BC4F", spot: "229,188,79",  spotA: 0.45, light: false, promoAccent: "#E5BC4F" },
  cream:   { name: "Cream",   bg: "#EEE8DC", title: "#1A1A1A", accent: "#1A1A1A", spot: "0,0,0",       spotA: 0.05, light: true,  promoAccent: "#1A1A1A" },
};

// CGE letter pattern (tiled at -5°) — same motif as the Calendar slides.
// Rendered as inline SVG (not as a CSS background-image data URI) so the
// document's loaded fonts are available — embedded SVG-as-image runs in a
// sandboxed context that can't see document @font-face fonts.
// Three pattern sizes. Spacing-to-font ratio TIGHTENS as size grows so
// Large/XL stay visually dense rather than looking sparse with big lonely
// letters (the issue with naive proportional scaling).
//   regular: ratio ~3.0  — many small letters
//   large:   ratio ~2.3  — fewer but bigger, still dense
//   xl:      ratio ~1.9  — bold and crowded
const PATTERN_SIZES = {
  regular: { font: 30, spX: 92,  spY: 76  },
  large:   { font: 46, spX: 105, spY: 86  },
  xl:      { font: 64, spX: 122, spY: 100 },
};
function CgeLetterPattern({ color, opacity, size = "large", surfaceW = 1080, surfaceH = 1350 }) {
  const cfg = PATTERN_SIZES[size] || PATTERN_SIZES.large;
  const letters = ["C", "G", "E"];
  // Pad past the surface in both directions so rotated letters don't get
  // clipped at the corners (the SVG <pattern> tile-clip issue we just had).
  const padX = cfg.spX * 1.5;
  const padY = cfg.spY * 1.5;

  const cells = [];
  let idx = 0;
  let rowIdx = 0;
  for (let y = -padY; y < surfaceH + padY; y += cfg.spY) {
    const off = (rowIdx % 2 === 1) ? cfg.spX * 0.5 : 0;
    for (let x = -padX + off; x < surfaceW + padX; x += cfg.spX) {
      cells.push({ x, y, l: letters[idx % 3] });
      idx++;
    }
    rowIdx++;
  }

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${surfaceW} ${surfaceH}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        pointerEvents: "none",
      }}
    >
      <g
        transform={`rotate(-5 ${surfaceW / 2} ${surfaceH / 2})`}
        fill={color}
        fillOpacity={opacity}
        fontFamily="'Syne', Impact, Haettenschweiler, sans-serif"
        fontWeight={800}
        fontSize={cfg.font}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {cells.map((c, i) => <text key={i} x={c.x} y={c.y}>{c.l}</text>)}
      </g>
    </svg>
  );
}

// Display fonts available for the title / meta / footer.
// Syne Black (800) is the CGE house display face — used for letter texture
// in Calendar slides and as the typical title font. Bebas Neue (Google) and
// the user's local fonts in /public/fonts round out the rotation.
const DISPLAY_FONTS = [
  { key: "Syne Black",     stack: "'Syne', 'Bebas Neue', sans-serif", weight: 800 },
  { key: "Bebas Neue",     stack: "'Bebas Neue', 'Syne', sans-serif" },
  { key: "Anton",          stack: "'Anton Local', 'Bebas Neue', sans-serif" },
  { key: "Oswald",         stack: "'Oswald Local', 'Bebas Neue', sans-serif" },
  { key: "Archivo Black",  stack: "'Archivo Black', 'Bebas Neue', sans-serif" },
  { key: "Bowlby One",     stack: "'Bowlby One', 'Bebas Neue', sans-serif" },
  { key: "Alfa Slab One",  stack: "'Alfa Slab One', 'Bebas Neue', serif" },
  { key: "Bagel Fat One",  stack: "'Bagel Fat One', 'Bebas Neue', sans-serif" },
  { key: "Passion One",    stack: "'Passion One', 'Bebas Neue', sans-serif" },
  { key: "Rubik Mono One", stack: "'Rubik Mono One', 'Bebas Neue', monospace" },
  { key: "Sigmar",         stack: "'Sigmar', 'Bebas Neue', serif" },
  { key: "Staatliches",    stack: "'Staatliches', 'Bebas Neue', sans-serif" },
  // Serifs — for boutique/editorial templates
  { key: "DM Serif Display", stack: "'DM Serif Display', 'Playfair Display', serif", weight: 400 },
  { key: "Playfair Display", stack: "'Playfair Display', 'DM Serif Display', serif", weight: 900 },
  // Stencil/grunge — for torn-paper underground + holiday promo templates
  { key: "Saira Stencil",    stack: "'Saira Stencil One', 'Bungee Inline', sans-serif", weight: 400 },
  { key: "Bungee Inline",    stack: "'Bungee Inline', 'Saira Stencil One', sans-serif", weight: 400 },
  { key: "Black Ops One",    stack: "'Black Ops One', 'Saira Stencil One', sans-serif", weight: 400 },
];
const fontDef = (key) => DISPLAY_FONTS.find(f => f.key === key) || DISPLAY_FONTS[0];
const fontStack = (key) => fontDef(key).stack;
const fontWeight = (key) => fontDef(key).weight || 700;

// Twin-sparkle ornament — the centerpiece glyph.
function TwinSparkle({ color, size = 180 }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 360 180" style={{ display: "block" }}>
      <g fill={color}>
        <path d="M100 20 C 105 75, 115 85, 170 90 C 115 95, 105 105, 100 160 C 95 105, 85 95, 30 90 C 85 85, 95 75, 100 20 Z" />
        <path d="M260 20 C 265 75, 275 85, 330 90 C 275 95, 265 105, 260 160 C 255 105, 245 95, 190 90 C 245 85, 255 75, 260 20 Z" />
      </g>
    </svg>
  );
}

// === GOLDEN SERIES ORNAMENTS ===
// Three flavor-specific marks. Each replaces the generic twin-sparkle for
// the Golden Series template — distinct identity per flavor.

// Sunset Gold — horizon line with a half-sun rising and rays.
function HorizonOrnament({ color, size = 200 }) {
  return (
    <svg width={size} height={size * 0.45} viewBox="0 0 360 162" style={{ display: "block" }}>
      <g fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round">
        <line x1="20" y1="120" x2="340" y2="120" />
        <line x1="180" y1="38" x2="180" y2="18" />
        <line x1="140" y1="52" x2="120" y2="32" />
        <line x1="220" y1="52" x2="240" y2="32" />
        <line x1="112" y1="82" x2="88" y2="70" />
        <line x1="248" y1="82" x2="272" y2="70" />
      </g>
      <path d="M 138 120 A 42 42 0 0 1 222 120" fill={color} />
    </svg>
  );
}

// Patio Cream — organic stem-and-leaves botanical mark.
function LeafOrnament({ color, size = 200 }) {
  return (
    <svg width={size} height={size * 0.5} viewBox="0 0 360 180" style={{ display: "block" }}>
      <g fill={color}>
        <rect x="178" y="40" width="4" height="120" rx="2" />
        <ellipse cx="148" cy="62" rx="34" ry="14" transform="rotate(-28 148 62)" />
        <ellipse cx="212" cy="62" rx="34" ry="14" transform="rotate(28 212 62)" />
        <ellipse cx="142" cy="100" rx="40" ry="16" transform="rotate(-22 142 100)" />
        <ellipse cx="218" cy="100" rx="40" ry="16" transform="rotate(22 218 100)" />
        <ellipse cx="180" cy="36" rx="14" ry="22" />
      </g>
    </svg>
  );
}

// After-Five Black — single oversized 4-point starburst.
// After-Five Black — minimal art-deco mark. Two thin parallel rules with
// a small bracket motif in the center. Evening / supper-club feel without
// borrowing any star or sparkle shape.
function DecoMarkOrnament({ color, size = 200 }) {
  return (
    <svg width={size} height={size * 0.3} viewBox="0 0 360 108" style={{ display: "block" }}>
      <g stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none">
        <line x1="30" y1="34" x2="155" y2="34" />
        <line x1="205" y1="34" x2="330" y2="34" />
        <line x1="30" y1="74" x2="155" y2="74" />
        <line x1="205" y1="74" x2="330" y2="74" />
      </g>
      <g fill={color}>
        <rect x="170" y="30" width="3" height="48" />
        <rect x="187" y="30" width="3" height="48" />
        <circle cx="178.5" cy="54" r="4" />
      </g>
    </svg>
  );
}

// === GOLDEN SERIES FLAVOR CONFIG ===
// Each flavor locks theme + photo filter + ornament + accent bar color.
const GOLDEN_FLAVORS = {
  sunset: {
    name: "Sunset Gold",
    theme: "gold",
    photoFilter: "saturate(1.05) sepia(0.18) hue-rotate(-8deg) brightness(0.95)",
    Ornament: HorizonOrnament,
    description: "Patio at golden hour",
  },
  cream: {
    name: "Patio Cream",
    theme: "cream",
    photoFilter: "saturate(0.85) brightness(1.05) contrast(0.95)",
    Ornament: LeafOrnament,
    description: "Sunday afternoon, no pressure",
  },
  afterfive: {
    name: "After-Five Black",
    theme: "black",
    photoFilter: "saturate(0.78) brightness(0.82) contrast(1.08)",
    Ornament: DecoMarkOrnament,
    description: "Dinner-and-drinks crowd",
  },
};

// ==================== FLYER SURFACE (1080x1350) ====================
// Title-size tiers. Each tier has a one-line size and a tighter two-line size
// so the layout stays balanced when title2 is present.
const TITLE_SIZES = {
  s:  { one: 90,  two: 75  },
  m:  { one: 120, two: 100 },
  l:  { one: 160, two: 135 },
  xl: { one: 200, two: 170 },
};

// ==================== TEMPLATE 1: NIGHTCLUB ====================
// The original Social Club / Afro-Caribbean Fridays family.
function NightclubLayout({ data, theme, photoMode, photoUrl, bgOpacity, titleFont, bodyFont, bgSize, titleSize, noPhotoStyle }) {
  const t = THEMES[theme];
  const W = 1080, H = 1350;

  const isFullBg = photoMode === "fullbg" && photoUrl;

  // Text color rule:
  //   • Photo BG → use theme accent (the "selected" color).
  //   • No photo + Yellow → black (white-on-yellow fails readability).
  //   • No photo + Black → gold accent (the original CGE look).
  //   • No photo + everything else → pure white.
  const isYellow = theme === "yellow";
  const isBlack = theme === "black";
  const textColor = isFullBg
    ? t.accent
    : isYellow
      ? "#000000"
      : isBlack
        ? t.accent
        : "#FFFFFF";

  const tFont = fontStack(titleFont);
  const tWeight = fontWeight(titleFont);
  const bFont = fontStack(bodyFont);
  const bWeight = fontWeight(bodyFont);

  // BG-pattern letter color/opacity — mirrors Calendar's COLORS texture rules:
  //   • Photo BG → white at low opacity (overlaid on photo).
  //   • Black theme → theme accent (gold) at moderate opacity.
  //   • Light themes (Gold, Yellow) → black letters.
  //   • Other dark themes (Purple, Wine, Emerald) → black letters.
  const letterColor = isFullBg ? "#FFFFFF" : isBlack ? t.accent : "#000000";
  const letterOpacity = isFullBg ? 0.06 : isBlack ? 0.14 : (t.light ? 0.16 : 0.18);

  return (
    <div style={{
      position: "relative",
      width: `${W}px`,
      height: `${H}px`,
      background: isFullBg ? "#000" : t.bg,
      overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
      color: t.title,
    }}>
      {/* PHOTO BACKGROUND (Full BG mode) */}
      {isFullBg && (
        <>
          <img src={photoUrl} alt="" style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            ...photoCropStyle(data.photoCrop),
          }} />
          <div style={{
            position: "absolute", inset: 0,
            background: `rgba(0,0,0,${bgOpacity})`,
          }} />
        </>
      )}

      {/* CGE LETTER PATTERN — Syne Black, the existing CGE motif */}
      <CgeLetterPattern color={letterColor} opacity={letterOpacity} size={bgSize} surfaceW={W} surfaceH={H} />

      {/* SPOTLIGHTS — three layers, theme-tinted */}
      <div style={{
        position: "absolute", inset: 0,
        background: `
          radial-gradient(circle 460px at 8% 0%,
            rgba(${t.spot},${t.spotA}) 0%,
            rgba(${t.spot},${t.spotA * 0.45}) 28%,
            rgba(${t.spot},${t.spotA * 0.12}) 55%,
            transparent 75%),
          radial-gradient(circle 480px at 92% 0%,
            rgba(${t.spot},${t.spotA * 0.85}) 0%,
            rgba(${t.spot},${t.spotA * 0.40}) 32%,
            rgba(${t.spot},${t.spotA * 0.10}) 60%,
            transparent 80%),
          linear-gradient(135deg,
            rgba(${t.spot},${t.spotA * 0.20}) 0%,
            transparent 35%,
            transparent 65%,
            rgba(${t.spot},${t.spotA * 0.18}) 100%)
        `,
        opacity: isFullBg ? 0.55 : 1,
        pointerEvents: "none",
      }} />

      {/* CONTENT LAYER */}
      <div style={{
        position: "relative", zIndex: 2,
        padding: "75px 70px 50px",
        height: "100%",
        display: "flex", flexDirection: "column",
      }}>
        {/* WORDMARK (editable) — top-left */}
        {data.wordmark && (
          <div style={{
            position: "absolute", top: "30px", left: "70px",
            fontSize: "18px", fontWeight: 700, letterSpacing: "3px",
            color: textColor, opacity: 0.85,
          }}>
            {data.wordmark}
          </div>
        )}

        {/* TITLE */}
        {(() => {
          const ts = TITLE_SIZES[titleSize] || TITLE_SIZES.m;
          const px = data.title2 ? ts.two : ts.one;
          return (
            <div style={{
              fontFamily: tFont,
              fontWeight: tWeight,
              fontSize: `${px}px`,
              lineHeight: 0.92,
              color: textColor,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              marginTop: "36px",
            }}>
              <div>{data.title1 || "EVENT TITLE"}</div>
              {data.title2 && <div>{data.title2}</div>}
            </div>
          );
        })()}

        {/* Hairline rule (replaces the previous twin-sparkle ornament) */}
        <div style={{
          display: "flex", justifyContent: "center",
          margin: "30px 0 26px",
        }}>
          <div style={{
            width: "120px", height: "2px",
            background: textColor, opacity: 0.45,
          }} />
        </div>

        {/* META ROW: DATE | VENUE | TIME */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr 1fr",
          alignItems: "center",
          fontFamily: bFont,
          fontWeight: bWeight,
          color: textColor,
          fontSize: "44px",
          letterSpacing: "2.5px",
          marginBottom: "30px",
        }}>
          <div style={{ textAlign: "left" }}>{data.date || ""}</div>
          <div style={{ textAlign: "center" }}>{data.venue || ""}</div>
          <div style={{ textAlign: "right" }}>{data.time || ""}</div>
        </div>

        {/* HERO SLOT */}
        <div style={{ flex: 1, position: "relative", marginBottom: "20px" }}>
          {photoMode === "card" && (
            photoUrl ? (
              <div style={{
                position: "absolute", inset: 0,
                borderRadius: "22px", overflow: "hidden",
                background: "#000",
                boxShadow: "0 14px 40px rgba(0,0,0,0.4)",
              }}>
                <img src={photoUrl} alt="" style={{
                  width: "100%", height: "100%", display: "block",
                  ...photoCropStyle(data.photoCrop),
                }} />
              </div>
            ) : (
              <div style={{
                position: "absolute", inset: 0,
                borderRadius: "22px",
                border: `2px dashed ${t.title}40`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: `${t.title}66`,
                fontSize: "22px", letterSpacing: "3px",
                textTransform: "uppercase",
              }}>
                Add a photo
              </div>
            )
          )}

          {photoMode === "block" && (() => {
            // Shared rounded-frame for every No-Photo variant.
            const frameBase = {
              position: "absolute", inset: 0,
              borderRadius: "22px", overflow: "hidden",
              border: `4px solid ${t.title}`,
              background: t.light
                ? `radial-gradient(circle at 50% 30%, rgba(255,255,255,0.55) 0%, transparent 55%), ${t.bg}`
                : `radial-gradient(circle at 50% 30%, rgba(${t.spot},${t.spotA * 1.3}) 0%, transparent 55%), ${t.bg}`,
              boxShadow: "0 14px 40px rgba(0,0,0,0.4)",
              display: "flex",
            };
            const innerPattern = (sizeOverride, opOverride) => (
              <CgeLetterPattern
                color={t.light ? "#000000" : isBlack ? t.accent : "#000000"}
                opacity={opOverride ?? (t.light ? 0.14 : isBlack ? 0.16 : 0.14)}
                size={sizeOverride || (bgSize === "xl" ? "large" : "regular")}
                surfaceW={940}
                surfaceH={620}
              />
            );

            // Editorial — gallery-poster vibe. Small ornament top-right,
            // breathing room, small-caps event type with rule + venue
            // anchored bottom-left. Negative space does the work.
            if (noPhotoStyle === "editorial") {
              return (
                <div style={{ ...frameBase, flexDirection: "column", justifyContent: "space-between", padding: "55px 60px" }}>
                  {innerPattern()}
                  <div style={{ position: "relative", zIndex: 2, display: "flex", justifyContent: "flex-end" }}>
                    <div style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: "14px", letterSpacing: "4px",
                      color: textColor, opacity: 0.5,
                      textTransform: "uppercase",
                    }}>
                      № {(data.eventType || "EVT").slice(0,3)}
                    </div>
                  </div>
                  <div style={{ position: "relative", zIndex: 2 }}>
                    <div style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: "20px", letterSpacing: "5px",
                      color: textColor, opacity: 0.6,
                      textTransform: "uppercase", marginBottom: "16px",
                    }}>
                      {data.eventType || "EVENT"} <span style={{ opacity: 0.5 }}>· IN PRINT</span>
                    </div>
                    <div style={{ width: "70px", height: "2px", background: textColor, opacity: 0.55, marginBottom: "20px" }} />
                    <div style={{
                      fontFamily: bFont, fontWeight: bWeight,
                      fontSize: "88px", color: textColor,
                      letterSpacing: "1px", textTransform: "uppercase",
                      lineHeight: 0.95,
                    }}>
                      {data.venue || data.title1 || "EVENT"}
                    </div>
                  </div>
                </div>
              );
            }

            // Statement — type-as-image. One word fills the block. No ornament.
            // Inner pattern bumps to Large for texture without dominating.
            if (noPhotoStyle === "statement") {
              return (
                <div style={{ ...frameBase, alignItems: "center", justifyContent: "center" }}>
                  {innerPattern("large")}
                  <div style={{
                    position: "relative", zIndex: 2,
                    fontFamily: tFont, fontWeight: tWeight,
                    fontSize: "240px", color: textColor,
                    letterSpacing: "1px", textTransform: "uppercase",
                    lineHeight: 0.9, textAlign: "center", padding: "0 30px",
                  }}>
                    {data.eventType || "EVENT"}
                  </div>
                </div>
              );
            }

            // Frame — intentional empty. Just texture + a tiny corner mark.
            // Reads as a confident card.
            if (noPhotoStyle === "frame") {
              return (
                <div style={{ ...frameBase, alignItems: "flex-end", justifyContent: "flex-end", padding: "32px" }}>
                  {innerPattern(undefined, t.light ? 0.22 : isBlack ? 0.24 : 0.22)}
                  <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                    {/* Minimal corner mark — two stacked rules, no star/sparkle */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "5px", alignItems: "flex-end" }}>
                      <div style={{ width: "44px", height: "2px", background: textColor, opacity: 0.6 }} />
                      <div style={{ width: "28px", height: "2px", background: textColor, opacity: 0.6 }} />
                    </div>
                    <div style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: "12px", letterSpacing: "4px",
                      color: textColor, opacity: 0.55,
                      textTransform: "uppercase",
                    }}>{data.eventType || "EVENT"}</div>
                  </div>
                </div>
              );
            }

            // Fallback (legacy "ornament" state value) — single big event-type
            // word, no ornament. Effectively the same as Statement but kept
            // here so old state values still render something sensible.
            return (
              <div style={{ ...frameBase, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "20px" }}>
                {innerPattern()}
                <div style={{
                  position: "relative", zIndex: 2,
                  fontFamily: bFont, fontWeight: bWeight,
                  fontSize: "150px", color: textColor,
                  letterSpacing: "4px", textTransform: "uppercase",
                  lineHeight: 1, textAlign: "center", padding: "0 30px",
                }}>
                  {data.eventType || "EVENT"}
                </div>
              </div>
            );
          })()}

          {/* Full BG mode → hero is the whole flyer; this slot stays empty as breathing room */}
        </div>

        {/* FOOTER */}
        {(data.footerLabel || data.footerItems.length > 0) && (
          <div>
            {data.footerLabel && (
              <div style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: "16px",
                letterSpacing: "4px",
                opacity: 0.55,
                textTransform: "uppercase",
                marginBottom: "12px",
                textAlign: "center",
              }}>{data.footerLabel}</div>
            )}
            {data.footerItems.length > 0 && (
              <div style={{
                display: "grid",
                gridTemplateColumns: `repeat(${Math.min(data.footerItems.length, 4)}, 1fr)`,
                fontFamily: bFont,
                fontWeight: bWeight,
                fontSize: "32px",
                letterSpacing: "2.5px",
                color: textColor,
                textTransform: "uppercase",
                gap: "12px",
              }}>
                {data.footerItems.map((it, i) => {
                  const last = i === data.footerItems.length - 1;
                  return (
                    <div key={i} style={{
                      textAlign: i === 0 ? "left" : last ? "right" : "center",
                    }}>{it}</div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM ACCENT BAR */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        height: "14px",
        background: t.accent,
      }} />
    </div>
  );
}

// ==================== TEMPLATE 2: PHOTO-HERO PRO ====================
// STEM Mixer family. Always full-bg photo with dark overlay. Top stack:
// sponsor row + tagline + city/topTitle. Date stack mid-left. Big bottom
// title + URL footer. Professional / networking energy.
function PhotoHeroLayout({ data, theme, photoUrl, bgOpacity, titleFont, bodyFont, bgSize, titleSize }) {
  const t = THEMES[theme];
  const W = 1080, H = 1350;

  const isYellow = theme === "yellow";
  const isBlack = theme === "black";
  const isFullBg = !!photoUrl;
  const textColor = isFullBg
    ? (isBlack ? t.accent : "#FFFFFF")
    : isYellow ? "#000000"
      : isBlack ? t.accent
        : t.light ? "#1A1A1A" : "#FFFFFF";

  const tFont = fontStack(titleFont);
  const tWeight = fontWeight(titleFont);
  const bFont = fontStack(bodyFont);
  const bWeight = fontWeight(bodyFont);

  const ts = TITLE_SIZES[titleSize] || TITLE_SIZES.m;
  const topTitlePx = Math.round(ts.one * 0.75);
  const mainTitlePx = data.title2 ? Math.round(ts.two * 0.85) : Math.round(ts.one * 0.85);

  return (
    <div style={{
      position: "relative", width: `${W}px`, height: `${H}px`,
      background: isFullBg ? "#000" : t.bg,
      overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
      color: textColor,
    }}>
      {/* PHOTO BACKGROUND */}
      {isFullBg && (
        <>
          <img src={photoUrl} alt="" style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            ...photoCropStyle(data.photoCrop),
          }} />
          <div style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(180deg, rgba(0,0,0,${bgOpacity * 0.95}) 0%, rgba(0,0,0,${bgOpacity * 0.55}) 35%, rgba(0,0,0,${bgOpacity * 0.55}) 65%, rgba(0,0,0,${bgOpacity * 0.95}) 100%)`,
          }} />
        </>
      )}

      {/* CGE letter pattern — subtle, since photo is the hero */}
      <CgeLetterPattern
        color={isFullBg ? "#FFFFFF" : isBlack ? t.accent : (t.light ? "#000000" : "#FFFFFF")}
        opacity={isFullBg ? 0.05 : 0.08}
        size={bgSize}
        surfaceW={W} surfaceH={H}
      />

      {/* CONTENT */}
      <div style={{
        position: "relative", zIndex: 2,
        padding: "70px 60px 50px",
        height: "100%",
        display: "flex", flexDirection: "column",
      }}>
        {/* TOP STACK */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
          {/* Sponsor row — real logo images when uploaded, text stand-ins otherwise */}
          {data.sponsorLogos && data.sponsorLogos.length > 0 ? (
            <div style={{
              display: "flex", gap: "44px", alignItems: "center", justifyContent: "center",
              minHeight: "80px",
            }}>
              {data.sponsorLogos.slice(0, 3).map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt=""
                  style={{
                    maxHeight: "80px",
                    maxWidth: "200px",
                    objectFit: "contain",
                    filter: isFullBg ? "drop-shadow(0 4px 12px rgba(0,0,0,0.5))" : "none",
                  }}
                />
              ))}
            </div>
          ) : (data.footerItems && data.footerItems.length > 0 && (
            <div style={{
              display: "flex", gap: "40px", alignItems: "center", justifyContent: "center",
              fontFamily: bFont, fontWeight: bWeight,
              fontSize: "26px", letterSpacing: "2px",
              color: textColor, opacity: 0.95, textTransform: "uppercase",
            }}>
              {data.footerItems.slice(0, 3).map((it, i) => (
                <span key={i}>{it}</span>
              ))}
            </div>
          ))}

          {/* Tagline (uses wordmark slot) */}
          {data.wordmark && (
            <div style={{
              fontFamily: bFont, fontWeight: bWeight,
              fontSize: "26px", letterSpacing: "5px",
              textTransform: "uppercase", textAlign: "center",
              color: textColor,
            }}>
              {data.wordmark}
            </div>
          )}

          {/* TopTitle (e.g. NEW YORK) */}
          {data.topTitle && (
            <div style={{
              fontFamily: tFont, fontWeight: tWeight,
              fontSize: `${topTitlePx}px`, lineHeight: 1,
              color: textColor, textTransform: "uppercase",
              letterSpacing: "2px", textAlign: "center",
              marginTop: "8px",
              textShadow: isFullBg ? "0 4px 16px rgba(0,0,0,0.6)" : "none",
            }}>
              {data.topTitle}
            </div>
          )}
        </div>

        {/* Date stack — absolute positioned mid-left */}
        <div style={{
          position: "absolute", left: "60px", top: "52%",
          transform: "translateY(-30%)",
          fontFamily: tFont, fontWeight: tWeight,
          color: textColor, textTransform: "uppercase",
          textShadow: isFullBg ? "0 4px 16px rgba(0,0,0,0.6)" : "none",
          zIndex: 3,
        }}>
          <div style={{ fontSize: "92px", lineHeight: 1, letterSpacing: "1px" }}>{data.date}</div>
          <div style={{
            fontFamily: bFont, fontWeight: bWeight,
            fontSize: "28px", letterSpacing: "3px", marginTop: "12px",
          }}>{data.time}</div>
        </div>

        {/* spacer */}
        <div style={{ flex: 1 }} />

        {/* Bottom: main title + URL */}
        <div>
          <div style={{
            fontFamily: tFont, fontWeight: tWeight,
            fontSize: `${mainTitlePx}px`,
            lineHeight: 0.95,
            color: textColor, textTransform: "uppercase",
            letterSpacing: "1px",
            marginBottom: "22px",
            textShadow: isFullBg ? "0 4px 16px rgba(0,0,0,0.6)" : "none",
          }}>
            <div>{data.title1 || "EVENT TITLE"}</div>
            {data.title2 && <div>{data.title2}</div>}
          </div>

          {data.ticketUrl && (
            <div style={{
              fontFamily: bFont, fontWeight: bWeight,
              fontSize: "26px", letterSpacing: "4px",
              color: textColor, textTransform: "uppercase",
              opacity: 0.9, textAlign: "center",
            }}>
              {data.ticketUrl}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== TEMPLATE 3: BOUTIQUE MINIMAL ====================
// IN TODO family. Cream/light bg, tri-column meta at top, centered photo
// card, serif title overlapping bottom of photo, venue + multi-line address
// below. Wellness / lifestyle / Sunday-market energy.
function BoutiqueLayout({ data, theme, photoUrl, titleFont, bodyFont, bgSize, titleSize }) {
  const t = THEMES[theme];
  const W = 1080, H = 1350;

  const isYellow = theme === "yellow";
  const isBlack = theme === "black";
  // Boutique: dark text on light bgs, light text on dark bgs.
  const textColor = isYellow ? "#000000"
    : isBlack ? t.accent
      : t.light ? "#1A1A1A"
        : "#FFFFFF";

  const tFont = fontStack(titleFont);
  const tWeight = fontWeight(titleFont);
  const bFont = fontStack(bodyFont);
  const bWeight = fontWeight(bodyFont);

  const ts = TITLE_SIZES[titleSize] || TITLE_SIZES.m;
  const titlePx = Math.round(ts.one * 0.85);

  const photoW = 880;
  const photoH = 720;

  return (
    <div style={{
      position: "relative", width: `${W}px`, height: `${H}px`,
      background: t.bg, overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
      color: textColor,
    }}>
      {/* Whisper-quiet CGE pattern */}
      <CgeLetterPattern
        color={t.light ? "#000000" : "#FFFFFF"}
        opacity={0.05}
        size={bgSize}
        surfaceW={W} surfaceH={H}
      />

      {/* CONTENT */}
      <div style={{
        position: "relative", zIndex: 2,
        padding: "55px 60px 60px",
        height: "100%",
        display: "flex", flexDirection: "column",
      }}>
        {/* Top tri-column meta */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          fontFamily: bFont, fontWeight: bWeight,
          fontSize: "28px", letterSpacing: "5px",
          color: textColor, textTransform: "uppercase",
        }}>
          <div style={{ textAlign: "left" }}>{data.dayName || ""}</div>
          <div style={{ textAlign: "center" }}>{data.date || ""}</div>
          <div style={{ textAlign: "right" }}>{data.time || ""}</div>
        </div>

        {/* Photo + overlapping title */}
        <div style={{
          flex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "flex-start",
          paddingTop: "50px",
        }}>
          {photoUrl ? (
            <img src={photoUrl} alt="" style={{
              width: `${photoW}px`, height: `${photoH}px`,
              display: "block",
              ...photoCropStyle(data.photoCrop),
            }} />
          ) : (
            <div style={{
              width: `${photoW}px`, height: `${photoH}px`,
              border: `2px dashed ${textColor}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: `${textColor}66`,
              fontSize: "20px", letterSpacing: "3px", textTransform: "uppercase",
            }}>
              add a photo
            </div>
          )}

          {/* Title overlapping the bottom of the photo */}
          <div style={{
            fontFamily: tFont, fontWeight: tWeight,
            fontSize: `${titlePx}px`, color: textColor,
            textTransform: "uppercase",
            letterSpacing: "4px",
            marginTop: `-${Math.round(titlePx * 0.42)}px`,
            position: "relative", zIndex: 5,
            textAlign: "center",
            lineHeight: 1,
            padding: "0 30px",
          }}>
            {data.title1 || "TITLE"}
          </div>
        </div>

        {/* Bottom: @ venue + address */}
        <div style={{
          display: "flex", flexDirection: "column",
          alignItems: "center", gap: "8px",
          marginTop: "30px",
        }}>
          <div style={{
            fontSize: "32px", color: textColor, opacity: 0.65,
            marginBottom: "2px", fontFamily: bFont, fontWeight: bWeight,
          }}>@</div>
          <div style={{
            fontFamily: tFont, fontWeight: tWeight,
            fontSize: "52px", color: textColor,
            textTransform: "uppercase", letterSpacing: "3px",
            lineHeight: 1,
          }}>
            {data.venue || ""}
          </div>
          {data.address && (
            <div style={{
              fontFamily: bFont, fontWeight: bWeight,
              fontSize: "16px", letterSpacing: "3px",
              color: textColor, textTransform: "uppercase",
              textAlign: "center", opacity: 0.7, lineHeight: 1.5,
              whiteSpace: "pre-line", marginTop: "10px",
            }}>
              {data.address}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== TEMPLATE 4: TORN-PAPER UNDERGROUND ====================
// Elevate Social NYC family. Stencil/grunge title, ripped-paper sticker
// subtitle, photo with torn yellow border, "HOSTED BY" sticker, dotted-line
// headliner row, DJ row, blue date pill at bottom. Hip-hop tour energy.
function TornPaperLayout({ data, theme, photoUrl, bgOpacity, titleFont, bodyFont, bgSize, titleSize }) {
  const t = THEMES[theme];
  const W = 1080, H = 1350;

  const isYellow = theme === "yellow";
  const isBlack = theme === "black";
  const isFullBg = !!photoUrl;

  // Title in theme accent (yellow on dark, etc).
  const titleColor = isYellow ? "#000000" : isBlack ? t.accent : isFullBg ? t.accent : t.light ? "#1A1A1A" : t.accent;
  // Stickers always blue for that "ripped magazine" contrast moment.
  const stickerBg = "#2563EB";
  const stickerText = "#FFFFFF";

  const tFont = fontStack(titleFont);
  const tWeight = fontWeight(titleFont);
  const bFont = fontStack(bodyFont);
  const bWeight = fontWeight(bodyFont);

  const ts = TITLE_SIZES[titleSize] || TITLE_SIZES.m;
  const titlePx = data.title2 ? Math.round(ts.two * 1.0) : Math.round(ts.one * 1.05);

  // Irregular polygon for torn-paper edges.
  const tornPoly = "polygon(3% 12%, 18% 0%, 35% 8%, 52% 0%, 68% 6%, 85% 0%, 97% 8%, 100% 28%, 96% 50%, 100% 72%, 94% 92%, 78% 100%, 60% 92%, 42% 100%, 25% 94%, 8% 100%, 0% 80%, 3% 60%, 0% 38%, 4% 22%)";
  const photoTornPoly = "polygon(2% 5%, 15% 0%, 30% 3%, 50% 0%, 70% 4%, 88% 0%, 98% 5%, 100% 22%, 98% 50%, 100% 78%, 96% 96%, 80% 100%, 60% 96%, 40% 100%, 20% 95%, 4% 100%, 0% 78%, 3% 50%, 0% 28%, 4% 12%)";

  return (
    <div style={{
      position: "relative", width: `${W}px`, height: `${H}px`,
      background: isFullBg ? "#1A1A1A" : t.bg,
      overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
      color: titleColor,
    }}>
      {isFullBg && (
        <>
          <img src={photoUrl} alt="" style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            filter: "saturate(0.8) brightness(0.55)",
            ...photoCropStyle(data.photoCrop),
          }} />
          <div style={{
            position: "absolute", inset: 0,
            background: `rgba(0,0,0,${bgOpacity * 0.7})`,
          }} />
        </>
      )}

      <CgeLetterPattern
        color={isFullBg ? "#FFFFFF" : (t.light ? "#000000" : "#FFFFFF")}
        opacity={isFullBg ? 0.04 : 0.06}
        size={bgSize}
        surfaceW={W} surfaceH={H}
      />

      <div style={{
        position: "relative", zIndex: 2,
        padding: "55px 60px 50px",
        height: "100%",
        display: "flex", flexDirection: "column",
      }}>
        {/* Wordmark top center */}
        {data.wordmark && (
          <div style={{
            textAlign: "center",
            fontFamily: bFont, fontWeight: bWeight,
            fontSize: "20px", letterSpacing: "4px",
            color: titleColor, opacity: 0.7,
            textTransform: "uppercase",
            marginBottom: "18px",
          }}>
            {data.wordmark}
          </div>
        )}

        {/* Big title */}
        <div style={{
          fontFamily: tFont, fontWeight: tWeight,
          fontSize: `${titlePx}px`, lineHeight: 0.92,
          color: titleColor, textTransform: "uppercase",
          textAlign: "center",
          letterSpacing: "1px",
          textShadow: "4px 4px 0 rgba(0,0,0,0.3), 8px 8px 24px rgba(0,0,0,0.25)",
        }}>
          {data.title1 || "TITLE"}
        </div>

        {/* Torn-paper subtitle sticker */}
        {data.title2 && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: "-12px", marginBottom: "22px" }}>
            <div style={{
              background: stickerBg,
              color: stickerText,
              padding: "18px 40px",
              fontFamily: tFont, fontWeight: tWeight,
              fontSize: "62px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              transform: "rotate(-2deg)",
              clipPath: tornPoly,
              boxShadow: "0 10px 22px rgba(0,0,0,0.45)",
              lineHeight: 1,
            }}>
              {data.title2}
            </div>
          </div>
        )}

        {/* Photo with torn yellow border + HOSTED BY sticker */}
        <div style={{ flex: 1, position: "relative", marginBottom: "26px", minHeight: "320px" }}>
          {photoUrl ? (
            <>
              <div style={{
                position: "absolute", inset: 0,
                padding: "10px",
                background: titleColor,
                clipPath: photoTornPoly,
              }}>
                <div style={{
                  width: "100%", height: "100%",
                  clipPath: photoTornPoly,
                  overflow: "hidden",
                }}>
                  <img src={photoUrl} alt="" style={{
                    width: "100%", height: "100%", display: "block",
                    ...photoCropStyle(data.photoCrop),
                  }} />
                </div>
              </div>
              {data.hostedBy && (
                <div style={{
                  position: "absolute", bottom: "26px", right: "26px",
                  background: "#FFFFFF",
                  color: "#000000",
                  padding: "10px 22px",
                  fontFamily: bFont, fontWeight: bWeight,
                  fontSize: "16px", letterSpacing: "2px",
                  textTransform: "uppercase",
                  transform: "rotate(2deg)",
                  clipPath: tornPoly,
                  boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
                  zIndex: 3,
                }}>
                  {data.hostedBy}
                </div>
              )}
            </>
          ) : (
            <div style={{
              position: "absolute", inset: 0,
              border: `3px dashed ${titleColor}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: `${titleColor}66`,
              fontSize: "20px", letterSpacing: "3px", textTransform: "uppercase",
              clipPath: photoTornPoly,
            }}>
              add a photo
            </div>
          )}
        </div>

        {/* Headliner with dotted lines */}
        {data.headliner && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "18px",
            marginBottom: "20px",
          }}>
            <div style={{ flex: 1, borderTop: `3px dotted ${titleColor}`, opacity: 0.7 }} />
            <div style={{
              fontFamily: tFont, fontWeight: tWeight,
              fontSize: "58px", color: titleColor,
              textTransform: "uppercase", letterSpacing: "3px",
              padding: "0 8px", lineHeight: 1,
            }}>
              {data.headliner}
            </div>
            <div style={{ flex: 1, borderTop: `3px dotted ${titleColor}`, opacity: 0.7 }} />
          </div>
        )}

        {/* DJ row */}
        {data.footerItems && data.footerItems.length > 0 && (
          <div style={{
            display: "flex", justifyContent: "space-around", alignItems: "center",
            fontFamily: tFont, fontWeight: tWeight,
            fontSize: "30px", color: titleColor,
            textTransform: "uppercase", letterSpacing: "2px",
            marginBottom: "26px",
            gap: "10px",
            flexWrap: "wrap",
          }}>
            {data.footerItems.map((dj, i) => (
              <span key={i}>{dj}</span>
            ))}
          </div>
        )}

        {/* Date pill */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div style={{
            background: stickerBg,
            color: stickerText,
            padding: "14px 38px",
            borderRadius: "30px",
            fontFamily: bFont, fontWeight: bWeight,
            fontSize: "22px", letterSpacing: "3px",
            textTransform: "uppercase",
            boxShadow: "0 6px 14px rgba(0,0,0,0.4)",
          }}>
            {data.date}{data.time ? ` · ${data.time}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== TEMPLATE 5: HOLIDAY PROMO ====================
// Cinco de Mayo family. Two-tone (theme bg + promoAccent panel), distressed
// stencil title, sponsor logo row top, deal-list panel, venue + free-entry
// footer. Theme-night / holiday / college-bar promo energy.
function HolidayPromoLayout({ data, theme, titleFont, bodyFont, bgSize, titleSize }) {
  const t = THEMES[theme];
  const W = 1080, H = 1350;

  const isYellow = theme === "yellow";
  const isBlack = theme === "black";
  // Primary text uses promoAccent (the bold contrast color of each theme).
  const primaryColor = t.promoAccent;
  // Panel uses promoAccent as bg, theme bg as text.
  const panelBg = t.promoAccent;
  const panelText = t.bg;

  const tFont = fontStack(titleFont);
  const tWeight = fontWeight(titleFont);
  const bFont = fontStack(bodyFont);
  const bWeight = fontWeight(bodyFont);

  const ts = TITLE_SIZES[titleSize] || TITLE_SIZES.m;
  const mainPx = data.title2 ? Math.round(ts.two * 1.15) : Math.round(ts.one * 1.15);

  const deals = (data.deals || "").split("\n").map(s => s.trim()).filter(Boolean);

  return (
    <div style={{
      position: "relative", width: `${W}px`, height: `${H}px`,
      background: t.bg, overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
      color: primaryColor,
    }}>
      {/* Subtle grain pattern */}
      <CgeLetterPattern
        color={t.light ? "#000000" : "#FFFFFF"}
        opacity={0.04}
        size={bgSize}
        surfaceW={W} surfaceH={H}
      />

      <div style={{
        position: "relative", zIndex: 2,
        padding: "50px 60px 40px",
        height: "100%",
        display: "flex", flexDirection: "column",
      }}>
        {/* Sponsor row */}
        {data.footerItems && data.footerItems.length > 0 && (
          <div style={{
            display: "flex", justifyContent: "center", gap: "44px", alignItems: "center",
            fontFamily: bFont, fontWeight: bWeight,
            fontSize: "22px", letterSpacing: "2px",
            color: primaryColor, textTransform: "uppercase",
            marginBottom: "30px", opacity: 0.85,
          }}>
            {data.footerItems.slice(0, 4).map((it, i) => <span key={i}>{it}</span>)}
          </div>
        )}

        {/* Top date */}
        {data.topTitle && (
          <div style={{
            fontFamily: tFont, fontWeight: tWeight,
            fontSize: "92px", lineHeight: 0.95,
            color: primaryColor, textAlign: "center",
            textTransform: "uppercase", letterSpacing: "1px",
            marginBottom: "8px",
            textShadow: "3px 3px 0 rgba(0,0,0,0.18)",
          }}>
            {data.topTitle}
          </div>
        )}

        {/* Big title */}
        <div style={{
          fontFamily: tFont, fontWeight: tWeight,
          fontSize: `${mainPx}px`, lineHeight: 0.95,
          color: primaryColor, textAlign: "center",
          textTransform: "uppercase", letterSpacing: "1px",
          textShadow: "5px 5px 0 rgba(0,0,0,0.18)",
          marginBottom: "26px",
        }}>
          <div>{data.title1 || "TITLE"}</div>
          {data.title2 && <div>{data.title2}</div>}
        </div>

        {/* Deal panel */}
        {deals.length > 0 && (
          <div style={{
            background: panelBg,
            color: panelText,
            padding: "32px 40px",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: "10px",
            marginBottom: "22px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
          }}>
            {deals.map((d, i) => (
              <div key={i} style={{
                fontFamily: tFont, fontWeight: tWeight,
                fontSize: deals.length > 4 ? "34px" : "44px",
                textTransform: "uppercase",
                letterSpacing: "1px",
                color: panelText,
                lineHeight: 1.05,
              }}>
                {d}
              </div>
            ))}
          </div>
        )}

        {/* Venue */}
        {data.venue && (
          <div style={{
            fontFamily: tFont, fontWeight: tWeight,
            fontSize: "62px", color: primaryColor,
            textAlign: "center",
            textTransform: "uppercase", letterSpacing: "3px",
            marginBottom: "10px",
            lineHeight: 1,
          }}>
            {data.venue}
          </div>
        )}

        {/* Footer ticket/url */}
        {data.ticketUrl && (
          <div style={{
            fontFamily: bFont, fontWeight: bWeight,
            fontSize: "22px", letterSpacing: "4px",
            color: primaryColor, textAlign: "center",
            textTransform: "uppercase",
          }}>
            {data.ticketUrl}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== TEMPLATE 6: GOLDEN SERIES ====================
// CGE flagship recurring series. Series name is the visual hero (big);
// each event is a variant with its own edition title + photo. Three
// "flavor" sub-modes lock theme + photo filter + ornament for the
// occasion: Sunset Gold (patio at golden hour), Patio Cream (Sunday
// daytime, no pressure), After-Five Black (dinner-and-drinks evening).
function GoldenSeriesLayout({ data, goldenFlavor = "sunset", photoUrl, bgOpacity, titleFont, bodyFont, bgSize, titleSize }) {
  const flavor = GOLDEN_FLAVORS[goldenFlavor] || GOLDEN_FLAVORS.sunset;
  const t = THEMES[flavor.theme];
  const W = 1080, H = 1350;
  const Ornament = flavor.Ornament;

  const isYellow = flavor.theme === "yellow";
  const isBlack = flavor.theme === "black";
  // Text color: same rule as the other templates. Cream gets dark text;
  // Black gets gold accent; others get white.
  const textColor = isYellow ? "#000000"
    : isBlack ? t.accent
      : t.light ? "#1A1A1A"
        : "#FFFFFF";
  const accentBar = t.accent;

  const tFont = fontStack(titleFont);
  const tWeight = fontWeight(titleFont);
  const bFont = fontStack(bodyFont);
  const bWeight = fontWeight(bodyFont);

  // Series name (wordmark slot) is the hero, much bigger than other templates.
  const ts = TITLE_SIZES[titleSize] || TITLE_SIZES.m;
  const seriesPx = Math.round(ts.one * 1.05);   // big — the series IS the brand
  const editionPx = 32;                          // small caps subtitle below

  return (
    <div style={{
      position: "relative", width: `${W}px`, height: `${H}px`,
      background: t.bg, overflow: "hidden",
      fontFamily: "'DM Sans', sans-serif",
      color: textColor,
    }}>
      {/* CGE letter pattern — same brand DNA as every template */}
      <CgeLetterPattern
        color={isBlack ? t.accent : (t.light ? "#000000" : "#FFFFFF")}
        opacity={isBlack ? 0.12 : (t.light ? 0.10 : 0.08)}
        size={bgSize}
        surfaceW={W} surfaceH={H}
      />

      {/* Soft single-direction spotlight (gentler than Nightclub's 3-layer) */}
      <div style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(circle 520px at 50% -10%,
          rgba(${t.spot},${t.spotA * 0.85}) 0%,
          rgba(${t.spot},${t.spotA * 0.35}) 35%,
          transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div style={{
        position: "relative", zIndex: 2,
        padding: "80px 70px 60px",
        height: "100%",
        display: "flex", flexDirection: "column",
      }}>
        {/* Small CGE wordmark anchor top-left (locked, branded) */}
        <div style={{
          fontSize: "14px", fontWeight: 700, letterSpacing: "3.5px",
          color: textColor, opacity: 0.55,
          textTransform: "uppercase",
        }}>
          CGE · NJ WEEKEND EVENTS
        </div>

        {/* SERIES NAME — the hero. Uses the wordmark data field so user
            can name their series ("THE GOLDEN SERIES", "GOLDEN HOUR", etc). */}
        <div style={{
          fontFamily: tFont, fontWeight: tWeight,
          fontSize: `${seriesPx}px`, lineHeight: 0.92,
          color: textColor, textTransform: "uppercase",
          letterSpacing: "1px",
          textAlign: "center",
          marginTop: "44px",
        }}>
          {data.wordmark || "THE GOLDEN SERIES"}
        </div>

        {/* Hairline rule + edition subtitle */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
          <div style={{ width: "80px", height: "2px", background: textColor, opacity: 0.45 }} />
        </div>
        <div style={{
          fontFamily: bFont, fontWeight: bWeight,
          fontSize: `${editionPx}px`,
          letterSpacing: "5px", textTransform: "uppercase",
          color: textColor, opacity: 0.85,
          textAlign: "center",
          marginTop: "16px",
        }}>
          {data.title1 || "EDITION ONE"}
          {data.title2 && <span style={{ opacity: 0.6 }}> · {data.title2}</span>}
        </div>

        {/* Hero photo (flavor-filtered) */}
        <div style={{ flex: 1, position: "relative", marginTop: "28px", marginBottom: "24px" }}>
          {photoUrl ? (
            <div style={{
              position: "absolute", inset: 0,
              borderRadius: "16px", overflow: "hidden",
              border: `3px solid ${textColor}`,
              background: "#000",
              boxShadow: "0 14px 40px rgba(0,0,0,0.35)",
            }}>
              <img src={photoUrl} alt="" style={{
                width: "100%", height: "100%", display: "block",
                filter: flavor.photoFilter,
                ...photoCropStyle(data.photoCrop),
              }} />
              {/* Subtle gradient at bottom for any future overlay text */}
              <div style={{
                position: "absolute", inset: 0,
                background: `linear-gradient(180deg, transparent 60%, rgba(0,0,0,${bgOpacity * 0.25}) 100%)`,
                pointerEvents: "none",
              }} />
            </div>
          ) : (
            <div style={{
              position: "absolute", inset: 0,
              borderRadius: "16px",
              border: `3px dashed ${textColor}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: `${textColor}66`,
              fontSize: "20px", letterSpacing: "3px", textTransform: "uppercase",
            }}>
              add a photo
            </div>
          )}
        </div>

        {/* Flavor ornament */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
          <Ornament color={textColor} size={200} />
        </div>

        {/* Bottom meta: venue / date · time */}
        <div style={{ textAlign: "center" }}>
          {data.venue && (
            <div style={{
              fontFamily: tFont, fontWeight: tWeight,
              fontSize: "44px", color: textColor,
              textTransform: "uppercase", letterSpacing: "2.5px",
              lineHeight: 1.05,
              marginBottom: "8px",
            }}>
              {data.venue}
            </div>
          )}
          <div style={{
            fontFamily: bFont, fontWeight: bWeight,
            fontSize: "22px", letterSpacing: "4px",
            color: textColor, opacity: 0.85,
            textTransform: "uppercase",
          }}>
            {[data.date, data.time].filter(Boolean).join(" · ")}
          </div>
          {data.footerItems && data.footerItems.length > 0 && (
            <div style={{
              fontFamily: bFont, fontWeight: bWeight,
              fontSize: "14px", letterSpacing: "3px",
              color: textColor, opacity: 0.5,
              textTransform: "uppercase",
              marginTop: "14px",
            }}>
              {data.footerLabel ? `${data.footerLabel} ` : ""}{data.footerItems.join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* Bottom accent bar */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        height: "10px",
        background: accentBar,
      }} />
    </div>
  );
}

// ==================== TEMPLATE DISPATCHER ====================
function FlyerSurface({ template, ...rest }) {
  if (template === "photohero")    return <PhotoHeroLayout {...rest} />;
  if (template === "boutique")     return <BoutiqueLayout {...rest} />;
  if (template === "tornpaper")    return <TornPaperLayout {...rest} />;
  if (template === "holiday")      return <HolidayPromoLayout {...rest} />;
  if (template === "goldenseries") return <GoldenSeriesLayout {...rest} />;
  return <NightclubLayout {...rest} />;
}

// ==================== PAGE ====================
export default function FlyerBuilder() {
  const events = useEventsStore(s => s.events);

  // Default sample (Social Club homage so we have something to look at on first load)
  const [data, setData] = useState({
    // Universal fields (used across templates)
    wordmark: "CGE · NJ WEEKEND EVENTS",
    title1: "THE SOCIAL CLUB",
    title2: "NEW YORK CITY",
    date: "MAY 17",
    venue: "HOTEL CHANTELLE",
    time: "5PM",
    eventType: "PARTY",
    footerLabel: "PRESENTED BY",
    footerItems: ["FREE OHSO", "ROSEGOLD", "FLYGERIAN"],
    // PhotoHero-specific
    topTitle: "NEW YORK",
    ticketUrl: "TICKETS ON SALE AT CGE.COM",
    // Boutique-specific
    dayName: "SATURDAY",
    address: "905 MATEO ST.\nLOS ANGELES, CA\n90021",
    // TornPaper-specific
    hostedBy: "HOSTED BY GGC",
    headliner: "CAFE ERZULIE",
    // HolidayPromo-specific (newline-separated deal list)
    deals: "1 HOUR OPEN BAR\n$5 SURFSIDES\n$7 TEQUILA SHOTS\n$8 MARGARITAS",
    // PhotoHero/Mixer-specific: up to 3 sponsor logos as data URLs.
    // When empty, the template falls back to footerItems text stand-ins.
    sponsorLogos: [],
    // Photo crop/reposition — applied to every photo-using template.
    // x/y are 0-100 (objectPosition %), zoom is 1.0-2.5 (scale around the
    // x/y point). Reset to 50/50/1 whenever a new photo is uploaded.
    photoCrop: { x: 50, y: 50, zoom: 1 },
  });

  const [template, setTemplate] = useState("nightclub");

  const [theme, setTheme] = useState("black");
  const [photoMode, setPhotoMode] = useState("card");
  const [photoUrl, setPhotoUrl] = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.65);
  const [scale, setScale] = useState(0.55);
  const [titleFont, setTitleFont] = useState("Syne Black");
  const [bodyFont, setBodyFont] = useState("Syne Black");
  const [bgSize, setBgSize] = useState("regular");
  const [titleSize, setTitleSize] = useState("m");
  const [noPhotoStyle, setNoPhotoStyle] = useState("editorial");
  const [goldenFlavor, setGoldenFlavor] = useState("sunset");

  const fileRef = useRef(null);
  const flyerRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  const handlePhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setPhotoUrl(ev.target.result);
      // Reset crop to defaults when a new photo is loaded
      update("photoCrop", { x: 50, y: 50, zoom: 1 });
    };
    reader.readAsDataURL(f);
  };

  // Rasterize the flyer surface DOM to a 2160×2700 PNG (2x density of the
  // 1080×1350 layout — sharper on retina + IG re-compression).
  const downloadPng = async () => {
    if (!flyerRef.current || isExporting) return;
    setIsExporting(true);
    try {
      await document.fonts.ready;  // ensure custom fonts loaded
      const dataUrl = await toPng(flyerRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: undefined,  // preserve template's own bg
      });
      const filename = `CGE_${template}_${Date.now()}.png`;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("PNG export failed:", err);
      alert("PNG export failed — see console. Some CSS features (clip-path on Headliner) can be flaky; try a different template or photo.");
    } finally {
      setIsExporting(false);
    }
  };

  const update = (k, v) => setData(d => ({ ...d, [k]: v }));
  const updFooter = (i, v) => setData(d => ({ ...d, footerItems: d.footerItems.map((f, j) => j === i ? v : f) }));
  const rmFooter = (i) => setData(d => ({ ...d, footerItems: d.footerItems.filter((_, j) => j !== i) }));
  const addFooter = () => setData(d => ({ ...d, footerItems: [...d.footerItems, ""] }));

  const loadEvent = (id) => {
    const ev = events.find(e => String(e.id) === String(id));
    if (!ev) return;
    setData(d => ({
      ...d,
      title1: (ev.name || "").toUpperCase(),
      title2: (ev.area || "").toUpperCase(),
      date: ev.day ? ev.day.toUpperCase() : "",
      venue: (ev.venue || "").toUpperCase(),
      time: (ev.time || "").toUpperCase(),
      eventType: (ev.type || "EVENT").toUpperCase(),
    }));
  };

  // Style helpers (match the rest of the app)
  const L = STYLE_L;
  const I = STYLE_I;
  const B = STYLE_B;
  const Bact = STYLE_Bact;

  const W = 1080, H = 1350;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", minHeight: "calc(100vh - 60px)" }}>
      {/* CONTROLS */}
      <div style={{
        padding: "20px",
        background: "#0a0a0a",
        borderRight: "1px solid rgba(245,240,232,0.06)",
        overflowY: "auto",
        maxHeight: "calc(100vh - 60px)",
      }}>
        <h2 style={{ fontSize: "0.7rem", letterSpacing: "2px", textTransform: "uppercase", color: "#E5BC4F", marginBottom: "4px" }}>Flyer Builder</h2>
        <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", marginBottom: "20px" }}>Static mockup · iterate visually</div>

        <Section>
          <label style={L}>Template</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
            {[
              ["nightclub",    "Series"],
              ["photohero",    "Mixer"],
              ["boutique",     "Pop-Up"],
              ["tornpaper",    "Headliner"],
              ["holiday",      "Specials"],
              ["goldenseries", "Golden ★"],
            ].map(([k, lbl]) => (
              <button key={k} onClick={() => setTemplate(k)} style={template === k ? Bact : B}>{lbl}</button>
            ))}
          </div>
          <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: "0.5px", marginTop: "6px", lineHeight: 1.4 }}>
            {template === "nightclub"    && "SERIES — recurring branded night · CTA: see you again next time"}
            {template === "photohero"    && "MIXER — ticketed / RSVP event · CTA: register, get tickets, networking"}
            {template === "boutique"     && "POP-UP — daytime / lifestyle / wellness · CTA: come through, curated moment"}
            {template === "tornpaper"    && "HEADLINER — club night with named DJs/acts · CTA: pull up tonight"}
            {template === "holiday"      && "SPECIALS — theme night with deals · CTA: $X drinks, free entry, promo"}
            {template === "goldenseries" && "GOLDEN SERIES — CGE flagship · light-pressure social hour for young pros · pick a flavor below"}
          </div>
        </Section>

        {template === "goldenseries" && (
          <Section>
            <label style={L}>Golden Series flavor</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
              {Object.entries(GOLDEN_FLAVORS).map(([k, v]) => (
                <button key={k} onClick={() => setGoldenFlavor(k)} style={goldenFlavor === k ? Bact : B}>{v.name.split(" ")[0]}</button>
              ))}
            </div>
            <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.55)", letterSpacing: "0.5px", marginTop: "6px", lineHeight: 1.4 }}>
              {GOLDEN_FLAVORS[goldenFlavor]?.description} · locks theme + photo filter + ornament
            </div>
            <div style={{ fontSize: "0.55rem", color: "rgba(229,188,79,0.55)", letterSpacing: "0.5px", marginTop: "4px" }}>
              Tip — set Wordmark to "THE GOLDEN SERIES" and Title 1 to the edition (e.g. "EDITION ONE")
            </div>
          </Section>
        )}

        {events.length > 0 && (
          <Section>
            <label style={L}>Load from event store</label>
            <select onChange={e => loadEvent(e.target.value)} defaultValue="" style={I}>
              <option value="" disabled>Pick an event…</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{ev.name || "(no name)"} · {ev.day || "?"}</option>
              ))}
            </select>
          </Section>
        )}

        <Section>
          <label style={L}>Wordmark (top-left)</label>
          <input style={I} value={data.wordmark} onChange={e => update("wordmark", e.target.value)} placeholder="leave blank to hide" />
        </Section>

        <Section>
          <label style={L}>Title (line 1)</label>
          <input style={I} value={data.title1} onChange={e => update("title1", e.target.value)} />
        </Section>
        <Section>
          <label style={L}>Title (line 2, optional)</label>
          <input style={I} value={data.title2} onChange={e => update("title2", e.target.value)} />
        </Section>

        {template === "photohero" && (
          <>
            <Section>
              <label style={L}>Top title (city / region)</label>
              <input style={I} value={data.topTitle} onChange={e => update("topTitle", e.target.value)} placeholder="NEW YORK" />
            </Section>
            <Section>
              <label style={L}>Ticket / URL line</label>
              <input style={I} value={data.ticketUrl} onChange={e => update("ticketUrl", e.target.value)} placeholder="TICKETS ON SALE AT…" />
            </Section>
            <Section>
              <label style={L}>Sponsor logos (up to 3 · PNG with transparency works best)</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
                {[0, 1, 2].map(i => {
                  const url = data.sponsorLogos?.[i];
                  return (
                    <div key={i} style={{
                      position: "relative",
                      aspectRatio: "1.5",
                      background: "rgba(245,240,232,0.04)",
                      border: `1px ${url ? "solid" : "dashed"} rgba(245,240,232,0.15)`,
                      borderRadius: "4px",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", overflow: "hidden",
                    }}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*";
                      input.onchange = (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const next = [...(data.sponsorLogos || [])];
                          next[i] = ev.target.result;
                          update("sponsorLogos", next.filter(Boolean));
                        };
                        reader.readAsDataURL(f);
                      };
                      input.click();
                    }}>
                      {url ? (
                        <>
                          <img src={url} alt="" style={{ maxWidth: "85%", maxHeight: "85%", objectFit: "contain" }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = [...(data.sponsorLogos || [])];
                              next.splice(i, 1);
                              update("sponsorLogos", next);
                            }}
                            style={{
                              position: "absolute", top: "2px", right: "2px",
                              width: "18px", height: "18px",
                              border: "none", borderRadius: "50%",
                              background: "rgba(0,0,0,0.6)", color: "#FB7185",
                              fontSize: "0.55rem", cursor: "pointer",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>×</button>
                        </>
                      ) : (
                        <span style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.35)", letterSpacing: "1px", textTransform: "uppercase" }}>+ Logo {i + 1}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {(!data.sponsorLogos || data.sponsorLogos.length === 0) && (
                <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", marginTop: "4px" }}>
                  No logos → falls back to footer-item text stand-ins
                </div>
              )}
            </Section>
          </>
        )}

        {template === "boutique" && (
          <>
            <Section>
              <label style={L}>Day name (e.g. SATURDAY)</label>
              <input style={I} value={data.dayName} onChange={e => update("dayName", e.target.value)} placeholder="SATURDAY" />
            </Section>
            <Section>
              <label style={L}>Address (multi-line)</label>
              <textarea style={{ ...I, minHeight: "70px", fontFamily: "inherit", resize: "vertical" }} value={data.address} onChange={e => update("address", e.target.value)} placeholder="905 MATEO ST.&#10;LOS ANGELES, CA&#10;90021" />
            </Section>
          </>
        )}

        {template === "tornpaper" && (
          <>
            <Section>
              <label style={L}>Headliner (big with dotted lines)</label>
              <input style={I} value={data.headliner} onChange={e => update("headliner", e.target.value)} placeholder="CAFE ERZULIE" />
            </Section>
            <Section>
              <label style={L}>Hosted-by sticker</label>
              <input style={I} value={data.hostedBy} onChange={e => update("hostedBy", e.target.value)} placeholder="HOSTED BY GGC" />
            </Section>
          </>
        )}

        {template === "holiday" && (
          <>
            <Section>
              <label style={L}>Top date / preheader</label>
              <input style={I} value={data.topTitle} onChange={e => update("topTitle", e.target.value)} placeholder="05.05.26" />
            </Section>
            <Section>
              <label style={L}>Deal list (one per line)</label>
              <textarea style={{ ...I, minHeight: "100px", fontFamily: "inherit", resize: "vertical" }} value={data.deals} onChange={e => update("deals", e.target.value)} placeholder="1 HOUR OPEN BAR&#10;$5 SURFSIDES&#10;$7 TEQUILA SHOTS&#10;$8 MARGARITAS" />
            </Section>
            <Section>
              <label style={L}>Footer line (e.g. FREE ENTRY UNTIL 11:00PM)</label>
              <input style={I} value={data.ticketUrl} onChange={e => update("ticketUrl", e.target.value)} placeholder="FREE ENTRY UNTIL 11:00PM" />
            </Section>
          </>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
          <div>
            <label style={L}>Date</label>
            <input style={I} value={data.date} onChange={e => update("date", e.target.value)} />
          </div>
          <div>
            <label style={L}>Time</label>
            <input style={I} value={data.time} onChange={e => update("time", e.target.value)} />
          </div>
        </div>
        <Section>
          <label style={L}>Venue</label>
          <input style={I} value={data.venue} onChange={e => update("venue", e.target.value)} />
        </Section>
        <Section>
          <label style={L}>Event type (used in No-Photo block)</label>
          <input style={I} value={data.eventType} onChange={e => update("eventType", e.target.value)} />
        </Section>

        <Section>
          <label style={L}>Title font</label>
          <select
            value={titleFont}
            onChange={e => setTitleFont(e.target.value)}
            style={{ ...I, fontFamily: fontStack(titleFont), fontWeight: fontWeight(titleFont) }}
          >
            {DISPLAY_FONTS.map(f => (
              <option key={f.key} value={f.key} style={{ fontFamily: f.stack, fontWeight: f.weight || 700 }}>{f.key}</option>
            ))}
          </select>
        </Section>

        <Section>
          <label style={L}>Body font (meta · footer · event-type)</label>
          <select
            value={bodyFont}
            onChange={e => setBodyFont(e.target.value)}
            style={{ ...I, fontFamily: fontStack(bodyFont), fontWeight: fontWeight(bodyFont) }}
          >
            {DISPLAY_FONTS.map(f => (
              <option key={f.key} value={f.key} style={{ fontFamily: f.stack, fontWeight: f.weight || 700 }}>{f.key}</option>
            ))}
          </select>
          {titleFont !== bodyFont && (
            <div style={{ fontSize: "0.55rem", color: "rgba(229,188,79,0.6)", letterSpacing: "1px", marginTop: "4px" }}>
              Title and body fonts differ — set the same to revert
            </div>
          )}
        </Section>

        <Section>
          <label style={L}>Title size</label>
          <div style={{ display: "flex", gap: "6px" }}>
            {[["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setTitleSize(k)} style={titleSize === k ? Bact : B}>{lbl}</button>
            ))}
          </div>
        </Section>

        <Section>
          <label style={L}>BG pattern size</label>
          <div style={{ display: "flex", gap: "6px" }}>
            {[["regular", "Regular"], ["large", "Large"], ["xl", "XL"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setBgSize(k)} style={bgSize === k ? Bact : B}>{lbl}</button>
            ))}
          </div>
        </Section>

        {template !== "goldenseries" && (
          <Section>
            <label style={L}>Theme</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
              {Object.entries(THEMES).map(([k, v]) => (
                <button key={k} onClick={() => setTheme(k)} style={{
                  padding: "8px 4px", fontSize: "0.55rem",
                  background: v.bg, color: v.title,
                  border: `2px solid ${theme === k ? "#FFFFFF" : "transparent"}`,
                  borderRadius: "4px",
                  fontFamily: "inherit", letterSpacing: "1px",
                  textTransform: "uppercase", cursor: "pointer", fontWeight: 600,
                }}>{v.name}</button>
              ))}
            </div>
          </Section>
        )}

        {template === "nightclub" && (
          <Section>
            <label style={L}>Photo mode</label>
            <div style={{ display: "flex", gap: "6px" }}>
              {[["card", "Card"], ["block", "No Photo"], ["fullbg", "Full BG"]].map(([k, lbl]) => (
                <button key={k} onClick={() => setPhotoMode(k)} style={photoMode === k ? Bact : B}>{lbl}</button>
              ))}
            </div>
          </Section>
        )}

        {template === "nightclub" && photoMode === "block" && (
          <Section>
            <label style={L}>No-Photo style</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
              {[
                ["editorial", "Editorial"],
                ["statement", "Statement"],
                ["frame",     "Frame"],
              ].map(([k, lbl]) => (
                <button key={k} onClick={() => setNoPhotoStyle(k)} style={noPhotoStyle === k ? Bact : B}>{lbl}</button>
              ))}
            </div>
          </Section>
        )}

        {/* Photo upload — available unless Nightclub template is in No-Photo block mode */}
        {!(template === "nightclub" && photoMode === "block") && (
          <Section>
            <label style={L}>Photo</label>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />
            <div style={{ display: "flex", gap: "6px" }}>
              <button onClick={() => fileRef.current?.click()} style={B}>{photoUrl ? "Change photo" : "Upload photo"}</button>
              {photoUrl && <button onClick={() => setPhotoUrl(null)} style={{ ...B, color: "rgba(251,113,133,0.7)" }}>Remove</button>}
            </div>
          </Section>
        )}

        {/* Photo overlay slider — for any template that uses photo as full bg */}
        {((template === "nightclub" && photoMode === "fullbg") || template === "photohero") && photoUrl && (
          <Section>
            <label style={L}>Photo overlay: {Math.round(bgOpacity * 100)}%</label>
            <input type="range" min="0.30" max="0.92" step="0.01" value={bgOpacity}
              onChange={e => setBgOpacity(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#E5BC4F" }} />
          </Section>
        )}

        {/* Photo crop/reposition — shown whenever a photo is uploaded */}
        {photoUrl && (
          <Section>
            <label style={L}>Photo position & zoom</label>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 8px", alignItems: "center", fontSize: "0.55rem", color: "rgba(245,240,232,0.5)" }}>
              <span style={{ letterSpacing: "1px", textTransform: "uppercase" }}>X</span>
              <input
                type="range" min="0" max="100" step="1"
                value={data.photoCrop?.x ?? 50}
                onChange={e => update("photoCrop", { ...(data.photoCrop || { x: 50, y: 50, zoom: 1 }), x: parseInt(e.target.value) })}
                style={{ width: "100%", accentColor: "#E5BC4F" }}
              />
              <span style={{ minWidth: "26px", textAlign: "right" }}>{data.photoCrop?.x ?? 50}%</span>
              <span style={{ letterSpacing: "1px", textTransform: "uppercase" }}>Y</span>
              <input
                type="range" min="0" max="100" step="1"
                value={data.photoCrop?.y ?? 50}
                onChange={e => update("photoCrop", { ...(data.photoCrop || { x: 50, y: 50, zoom: 1 }), y: parseInt(e.target.value) })}
                style={{ width: "100%", accentColor: "#E5BC4F" }}
              />
              <span style={{ minWidth: "26px", textAlign: "right" }}>{data.photoCrop?.y ?? 50}%</span>
              <span style={{ letterSpacing: "1px", textTransform: "uppercase" }}>Zoom</span>
              <input
                type="range" min="1" max="2.5" step="0.05"
                value={data.photoCrop?.zoom ?? 1}
                onChange={e => update("photoCrop", { ...(data.photoCrop || { x: 50, y: 50, zoom: 1 }), zoom: parseFloat(e.target.value) })}
                style={{ width: "100%", accentColor: "#E5BC4F" }}
              />
              <span style={{ minWidth: "26px", textAlign: "right" }}>{(data.photoCrop?.zoom ?? 1).toFixed(2)}×</span>
            </div>
            <button
              onClick={() => update("photoCrop", { x: 50, y: 50, zoom: 1 })}
              style={{ ...B, marginTop: "6px", fontSize: "0.55rem", padding: "5px 8px" }}
            >
              Reset crop
            </button>
          </Section>
        )}

        <Section>
          <label style={L}>Footer label</label>
          <input style={I} value={data.footerLabel} onChange={e => update("footerLabel", e.target.value)} placeholder="PRESENTED BY · TAGS · SPONSORS" />
        </Section>

        <Section>
          <label style={L}>Footer items ({data.footerItems.length}/4)</label>
          {data.footerItems.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: "4px", marginBottom: "4px" }}>
              <input style={I} value={it} onChange={e => updFooter(i, e.target.value)} />
              <button onClick={() => rmFooter(i)} style={{ ...B, padding: "0 10px", color: "rgba(251,113,133,0.6)" }}>×</button>
            </div>
          ))}
          {data.footerItems.length < 4 && (
            <button onClick={addFooter} style={B}>+ Add item</button>
          )}
        </Section>

        <Section>
          <label style={L}>Preview zoom: {Math.round(scale * 100)}%</label>
          <input type="range" min="0.30" max="1.0" step="0.01" value={scale}
            onChange={e => setScale(parseFloat(e.target.value))}
            style={{ width: "100%", accentColor: "#E5BC4F" }} />
        </Section>

        <button
          onClick={downloadPng}
          disabled={isExporting}
          style={{
            width: "100%",
            padding: "14px",
            marginTop: "10px",
            background: isExporting ? "rgba(229,188,79,0.4)" : "#E5BC4F",
            color: "#000",
            border: "none",
            borderRadius: "6px",
            fontSize: "0.85rem",
            fontWeight: 700,
            letterSpacing: "2px",
            textTransform: "uppercase",
            cursor: isExporting ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {isExporting ? "Rendering…" : "Download PNG"}
        </button>
        <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: "0.5px", marginTop: "6px", textAlign: "center" }}>
          2160×2700 (2× density) · IG-ready
        </div>
      </div>

      {/* PREVIEW */}
      <div style={{
        background: "#1a1a1a",
        padding: "30px",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        overflow: "auto",
      }}>
        <div style={{
          width: `${W * scale}px`,
          height: `${H * scale}px`,
          position: "relative",
          flexShrink: 0,
        }}>
          <div style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: `${W}px`,
            height: `${H}px`,
          }}>
            <div ref={flyerRef} style={{ width: `${W}px`, height: `${H}px` }}>
            <FlyerSurface
              template={template}
              data={data}
              theme={theme}
              photoMode={photoMode}
              photoUrl={photoUrl}
              bgOpacity={bgOpacity}
              titleFont={titleFont}
              bodyFont={bodyFont}
              bgSize={bgSize}
              titleSize={titleSize}
              noPhotoStyle={noPhotoStyle}
              goldenFlavor={goldenFlavor}
            />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
