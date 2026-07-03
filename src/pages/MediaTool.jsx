import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import JSZip from "jszip";
import { useEventsStore, useRestoreStore, useBrandStore, useCarouselTemplatesStore, BUILTIN_CAROUSEL_TEMPLATES } from "../store";
import { generateCaptions } from "../shared/gemini";
import { savePhotoAndNotify, saveExport } from "../shared/photoLibrary.js";
import { tagPngWithCgeExport } from "../shared/pngMetadata.js";
import { PhotoLibraryModal } from "../shared/PhotoLibraryModal.jsx";
import { EventToolsPanel } from "../shared/EventToolsPanel.jsx";
import { AiSlideGeneratorModal } from "../shared/AiSlideGeneratorModal.jsx";
import { AiTemplateFillModal } from "../shared/AiTemplateFillModal.jsx";

const COLORS = {
  yellow:{name:"Yellow",hex:"#FACC15"},purple:{name:"Purple",hex:"#C084FC"},
  wine:{name:"Wine",hex:"#FB7185"},emerald:{name:"Emerald",hex:"#34D399"},
  gold:{name:"Gold",hex:"#FBBF24"},white:{name:"White",hex:"#FFFFFF"},
};
// BG_COLORS — backgrounds for non-photo modes. The night palette is the
// original CGE look (dark + saturated + spotlight). The day palette is
// new — adds a warmer / lighter register for daytime content (brunches,
// markets, Sunday recaps, casual announcements). Each light bg carries
// isLight: true, which every renderer reads to flip text from white →
// near-black, skip the spotlight gradient (it'd look bizarre on cream),
// and use a dark CGE letter texture instead of a white one.
const BG_COLORS = {
  // Night palette (originals)
  black:     { name: "Black",       hex: "#000000" },
  purple:    { name: "Purple",      hex: "#7C3AED" },
  wine:      { name: "Wine",        hex: "#BE3A34" },
  emerald:   { name: "Emerald",     hex: "#059669" },
  gold:      { name: "Gold",        hex: "#D4943A" },
  yellow:    { name: "Yellow",      hex: "#EAB308" },
  // Day palette (light backgrounds — auto-flip text + watermark to dark)
  cream:     { name: "Cream",       hex: "#F0E5D0", isLight: true },
  linen:     { name: "Linen",       hex: "#EAE0CB", isLight: true },
  sage:      { name: "Sage",        hex: "#C9CCB5", isLight: true },
  dustyrose: { name: "Dusty Rose",  hex: "#E5C8C0", isLight: true },
  palegold:  { name: "Pale Gold",   hex: "#F2DDA8", isLight: true },
};

// Export-time aspect ratios. The renderers are all hardcoded to 1080×1080,
// so non-1:1 exports place the rendered slide centered inside a taller
// canvas with the current bg color filling the bars (matches Instagram's
// own carousel display for 4:5 and lets 9:16 Reel/Story crops land cleanly).
const EXPORT_RATIOS = {
  "1:1":  { w: 1080, h: 1080, label: "1:1 · Square" },
  "4:5":  { w: 1080, h: 1350, label: "4:5 · IG Post" },
  "3:4":  { w: 1080, h: 1440, label: "3:4 · Print / Pinterest" },
  "9:16": { w: 1080, h: 1920, label: "9:16 · Story/Reel" },
};

// Module-level state for fonts + watermark, synced from the React component.
// Renderers read these so we don't have to thread them through every cfg.
let _displayFont = "Syne";
let _bodyFont = "DM Sans";
let _watermark = true;
// Brand identity — synced from useBrandStore via useEffect inside the
// component. Renderers read these so watermark text follows whatever
// the user set in Brand Kit (defaults to CGE values for back-compat).
let _brand = {
  logoText: "CGE",
  brandName: "Central Group Events",
  handle: "@centralgroupevents",
  url: "centralgroupevents.com",
};
const ff = (s) => s.replace(/'Syne'/g, `'${_displayFont}'`).replace(/'DM Sans'/g, `'${_bodyFont}'`);

// Split `text` into whole-word lines that each fit within maxW at the
// caller's current ctx.font / letterSpacing. Description / meta / subtitle
// lines used to draw as a single fillText and run off the slide edge when
// long; renderers now wrap them with this and stack the lines themselves
// (up or down depending on their anchor). Always returns at least one line.
function wrapToLines(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  // A single token wider than maxW (a long unbroken string / URL) can't wrap
  // on spaces, so hard-break it by characters — otherwise it still runs off
  // the edge even with word wrapping.
  const fit = (w) => {
    if (ctx.measureText(w).width <= maxW) return [w];
    const chunks = []; let piece = "";
    for (const ch of w) {
      if (piece && ctx.measureText(piece + ch).width > maxW) { chunks.push(piece); piece = ch; }
      else piece += ch;
    }
    if (piece) chunks.push(piece);
    return chunks;
  };
  const lines = [];
  let cur = "";
  for (const raw of words) {
    for (const w of fit(raw)) {
      const test = cur ? cur + " " + w : w;
      if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = w; }
      else cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const setActiveFonts = (d, b) => { _displayFont = d; _bodyFont = b; };
const setActiveWatermark = (w) => { _watermark = w; };
const setActiveBrand = (b) => { _brand = { ..._brand, ...b }; };

const FONT_PAIRS = {
  default: { name: "Syne + DM Sans", display: "Syne", body: "DM Sans" },
  bold:    { name: "Bebas + Inter", display: "Bebas Neue", body: "Inter" },
  serif:   { name: "Playfair + Inter", display: "Playfair Display", body: "Inter" },
  modern:  { name: "Space Grotesk + Inter", display: "Space Grotesk", body: "Inter" },
};

function drawTexture(ctx, W, H, color, alpha, startY = 0) {
  if (!_watermark) return;
  ctx.save();
  if (startY > 0) { ctx.beginPath(); ctx.rect(0, startY, W, H - startY); ctx.clip(); }
  ctx.translate(W/2, H*0.6); ctx.rotate(-5*Math.PI/180); ctx.translate(-W/2, -H*0.6);
  // Watermark grid letters are locked to Syne — the brand mark stays
  // brand-consistent regardless of the content's font-pair choice.
  // Don't pipe through ff().
  ctx.font = "800 22px 'Syne',sans-serif";
  ctx.fillStyle = color; ctx.globalAlpha = alpha;
  ctx.textBaseline = "middle"; ctx.textAlign = "center";
  // Watermark grid letters come from Brand Kit logoText (e.g. "CGE" → ["C","G","E"]).
  // Falls back to the original CGE letters when nothing's set.
  const lts = (_brand.logoText || "CGE").split("").filter(Boolean);
  const ltsSafe = lts.length ? lts : ["C","G","E"];
  let li = 0;
  for (let y = -60; y < H + 60; y += 32) {
    const off = (Math.round((y+60)/32) % 2 === 1) ? 18 : 0;
    for (let x = -60+off; x < W+60; x += 36) { ctx.fillText(ltsSafe[li % ltsSafe.length], x, y); li++; }
  }
  ctx.restore();
}

function drawSpotlight(ctx, W, H, sCol, sA) {
  let g;
  g = ctx.createRadialGradient(0,0,0,0,0,500); g.addColorStop(0,`rgba(${sCol},${sA})`); g.addColorStop(0.3,`rgba(${sCol},${sA*0.4})`); g.addColorStop(0.65,`rgba(${sCol},${sA*0.1})`); g.addColorStop(1,"transparent"); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  g = ctx.createLinearGradient(0,0,W,H); g.addColorStop(0,`rgba(${sCol},${sA*0.25})`); g.addColorStop(0.3,`rgba(${sCol},${sA*0.06})`); g.addColorStop(0.5,"transparent"); g.addColorStop(0.8,`rgba(${sCol},${sA*0.05})`); g.addColorStop(1,`rgba(${sCol},${sA*0.18})`); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  g = ctx.createRadialGradient(W,0,0,W,0,450); g.addColorStop(0,`rgba(${sCol},${sA*0.25})`); g.addColorStop(0.4,`rgba(${sCol},${sA*0.08})`); g.addColorStop(1,"transparent"); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  g = ctx.createRadialGradient(W*0.8,H*0.9,0,W*0.8,H*0.9,400); g.addColorStop(0,`rgba(${sCol},${sA*0.35})`); g.addColorStop(0.3,`rgba(${sCol},${sA*0.12})`); g.addColorStop(1,"transparent"); ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
}

function drawLogo(ctx, accent, W, isLight = false) {
  if (!_watermark) return;
  ctx.globalAlpha = 1;
  ctx.fillStyle = `${accent}25`; ctx.strokeStyle = `${accent}50`; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(58,52,28,0,Math.PI*2); ctx.fill(); ctx.stroke();
  // Watermark text is locked to the original CGE brand fonts — Syne for
  // the display piece (CGE in the circle) and DM Sans for the body
  // pieces (Central Group Events + @centralgroupevents). The watermark
  // is brand identity; it stays consistent regardless of which font
  // pair the user picks for their slide content. Don't pipe through ff().
  ctx.font = "700 17px 'Syne',sans-serif";
  ctx.fillStyle = accent; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  // Logo letters, brand name, and handle all come from Brand Kit.
  ctx.fillText(_brand.logoText || "CGE", 58, 53); ctx.textAlign = "left";
  const primaryText = isLight ? "#0a0a0a" : "#FFF";
  const secondaryText = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.50)";
  ctx.font = "700 22px 'DM Sans',sans-serif";
  ctx.fillStyle = primaryText; ctx.textBaseline = "top";
  ctx.fillText(_brand.brandName || "Central Group Events", 96, 35);
  ctx.font = "500 17px 'DM Sans',sans-serif";
  ctx.fillStyle = secondaryText;
  ctx.fillText(_brand.handle || "@centralgroupevents", 96, 60);
}

function drawDots(ctx, W, current, total, accent, isLight = false) {
  if (total <= 1) return;
  const inactive = isLight ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.30)";
  const sx = W - 40 - (total-1)*18;
  for (let i = 0; i < total; i++) {
    ctx.beginPath(); ctx.arc(sx+i*18, 52, i===(current-1)?6:4, 0, Math.PI*2);
    ctx.fillStyle = i===(current-1) ? accent : inactive; ctx.fill();
  }
}

function drawFooter(ctx, W, H, isLight = false) {
  if (!_watermark) return;
  ctx.globalAlpha = 1;
  const rule       = isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.08)";
  const brand      = isLight ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.20)";
  const url        = isLight ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.15)";
  ctx.fillStyle = rule; ctx.fillRect(60, H-38, W-120, 1);
  // Watermark text locked to brand fonts (Syne + DM Sans) — never
  // follows the content's font-pair selection. Don't pipe through ff().
  ctx.font = "800 16px 'Syne',sans-serif";
  ctx.fillStyle = brand; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
  // Footer pulls brand name + URL from Brand Kit. Uppercase the brand name
  // to match the historical CGE footer treatment.
  const footerName = (_brand.brandName || "Central Group Events").toUpperCase();
  ctx.fillText(footerName, 60, H-14);
  ctx.font = "500 14px 'DM Sans',sans-serif";
  ctx.fillStyle = url; ctx.textAlign = "right";
  ctx.fillText(_brand.url || "centralgroupevents.com", W-60, H-14); ctx.textAlign = "left";
}

function drawPageNum(ctx, W, H, current, total, accent, isLight = false) {
  if (total <= 1) return;
  ctx.font=ff("600 16px 'DM Sans',sans-serif"); ctx.fillStyle = isLight ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.20)";
  ctx.textBaseline = "bottom"; ctx.textAlign = "right";
  ctx.fillText(`${current}/${total}`, W-60, H-14); ctx.textAlign = "left";
}

// === COVER RENDERER ===
// Ratio-aware: pass targetW/targetH in cfg to render at non-1:1 aspects
// (4:5, 3:4, 9:16). Photo, watermark grid, logo, footer, and headline
// all extend to fill the full target canvas — no more "design baked at
// 1080×1080 letterboxed onto a taller frame." Defaults to 1080×1080
// + center focal so callers that don't pass these get the original
// square render unchanged.
function renderCover(canvas, cfg) {
  const { photo, headline, highlights, accent, dots, totalDots, subtitle, opacity, ribbon, categoryTag, coverCtaButton, align = "left", band = false, targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5 } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (photo) {
    // Cover-fit + focal-aware anchor — same math as wrapForExport's
    // PATH A but applied at render time so the photo fills the full
    // target aspect with the user's focal point centered.
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    let dx = (W / 2) - (photo.width * focalX * s);
    let dy = (H / 2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
  } else { ctx.fillStyle="#111"; ctx.fillRect(0,0,W,H); }
  const grd=ctx.createLinearGradient(0,H*0.25,0,H); grd.addColorStop(0,"transparent"); grd.addColorStop(0.3,`rgba(0,0,0,${opacity*0.6})`); grd.addColorStop(0.55,`rgba(0,0,0,${opacity*0.88})`); grd.addColorStop(1,`rgba(0,0,0,${opacity})`); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
  drawTexture(ctx,W,H,"#FFF",0.04);
  drawLogo(ctx,accent,W); drawDots(ctx,W,dots,totalDots,accent);

  // CATEGORY TAG — editorial section label, magazine-style. Sits in the
  // top-center area just under the logo bar. Letterspaced small-caps,
  // white-ish so it reads as a metadata tag rather than competing with
  // the headline. Hides entirely when empty (the user's existing covers
  // were fine without it — this is purely additive).
  if (categoryTag?.trim()) {
    ctx.save();
    ctx.font = ff("700 18px 'DM Sans',sans-serif");
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.letterSpacing = "5px";
    ctx.fillText(categoryTag.toUpperCase(), W / 2, 110);
    // Thin underline rule beneath the tag, accent-colored, ~60px wide
    ctx.fillStyle = accent;
    ctx.fillRect(W / 2 - 30, 110 + 28, 60, 2);
    ctx.restore();
  }

  if (!headline?.trim()) { drawFooter(ctx,W,H); return; }
  // px=110 keeps content inside IG's 4:5 cover-preview safe zone when
  // exporting at 1:1 (864×1080 centered crop = 108px per side).
  // letterSpacing reset is LOAD-BEARING — subtitle render later sets 3px,
  // but headline measurement + render must use 0px to keep word widths
  // and cursor advance in sync. Previously a stale 3px leaked in here,
  // inflating measured word widths and leaving visible gaps after each
  // word at draw time (since the actual fillText ran at 0px).
  ctx.letterSpacing = "0px";
  const words=headline.split(/\s+/).filter(w=>w), px=110, maxW=W-px*2;
  let fs=72; ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`);
  const wrap=(f)=>{ ctx.font=ff(`800 ${f}px 'Syne',sans-serif`); ctx.letterSpacing="0px"; const r=[]; let cl=[],cw=0; const sw=ctx.measureText(" ").width;
    for(let i=0;i<words.length;i++){const t=words[i].toUpperCase(),ww=ctx.measureText(t).width;if(cl.length>0&&cw+sw+ww>maxW){r.push(cl);cl=[{text:t,idx:i,width:ww}];cw=ww;}else{cw+=(cl.length>0?sw:0)+ww;cl.push({text:t,idx:i,width:ww});}}if(cl.length)r.push(cl);return r;};
  let lines=wrap(fs); while(lines.length*(fs*1.05)>H*0.55&&fs>36){fs-=2;lines=wrap(fs);}
  // Bottom margin 130 (was 50) so the title sits inside Instagram's 4:5
  // safe zone — IG previews tend to crop or visually nibble the bottom
  // edge of a 1:1 post (caption row, profile chip, action bar overlap).
  // 130px keeps the full title visible across feed, grid, and explore.
  const lh=fs*1.05, totalH=lines.length*lh, startY=H-130-totalH;
  const isCenter = align === "center";
  // Optional solid band behind the headline block — legibility over busy
  // photos (@theaifield look). Full-width, from just above the ribbon/
  // subtitle all the way down to the bottom edge of the photo. (It used to
  // stop just below the last headline line, leaving a strip of photo showing
  // under the black between the headline and the footer — the user wanted the
  // solid black to reach the bottom.) The CENTRAL GROUP EVENTS watermark is
  // drawn afterward (drawFooter, below) so it stays on top of the band.
  if(band){
    const bandTop = ribbon?.trim() ? startY-104 : (subtitle?.trim() ? startY-58 : startY-20);
    const top = Math.max(0, bandTop);
    ctx.fillStyle="rgba(0,0,0,0.90)";
    ctx.fillRect(0, top, W, H - top);
  }
  if(ribbon?.trim()){
    const rt=ribbon.toUpperCase();
    ctx.font=ff("800 22px 'Syne',sans-serif"); ctx.letterSpacing="4px";
    const tw=ctx.measureText(rt).width, rpadX=20, rectW=tw+rpadX*2, rectH=44;
    const ribbonY=subtitle?.trim()?startY-94:startY-60;
    const ribbonX=isCenter?(W-rectW)/2:px;
    ctx.fillStyle=accent; ctx.beginPath(); ctx.roundRect(ribbonX,ribbonY,rectW,rectH,4); ctx.fill();
    ctx.fillStyle="#000"; ctx.textBaseline="middle"; ctx.textAlign="left";
    ctx.fillText(rt,ribbonX+rpadX,ribbonY+rectH/2);
    ctx.letterSpacing="0px"; ctx.textBaseline="top";
  }
  if(subtitle?.trim()){
    ctx.font=ff("700 24px 'DM Sans',sans-serif");ctx.fillStyle=accent;ctx.textBaseline="bottom";ctx.letterSpacing="3px";ctx.textAlign=isCenter?"center":"left";
    // Wrap the subtitle/where-line instead of drawing it on one line — a long
    // tagline (e.g. a full "X hosts the first …" sentence) used to run off the
    // right edge of the slide. Break it into lines that fit the safe width and
    // stack them UPWARD from just above the headline so the layout still reads
    // top-to-bottom.
    const subMaxW = W - px*2;
    const subWords = subtitle.toUpperCase().split(/\s+/).filter(Boolean);
    const subLines = []; let curLine = "";
    for(const wd of subWords){
      const test = curLine ? curLine+" "+wd : wd;
      if(curLine && ctx.measureText(test).width > subMaxW){ subLines.push(curLine); curLine = wd; }
      else curLine = test;
    }
    if(curLine) subLines.push(curLine);
    const subLH = 30;
    subLines.forEach((ln,si)=>{
      const y = startY - 12 - (subLines.length - 1 - si) * subLH;
      ctx.fillText(ln, isCenter?W/2:px, y);
    });
    ctx.textAlign="left";ctx.letterSpacing="0px";
  }
  ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`); ctx.textBaseline="top"; ctx.letterSpacing="0px"; const sw=ctx.measureText(" ").width;
  lines.forEach((lw,li)=>{const lineW=lw.reduce((a,w)=>a+w.width,0)+sw*Math.max(0,lw.length-1);let x=isCenter?(W-lineW)/2:px;const y=startY+li*lh;lw.forEach(w=>{ctx.fillStyle=highlights.has(w.idx)?accent:"#FFF";ctx.fillText(w.text,x,y);x+=w.width+sw;});});

  // Optional CTA pill button — sits below the headline, above the footer.
  // Renders as a rounded rect filled with the accent color and dark text.
  // Skipped silently when empty so editorial covers stay clean.
  const ctaText = (coverCtaButton || "").trim();
  if (ctaText) {
    ctx.save();
    ctx.font = ff("700 22px 'Syne',sans-serif");
    ctx.letterSpacing = "2px";
    const upper = ctaText.toUpperCase();
    const tw = ctx.measureText(upper).width;
    const padX = 28, padY = 14;
    const pillW = tw + padX * 2;
    const pillH = 28 + padY * 2;
    const pillX = (W - pillW) / 2;
    // Anchor 56px above the footer so it doesn't collide with the
    // 38px-tall watermark footer or its top divider line.
    const pillY = H - 56 - pillH;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(pillX, pillY, pillW, pillH, pillH / 2); ctx.fill();
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(upper, W / 2, pillY + pillH / 2 + 1);
    ctx.restore();
  }

  drawFooter(ctx,W,H);
}

// === LIST RENDERER ===
function renderList(canvas, cfg) {
  const { items, accent, bgKey, dots, totalDots, listTitle, listSubtitle,
          photo, opacity, focalX = 0.5, focalY = 0.5,
          targetW = 1080, targetH = 1080 } = cfg;
  const W = targetW, H = targetH; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  // With a photo the dark wash carries the text + cards, so force day-mode
  // off (white text on the photo) — matches the other photo slots.
  const isLight = !photo && !!bg.isLight;
  const isBlack=bgKey==="black";
  if (photo) {
    // Full-bleed, focal-aware background photo + dark wash for legibility.
    const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s;
    let dx = (W/2) - (photo.width * focalX * s);
    let dy = (H/2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity != null ? opacity : 0.60})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:(isLight?0.08:0.14));
    // Spotlight is a nightclub-light effect — skip on light backgrounds.
    if(!isLight){
      if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.40);
      else drawSpotlight(ctx,W,H,"229,188,79",0.30);
    }
  }

  // Day mode flips every text + card surface from white-on-dark to dark-on-light.
  const textPrimary  = isLight ? "#0a0a0a" : "#FFF";
  const textSubtle   = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.35)";
  const textMuted    = isLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.45)";
  const cardFill     = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
  const accentStripe = isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.10)";

  // px=110 keeps content inside IG's 4:5 cover-preview safe zone when
  // exporting at 1:1 (864×1080 centered crop = 108px per side).
  const px = 110;
  ctx.globalAlpha=1; ctx.textBaseline="top"; ctx.textAlign="left";
  drawDots(ctx,W,dots,totalDots,accent,isLight);
  ctx.font=ff("800 52px 'Syne',sans-serif"); ctx.fillStyle=accent; ctx.fillText((listTitle||"FRIDAY").toUpperCase(),px,50);
  ctx.font=ff("700 22px 'DM Sans',sans-serif"); ctx.fillStyle=textSubtle; ctx.letterSpacing="2px";
  ctx.fillText((listSubtitle||"TOP PICKS").toUpperCase(),px,108); ctx.letterSpacing="0px";
  ctx.fillStyle = `${accent}30`; ctx.fillRect(px,140,W-px*2,2);

  const startY=155, rowH=100, maxItems=Math.min(items.length,8);
  items.slice(0,maxItems).forEach((item,i)=>{
    const y=startY+i*rowH;
    ctx.fillStyle=cardFill; ctx.beginPath(); ctx.roundRect(px,y,W-px*2,rowH-12,10); ctx.fill();
    ctx.fillStyle=item.featured?accent:accentStripe;
    ctx.beginPath(); ctx.roundRect(px,y,4,rowH-12,[10,0,0,10]); ctx.fill();
    ctx.font=ff("700 34px 'DM Sans',sans-serif"); ctx.fillStyle=item.featured?accent:textPrimary; ctx.textBaseline="top";
    let nm=item.name.toUpperCase(); const nmMax=W-px*2-60; if(ctx.measureText(nm).width>nmMax){while(ctx.measureText(nm+"..").width>nmMax&&nm.length>0)nm=nm.slice(0,-1);nm+="..";}
    ctx.fillText(nm,px+22,y+14);
    ctx.font=ff("400 26px 'DM Sans',sans-serif"); ctx.fillStyle=textMuted;
    ctx.fillText(item.detail||"",px+22,y+54);
  });

  drawFooter(ctx,W,H,isLight);
}

// === STAT RENDERER ===
function renderStat(canvas, cfg) {
  const { statNumber, statLabel, statSub, accent, bgKey, dots, totalDots,
          photo, opacity, focalX = 0.5, focalY = 0.5,
          targetW = 1080, targetH = 1080 } = cfg;
  const W = targetW, H = targetH; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  const bg=BG_COLORS[bgKey]||BG_COLORS.purple;
  // With a photo the dark wash always carries the text, so force day-mode
  // off and render white text on the photo (matches the other photo slots).
  const isLight = !photo && !!bg.isLight;
  const isBlack=bgKey==="black";
  if (photo) {
    // Full-bleed, focal-aware background photo + dark wash for legibility.
    const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s;
    let dx = (W/2) - (photo.width * focalX * s);
    let dy = (H/2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity != null ? opacity : 0.55})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.06:(isLight?0.08:0.14));
    if(!isLight){
      if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.45);
      else drawSpotlight(ctx,W,H,"229,188,79",0.35);
    }
  }

  const textPrimary = isLight ? "#0a0a0a" : "#FFF";
  const dividerColor = isLight ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.25)";
  const subColor = isLight ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.55)";

  ctx.globalAlpha=1;
  ctx.font=ff("800 280px 'Syne',sans-serif"); ctx.fillStyle=textPrimary; ctx.textBaseline="middle"; ctx.textAlign="center";
  let numFS=280; ctx.font=ff(`800 ${numFS}px 'Syne',sans-serif`);
  while(ctx.measureText(statNumber||"47").width>W-160&&numFS>80){numFS-=10;ctx.font=ff(`800 ${numFS}px 'Syne',sans-serif`);}
  ctx.fillText(statNumber||"47",W/2,H*0.42);

  ctx.font=ff("800 52px 'Syne',sans-serif"); ctx.fillStyle=textPrimary; ctx.letterSpacing="6px";
  ctx.fillText((statLabel||"EVENTS").toUpperCase(),W/2,H*0.58); ctx.letterSpacing="0px";

  ctx.fillStyle=dividerColor; ctx.fillRect(W/2-40,H*0.64,80,3);

  if(statSub?.trim()){
    ctx.font=ff("400 28px 'DM Sans',sans-serif"); ctx.fillStyle=subColor; ctx.textBaseline="top";
    // Respect manual line breaks, but ALSO auto-wrap any long segment so it
    // doesn't run off the edge.
    const subLines=statSub.split("\n").flatMap(seg=>wrapToLines(ctx,seg,W-160));
    subLines.forEach((ln,i)=>ctx.fillText(ln.trim(),W/2,H*0.67+i*36));
  }

  ctx.textAlign="left"; ctx.textBaseline="top";
  drawDots(ctx,W,dots,totalDots,accent,isLight); drawFooter(ctx,W,H,isLight);
}

// === TEXT RENDERER ===
function renderText(canvas, cfg) {
  const { textTitle, textTitleHighlights, textBody, accent, bgKey, dots, totalDots, pageNum, totalPages, photo, textOpacity,
          targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5 } = cfg;
  const W = targetW, H = targetH; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");

  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s;
    let dx = (W/2) - (photo.width * focalX * s);
    let dy = (H/2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle=`rgba(0,0,0,${textOpacity||0.85})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack=bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:(isLight?0.06:0.10));
    if(!isBlack && !isLight) drawSpotlight(ctx,W,H,"255,255,255",0.35);
  }

  const titleColor = isLight ? "#0a0a0a" : "#FFF";
  const bodyColor = isLight ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.65)";
  const bodyBold = isLight ? "#0a0a0a" : "#FFF";

  ctx.globalAlpha=1; ctx.textBaseline="top"; ctx.textAlign="left";

  const words=(textTitle||"").split(/\s+/).filter(w=>w);
  // px=110 keeps content inside IG's 4:5 cover-preview safe zone when
  // exporting at 1:1 (864×1080 centered crop = 108px per side).
  const px=110, maxW=W-px*2;
  let fs=60; ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`);
  const wrap=(f)=>{ctx.font=ff(`800 ${f}px 'Syne',sans-serif`);const r=[];let cl=[],cw=0;const sw=ctx.measureText(" ").width;
    for(let i=0;i<words.length;i++){const t=words[i].toUpperCase(),ww=ctx.measureText(t).width;if(cl.length>0&&cw+sw+ww>maxW){r.push(cl);cl=[{text:t,idx:i,width:ww}];cw=ww;}else{cw+=(cl.length>0?sw:0)+ww;cl.push({text:t,idx:i,width:ww});}}if(cl.length)r.push(cl);return r;};
  let lines=wrap(fs); while(lines.length*(fs*1.05)>H*0.30&&fs>30){fs-=2;lines=wrap(fs);}
  const lh=fs*1.05, sw=ctx.measureText(" ").width;
  const titleY=70;
  lines.forEach((lw,li)=>{
    const lineW=lw.reduce((a,w)=>a+w.width,0)+(lw.length-1)*sw;
    let x=(W-lineW)/2; const y=titleY+li*lh;
    lw.forEach(w=>{ctx.fillStyle=textTitleHighlights.has(w.idx)?accent:titleColor;ctx.fillText(w.text,x,y);x+=w.width+sw;});
  });

  const barY=titleY+lines.length*lh+18;
  ctx.fillStyle=accent; ctx.fillRect(W/2-25,barY,50,4);

  if(textBody?.trim()){
    ctx.font=ff("400 30px 'DM Sans',sans-serif"); ctx.fillStyle=bodyColor;
    const paragraphs=textBody.split("\n");
    const bodyLines=[];
    for(const para of paragraphs){
      if(!para.trim()){bodyLines.push("");continue;}
      const ws=para.split(/\s+/); let bl="";
      for(const w of ws){
        const test=bl?bl+" "+w:w;
        const measured=test.replace(/\*/g,"");
        if(ctx.measureText(measured).width>maxW&&bl){bodyLines.push(bl);bl=w;}
        else bl=test;
      }
      if(bl)bodyLines.push(bl);
    }
    // Variable-height layout — body lines use lineH (42), paragraph
    // breaks (empty strings) use breakH (34, ~0.8 of lineH). Brings the
    // editorial column together so two paragraphs read as one piece
    // instead of two stacked blocks. The y-position of each line is
    // accumulated so spacing stays correct regardless of break count.
    const lineH = 42, breakH = 34;
    const yOffsets = [];
    let accumulated = 0;
    bodyLines.forEach(ln => {
      yOffsets.push(accumulated);
      accumulated += (ln === "") ? breakH : lineH;
    });
    const blockH = accumulated;
    let startY=H/2-blockH/2;
    const minY=barY+30, maxBottom=H-70;
    if(startY<minY)startY=minY;
    if(startY+blockH>maxBottom)startY=maxBottom-blockH;

    bodyLines.forEach((ln,i)=>{
      const y = startY + yOffsets[i];
      if(y<0||y>H-40) return;
      const parts=ln.split(/(\*[^*]+\*)/g);
      let lineW=0;
      parts.forEach(part=>{
        if(part.startsWith("*")&&part.endsWith("*")){
          ctx.font=ff("700 30px 'DM Sans',sans-serif");
          lineW+=ctx.measureText(part.slice(1,-1)).width;
        } else {
          ctx.font=ff("400 30px 'DM Sans',sans-serif");
          lineW+=ctx.measureText(part).width;
        }
      });
      let x=(W-lineW)/2;
      parts.forEach(part=>{
        if(part.startsWith("*")&&part.endsWith("*")){
          const inner=part.slice(1,-1);
          ctx.font=ff("700 30px 'DM Sans',sans-serif"); ctx.fillStyle=bodyBold;
          ctx.fillText(inner,x,y); x+=ctx.measureText(inner).width;
          ctx.font=ff("400 30px 'DM Sans',sans-serif"); ctx.fillStyle=bodyColor;
        } else {
          ctx.fillText(part,x,y); x+=ctx.measureText(part).width;
        }
      });
    });
  }

  if (_watermark) {
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.08)";
    ctx.fillRect(60,H-38,W-120,1);
    ctx.font=ff("800 16px 'Syne',sans-serif");
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.20)";
    ctx.textBaseline="bottom";
    ctx.fillText("CENTRAL GROUP EVENTS",60,H-14);
  }
  drawPageNum(ctx,W,H,pageNum,totalPages,accent,isLight);
  drawDots(ctx,W,dots,totalDots,accent,isLight);
}

// === CTA RENDERER ===
function renderCTA(canvas, cfg) {
  const { ctaKicker, ctaDate, ctaVenue, ctaUrl, photo, accent, bgKey, dots, totalDots, opacity,
          targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5 } = cfg;
  const W = targetW, H = targetH; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  const bg = BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    let dx = (W/2) - (photo.width * focalX * s);
    let dy = (H/2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity||0.88})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack = bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:(isLight?0.06:0.10));
    if(!isLight){
      if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.40);
      else drawSpotlight(ctx,W,H,"229,188,79",0.30);
    }
  }

  const dateColor = isLight ? "#0a0a0a" : "#FFF";
  const venueColor = isLight ? "rgba(0,0,0,0.78)" : "rgba(255,255,255,0.88)";

  ctx.globalAlpha=1; ctx.textBaseline="top";

  // Kicker pill, top-center
  if (ctaKicker?.trim()) {
    const kt = ctaKicker.toUpperCase();
    ctx.font=ff("800 22px 'Syne',sans-serif"); ctx.letterSpacing="4px";
    const tw = ctx.measureText(kt).width;
    const padX=20, rectW=tw+padX*2, rectH=44;
    const rx = (W-rectW)/2, ry = 170;
    ctx.fillStyle=accent;
    ctx.beginPath(); ctx.roundRect(rx,ry,rectW,rectH,4); ctx.fill();
    ctx.fillStyle="#000"; ctx.textBaseline="middle"; ctx.textAlign="left";
    ctx.fillText(kt, rx+padX, ry+rectH/2);
    ctx.letterSpacing="0px"; ctx.textBaseline="top";
  }

  // Date — biggest text, centered (multi-line via \n)
  const dateLines = (ctaDate||"").split("\n").map(l=>l.trim()).filter(l=>l);
  let dfs = 84;
  const measureDate = (f) => {
    ctx.font=ff(`800 ${f}px 'Syne',sans-serif`);
    return dateLines.length ? Math.max(...dateLines.map(l => ctx.measureText(l.toUpperCase()).width)) : 0;
  };
  while (dateLines.length && measureDate(dfs) > W-120 && dfs > 44) { dfs -= 4; }
  ctx.font=ff(`800 ${dfs}px 'Syne',sans-serif`);
  ctx.fillStyle=dateColor; ctx.textAlign="center";
  const dlh = dfs*1.1;
  const dateY = 340;
  dateLines.forEach((ln,i) => ctx.fillText(ln.toUpperCase(), W/2, dateY+i*dlh));
  const dateBlockH = dateLines.length*dlh;

  // Divider
  const divY = dateY + dateBlockH + 36;
  ctx.fillStyle = `${accent}66`;
  ctx.fillRect(W/2-50, divY, 100, 3);

  // Venue
  const venueY = divY + 38;
  ctx.font=ff("700 38px 'DM Sans',sans-serif"); ctx.fillStyle=venueColor;
  // wrap venue if too long
  const venueText = ctaVenue || "";
  if (ctx.measureText(venueText).width > W-120) {
    // simple wrap
    const ws = venueText.split(/\s+/); const ln=[]; let cur="";
    for (const w of ws) {
      const t = cur ? cur+" "+w : w;
      if (ctx.measureText(t).width > W-120 && cur) { ln.push(cur); cur=w; } else cur=t;
    }
    if (cur) ln.push(cur);
    ln.forEach((l,i) => ctx.fillText(l, W/2, venueY + i*44));
  } else {
    ctx.fillText(venueText, W/2, venueY);
  }

  // URL — accent color
  const urlY = venueY + 64;
  ctx.font=ff("700 36px 'DM Sans',sans-serif"); ctx.fillStyle=accent;
  ctx.fillText(ctaUrl||"", W/2, urlY);

  ctx.textAlign="left";
  drawDots(ctx,W,dots,totalDots,accent,isLight);
  drawFooter(ctx,W,H,isLight);
}

// === PHOTO + CAPTION RENDERER ===
function renderPhotoCaption(canvas, cfg) {
  const { photo, caption, captionSecondary, alignment, accent, bgKey, dots, totalDots,
          targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5 } = cfg;
  const W = targetW, H = targetH; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    let dx = (W/2) - (photo.width * focalX * s);
    let dy = (H/2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
  } else {
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,isLight?"#000":"#FFF",isLight?0.06:0.05);
  }

  // Bottom gradient for legibility — only when there's a photo (gives white
  // text contrast). On solid bg in day mode, gradient would actively hurt.
  if (photo && (caption?.trim() || captionSecondary?.trim())) {
    const grd=ctx.createLinearGradient(0,H*0.50,0,H);
    grd.addColorStop(0,"transparent");
    grd.addColorStop(0.4,"rgba(0,0,0,0.55)");
    grd.addColorStop(1,"rgba(0,0,0,0.88)");
    ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
  }

  const captionColor = isLight ? "#0a0a0a" : "#FFF";

  ctx.globalAlpha=1; ctx.textBaseline="top";
  const align = alignment === "center" ? "center" : "left";
  const ax = align === "center" ? W/2 : 60;

  // Primary caption — auto-wraps + scales
  if (caption?.trim()) {
    const words = caption.split(/\s+/).filter(w=>w);
    let fs = 58;
    const wrap = (f) => {
      ctx.font=ff(`800 ${f}px 'Syne',sans-serif`);
      const r=[]; let bl="";
      for (const w of words) {
        const test=bl?bl+" "+w:w;
        if (ctx.measureText(test).width > W-120 && bl) { r.push(bl); bl=w; }
        else bl=test;
      }
      if (bl) r.push(bl);
      return r;
    };
    let lines = wrap(fs);
    while (lines.length > 3 && fs > 32) { fs -= 4; lines = wrap(fs); }
    const lh = fs*1.1;
    const totalH = lines.length*lh;
    const bottomMargin = captionSecondary?.trim() ? 130 : 90;
    const startY = H - bottomMargin - totalH;
    ctx.fillStyle=captionColor; ctx.textAlign=align;
    ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`);
    lines.forEach((ln,i)=>ctx.fillText(ln, ax, startY+i*lh));
  }

  // Secondary line — small, letterspaced, accent.
  // IG safe zone: was H-60; bumped to H-100 so it stays above the
  // bottom action chrome / caption overlay in IG's preview.
  if (captionSecondary?.trim()) {
    ctx.font=ff("700 22px 'DM Sans',sans-serif");
    ctx.fillStyle=accent; ctx.letterSpacing="3px"; ctx.textAlign=align; ctx.textBaseline="bottom";
    const secLines = wrapToLines(ctx, captionSecondary.toUpperCase(), W-160);
    const secLH = 28;
    secLines.forEach((ln,i)=>ctx.fillText(ln, ax, (H-100)-(secLines.length-1-i)*secLH));
    ctx.letterSpacing="0px"; ctx.textBaseline="top";
  }

  ctx.textAlign="left";
  drawLogo(ctx, accent, W, isLight);
  drawDots(ctx, W, dots, totalDots, accent, isLight);
  drawFooter(ctx, W, H, isLight);
}

// === SPOTLIGHT RENDERER (body slide for roundup carousels) ===
// One-venue-per-slide format inspired by Hoboken Girl roundup posts but with
// the transactional layer (day/time/price/CTA) editorial lifestyle accounts
// never include. Big headline-style venue name uppercase, address-style detail
// line, footer with day/time on the left and price + CTA in accent on the
// right. Slide counter top-right when the carousel has >1 slide.
// Ratio-aware. Pass targetW/targetH/focalX/focalY in cfg to render at
// 4:5 / 3:4 / 9:16 dimensions with the full design (photo + gradient
// + venue text + footer + logo + watermark) filling the target frame.
// Defaults to 1080×1080 + center focal for backward compat.
function renderSpotlight(canvas, cfg) {
  const { photo, spotName, spotNameHighlights, spotMeta, spotTime, spotPrice, spotCta, spotNumber, align = "left", band = false, accent, bgKey, dots, totalDots, targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5 } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Day mode applies only when there's no photo. With a photo, the dark
  // gradient at the bottom always carries the text — irrespective of bg
  // color choice — so text stays white-on-photo.
  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  // Background — photo full-bleed (focal-aware) or solid bg.
  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    let dx = (W / 2) - (photo.width * focalX * s);
    let dy = (H / 2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = bg.hex; ctx.fillRect(0, 0, W, H);
    drawTexture(ctx, W, H, isLight ? "#000" : "#FFF", isLight ? 0.06 : 0.05);
  }

  // Bottom gradient — only when we have a photo (the gradient is what makes
  // white text legible on photos). On solid bg no gradient is needed; on a
  // light bg one would actively hurt the day-mode aesthetic.
  if (photo) {
    const grd = ctx.createLinearGradient(0, H * 0.35, 0, H);
    grd.addColorStop(0, "transparent");
    grd.addColorStop(0.3, "rgba(0,0,0,0.55)");
    grd.addColorStop(1, "rgba(0,0,0,0.95)");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  }

  ctx.globalAlpha = 1;
  // px=110 keeps content inside IG's 4:5 cover-preview safe zone when
  // exporting at 1:1 (864×1080 centered crop = 108px per side).
  const px = 110;
  const isCenter = align === "center";

  // Optional solid band behind the venue-name + detail stack (legibility
  // over busy photos, @theaifield look). Pre-measure the venue name the same
  // way the renderer below does so the bar hugs the text instead of covering
  // the whole slide.
  if (band) {
    const hasFooterB = (spotTime && spotTime.trim()) || (spotPrice && spotPrice.trim()) || (spotCta && spotCta.trim());
    const hasMetaB = spotMeta && spotMeta.trim();
    const ybEst = (H - 110) - (hasFooterB ? 50 : 0) - (hasMetaB ? 44 : 0);
    let venueH = 0;
    if (spotName && spotName.trim()) {
      const ws = spotName.toUpperCase().split(/\s+/).filter(w => w);
      const nLinesAt = (f) => {
        ctx.font = ff(`900 ${f}px 'Syne',sans-serif`);
        const s2 = ctx.measureText(" ").width;
        let lines = 1, cw = 0, first = true;
        for (const wtxt of ws) {
          const ww = ctx.measureText(wtxt).width;
          if (!first && cw + s2 + ww > W - px * 2) { lines++; cw = ww; }
          else { cw += (first ? 0 : s2) + ww; first = false; }
        }
        return lines;
      };
      let fb = 92, nLines = nLinesAt(fb);
      while ((nLines > 4 || nLines * fb * 1.02 > H * 0.45) && fb > 46) { fb -= 4; nLines = nLinesAt(fb); }
      venueH = nLines * fb * 1.02;
    }
    const bandTop = Math.max(0, ybEst - venueH - 6 - 28);
    ctx.fillStyle = "rgba(0,0,0,0.90)";
    ctx.fillRect(0, bandTop, W, H - bandTop);
  }

  // Text colors flip in day mode (no photo + light bg).
  const headlineColor = isLight ? "#0a0a0a" : "#FFF";
  const detailColor   = isLight ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.78)";
  const footerLeftColor = isLight ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)";
  const counterColor  = isLight ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.9)";

  // Layout from bottom up: footer (time/price/cta), detail line, venue name.
  // IG safe zone: FOOTER_BOTTOM was 60; bumped to 110 so the time/price
  // line stays above the bottom action chrome / caption overlay in IG's
  // preview. Detail line + venue name stack relative to yBottom so they
  // move up with it — no separate adjustment needed.
  const FOOTER_BOTTOM = 110;
  let yBottom = H - FOOTER_BOTTOM;

  // FOOTER row — day/time on left, price · cta on right.
  const hasFooter = (spotTime && spotTime.trim()) || (spotPrice && spotPrice.trim()) || (spotCta && spotCta.trim());
  if (hasFooter) {
    ctx.font = ff("700 30px 'DM Sans',sans-serif");
    ctx.textBaseline = "bottom";

    if (spotTime && spotTime.trim()) {
      ctx.fillStyle = footerLeftColor;
      ctx.textAlign = "left";
      ctx.fillText(spotTime.toUpperCase(), px, yBottom);
    }
    const rightParts = [spotPrice, spotCta].map(s => (s || "").trim()).filter(Boolean);
    if (rightParts.length) {
      ctx.fillStyle = accent;
      ctx.textAlign = "right";
      ctx.fillText(rightParts.join("  ·  "), W - px, yBottom);
    }
    yBottom -= 50;
  }

  // DETAIL line — address-style. Wraps to the safe width instead of running
  // off the edge; because the stack builds bottom-up, extra lines go ABOVE
  // yBottom and we push yBottom up by the added height so the venue name
  // above doesn't overlap.
  if (spotMeta && spotMeta.trim()) {
    ctx.font = ff("600 26px 'DM Sans',sans-serif");
    ctx.fillStyle = detailColor;
    ctx.textBaseline = "bottom";
    ctx.textAlign = isCenter ? "center" : "left";
    const metaLines = wrapToLines(ctx, spotMeta, W - px * 2);
    const metaLH = 34;
    metaLines.forEach((ln, i) => {
      const y = yBottom - (metaLines.length - 1 - i) * metaLH;
      ctx.fillText(ln, isCenter ? W / 2 : px, y);
    });
    ctx.textAlign = "left";
    yBottom -= 44 + (metaLines.length - 1) * metaLH;
  }

  // NUMBERED BADGE — optional Feature Drop / listicle treatment. Drawn
  // before the venue name so the text stack reads: badge → venue name →
  // meta → footer. Off by default; turns on when spotNumber is set in
  // the form. Disc + inverse number, day-mode aware.
  if (spotNumber != null && String(spotNumber).trim()) {
    const numStr = String(spotNumber).trim();
    const cx = W / 2;
    const cy = Math.round(H * 0.30);
    const r = 38;
    const discFill = isLight ? "#0a0a0a" : "#FFFFFF";
    const numFill  = isLight ? "#FFFFFF" : "#0a0a0a";
    ctx.fillStyle = discFill;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = numFill;
    ctx.font = ff(`800 ${numStr.length === 1 ? 36 : 28}px 'Syne',sans-serif`);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(numStr, cx, cy + 2);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
  }

  // VENUE NAME — big bold uppercase, wraps if long, scales down to fit.
  // VENUE NAME — big bold uppercase, wraps + scales. Now supports per-word
  // highlighting via spotNameHighlights (Set of word indices) — same
  // pattern Cover uses for its headline. Highlighted words render in the
  // accent color, untouched words use the default headlineColor (which
  // is already day-mode aware).
  if (spotName && spotName.trim()) {
    const words = spotName.toUpperCase().split(/\s+/).filter(w => w);
    let fs = 92;
    // wrap returns lines as ARRAYS of word objects {text, idx, width}
    // so the per-word renderer can pick a color per word at draw time.
    const wrap = (f) => {
      ctx.font = ff(`900 ${f}px 'Syne',sans-serif`);
      const sw = ctx.measureText(" ").width;
      const r = []; let cur = []; let curW = 0;
      for (let i = 0; i < words.length; i++) {
        const wtxt = words[i];
        const ww = ctx.measureText(wtxt).width;
        if (cur.length > 0 && curW + sw + ww > W - px * 2) {
          r.push(cur);
          cur = [{ text: wtxt, idx: i, width: ww }];
          curW = ww;
        } else {
          curW += (cur.length > 0 ? sw : 0) + ww;
          cur.push({ text: wtxt, idx: i, width: ww });
        }
      }
      if (cur.length) r.push(cur);
      return r;
    };
    let lines = wrap(fs);
    while ((lines.length > 4 || lines.length * fs * 1.02 > H * 0.45) && fs > 46) {
      fs -= 4; lines = wrap(fs);
    }
    const lh = fs * 1.02;
    const totalH = lines.length * lh;
    const startY = yBottom - totalH - 6;
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const sw = ctx.measureText(" ").width;
    const hl = spotNameHighlights instanceof Set ? spotNameHighlights : new Set();
    lines.forEach((lw, li) => {
      const lineW = lw.reduce((a, w) => a + w.width, 0) + sw * Math.max(0, lw.length - 1);
      let x = isCenter ? (W - lineW) / 2 : px;
      const y = startY + li * lh;
      lw.forEach(w => {
        ctx.fillStyle = hl.has(w.idx) ? accent : headlineColor;
        ctx.fillText(w.text, x, y);
        x += w.width + sw;
      });
    });
  }

  // Slide counter — top-right corner. Only visible when this is part of a
  // multi-slide carousel; otherwise it'd just read "1/1" and clutter.
  if (totalDots > 1) {
    ctx.font = ff("700 26px 'DM Sans',sans-serif");
    ctx.fillStyle = counterColor;
    ctx.textBaseline = "top";
    ctx.textAlign = "right";
    ctx.fillText(`${dots} / ${totalDots}`, W - px, 60);
  }

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawLogo(ctx, accent, W, isLight);
  drawFooter(ctx, W, H, isLight);
}

// === COUNTDOWN RENDERER ===
// Big-number anticipation card. "3 WEEKS", "TOMORROW", "TONIGHT" dominates
// the top half; event name + when/where below; CTA in footer. Designed to
// run as a series (T-21, T-7, T-3, T-1, T-0) leading up to a single event.
// Built for high-anticipation moments: World Cup, NBA Finals, app launches,
// venue openings — the kind of thing where the AUDIENCE wants the
// countdown to be a recurring reminder, not a one-shot announcement.
function renderCountdown(canvas, cfg) {
  const {
    photo, countText, countEvent, countWhen, countCta,
    accent, bgKey, dots, totalDots, opacity,
    targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5,
  } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Day mode only kicks in when there's no photo (photo always carries
  // a dark overlay → keeps white-text register).
  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  // Background — photo + dark overlay OR solid bg + spotlight.
  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    let dx = (W / 2) - (photo.width * focalX * s);
    let dy = (H / 2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle = `rgba(0,0,0,${opacity || 0.78})`;
    ctx.fillRect(0, 0, W, H);
    drawTexture(ctx, W, H, "#FFF", 0.04);
  } else {
    ctx.fillStyle = bg.hex; ctx.fillRect(0, 0, W, H);
    const isBlack = bgKey === "black";
    drawTexture(ctx, W, H, isBlack ? "#FACC15" : "#000", isBlack ? 0.05 : (isLight ? 0.06 : 0.10));
    if (!isLight) {
      if (!isBlack) drawSpotlight(ctx, W, H, "255,255,255", 0.40);
      else drawSpotlight(ctx, W, H, "229,188,79", 0.30);
    }
  }

  ctx.globalAlpha = 1;
  ctx.textBaseline = "middle";

  const eventColor = isLight ? "#0a0a0a" : "#FFF";
  const whenColor  = isLight ? "rgba(0,0,0,0.75)" : "rgba(255,255,255,0.88)";

  // COUNTDOWN — the headline. Massive, accent-colored, auto-scaling so
  // "TOMORROW" and "3 WEEKS OUT" both look intentional rather than fighting
  // the canvas dimensions.
  const ct = (countText || "").trim().toUpperCase();
  if (ct) {
    let fs = 260;
    const fitWidth = W - 80;
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    while (ctx.measureText(ct).width > fitWidth && fs > 90) {
      fs -= 8; ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.fillText(ct, W / 2, H * 0.36);
  }

  // EVENT NAME — big bold, wraps + scales.
  const ev = (countEvent || "").trim();
  if (ev) {
    const words = ev.toUpperCase().split(/\s+/).filter(w => w);
    let fs = 64;
    // px=110 keeps content inside IG's 4:5 cover-preview safe zone.
    const px = 110, maxW = W - px * 2;
    const wrap = (f) => {
      ctx.font = ff(`800 ${f}px 'Syne',sans-serif`);
      const r = []; let bl = "";
      for (const w of words) {
        const t = bl ? bl + " " + w : w;
        if (ctx.measureText(t).width > maxW && bl) { r.push(bl); bl = w; }
        else bl = t;
      }
      if (bl) r.push(bl);
      return r;
    };
    let lines = wrap(fs);
    while (lines.length > 2 && fs > 36) { fs -= 4; lines = wrap(fs); }
    ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    ctx.fillStyle = eventColor;
    ctx.textAlign = "center";
    const lh = fs * 1.05;
    const startY = H * 0.62 - (lines.length - 1) * lh / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, startY + i * lh));
  }

  // Accent divider
  const divY = H * 0.74;
  ctx.fillStyle = `${accent}88`;
  ctx.fillRect(W / 2 - 50, divY, 100, 3);

  // WHEN / WHERE line
  const wn = (countWhen || "").trim();
  if (wn) {
    ctx.font = ff("700 32px 'DM Sans',sans-serif");
    ctx.fillStyle = whenColor;
    ctx.textAlign = "center";
    ctx.fillText(wn, W / 2, divY + 40);
  }

  // CTA — accent color, smaller
  const cta = (countCta || "").trim();
  if (cta) {
    ctx.font = ff("700 28px 'DM Sans',sans-serif");
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.fillText(cta, W / 2, divY + 90);
  }

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawLogo(ctx, accent, W, isLight);
  drawDots(ctx, W, dots, totalDots, accent, isLight);
  drawFooter(ctx, W, H, isLight);
}

// === SAVE THE DATE (single) ===
// Hero announcement for ONE upcoming event. Layout: "SAVE THE DATE" pill
// kicker, day-of-week, MASSIVE date in accent color, event name, venue
// + time, CTA. Differs from Countdown by leading with the actual date
// (not a "T-minus" number) — meant for the formal announcement, not the
// urgency ramp. Photo background optional.
// Ratio-aware (Cover/Spotlight pattern). targetW/targetH/focalX/focalY
// in cfg drive non-1:1 exports; defaults preserve square render.
function renderSaveDate(canvas, cfg) {
  const {
    photo, saveKicker, saveDay, saveDateBig, saveEvent, saveVenue, saveCta,
    accent, bgKey, dots, totalDots, opacity,
    targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5,
  } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    let dx = (W / 2) - (photo.width * focalX * s);
    let dy = (H / 2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle = `rgba(0,0,0,${opacity || 0.80})`;
    ctx.fillRect(0, 0, W, H);
    drawTexture(ctx, W, H, "#FFF", 0.04);
  } else {
    ctx.fillStyle = bg.hex; ctx.fillRect(0, 0, W, H);
    const isBlack = bgKey === "black";
    drawTexture(ctx, W, H, isBlack ? "#FACC15" : "#000", isBlack ? 0.05 : (isLight ? 0.06 : 0.10));
    if (!isLight) {
      if (!isBlack) drawSpotlight(ctx, W, H, "255,255,255", 0.40);
      else drawSpotlight(ctx, W, H, "229,188,79", 0.30);
    }
  }

  const eventColor = isLight ? "#0a0a0a" : "#FFF";
  const venueColor = isLight ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.85)";
  const dayColor   = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.65)";

  ctx.globalAlpha = 1;
  ctx.textBaseline = "top";

  // KICKER PILL — "SAVE THE DATE" in accent-bg pill at top.
  if (saveKicker?.trim()) {
    const kt = saveKicker.toUpperCase();
    ctx.font = ff("800 22px 'Syne',sans-serif"); ctx.letterSpacing = "4px";
    const tw = ctx.measureText(kt).width;
    const padX = 22, rectW = tw + padX * 2, rectH = 46;
    const rx = (W - rectW) / 2, ry = 140;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(rx, ry, rectW, rectH, 4); ctx.fill();
    ctx.fillStyle = "#000"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillText(kt, rx + padX, ry + rectH / 2);
    ctx.letterSpacing = "0px"; ctx.textBaseline = "top";
  }

  // DAY OF WEEK — small caps, subtle.
  if (saveDay?.trim()) {
    ctx.font = ff("700 30px 'DM Sans',sans-serif"); ctx.letterSpacing = "5px";
    ctx.fillStyle = dayColor; ctx.textAlign = "center";
    ctx.fillText(saveDay.toUpperCase(), W / 2, 240);
    ctx.letterSpacing = "0px";
  }

  // BIG DATE — accent-colored, massive Syne, auto-scaling.
  if (saveDateBig?.trim()) {
    const dt = saveDateBig.toUpperCase();
    let fs = 220;
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    while (ctx.measureText(dt).width > W - 80 && fs > 80) {
      fs -= 8; ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = accent; ctx.textAlign = "center";
    ctx.fillText(dt, W / 2, 310);
  }

  // Divider
  const divY = 560;
  ctx.fillStyle = `${accent}88`;
  ctx.fillRect(W / 2 - 50, divY, 100, 3);

  // EVENT NAME — bold uppercase, wraps + scales.
  if (saveEvent?.trim()) {
    const words = saveEvent.toUpperCase().split(/\s+/).filter(w => w);
    let fs = 64;
    // px=110 keeps content inside IG's 4:5 cover-preview safe zone.
    const px = 110, maxW = W - px * 2;
    const wrap = (f) => {
      ctx.font = ff(`800 ${f}px 'Syne',sans-serif`);
      const r = []; let bl = "";
      for (const w of words) {
        const t = bl ? bl + " " + w : w;
        if (ctx.measureText(t).width > maxW && bl) { r.push(bl); bl = w; }
        else bl = t;
      }
      if (bl) r.push(bl);
      return r;
    };
    let lines = wrap(fs);
    while (lines.length > 2 && fs > 36) { fs -= 4; lines = wrap(fs); }
    ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    ctx.fillStyle = eventColor;
    ctx.textAlign = "center";
    const lh = fs * 1.05;
    const startY = divY + 30;
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, startY + i * lh));
  }

  // VENUE + TIME
  if (saveVenue?.trim()) {
    ctx.font = ff("600 28px 'DM Sans',sans-serif");
    ctx.fillStyle = venueColor; ctx.textAlign = "center";
    wrapToLines(ctx, saveVenue, W - 160).forEach((ln, i) => ctx.fillText(ln, W / 2, 800 + i * 36));
  }

  // CTA
  if (saveCta?.trim()) {
    ctx.font = ff("700 28px 'DM Sans',sans-serif");
    ctx.fillStyle = accent; ctx.textAlign = "center";
    ctx.fillText(saveCta, W / 2, 860);
  }

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawLogo(ctx, accent, W, isLight);
  drawDots(ctx, W, dots, totalDots, accent, isLight);
  drawFooter(ctx, W, H, isLight);
}

// === SAVE THE DATES (multi) ===
// Grid of 2-4 upcoming events on one slide. For announcing a series
// (summer lineup, weekend takeover, 3-day festival, etc.) without
// dedicating a full carousel. Each card carries date / day / event /
// venue. Auto-arranges 2 in column, 3 in column, 4 in 2x2 grid.
function renderSaveDates(canvas, cfg) {
  const {
    photo, savesHeader, savesItems, savesCta,
    accent, bgKey, dots, totalDots, opacity,
    targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5,
  } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    let dx = (W / 2) - (photo.width * focalX * s);
    let dy = (H / 2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle = `rgba(0,0,0,${opacity || 0.85})`;
    ctx.fillRect(0, 0, W, H);
    drawTexture(ctx, W, H, "#FFF", 0.03);
  } else {
    ctx.fillStyle = bg.hex; ctx.fillRect(0, 0, W, H);
    const isBlack = bgKey === "black";
    drawTexture(ctx, W, H, isBlack ? "#FACC15" : "#000", isBlack ? 0.05 : (isLight ? 0.06 : 0.10));
    if (!isLight && !isBlack) drawSpotlight(ctx, W, H, "255,255,255", 0.35);
    else if (!isLight) drawSpotlight(ctx, W, H, "229,188,79", 0.30);
  }

  ctx.globalAlpha = 1; ctx.textBaseline = "top";

  const headerColor = isLight ? "#0a0a0a" : "#FFF";
  const cardFill = isLight ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)";
  const cardEventColor = isLight ? "#0a0a0a" : "#FFF";
  const cardVenueColor = isLight ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.65)";
  const cardDayColor = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";

  // HEADER — top of slide.
  let headerBottom = 120;
  if (savesHeader?.trim()) {
    let fs = 60;
    const t = savesHeader.toUpperCase();
    ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`); ctx.letterSpacing = "3px";
    while (ctx.measureText(t).width > W - 120 && fs > 32) {
      fs -= 4; ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = headerColor; ctx.textAlign = "center";
    ctx.fillText(t, W / 2, 100);
    ctx.letterSpacing = "0px";
    const barY = 100 + fs + 16;
    ctx.fillStyle = accent; ctx.fillRect(W / 2 - 30, barY, 60, 4);
    headerBottom = barY + 20;
  }

  // CARDS — auto-layout: 2 items = stacked rows, 3 = 3 rows, 4 = 2x2.
  const items = (savesItems || []).slice(0, 4);
  const count = items.length;
  if (count === 0) {
    drawLogo(ctx, accent, W, isLight);
    drawDots(ctx, W, dots, totalDots, accent, isLight);
    drawFooter(ctx, W, H, isLight);
    return;
  }

  // px=110 keeps content inside IG's 4:5 cover-preview safe zone when
  // exporting at 1:1 (864×1080 centered crop = 108px per side).
  const px = 110;
  // IG safe zone: CTA now sits at H-130 (was H-70), so reserve more room
  // above the grid to push the grid up correspondingly. Without-CTA gap
  // stays smaller since there's nothing to clear.
  const ctaSpace = savesCta?.trim() ? 170 : 110;
  const gridTop = headerBottom + 40;
  const gridBottom = H - ctaSpace;
  const gridH = gridBottom - gridTop;

  // Layout selection
  let cols, rows;
  if (count === 4) { cols = 2; rows = 2; }
  else { cols = 1; rows = count; }

  const gap = 24;
  const cw = (W - px * 2 - (cols - 1) * gap) / cols;
  const ch = (gridH - (rows - 1) * gap) / rows;

  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = px + col * (cw + gap);
    const y = gridTop + row * (ch + gap);

    // Card bg
    ctx.fillStyle = cardFill;
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 14); ctx.fill();

    // Left accent stripe
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(x, y, 6, ch, [14, 0, 0, 14]); ctx.fill();

    const innerPx = 28;
    const innerX = x + innerPx + 6;
    const innerW = cw - innerPx * 2 - 6;

    // Layout inside card: date (left or top) + event/venue (right or bottom).
    if (cols === 2) {
      // 2x2: vertical card layout
      // DATE block
      if (item.date?.trim()) {
        ctx.font = ff("900 56px 'Syne',sans-serif"); ctx.fillStyle = accent;
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(item.date.toUpperCase(), innerX, y + 28);
      }
      // DAY
      if (item.day?.trim()) {
        ctx.font = ff("700 18px 'DM Sans',sans-serif"); ctx.fillStyle = cardDayColor;
        ctx.letterSpacing = "2px"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(item.day.toUpperCase(), innerX, y + 100);
        ctx.letterSpacing = "0px";
      }
      // EVENT — wraps
      if (item.name?.trim()) {
        let fs = 28;
        const words = item.name.toUpperCase().split(/\s+/).filter(w => w);
        const wrap = (f) => {
          ctx.font = ff(`800 ${f}px 'Syne',sans-serif`);
          const r = []; let bl = "";
          for (const w of words) {
            const t = bl ? bl + " " + w : w;
            if (ctx.measureText(t).width > innerW && bl) { r.push(bl); bl = w; }
            else bl = t;
          }
          if (bl) r.push(bl);
          return r;
        };
        let lines = wrap(fs);
        while (lines.length > 3 && fs > 18) { fs -= 2; lines = wrap(fs); }
        ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`); ctx.fillStyle = cardEventColor;
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        const lh = fs * 1.1;
        lines.forEach((ln, j) => ctx.fillText(ln, innerX, y + 140 + j * lh));
      }
      // VENUE — small
      if (item.venue?.trim()) {
        ctx.font = ff("400 20px 'DM Sans',sans-serif"); ctx.fillStyle = cardVenueColor;
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(item.venue, innerX, y + ch - 50);
      }
    } else {
      // Stacked single column: horizontal card layout (date left, info right)
      // DATE
      if (item.date?.trim()) {
        let fs = 72;
        ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
        while (ctx.measureText(item.date.toUpperCase()).width > cw * 0.35 && fs > 36) {
          fs -= 4; ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
        }
        ctx.fillStyle = accent;
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(item.date.toUpperCase(), innerX, y + ch / 2 - 22);

        if (item.day?.trim()) {
          ctx.font = ff("700 18px 'DM Sans',sans-serif");
          ctx.fillStyle = cardDayColor; ctx.letterSpacing = "3px";
          ctx.fillText(item.day.toUpperCase(), innerX, y + ch / 2 + 22);
          ctx.letterSpacing = "0px";
        }
      }
      // Divider between date + info
      const dividerX = x + cw * 0.40;
      ctx.fillStyle = isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)";
      ctx.fillRect(dividerX, y + 24, 1, ch - 48);

      // EVENT NAME + VENUE
      const infoX = dividerX + 30;
      const infoW = cw - (dividerX - x) - 50;
      if (item.name?.trim()) {
        let fs = 34;
        const words = item.name.toUpperCase().split(/\s+/).filter(w => w);
        const wrap = (f) => {
          ctx.font = ff(`800 ${f}px 'Syne',sans-serif`);
          const r = []; let bl = "";
          for (const w of words) {
            const t = bl ? bl + " " + w : w;
            if (ctx.measureText(t).width > infoW && bl) { r.push(bl); bl = w; }
            else bl = t;
          }
          if (bl) r.push(bl);
          return r;
        };
        let lines = wrap(fs);
        while (lines.length > 2 && fs > 22) { fs -= 2; lines = wrap(fs); }
        ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`); ctx.fillStyle = cardEventColor;
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        const lh = fs * 1.1;
        const totalH = lines.length * lh;
        const startY = y + ch / 2 - totalH / 2 - 18;
        lines.forEach((ln, j) => ctx.fillText(ln, infoX, startY + j * lh));
      }
      if (item.venue?.trim()) {
        ctx.font = ff("400 22px 'DM Sans',sans-serif"); ctx.fillStyle = cardVenueColor;
        ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(item.venue, infoX, y + ch - 24);
      }
    }
  });

  // CTA at bottom. IG safe zone: was H-70, bumped to H-130.
  if (savesCta?.trim()) {
    ctx.font = ff("700 30px 'DM Sans',sans-serif");
    ctx.fillStyle = accent; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(savesCta, W / 2, H - 130);
  }

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawLogo(ctx, accent, W, isLight);
  drawDots(ctx, W, dots, totalDots, accent, isLight);
  drawFooter(ctx, W, H, isLight);
}

// === SCENE COMPOSER ===
// The "automated flyer" template — slot-based composition modeled on the
// hand-designed party flyer style (background + hero cutout + side
// cutouts + big-text-behind layer + corner meta blocks + bottom info bar).
// Content-agnostic: cutouts can be players, drink bottles, dishes, books,
// flags, mascots — anything. Layout stays fixed, content varies. The
// distinctive "big text behind people" look is achieved by drawing the
// bigText BEFORE the cutouts so the cutouts visually occlude part of it
// (the viewer's brain fills in the gap).
//
// Required for that "designed by hand" look:
//   - All cutouts should be transparent-bg PNGs (use Photoroom / remove.bg)
//   - Halftone toggle adds a grain overlay that ties disparate sources
//     together into a unified visual treatment
function applyGrain(ctx, W, H, strength = 0.18) {
  // Generate a 256×256 noise tile and pattern-fill the whole canvas with
  // it in "overlay" composite. Cheap, repeatable, gives a halftone/grain
  // feel without expensive per-pixel processing.
  const tileSize = 256;
  const tile = document.createElement("canvas");
  tile.width = tileSize; tile.height = tileSize;
  const tctx = tile.getContext("2d");
  const id = tctx.createImageData(tileSize, tileSize);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.floor(Math.random() * 255);
    id.data[i] = v; id.data[i+1] = v; id.data[i+2] = v; id.data[i+3] = 60;
  }
  tctx.putImageData(id, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = strength;
  const pattern = ctx.createPattern(tile, "repeat");
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Ratio-aware (Cover pattern). targetW/targetH/focalX/focalY drive the
// bg photo for non-1:1 exports. Cutout positions (hero/left/right) use
// W/H relatively so they reflow with taller frames; text positions are
// mostly mid/bottom-anchored so they scale with H. Defaults preserve
// the square render.
function renderScene(canvas, cfg) {
  const {
    bgPhoto, sceneHero, sceneLeft, sceneRight,
    sceneTopLabel, sceneTitle, sceneBigText, sceneLeftMeta, sceneRightMeta,
    sceneInfo, sceneAddress,
    sceneHalftone, sceneHeroScale, sceneSideScale,
    accent, bgKey, dots, totalDots,
    targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5,
  } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 1. BACKGROUND (photo focal-aware, OR solid color)
  if (bgPhoto) {
    const s = Math.max(W / bgPhoto.width, H / bgPhoto.height);
    const dw = bgPhoto.width * s, dh = bgPhoto.height * s;
    let dx = (W / 2) - (bgPhoto.width * focalX * s);
    let dy = (H / 2) - (bgPhoto.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(bgPhoto, dx, dy, dw, dh);
  } else {
    const bg = BG_COLORS[bgKey] || BG_COLORS.black;
    ctx.fillStyle = bg.hex;
    ctx.fillRect(0, 0, W, H);
  }

  // Dark wash for text legibility — heavier than other templates because
  // the design lives or dies on the big text reading clearly through the
  // halftone + cutouts.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);

  // 2. HALFTONE / GRAIN OVERLAY (the "ties everything together" filter)
  if (sceneHalftone) applyGrain(ctx, W, H, 0.22);

  ctx.globalAlpha = 1;

  // 3. TOP LABEL — small, letterspaced, top-center
  if (sceneTopLabel?.trim()) {
    ctx.font = ff("700 22px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.letterSpacing = "10px";
    ctx.fillText(sceneTopLabel.toUpperCase(), W / 2, 24);
    ctx.letterSpacing = "0px";
  }

  // 4. TITLE — front layer, top half, huge.
  if (sceneTitle?.trim()) {
    const t = sceneTitle.toUpperCase();
    let fs = 130;
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    while (ctx.measureText(t).width > W - 40 && fs > 50) {
      fs -= 6; ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(t, W / 2, 60);
  }

  // 5. BIG TEXT — back layer (drawn BEFORE cutouts so they occlude it).
  // This is the distinctive "designed by hand" move: text peeks out
  // around the cutouts. Multi-line via \n.
  if (sceneBigText?.trim()) {
    const lines = sceneBigText.split("\n").map(l => l.trim().toUpperCase()).filter(Boolean);
    let fs = 150;
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    const widest = () => Math.max(...lines.map(l => ctx.measureText(l).width));
    while (widest() > W - 20 && fs > 60) {
      fs -= 6; ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lh = fs * 0.92;
    // Anchor the BOTTOM of the big-text block at H*0.78 so the block
    // stays a consistent ~108px above the info line at H-130 regardless
    // of line count. Old formula centered the block around H*0.78, which
    // meant a 2-line block extended down to ~H-100 and overlapped the
    // info line. Now 1, 2, or 3 lines all bottom-out at H*0.78.
    const blockBottom = H * 0.78;
    const startY = blockBottom - (lines.length - 0.5) * lh;
    lines.forEach((ln, i) => ctx.fillText(ln, W / 2, startY + i * lh));
  }

  // 6. SIDE CUTOUTS — left + right, mid-height, bleeding past the edges
  // so they feel layered into the scene rather than centered inside a card.
  const sideS = sceneSideScale || 0.55;
  const drawSide = (img, isRight) => {
    if (!img) return;
    const targetH = H * sideS;
    const s = targetH / img.height;
    const dw = img.width * s, dh = img.height * s;
    const y = H * 0.32;
    const x = isRight ? (W - dw * 0.92) : (-dw * 0.08);
    ctx.drawImage(img, x, y, dw, dh);
  };
  drawSide(sceneLeft, false);
  drawSide(sceneRight, true);

  // 7. HERO CENTER CUTOUT — drawn LAST, on top of everything.
  if (sceneHero) {
    const heroS = sceneHeroScale || 0.72;
    const targetH = H * heroS;
    const s = targetH / sceneHero.height;
    const dw = sceneHero.width * s, dh = sceneHero.height * s;
    ctx.drawImage(sceneHero, (W - dw) / 2, H * 0.22, dw, dh);
  }

  // 8. META BLOCKS — left + right under the title
  ctx.textBaseline = "top";
  // Meta blocks: x=110 / W-110 keeps them inside IG's 4:5 cover-preview
  // safe zone (was 32 / W-32 which got cropped on horizontal preview).
  if (sceneLeftMeta?.trim()) {
    ctx.font = ff("800 20px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF"; ctx.textAlign = "left";
    sceneLeftMeta.split("\n").forEach((ln, i) => ctx.fillText(ln.toUpperCase(), 110, 220 + i * 26));
  }
  if (sceneRightMeta?.trim()) {
    ctx.font = ff("800 20px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF"; ctx.textAlign = "right";
    sceneRightMeta.split("\n").forEach((ln, i) => ctx.fillText(ln.toUpperCase(), W - 110, 220 + i * 26));
  }

  // 9. BOTTOM INFO BAR — info line + address.
  // IG safe zone: info was at H-56, address at H-24 — both got nibbled
  // by Instagram's bottom chrome. Pushed to H-130 / H-90 so they sit
  // inside the safe area. Accent edge bar (next) still hugs the bottom
  // since it's decorative chrome and partial cropping is harmless.
  if (sceneInfo?.trim()) {
    let fs = 30;
    ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    while (ctx.measureText(sceneInfo.toUpperCase()).width > W - 60 && fs > 16) {
      fs -= 2; ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(sceneInfo.toUpperCase(), W / 2, H - 130);
  }
  if (sceneAddress?.trim()) {
    ctx.font = ff("700 20px 'DM Sans',sans-serif");
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(sceneAddress.toUpperCase(), W / 2, H - 90);
  }

  // 10. ACCENT EDGE BAR
  ctx.fillStyle = accent;
  ctx.fillRect(0, H - 6, W, 6);

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawDots(ctx, W, dots, totalDots, accent);
  // No drawLogo / drawFooter — the composition includes its own brand cues.
}

// === POSTER ===
// Magazine-style flyer: photo background, mono-caps top line for venue
// context, italic + caps host stack, small italic kicker, MASSIVE
// multi-line stacked title in a punchy color (default hot pink), italic
// subtitle, two-column offerings list at the bottom, italic dress code
// line, mono date line, accent edge bar.
//
// Distinct from Cover (gradient-overlay photo + single headline) and
// Scene (cutout slot composer). This one is about a single big title
// over a real photo background — same energy as the Pilates on the
// Pier flyer / typical wellness or party poster.
//
// Title controls are first-class: size (0.5–2.0×), X/Y position offset
// from natural anchor (±300px), L/C/R alignment, color override. Lets
// the user push the title around the canvas to dodge a tall building
// in the background photo, or align flush-left for a magazine cover
// feel without redesigning the whole template.
function renderPoster(canvas, cfg) {
  const {
    photo, opacity,
    topLine, hosts, kicker, title, subtitle,
    leftList, rightList, dressCode, dateLine,
    titleSize, titleX, titleY, titleAlign, titleColor,
    accent, bgKey, dots, totalDots,
    targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5,
  } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 1. BACKGROUND — photo cover-fit + light wash, or solid bg color fallback
  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    let dx = (W / 2) - (photo.width * focalX * s);
    let dy = (H / 2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    // Light overall wash — keep the photo readable but not crushed. The
    // user can crank this up via the opacity slider for a darker mood.
    ctx.fillStyle = `rgba(0,0,0,${opacity != null ? opacity : 0.15})`;
    ctx.fillRect(0, 0, W, H);
  } else {
    const bg = BG_COLORS[bgKey] || BG_COLORS.black;
    ctx.fillStyle = bg.hex;
    ctx.fillRect(0, 0, W, H);
  }

  const monoStack = "ui-monospace, Menlo, 'Courier New', monospace";

  // 2. TOP LINE — mono caps, letterspaced, centered at very top
  if (topLine?.trim()) {
    ctx.font = `700 22px ${monoStack}`;
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.letterSpacing = "4px";
    ctx.fillText(topLine.toUpperCase(), W / 2, 44);
    ctx.letterSpacing = "0px";
  }

  // 3. HOSTS — accent-colored stack. First line italic (e.g. "jela &"),
  // remaining lines treated as caps headers (e.g. "LIVE HIGHER").
  let hostsBottomY = 100;
  if (hosts?.trim()) {
    const lines = hosts.split("\n").map(l => l.trim()).filter(Boolean);
    ctx.fillStyle = accent;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    let y = 100;
    lines.forEach((ln, i) => {
      if (i === 0) {
        // Italic first line — sponsor / "&" style
        ctx.font = ff("italic 700 30px 'DM Sans',sans-serif");
        ctx.fillText(ln, W / 2, y);
        y += 38;
      } else {
        ctx.font = ff("800 30px 'DM Sans',sans-serif");
        ctx.fillText(ln.toUpperCase(), W / 2, y);
        y += 38;
      }
    });
    hostsBottomY = y;
  }

  // 4. KICKER — small italic, sub-heading positioned above the title.
  // Sits offset to the left and slightly above the title block (like
  // "wellness morning edition" on the Pilates flyer).
  if (kicker?.trim()) {
    ctx.font = ff("italic 700 22px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    // x=110 keeps kicker inside IG's 4:5 cover-preview safe zone (was 80).
    ctx.fillText(kicker.toLowerCase(), 110, Math.max(hostsBottomY + 14, 200));
  }

  // 5. TITLE — massive stacked headline. THE focal point. All the user's
  // controls apply here: size multiplier, X/Y offset, alignment, color.
  if (title?.trim()) {
    const lines = title.split("\n").map(l => l.trim()).filter(Boolean);
    const sizeMult = (typeof titleSize === "number" && titleSize > 0) ? titleSize : 1.0;
    let fs = 170 * sizeMult;
    // margin=110 keeps the title inside IG's 4:5 cover-preview safe zone
    // (was 40, very edge-aggressive). Title still scales DOWN to fit.
    const margin = 110;

    // Auto-scale DOWN if any line overflows width — the size slider is
    // a multiplier, not a force. Keeps the user from accidentally
    // cropping their own title.
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    const widest = () => Math.max(...lines.map(l => ctx.measureText(l.toUpperCase()).width));
    while (widest() > W - margin * 2 && fs > 40) {
      fs -= 4;
      ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    }

    const lh = fs * 0.92;
    const totalH = lines.length * lh;

    const align = titleAlign || "center";
    ctx.textAlign = align;
    ctx.textBaseline = "top";

    // X anchor based on alignment + user offset
    const dx = typeof titleX === "number" ? titleX : 0;
    let xAnchor;
    if (align === "left")       xAnchor = margin + dx;
    else if (align === "right") xAnchor = W - margin + dx;
    else                        xAnchor = W / 2 + dx;

    // Y anchor — centered vertically by default, user offset on top
    const dy = typeof titleY === "number" ? titleY : 0;
    const yAnchor = (H - totalH) / 2 + dy;

    // Soft drop shadow gives the title a slight lifted feel against the
    // photo bg — same depth move as the Pilates flyer's pink letters.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = titleColor || "#FF7AE5";
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    lines.forEach((ln, i) => {
      ctx.fillText(ln.toUpperCase(), xAnchor, yAnchor + i * lh);
    });
    ctx.restore();
  }

  // 6. SUBTITLE — italic, small, centered below title
  if (subtitle?.trim()) {
    ctx.font = ff("italic 600 28px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    // Position relative to the title's center-ish — slightly below the
    // notional title block (uses titleY so the subtitle moves with it).
    const sy = H * 0.66 + (typeof titleY === "number" ? titleY : 0);
    ctx.fillText(subtitle, W / 2, sy);
  }

  // 7. LEFT LIST — bottom-left, accent color, big bold sans
  if (leftList?.trim()) {
    const lines = leftList.split("\n").map(l => l.trim()).filter(Boolean);
    ctx.font = ff("900 28px 'Syne',sans-serif");
    ctx.fillStyle = accent;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    // IG safe zone: anchor the last line at H-200 so the whole block
    // stays above the new dress-code position at H-130. Old formula
    // (H - 220 - lines.length * 6) moved the last line all over the
    // place depending on count and could overlap the bottom chrome.
    const startY = (H - 200) - (lines.length - 1) * 36; // bottom-anchored
    lines.forEach((ln, i) => {
      ctx.fillText(ln.toUpperCase(), 110, startY + i * 36);
    });
  }

  // 8. RIGHT LIST — bottom-right, accent color, big bold sans
  if (rightList?.trim()) {
    const lines = rightList.split("\n").map(l => l.trim()).filter(Boolean);
    ctx.font = ff("900 28px 'Syne',sans-serif");
    ctx.fillStyle = accent;
    ctx.textAlign = "right"; ctx.textBaseline = "top";
    // IG safe zone: anchor the last line at H-200 so the whole block
    // stays above the new dress-code position at H-130. Old formula
    // (H - 220 - lines.length * 6) moved the last line all over the
    // place depending on count and could overlap the bottom chrome.
    const startY = (H - 200) - (lines.length - 1) * 36;
    lines.forEach((ln, i) => {
      ctx.fillText(ln.toUpperCase(), W - 110, startY + i * 36);
    });
  }

  // 9. DRESS CODE / TAGLINE — italic, small, centered just above date.
  // IG safe zone: was H-70, bumped to H-130 so the line stays above
  // the bottom action chrome / caption overlay in IG's preview.
  if (dressCode?.trim()) {
    ctx.font = ff("italic 600 22px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(dressCode, W / 2, H - 130);
  }

  // 10. DATE LINE — mono caps, letterspaced.
  // IG safe zone: was H-32, bumped to H-80.
  if (dateLine?.trim()) {
    ctx.font = `700 24px ${monoStack}`;
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.letterSpacing = "3px";
    ctx.fillText(dateLine.toUpperCase(), W / 2, H - 80);
    ctx.letterSpacing = "0px";
  }

  // 11. ACCENT EDGE — brand cue at the very bottom (decorative chrome,
  // partial cropping is acceptable so it stays at the edge).
  ctx.fillStyle = accent;
  ctx.fillRect(0, H - 6, W, 6);

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawDots(ctx, W, dots, totalDots, accent);
  // No drawLogo / drawFooter — the design includes its own brand cues
  // (top mono line, accent edge) and adding the standard logo would
  // overcrowd it.
}

// === PRESS ===
// Editorial flyer template inspired by the Afrogroove / event-press
// aesthetic. Big distressed-feeling display title, four-cell mono meta
// row at the top, optional accent badge to the right of the title,
// lineup of artist/host names in the photo midground, full-width
// marquee strip with comma-separated genre tags (configurable bg +
// text color), and a big full-width date bar at the bottom
// (configurable bg + text color).
//
// Three regions get user-pickable colors per the user's spec:
//   1. The genre marquee strip
//   2. The bottom date bar
//   3. The small badge next to the title
// Each region has BG + TEXT picker so you can do dark-text-on-yellow,
// white-text-on-red, anything. Badge auto-hides when its text is empty.
// Ratio-aware (Cover pattern). targetW/targetH/focalX/focalY make
// non-1:1 exports paint the whole press layout (photo wash + top meta
// + title + lineup + genre marquee + date bar + footer) across the
// full target frame. Defaults keep the square render unchanged.
function renderPress(canvas, cfg) {
  const {
    photo,
    topMeta,           // 4-cell array — each cell is a string with \n for two lines
    title,
    badge,             // small text in the badge; empty/blank → badge hidden
    lineup,            // multi-line string of artist names
    genres,            // comma-separated list ("AMAPIANO, AFROHOUSE, …")
    dateLine,
    badgeBg, badgeText,
    genreBg, genreText,
    dateBg, dateText,
    photoOpacity,      // dark wash over photo for legibility (0..1)
    accent, bgKey, dots, totalDots,
    targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5,
  } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 1. BACKGROUND — photo full-bleed (focal-aware) or solid fallback.
  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    let dx = (W / 2) - (photo.width * focalX * s);
    let dy = (H / 2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle = `rgba(0,0,0,${typeof photoOpacity === "number" ? photoOpacity : 0.30})`;
    ctx.fillRect(0, 0, W, H);
  } else {
    const bg = BG_COLORS[bgKey] || BG_COLORS.black;
    ctx.fillStyle = bg.hex; ctx.fillRect(0, 0, W, H);
  }

  const mono = "ui-monospace, Menlo, 'Courier New', monospace";

  // 2. TOP META ROW — 4 equal cells, each with up to 2 lines.
  // Painted edge-to-edge with small left/right padding (the meta lives
  // outside the IG 4:5 safe zone intentionally — it's small contextual
  // text that survives partial cropping).
  const metaCells = Array.isArray(topMeta) ? topMeta : ["", "", "", ""];
  const padX = 56;
  const cellW = (W - padX * 2) / 4;
  const metaTop = 40;
  ctx.fillStyle = "#FFF"; ctx.textBaseline = "top";
  ctx.font = `700 18px ${mono}`;
  for (let i = 0; i < 4; i++) {
    const cellLines = String(metaCells[i] || "").split("\n").slice(0, 2);
    const cellX = padX + i * cellW;
    ctx.textAlign = "left";
    cellLines.forEach((ln, li) => {
      ctx.fillText(String(ln || "").toUpperCase(), cellX, metaTop + li * 22);
    });
  }

  // 3. TITLE — huge condensed-feeling display type. Letter-spacing
  // tightened slightly so it reads as one impactful word. Edge-to-edge
  // horizontally; we intentionally let it bleed past the 4:5 safe zone
  // because the title IS the art.
  const titleY = 110;
  let titleH = 0;
  let titleFontSize = 240;
  if (title?.trim()) {
    const t = title.toUpperCase();
    ctx.font = ff(`900 ${titleFontSize}px 'Syne',sans-serif`);
    ctx.letterSpacing = "-4px";
    while (ctx.measureText(t).width > W - 60 && titleFontSize > 100) {
      titleFontSize -= 6;
      ctx.font = ff(`900 ${titleFontSize}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(t, 40, titleY);
    titleH = titleFontSize * 0.95;
    ctx.letterSpacing = "0px";
  }

  // 4. BADGE — small filled rectangle with text inside, sits to the
  // right of the title's bottom-right corner. Hidden entirely when
  // `badge` is empty/whitespace, per the user's spec.
  if (badge?.trim()) {
    const bt = badge.toUpperCase();
    ctx.font = ff("800 22px 'Syne',sans-serif");
    ctx.letterSpacing = "1.5px";
    const tw = ctx.measureText(bt).width;
    const rectW = tw + 28, rectH = 38;
    // Anchored to the title's bottom right, but kept inside the canvas.
    const rx = Math.min(W - rectW - 40, 40 + (title ? (W - 80) : 0) - rectW);
    const ry = titleY + titleH + 4;
    ctx.fillStyle = badgeBg || "#D43F2F";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rx, ry, rectW, rectH, 3);
    else ctx.rect(rx, ry, rectW, rectH);
    ctx.fill();
    ctx.fillStyle = badgeText || "#FFFFFF";
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.fillText(bt, rx + 14, ry + rectH / 2);
    ctx.letterSpacing = "0px";
  }

  // 5. LINEUP — two-line bold sans, centered, lower-mid of canvas.
  // Anchored from the BOTTOM up so adding/removing lines doesn't shift
  // the genre + date bars.
  if (lineup?.trim()) {
    const lines = lineup.split("\n").map(l => l.trim().toUpperCase()).filter(Boolean);
    let fs = 50;
    ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    ctx.letterSpacing = "-1px";
    while (Math.max(...lines.map(l => ctx.measureText(l).width)) > W - 80 && fs > 24) {
      fs -= 2;
      ctx.font = ff(`900 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    const lh = fs * 1.08;
    // Lineup baseline-top sits 240px above bottom — leaves room for
    // genre strip (60px) + date bar (90px) + buffer.
    const lineupBottom = H - 240;
    lines.forEach((ln, i) => {
      const y = lineupBottom - (lines.length - 1 - i) * lh;
      ctx.fillText(ln, W / 2, y);
    });
    ctx.letterSpacing = "0px";
  }

  // 6. GENRE STRIP — full-width horizontal bar with comma-separated
  // genres joined by a ★ star. Bg + text are user-pickable; star
  // shares the text color. Strip is intentionally taller than just
  // the text so it reads as a printed flyer band.
  const stripH = 60;
  const stripY = H - 90 - stripH;
  ctx.fillStyle = genreBg || "#3A8B5F";
  ctx.fillRect(0, stripY, W, stripH);
  if (genres?.trim()) {
    const items = genres.split(",").map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase());
    if (items.length) {
      // Repeat the genre list so the strip feels marquee-cropped at
      // the canvas edges — same trick the reference uses to suggest
      // motion.
      const joined = items.join(" ★ ");
      ctx.font = ff("800 28px 'Syne',sans-serif");
      ctx.letterSpacing = "2px";
      const oneRun = ctx.measureText("★ " + joined + " ").width;
      const repeats = Math.ceil((W + 200) / oneRun) + 1;
      const runText = ("★ " + joined + " ").repeat(repeats);
      ctx.fillStyle = genreText || "#F2C94C";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      // Offset so the strip looks mid-marquee (clipped on left edge).
      ctx.fillText(runText, -40, stripY + stripH / 2);
      ctx.letterSpacing = "0px";
    }
  }

  // 7. DATE BAR — big bottom bar, bg + text user-pickable. Date text
  // is mono caps with a ★ star separator the user can include in their
  // input (e.g. "21 DE JUNHO ★ 22H").
  const dateH = 90;
  const dateY = H - dateH;
  ctx.fillStyle = dateBg || "#E55F2B";
  ctx.fillRect(0, dateY, W, dateH);
  if (dateLine?.trim()) {
    let fs = 56;
    ctx.font = `900 ${fs}px ${mono}`;
    ctx.letterSpacing = "2px";
    while (ctx.measureText(dateLine.toUpperCase()).width > W - 80 && fs > 24) {
      fs -= 2;
      ctx.font = `900 ${fs}px ${mono}`;
    }
    ctx.fillStyle = dateText || "#0a0a0a";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(dateLine.toUpperCase(), W / 2, dateY + dateH / 2);
    ctx.letterSpacing = "0px";
  }

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawDots(ctx, W, dots, totalDots, accent);
  // No drawLogo / drawFooter — the meta row + date bar already serve
  // as the brand cues; standard watermark would clutter.
}

// === VIBE BOARD ===
// Moodboard collage. Headline at top (quoted, conversational), 5-cell
// grid of photo cards below (4 in a 2x2 plus 1 hero, OR 2x3 layout).
// Inspired by The Local Girl Network's "Vitamin F / C" carousels — a
// reusable template that generates endless content (one per letter,
// season, vibe, etc) and works as the non-event content engine you
// don't have yet.
function renderVibeBoard(canvas, cfg) {
  const { vibePhotos, vibeHeadline, vibeLabels, accent, bgKey, dots, totalDots,
          targetW = 1080, targetH = 1080 } = cfg;
  const W = targetW, H = targetH;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !!bg.isLight;

  ctx.fillStyle = bg.hex; ctx.fillRect(0, 0, W, H);
  const isBlack = bgKey === "black";
  drawTexture(ctx, W, H, isBlack ? "#FACC15" : "#000", isBlack ? 0.04 : (isLight ? 0.05 : 0.08));
  if (!isLight && !isBlack) drawSpotlight(ctx, W, H, "255,255,255", 0.30);

  const headlineColor = isLight ? "#0a0a0a" : accent;
  const labelColor = isLight ? "rgba(0,0,0,0.78)" : "rgba(255,255,255,0.78)";
  const cellBg = isLight ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.06)";

  // HEADLINE — top of slide.
  let headlineBottom = 100;
  if (vibeHeadline?.trim()) {
    let fs = 64;
    const t = vibeHeadline;
    ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    while (ctx.measureText(t).width > W - 80 && fs > 32) {
      fs -= 4; ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = headlineColor;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(t, W / 2, 100);
    headlineBottom = 100 + fs + 16;
  }

  // PHOTO GRID — 2x3 layout (top row of 2, bottom row of 3).
  // With 5 photos: top 2 are bigger hero cells, bottom 3 are smaller.
  const items = (vibePhotos || []).map((p, i) => ({
    photo: p,
    label: (vibeLabels && vibeLabels[i]) || "",
  })).filter(x => x.photo || x.label);

  // px=110 keeps content inside IG's 4:5 cover-preview safe zone when
  // exporting at 1:1 (864×1080 centered crop = 108px per side).
  const px = 110;
  const labelHeight = 50;
  const gridTop = headlineBottom + 40;
  const gridBottom = H - 110;
  const gridH = gridBottom - gridTop;

  // Decide layout based on count
  const count = Math.min(items.length, 6);
  let cells = [];
  if (count <= 0) {
    drawLogo(ctx, accent, W, isLight);
    drawDots(ctx, W, dots, totalDots, accent, isLight);
    drawFooter(ctx, W, H, isLight);
    return;
  }
  if (count <= 2) {
    // 1 or 2 cells: full-width row
    const cw = (W - px * 2 - (count - 1) * 20) / count;
    const ch = gridH;
    for (let i = 0; i < count; i++) cells.push({ x: px + i * (cw + 20), y: gridTop, w: cw, h: ch });
  } else if (count <= 4) {
    // 2x2
    const cw = (W - px * 2 - 20) / 2;
    const ch = (gridH - 20) / 2;
    for (let i = 0; i < count; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      cells.push({ x: px + col * (cw + 20), y: gridTop + row * (ch + 20), w: cw, h: ch });
    }
  } else {
    // 5 or 6: 2 wider on top, 3 smaller on bottom
    const topCols = 2, bottomCols = count - 2;
    const topRowH = gridH * 0.55;
    const bottomRowH = gridH * 0.45 - 20;
    const topCw = (W - px * 2 - 20) / topCols;
    const bottomCw = (W - px * 2 - (bottomCols - 1) * 16) / bottomCols;
    for (let i = 0; i < 2; i++) {
      cells.push({ x: px + i * (topCw + 20), y: gridTop, w: topCw, h: topRowH });
    }
    for (let i = 0; i < bottomCols; i++) {
      cells.push({ x: px + i * (bottomCw + 16), y: gridTop + topRowH + 20, w: bottomCw, h: bottomRowH });
    }
  }

  // Draw each cell
  cells.forEach((c, i) => {
    const item = items[i];
    if (!item) return;

    const photoH = c.h - labelHeight - 4;

    // Photo container (rounded with subtle shadow on light bg)
    ctx.save();
    ctx.beginPath(); ctx.roundRect(c.x, c.y, c.w, photoH, 16);
    if (isLight) {
      ctx.shadowColor = "rgba(0,0,0,0.10)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
    }
    ctx.fillStyle = cellBg;
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // Clip to rounded rect and draw photo
    if (item.photo) {
      ctx.clip();
      const p = item.photo;
      const s = Math.max(c.w / p.width, photoH / p.height);
      const dw = p.width * s, dh = p.height * s;
      ctx.drawImage(p, c.x + (c.w - dw) / 2, c.y + (photoH - dh) / 2, dw, dh);
    } else {
      // Placeholder text inside empty cell
      ctx.clip();
      ctx.fillStyle = isLight ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.25)";
      ctx.font = ff("700 22px 'DM Sans',sans-serif");
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("PHOTO " + (i + 1), c.x + c.w / 2, c.y + photoH / 2);
    }
    ctx.restore();

    // LABEL — beneath the photo cell
    if (item.label?.trim()) {
      ctx.font = ff("600 22px 'DM Sans',sans-serif");
      ctx.fillStyle = labelColor;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(item.label, c.x + c.w / 2, c.y + photoH + 14);
    }
  });

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawLogo(ctx, accent, W, isLight);
  drawDots(ctx, W, dots, totalDots, accent, isLight);
  drawFooter(ctx, W, H, isLight);
}

// === FEATURES RENDERER (2x2 emoji-card grid) ===
function renderFeatures(canvas, cfg) {
  const { featuresTitle, features, accent, bgKey, dots, totalDots, photo, opacity,
          targetW = 1080, targetH = 1080, focalX = 0.5, focalY = 0.5 } = cfg;
  const W = targetW, H = targetH; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    let dx = (W/2) - (photo.width * focalX * s);
    let dy = (H/2) - (photo.height * focalY * s);
    dx = Math.max(W - dw, Math.min(0, dx));
    dy = Math.max(H - dh, Math.min(0, dy));
    ctx.drawImage(photo, dx, dy, dw, dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity||0.88})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack=bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:(isLight?0.06:0.10));
    if(!isBlack && !isLight) drawSpotlight(ctx,W,H,"255,255,255",0.35);
  }

  const titleColor = isLight ? "#0a0a0a" : "#FFF";
  const cardFill = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
  const cardHeadlineColor = isLight ? "#0a0a0a" : "#FFF";
  const cardSubColor = isLight ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.6)";
  const emojiBg = isLight ? "#0a0a0a" : "#FFF";

  ctx.globalAlpha=1; ctx.textBaseline="top";

  // Title at top, centered
  let titleBottom = 70;
  if (featuresTitle?.trim()) {
    let fs = 52;
    ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`);
    const t = featuresTitle.toUpperCase();
    while (ctx.measureText(t).width > W-120 && fs > 32) { fs -= 2; ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`); }
    ctx.fillStyle=titleColor; ctx.textAlign="center";
    ctx.fillText(t, W/2, 80);
    const barY = 80 + fs + 18;
    ctx.fillStyle=accent; ctx.fillRect(W/2-25, barY, 50, 4);
    titleBottom = barY + 18;
  }

  // Adaptive grid — supports 1 to 6 cards. 1 = full width row.
  // 2 = 2x1. 3-4 = 2 cols × ceil(n/2) rows. 5-6 = 2 cols × 3 rows. When
  // n is odd in a 2-column layout the LAST card spans both columns so
  // the bottom row isn't a lonely floater.
  const cards = (features || []).slice(0, 6);
  const n = cards.length;
  const cols = n === 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  // margin=110 keeps cards inside IG's 4:5 cover-preview safe zone
  // (was 60, which let the cards' left/right edges get cropped).
  const margin = 110;
  const gap = 28;
  const cw = (W - margin*2 - (cols-1)*gap) / cols;
  const gridTop = Math.max(titleBottom + 40, 240);
  // Card height auto-scales to fit available vertical space — leaves room
  // for the bottom footer + dots and clamps to 300px so single cards
  // don't stretch unreasonably tall.
  const availH = H - gridTop - 80;
  const ch = Math.max(160, Math.min(300, (availH - (rows-1)*gap) / rows));

  cards.forEach((card, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const isLastOdd = (cols === 2) && (i === n - 1) && (n % 2 === 1) && (i > 0);
    const x = isLastOdd ? margin : (margin + col * (cw + gap));
    const y = gridTop + row * (ch + gap);
    const thisCw = isLastOdd ? (cw * 2 + gap) : cw;

    // Card bg
    ctx.fillStyle = cardFill;
    ctx.beginPath(); ctx.roundRect(x, y, thisCw, ch, 12); ctx.fill();

    // Left accent stripe
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(x, y, 5, ch, [12, 0, 0, 12]); ctx.fill();

    // Card font sizes shrink slightly for shorter cards (5-6 case)
    const emojiSize = ch >= 260 ? 78 : ch >= 200 ? 64 : 52;
    const emojiY = ch >= 260 ? 30 : ch >= 200 ? 22 : 16;
    const headlineY = ch >= 260 ? 144 : ch >= 200 ? 110 : 84;
    const subY = ch >= 260 ? 188 : ch >= 200 ? 150 : 120;

    // Emoji
    if (card.emoji?.trim()) {
      ctx.font=ff(`${emojiSize}px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif`);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillStyle = emojiBg;
      ctx.fillText(card.emoji, x + 28, y + emojiY);
    }

    // Headline
    if (card.headline?.trim()) {
      let hfs = ch >= 260 ? 30 : ch >= 200 ? 26 : 22;
      const headlineText = card.headline.toUpperCase();
      ctx.font=ff(`800 ${hfs}px 'Syne',sans-serif`);
      while (ctx.measureText(headlineText).width > thisCw - 50 && hfs > 16) {
        hfs -= 2; ctx.font=ff(`800 ${hfs}px 'Syne',sans-serif`);
      }
      ctx.fillStyle = cardHeadlineColor; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(headlineText, x + 28, y + headlineY);
    }

    // Sub (wrap to 2 lines max)
    if (card.sub?.trim()) {
      ctx.font=ff("400 20px 'DM Sans',sans-serif");
      ctx.fillStyle = cardSubColor;
      const subWords = card.sub.split(/\s+/);
      const subLines = []; let bl = "";
      for (const w of subWords) {
        const test = bl ? bl + " " + w : w;
        if (ctx.measureText(test).width > thisCw - 50 && bl) { subLines.push(bl); bl = w; }
        else bl = test;
      }
      if (bl) subLines.push(bl);
      subLines.slice(0, 2).forEach((ln, j) => ctx.fillText(ln, x + 28, y + subY + j*26));
    }
  });

  ctx.textAlign = "left";
  drawDots(ctx, W, dots, totalDots, accent, isLight);
  drawFooter(ctx, W, H, isLight);
}

// Voice fingerprint toggle — green when ON (voice priming sent to
// Gemini), dim when OFF (raw captions, no brand voice prepended).
// Default ON. NOT a link to /brand anymore — user reported the nav
// jump was unwanted. Edit voice in /brand directly via the nav menu.
// Props: voiceEnabled, setVoiceEnabled — owned by MediaTool so the
// state can be passed down to the Captions handler.
function VoiceChip({ voiceEnabled, setVoiceEnabled }) {
  const voice = useBrandStore((s) => s.voice);
  const hasDesc = !!(voice?.description && voice.description.trim());
  const exemplarCount = Array.isArray(voice?.exemplars) ? voice.exemplars.filter(e => e && e.trim()).length : 0;
  const hasContent = hasDesc || exemplarCount > 0;
  const isOn = voiceEnabled && hasContent;
  // Render nothing in the happy default (voice on + brand voice set).
  // The chip only surfaces when there's something the user might want
  // to fix: voice is OFF, or Brand Kit voice is empty. User feedback:
  // "moving forward it should default always be on" — so when it IS
  // on and working, get out of the way.
  if (isOn) return null;
  const label = isOn
    ? `🎙 Voice: ON${exemplarCount > 0 ? ` · ${exemplarCount} ex` : ""}`
    : !hasContent
      ? "🎙 Voice: empty"
      : "🎙 Voice: off";
  const tooltip = !hasContent
    ? "Brand Kit voice is empty. Go to /brand to add a description and example captions, then this toggle activates."
    : isOn
      ? `Voice priming is ON. The next Captions call will include your Brand Kit voice (description${hasDesc ? " ✓" : ""}${exemplarCount > 0 ? `, ${exemplarCount} examples` : ""}). Click to turn OFF for this session.`
      : "Voice priming OFF. Click to turn back ON (default).";
  return (
    <button
      onClick={() => hasContent && setVoiceEnabled((v) => !v)}
      disabled={!hasContent}
      title={tooltip}
      style={{
        padding: "6px 10px",
        background: isOn ? "rgba(52,211,153,0.10)" : "rgba(245,240,232,0.04)",
        border: "1px solid " + (isOn ? "rgba(52,211,153,0.35)" : "rgba(245,240,232,0.10)"),
        borderRadius: 4,
        color: isOn ? "#34D399" : (hasContent ? "rgba(245,240,232,0.45)" : "rgba(245,240,232,0.3)"),
        fontSize: "0.6rem",
        letterSpacing: "1px",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        fontFamily: "'Syne', sans-serif",
        fontWeight: 700,
        cursor: hasContent ? "pointer" : "not-allowed",
      }}
    >{label}</button>
  );
}

// Curated emoji set for event-themed cards. Grouped by category in the
// list (Music → Drinks → Food → Party → Sports → Fitness → Outdoor →
// Show/Game → Misc) so the visual sweep follows event semantics.
const FEATURE_EMOJIS = [
  // Music
  "🎵","🎶","🎤","🎧","🎸","🥁","🎹","🎺","🪕",
  // Drinks
  "🍻","🥂","🍷","🍸","🍹","☕","🧉",
  // Food
  "🍕","🍔","🌮","🍣","🍰","🎂",
  // Party
  "🎉","🎊","🎈","🎁","✨","💃","🕺","🪩","🎀",
  // Sports / movement
  "🎾","🏀","⚽","🏈","🎳","🎯","🏊","🤸","🏃","🧘","💪","🏋",
  // Outdoor
  "🌳","🌅","🌊","🏖","🌺","☀","🌙",
  // Show / Game
  "🎮","🎲","🎬","🎭","🎨","🎪","🎟",
  // Tech / Work
  "💻","📱","🎙","📷","📚","🎓",
  // Marks of feeling
  "❤","🔥","⭐","🌟","💯","🥇","👀","🤝","💼",
];

// Emoji picker — small popover with a curated grid. Replaces the
// free-text emoji input used in the Features card form. Click the
// button to open the grid; click an emoji to set it and close.
// Click "✗ clear" to unset.
function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Pick an emoji"
        style={{
          width: "100%",
          padding: "4px",
          background: "#111",
          border: open ? "1.5px solid #E5BC4F" : "1px solid rgba(245,240,232,0.04)",
          borderRadius: 4,
          color: "#F5F0E8",
          fontSize: "1.1rem",
          cursor: "pointer",
          textAlign: "center",
          minHeight: 32,
          fontFamily: "inherit",
        }}
      >{value || "🙂"}</button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 4,
            padding: 8,
            background: "#0a0a0a",
            border: "1px solid rgba(245,240,232,0.18)",
            borderRadius: 6,
            boxShadow: "0 10px 24px rgba(0,0,0,0.55)",
            zIndex: 50,
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            gap: 3,
            minWidth: 240,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {FEATURE_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => { onChange(e); setOpen(false); }}
              title={e}
              style={{
                width: 28,
                height: 28,
                background: value === e ? "rgba(229,188,79,0.22)" : "transparent",
                border: value === e ? "1px solid rgba(229,188,79,0.5)" : "1px solid transparent",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: "1.05rem",
                padding: 0,
                lineHeight: 1,
              }}
            >{e}</button>
          ))}
          <button
            onClick={() => { onChange(""); setOpen(false); }}
            title="Clear emoji"
            style={{
              gridColumn: "span 7",
              padding: "5px",
              marginTop: 4,
              background: "transparent",
              border: "1px solid rgba(251,113,133,0.3)",
              borderRadius: 4,
              color: "rgba(251,113,133,0.7)",
              fontSize: "0.55rem",
              letterSpacing: 1,
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "'Syne',sans-serif",
            }}
          >✗ Clear</button>
        </div>
      )}
    </div>
  );
}

// Focal point picker — click anywhere on a photo thumbnail to mark
// "keep this part visible when cropping to non-1:1 ratios". Stored as
// 0..1 normalized (focalX/focalY). The export pipeline (wrapForExport)
// uses these to position the crop window around the user's focal point
// instead of forcing a center crop on the original photo.
//
// Renders the photo at 240px wide max (preserves aspect) so the picker
// fits the form column on mobile + desktop alike. The dot is a 22px
// gold disc with a white ring — visible on any photo (light/dark/busy).
function FocalPointPicker({ photo, focalX, focalY, onChange }) {
  const ref = useRef(null);
  if (!photo) return null;
  const setFocal = (clientX, clientY) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    onChange(Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)));
  };
  const aspect = photo.height / photo.width;
  const thumbW = 240;
  const thumbH = Math.round(thumbW * aspect);
  return (
    <div style={{ marginBottom: "0.6rem" }}>
      <label style={{ display: "block", fontSize: "0.5rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.55)", marginBottom: 4 }}>
        Focal point · tap to mark what stays visible at 4:5 / 9:16 / 3:4
      </label>
      <div
        ref={ref}
        onMouseDown={(e) => setFocal(e.clientX, e.clientY)}
        onTouchStart={(e) => {
          if (e.touches[0]) setFocal(e.touches[0].clientX, e.touches[0].clientY);
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) setFocal(e.touches[0].clientX, e.touches[0].clientY);
        }}
        style={{
          position: "relative",
          width: thumbW,
          height: thumbH,
          maxWidth: "100%",
          backgroundImage: `url(${photo.src})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          border: "1px solid rgba(245,240,232,0.15)",
          borderRadius: 4,
          cursor: "crosshair",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div style={{
          position: "absolute",
          left: `${focalX * 100}%`,
          top: `${focalY * 100}%`,
          transform: "translate(-50%, -50%)",
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(229,188,79,0.9)",
          border: "3px solid #fff",
          boxShadow: "0 0 8px rgba(0,0,0,0.6)",
          pointerEvents: "none",
        }} />
      </div>
    </div>
  );
}

// Small reusable button at the top of each builder form's mode panel.
// onClick gets called with the slot string so the parent can flip the
// AiSlideGeneratorModal open + targeted at the right slot type.
function AiSlotBtn({ slot, label, onClick }) {
  return (
    <button
      onClick={() => onClick(slot)}
      title={`Generate 3 ${label} options with AI (uses Brand Kit voice + ${label} content rule)`}
      style={{
        width: "100%",
        padding: "8px 12px",
        background: "rgba(229,188,79,0.10)",
        border: "1px dashed rgba(229,188,79,0.45)",
        color: "#E5BC4F",
        borderRadius: 4,
        fontSize: "0.65rem",
        fontWeight: 700,
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        cursor: "pointer",
        fontFamily: "'Syne',sans-serif",
        marginBottom: "0.8rem",
      }}
    >✨ AI Generate {label}</button>
  );
}

// === MEDIA TOOL ===
export default function MediaTool() {
  const events = useEventsStore(s => s.events);

  const [mode, setMode] = useState("cover");
  const [photo, setPhoto] = useState(null);
  // Focal point for the Cover photo (0..1 normalized). When the user
  // exports to a non-1:1 ratio (4:5 / 3:4 / 9:16), wrapForExport crops
  // the bleed photo around this focal point instead of forcing a
  // center crop. Default 0.5,0.5 (center) matches previous behavior.
  // Reset to center whenever a new photo is loaded so the picker starts
  // fresh on each upload.
  const [coverFocalX, setCoverFocalX] = useState(0.5);
  const [coverFocalY, setCoverFocalY] = useState(0.5);
  const [headline, setHeadline] = useState("This weekend in NJ has 47 events. Here's what you need to know");
  const [subtitle, setSubtitle] = useState("");
  const [highlights, setHighlights] = useState(new Set([1,6,10]));
  const [accentKey, setAccentKey] = useState("yellow");
  const [bgKey, setBgKey] = useState("black");
  const [dots, setDots] = useState(1);
  const [totalDots, setTotalDots] = useState(5);
  const [opacity, setOpacity] = useState(0.92);
  const [ribbon, setRibbon] = useState("");
  // Category tag — optional editorial section label (e.g. "WEEKEND GUIDE",
  // "JUNETEENTH 2026", "WORLD CUP WATCH PARTIES"). Sits at the top-center
  // under the logo bar. Hides when empty. Additive — existing covers
  // without one render exactly as before.
  const [categoryTag, setCategoryTag] = useState("");
  // Optional CTA pill button on Cover — renders below headline when set.
  // Defaults blank so editorial Covers (no button) stay clean. Use for
  // promo Covers: "TAP THE LINK", "RSVP IN BIO", "SEE THE LINEUP", etc.
  const [coverCtaButton, setCoverCtaButton] = useState("");
  // Cover headline alignment ("left" = default/current look, "center" =
  // classic magazine centering) + optional solid band behind the headline
  // block for legibility over busy photos (the @theaifield treatment).
  const [coverAlign, setCoverAlign] = useState("left");
  const [coverBand, setCoverBand] = useState(false);
  const [items, setItems] = useState([
    {name:"R&B Friday at Halftime",detail:"Jersey City · 8 PM",featured:true},
    {name:"Afrobeat Night",detail:"Suite 2, New Brunswick · 9 PM",featured:true},
    {name:"Comedy Night",detail:"Stress Factory · 7 PM",featured:true},
    {name:"Wine Tasting",detail:"Porta, Jersey City · 6 PM",featured:false},
    {name:"Open Mic Night",detail:"Caribrew, Newark · 6 PM",featured:false},
    {name:"Day Party",detail:"Blvd, New Brunswick · 3 PM",featured:false},
  ]);
  const [listTitle, setListTitle] = useState("FRIDAY");
  const [listSubtitle, setListSubtitle] = useState("TOP PICKS");
  // Optional background photo for the List slot (opacity + focal like the
  // other photo slots). Null = the original solid-color treatment.
  const [listPhoto, setListPhoto] = useState(null);
  const [listFocalX, setListFocalX] = useState(0.5);
  const [listFocalY, setListFocalY] = useState(0.5);
  const [listOpacity, setListOpacity] = useState(0.60);
  const [statNumber, setStatNumber] = useState("47");
  const [statLabel, setStatLabel] = useState("EVENTS");
  const [statSub, setStatSub] = useState("Across 3 days, 3 regions,\nand 12 categories");
  // Optional background photo for the Stat slot (with opacity + focal like
  // the other photo slots). Null = the original solid-color treatment.
  const [statPhoto, setStatPhoto] = useState(null);
  const [statFocalX, setStatFocalX] = useState(0.5);
  const [statFocalY, setStatFocalY] = useState(0.5);
  const [statOpacity, setStatOpacity] = useState(0.55);
  const [textTitle, setTextTitle] = useState("The Rooftop Scene");
  const [textTitleHL, setTextTitleHL] = useState(new Set([1]));
  const [textBody, setTextBody] = useState("Three new rooftop venues opened in North Jersey this spring, joining the wave of outdoor-focused social spaces targeting young professionals.\n\nThe biggest? *Newark Standard's expansion* — doubling their outdoor capacity for summer 2026.");
  const [pageNum, setPageNum] = useState(3);
  const [totalPages, setTotalPages] = useState(5);
  const [textPhoto, setTextPhoto] = useState(null);
  const [textOpacity, setTextOpacity] = useState(0.85);
  const [editItem, setEditItem] = useState(null);
  const [ctaKicker, setCtaKicker] = useState("SAVE YOUR SPOT");
  const [ctaDate, setCtaDate] = useState("Sunday, June 14 · 6 PM");
  const [ctaVenue, setCtaVenue] = useState("Pickleball HQ — Aberdeen");
  const [ctaUrl, setCtaUrl] = useState("pbdates.org");

  const [featuresTitle, setFeaturesTitle] = useState("Here's the night");
  const [features, setFeatures] = useState([
    { emoji: "🎾", headline: "Pickleball Games", sub: "No partner needed" },
    { emoji: "💬", headline: "Speed Connections", sub: "Meet everyone in the room" },
    { emoji: "💃", headline: "Bachata Dancing", sub: "Beginner friendly" },
    { emoji: "🎁", headline: "Gift Baskets", sub: "And good vibes" },
  ]);

  const [captionPhoto, setCaptionPhoto] = useState(null);
  const [captionFocalX, setCaptionFocalX] = useState(0.5);
  const [captionFocalY, setCaptionFocalY] = useState(0.5);
  const [caption, setCaption] = useState("When the music finds you.");
  const [captionSecondary, setCaptionSecondary] = useState("JERSEY CITY · APRIL 2026");
  const [captionAlign, setCaptionAlign] = useState("left");

  // Spotlight — one-venue-per-slide body for roundup carousels.
  const [spotPhoto, setSpotPhoto] = useState(null);
  // Focal point for spotlight venue photo (see Cover docs).
  const [spotFocalX, setSpotFocalX] = useState(0.5);
  const [spotFocalY, setSpotFocalY] = useState(0.5);
  // Optional Spotlight number — when set, renders a small circular badge
  // near the top of the slide (Feature Drop / listicle pattern). Empty
  // string keeps the badge off (default behavior — editorial spotlights
  // typically don't need numbering).
  const [spotNumber, setSpotNumber] = useState("");
  // Spotlight headline alignment + solid text band — mirrors the Cover
  // controls (left = current look, center = magazine centering; band = solid
  // bar behind the venue name + detail for legibility over busy photos).
  const [spotAlign, setSpotAlign] = useState("left");
  const [spotBand, setSpotBand] = useState(false);
  const [spotName, setSpotName] = useState("ROOFTOP NIGHT AT THE STANDARD");
  // Per-word highlight set for the spotlight name — same pattern as
  // Cover's `highlights`. Word indices match the order words appear in
  // spotName.split(/\s+/). When the user types new text the indices
  // shift, so the form auto-prunes out-of-range indices on edit.
  const [spotNameHL, setSpotNameHL] = useState(new Set());
  const [spotMeta, setSpotMeta] = useState("9 Clinton St | Newark");
  const [spotTime, setSpotTime] = useState("Friday · 8 PM");
  const [spotPrice, setSpotPrice] = useState("$30");
  const [spotCta, setSpotCta] = useState("tix in bio");

  // Countdown — T-minus anticipation card. Use as a series leading up
  // to a single big event (World Cup, NBA Finals, opening night, etc).
  const [countPhoto, setCountPhoto] = useState(null);
  const [countFocalX, setCountFocalX] = useState(0.5);
  const [countFocalY, setCountFocalY] = useState(0.5);
  const [countText, setCountText] = useState("3 WEEKS");
  const [countEvent, setCountEvent] = useState("WORLD CUP OPENING NIGHT");
  const [countWhen, setCountWhen] = useState("Friday, June 12 · The Standard");
  const [countCta, setCountCta] = useState("tix in bio");
  const [countOpacity, setCountOpacity] = useState(0.78);

  // Save the Date — single hero announcement.
  const [savePhoto, setSavePhoto] = useState(null);
  // Focal point for Save Date photo.
  const [saveFocalX, setSaveFocalX] = useState(0.5);
  const [saveFocalY, setSaveFocalY] = useState(0.5);
  const [saveKicker, setSaveKicker] = useState("SAVE THE DATE");
  const [saveDay, setSaveDay] = useState("FRIDAY");
  const [saveDateBig, setSaveDateBig] = useState("JUNE 12");
  const [saveEvent, setSaveEvent] = useState("WORLD CUP OPENING NIGHT");
  const [saveVenue, setSaveVenue] = useState("The Standard · Newark · 8 PM");
  const [saveCta, setSaveCta] = useState("RSVP in bio");
  const [saveOpacity, setSaveOpacity] = useState(0.80);

  // Save These Dates — multi-event announcement (2-4 items).
  const [savesPhoto, setSavesPhoto] = useState(null);
  const [savesFocalX, setSavesFocalX] = useState(0.5);
  const [savesFocalY, setSavesFocalY] = useState(0.5);
  const [savesHeader, setSavesHeader] = useState("SAVE THESE DATES");
  const [savesItems, setSavesItems] = useState([
    { date: "6/12", day: "FRIDAY",   name: "World Cup Opening Night", venue: "The Standard · Newark" },
    { date: "6/19", day: "FRIDAY",   name: "Summer Rooftop Series",   venue: "9th & 9th · Hoboken" },
    { date: "6/26", day: "FRIDAY",   name: "Latin Heat",              venue: "Bar Loft · Jersey City" },
  ]);
  const [savesCta, setSavesCta] = useState("tix in bio");
  const [savesOpacity, setSavesOpacity] = useState(0.85);

  // Scene Composer — slot-based party flyer. 4 photo slots + 7 text fields
  // + halftone toggle. Defaults seeded for a generic CGE party scene.
  const [sceneBgPhoto, setSceneBgPhoto] = useState(null);
  // Focal point for Scene background photo. The hero/left/right
  // cutouts get center-fit (they're cutout-style, focal less critical).
  const [sceneFocalX, setSceneFocalX] = useState(0.5);
  const [sceneFocalY, setSceneFocalY] = useState(0.5);
  const [sceneHero, setSceneHero] = useState(null);
  const [sceneLeft, setSceneLeft] = useState(null);
  const [sceneRight, setSceneRight] = useState(null);
  const [sceneTopLabel, setSceneTopLabel] = useState("CENTRALGROUPEVENTS");
  const [sceneTitle, setSceneTitle] = useState("JERSEY PARTY");
  const [sceneBigText, setSceneBigText] = useState("SUMMER\nKICKOFF");
  const [sceneLeftMeta, setSceneLeftMeta] = useState("HOSTED BY\nCGE");
  const [sceneRightMeta, setSceneRightMeta] = useState("SOUNDS BY\nTBA");
  const [sceneInfo, setSceneInfo] = useState("JUNE 13 · 8PM–12AM");
  const [sceneAddress, setSceneAddress] = useState("248 MULBERRY ST NEWARK, NJ");
  const [sceneHalftone, setSceneHalftone] = useState(true);
  const [sceneHeroScale, setSceneHeroScale] = useState(0.72);
  const [sceneSideScale, setSceneSideScale] = useState(0.55);

  // Poster — magazine-style flyer template. Big stacked title over a
  // photo background. Title controls (size / X / Y / align / color) live
  // alongside the text fields so the user can push the title around the
  // canvas to dodge background photo content.
  const [posterPhoto, setPosterPhoto] = useState(null);
  const [posterFocalX, setPosterFocalX] = useState(0.5);
  const [posterFocalY, setPosterFocalY] = useState(0.5);
  const [posterOpacity, setPosterOpacity] = useState(0.15);
  const [posterTopLine, setPosterTopLine] = useState("PIER A PARK — HOBOKEN, NJ");
  const [posterHosts, setPosterHosts] = useState("jela &\nLIVE HIGHER");
  const [posterKicker, setPosterKicker] = useState("wellness morning edition");
  const [posterTitle, setPosterTitle] = useState("PILATES\nON THE\nPIER");
  const [posterSubtitle, setPosterSubtitle] = useState("girls only.");
  const [posterLeftList, setPosterLeftList] = useState("LIVE DJ\nREFRESHMENTS\n45 MIN MAT PILATES\nSWEETGREEN SALADS\nMINI ICED COFFEE\nFACIAL VOUCHER");
  const [posterRightList, setPosterRightList] = useState("RECOVERY ACTIVATIONS:\nCOMPRESSION ZONE\nRED LIGHT THERAPY\nMASSAGES\nICE BATHS");
  const [posterDressCode, setPosterDressCode] = useState("wear pink / orange / red!");
  const [posterDateLine, setPosterDateLine] = useState("JUNE 20: 9:00 AM – 12:00 PM");
  const [posterTitleSize, setPosterTitleSize] = useState(1.0);
  const [posterTitleX, setPosterTitleX] = useState(0);
  const [posterTitleY, setPosterTitleY] = useState(0);
  const [posterTitleAlign, setPosterTitleAlign] = useState("center");
  // Title color defaults to the CGE wine accent (#FB7185) so out-of-the-box
  // the poster lands on-brand. The form UI exposes preset chips (the full
  // accent palette) plus a custom hex input so the user can punch in any
  // exact brand color when needed.
  const [posterTitleColor, setPosterTitleColor] = useState("#FB7185");

  // Press — editorial flyer template. Three user-pickable color regions
  // (genre strip, date bar, badge) per the spec, plus a configurable
  // photo darken so a busy crowd photo doesn't overwhelm the text.
  const [pressPhoto, setPressPhoto] = useState(null);
  // Focal point for Press photo.
  const [pressFocalX, setPressFocalX] = useState(0.5);
  const [pressFocalY, setPressFocalY] = useState(0.5);
  const [pressTopMeta, setPressTopMeta] = useState([
    "CASA SAVANA\nRUA CAMERINO",
    "—\n162",
    "RIO DE\nBRASIL",
    "JANEIRO\n2026",
  ]);
  const [pressTitle, setPressTitle] = useState("AFROGROOVE");
  const [pressBadge, setPressBadge] = useState("RIO DE JANEIRO");
  const [pressLineup, setPressLineup] = useState("CABANECO · DJ TALIE · NAIRO PUMA\nCRAZY  JEFFS · YURE  IDD");
  const [pressGenres, setPressGenres] = useState("AMAPIANO, AFROHOUSE, AFROBEATS");
  const [pressDateLine, setPressDateLine] = useState("21 DE JUNHO ★ 22H");
  const [pressGenreBg, setPressGenreBg] = useState("#3A8B5F");
  const [pressGenreText, setPressGenreText] = useState("#F2C94C");
  const [pressDateBg, setPressDateBg] = useState("#E55F2B");
  const [pressDateText, setPressDateText] = useState("#0a0a0a");
  const [pressBadgeBg, setPressBadgeBg] = useState("#D43F2F");
  const [pressBadgeText, setPressBadgeText] = useState("#FFFFFF");
  const [pressPhotoOpacity, setPressPhotoOpacity] = useState(0.30);

  // Vibe Board — moodboard collage with headline + 5 photo cells.
  const [vibePhotos, setVibePhotos] = useState([null, null, null, null, null]);
  const [vibeHeadline, setVibeHeadline] = useState('"I NEED SOME VITAMIN F"');
  const [vibeLabels, setVibeLabels] = useState([
    "farmers market", "french fries", "firmchella", "festivals", "family trivia",
  ]);

  // Custom carousel composer — snapshots of slides, reorderable, exportable
  const [carousel, setCarousel] = useState([]);
  // Which carousel slide is currently loaded for editing (null = composing a
  // fresh/unsaved slide). When set, edits to the form mirror back into that
  // slide live — see the edit-in-place effect after addToCarousel.
  const [editingSlideId, setEditingSlideId] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);

  // Carousel Template queue — when the user picks a template from the
  // Template Library, this stores the planned sequence and current
  // position. Each "→ Carousel" push auto-advances the mode to the next
  // slot in the sequence, walking the user through the template's
  // structure one slide at a time. null = no template active.
  // Shape: { id, name, sequence: ["cover", "text", ...], progress: 0 }
  const [templateQueue, setTemplateQueue] = useState(null);

  // AI Slide Generator modal — null when closed, slot name when open.
  // Same modal handles both Cover and CTA via slotType prop.
  const [aiSlotOpen, setAiSlotOpen] = useState(null);
  // AI Template Fill modal — whole-carousel generation. Open = true
  // shows the modal; the picker inside lets the user choose template.
  const [aiFillOpen, setAiFillOpen] = useState(false);

  // Global render flags — synced into module-level vars via useEffect.
  const [watermark, setWatermark] = useState(true);
  const [fontPairKey, setFontPairKey] = useState("default");
  // Aspect ratio applied at export time — preview stays 1:1 since the
  // renderers are coded for 1080×1080.
  const [exportRatio, setExportRatio] = useState("1:1");
  useEffect(() => { setActiveWatermark(watermark); }, [watermark]);

  // Alternate-colors wiring — when on, every odd-indexed carousel slide
  // overrides its bgKey to alternateBgKey at render time. Live previews
  // unaffected (idx=0 implicitly); thumbnails regenerated via useEffect
  // when alternation toggles.
  const alternateColors = useBrandStore((s) => s.alternateColors);
  const alternateBgKey = useBrandStore((s) => s.alternateBgKey);

  // Carousel templates — built-ins from constant, user customs from
  // persisted Zustand store. The picker UI merges both lists.
  const customCarouselTemplates = useCarouselTemplatesStore((s) => s.customs);
  const addCustomCarouselTemplate = useCarouselTemplatesStore((s) => s.addTemplate);
  const removeCustomCarouselTemplate = useCarouselTemplatesStore((s) => s.removeTemplate);

  // Brand identity sync — watermark/logo/footer renderers read from the
  // module-level _brand. Subscribing here means edits in the Brand Kit
  // tab propagate to the live preview immediately.
  const brandCreator = useBrandStore((s) => s.creator);
  useEffect(() => {
    setActiveBrand({
      logoText: brandCreator.logoText,
      brandName: brandCreator.brandName,
      handle: brandCreator.handle,
      url: brandCreator.url,
    });
    // Force re-render so the canvas picks up the new brand text without
    // waiting for another state change.
    setFontTick((t) => t + 1);
  }, [brandCreator.logoText, brandCreator.brandName, brandCreator.handle, brandCreator.url]);
  useEffect(() => {
    const pair = FONT_PAIRS[fontPairKey];
    setActiveFonts(pair.display, pair.body);
    // Request multiple weights — Google Fonts returns whatever's available
    // for the font. Bebas Neue ships only 400; Space Grotesk maxes at 700.
    // Asking for a single weight that doesn't exist meant the canvas fell
    // back silently to system sans for any text at that weight.
    const displayQ = pair.display.replace(/ /g, "+") + ":wght@400;700;800";
    const bodyQ = pair.body.replace(/ /g, "+") + ":wght@400;500;700;800";
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${displayQ}&family=${bodyQ}&display=swap`;
    document.head.appendChild(link);
    // Wait for the new fonts to load, then trigger a re-render of the preview.
    document.fonts.ready.then(() => {
      // Force preview re-render by toggling state; simplest: bump a tick.
      setFontTick(t => t + 1);
    });
    return () => { document.head.removeChild(link); };
  }, [fontPairKey]);
  const [fontTick, setFontTick] = useState(0);

  const envKey = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
  const [uiKey, setUiKey] = useState(() => {
    try { return localStorage.getItem("cge_gemini_key") || ""; } catch { return ""; }
  });
  const geminiKey = envKey || uiKey;
  const [showKey, setShowKey] = useState(false);
  const [isGenCaptions, setIsGenCaptions] = useState(false);
  const [captions, setCaptions] = useState([]);
  // Voice priming session toggle. Default ON. Can be flipped via the
  // VoiceChip if the user wants a one-off generic captions run.
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  // Which caption is currently visible in the picker view. Reset to 0
  // whenever a fresh batch comes back from Gemini so the user lands on
  // the first variant by default and can flip through with the dropdown.
  const [captionPickIdx, setCaptionPickIdx] = useState(0);
  const [captionsError, setCaptionsError] = useState("");
  // Optional custom caption tone — the user can type any tone/style beyond
  // the 8 presets (e.g. "dry and deadpan", "hype church-announcement"), and
  // it's generated FIRST. Empty = just the presets.
  const [captionTone, setCaptionTone] = useState("");
  // Saved custom tones — the user's own reusable one-tap chips. Persisted so
  // "block-party hype" is as fast as a preset next time.
  const [savedTones, setSavedTones] = useState(() => {
    try { const a = JSON.parse(localStorage.getItem("cge_caption_tones") || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem("cge_caption_tones", JSON.stringify(savedTones)); } catch {}
  }, [savedTones]);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [useVision, setUseVision] = useState(false);
  const saveKey = (v) => {
    setUiKey(v);
    try {
      if (v) localStorage.setItem("cge_gemini_key", v);
      else localStorage.removeItem("cge_gemini_key");
    } catch { /* private mode etc */ }
  };
  // Build a structured caption context by walking every slide in the
  // carousel and pulling out the text fields that template uses. Lets the
  // Caption button work for ANY template combination — Cover + Scene +
  // Spotlight + Save Date all contribute, not just the four hardcoded
  // form fields the old version read.
  const aggregateCarouselContext = (carousel) => {
    if (!carousel?.length) return null;
    const slides = [];
    carousel.forEach((slide, idx) => {
      const s = slide.snapshot || {};
      const lines = [];
      const push = (label, val) => {
        if (val == null) return;
        if (typeof val === "string" && !val.trim()) return;
        lines.push(`${label}: ${val}`);
      };
      // Common
      push("Headline", s.headline);
      push("Subtitle", s.subtitle);
      push("Ribbon", s.ribbon);
      // List
      push("List title", s.listTitle);
      if (Array.isArray(s.items) && s.items.length) {
        push("List items", s.items.map(it => [it.name, it.detail].filter(Boolean).join(" — ")).join("; "));
      }
      // Stat
      push("Stat number", s.statNumber);
      push("Stat label", s.statLabel);
      push("Stat sub", s.statSub);
      // Text
      push("Text title", s.textTitle);
      push("Text body", s.textBody);
      // CTA
      push("CTA kicker", s.ctaKicker);
      push("CTA date", s.ctaDate);
      push("CTA venue", s.ctaVenue);
      push("CTA URL", s.ctaUrl);
      // Features
      push("Features title", s.featuresTitle);
      if (Array.isArray(s.features) && s.features.length) {
        push("Features", s.features.map(f => `${f.emoji || ""} ${f.headline || ""}${f.sub ? " — " + f.sub : ""}`).join("; "));
      }
      // Photo + caption
      push("Caption", s.caption);
      push("Sub-caption", s.captionSecondary);
      // Spotlight
      push("Spotlight venue", s.spotName);
      push("Spotlight meta", s.spotMeta);
      push("Spotlight time", s.spotTime);
      push("Spotlight price", s.spotPrice);
      push("Spotlight CTA", s.spotCta);
      // Countdown
      push("Countdown", s.countText);
      push("Countdown event", s.countEvent);
      push("Countdown when", s.countWhen);
      push("Countdown CTA", s.countCta);
      // Save Date (single)
      push("Save Date kicker", s.saveKicker);
      push("Save Date day", s.saveDay);
      push("Save Date big", s.saveDateBig);
      push("Save Date event", s.saveEvent);
      push("Save Date venue", s.saveVenue);
      push("Save Date CTA", s.saveCta);
      // Save Dates (multi)
      push("Multi-date header", s.savesHeader);
      if (Array.isArray(s.savesItems) && s.savesItems.length) {
        push("Dates", s.savesItems.map(it => [it.date, it.day, it.name, it.venue].filter(Boolean).join(" · ")).join("; "));
      }
      push("Multi-date CTA", s.savesCta);
      // Vibe
      push("Vibe headline", s.vibeHeadline);
      if (Array.isArray(s.vibeLabels) && s.vibeLabels.length) {
        push("Vibe items", s.vibeLabels.filter(Boolean).join(", "));
      }
      // Scene
      push("Scene top label", s.sceneTopLabel);
      push("Scene title", s.sceneTitle);
      push("Scene big text", s.sceneBigText);
      push("Scene left meta", s.sceneLeftMeta);
      push("Scene right meta", s.sceneRightMeta);
      push("Scene info", s.sceneInfo);
      push("Scene address", s.sceneAddress);
      slides.push(`### Slide ${idx + 1} (${slide.type})\n${lines.join("\n")}`);
    });
    return { carouselSummary: slides.join("\n\n") };
  };

  const runCaptions = async () => {
    if (!geminiKey || isGenCaptions) return;
    // Guard: Vision needs slide images; bail with a clear error if the
    // carousel is empty so the user knows what to do.
    if (useVision && carousel.length === 0) {
      setCaptionsError(
        "Vision mode reads your actual rendered slide images. Add slides to the carousel first " +
        "(hit \"+ Add Current Slide\" after each one), then try again. Or turn Vision OFF to write " +
        "captions from the current form fields."
      );
      return;
    }
    setIsGenCaptions(true); setCaptionsError(""); setCaptions([]);
    try {
      // PREFER carousel content when it exists — gives Gemini the full
      // story across all your slides, not just the current form. Falls
      // back to current form fields when the carousel is empty.
      let ctx;
      if (carousel.length > 0) {
        ctx = aggregateCarouselContext(carousel);
      } else {
        ctx = {
          headline, subtitle, ribbon,
          statNumber, statLabel, statSub,
          ctaDate, ctaVenue, ctaUrl,
        };
      }
      const images = (useVision && carousel.length > 0) ? carousel.map(s => s.thumb) : [];
      // Voice fingerprint from Brand Kit — prepended to the Gemini prompt
      // when description or exemplars are set. Read fresh at call time
      // so newly-added exemplars take effect immediately without re-mount.
      // Respect the in-session voice toggle. When off, send no voice
      // priming — Gemini falls back to its default writing register.
      const brandVoice = voiceEnabled ? useBrandStore.getState().voice : null;
      const results = await generateCaptions(geminiKey, ctx, images, { voice: brandVoice, customTone: captionTone });
      if (!results.length) throw new Error("Got 0 captions back");
      setCaptions(results);
      setCaptionPickIdx(0);
    } catch (err) {
      console.error(err);
      setCaptionsError(err.message || "Generation failed");
    } finally {
      setIsGenCaptions(false);
    }
  };
  const copyCaption = async (text, idx) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  const cvRef = useRef(null), fileRef = useRef(null), textFileRef = useRef(null), captionFileRef = useRef(null), spotFileRef = useRef(null), countFileRef = useRef(null), saveFileRef = useRef(null), savesFileRef = useRef(null);
  // Scene Composer — 4 slots, each needs its own file input ref.
  const sceneBgRef = useRef(null), sceneHeroRef = useRef(null), sceneLeftRef = useRef(null), sceneRightRef = useRef(null);
  const pressFileRef = useRef(null);
  const posterFileRef = useRef(null);
  const statFileRef = useRef(null);
  const listFileRef = useRef(null);
  // One file input ref per Vibe Board slot (5 max).
  // Pre-allocate file-input refs for up to 6 Vibe Board cells. Rules of
  // Hooks forbid creating refs in a loop on each render, so we declare
  // the max we'll ever support and just index into them.
  const vibeFileRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];
  const accent = COLORS[accentKey]?.hex || "#FACC15";
  const words = headline.split(/\s+/).filter(w=>w);
  const textWords = textTitle.split(/\s+/).filter(w=>w);

  const toggleHL = (idx) => setHighlights(p=>{const n=new Set(p);n.has(idx)?n.delete(idx):n.add(idx);return n;});
  const toggleTextHL = (idx) => setTextTitleHL(p=>{const n=new Set(p);n.has(idx)?n.delete(idx):n.add(idx);return n;});
  // Spotlight per-word highlights — split the venue name into words and
  // expose a clickable chip per word. Auto-prunes indices that are out of
  // range when the user shortens the text (e.g. delete the last word and
  // its highlight goes with it).
  const spotWords = (spotName || "").split(/\s+/).filter(w=>w);
  const toggleSpotNameHL = (idx) => setSpotNameHL(p=>{
    const n = new Set();
    p.forEach(i => { if (i < spotWords.length) n.add(i); });
    if (n.has(idx)) n.delete(idx); else n.add(idx);
    return n;
  });

  // Cross-tool: pull events from the shared store into the List slide.
  // Filters by day if a day is picked; "all" pulls everything.
  const [listImportDay, setListImportDay] = useState("all");
  const importFromStore = () => {
    if (events.length === 0) return;
    const filtered = listImportDay === "all" ? events : events.filter(e => e.day === listImportDay);
    const next = filtered.slice(0, 8).map(e => ({
      name: e.name || "Untitled",
      detail: [e.venue, e.area, e.time].filter(Boolean).join(" · "),
      featured: false,
    }));
    if (next.length > 0) setItems(next);
  };

  // === Perf-tuned render ===
  // Old setup: useCallback with ~100 dep references in the array. React
  // had to compare every dep on every keystroke; the callback IDENTITY
  // changed on every state change, which retriggered the watching
  // useEffect, which cleared and re-armed setTimeout. Lots of churn
  // per keystroke even with the 60ms debounce.
  //
  // New setup: stable render function reads the latest state from a ref
  // (renderStateRef). The useEffect re-arms the timer on every render
  // (cheap — clearTimeout + setTimeout are O(1)) but doesn't need to
  // pass deps because render is stable. Canvas paint scheduled via
  // requestAnimationFrame so it lands on a frame boundary instead of
  // blocking input handling mid-tick.
  const renderStateRef = useRef({});
  renderStateRef.current = {
    mode,photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,ribbon,categoryTag,coverCtaButton,coverAlign,coverBand,
    items,bgKey,listTitle,listSubtitle,statNumber,statLabel,statSub,
    textTitle,textTitleHL,textBody,pageNum,totalPages,textPhoto,textOpacity,
    ctaKicker,ctaDate,ctaVenue,ctaUrl,featuresTitle,features,captionPhoto,captionFocalX,captionFocalY,caption,captionSecondary,captionAlign,
    spotPhoto,spotName,spotNameHL,spotMeta,spotTime,spotPrice,spotCta,spotNumber,spotAlign,spotBand,
    countPhoto,countFocalX,countFocalY,countText,countEvent,countWhen,countCta,countOpacity,
    savePhoto,saveKicker,saveDay,saveDateBig,saveEvent,saveVenue,saveCta,saveOpacity,
    savesPhoto,savesFocalX,savesFocalY,savesHeader,savesItems,savesCta,savesOpacity,
    vibePhotos,vibeHeadline,vibeLabels,
    sceneBgPhoto,sceneHero,sceneLeft,sceneRight,sceneTopLabel,sceneTitle,sceneBigText,sceneLeftMeta,sceneRightMeta,sceneInfo,sceneAddress,sceneHalftone,sceneHeroScale,sceneSideScale,
    posterPhoto,posterFocalX,posterFocalY,posterOpacity,posterTopLine,posterHosts,posterKicker,posterTitle,posterSubtitle,posterLeftList,posterRightList,posterDressCode,posterDateLine,posterTitleSize,posterTitleX,posterTitleY,posterTitleAlign,posterTitleColor,
    pressPhoto,pressTopMeta,pressTitle,pressBadge,pressLineup,pressGenres,pressDateLine,pressGenreBg,pressGenreText,pressDateBg,pressDateText,pressBadgeBg,pressBadgeText,pressPhotoOpacity,
  };
  const render = () => {
    const cv=cvRef.current; if(!cv) return;
    const s = renderStateRef.current;
    // Route the live preview through the SAME renderSlide() used for
    // thumbnails and export, built from the current form state via
    // makeSnapshot(). This keeps preview == thumbnail == export (they used
    // to be a separate hand-maintained dispatch that drifted — notably it
    // never passed the focal point, so the picker did nothing in preview)
    // and collapses ~15 lines of duplicated wiring into one call. slideIdx=0
    // so alternateColors doesn't kick in on the live canvas.
    renderSlide(cv, s.mode, makeSnapshot(), s.dots, s.totalDots, 0);
  };

  // Schedule a canvas repaint 400ms after the last render. Multiple keystrokes
  // during that window collapse into ONE paint — the preview reacts once you
  // PAUSE typing, not on every character. The old 120ms window repainted
  // mid-typing and thrashed the canvas on mobile while filling out a form;
  // 400ms = far fewer full-canvas redraws. Wrapped in rAF so the canvas ops
  // land on a frame boundary.
  useEffect(()=>{
    const t=setTimeout(()=>requestAnimationFrame(render),400);
    return ()=>clearTimeout(t);
  });

  // Upload handlers auto-save into the photo library so the user can
  // re-pick from any tool later without re-hunting through their disk.
  const makeUploadHandler = (setImage, targetMode) => (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const img = new Image();
      img.onload = () => setImage(img);
      img.src = ev.target.result;
    };
    r.readAsDataURL(f);
    // Fire-and-forget — failures shouldn't block the upload from working.
    savePhotoAndNotify(f, { sourceTool: "media", sourceMode: targetMode || mode })
      .catch(err => console.warn("Photo library save failed:", err));
    e.target.value = "";
  };
  // Reset focal point when a new cover photo is loaded so each upload
  // starts with a center-anchored crop. User can re-pick a focal after.
  const handlePhoto = makeUploadHandler((img) => {
    setPhoto(img);
    setCoverFocalX(0.5);
    setCoverFocalY(0.5);
  }, "cover");
  const handleTextPhoto = makeUploadHandler(setTextPhoto, mode); // text/cta/features all share this
  const handleCaptionPhoto = makeUploadHandler((img) => {
    setCaptionPhoto(img); setCaptionFocalX(0.5); setCaptionFocalY(0.5);
  }, "photo");
  const handleStatPhoto = makeUploadHandler((img) => {
    setStatPhoto(img); setStatFocalX(0.5); setStatFocalY(0.5);
  }, "stat");
  const handleListPhoto = makeUploadHandler((img) => {
    setListPhoto(img); setListFocalX(0.5); setListFocalY(0.5);
  }, "list");
  // Wrap each photo-having upload so a new picture resets its focal
  // point to center — the previous photo's focal is meaningless on the
  // new image, and the user shouldn't have to manually re-center.
  const handleSpotPhoto = makeUploadHandler((img) => {
    setSpotPhoto(img); setSpotFocalX(0.5); setSpotFocalY(0.5);
  }, "spotlight");
  const handleCountPhoto = makeUploadHandler((img) => {
    setCountPhoto(img); setCountFocalX(0.5); setCountFocalY(0.5);
  }, "countdown");
  const handleSavePhoto = makeUploadHandler((img) => {
    setSavePhoto(img); setSaveFocalX(0.5); setSaveFocalY(0.5);
  }, "savedate");
  const handleSavesPhoto = makeUploadHandler((img) => {
    setSavesPhoto(img); setSavesFocalX(0.5); setSavesFocalY(0.5);
  }, "savedates");
  // Scene Composer — 4 image slots: bg + hero + left + right
  const handleSceneBg    = makeUploadHandler((img) => {
    setSceneBgPhoto(img); setSceneFocalX(0.5); setSceneFocalY(0.5);
  }, "scene-bg");
  const handleSceneHero  = makeUploadHandler(setSceneHero,    "scene-hero");
  const handleSceneLeft  = makeUploadHandler(setSceneLeft,    "scene-left");
  const handleSceneRight = makeUploadHandler(setSceneRight,   "scene-right");
  const handlePosterPhoto = makeUploadHandler((img) => {
    setPosterPhoto(img); setPosterFocalX(0.5); setPosterFocalY(0.5);
  }, "poster");
  const handlePressPhoto  = makeUploadHandler((img) => {
    setPressPhoto(img); setPressFocalX(0.5); setPressFocalY(0.5);
  }, "press");
  // Vibe Board has 5 photo slots — one upload handler per slot.
  const handleVibePhoto = (idx) => (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => { const img = new Image(); img.onload = () => setVibePhotos(prev => prev.map((p,i)=>i===idx?img:p)); img.src = ev.target.result; };
    r.readAsDataURL(f);
    savePhotoAndNotify(f, { sourceTool: "media", sourceMode: "vibe" })
      .catch(err => console.warn("Photo library save failed:", err));
    e.target.value = "";
  };

  // Library picker state — opened by the "📚 Library" button next to each
  // Upload Photo button. `pickTarget` decides which setter to feed.
  const [libOpen, setLibOpen] = useState(false);
  const [pickTarget, setPickTarget] = useState(null); // "cover" | "text" | "photo" | "spotlight" | "slide:<id>"
  const openLibrary = (target) => { setPickTarget(target); setLibOpen(true); };

  // === Per-carousel-slide photo helpers ===
  // Drop `img` into the ACTIVE FORM's primary photo for a given slide type,
  // resetting that type's focal to center (the old focal is meaningless on a
  // new picture). Mirrors onLibraryPick's per-type routing but targets the
  // live form state instead of a carousel snapshot.
  const setFormPrimaryPhoto = (type, img) => {
    if (type === "cover")          { setPhoto(img);        setCoverFocalX(0.5);   setCoverFocalY(0.5); }
    else if (type === "photo")     { setCaptionPhoto(img); setCaptionFocalX(0.5); setCaptionFocalY(0.5); }
    else if (type === "stat")      { setStatPhoto(img);    setStatFocalX(0.5);    setStatFocalY(0.5); }
    else if (type === "list")      { setListPhoto(img);    setListFocalX(0.5);    setListFocalY(0.5); }
    else if (type === "spotlight") { setSpotPhoto(img);    setSpotFocalX(0.5);    setSpotFocalY(0.5); }
    else if (type === "countdown") { setCountPhoto(img);   setCountFocalX(0.5);   setCountFocalY(0.5); }
    else if (type === "savedate")  { setSavePhoto(img);    setSaveFocalX(0.5);    setSaveFocalY(0.5); }
    else if (type === "savedates") { setSavesPhoto(img);   setSavesFocalX(0.5);   setSavesFocalY(0.5); }
    else if (type === "scene")     { setSceneBgPhoto(img); setSceneFocalX(0.5);   setSceneFocalY(0.5); }
    else if (type === "poster")    { setPosterPhoto(img);  setPosterFocalX(0.5);  setPosterFocalY(0.5); }
    else if (type === "press")     { setPressPhoto(img);   setPressFocalX(0.5);   setPressFocalY(0.5); }
    else if (type === "vibe")      setVibePhotos(prev => prev.map((p,i)=>i===0?img:p));
    else                           setTextPhoto(img); // text / cta / features
  };

  // Per-slide photo buttons (📤 / 📚 under each thumbnail) now LOAD the slide
  // into the editor and drop the photo into the live form — so the picture
  // shows up in the main preview immediately with the opacity slider + focal
  // picker right there, and the live edit-in-place effect writes it (and any
  // opacity tweak) back to the slide. Previously these silently updated only
  // the 86px thumbnail, so the photo "didn't upload into the preview" and
  // there were no further options.
  const editSlideWithPhoto = (slideId, img) => {
    const idx = carousel.findIndex(s => s.id === slideId);
    if (idx < 0) return;
    const slide = carousel[idx];
    loadSnapshot(slide.snapshot, slide.type);
    setEditingSlideId(slideId);
    setDots(idx + 1);
    setTotalDots(carousel.length);
    setFormPrimaryPhoto(slide.type, img);
  };

  // Hidden file input that the per-slide 📤 button triggers.
  // slideUploadTargetId is set to the slide ID about to receive the photo;
  // onChange reads the file, builds an Image, applies it, then clears.
  const slideFileRef = useRef(null);
  const [slideUploadTargetId, setSlideUploadTargetId] = useState(null);
  const onSlideFilePick = (e) => {
    const f = e.target.files?.[0];
    const targetId = slideUploadTargetId;
    e.target.value = "";
    setSlideUploadTargetId(null);
    if (!f || !targetId) return;
    const r = new FileReader();
    r.onload = ev => {
      const img = new Image();
      img.onload = () => editSlideWithPhoto(targetId, img);
      img.src = ev.target.result;
    };
    r.readAsDataURL(f);
    // Also save to library so it's available cross-tool.
    savePhotoAndNotify(f, { sourceTool: "media", sourceMode: "carousel-slide" })
      .catch(err => console.warn("Photo library save failed:", err));
  };
  const triggerSlideUpload = (slideId) => {
    setSlideUploadTargetId(slideId);
    // Wait a tick so state lands before opening the picker — file input
    // onChange fires synchronously and we read slideUploadTargetId there.
    setTimeout(() => slideFileRef.current?.click(), 0);
  };

  const onLibraryPick = (img) => {
    // Per-slide library targets ("slide:<id>") update that slide's primary
    // photo + regenerate thumbs; everything else falls through to form setters.
    if (pickTarget && pickTarget.startsWith("slide:")) {
      const slideId = pickTarget.slice("slide:".length);
      editSlideWithPhoto(slideId, img);
      return;
    }
    if (pickTarget === "cover")          setPhoto(img);
    else if (pickTarget === "photo")     { setCaptionPhoto(img); setCaptionFocalX(0.5); setCaptionFocalY(0.5); }
    else if (pickTarget === "stat")      { setStatPhoto(img); setStatFocalX(0.5); setStatFocalY(0.5); }
    else if (pickTarget === "list")      { setListPhoto(img); setListFocalX(0.5); setListFocalY(0.5); }
    else if (pickTarget === "spotlight") setSpotPhoto(img);
    else if (pickTarget === "countdown") { setCountPhoto(img); setCountFocalX(0.5); setCountFocalY(0.5); }
    else if (pickTarget === "savedate")  setSavePhoto(img);
    else if (pickTarget === "savedates") { setSavesPhoto(img); setSavesFocalX(0.5); setSavesFocalY(0.5); }
    else if (pickTarget && pickTarget.startsWith("vibe-")) {
      const idx = parseInt(pickTarget.split("-")[1], 10);
      setVibePhotos(prev => prev.map((p,i)=>i===idx?img:p));
    }
    else if (pickTarget === "scene-bg")    setSceneBgPhoto(img);
    else if (pickTarget === "scene-hero")  setSceneHero(img);
    else if (pickTarget === "scene-left")  setSceneLeft(img);
    else if (pickTarget === "scene-right") setSceneRight(img);
    else if (pickTarget === "poster")      { setPosterPhoto(img); setPosterFocalX(0.5); setPosterFocalY(0.5); }
    else if (pickTarget === "press")       setPressPhoto(img);
    else                                  setTextPhoto(img); // text/cta/features share textPhoto
  };

  const dl=()=>{const cv=document.createElement("canvas");
    // Ratio-aware modes render DIRECTLY at the export target dims —
    // photo, watermark grid, headline, footer all fill the target
    // aspect from the start. Today: cover, spotlight, savedate, press,
    // scene. Other modes (text/cta/list/stat/etc.) still render at
    // 1080×1080 and get wrapForExport-composited.
    const target = EXPORT_RATIOS[exportRatio] || EXPORT_RATIOS["1:1"];
    const focal = getModeFocal();
    // ALL slot types are now ratio-aware — renderers accept targetW/H
     // and paint the whole design (incl. background + footer + watermark)
     // at the target frame so nothing letterboxes on 4:5 / 3:4 / 9:16.
     const RATIO_AWARE_MODES = new Set(["cover", "spotlight", "savedate", "press", "scene", "photo", "countdown", "savedates", "poster", "text", "cta", "features", "list", "stat", "vibe"]);
    const isRatioAware = RATIO_AWARE_MODES.has(mode);
    const targetCfg = isRatioAware ? { targetW: target.w, targetH: target.h, focalX: focal?.x ?? 0.5, focalY: focal?.y ?? 0.5 } : {};
    if(mode==="cover") renderCover(cv,{photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,ribbon,categoryTag,coverCtaButton,align:coverAlign,band:coverBand, ...targetCfg});
    else if(mode==="list") renderList(cv,{items,accent,bgKey,dots,totalDots,listTitle,listSubtitle,photo:listPhoto,opacity:listOpacity, ...targetCfg});
    else if(mode==="stat") renderStat(cv,{statNumber,statLabel,statSub,photo:statPhoto,opacity:statOpacity,accent,bgKey,dots,totalDots, ...targetCfg});
    else if(mode==="text") renderText(cv,{textTitle,textTitleHighlights:textTitleHL,textBody,accent,bgKey,dots,totalDots,pageNum,totalPages,photo:textPhoto,textOpacity, ...targetCfg});
    else if(mode==="cta") renderCTA(cv,{ctaKicker,ctaDate,ctaVenue,ctaUrl,photo:textPhoto,accent,bgKey,dots,totalDots,opacity:textOpacity, ...targetCfg});
    else if(mode==="features") renderFeatures(cv,{featuresTitle,features,accent,bgKey,dots,totalDots,photo:textPhoto,opacity:textOpacity, ...targetCfg});
    else if(mode==="photo") renderPhotoCaption(cv,{photo:captionPhoto,caption,captionSecondary,alignment:captionAlign,accent,bgKey,dots,totalDots, ...targetCfg});
    else if(mode==="spotlight") renderSpotlight(cv,{photo:spotPhoto,spotName,spotNameHighlights:spotNameHL,spotMeta,spotTime,spotPrice,spotCta,spotNumber,align:spotAlign,band:spotBand,accent,bgKey,dots,totalDots, ...targetCfg});
    else if(mode==="countdown") renderCountdown(cv,{photo:countPhoto,countText,countEvent,countWhen,countCta,accent,bgKey,dots,totalDots,opacity:countOpacity, ...targetCfg});
    else if(mode==="savedate") renderSaveDate(cv,{photo:savePhoto,saveKicker,saveDay,saveDateBig,saveEvent,saveVenue,saveCta,accent,bgKey,dots,totalDots,opacity:saveOpacity, ...targetCfg});
    else if(mode==="savedates") renderSaveDates(cv,{photo:savesPhoto,savesHeader,savesItems,savesCta,accent,bgKey,dots,totalDots,opacity:savesOpacity, ...targetCfg});
    else if(mode==="vibe") renderVibeBoard(cv,{vibePhotos,vibeHeadline,vibeLabels,accent,bgKey,dots,totalDots, ...targetCfg});
    else if(mode==="scene") renderScene(cv,{bgPhoto:sceneBgPhoto,sceneHero,sceneLeft,sceneRight,sceneTopLabel,sceneTitle,sceneBigText,sceneLeftMeta,sceneRightMeta,sceneInfo,sceneAddress,sceneHalftone,sceneHeroScale,sceneSideScale,accent,bgKey,dots,totalDots, ...targetCfg});
    else if(mode==="poster") renderPoster(cv,{photo:posterPhoto,opacity:posterOpacity,topLine:posterTopLine,hosts:posterHosts,kicker:posterKicker,title:posterTitle,subtitle:posterSubtitle,leftList:posterLeftList,rightList:posterRightList,dressCode:posterDressCode,dateLine:posterDateLine,titleSize:posterTitleSize,titleX:posterTitleX,titleY:posterTitleY,titleAlign:posterTitleAlign,titleColor:posterTitleColor,accent,bgKey,dots,totalDots, ...targetCfg});
    else if(mode==="press") renderPress(cv,{photo:pressPhoto,topMeta:pressTopMeta,title:pressTitle,badge:pressBadge,lineup:pressLineup,genres:pressGenres,dateLine:pressDateLine,badgeBg:pressBadgeBg,badgeText:pressBadgeText,genreBg:pressGenreBg,genreText:pressGenreText,dateBg:pressDateBg,dateText:pressDateText,photoOpacity:pressPhotoOpacity,accent,bgKey,dots,totalDots, ...targetCfg});
    // Ratio-aware modes already rendered at target dims; skip the wrap
    // (which would re-composite onto another canvas). Other modes still
    // render at 1080×1080 and get center/focal-aware composited.
    const exportCv = isRatioAware ? cv : wrapForExport(cv, exportRatio, getModePrimaryPhoto(), focal);
    exportCv.toBlob(async (blob) => {
      // Pre-generate the export id so the PNG tag and the cloud record
      // share it. Tag the blob FIRST so the downloaded file is the tagged
      // version (otherwise the user's local copy is plain-untagged and the
      // re-import feature wouldn't work).
      const exportId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      let tagged = blob;
      try {
        tagged = await tagPngWithCgeExport(blob, { id: exportId, tool: "media", mode });
      } catch (err) {
        console.warn("PNG tag failed (falling back to untagged):", err);
      }
      const filename = `CGE_${mode}_slide_${exportRatio.replace(":", "x")}.png`;
      const url = URL.createObjectURL(tagged);
      const a = document.createElement("a");
      a.download = filename;
      a.href = url;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      saveExport(tagged, {
        id: exportId,
        sourceTool: "media",
        sourceMode: `${mode}-${exportRatio}`,
        name: filename,
        snapshot: makeMediaExportSnapshot("single"),
      }).catch(err => console.warn("Export archive failed:", err));
    }, "image/png");
  };

  // === SAVE DRAFT ===
  // Snapshots the current template state WITHOUT downloading a file.
  // Lives alongside finished exports in the library (kind: "draft").
  // Tapping it in the library reopens this exact state in this tool —
  // perfect for "I'm 80% done, need to come back to this on my laptop."
  const [isDrafting, setIsDrafting] = useState(false);
  const saveDraft = async () => {
    if (isDrafting) return;
    const userName = prompt(
      "Name this draft (you'll see it in Recap → Library → Exports with a DRAFT badge):",
      `${mode.toUpperCase()} draft`
    );
    if (!userName) return;
    setIsDrafting(true);
    try {
      // Render the current state into a small thumbnail blob — gives the
      // library a visual without bloating storage with the full 1080×1080.
      const thumbCv = document.createElement("canvas");
      thumbCv.width = 1080; thumbCv.height = 1080;
      const cfg = { accent, bgKey, dots, totalDots };
      if (mode === "cover") renderCover(thumbCv, {...cfg, photo, headline, highlights, subtitle, opacity, ribbon, categoryTag, coverCtaButton, align: coverAlign, band: coverBand});
      else if (mode === "list") renderList(thumbCv, {...cfg, items, listTitle, listSubtitle, photo: listPhoto, opacity: listOpacity, focalX: listFocalX, focalY: listFocalY});
      else if (mode === "stat") renderStat(thumbCv, {...cfg, statNumber, statLabel, statSub, photo: statPhoto, opacity: statOpacity, focalX: statFocalX, focalY: statFocalY});
      else if (mode === "text") renderText(thumbCv, {...cfg, textTitle, textTitleHighlights: textTitleHL, textBody, pageNum, totalPages, photo: textPhoto, textOpacity});
      else if (mode === "cta") renderCTA(thumbCv, {...cfg, ctaKicker, ctaDate, ctaVenue, ctaUrl, photo: textPhoto, opacity: textOpacity});
      else if (mode === "features") renderFeatures(thumbCv, {...cfg, featuresTitle, features, photo: textPhoto, opacity: textOpacity});
      else if (mode === "photo") renderPhotoCaption(thumbCv, {...cfg, photo: captionPhoto, caption, captionSecondary, alignment: captionAlign});
      else if (mode === "spotlight") renderSpotlight(thumbCv, {...cfg, photo: spotPhoto, spotName, spotNameHighlights: spotNameHL, spotMeta, spotTime, spotPrice, spotCta, spotNumber, align: spotAlign, band: spotBand});
      else if (mode === "countdown") renderCountdown(thumbCv, {...cfg, photo: countPhoto, countText, countEvent, countWhen, countCta, opacity: countOpacity});
      else if (mode === "savedate") renderSaveDate(thumbCv, {...cfg, photo: savePhoto, saveKicker, saveDay, saveDateBig, saveEvent, saveVenue, saveCta, opacity: saveOpacity});
      else if (mode === "savedates") renderSaveDates(thumbCv, {...cfg, photo: savesPhoto, savesHeader, savesItems, savesCta, opacity: savesOpacity});
      else if (mode === "vibe") renderVibeBoard(thumbCv, {...cfg, vibePhotos, vibeHeadline, vibeLabels});
      else if (mode === "scene") renderScene(thumbCv, {...cfg, bgPhoto: sceneBgPhoto, sceneHero, sceneLeft, sceneRight, sceneTopLabel, sceneTitle, sceneBigText, sceneLeftMeta, sceneRightMeta, sceneInfo, sceneAddress, sceneHalftone, sceneHeroScale, sceneSideScale});
      else if (mode === "poster") renderPoster(thumbCv, {...cfg, photo: posterPhoto, opacity: posterOpacity, topLine: posterTopLine, hosts: posterHosts, kicker: posterKicker, title: posterTitle, subtitle: posterSubtitle, leftList: posterLeftList, rightList: posterRightList, dressCode: posterDressCode, dateLine: posterDateLine, titleSize: posterTitleSize, titleX: posterTitleX, titleY: posterTitleY, titleAlign: posterTitleAlign, titleColor: posterTitleColor});
      else if (mode === "press") renderPress(thumbCv, {...cfg, photo: pressPhoto, topMeta: pressTopMeta, title: pressTitle, badge: pressBadge, lineup: pressLineup, genres: pressGenres, dateLine: pressDateLine, badgeBg: pressBadgeBg, badgeText: pressBadgeText, genreBg: pressGenreBg, genreText: pressGenreText, dateBg: pressDateBg, dateText: pressDateText, photoOpacity: pressPhotoOpacity});

      const thumbBlob = await new Promise(r => thumbCv.toBlob(r, "image/png"));
      const fname = `DRAFT_${mode}_${userName.replace(/[^a-z0-9]/gi, "_")}.png`;
      await saveExport(thumbBlob, {
        sourceTool: "media",
        sourceMode: `${mode}-draft`,
        name: fname,
        kind: "draft",
        snapshot: makeMediaExportSnapshot("single"),
      });
      alert(`Draft "${userName}" saved.\n\nFind it in Recap → Library → Exports, look for the DRAFT badge.`);
    } catch (err) {
      console.error(err);
      alert("Save draft failed: " + (err.message || err));
    } finally {
      setIsDrafting(false);
    }
  };

  const MODES=[["cover","Cover"],["list","List"],["stat","Stat"],["text","Text"],["cta","CTA"],["features","Features"],["photo","Photo"],["spotlight","Spotlight"],["countdown","Countdown"],["savedate","Save Date"],["savedates","Save Dates"],["vibe","Vibe Board"],["scene","Scene"],["poster","Poster"],["press","Press"]];

  // isAutoGen is the "I'm busy exporting the carousel ZIP" flag —
  // legacy name from when this also drove auto-template generation.
  // The old autoGenerateCarousel / generateClientEventCarousel paths
  // were removed; their use cases are now covered by Roundup Generator,
  // ✨ AI Fill Template, and the Carousel Template Library.
  const [isAutoGen, setIsAutoGen] = useState(false);

  // === CAROUSEL COMPOSER ===
  const renderSlide = (cv, type, s, dotsNum, dotsTot, slideIdx = 0, exportTarget = null) => {
    // Effective bgKey — apply Brand Kit's alternateColors swap on odd
    // carousel slides. Live previews call with idx=0 so they aren't
    // affected; thumbnails + export pass the real index.
    const effBgKey = (alternateColors && slideIdx > 0 && slideIdx % 2 === 1)
      ? alternateBgKey
      : s.bgKey;
    const common = { accent: s.accent, dots: dotsNum, totalDots: dotsTot };
    // exportTarget = { w, h } when the caller wants this slide rendered
    // at non-1:1 dimensions (ZIP export at 4:5 / 9:16 / 3:4). For the
    // 5 ratio-aware modes (cover/spotlight/savedate/press/scene),
    // forward target dims + focal from the snapshot to the renderer.
    // Other modes ignore and render at 1080×1080; the caller wraps them
    // via wrapForExport.
    const RATIO_AWARE_ZIP_MODES = new Set(["cover", "spotlight", "savedate", "press", "scene", "photo", "countdown", "savedates", "poster", "text", "cta", "features", "list", "stat", "vibe"]);
    const FOCAL_KEY_MAP = {
      cover:     ["coverFocalX",   "coverFocalY"],
      list:      ["listFocalX",    "listFocalY"],
      spotlight: ["spotFocalX",    "spotFocalY"],
      savedate:  ["saveFocalX",    "saveFocalY"],
      press:     ["pressFocalX",   "pressFocalY"],
      scene:     ["sceneFocalX",   "sceneFocalY"],
      photo:     ["captionFocalX", "captionFocalY"],
      stat:      ["statFocalX",    "statFocalY"],
      countdown: ["countFocalX",   "countFocalY"],
      savedates: ["savesFocalX",   "savesFocalY"],
      poster:    ["posterFocalX",  "posterFocalY"],
    };
    const buildTargetCfg = () => {
      const keys = FOCAL_KEY_MAP[type] || [];
      const cfg = {};
      // Focal point always applies — even at 1080×1080 a non-square source
      // photo is cover-fit into the square, so focalX/focalY change which
      // part stays visible. Gating focal on `exportTarget` (as before) meant
      // the picker did nothing in the live preview, the thumbnails, or square
      // exports — it only kicked in for non-square ZIP ratios. That's why it
      // looked broken. Compute focal unconditionally; add target dims only
      // when a non-square export asks for them.
      if (keys.length) {
        cfg.focalX = typeof s[keys[0]] === "number" ? s[keys[0]] : 0.5;
        cfg.focalY = typeof s[keys[1]] === "number" ? s[keys[1]] : 0.5;
      }
      if (exportTarget && RATIO_AWARE_ZIP_MODES.has(type)) {
        cfg.targetW = exportTarget.w;
        cfg.targetH = exportTarget.h;
      }
      return cfg;
    };
    const targetCfg = buildTargetCfg();
    if (type === "cover") renderCover(cv, { ...common, photo: s.photo, headline: s.headline,
      highlights: s.highlights instanceof Set ? s.highlights : new Set(s.highlights || []),
      subtitle: s.subtitle, opacity: s.opacity, ribbon: s.ribbon, categoryTag: s.categoryTag,
      coverCtaButton: s.coverCtaButton, align: s.coverAlign, band: s.coverBand, ...targetCfg });
    else if (type === "list") renderList(cv, { ...common, items: s.items, bgKey: effBgKey,
      listTitle: s.listTitle, listSubtitle: s.listSubtitle, photo: s.photo, opacity: s.listOpacity, ...targetCfg });
    else if (type === "stat") renderStat(cv, { ...common, statNumber: s.statNumber,
      statLabel: s.statLabel, statSub: s.statSub, photo: s.photo, opacity: s.statOpacity,
      bgKey: effBgKey, ...targetCfg });
    else if (type === "text") renderText(cv, { ...common, textTitle: s.textTitle,
      textTitleHighlights: s.textTitleHL instanceof Set ? s.textTitleHL : new Set(s.textTitleHL || []),
      textBody: s.textBody, bgKey: effBgKey, pageNum: s.pageNum, totalPages: s.totalPages,
      photo: s.photo, textOpacity: s.textOpacity, ...targetCfg });
    else if (type === "cta") renderCTA(cv, { ...common, ctaKicker: s.ctaKicker, ctaDate: s.ctaDate,
      ctaVenue: s.ctaVenue, ctaUrl: s.ctaUrl, photo: s.photo, bgKey: effBgKey, opacity: s.textOpacity, ...targetCfg });
    else if (type === "features") renderFeatures(cv, { ...common, featuresTitle: s.featuresTitle,
      features: s.features, bgKey: effBgKey, photo: s.photo, opacity: s.textOpacity, ...targetCfg });
    else if (type === "photo") renderPhotoCaption(cv, { ...common, photo: s.photo,
      caption: s.caption, captionSecondary: s.captionSecondary, alignment: s.captionAlign,
      bgKey: effBgKey, ...targetCfg });
    else if (type === "spotlight") renderSpotlight(cv, { ...common, photo: s.photo,
      spotName: s.spotName, spotNameHighlights: s.spotNameHL, spotMeta: s.spotMeta,
      spotTime: s.spotTime, spotPrice: s.spotPrice, spotCta: s.spotCta,
      spotNumber: s.spotNumber, align: s.spotAlign, band: s.spotBand, bgKey: effBgKey, ...targetCfg });
    else if (type === "countdown") renderCountdown(cv, { ...common, photo: s.photo,
      countText: s.countText, countEvent: s.countEvent, countWhen: s.countWhen,
      countCta: s.countCta, bgKey: effBgKey, opacity: s.countOpacity, ...targetCfg });
    else if (type === "savedate") renderSaveDate(cv, { ...common, photo: s.photo,
      saveKicker: s.saveKicker, saveDay: s.saveDay, saveDateBig: s.saveDateBig,
      saveEvent: s.saveEvent, saveVenue: s.saveVenue, saveCta: s.saveCta,
      bgKey: effBgKey, opacity: s.saveOpacity, ...targetCfg });
    else if (type === "savedates") renderSaveDates(cv, { ...common, photo: s.photo,
      savesHeader: s.savesHeader, savesItems: s.savesItems, savesCta: s.savesCta,
      bgKey: effBgKey, opacity: s.savesOpacity, ...targetCfg });
    else if (type === "vibe") renderVibeBoard(cv, { ...common, vibePhotos: s.vibePhotos,
      vibeHeadline: s.vibeHeadline, vibeLabels: s.vibeLabels, bgKey: effBgKey, ...targetCfg });
    else if (type === "scene") renderScene(cv, { ...common, bgPhoto: s.bgPhoto,
      sceneHero: s.sceneHero, sceneLeft: s.sceneLeft, sceneRight: s.sceneRight,
      sceneTopLabel: s.sceneTopLabel, sceneTitle: s.sceneTitle, sceneBigText: s.sceneBigText,
      sceneLeftMeta: s.sceneLeftMeta, sceneRightMeta: s.sceneRightMeta,
      sceneInfo: s.sceneInfo, sceneAddress: s.sceneAddress,
      sceneHalftone: s.sceneHalftone, sceneHeroScale: s.sceneHeroScale, sceneSideScale: s.sceneSideScale,
      bgKey: effBgKey, ...targetCfg });
    else if (type === "poster") renderPoster(cv, { ...common, photo: s.photo,
      opacity: s.posterOpacity,
      topLine: s.posterTopLine, hosts: s.posterHosts, kicker: s.posterKicker,
      title: s.posterTitle, subtitle: s.posterSubtitle,
      leftList: s.posterLeftList, rightList: s.posterRightList,
      dressCode: s.posterDressCode, dateLine: s.posterDateLine,
      titleSize: s.posterTitleSize, titleX: s.posterTitleX, titleY: s.posterTitleY,
      titleAlign: s.posterTitleAlign, titleColor: s.posterTitleColor,
      bgKey: effBgKey, ...targetCfg });
    else if (type === "press") renderPress(cv, { ...common, photo: s.photo,
      topMeta: s.pressTopMeta, title: s.pressTitle, badge: s.pressBadge,
      lineup: s.pressLineup, genres: s.pressGenres, dateLine: s.pressDateLine,
      badgeBg: s.pressBadgeBg, badgeText: s.pressBadgeText,
      genreBg: s.pressGenreBg, genreText: s.pressGenreText,
      dateBg: s.pressDateBg, dateText: s.pressDateText,
      photoOpacity: s.pressPhotoOpacity, bgKey: effBgKey, ...targetCfg });
  };

  const makeSnapshot = () => {
    const common = { accent, accentKey, bgKey };
    switch (mode) {
      case "cover": return { ...common, photo, headline, highlights, subtitle, opacity, ribbon, categoryTag, coverCtaButton, coverAlign, coverBand, coverFocalX, coverFocalY };
      case "list": return { ...common, items: items.map(x=>({...x})), listTitle, listSubtitle, photo: listPhoto, listOpacity, listFocalX, listFocalY };
      case "stat": return { ...common, statNumber, statLabel, statSub, photo: statPhoto, statOpacity, statFocalX, statFocalY };
      case "text": return { ...common, textTitle, textTitleHL, textBody, photo: textPhoto, textOpacity, pageNum, totalPages };
      case "cta": return { ...common, ctaKicker, ctaDate, ctaVenue, ctaUrl, photo: textPhoto, textOpacity };
      case "features": return { ...common, featuresTitle, features: features.map(f=>({...f})), photo: textPhoto, textOpacity };
      case "photo": return { ...common, photo: captionPhoto, caption, captionSecondary, captionAlign, captionFocalX, captionFocalY };
      case "spotlight": return { ...common, photo: spotPhoto, spotName, spotNameHL, spotMeta, spotTime, spotPrice, spotCta, spotNumber, spotAlign, spotBand, spotFocalX, spotFocalY };
      case "countdown": return { ...common, photo: countPhoto, countText, countEvent, countWhen, countCta, countOpacity, countFocalX, countFocalY };
      case "savedate":  return { ...common, photo: savePhoto, saveKicker, saveDay, saveDateBig, saveEvent, saveVenue, saveCta, saveOpacity, saveFocalX, saveFocalY };
      case "savedates": return { ...common, photo: savesPhoto, savesHeader, savesItems: savesItems.map(x=>({...x})), savesCta, savesOpacity, savesFocalX, savesFocalY };
      case "vibe":      return { ...common, vibePhotos: [...vibePhotos], vibeHeadline, vibeLabels: [...vibeLabels] };
      case "scene":     return { ...common, bgPhoto: sceneBgPhoto, sceneHero, sceneLeft, sceneRight, sceneTopLabel, sceneTitle, sceneBigText, sceneLeftMeta, sceneRightMeta, sceneInfo, sceneAddress, sceneHalftone, sceneHeroScale, sceneSideScale, sceneFocalX, sceneFocalY };
      case "poster":    return { ...common, photo: posterPhoto, posterOpacity, posterTopLine, posterHosts, posterKicker, posterTitle, posterSubtitle, posterLeftList, posterRightList, posterDressCode, posterDateLine, posterTitleSize, posterTitleX, posterTitleY, posterTitleAlign, posterTitleColor, posterFocalX, posterFocalY };
      case "press":     return { ...common, photo: pressPhoto, pressTopMeta: [...pressTopMeta], pressTitle, pressBadge, pressLineup, pressGenres, pressDateLine, pressGenreBg, pressGenreText, pressDateBg, pressDateText, pressBadgeBg, pressBadgeText, pressPhotoOpacity, pressFocalX, pressFocalY };
      default: return common;
    }
  };

  const loadSnapshot = (snapshot, type) => {
    setMode(type);
    if (snapshot.accentKey) setAccentKey(snapshot.accentKey);
    if (snapshot.bgKey) setBgKey(snapshot.bgKey);
    switch (type) {
      case "cover":
        setPhoto(snapshot.photo); setHeadline(snapshot.headline);
        setHighlights(snapshot.highlights instanceof Set ? new Set(snapshot.highlights) : new Set(snapshot.highlights || []));
        setSubtitle(snapshot.subtitle); setOpacity(snapshot.opacity); setRibbon(snapshot.ribbon || "");
        setCategoryTag(snapshot.categoryTag || "");
        // coverCtaButton may be missing on older snapshots — empty default.
        setCoverCtaButton(snapshot.coverCtaButton || "");
        // Alignment + text band — default to the classic left / no-band look
        // when absent (older snapshots predate these fields).
        setCoverAlign(snapshot.coverAlign === "center" ? "center" : "left");
        setCoverBand(!!snapshot.coverBand);
        // Cover focal point — defaults to center when missing (older snapshots).
        setCoverFocalX(typeof snapshot.coverFocalX === "number" ? snapshot.coverFocalX : 0.5);
        setCoverFocalY(typeof snapshot.coverFocalY === "number" ? snapshot.coverFocalY : 0.5);
        break;
      case "list":
        setItems(snapshot.items.map(x=>({...x})));
        setListTitle(snapshot.listTitle); setListSubtitle(snapshot.listSubtitle);
        setListPhoto(snapshot.photo || null);
        if (typeof snapshot.listOpacity === "number") setListOpacity(snapshot.listOpacity);
        setListFocalX(typeof snapshot.listFocalX === "number" ? snapshot.listFocalX : 0.5);
        setListFocalY(typeof snapshot.listFocalY === "number" ? snapshot.listFocalY : 0.5);
        break;
      case "stat":
        setStatNumber(snapshot.statNumber); setStatLabel(snapshot.statLabel); setStatSub(snapshot.statSub);
        // Optional background photo — older snapshots have none (null).
        setStatPhoto(snapshot.photo || null);
        if (typeof snapshot.statOpacity === "number") setStatOpacity(snapshot.statOpacity);
        setStatFocalX(typeof snapshot.statFocalX === "number" ? snapshot.statFocalX : 0.5);
        setStatFocalY(typeof snapshot.statFocalY === "number" ? snapshot.statFocalY : 0.5);
        break;
      case "text":
        setTextTitle(snapshot.textTitle);
        setTextTitleHL(snapshot.textTitleHL instanceof Set ? new Set(snapshot.textTitleHL) : new Set(snapshot.textTitleHL || []));
        setTextBody(snapshot.textBody); setTextPhoto(snapshot.photo); setTextOpacity(snapshot.textOpacity);
        setPageNum(snapshot.pageNum); setTotalPages(snapshot.totalPages);
        break;
      case "cta":
        setCtaKicker(snapshot.ctaKicker); setCtaDate(snapshot.ctaDate);
        setCtaVenue(snapshot.ctaVenue); setCtaUrl(snapshot.ctaUrl);
        setTextPhoto(snapshot.photo); setTextOpacity(snapshot.textOpacity);
        break;
      case "features":
        setFeaturesTitle(snapshot.featuresTitle);
        setFeatures(snapshot.features.map(f=>({...f})));
        setTextPhoto(snapshot.photo); setTextOpacity(snapshot.textOpacity);
        break;
      case "photo":
        setCaptionPhoto(snapshot.photo); setCaption(snapshot.caption);
        setCaptionSecondary(snapshot.captionSecondary); setCaptionAlign(snapshot.captionAlign);
        setCaptionFocalX(typeof snapshot.captionFocalX === "number" ? snapshot.captionFocalX : 0.5);
        setCaptionFocalY(typeof snapshot.captionFocalY === "number" ? snapshot.captionFocalY : 0.5);
        break;
      case "spotlight":
        setSpotPhoto(snapshot.photo);
        setSpotName(snapshot.spotName || ""); setSpotMeta(snapshot.spotMeta || "");
        setSpotTime(snapshot.spotTime || ""); setSpotPrice(snapshot.spotPrice || "");
        setSpotCta(snapshot.spotCta || "");
        // spotNumber is optional and may be missing on older snapshots —
        // default to empty string (renderer treats falsy as "no badge").
        setSpotNumber(snapshot.spotNumber || "");
        setSpotAlign(snapshot.spotAlign === "center" ? "center" : "left");
        setSpotBand(!!snapshot.spotBand);
        // spotNameHL is a Set; serializeSnap converts it to an array for
        // IndexedDB / cloud storage, and deserializeSnap turns it back
        // into a Set before we land here. Older snapshots without it
        // get an empty Set.
        setSpotNameHL(snapshot.spotNameHL instanceof Set ? snapshot.spotNameHL
                    : Array.isArray(snapshot.spotNameHL) ? new Set(snapshot.spotNameHL)
                    : new Set());
        // Focal point — defaults to center on older snapshots.
        setSpotFocalX(typeof snapshot.spotFocalX === "number" ? snapshot.spotFocalX : 0.5);
        setSpotFocalY(typeof snapshot.spotFocalY === "number" ? snapshot.spotFocalY : 0.5);
        break;
      case "countdown":
        setCountPhoto(snapshot.photo);
        setCountText(snapshot.countText || ""); setCountEvent(snapshot.countEvent || "");
        setCountWhen(snapshot.countWhen || ""); setCountCta(snapshot.countCta || "");
        if (typeof snapshot.countOpacity === "number") setCountOpacity(snapshot.countOpacity);
        setCountFocalX(typeof snapshot.countFocalX === "number" ? snapshot.countFocalX : 0.5);
        setCountFocalY(typeof snapshot.countFocalY === "number" ? snapshot.countFocalY : 0.5);
        break;
      case "savedate":
        setSavePhoto(snapshot.photo);
        setSaveKicker(snapshot.saveKicker || ""); setSaveDay(snapshot.saveDay || "");
        setSaveDateBig(snapshot.saveDateBig || ""); setSaveEvent(snapshot.saveEvent || "");
        setSaveVenue(snapshot.saveVenue || ""); setSaveCta(snapshot.saveCta || "");
        if (typeof snapshot.saveOpacity === "number") setSaveOpacity(snapshot.saveOpacity);
        setSaveFocalX(typeof snapshot.saveFocalX === "number" ? snapshot.saveFocalX : 0.5);
        setSaveFocalY(typeof snapshot.saveFocalY === "number" ? snapshot.saveFocalY : 0.5);
        break;
      case "savedates":
        setSavesPhoto(snapshot.photo);
        setSavesHeader(snapshot.savesHeader || "");
        if (Array.isArray(snapshot.savesItems)) setSavesItems(snapshot.savesItems.map(x=>({...x})));
        setSavesCta(snapshot.savesCta || "");
        if (typeof snapshot.savesOpacity === "number") setSavesOpacity(snapshot.savesOpacity);
        setSavesFocalX(typeof snapshot.savesFocalX === "number" ? snapshot.savesFocalX : 0.5);
        setSavesFocalY(typeof snapshot.savesFocalY === "number" ? snapshot.savesFocalY : 0.5);
        break;
      case "vibe":
        if (Array.isArray(snapshot.vibePhotos)) setVibePhotos([...snapshot.vibePhotos]);
        setVibeHeadline(snapshot.vibeHeadline || "");
        if (Array.isArray(snapshot.vibeLabels)) setVibeLabels([...snapshot.vibeLabels]);
        break;
      case "poster":
        setPosterPhoto(snapshot.photo);
        if (typeof snapshot.posterOpacity === "number") setPosterOpacity(snapshot.posterOpacity);
        setPosterTopLine(snapshot.posterTopLine || "");
        setPosterHosts(snapshot.posterHosts || "");
        setPosterKicker(snapshot.posterKicker || "");
        setPosterTitle(snapshot.posterTitle || "");
        setPosterSubtitle(snapshot.posterSubtitle || "");
        setPosterLeftList(snapshot.posterLeftList || "");
        setPosterRightList(snapshot.posterRightList || "");
        setPosterDressCode(snapshot.posterDressCode || "");
        setPosterDateLine(snapshot.posterDateLine || "");
        if (typeof snapshot.posterTitleSize === "number") setPosterTitleSize(snapshot.posterTitleSize);
        if (typeof snapshot.posterTitleX === "number")    setPosterTitleX(snapshot.posterTitleX);
        if (typeof snapshot.posterTitleY === "number")    setPosterTitleY(snapshot.posterTitleY);
        if (typeof snapshot.posterTitleAlign === "string") setPosterTitleAlign(snapshot.posterTitleAlign);
        if (typeof snapshot.posterTitleColor === "string") setPosterTitleColor(snapshot.posterTitleColor);
        setPosterFocalX(typeof snapshot.posterFocalX === "number" ? snapshot.posterFocalX : 0.5);
        setPosterFocalY(typeof snapshot.posterFocalY === "number" ? snapshot.posterFocalY : 0.5);
        break;
      case "press":
        setPressPhoto(snapshot.photo);
        if (Array.isArray(snapshot.pressTopMeta)) setPressTopMeta([...snapshot.pressTopMeta]);
        setPressTitle(snapshot.pressTitle || "");
        setPressBadge(snapshot.pressBadge || "");
        setPressLineup(snapshot.pressLineup || "");
        setPressGenres(snapshot.pressGenres || "");
        setPressDateLine(snapshot.pressDateLine || "");
        if (typeof snapshot.pressGenreBg === "string")   setPressGenreBg(snapshot.pressGenreBg);
        if (typeof snapshot.pressGenreText === "string") setPressGenreText(snapshot.pressGenreText);
        if (typeof snapshot.pressDateBg === "string")    setPressDateBg(snapshot.pressDateBg);
        if (typeof snapshot.pressDateText === "string")  setPressDateText(snapshot.pressDateText);
        if (typeof snapshot.pressBadgeBg === "string")   setPressBadgeBg(snapshot.pressBadgeBg);
        if (typeof snapshot.pressBadgeText === "string") setPressBadgeText(snapshot.pressBadgeText);
        if (typeof snapshot.pressPhotoOpacity === "number") setPressPhotoOpacity(snapshot.pressPhotoOpacity);
        setPressFocalX(typeof snapshot.pressFocalX === "number" ? snapshot.pressFocalX : 0.5);
        setPressFocalY(typeof snapshot.pressFocalY === "number" ? snapshot.pressFocalY : 0.5);
        break;
      case "scene":
        setSceneBgPhoto(snapshot.bgPhoto);
        setSceneHero(snapshot.sceneHero);
        setSceneLeft(snapshot.sceneLeft);
        setSceneRight(snapshot.sceneRight);
        setSceneTopLabel(snapshot.sceneTopLabel || "");
        setSceneTitle(snapshot.sceneTitle || "");
        setSceneBigText(snapshot.sceneBigText || "");
        setSceneLeftMeta(snapshot.sceneLeftMeta || "");
        setSceneRightMeta(snapshot.sceneRightMeta || "");
        setSceneInfo(snapshot.sceneInfo || "");
        setSceneAddress(snapshot.sceneAddress || "");
        if (typeof snapshot.sceneHalftone === "boolean") setSceneHalftone(snapshot.sceneHalftone);
        if (typeof snapshot.sceneHeroScale === "number") setSceneHeroScale(snapshot.sceneHeroScale);
        if (typeof snapshot.sceneSideScale === "number") setSceneSideScale(snapshot.sceneSideScale);
        setSceneFocalX(typeof snapshot.sceneFocalX === "number" ? snapshot.sceneFocalX : 0.5);
        setSceneFocalY(typeof snapshot.sceneFocalY === "number" ? snapshot.sceneFocalY : 0.5);
        break;
    }
  };

  // ===== Edit-later snapshot serialization =====
  // Snapshots stored in IndexedDB must be structured-cloneable. Convert
  // HTMLImageElement → data URL on save, Set → array; reverse on load.
  //
  // Every photo-bearing field that any template uses lives in PHOTO_KEYS.
  // When adding a new template with a new photo field, append the field
  // name here and the round-trip works automatically.
  const PHOTO_KEYS = [
    "photo",        // cover / text / cta / features / photoCaption / spotlight / countdown / savedate / savedates / poster
    "bgPhoto",      // scene background
    "sceneHero",    // scene center cutout
    "sceneLeft",    // scene left cutout
    "sceneRight",   // scene right cutout
  ];
  const PHOTO_ARRAY_KEYS = [
    "vibePhotos",   // vibe board — 5 photo slots
  ];

  const imgToSrc = (v) => (v && v instanceof HTMLImageElement) ? (v.src || null) : v;

  const serializeSnap = (s) => {
    if (!s) return s;
    const out = { ...s };
    PHOTO_KEYS.forEach(k => {
      if (out[k] instanceof HTMLImageElement) out[k] = out[k].src || null;
    });
    PHOTO_ARRAY_KEYS.forEach(k => {
      if (Array.isArray(out[k])) out[k] = out[k].map(imgToSrc);
    });
    if (out.highlights instanceof Set)  out.highlights  = [...out.highlights];
    if (out.textTitleHL instanceof Set) out.textTitleHL = [...out.textTitleHL];
    if (out.spotNameHL instanceof Set)  out.spotNameHL  = [...out.spotNameHL];
    if (Array.isArray(out.items))       out.items       = out.items.map(x => ({...x}));
    if (Array.isArray(out.features))    out.features    = out.features.map(x => ({...x}));
    if (Array.isArray(out.savesItems))  out.savesItems  = out.savesItems.map(x => ({...x}));
    if (Array.isArray(out.vibeLabels))  out.vibeLabels  = [...out.vibeLabels];
    return out;
  };

  // Load a data: URL into an HTMLImageElement. Returns null if the input
  // isn't a usable data URL (handles legacy blob: URLs from older snapshots).
  const loadImgFromSrc = async (src) => {
    if (typeof src !== "string" || !src.startsWith("data:")) return null;
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    } catch { return null; }
  };

  const deserializeSnap = async (s) => {
    if (!s) return s;
    const out = { ...s };
    // Restore all simple photo fields in parallel.
    await Promise.all(PHOTO_KEYS.map(async k => {
      if (typeof out[k] === "string") out[k] = await loadImgFromSrc(out[k]);
    }));
    // Restore photo arrays in parallel.
    await Promise.all(PHOTO_ARRAY_KEYS.map(async k => {
      if (Array.isArray(out[k])) {
        out[k] = await Promise.all(out[k].map(loadImgFromSrc));
      }
    }));
    if (Array.isArray(out.highlights))  out.highlights  = new Set(out.highlights);
    if (Array.isArray(out.textTitleHL)) out.textTitleHL = new Set(out.textTitleHL);
    if (Array.isArray(out.spotNameHL))  out.spotNameHL  = new Set(out.spotNameHL);
    return out;
  };

  // Build the full Media-tool state for an export snapshot. Either a
  // single-slide bundle (the current `mode`) or the whole carousel.
  const makeMediaExportSnapshot = (kind /* "single" | "carousel" */) => {
    if (kind === "carousel") {
      return {
        v: 1, kind: "carousel", exportRatio, fontPairKey, watermark,
        carousel: carousel.map(s => ({
          id: s.id, type: s.type, thumb: s.thumb,
          snapshot: serializeSnap(s.snapshot),
        })),
      };
    }
    return {
      v: 1, kind: "single",
      mode, exportRatio, fontPairKey, watermark,
      dots, totalDots,
      snapshot: serializeSnap(makeSnapshot()),
    };
  };

  // Apply pending restore once on mount.
  const consumeRestore = useRestoreStore(s => s.consumeRestore);
  useEffect(() => {
    const snap = consumeRestore("media");
    if (!snap) return;
    (async () => {
      try {
        if (snap.exportRatio) setExportRatio(snap.exportRatio);
        if (snap.fontPairKey) setFontPairKey(snap.fontPairKey);
        if (typeof snap.watermark === "boolean") setWatermark(snap.watermark);
        if (snap.kind === "carousel" && Array.isArray(snap.carousel)) {
          const rebuilt = await Promise.all(snap.carousel.map(async s => ({
            id: s.id || `s_${Math.random().toString(36).slice(2,8)}`,
            type: s.type,
            thumb: s.thumb,
            snapshot: await deserializeSnap(s.snapshot),
          })));
          setCarousel(rebuilt);
          // Drop into the first slide for editing
          if (rebuilt[0]) {
            setMode(rebuilt[0].type);
            loadSnapshot(rebuilt[0].snapshot, rebuilt[0].type);
          }
        } else if (snap.kind === "single" && snap.snapshot && snap.mode) {
          setMode(snap.mode);
          const restored = await deserializeSnap(snap.snapshot);
          loadSnapshot(restored, snap.mode);
          if (typeof snap.dots === "number")      setDots(snap.dots);
          if (typeof snap.totalDots === "number") setTotalDots(snap.totalDots);
        }
      } catch (err) {
        console.warn("Media restore failed:", err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Composer thumbnails render on a 1080px canvas but are only ever shown at
  // ~140px in the slide strip. Stamping the full 1080px PNG as a base64
  // string cost 1-4 MB PER slide held in React state, and regenerateThumbs
  // rebuilt ALL of them on every reorder / delete / alternation toggle — tens
  // of MB of string + GC churn per edit on a long carousel. Downscale to a
  // 240px JPEG (~10-30 KB); the thumb is display-only, export renders from the
  // snapshot at full resolution on a separate path.
  const THUMB_MAX = 240;
  const canvasToThumb = (cv) => {
    const scale = Math.min(1, THUMB_MAX / Math.max(cv.width, cv.height));
    const w = Math.max(1, Math.round(cv.width * scale));
    const h = Math.max(1, Math.round(cv.height * scale));
    const t = document.createElement("canvas");
    t.width = w; t.height = h;
    t.getContext("2d").drawImage(cv, 0, 0, w, h);
    return t.toDataURL("image/jpeg", 0.72);
  };

  const addToCarousel = async () => {
    await document.fonts.ready;
    const snapshot = makeSnapshot();
    const cv = document.createElement("canvas");
    // Pass the about-to-be position for alternation; the new slide
    // sits at index = carousel.length.
    renderSlide(cv, mode, snapshot, carousel.length + 1, carousel.length + 1, carousel.length);
    const thumb = canvasToThumb(cv);
    const newId = `s_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    setCarousel(prev => {
      const next = [...prev, { id: newId, type: mode, snapshot, thumb }];
      // Advance the live preview's slide-counter to the brand-new slide so
      // the next snapshot lands at the right position automatically.
      setDots(next.length);
      setTotalDots(next.length);
      return next;
    });
    // You're now editing the slide you just added, so further tweaks update
    // it in place instead of piling up new slides. Exception: in a template
    // queue we're about to advance to the NEXT blank slot, so don't lock
    // editing onto the slide we just added.
    setEditingSlideId(templateQueue ? null : newId);
    // (We don't re-render thumbnails of earlier slides on push — they
    // were stamped with their correct position-aware bgKey at creation.
    // Reorder via drag, however, would desync; the alternation useEffect
    // below + onDrop handler regenerate thumbs as needed.)

    // Template queue auto-advance — if the user is walking through a
    // template, jump the mode to the next slot in the sequence. When the
    // sequence is exhausted, dismiss the queue with a "complete" state
    // so the banner can flash "template done" before disappearing.
    if (templateQueue) {
      const nextProgress = templateQueue.progress + 1;
      if (nextProgress < templateQueue.sequence.length) {
        setMode(templateQueue.sequence[nextProgress]);
        setTemplateQueue({ ...templateQueue, progress: nextProgress });
      } else {
        // Done — clear the queue.
        setTemplateQueue(null);
      }
    }
  };

  // Live edit-in-place. When a carousel slide is loaded for editing
  // (editingSlideId set), mirror the current form back into that slide —
  // snapshot + thumbnail — shortly after the last change, so edits show up on
  // the slide "right then and there" instead of needing a re-add. Debounced,
  // and skips no-op writes so it can't loop.
  useEffect(() => {
    if (editingSlideId == null) return;
    const t = setTimeout(() => {
      setCarousel(prev => {
        const idx = prev.findIndex(s => s.id === editingSlideId);
        if (idx < 0) return prev;
        const snapshot = makeSnapshot();
        const changed = prev[idx].type !== mode ||
          JSON.stringify(serializeSnap(prev[idx].snapshot)) !== JSON.stringify(serializeSnap(snapshot));
        if (!changed) return prev;               // no-op → no re-render → no loop
        const cv = document.createElement("canvas");
        renderSlide(cv, mode, snapshot, idx + 1, prev.length, idx);
        const next = [...prev];
        next[idx] = { ...next[idx], type: mode, snapshot, thumb: canvasToThumb(cv) };
        return next;
      });
    }, 500);
    return () => clearTimeout(t);
  }); // depless on purpose: re-arms after every render; debounce + guard = one write per edit-pause

  // Clone a slide (new id) right after it, so the user can tweak the copy's
  // details without rebuilding it. Thumbs regenerate (positions shifted).
  const duplicateSlide = (idx) => {
    setCarousel(prev => {
      if (idx < 0 || idx >= prev.length) return prev;
      const orig = prev[idx];
      const copy = { ...orig, id: `s_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, snapshot: { ...orig.snapshot } };
      return regenerateThumbs([...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]);
    });
  };

  // === CAROUSEL TEMPLATE LIBRARY ===
  // Pick a template → switch to its first slide type + start a queue
  // that auto-advances on each "+ Add Current Slide" push. The user
  // works through the template's structure one slide at a time, filling
  // each with real content (instead of pre-populating placeholder
  // snapshots that would need to be cleared).
  const startCarouselTemplate = (tpl) => {
    if (!tpl || !Array.isArray(tpl.sequence) || !tpl.sequence.length) return;
    setMode(tpl.sequence[0]);
    setTemplateQueue({
      id: tpl.id,
      name: tpl.name,
      sequence: [...tpl.sequence],
      progress: 0,
    });
  };

  // Convert one AI-generated slot payload into a full snapshot object.
  // Each slot type's AI schema is small (just the content fields); this
  // wraps it with the visual defaults (accent, opacity, bgKey, etc.) so
  // buildCarouselFromSnapshots can render and push it. Same approach as
  // generateRoundupCarousel — re-used here for AI Template Fill.
  const aiSlotToSnapshot = (slot, idx, total) => {
    const common = { accent, dots: idx + 1, totalDots: total };
    if (slot.type === "cover") {
      const headline = String(slot.headline || "").trim();
      let highlights = new Set();
      if (slot.accentWord && headline) {
        const words = headline.toUpperCase().split(/\s+/).filter(Boolean);
        const tgt = String(slot.accentWord).toUpperCase().trim();
        const i = words.findIndex(w => w.replace(/[^A-Z0-9]/g, "") === tgt.replace(/[^A-Z0-9]/g, ""));
        if (i >= 0) highlights = new Set([i]);
      }
      return { type: "cover", snapshot: {
        ...common,
        photo: null,
        headline,
        highlights,
        subtitle: String(slot.subtitle || "").trim(),
        ribbon: "",
        categoryTag: "",
        opacity: 0.85,
        coverCtaButton: "",
        coverAlign: "left",
        coverBand: false,
      }};
    }
    if (slot.type === "text") {
      return { type: "text", snapshot: {
        ...common,
        photo: null,
        textTitle: String(slot.textTitle || "").trim(),
        textTitleHL: new Set(),
        textBody: String(slot.textBody || "").trim(),
        pageNum: idx + 1,
        totalPages: total,
        textOpacity: 0.85,
        bgKey: "black",
      }};
    }
    if (slot.type === "spotlight") {
      // Auto-number multi-Spotlight templates (Feature Drop). Detect by
      // looking at the broader sequence — if there are 2+ Spotlights,
      // assign positional 1..N numbering as part of fill.
      return { type: "spotlight", snapshot: {
        ...common,
        photo: null,
        spotName: String(slot.spotName || "").trim(),
        spotNameHL: new Set(),
        spotMeta: String(slot.spotMeta || "").trim(),
        spotTime: String(slot.spotTime || "").trim(),
        spotPrice: String(slot.spotPrice || "").trim(),
        spotCta: String(slot.spotCta || "").trim(),
        spotNumber: "", // bulk-number button can add post-push
        spotAlign: "left",
        spotBand: false,
        bgKey: "black",
      }};
    }
    if (slot.type === "cta") {
      return { type: "cta", snapshot: {
        ...common,
        photo: null,
        ctaKicker: String(slot.ctaKicker || "").trim(),
        ctaDate: String(slot.ctaDate || "").trim(),
        ctaVenue: String(slot.ctaVenue || "").trim(),
        ctaUrl: String(slot.ctaUrl || "").trim(),
        textOpacity: 0.85,
        bgKey: "black",
      }};
    }
    if (slot.type === "photo") {
      // Photo slide carries AI-generated caption text; the user uploads
      // the actual image later in the carousel composer.
      return { type: "photo", snapshot: {
        ...common,
        photo: null,
        caption: String(slot.caption || "").trim(),
        captionSecondary: String(slot.captionSecondary || "").trim(),
        captionAlign: "left",
        bgKey: "black",
      }};
    }
    if (slot.type === "stat") {
      return { type: "stat", snapshot: {
        ...common,
        statNumber: String(slot.statNumber || "").trim(),
        statLabel: String(slot.statLabel || "").trim(),
        statSub: String(slot.statSub || "").trim(),
        bgKey: "purple",
      }};
    }
    if (slot.type === "countdown") {
      return { type: "countdown", snapshot: {
        ...common,
        photo: null,
        countText: String(slot.countText || "").trim(),
        countEvent: String(slot.countEvent || "").trim(),
        countWhen: String(slot.countWhen || "").trim(),
        countCta: String(slot.countCta || "").trim(),
        countOpacity: 0.78,
        bgKey: "black",
      }};
    }
    if (slot.type === "poster") {
      // Carries the magazine-flyer text; user uploads the background
      // photo in the carousel composer. Title-position controls keep
      // their defaults (centered, size 1.0).
      return { type: "poster", snapshot: {
        ...common,
        photo: null,
        posterOpacity: 0.15,
        posterTopLine: String(slot.topLine || "").trim(),
        posterHosts: String(slot.hosts || "").trim(),
        posterKicker: String(slot.kicker || "").trim(),
        posterTitle: String(slot.title || "").trim(),
        posterSubtitle: String(slot.subtitle || "").trim(),
        posterLeftList: String(slot.leftList || "").trim(),
        posterRightList: String(slot.rightList || "").trim(),
        posterDressCode: String(slot.dressCode || "").trim(),
        posterDateLine: String(slot.dateLine || "").trim(),
        posterTitleSize: 1.0,
        posterTitleX: 0,
        posterTitleY: 0,
        posterTitleAlign: "center",
        posterTitleColor: "#FB7185",
        bgKey: "black",
      }};
    }
    if (slot.type === "press") {
      // pressTopMeta must be exactly 4 entries — pad with empties if AI
      // returned fewer, truncate if more, so the renderer never crashes.
      const meta = Array.isArray(slot.pressTopMeta) ? slot.pressTopMeta.slice(0, 4) : [];
      while (meta.length < 4) meta.push("");
      return { type: "press", snapshot: {
        ...common,
        photo: null,
        pressTopMeta: meta.map(x => String(x || "")),
        pressTitle: String(slot.pressTitle || "").trim(),
        pressBadge: String(slot.pressBadge || "").trim(),
        pressLineup: String(slot.pressLineup || "").trim(),
        pressGenres: String(slot.pressGenres || "").trim(),
        pressDateLine: String(slot.pressDateLine || "").trim(),
        pressGenreBg: "#3A8B5F", pressGenreText: "#F2C94C",
        pressDateBg: "#E55F2B", pressDateText: "#0a0a0a",
        pressBadgeBg: "#D43F2F", pressBadgeText: "#FFFFFF",
        pressPhotoOpacity: 0.30,
        bgKey: "black",
      }};
    }
    if (slot.type === "features") {
      // Features expects an array of {emoji, headline, sub}. Defend
      // against missing items / wrong shapes — accept 3-5 entries.
      const raw = Array.isArray(slot.features) ? slot.features : [];
      const features = raw
        .filter(f => f && (f.headline || f.emoji))
        .slice(0, 5)
        .map(f => ({
          emoji: String(f.emoji || "✨").trim(),
          headline: String(f.headline || "").trim(),
          sub: String(f.sub || "").trim(),
        }));
      return { type: "features", snapshot: {
        ...common,
        photo: null,
        featuresTitle: String(slot.featuresTitle || "").trim(),
        features,
        textOpacity: 0.85,
        bgKey: "black",
      }};
    }
    // Fallback — return null so caller can filter
    return null;
  };

  // Best "initial topic" to seed the ✨ AI Generate modal per mode —
  // grabs the most-likely-meaningful field currently in that mode's
  // form. Falls back to "" so the user can type their own topic.
  const getAiInitialTopicFor = (mode) => {
    switch (mode) {
      case "cover":     return categoryTag || subtitle || headline || "";
      case "cta":       return ctaKicker || ctaDate || "";
      case "text":      return textTitle || "";
      case "spotlight": return spotName || "";
      case "photo":     return caption || "";
      case "stat":      return statLabel || statSub || "";
      case "countdown": return countEvent || countText || "";
      case "poster":    return posterTitle || posterKicker || "";
      case "press":     return pressTitle || pressBadge || "";
      case "features":  return featuresTitle || "";
      default:          return "";
    }
  };

  // Apply a single AI-generated option (from ✨ AI Generate modal) to
  // the current mode's form. Each mode has its own set of setters so
  // this fans out per type. Per-field guards keep null/undefined from
  // clobbering existing user input.
  const applyAiOptionToMode = (mode, opt) => {
    if (!opt) return;
    const setIf = (setter, val) => {
      if (val != null && String(val).trim() !== "") setter(String(val).trim());
    };
    if (mode === "cover") {
      const newHeadline = String(opt.headline || "").trim();
      setHeadline(newHeadline);
      if (opt.subtitle) setSubtitle(String(opt.subtitle).trim());
      if (opt.accentWord && newHeadline) {
        const words = newHeadline.toUpperCase().split(/\s+/).filter(Boolean);
        const target = String(opt.accentWord).toUpperCase().trim();
        const idx = words.findIndex(w => w.replace(/[^A-Z0-9]/g, "") === target.replace(/[^A-Z0-9]/g, ""));
        setHighlights(idx >= 0 ? new Set([idx]) : new Set());
      } else {
        setHighlights(new Set());
      }
      return;
    }
    if (mode === "cta") {
      if (opt.kicker != null) setCtaKicker(String(opt.kicker).trim());
      if (opt.mainLine != null) setCtaDate(String(opt.mainLine).trim());
      if (opt.subLine != null) setCtaVenue(String(opt.subLine).trim());
      return;
    }
    if (mode === "text") {
      setIf(setTextTitle, opt.textTitle);
      setIf(setTextBody, opt.textBody);
      setTextTitleHL(new Set());
      return;
    }
    if (mode === "spotlight") {
      setIf(setSpotName, opt.spotName);
      setIf(setSpotMeta, opt.spotMeta);
      setIf(setSpotTime, opt.spotTime);
      setIf(setSpotPrice, opt.spotPrice);
      setIf(setSpotCta, opt.spotCta);
      setSpotNameHL(new Set());
      return;
    }
    if (mode === "photo") {
      setIf(setCaption, opt.caption);
      setIf(setCaptionSecondary, opt.captionSecondary);
      return;
    }
    if (mode === "stat") {
      setIf(setStatNumber, opt.statNumber);
      setIf(setStatLabel, opt.statLabel);
      setIf(setStatSub, opt.statSub);
      return;
    }
    if (mode === "countdown") {
      setIf(setCountText, opt.countText);
      setIf(setCountEvent, opt.countEvent);
      setIf(setCountWhen, opt.countWhen);
      setIf(setCountCta, opt.countCta);
      return;
    }
    if (mode === "poster") {
      setIf(setPosterTopLine, opt.topLine);
      setIf(setPosterHosts, opt.hosts);
      setIf(setPosterKicker, opt.kicker);
      setIf(setPosterTitle, opt.title);
      setIf(setPosterSubtitle, opt.subtitle);
      setIf(setPosterLeftList, opt.leftList);
      setIf(setPosterRightList, opt.rightList);
      setIf(setPosterDressCode, opt.dressCode);
      setIf(setPosterDateLine, opt.dateLine);
      return;
    }
    if (mode === "press") {
      if (Array.isArray(opt.pressTopMeta)) {
        const meta = opt.pressTopMeta.slice(0, 4);
        while (meta.length < 4) meta.push("");
        setPressTopMeta(meta.map(x => String(x || "")));
      }
      setIf(setPressTitle, opt.pressTitle);
      setIf(setPressBadge, opt.pressBadge);
      setIf(setPressLineup, opt.pressLineup);
      setIf(setPressGenres, opt.pressGenres);
      setIf(setPressDateLine, opt.pressDateLine);
      return;
    }
    if (mode === "features") {
      setIf(setFeaturesTitle, opt.featuresTitle);
      if (Array.isArray(opt.features)) {
        const arr = opt.features
          .filter(f => f && (f.headline || f.emoji))
          .slice(0, 5)
          .map(f => ({
            emoji: String(f.emoji || "✨").trim(),
            headline: String(f.headline || "").trim(),
            sub: String(f.sub || "").trim(),
          }));
        if (arr.length) setFeatures(arr);
      }
      return;
    }
  };

  // Accept the AI-generated slides and push to carousel. Auto-numbers
  // Spotlights if there are 2+ of them (Feature Drop / listicle behavior).
  const onAiTemplateAccept = (slides /*, template */) => {
    const total = slides.length;
    const spotlightCount = slides.filter(s => s.type === "spotlight").length;
    let spotIdx = 0;
    const snapshots = slides.map((slot, idx) => {
      const built = aiSlotToSnapshot(slot, idx, total);
      if (!built) return null;
      if (built.type === "spotlight" && spotlightCount >= 2) {
        spotIdx++;
        built.snapshot.spotNumber = String(spotIdx);
      }
      return built;
    }).filter(Boolean);
    if (snapshots.length === 0) {
      alert("AI returned 0 usable slides.");
      return;
    }
    buildCarouselFromSnapshots(snapshots);
  };

  // Save the current carousel's slide-type sequence (NOT the content) as
  // a reusable custom template. The user names it; it shows up in the
  // picker dropdown alongside the built-ins for next time.
  const saveCarouselAsTemplate = () => {
    // Allow saving even 1-slide carousels so users can build templates
    // around a single Poster / Press / Cover for AI Fill to populate.
    if (carousel.length < 1) return;
    const seq = carousel.map((s) => s.type);
    const name = prompt(
      `Save this ${seq.length}-slide sequence as a reusable template.\n\n` +
      `Sequence: ${seq.join(" → ")}\n\nTemplate name:`,
      ""
    );
    if (!name) return;
    const tpl = addCustomCarouselTemplate(name, seq);
    if (tpl) {
      alert(`Saved "${tpl.name}" — ${tpl.sequence.length} slides. Available in the From Template picker for next time.`);
    }
  };

  // === EVENT TOOLS — apply Single Event data to the current template ===
  // The Event Tools panel hands us a structured event payload (name, date,
  // venue, hosts, lineup, etc.). Different templates have wildly different
  // field shapes, so each one gets its own mapping below. Fields the
  // event has that the template doesn't need are silently ignored;
  // empty fields fall through so they don't clobber existing values.
  const applyEventToCurrentMode = (d) => {
    const set = (setter, val) => { if (val !== undefined && val !== null && String(val).trim() !== "") setter(val); };
    const dateTime = [d.date, d.time].filter(Boolean).join(" · ");
    const venueArea = [d.venue, d.area].filter(Boolean).join(" · ");
    const venueAreaCity = [d.venue, d.area, d.city].filter(Boolean).join(" · ");

    switch (mode) {
      case "cover":
        set(setHeadline, d.tagline || d.name);
        set(setSubtitle, [d.venue, d.area, d.city].filter(Boolean).join(" · "));
        if (d.photo) setPhoto(d.photo);
        break;
      case "text":
        set(setTextTitle, d.name);
        set(setTextBody, d.description);
        if (d.photo) setTextPhoto(d.photo);
        break;
      case "spotlight":
        set(setSpotName, d.name);
        set(setSpotMeta, venueArea);
        set(setSpotTime, [d.date, d.time].filter(Boolean).join(" · "));
        set(setSpotCta, d.url);
        if (d.photo) setSpotPhoto(d.photo);
        break;
      case "cta":
        set(setCtaKicker, d.tagline);
        set(setCtaDate, dateTime);
        set(setCtaVenue, venueArea);
        set(setCtaUrl, d.url);
        if (d.photo) setTextPhoto(d.photo);
        break;
      case "savedate":
        set(setSaveEvent, d.name);
        set(setSaveDateBig, d.date);
        set(setSaveVenue, venueAreaCity);
        if (d.time) set(setSaveCta, d.time);
        if (d.photo) setSavePhoto(d.photo);
        break;
      case "poster":
        set(setPosterTitle, d.tagline || d.name);
        set(setPosterHosts, d.hosts);
        set(setPosterKicker, d.name);
        set(setPosterDateLine, dateTime);
        set(setPosterRightList, d.description);
        if (d.photo) setPosterPhoto(d.photo);
        break;
      case "press":
        set(setPressTitle, d.name);
        set(setPressLineup, d.lineup);
        set(setPressGenres, d.genres);
        set(setPressDateLine, dateTime);
        if (d.venue || d.area || d.city) {
          // Press has 4 top-meta cells; we fill what we can without
          // overwriting cells the user already populated.
          setPressTopMeta(prev => {
            const next = [...prev];
            if (d.venue && !next[0]?.trim()) next[0] = d.venue.toUpperCase();
            if (d.area  && !next[1]?.trim()) next[1] = d.area.toUpperCase();
            if (d.city  && !next[2]?.trim()) next[2] = d.city.toUpperCase();
            return next;
          });
        }
        if (d.photo) setPressPhoto(d.photo);
        break;
      default:
        alert(`No event mapping defined for "${mode}" mode yet — switch to a template like Cover, Spotlight, Save Date, Poster, or Press first.`);
        return;
    }
    alert(`Applied event data to ${mode} mode. Tweak the fields below and add to carousel when ready.`);
  };

  // === EVENT TOOLS — generate Roundup carousel ===
  // Build snapshot objects directly (without touching template setters)
  // for each slide in the Cover + Text + N Spotlights + CTA shape, then
  // hand them to buildCarouselFromSnapshots which renders and stages
  // them in the carousel composer.
  const generateRoundupCarousel = ({ theme, picks, style = "spotlight" }) => {
    // Total slide count differs by style:
    //   spotlight: Cover + Text + Spotlight×N + CTA closer = picks.length + 3
    //   editorial: Cover + Text + CTA×N (no separate closer) = picks.length + 2
    const total = style === "editorial" ? picks.length + 2 : picks.length + 3;

    if (carousel.length > 0 && !confirm(`Replace ${carousel.length} existing carousel slide${carousel.length === 1 ? "" : "s"} with a fresh ${total}-slide ${style === "editorial" ? "editorial" : "spotlight"} roundup?`)) return;

    // Use existing accent + dot counts so the generated slides stay on-brand.
    const common = { accent, dots: 1, totalDots: 1 };
    const snapshots = [];

    // Derive a per-event URL: explicit link → instagram.com/<handle> →
    // fall back to the theme URL. Used for the Editorial CTA cards so
    // each event gets its OWN ticket/info link, not just the bio link.
    const eventUrl = (ev) => {
      const link = (ev?.link || "").trim();
      if (link) return link;
      const ig = (ev?.igHandle || "").trim().replace(/^@+/, "");
      if (ig) return `instagram.com/${ig}`;
      return theme.url || "";
    };

    // 1. COVER — theme headline + tagline + categoryTag + cover photo
    snapshots.push({
      type: "cover",
      snapshot: {
        ...common,
        photo: theme.coverPhoto || null,
        headline: theme.headline || "",
        highlights: new Set(),
        subtitle: theme.tagline || "",
        ribbon: "",
        categoryTag: theme.categoryTag || "",
        opacity: 0.85,
      },
    });

    // 2. TEXT — theme body
    snapshots.push({
      type: "text",
      snapshot: {
        ...common,
        photo: theme.coverPhoto || null,
        textTitle: theme.bodyTitle || theme.headline || "",
        textTitleHL: new Set(),
        textBody: theme.bodyText || "",
        pageNum: 2,
        totalPages: total,
        textOpacity: 0.85,
        bgKey: "black",
      },
    });

    // 3. PER-EVENT CARDS — Spotlight or CTA depending on style.
    picks.forEach((p, i) => {
      const ev = p.event || {};
      const venueArea = [ev.venue, ev.area].filter(Boolean).join(" · ");
      const dateTime = [ev.day, ev.time].filter(Boolean).join(" · ");

      if (style === "editorial") {
        // Editorial style → CTA card per event. The big-bold slot (ctaDate
        // by field name, but actually "biggest centered text" by render)
        // gets the EVENT NAME so each card reads as a directory listing
        // headlined by what's happening. Venue + day/time stack below in
        // the venue slot. Kicker pill left blank — editorial directory
        // cards read cleaner without it.
        const venueParts = [venueArea, dateTime].filter(Boolean);
        snapshots.push({
          type: "cta",
          snapshot: {
            ...common,
            dots: i + 3,
            totalDots: total,
            photo: p.photo || theme.coverPhoto || null,
            ctaKicker: "",
            ctaDate: (ev.name || "").trim(),
            ctaVenue: venueParts.join(" · "),
            ctaUrl: eventUrl(ev),
            textOpacity: 0.85,
            bgKey: "black",
          },
        });
      } else {
        snapshots.push({
          type: "spotlight",
          snapshot: {
            ...common,
            dots: i + 3,
            totalDots: total,
            photo: p.photo || theme.coverPhoto || null,
            spotName: ev.name || "",
            spotNameHL: new Set(),
            spotMeta: venueArea,
            spotTime: dateTime,
            spotPrice: "",
            spotCta: theme.url || "",
            bgKey: "black",
          },
        });
      }
    });

    // 4. CLOSER CTA — only in spotlight style; editorial style's last CTA
    //    already functions as both the final listing and the closer.
    if (style !== "editorial") {
      snapshots.push({
        type: "cta",
        snapshot: {
          ...common,
          dots: total,
          totalDots: total,
          photo: theme.coverPhoto || null,
          ctaKicker: "",
          ctaDate: theme.ctaText || "FIND FULL LIST AT",
          ctaVenue: "",
          ctaUrl: theme.url || "",
          textOpacity: 0.85,
          bgKey: "black",
        },
      });
    }

    buildCarouselFromSnapshots(snapshots);
    alert(`Generated ${snapshots.length} slides (${style} style) → check the carousel composer below to tweak before export.`);
  };

  // Templates call this to push their snapshot list into the carousel.
  const buildCarouselFromSnapshots = (snapshots) => {
    if (carousel.length > 0 && !confirm(`Replace ${carousel.length} existing carousel slide${carousel.length===1?"":"s"} with this template?`)) return;
    const newSlides = snapshots.map((s, i) => {
      const cv = document.createElement("canvas");
      renderSlide(cv, s.type, s.snapshot, i + 1, snapshots.length, i);
      const thumb = canvasToThumb(cv);
      return {
        id: `s_${Date.now()}_${i}_${Math.random().toString(36).slice(2,4)}`,
        type: s.type, snapshot: s.snapshot, thumb,
      };
    });
    setCarousel(newSlides);
  };

  const deleteSlide = (idx) => setCarousel(p => {
    if (p[idx] && p[idx].id === editingSlideId) setEditingSlideId(null);
    return regenerateThumbs(p.filter((_, i) => i !== idx));
  });

  // Bulk-toggle numbered badges on every Spotlight in the carousel.
  // Auto-numbers them 1, 2, 3... in order of appearance (skipping non-
  // Spotlight slides between them). Clicking again clears all numbers.
  // Modes:
  //   "auto"  — set every Spotlight's spotNumber to its 1-based position
  //              in the Spotlight-only subsequence
  //   "clear" — wipe every Spotlight's spotNumber to ""
  const bulkNumberSpotlights = (mode) => {
    setCarousel(prev => {
      let spotIdx = 0;
      const updated = prev.map(slide => {
        if (slide.type !== "spotlight") return slide;
        spotIdx++;
        const newNumber = mode === "auto" ? String(spotIdx) : "";
        return { ...slide, snapshot: { ...slide.snapshot, spotNumber: newNumber } };
      });
      // Regen thumbs so the badge change shows immediately in the composer.
      return regenerateThumbs(updated);
    });
  };

  // Derived: how many Spotlights are in the carousel + how many are
  // currently numbered. Used to label the bulk button (Number vs Clear).
  const spotlightStats = (() => {
    let total = 0, numbered = 0;
    for (const s of carousel) {
      if (s.type !== "spotlight") continue;
      total++;
      if (s.snapshot?.spotNumber && String(s.snapshot.spotNumber).trim()) numbered++;
    }
    return { total, numbered };
  })();
  const clearCarousel = () => { if (confirm("Clear all carousel slides?")) setCarousel([]); };

  // Keep the slide-counter dots in sync with the carousel. Whenever the user
  // adds, removes, or reorders slides, `totalDots` snaps to the carousel
  // length and `dots` clamps into range — no more remembering to bump the
  // number-of-slides field by hand before each export.
  useEffect(() => {
    if (carousel.length === 0) return;
    setTotalDots(carousel.length);
    setDots(d => Math.min(Math.max(1, d), carousel.length));
  }, [carousel.length]);

  // Wrap a 1:1 render in the chosen export aspect. Center vertically and
  // fill the bars with the active bg color so the design extends naturally.
  // Single canvas / no-op for "1:1".
  // Get the current mode's primary background photo (the one the renderer
  // paints full-bleed). wrapForExport uses this to extend the photo into
  // the bar zones at 4:5 / 9:16 — instead of blurring a cropped square.
  const getModePrimaryPhoto = () => {
    switch (mode) {
      case "cover":     return photo;
      case "text":
      case "cta":
      case "features":  return textPhoto;
      case "photo":     return captionPhoto;
      case "spotlight": return spotPhoto;
      case "countdown": return countPhoto;
      case "savedate":  return savePhoto;
      case "savedates": return savesPhoto;
      case "scene":     return sceneBgPhoto;
      case "poster":    return posterPhoto;
      case "press":     return pressPhoto;
      default:          return null;  // list / stat / vibe — no shared bg photo
    }
  };

  // Same idea for the carousel zip export — look up the primary photo
  // from a slide's snapshot rather than current React state.
  const getSnapshotPrimaryPhoto = (type, snap) => {
    if (!snap) return null;
    if (type === "scene") return snap.bgPhoto || null;
    // Every other photo-bearing template stores its photo at snap.photo
    // (the snapshot maker uses `photo:` as the canonical key for the
    // primary background image).
    return snap.photo || null;
  };

  // === FOCAL POINT HELPERS ===
  // Return the focal point object {x, y} (0..1 normalized) for the
  // active mode's primary photo. Used by the single-slide download
  // path. Modes without their own picker return null → wrapForExport
  // falls back to center crop.
  const getModeFocal = () => {
    switch (mode) {
      case "cover":     return { x: coverFocalX,   y: coverFocalY };
      case "list":      return { x: listFocalX,    y: listFocalY };
      case "spotlight": return { x: spotFocalX,    y: spotFocalY };
      case "savedate":  return { x: saveFocalX,    y: saveFocalY };
      case "scene":     return { x: sceneFocalX,   y: sceneFocalY };
      case "press":     return { x: pressFocalX,   y: pressFocalY };
      case "photo":     return { x: captionFocalX, y: captionFocalY };
      case "stat":      return { x: statFocalX,    y: statFocalY };
      case "countdown": return { x: countFocalX,   y: countFocalY };
      case "savedates": return { x: savesFocalX,   y: savesFocalY };
      case "poster":    return { x: posterFocalX,  y: posterFocalY };
      default:          return null;
    }
  };
  // Same lookup from a snapshot (carousel ZIP path). Each mode's
  // snapshot maker stamps its focal under a mode-specific key
  // (coverFocalX/Y, spotFocalX/Y, etc.).
  const getSnapshotFocal = (type, snap) => {
    if (!snap) return null;
    const map = {
      cover:     ["coverFocalX",   "coverFocalY"],
      list:      ["listFocalX",    "listFocalY"],
      spotlight: ["spotFocalX",    "spotFocalY"],
      savedate:  ["saveFocalX",    "saveFocalY"],
      scene:     ["sceneFocalX",   "sceneFocalY"],
      press:     ["pressFocalX",   "pressFocalY"],
      photo:     ["captionFocalX", "captionFocalY"],
      stat:      ["statFocalX",    "statFocalY"],
      countdown: ["countFocalX",   "countFocalY"],
      savedates: ["savesFocalX",   "savesFocalY"],
      poster:    ["posterFocalX",  "posterFocalY"],
    };
    const keys = map[type];
    if (!keys) return null;
    const x = snap[keys[0]];
    const y = snap[keys[1]];
    if (typeof x !== "number" && typeof y !== "number") return null;
    return { x: typeof x === "number" ? x : 0.5, y: typeof y === "number" ? y : 0.5 };
  };

  const wrapForExport = (baseCanvas, ratio, sourcePhoto = null, focal = null) => {
    const target = EXPORT_RATIOS[ratio] || EXPORT_RATIOS["1:1"];
    if (ratio === "1:1" || (target.w === baseCanvas.width && target.h === baseCanvas.height)) {
      return baseCanvas;
    }
    // Focal point — 0..1 normalized, default center. Lets the user
    // pick which part of the original photo stays visible when the
    // export crops to a non-square aspect (4:5 / 3:4 / 9:16). PATH A
    // applies it to the photo bleed crop. Defaults to center so
    // existing callers without a focal pass unchanged behavior.
    const fx = focal && typeof focal.x === "number" ? Math.max(0, Math.min(1, focal.x)) : 0.5;
    const fy = focal && typeof focal.y === "number" ? Math.max(0, Math.min(1, focal.y)) : 0.5;
    const out = document.createElement("canvas");
    out.width = target.w;
    out.height = target.h;
    const ctx = out.getContext("2d");
    // Solid fallback bg in case neither path below paints every pixel
    // (defensive — both paths do paint full target, but belt + suspenders).
    ctx.fillStyle = (BG_COLORS[bgKey] && BG_COLORS[bgKey].hex) || "#000000";
    ctx.fillRect(0, 0, target.w, target.h);

    // PATH A — Real photo bleed.
    // Cover-fit the ORIGINAL photo (not the rendered square) across the
    // full target. Tall photos (4:5 / 9:16 originals) now show their
    // full vertical content in the bar zones — content the square
    // 1080×1080 render had cropped off. The rendered slide composites
    // on top, so text/graphics land exactly where the user designed
    // them, but the bleed is REAL photo, not a blurred duplicate.
    //
    // Cover math: scale = max(target.w/photo.w, target.h/photo.h).
    //   - 1080×1920 photo → 9:16 target (1080×1920): scale 1.0,
    //     uses ALL of the photo with zero crop. Best case.
    //   - 1080×1920 photo → 4:5 target (1080×1350): scale 1.0,
    //     vertically crops 285px top + 285px bottom (uses middle).
    //   - 1080×1080 square → 4:5 target: scale 1.25, stretches up to
    //     1350 tall and horizontally crops 135px each side. Bleed
    //     shows a slight zoom-in on the photo center.
    //   - Landscape 1920×1080 → 4:5 or 9:16: cover crops aggressively
    //     to fill vertical. Acceptable best-effort.
    if (sourcePhoto && sourcePhoto.width > 0 && sourcePhoto.height > 0) {
      const photoScale = Math.max(target.w / sourcePhoto.width, target.h / sourcePhoto.height);
      const pw = sourcePhoto.width * photoScale;
      const ph = sourcePhoto.height * photoScale;
      // Focal-aware offset — anchor the photo's focal point at the
      // CENTER of the target canvas. Clamp so we never expose
      // background outside the photo (max shift = dimensions of the
      // overhang we created when cover-scaling).
      let dx = (target.w / 2) - (sourcePhoto.width * fx * photoScale);
      let dy = (target.h / 2) - (sourcePhoto.height * fy * photoScale);
      dx = Math.max(target.w - pw, Math.min(0, dx));
      dy = Math.max(target.h - ph, Math.min(0, dy));
      ctx.drawImage(sourcePhoto, dx, dy, pw, ph);

      // Dark wash to keep the bleed zones in the same brightness register
      // as the rendered slide's photo+overlay center. Without it the bars
      // look noticeably brighter than the center and you can see the seam.
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.fillRect(0, 0, target.w, target.h);

      // Composite the rendered slide centered. Its photo+overlay+text
      // covers the center; the photo data underneath matches (same source,
      // different crop), so there's no visible double-image.
      const fitScale = Math.min(target.w / baseCanvas.width, target.h / baseCanvas.height);
      const dw = baseCanvas.width * fitScale;
      const dh = baseCanvas.height * fitScale;
      ctx.drawImage(baseCanvas, (target.w - dw) / 2, (target.h - dh) / 2, dw, dh);
      return out;
    }

    // PATH B — Solid bg fallback (text-only / list / stat / vibe).
    // No source photo. The earlier blurred-cover-stretch read as a
    // "soft vignette" the user disliked. Now: just fill the bleed
    // zones with the slide's solid bg color. The rendered slide
    // composites centered on top. Clean, no smear. The center area
    // (the actual 1080×1080 render) IS the content; the bleed bars
    // are extension, not duplicate.
    const bgHex = (BG_COLORS[bgKey] && BG_COLORS[bgKey].hex) || "#000000";
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, target.w, target.h);

    const fitScale = Math.min(target.w / baseCanvas.width, target.h / baseCanvas.height);
    const dw = baseCanvas.width * fitScale;
    const dh = baseCanvas.height * fitScale;
    ctx.drawImage(baseCanvas, (target.w - dw) / 2, (target.h - dh) / 2, dw, dh);
    return out;
  };

  const exportCarouselZip = async () => {
    if (carousel.length === 0 || isAutoGen) return;
    setIsAutoGen(true);
    try {
      await document.fonts.ready;
      const zip = new JSZip();
      for (let i = 0; i < carousel.length; i++) {
        const s = carousel[i];
        const cv = document.createElement("canvas");
        // Pass target dims when this slide's mode is ratio-aware
        // (cover/spotlight/savedate/press/scene). The renderer paints
        // the whole design at the target aspect; we then SKIP
        // wrapForExport below. Non-ratio-aware modes render at
        // 1080×1080 and still get photo-bleed-composited via
        // wrapForExport.
        const slideTarget = EXPORT_RATIOS[exportRatio] || EXPORT_RATIOS["1:1"];
        // Carousel ZIP: every slot type is ratio-aware now.
        const RATIO_AWARE_SLIDE_TYPES = new Set(["cover", "spotlight", "savedate", "press", "scene", "photo", "countdown", "savedates", "poster", "text", "cta", "features", "list", "stat", "vibe"]);
        const isRatioAwareSlide = RATIO_AWARE_SLIDE_TYPES.has(s.type);
        renderSlide(cv, s.type, s.snapshot, i+1, carousel.length, i, isRatioAwareSlide ? slideTarget : null);
        const exportCv = isRatioAwareSlide
          ? cv
          : wrapForExport(cv, exportRatio, getSnapshotPrimaryPhoto(s.type, s.snapshot), getSnapshotFocal(s.type, s.snapshot));
        const blob = await new Promise(r => exportCv.toBlob(r, "image/png"));
        zip.file(`CGE_carousel_${String(i+1).padStart(2,"0")}_${s.type}_${exportRatio.replace(":","x")}.png`, blob);
      }
      // Pre-generate the export id and drop a tiny `.cgeexport` sidecar
      // file inside the zip so re-importing the zip lets us identify it
      // even if it gets renamed. The sidecar's contents are JSON with
      // the id + tool + mode — same data the PNG tEXt tag carries for
      // single-slide exports.
      const exportId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      zip.file(".cgeexport", JSON.stringify({ id: exportId, tool: "media", mode: "carousel" }));
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      const zipName = `CGE_custom_carousel_${exportRatio.replace(":","x")}.zip`;
      a.href = url; a.download = zipName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      saveExport(zipBlob, { id: exportId, sourceTool: "media", sourceMode: `carousel-${exportRatio}`, name: zipName, kind: "archive", snapshot: makeMediaExportSnapshot("carousel") })
        .catch(err => console.warn("Export archive failed:", err));
    } catch (err) {
      console.error(err); alert("Export failed — see console");
    } finally {
      setIsAutoGen(false);
    }
  };

  // Drag-and-drop reorder. The original code skipped dataTransfer setup —
  // Firefox treats that as "this drag has no payload" and refuses to fire
  // drop, so the gesture silently did nothing. Setting any data + an
  // effectAllowed makes drag/drop actually work across browsers.
  const onDragStart = (e, idx) => {
    setDragIdx(idx);
    if (e && e.dataTransfer) {
      try { e.dataTransfer.setData("text/plain", String(idx)); } catch {}
      e.dataTransfer.effectAllowed = "move";
    }
  };
  const onDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  };
  const onDragEnd = () => setDragIdx(null);
  const onDrop = (e, targetIdx) => {
    if (e) e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
    setCarousel(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(targetIdx, 0, moved);
      // After reorder, slides may now sit at different alternation
      // parities — regenerate thumbs so the visible carousel matches what
      // will be exported.
      return regenerateThumbs(next);
    });
    setDragIdx(null);
  };

  // Re-render all carousel thumbnails. Called after reorder, delete, and
  // whenever alternateColors/alternateBgKey changes — keeps the visible
  // composer thumbs aligned with what export will produce.
  const regenerateThumbs = (slides) => {
    return slides.map((slide, idx) => {
      const cv = document.createElement("canvas");
      renderSlide(cv, slide.type, slide.snapshot, idx + 1, slides.length, idx);
      return { ...slide, thumb: canvasToThumb(cv) };
    });
  };

  // Watch alternation settings — when either toggles, refresh all thumbs.
  useEffect(() => {
    setCarousel(prev => prev.length === 0 ? prev : regenerateThumbs(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alternateColors, alternateBgKey]);

  return(
    <div style={{minHeight:"calc(100vh - 60px)",background:"#080808",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif",overflowX:"hidden"}}>
      <div style={{maxWidth:1150,margin:"0 auto",padding:"1.25rem",width:"100%",boxSizing:"border-box"}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem"}}>
          <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:"1.2rem",fontWeight:800,textTransform:"uppercase"}}>CGE Media Template</h1>
          <span style={{fontSize:"0.6rem",color:accent,letterSpacing:"1.5px",textTransform:"uppercase",padding:"2px 8px",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px"}}>{mode} Slide · Export {exportRatio}</span>
        </div>

        <div style={{display:"flex",gap:"0.4rem",marginBottom:"0.6rem",flexWrap:"wrap",alignItems:"center"}}>
          {/* Template (mode) picker — was a grid of 15 buttons; now a
              compact dropdown like the font picker. Keeps the top row
              tight so the preview can rise. */}
          <div style={{display:"flex",alignItems:"center",gap:"0.3rem"}}>
            <span style={{fontSize:"0.55rem",color:"#FACC15",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,fontFamily:"'Syne',sans-serif"}}>Template</span>
            <select
              value={mode}
              onChange={(e)=>setMode(e.target.value)}
              style={{
                padding:"6px 10px",
                borderRadius:"5px",
                fontSize:"0.7rem",
                fontWeight:700,
                cursor:"pointer",
                border:"2px solid #FACC15",
                background:"rgba(250,204,21,0.12)",
                color:"#FACC15",
                fontFamily:"'Syne',sans-serif",
                letterSpacing:"1px",
                textTransform:"uppercase",
                outline:"none",
              }}
            >
              {MODES.map(([k,lb])=>(
                <option key={k} value={k} style={{color:"#000"}}>{lb}</option>
              ))}
            </select>
          </div>
          <div style={{flex:1}}/>
          <div style={{display:"flex",gap:"3px",alignItems:"center",padding:"2px",border:"2px solid rgba(245,240,232,0.1)",borderRadius:"5px"}} title="Export aspect ratio — applies to single-slide downloads and carousel ZIPs">
            {Object.entries(EXPORT_RATIOS).map(([k, r]) => (
              <button
                key={k}
                onClick={()=>setExportRatio(k)}
                title={r.label}
                style={{padding:"4px 9px",borderRadius:"3px",fontSize:"0.6rem",fontWeight:700,cursor:"pointer",border:"none",background:exportRatio===k?"#A855F7":"transparent",color:exportRatio===k?"#FFF":"rgba(245,240,232,0.4)",fontFamily:"'Syne',sans-serif",letterSpacing:"1px",textTransform:"uppercase"}}
              >{k}</button>
            ))}
          </div>
          {/* Save Draft — restyled as a flat action button. The earlier
              2px purple border was reading as a mode toggle next to the
              ratio chips. Now matches the workspace-dropdown treatment
              (subtle bg, no border) so it visually groups with "actions"
              not "modes". */}
          <button
            onClick={saveDraft}
            disabled={isDrafting}
            title="Save the current state as a draft you can come back to. Lives in Library → Exports with a DRAFT badge."
            style={{padding:"6px 12px",borderRadius:"4px",fontSize:"0.6rem",fontWeight:700,cursor:isDrafting?"wait":"pointer",border:"1px solid rgba(192,132,252,0.25)",background:"rgba(192,132,252,0.08)",color:"#C084FC",fontFamily:"inherit",letterSpacing:"1px",textTransform:"uppercase",opacity:isDrafting?0.6:1,whiteSpace:"nowrap"}}
          >💾 {isDrafting ? "Saving…" : "Save draft"}</button>
          <button
            onClick={()=>setWatermark(v=>!v)}
            title="Toggle CGE logo + footer text on/off"
            style={{padding:"6px 12px",borderRadius:"5px",fontSize:"0.6rem",fontWeight:700,cursor:"pointer",border:watermark?"2px solid #34D399":"2px solid rgba(245,240,232,0.1)",background:watermark?"rgba(52,211,153,0.12)":"transparent",color:watermark?"#34D399":"rgba(245,240,232,0.4)",fontFamily:"'Syne',sans-serif",letterSpacing:"1.5px",textTransform:"uppercase"}}
          >{watermark ? "✓ Watermark" : "○ Watermark"}</button>
          <select
            value={fontPairKey}
            onChange={e=>setFontPairKey(e.target.value)}
            title="Choose a font pair · loads from Google Fonts"
            style={{padding:"6px 10px",borderRadius:"5px",fontSize:"0.6rem",fontWeight:700,cursor:"pointer",border:"2px solid rgba(245,240,232,0.1)",background:"transparent",color:"rgba(245,240,232,0.7)",fontFamily:"'Syne',sans-serif",letterSpacing:"1px",textTransform:"uppercase",outline:"none"}}
          >
            {Object.entries(FONT_PAIRS).map(([k,p])=><option key={k} value={k} style={{color:"#000"}}>{p.name}</option>)}
          </select>
        </div>

        {/* Gemini key panel — only renders when the user still NEEDS to
            paste a key. Once VITE_GEMINI_API_KEY is set in .env.local
            (or pasted into the input below), the whole block disappears
            for good. Was previously persistent ("✓ Loaded from .env.local")
            which the user only ever needed to see once. */}
        {!envKey && (
          <div style={{
            marginBottom: "1rem",
            padding: "8px 12px",
            background: "rgba(99,179,237,0.04)",
            border: "1px solid rgba(99,179,237,0.18)",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}>
            <div style={{fontSize:"0.55rem",color:"#63B3ED",letterSpacing:"1.5px",textTransform:"uppercase",flexShrink:0,fontWeight:700}}>
              Gemini Key
            </div>
            <input
              type={showKey ? "text" : "password"}
              value={uiKey}
              onChange={e=>saveKey(e.target.value)}
              placeholder="Paste key — or set VITE_GEMINI_API_KEY in .env.local + restart"
              style={{...I,flex:1,fontSize:"0.6rem"}}
            />
            <button onClick={()=>setShowKey(v=>!v)} style={{...B,padding:"5px 10px",fontSize:"0.55rem"}}>{showKey ? "Hide" : "Show"}</button>
            {uiKey && <span style={{fontSize:"0.5rem",color:"#34D399",letterSpacing:"1px"}}>✓ SAVED</span>}
          </div>
        )}

        {/* Outer 70/30 main grid — all the control bands (captions,
            carousel composer, event tools) and the form sit in the left
            column; preview is sticky-pinned in the right column so it
            rises to the top of the page and stays visible while editing.
            Constrains those wide control bands to the left 70% so they
            no longer extend full-width past the preview. */}
        <div className="cge-main-grid" style={{display:"grid",gridTemplateColumns:"7fr 3fr",gap:"1.25rem",alignItems:"start"}}>
          <div>
        {/* Captions panel — flat layout. User pushed back on collapse:
            wants Generate one tap away always. Vision toggle inline.
            Voice chip only renders when there's something to NOTICE
            (off, or no brand voice yet) — when everything's fine
            (voice ON + has content), the chip is silent. Result
            picker shows inline when captions exist. */}
        <div style={{
          marginBottom: "1rem",
          padding: "10px 14px",
          background: "rgba(99,179,237,0.04)",
          border: "1px solid rgba(99,179,237,0.18)",
          borderRadius: "6px",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:"0.5rem",flexWrap:"wrap"}}>
            <div style={{ fontSize: "0.6rem", color: "#63B3ED", letterSpacing: "1.5px", textTransform: "uppercase", flexShrink: 0, fontWeight: 700 }}>
              Captions
            </div>
            <button
              onClick={runCaptions}
              disabled={isGenCaptions || !geminiKey}
              title={
                !geminiKey
                  ? "Paste your Gemini API key above first"
                  : carousel.length > 0
                    ? `Generate 8 captions from your ${carousel.length}-slide carousel${useVision ? " (text + rendered images)" : " (text only)"}`
                    : "Carousel is empty — captions will be generated from the current form fields only. Add slides to the carousel for better results."
              }
              style={{
                padding: "8px 14px",
                background: isGenCaptions ? "rgba(99,179,237,0.4)" : (geminiKey ? "#63B3ED" : "rgba(99,179,237,0.25)"),
                color: "#000", border: "none", borderRadius: "4px",
                fontSize: "0.65rem", fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase",
                cursor: !geminiKey ? "not-allowed" : (isGenCaptions ? "wait" : "pointer"),
                fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap",
              }}
            >{isGenCaptions ? "Writing…" : (useVision && carousel.length>0 ? `👁 Captions` : `Captions${carousel.length > 0 ? ` (${carousel.length})` : ""}`)}</button>
            {/* Voice fingerprint indicator — shows whether the next Captions
                call will be primed with the Brand Kit voice. Clickable chip
                routes to /brand so the user can add more exemplars on the fly. */}
            <VoiceChip voiceEnabled={voiceEnabled} setVoiceEnabled={setVoiceEnabled} />

            <button
              onClick={()=>setUseVision(v=>!v)}
              title={
                carousel.length === 0
                  ? "Vision sends slide images to Gemini. Carousel is empty — you'll get an error if you click Captions with this on. Add slides first."
                  : useVision
                    ? `Vision ON — Captions will use the ${carousel.length} rendered slide images as visual context. Click to turn off.`
                    : `Vision OFF — Captions will use only the text in the carousel. Click to turn on (uses ${carousel.length} rendered images).`
              }
              style={{
                padding: "6px 10px",
                background: useVision ? (carousel.length > 0 ? "rgba(99,179,237,0.18)" : "rgba(251,113,133,0.12)") : "transparent",
                color: useVision ? (carousel.length > 0 ? "#63B3ED" : "#FB7185") : "rgba(245,240,232,0.4)",
                border: useVision ? (carousel.length > 0 ? "2px solid #63B3ED" : "2px solid rgba(251,113,133,0.4)") : "2px solid rgba(245,240,232,0.1)",
                borderRadius: "4px",
                fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap",
              }}
            >👁 Vision {useVision ? (carousel.length > 0 ? "ON" : "ON ⚠") : ""}</button>
          </div>

          <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", marginTop: "8px", lineHeight: 1.5 }}>
            Captions read the current carousel (or the active form if empty). Vision adds rendered images. Voice chip → Brand Kit.
          </div>

          {/* Custom tone — beyond the 8 presets, type any tone/style and it's
              written FIRST. Same idea as the AI Fill Context: templates exist,
              but you can go outside them. Save favorites as reusable chips. */}
          <div style={{ marginTop: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.55rem", color: "rgba(99,179,237,0.85)", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, flexShrink: 0 }}>Custom tone</span>
              <input
                value={captionTone}
                onChange={e => setCaptionTone(e.target.value)}
                placeholder="optional — e.g. 'dry & deadpan', 'block-party hype', 'poetic'"
                title="Type any tone to write a caption outside the 8 presets. Left blank = just the presets."
                style={{ flex: 1, minWidth: 0, padding: "6px 9px", background: "#111", border: "1px solid rgba(99,179,237,0.25)", borderRadius: 4, color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.7rem", outline: "none", boxSizing: "border-box" }}
              />
              {captionTone.trim() && !savedTones.includes(captionTone.trim()) && (
                <button onClick={() => setSavedTones(p => [...p, captionTone.trim()])} title="Save this tone as a reusable chip" style={{ padding: "5px 9px", background: "rgba(99,179,237,0.14)", color: "#63B3ED", border: "1px solid rgba(99,179,237,0.4)", borderRadius: 4, fontSize: "0.55rem", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", cursor: "pointer", fontFamily: "'Syne',sans-serif", flexShrink: 0, whiteSpace: "nowrap" }}>＋ Save</button>
              )}
              {captionTone && (
                <button onClick={() => setCaptionTone("")} title="Clear custom tone" style={{ padding: "5px 9px", background: "transparent", color: "rgba(245,240,232,0.45)", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 4, fontSize: "0.6rem", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>×</button>
              )}
            </div>
            {savedTones.length > 0 && (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
                {savedTones.map((t, i) => {
                  const active = captionTone.trim() === t;
                  return (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", borderRadius: 12, overflow: "hidden", border: `1px solid ${active ? "#63B3ED" : "rgba(99,179,237,0.3)"}`, background: active ? "rgba(99,179,237,0.18)" : "rgba(99,179,237,0.06)" }}>
                      <button onClick={() => setCaptionTone(t)} title="Use this tone" style={{ padding: "4px 9px", background: "transparent", color: active ? "#63B3ED" : "rgba(245,240,232,0.75)", border: "none", fontSize: "0.6rem", cursor: "pointer", fontFamily: "inherit", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</button>
                      <button onClick={() => setSavedTones(p => p.filter((_, j) => j !== i))} title="Remove this saved tone" style={{ padding: "4px 7px", background: "transparent", color: "rgba(245,240,232,0.4)", border: "none", borderLeft: "1px solid rgba(99,179,237,0.2)", fontSize: "0.6rem", cursor: "pointer", fontFamily: "inherit" }}>×</button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

        {captionsError && (
          <div style={{marginBottom:"1rem",padding:"10px 14px",background:"rgba(251,113,133,0.08)",border:"1px solid rgba(251,113,133,0.3)",borderRadius:"6px",fontSize:"0.6rem",color:"rgba(251,113,133,0.9)"}}>
            <strong>Captions error:</strong> {captionsError}
          </div>
        )}

        {captions.length > 0 && (() => {
          // Picker view — one caption shown at a time. Dropdown lists all
          // tone variants; selecting one swaps the visible caption + its
          // copy button. Keeps the page compact instead of stacking 8
          // full-text blocks.
          const safeIdx = Math.min(captionPickIdx, captions.length - 1);
          const current = captions[safeIdx] || {};
          return (
            <div style={{marginBottom:"1rem",display:"flex",flexDirection:"column",gap:"8px"}}>
              <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                <div style={{fontSize:"0.55rem",color:"#63B3ED",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700}}>
                  {captions.length} captions · pick a tone
                </div>
                <select
                  value={safeIdx}
                  onChange={(e)=>setCaptionPickIdx(Number(e.target.value))}
                  style={{
                    padding:"5px 10px",
                    background:"rgba(99,179,237,0.10)",
                    color:"#63B3ED",
                    border:"1px solid rgba(99,179,237,0.35)",
                    borderRadius:4,
                    fontSize:"0.65rem",
                    fontWeight:700,
                    letterSpacing:"1.5px",
                    textTransform:"uppercase",
                    cursor:"pointer",
                    fontFamily:"'Syne',sans-serif",
                  }}
                >
                  {captions.map((c,i)=>(
                    <option key={i} value={i} style={{color:"#000"}}>
                      {c.tone || `Variant ${i+1}`}
                    </option>
                  ))}
                </select>
                <button
                  onClick={()=>copyCaption(current.text || "", safeIdx)}
                  style={{
                    padding:"5px 12px",
                    background:copiedIdx===safeIdx?"#34D399":"rgba(99,179,237,0.18)",
                    color:copiedIdx===safeIdx?"#000":"#63B3ED",
                    border:"none",borderRadius:3,
                    fontSize:"0.6rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",
                    cursor:"pointer",fontFamily:"'Syne',sans-serif",
                  }}
                >
                  {copiedIdx===safeIdx?"Copied ✓":"Copy"}
                </button>
                <div style={{marginLeft:"auto",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1px",textTransform:"uppercase"}}>
                  ← {safeIdx+1} / {captions.length} →
                </div>
              </div>
              <div style={{padding:"12px 14px",background:"rgba(99,179,237,0.04)",border:"1px solid rgba(99,179,237,0.15)",borderRadius:6,fontSize:"0.7rem",lineHeight:1.6,whiteSpace:"pre-wrap",color:"rgba(245,240,232,0.85)",maxHeight:"360px",overflowY:"auto"}}>
                {current.text || ""}
              </div>
            </div>
          );
        })()}
        </div>

        {/* Template Queue banner — shown when the user is walking through
            a Carousel Template. The progress chip narrates which slot
            they're filling next so the auto-advance after each push feels
            intentional, not magic. */}
        {templateQueue && (
          <div style={{
            marginBottom: "0.5rem",
            padding: "8px 12px",
            background: "rgba(229,188,79,0.08)",
            border: "1px solid rgba(229,188,79,0.35)",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}>
            <span style={{ fontSize: "0.7rem", color: "#E5BC4F" }}>📐</span>
            <span style={{ fontSize: "0.65rem", color: "#E5BC4F", letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>
              {templateQueue.name}
            </span>
            <span style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)" }}>
              Slide {templateQueue.progress + 1} of {templateQueue.sequence.length} ·{" "}
              <strong style={{ color: "#F5F0E8" }}>
                {(MODES.find(([k]) => k === templateQueue.sequence[templateQueue.progress]) || ["", templateQueue.sequence[templateQueue.progress]])[1].toUpperCase()}
              </strong>{" "}
              {templateQueue.progress + 1 < templateQueue.sequence.length && (
                <>
                  →{" "}
                  <span style={{ color: "rgba(245,240,232,0.45)" }}>
                    next: {(MODES.find(([k]) => k === templateQueue.sequence[templateQueue.progress + 1]) || ["", templateQueue.sequence[templateQueue.progress + 1]])[1]}
                  </span>
                </>
              )}
            </span>
            <button
              onClick={() => setTemplateQueue(null)}
              style={{
                marginLeft: "auto",
                background: "transparent",
                border: "1px solid rgba(245,240,232,0.15)",
                color: "rgba(245,240,232,0.55)",
                fontSize: "0.55rem",
                padding: "3px 9px",
                borderRadius: 3,
                letterSpacing: "1px",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
              }}
              title="Stop following the template — you can keep building free-form"
            >Dismiss</button>
          </div>
        )}

        <div style={{
          marginBottom: "1rem",
          padding: "10px 12px",
          background: "rgba(168,85,247,0.04)",
          border: "1px solid rgba(168,85,247,0.18)",
          borderRadius: "6px",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:"0.5rem",marginBottom: carousel.length > 0 ? "8px" : "0",flexWrap:"wrap"}}>
            <div style={{fontSize:"0.55rem",color:"#A855F7",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,flex:"0 0 auto"}}>
              Carousel ({carousel.length})
            </div>
            <button
              onClick={addToCarousel}
              style={{padding:"6px 12px",background:"#A855F7",color:"#FFF",border:"none",borderRadius:"4px",fontSize:"0.6rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Syne',sans-serif",whiteSpace:"nowrap"}}
              title={editingSlideId ? "Add the current form as a NEW slide (a copy)" : "Snapshot the current form and add it to the carousel"}
            >{editingSlideId && carousel.some(s=>s.id===editingSlideId) ? "+ Add as New" : "+ Add Current Slide"}</button>
            {editingSlideId && carousel.some(s=>s.id===editingSlideId) && (
              <div style={{display:"flex",alignItems:"center",gap:"6px",flex:"0 0 auto"}}>
                <span style={{fontSize:"0.52rem",color:"#63B3ED",letterSpacing:"1px",textTransform:"uppercase",fontWeight:700}}>
                  ✎ Editing slide {carousel.findIndex(s=>s.id===editingSlideId)+1} · saves live
                </span>
                <button
                  onClick={()=>setEditingSlideId(null)}
                  title="Stop editing that slide and compose a fresh one — your edits are already saved to it"
                  style={{padding:"4px 8px",background:"transparent",color:"rgba(99,179,237,0.85)",border:"1px solid rgba(99,179,237,0.4)",borderRadius:"3px",fontSize:"0.5rem",fontWeight:700,letterSpacing:"0.5px",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Syne',sans-serif",whiteSpace:"nowrap"}}
                >＋ New slide</button>
              </div>
            )}
            {/* From Template picker — built-ins first, customs second.
                Picking re-starts the queue from slide 1 of that template. */}
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const tpl =
                  BUILTIN_CAROUSEL_TEMPLATES.find((t) => t.id === id) ||
                  customCarouselTemplates.find((t) => t.id === id);
                if (tpl) startCarouselTemplate(tpl);
                e.target.value = ""; // reset so re-picking the same one works
              }}
              title="Start a guided carousel template — auto-advances mode after each Add Current Slide"
              style={{
                padding: "6px 10px",
                background: "rgba(229,188,79,0.08)",
                color: "#E5BC4F",
                border: "1px solid rgba(229,188,79,0.35)",
                borderRadius: 4,
                fontSize: "0.6rem",
                fontWeight: 700,
                letterSpacing: "1px",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
              }}
            >
              <option value="" style={{ color: "#000" }}>📐 From Template…</option>
              <optgroup label="Built-in" style={{ color: "#000" }}>
                {BUILTIN_CAROUSEL_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id} style={{ color: "#000" }}>
                    {t.name} ({t.sequence.length})
                  </option>
                ))}
              </optgroup>
              {customCarouselTemplates.length > 0 && (
                <optgroup label="Your saved" style={{ color: "#000" }}>
                  {customCarouselTemplates.map((t) => (
                    <option key={t.id} value={t.id} style={{ color: "#000" }}>
                      {t.name} ({t.sequence.length})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {/* ✨ AI Fill Template — opens the AiTemplateFillModal which
                generates ALL slides in one Gemini call using brand voice
                + slot prompts. Pair this with the From Template dropdown
                (manual fill) — both compose with the same templates. */}
            <button
              onClick={() => setAiFillOpen(true)}
              title="AI-fill the whole template in one call — type topic + context, get every slide back (Cover + Text + N×Spotlight or N×CTA + Closer)"
              style={{
                padding: "6px 10px",
                background: "rgba(229,188,79,0.18)",
                color: "#E5BC4F",
                border: "1px dashed rgba(229,188,79,0.55)",
                borderRadius: 4,
                fontSize: "0.6rem",
                fontWeight: 700,
                letterSpacing: "1px",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
                whiteSpace: "nowrap",
              }}
            >✨ AI Fill Template</button>
            {carousel.length >= 2 && (
              <button
                onClick={saveCarouselAsTemplate}
                title="Save the current carousel's slide-type sequence as a reusable template (content stays with this carousel only)"
                style={{
                  padding: "6px 10px",
                  background: "transparent",
                  color: "#E5BC4F",
                  border: "1px solid rgba(229,188,79,0.35)",
                  borderRadius: 4,
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "'Syne',sans-serif",
                  whiteSpace: "nowrap",
                }}
              >💾 Save Sequence</button>
            )}
            {spotlightStats.total >= 2 && (
              <button
                onClick={() => bulkNumberSpotlights(spotlightStats.numbered >= spotlightStats.total ? "clear" : "auto")}
                title={spotlightStats.numbered >= spotlightStats.total
                  ? "Clear the numbered circle badges from every Spotlight"
                  : `Auto-number every Spotlight 1..${spotlightStats.total} in carousel order (Feature Drop / listicle treatment)`}
                style={{
                  padding: "6px 10px",
                  background: spotlightStats.numbered >= spotlightStats.total
                    ? "rgba(251,113,133,0.08)"
                    : "rgba(99,179,237,0.10)",
                  color: spotlightStats.numbered >= spotlightStats.total ? "#FB7185" : "#63B3ED",
                  border: "1px solid " + (spotlightStats.numbered >= spotlightStats.total
                    ? "rgba(251,113,133,0.35)"
                    : "rgba(99,179,237,0.35)"),
                  borderRadius: 4,
                  fontSize: "0.6rem",
                  fontWeight: 700,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "'Syne',sans-serif",
                  whiteSpace: "nowrap",
                }}
              >
                {spotlightStats.numbered >= spotlightStats.total
                  ? `× Clear ${spotlightStats.total} Numbers`
                  : `🔢 Number ${spotlightStats.total} Spotlights`}
              </button>
            )}
            {carousel.length > 0 && <>
              <button
                onClick={exportCarouselZip}
                disabled={isAutoGen}
                style={{padding:"6px 12px",background:isAutoGen?"rgba(168,85,247,0.4)":"#7C3AED",color:"#FFF",border:"none",borderRadius:"4px",fontSize:"0.6rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",cursor:isAutoGen?"wait":"pointer",fontFamily:"'Syne',sans-serif",whiteSpace:"nowrap"}}
              >{isAutoGen ? "Exporting…" : `Export ZIP (${carousel.length})`}</button>
              <button
                onClick={clearCarousel}
                style={{padding:"6px 12px",background:"transparent",color:"rgba(251,113,133,0.8)",border:"1px solid rgba(251,113,133,0.4)",borderRadius:"4px",fontSize:"0.6rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Syne',sans-serif",whiteSpace:"nowrap"}}
              >Clear</button>
              <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",marginLeft:"auto"}}>
                Drag to reorder · Click thumb to edit · Slide #s auto-update
              </div>
            </>}
          </div>
          {carousel.length > 0 && (
            <div style={{display:"flex",gap:"6px",overflowX:"auto",paddingBottom:"4px"}}>
              {carousel.map((slide, idx) => (
                <div key={slide.id} style={{display:"flex",flexDirection:"column",gap:"3px",flexShrink:0}}>
                <div
                  draggable
                  onDragStart={(e)=>onDragStart(e, idx)}
                  onDragOver={onDragOver}
                  onDragEnd={onDragEnd}
                  onDrop={(e)=>onDrop(e, idx)}
                  style={{
                    position:"relative",
                    minWidth:"86px", width:"86px", height:"86px",
                    borderRadius:"4px", overflow:"hidden",
                    cursor:"grab",
                    border: dragIdx===idx ? "2px solid #A855F7" : (editingSlideId===slide.id ? "2px solid #63B3ED" : "1px solid rgba(168,85,247,0.3)"),
                    boxShadow: editingSlideId===slide.id ? "0 0 0 2px rgba(99,179,237,0.35)" : "none",
                    background:"#000",
                    flexShrink:0,
                    opacity: dragIdx===idx ? 0.5 : 1,
                    userSelect: "none",
                  }}
                  title={`Slide ${idx+1} · ${slide.type} · click to edit (changes save to this slide), drag to reorder`}
                  onClick={()=>{
                    if (dragIdx !== null) return;
                    loadSnapshot(slide.snapshot, slide.type);
                    setEditingSlideId(slide.id);
                    setDots(idx + 1);
                    setTotalDots(carousel.length);
                  }}
                >
                  <img
                    src={slide.thumb}
                    alt={slide.type}
                    draggable={false}
                    style={{width:"100%",height:"100%",objectFit:"cover",cursor:"pointer",pointerEvents:"none"}}
                  />
                  <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.75)",padding:"2px 4px",fontSize:"0.45rem",color:"#FFF",letterSpacing:"1px",textTransform:"uppercase",fontWeight:700,textAlign:"center",pointerEvents:"none"}}>
                    {idx+1} · {slide.type}
                  </div>
                  <button
                    onClick={(e)=>{e.stopPropagation();duplicateSlide(idx);}}
                    style={{position:"absolute",top:"2px",right:"22px",width:"18px",height:"18px",background:"rgba(0,0,0,0.75)",color:"#FFF",border:"none",borderRadius:"3px",fontSize:"0.65rem",lineHeight:"16px",cursor:"pointer",padding:0,fontFamily:"sans-serif"}}
                    title="Duplicate this slide"
                  >⧉</button>
                  <button
                    onClick={(e)=>{e.stopPropagation();deleteSlide(idx);}}
                    style={{position:"absolute",top:"2px",right:"2px",width:"18px",height:"18px",background:"rgba(0,0,0,0.75)",color:"#FFF",border:"none",borderRadius:"3px",fontSize:"0.85rem",lineHeight:"14px",cursor:"pointer",padding:0,fontFamily:"sans-serif"}}
                    title="Remove from carousel"
                  >×</button>
                </div>
                {/* Per-slide photo buttons — drop a photo onto a specific
                    slide without loading it into the active form. Both
                    buttons update the slide's primary photo (cover.photo,
                    spotlight.photo, scene.bgPhoto, vibe.vibePhotos[0]) and
                    regenerate the thumbnail. */}
                <div style={{display:"flex",gap:"2px",width:"86px"}}>
                  <button
                    onClick={(e)=>{e.stopPropagation();triggerSlideUpload(slide.id);}}
                    title="Upload a photo to this slide from disk"
                    style={{flex:1,padding:"3px 0",background:"rgba(168,85,247,0.10)",color:"#A855F7",border:"1px solid rgba(168,85,247,0.30)",borderRadius:"3px",fontSize:"0.55rem",cursor:"pointer",fontFamily:"'Syne',sans-serif",letterSpacing:"0.5px",lineHeight:1}}
                  >📤</button>
                  <button
                    onClick={(e)=>{e.stopPropagation();openLibrary(`slide:${slide.id}`);}}
                    title="Pick a photo from the library for this slide"
                    style={{flex:1,padding:"3px 0",background:"rgba(168,85,247,0.10)",color:"#A855F7",border:"1px solid rgba(168,85,247,0.30)",borderRadius:"3px",fontSize:"0.55rem",cursor:"pointer",fontFamily:"'Syne',sans-serif",letterSpacing:"0.5px",lineHeight:1}}
                  >📚</button>
                </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event Tools — collapsible at the top, sits above the
            template-specific form. Two modes: Single Event (apply
            structured data to the current template's fields) and
            Roundup Generator (multi-select from Review queue → auto-
            build a Cover + Text + N Spotlights + CTA carousel). */}
        <EventToolsPanel
          currentMode={mode}
          events={events}
          onApplyToTemplate={(d) => applyEventToCurrentMode(d)}
          onGenerateRoundup={(payload) => generateRoundupCarousel(payload)}
        />

        {/* Form fields (per-mode). The outer 70/30 grid above wraps
            everything; this is just the form area inside the left column.
            cge-builder-layout class kept so the mobile media query still
            collapses to a single stacked column on small viewports. */}
        <div className="cge-builder-layout" style={{display:"block"}}>
          <div>
            {mode==="cover"&&<>
              <AiSlotBtn slot="cover" label="Cover" onClick={setAiSlotOpen} />
              {/* === PRIMARY FIELDS (always visible) === */}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo</label>
                <div style={{display:"flex",gap:"0.3rem"}}>
                  <button onClick={()=>fileRef.current?.click()} style={{...B,flex:1}}>{photo?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("cover")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {photo&&<button onClick={()=>setPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:"none"}}/>
                </div>
              </div>
              {/* Focal-point picker — only appears when a photo is loaded.
                  Click on the thumbnail to mark the part that should stay
                  visible when the export crops to 4:5 / 3:4 / 9:16. */}
              <FocalPointPicker
                photo={photo}
                focalX={coverFocalX}
                focalY={coverFocalY}
                onChange={(x, y) => { setCoverFocalX(x); setCoverFocalY(y); }}
              />
              {/* Headline first — the hero of the slide. */}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Headline</label><textarea value={headline} onChange={e=>setHeadline(e.target.value)} style={{...I,height:55,resize:"vertical"}} placeholder="Type headline..."/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Click words to highlight</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:"3px",padding:"6px",background:"#111",borderRadius:"6px",border:"1px solid rgba(245,240,232,0.04)"}}>
                  {words.map((w,i)=><button key={i} onClick={()=>toggleHL(i)} style={{padding:"3px 7px",borderRadius:"4px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:highlights.has(i)?`${accent}22`:"rgba(245,240,232,0.04)",color:highlights.has(i)?accent:"rgba(245,240,232,0.30)",border:highlights.has(i)?`2px solid ${accent}55`:"2px solid transparent"}}>{w}</button>)}
                </div></div>
              {/* Category tag — short label (kept compact on its own row).
                  Tagline below — often long ("NEWARK · NEW BRUNSWICK ·
                  JERSEY CITY + MORE") so it gets the full row width. */}
              <div style={{marginBottom:"0.6rem"}}>
                <label style={L}>Category tag · optional</label>
                <input value={categoryTag} onChange={e=>setCategoryTag(e.target.value)} style={I} placeholder="e.g. WEEKEND GUIDE · JUNETEENTH 2026"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}>
                <label style={L}>Tagline / where line · optional</label>
                <input value={subtitle} onChange={e=>setSubtitle(e.target.value)} style={I} placeholder="e.g. NEWARK · NEW BRUNSWICK · JERSEY CITY + MORE"/>
              </div>
              {/* Headline layout — alignment (left = news-tile look à la
                  @theaifield, center = classic magazine cover) + optional
                  solid band behind the text for legibility over busy photos. */}
              <div style={{marginBottom:"0.6rem",display:"flex",alignItems:"flex-end",gap:"14px",flexWrap:"wrap"}}>
                <div>
                  <label style={L}>Headline align</label>
                  <div style={{display:"flex",gap:"3px"}}>
                    {["left","center"].map(a=>(
                      <button key={a} onClick={()=>setCoverAlign(a)} style={{padding:"5px 12px",borderRadius:"5px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:coverAlign===a?`${accent}22`:"rgba(245,240,232,0.04)",color:coverAlign===a?accent:"rgba(245,240,232,0.4)",border:coverAlign===a?`2px solid ${accent}55`:"2px solid transparent"}}>{a}</button>
                    ))}
                  </div>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:"6px",cursor:"pointer",fontSize:"0.7rem",color:"rgba(245,240,232,0.7)",fontFamily:"'Syne',sans-serif",paddingBottom:"5px"}}>
                  <input type="checkbox" checked={coverBand} onChange={e=>setCoverBand(e.target.checked)} style={{accentColor:accent,cursor:"pointer"}}/>
                  Solid text band
                </label>
              </div>

              {/* === ADVANCED FIELDS (collapsed by default) ===
                  Ribbon + darken overlay + CTA pill button are
                  "set-and-forget" or one-off touches. Hidden behind
                  a details summary so the form isn't tall by default,
                  but a single click reveals them when needed. */}
              <details style={{marginBottom:"0.6rem",background:"rgba(245,240,232,0.02)",border:"1px solid rgba(245,240,232,0.06)",borderRadius:"6px"}}>
                <summary style={{padding:"8px 12px",cursor:"pointer",fontSize:"0.6rem",color:"rgba(245,240,232,0.5)",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,fontFamily:"'Syne',sans-serif",listStyle:"none"}}>
                  ▸ Advanced · ribbon · darken · CTA pill
                </summary>
                <div style={{padding:"0 12px 12px"}}>
                  <div style={{marginBottom:"0.6rem"}}><label style={L}>Ribbon · short kicker · optional</label><input value={ribbon} onChange={e=>setRibbon(e.target.value)} style={I} placeholder="e.g. ANNOUNCING / EXCLUSIVE / BREAKING"/></div>
                  <div style={{marginBottom:"0.6rem"}}>
                    <label style={L}>
                      Darken overlay · {Math.round(opacity*100)}% {opacity >= 0.85 ? "(photo mostly hidden)" : opacity >= 0.55 ? "(photo subtle backdrop)" : "(photo more visible)"}
                    </label>
                    <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                      <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>20%</span>
                      <input type="range" min="0.20" max="1.0" step="0.01" value={opacity} onChange={e=>setOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                      <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
                    </div>
                  </div>
                  {/* Optional pill button below the headline — for promo
                      Covers (the "Tap the link in bio" treatment). Empty
                      = no pill (default; editorial Covers stay clean). */}
                  <div>
                    <label style={L}>CTA pill button · optional · renders below headline</label>
                    <input
                      value={coverCtaButton}
                      onChange={e=>setCoverCtaButton(e.target.value.slice(0,28))}
                      style={I}
                      placeholder='e.g. TAP THE LINK · RSVP IN BIO · SEE THE LINEUP'
                      maxLength={28}
                    />
                  </div>
                </div>
              </details>
            </>}

            {mode==="list"&&<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Title</label><input value={listTitle} onChange={e=>setListTitle(e.target.value)} style={I}/></div>
                <div><label style={L}>Subtitle</label><input value={listSubtitle} onChange={e=>setListSubtitle(e.target.value)} style={I}/></div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>listFileRef.current?.click()} style={{...B,flex:1}}>{listPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("list")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {listPhoto&&<button onClick={()=>setListPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={listFileRef} type="file" accept="image/*" onChange={handleListPhoto} style={{display:"none"}}/>
                </div>
                {listPhoto&&<div style={{marginTop:"6px"}}>
                  <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                    Darken overlay · {Math.round(listOpacity*100)}%
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>20%</span>
                    <input type="range" min="0.20" max="1.0" step="0.01" value={listOpacity} onChange={e=>setListOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
                  </div>
                </div>}
              </div>
              {listPhoto&&<FocalPointPicker
                photo={listPhoto}
                focalX={listFocalX}
                focalY={listFocalY}
                onChange={(x, y) => { setListFocalX(x); setListFocalY(y); }}
              />}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background color (used when no photo)</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>
              {events.length > 0 && (
                <div style={{marginBottom:"0.6rem",padding:"0.5rem",background:"rgba(229,188,79,0.06)",border:"1px solid rgba(229,188,79,0.18)",borderRadius:"4px"}}>
                  <label style={L}>Pull from event store · {events.length} loaded</label>
                  <div style={{display:"flex",gap:"0.3rem",marginTop:"4px"}}>
                    <select value={listImportDay} onChange={e=>setListImportDay(e.target.value)} style={{...I,flex:1,fontSize:"0.65rem"}}>
                      <option value="all">All days</option>
                      <option value="Fri">Friday</option>
                      <option value="Sat">Saturday</option>
                      <option value="Sun">Sunday</option>
                    </select>
                    <button onClick={importFromStore} style={{...B,whiteSpace:"nowrap"}}>Import top 8</button>
                  </div>
                </div>
              )}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Events (click to edit · ★ to feature)</label>
                <div style={{maxHeight:240,overflowY:"auto",display:"flex",flexDirection:"column",gap:"2px"}}>
                  {items.map((item,i)=>{
                    if(editItem===i) return <div key={i} style={{display:"flex",gap:"0.2rem",padding:"0.3rem",background:"rgba(250,204,21,0.06)",borderRadius:"4px",borderLeft:`3px solid ${accent}`,alignItems:"center"}}>
                      <input value={item.name} onChange={e=>{const v=e.target.value;setItems(p=>p.map((x,j)=>j===i?{...x,name:v}:x));}} style={{...I,flex:1,fontSize:"0.6rem",padding:"3px 5px"}}/>
                      <input value={item.detail} onChange={e=>{const v=e.target.value;setItems(p=>p.map((x,j)=>j===i?{...x,detail:v}:x));}} style={{...I,flex:1,fontSize:"0.6rem",padding:"3px 5px"}}/>
                      <button onClick={()=>setEditItem(null)} style={{background:"none",border:"none",color:"#FACC15",cursor:"pointer",fontSize:"0.6rem"}}>✓</button></div>;
                    return <div key={i} style={{display:"flex",gap:"0.3rem",padding:"0.25rem 0.4rem",fontSize:"0.58rem",background:item.featured?"rgba(250,204,21,0.04)":(i%2===0?"#0e0e0e":"transparent"),borderRadius:"2px",alignItems:"center",borderLeft:item.featured?`3px solid ${accent}`:"3px solid transparent"}}>
                      <button onClick={()=>setItems(p=>p.map((x,j)=>j===i?{...x,featured:!x.featured}:x))} style={{background:"none",border:"none",color:item.featured?"#FACC15":"rgba(245,240,232,0.12)",cursor:"pointer",fontSize:"0.7rem"}}>★</button>
                      <span style={{fontWeight:700,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:item.featured?accent:"inherit",cursor:"pointer"}} onClick={()=>setEditItem(i)}>{item.name}</span>
                      <span style={{color:"rgba(245,240,232,0.3)",fontSize:"0.5rem",cursor:"pointer"}} onClick={()=>setEditItem(i)}>{item.detail}</span>
                      <button onClick={()=>setItems(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"rgba(251,113,133,0.3)",cursor:"pointer",fontSize:"0.6rem"}}>×</button></div>;
                  })}
                  <button onClick={()=>setItems(p=>[...p,{name:"New Event",detail:"Venue · Time",featured:false}])} style={{...B,marginTop:"4px",fontSize:"0.55rem"}}>+ Add Event</button>
                </div></div>
            </>}

            {mode==="stat"&&<>
              <AiSlotBtn slot="stat" label="Stat" onClick={setAiSlotOpen} />
              <div style={{display:"grid",gridTemplateColumns:"120px 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Number</label><input value={statNumber} onChange={e=>setStatNumber(e.target.value)} style={{...I,fontSize:"1.2rem",fontWeight:800,textAlign:"center",fontFamily:"'Syne'"}}/></div>
                <div><label style={L}>Label</label><input value={statLabel} onChange={e=>setStatLabel(e.target.value)} style={I}/></div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Subtitle (use \n for line breaks)</label><textarea value={statSub} onChange={e=>setStatSub(e.target.value)} style={{...I,height:50,resize:"vertical"}}/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>statFileRef.current?.click()} style={{...B,flex:1}}>{statPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("stat")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {statPhoto&&<button onClick={()=>setStatPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={statFileRef} type="file" accept="image/*" onChange={handleStatPhoto} style={{display:"none"}}/>
                </div>
                {statPhoto&&<div style={{marginTop:"6px"}}>
                  <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                    Darken overlay · {Math.round(statOpacity*100)}%
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>20%</span>
                    <input type="range" min="0.20" max="1.0" step="0.01" value={statOpacity} onChange={e=>setStatOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
                  </div>
                </div>}
              </div>
              {statPhoto&&<FocalPointPicker
                photo={statPhoto}
                focalX={statFocalX}
                focalY={statFocalY}
                onChange={(x, y) => { setStatFocalX(x); setStatFocalY(y); }}
              />}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background color (used when no photo)</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>
            </>}

            {mode==="text"&&<>
              <AiSlotBtn slot="text" label="Text" onClick={setAiSlotOpen} />
              {/* PRIMARY: title + body — the content of the manifesto slide. */}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Title</label><input value={textTitle} onChange={e=>setTextTitle(e.target.value)} style={I}/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Click words to highlight</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:"3px",padding:"6px",background:"#111",borderRadius:"6px",border:"1px solid rgba(245,240,232,0.04)"}}>
                  {textWords.map((w,i)=><button key={i} onClick={()=>toggleTextHL(i)} style={{padding:"3px 7px",borderRadius:"4px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:textTitleHL.has(i)?`${accent}22`:"rgba(245,240,232,0.04)",color:textTitleHL.has(i)?accent:"rgba(245,240,232,0.30)",border:textTitleHL.has(i)?`2px solid ${accent}55`:"2px solid transparent"}}>{w}</button>)}
                </div></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Body (wrap *text* in asterisks to bold)</label><textarea value={textBody} onChange={e=>setTextBody(e.target.value)} style={{...I,height:100,resize:"vertical"}}/></div>

              {/* ADVANCED: photo · overlay · page nums · bg color */}
              <details style={{marginBottom:"0.6rem",background:"rgba(245,240,232,0.02)",border:"1px solid rgba(245,240,232,0.06)",borderRadius:"6px"}}>
                <summary style={{padding:"8px 12px",cursor:"pointer",fontSize:"0.6rem",color:"rgba(245,240,232,0.5)",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,fontFamily:"'Syne',sans-serif",listStyle:"none"}}>
                  ▸ Advanced · photo · overlay · page numbers · bg color
                </summary>
                <div style={{padding:"0 12px 12px"}}>
                  <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo · optional</label>
                    <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                      <button onClick={()=>textFileRef.current?.click()} style={{...B,flex:1}}>{textPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                      <button onClick={()=>openLibrary("text")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                      {textPhoto&&<button onClick={()=>setTextPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                      <input ref={textFileRef} type="file" accept="image/*" onChange={handleTextPhoto} style={{display:"none"}}/>
                    </div>
                    {textPhoto&&<div style={{marginTop:"6px"}}>
                      <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                        Darken overlay · {Math.round(textOpacity*100)}% {textOpacity >= 0.85 ? "(photo mostly hidden)" : textOpacity >= 0.55 ? "(photo subtle backdrop)" : "(photo more visible)"}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                        <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>20%</span>
                        <input type="range" min="0.20" max="1.0" step="0.01" value={textOpacity} onChange={e=>setTextOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                        <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
                      </div>
                    </div>}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                    <div><label style={L}>Page #</label><input type="number" min="1" value={pageNum} onChange={e=>setPageNum(parseInt(e.target.value)||1)} style={{...I,textAlign:"center",fontWeight:700}}/></div>
                    <div><label style={L}>Total pages</label><input type="number" min="1" value={totalPages} onChange={e=>setTotalPages(parseInt(e.target.value)||1)} style={{...I,textAlign:"center",fontWeight:700}}/></div>
                  </div>
                  {!textPhoto&&<div><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px"}}>
                    {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
                </div>
              </details>
            </>}

            {mode==="cta"&&<>
              <AiSlotBtn slot="cta" label="CTA" onClick={setAiSlotOpen} />
              {/* PRIMARY: kicker · date · venue · url — the four fields
                  that drive a CTA card. Background photo + overlay + bg
                  color → Advanced (set-and-forget styling). */}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Kicker pill (top)</label><input value={ctaKicker} onChange={e=>setCtaKicker(e.target.value)} style={I} placeholder="e.g. SAVE YOUR SPOT / JOIN US"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Date (use \n for multi-line)</label><textarea value={ctaDate} onChange={e=>setCtaDate(e.target.value)} style={{...I,height:55,resize:"vertical"}} placeholder="e.g. Sunday, June 14 · 6 PM"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Venue</label><input value={ctaVenue} onChange={e=>setCtaVenue(e.target.value)} style={I} placeholder="e.g. Pickleball HQ — Aberdeen"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>URL</label><input value={ctaUrl} onChange={e=>setCtaUrl(e.target.value)} style={I} placeholder="e.g. pbdates.org"/></div>

              {/* ADVANCED: photo · overlay · bg color */}
              <details style={{marginBottom:"0.6rem",background:"rgba(245,240,232,0.02)",border:"1px solid rgba(245,240,232,0.06)",borderRadius:"6px"}}>
                <summary style={{padding:"8px 12px",cursor:"pointer",fontSize:"0.6rem",color:"rgba(245,240,232,0.5)",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,fontFamily:"'Syne',sans-serif",listStyle:"none"}}>
                  ▸ Advanced · photo · overlay · bg color
                </summary>
                <div style={{padding:"0 12px 12px"}}>
                  <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo · shares Text-mode photo</label>
                    <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                      <button onClick={()=>textFileRef.current?.click()} style={{...B,flex:1}}>{textPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                      <button onClick={()=>openLibrary("text")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                      {textPhoto&&<button onClick={()=>setTextPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                      <input ref={textFileRef} type="file" accept="image/*" onChange={handleTextPhoto} style={{display:"none"}}/>
                    </div>
                    {textPhoto&&<div style={{marginTop:"6px"}}>
                      <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                        Darken overlay · {Math.round(textOpacity*100)}% {textOpacity >= 0.85 ? "(photo mostly hidden)" : textOpacity >= 0.55 ? "(photo subtle backdrop)" : "(photo more visible)"}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                        <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>20%</span>
                        <input type="range" min="0.20" max="1.0" step="0.01" value={textOpacity} onChange={e=>setTextOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                        <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
                      </div>
                    </div>}
                  </div>
                  {!textPhoto&&<div><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px"}}>
                    {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
                </div>
              </details>
            </>}

            {mode==="photo"&&<>
              <AiSlotBtn slot="photo" label="Photo Caption" onClick={setAiSlotOpen} />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Photo</label>
                <div style={{display:"flex",gap:"0.3rem"}}>
                  <button onClick={()=>captionFileRef.current?.click()} style={{...B,flex:1}}>{captionPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("photo")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {captionPhoto&&<button onClick={()=>setCaptionPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={captionFileRef} type="file" accept="image/*" onChange={handleCaptionPhoto} style={{display:"none"}}/>
                </div>
              </div>
              <FocalPointPicker
                photo={captionPhoto}
                focalX={captionFocalX}
                focalY={captionFocalY}
                onChange={(x, y) => { setCaptionFocalX(x); setCaptionFocalY(y); }}
              />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Caption (primary)</label>
                <textarea value={caption} onChange={e=>setCaption(e.target.value)} style={{...I,height:55,resize:"vertical"}} placeholder="e.g. When the music finds you."/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Sub-caption (small, optional)</label>
                <input value={captionSecondary} onChange={e=>setCaptionSecondary(e.target.value)} style={I} placeholder="e.g. JERSEY CITY · APRIL 2026"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Alignment</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {["left","center"].map(a=><button key={a} onClick={()=>setCaptionAlign(a)} style={{padding:"5px 12px",borderRadius:"4px",cursor:"pointer",fontSize:"0.6rem",fontWeight:700,border:captionAlign===a?"2px solid #FACC15":"2px solid rgba(245,240,232,0.06)",background:captionAlign===a?"rgba(250,204,21,0.12)":"transparent",color:captionAlign===a?"#FACC15":"rgba(245,240,232,0.35)",fontFamily:"'Syne'",letterSpacing:"1px",textTransform:"uppercase"}}>{a}</button>)}
                </div></div>
              {!captionPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
            </>}

            {/* SPOTLIGHT — body slide for roundup carousels. One venue per
                slide with bolded headline-style name + address-style detail
                line + transactional footer (time, price, CTA). Use a series
                of these between a Cover and a CTA slide for a "5 spots this
                weekend" / "12 happy hours" / "8 brunches" carousel. */}
            {mode==="spotlight"&&<>
              <AiSlotBtn slot="spotlight" label="Spotlight" onClick={setAiSlotOpen} />
              {/* PRIMARY: photo · name · detail · day/time — the four
                  fields that define an event spotlight. Highlights tag
                  in-line with the name (only when name has words). */}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Venue Photo</label>
                <div style={{display:"flex",gap:"0.3rem"}}>
                  <button onClick={()=>spotFileRef.current?.click()} style={{...B,flex:1}}>{spotPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("spotlight")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {spotPhoto&&<button onClick={()=>setSpotPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={spotFileRef} type="file" accept="image/*" onChange={handleSpotPhoto} style={{display:"none"}}/>
                </div>
              </div>
              <FocalPointPicker
                photo={spotPhoto}
                focalX={spotFocalX}
                focalY={spotFocalY}
                onChange={(x, y) => { setSpotFocalX(x); setSpotFocalY(y); }}
              />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Venue / event name (headline)</label>
                <textarea value={spotName} onChange={e=>setSpotName(e.target.value)} style={{...I,height:55,resize:"vertical",fontFamily:"'Syne'"}} placeholder="e.g. ROOFTOP NIGHT AT THE STANDARD"/>
              </div>
              {spotWords.length > 0 && (
                <div style={{marginBottom:"0.6rem"}}><label style={L}>Click words to highlight</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:"3px",padding:"6px",background:"#111",borderRadius:"6px",border:"1px solid rgba(245,240,232,0.04)"}}>
                    {spotWords.map((w,i)=>(
                      <button key={i} onClick={()=>toggleSpotNameHL(i)} style={{padding:"3px 7px",borderRadius:"4px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:spotNameHL.has(i)?`${accent}22`:"rgba(245,240,232,0.04)",color:spotNameHL.has(i)?accent:"rgba(245,240,232,0.30)",border:spotNameHL.has(i)?`2px solid ${accent}55`:"2px solid transparent"}}>{w}</button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Detail line (address · city)</label>
                <input value={spotMeta} onChange={e=>setSpotMeta(e.target.value)} style={I} placeholder="e.g. 9 Clinton St | Newark"/>
              </div>
              {/* Headline layout — align (left = current, center = magazine)
                  + solid band behind the venue name for legibility on photos. */}
              <div style={{marginBottom:"0.6rem",display:"flex",alignItems:"flex-end",gap:"14px",flexWrap:"wrap"}}>
                <div>
                  <label style={L}>Name align</label>
                  <div style={{display:"flex",gap:"3px"}}>
                    {["left","center"].map(a=>(
                      <button key={a} onClick={()=>setSpotAlign(a)} style={{padding:"5px 12px",borderRadius:"5px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:spotAlign===a?`${accent}22`:"rgba(245,240,232,0.04)",color:spotAlign===a?accent:"rgba(245,240,232,0.4)",border:spotAlign===a?`2px solid ${accent}55`:"2px solid transparent"}}>{a}</button>
                    ))}
                  </div>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:"6px",cursor:"pointer",fontSize:"0.7rem",color:"rgba(245,240,232,0.7)",fontFamily:"'Syne',sans-serif",paddingBottom:"5px"}}>
                  <input type="checkbox" checked={spotBand} onChange={e=>setSpotBand(e.target.checked)} style={{accentColor:accent,cursor:"pointer"}}/>
                  Solid text band
                </label>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Day · Time</label>
                <input value={spotTime} onChange={e=>setSpotTime(e.target.value)} style={I} placeholder="Friday · 8 PM"/>
              </div>

              {/* ADVANCED: price · CTA · number badge · bg color */}
              <details style={{marginBottom:"0.6rem",background:"rgba(245,240,232,0.02)",border:"1px solid rgba(245,240,232,0.06)",borderRadius:"6px"}}>
                <summary style={{padding:"8px 12px",cursor:"pointer",fontSize:"0.6rem",color:"rgba(245,240,232,0.5)",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,fontFamily:"'Syne',sans-serif",listStyle:"none"}}>
                  ▸ Advanced · price · CTA · number badge · bg color
                </summary>
                <div style={{padding:"0 12px 12px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                    <div><label style={L}>Price</label>
                      <input value={spotPrice} onChange={e=>setSpotPrice(e.target.value)} style={I} placeholder="$30 / Free"/></div>
                    <div><label style={L}>CTA · accent</label>
                      <input value={spotCta} onChange={e=>setSpotCta(e.target.value)} style={I} placeholder="tix in bio"/></div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"110px 1fr",gap:"0.4rem",marginBottom:"0.6rem",alignItems:"end"}}>
                    <div><label style={L}>Number badge</label>
                      <input
                        value={spotNumber}
                        onChange={e=>setSpotNumber(e.target.value.slice(0,3))}
                        style={{...I,textAlign:"center",fontWeight:700,fontFamily:"'Syne',sans-serif"}}
                        placeholder="—"
                        maxLength={3}
                      />
                    </div>
                    <div style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",lineHeight:1.4,paddingBottom:"6px"}}>
                      Use for Feature Drop / listicle posts. Leave blank for editorial spotlights.
                    </div>
                  </div>
                  {!spotPhoto&&<div><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px"}}>
                    {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
                </div>
              </details>
            </>}

            {/* COUNTDOWN — big "3 WEEKS / TOMORROW / TONIGHT" anticipation
                card. Run as a series leading up to a single event (World
                Cup, NBA Finals, opening night, app launch). Each new post
                you just change countText and re-export. */}
            {mode==="countdown"&&<>
              <AiSlotBtn slot="countdown" label="Countdown" onClick={setAiSlotOpen} />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>countFileRef.current?.click()} style={{...B,flex:1}}>{countPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("countdown")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {countPhoto&&<button onClick={()=>setCountPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={countFileRef} type="file" accept="image/*" onChange={handleCountPhoto} style={{display:"none"}}/>
                </div>
                {countPhoto&&<div style={{marginTop:"6px"}}>
                  <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                    Darken overlay · {Math.round(countOpacity*100)}%
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>20%</span>
                    <input type="range" min="0.20" max="1.0" step="0.01" value={countOpacity} onChange={e=>setCountOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
                  </div>
                </div>}
              </div>
              <FocalPointPicker
                photo={countPhoto}
                focalX={countFocalX}
                focalY={countFocalY}
                onChange={(x, y) => { setCountFocalX(x); setCountFocalY(y); }}
              />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Countdown text (the big number)</label>
                <input value={countText} onChange={e=>setCountText(e.target.value)} style={I} placeholder="3 WEEKS / 1 WEEK / TOMORROW / TONIGHT"/>
                <p style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",marginTop:"3px"}}>Auto-scales; "TOMORROW" and "3 WEEKS OUT" both fit.</p>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Event name</label>
                <input value={countEvent} onChange={e=>setCountEvent(e.target.value)} style={I} placeholder="e.g. WORLD CUP OPENING NIGHT"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>When · Where (one line)</label>
                <input value={countWhen} onChange={e=>setCountWhen(e.target.value)} style={I} placeholder="Friday, June 12 · The Standard"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>CTA</label>
                <input value={countCta} onChange={e=>setCountCta(e.target.value)} style={I} placeholder="tix in bio / RSVP in bio / comment SAVE"/>
              </div>
              {!countPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",lineHeight:1.5,marginTop:"4px"}}>
                Tip: run as a series — T-3 WEEKS, T-1 WEEK, T-3 DAYS, TOMORROW, TONIGHT. Snapshot each into the carousel composer if you want a single drop that shows the full ramp; otherwise post one a week leading up.
              </p>
            </>}

            {/* SAVE THE DATE — hero announcement for ONE upcoming event.
                Lead with the date, formal energy, build anticipation
                without the urgency-ramp of Countdown. */}
            {mode==="savedate"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>saveFileRef.current?.click()} style={{...B,flex:1}}>{savePhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("savedate")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {savePhoto&&<button onClick={()=>setSavePhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={saveFileRef} type="file" accept="image/*" onChange={handleSavePhoto} style={{display:"none"}}/>
                </div>
                <FocalPointPicker
                  photo={savePhoto}
                  focalX={saveFocalX}
                  focalY={saveFocalY}
                  onChange={(x, y) => { setSaveFocalX(x); setSaveFocalY(y); }}
                />
                {savePhoto&&<div style={{marginTop:"6px"}}>
                  <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                    Darken · {Math.round(saveOpacity*100)}%
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <input type="range" min="0.20" max="1.0" step="0.01" value={saveOpacity} onChange={e=>setSaveOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                  </div>
                </div>}
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Top pill (kicker)</label>
                <input value={saveKicker} onChange={e=>setSaveKicker(e.target.value)} style={I} placeholder="SAVE THE DATE"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Day</label>
                  <input value={saveDay} onChange={e=>setSaveDay(e.target.value)} style={I} placeholder="FRIDAY"/></div>
                <div><label style={L}>Big date</label>
                  <input value={saveDateBig} onChange={e=>setSaveDateBig(e.target.value)} style={I} placeholder="JUNE 12"/></div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Event name</label>
                <input value={saveEvent} onChange={e=>setSaveEvent(e.target.value)} style={I} placeholder="WORLD CUP OPENING NIGHT"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Venue · time</label>
                <input value={saveVenue} onChange={e=>setSaveVenue(e.target.value)} style={I} placeholder="The Standard · Newark · 8 PM"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>CTA</label>
                <input value={saveCta} onChange={e=>setSaveCta(e.target.value)} style={I} placeholder="RSVP in bio / tix in bio"/>
              </div>
              {!savePhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
            </>}

            {/* SAVE THESE DATES — multi-event grid. 2 items stack as rows,
                3 stack as rows, 4 lay out as a 2×2 grid. */}
            {mode==="savedates"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>savesFileRef.current?.click()} style={{...B,flex:1}}>{savesPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("savedates")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {savesPhoto&&<button onClick={()=>setSavesPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={savesFileRef} type="file" accept="image/*" onChange={handleSavesPhoto} style={{display:"none"}}/>
                </div>
              </div>
              <FocalPointPicker
                photo={savesPhoto}
                focalX={savesFocalX}
                focalY={savesFocalY}
                onChange={(x, y) => { setSavesFocalX(x); setSavesFocalY(y); }}
              />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Header</label>
                <input value={savesHeader} onChange={e=>setSavesHeader(e.target.value)} style={I} placeholder="SAVE THESE DATES / SUMMER LINEUP"/>
              </div>
              <div style={{marginBottom:"0.4rem",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1.5px",textTransform:"uppercase"}}>Events · 2 or 3 stack, 4 lay out as 2×2</div>
              {savesItems.map((it,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"60px 60px 1fr 1fr auto",gap:"0.3rem",marginBottom:"0.3rem",alignItems:"center"}}>
                  <input value={it.date} onChange={e=>setSavesItems(p=>p.map((x,j)=>j===i?{...x,date:e.target.value}:x))} style={{...I,textAlign:"center",fontWeight:700}} placeholder="6/12"/>
                  <input value={it.day} onChange={e=>setSavesItems(p=>p.map((x,j)=>j===i?{...x,day:e.target.value}:x))} style={{...I,textAlign:"center",fontSize:"0.55rem"}} placeholder="FRI"/>
                  <input value={it.name} onChange={e=>setSavesItems(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))} style={I} placeholder="Event name"/>
                  <input value={it.venue} onChange={e=>setSavesItems(p=>p.map((x,j)=>j===i?{...x,venue:e.target.value}:x))} style={I} placeholder="Venue"/>
                  <button onClick={()=>setSavesItems(p=>p.filter((_,j)=>j!==i))} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}} title="Remove">×</button>
                </div>
              ))}
              {savesItems.length<4&&<button onClick={()=>setSavesItems(p=>[...p,{date:"",day:"",name:"",venue:""}])} style={{...B,marginBottom:"0.6rem",fontSize:"0.55rem"}}>+ Add event ({savesItems.length}/4)</button>}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>CTA</label>
                <input value={savesCta} onChange={e=>setSavesCta(e.target.value)} style={I} placeholder="tix in bio"/>
              </div>
              {!savesPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
            </>}

            {/* VIBE BOARD — 5-cell collage with headline + labels.
                Reusable series template: "I need some vitamin F", "Vitamin C",
                "It's a rooftop Friday", etc. Generate endless content from
                one design. */}
            {mode==="vibe"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Headline (try the quoted "I need ___" format)</label>
                <input value={vibeHeadline} onChange={e=>setVibeHeadline(e.target.value)} style={I} placeholder='"I NEED SOME VITAMIN F"'/>
              </div>
              <div style={{marginBottom:"0.5rem",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1.5px",textTransform:"uppercase"}}>{vibePhotos.length} Cell{vibePhotos.length===1?"":"s"} · {vibePhotos.length<=2?"full-width row":vibePhotos.length<=4?"2×2 grid":"2 hero top + bottom row"} · 1-6</div>
              {vibePhotos.map((p,i)=>{
                const placeholderLabels = ["farmers market","french fries","firmchella","festivals","family trivia","fireworks"];
                return (
                <div key={i} style={{display:"grid",gridTemplateColumns:"32px 1fr 1.2fr auto auto",gap:"0.3rem",marginBottom:"0.3rem",alignItems:"center"}}>
                  <span style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.5)",letterSpacing:"1px",fontWeight:700}}>{i+1}</span>
                  <input value={vibeLabels[i]||""} onChange={e=>setVibeLabels(prev=>prev.map((x,j)=>j===i?e.target.value:x))} style={I} placeholder={"label, e.g. " + (placeholderLabels[i] || "thing")}/>
                  <div style={{display:"flex",gap:"3px"}}>
                    <button onClick={()=>vibeFileRefs[i]?.current?.click()} style={{...B,flex:1,fontSize:"0.55rem"}}>{p?"✓ Photo":"Upload"}</button>
                    <button onClick={()=>openLibrary(`vibe-${i}`)} style={{...B,padding:"4px 8px"}} title="Library">📚</button>
                    {vibeFileRefs[i] && <input ref={vibeFileRefs[i]} type="file" accept="image/*" onChange={handleVibePhoto(i)} style={{display:"none"}}/>}
                  </div>
                  {p&&<button onClick={()=>setVibePhotos(prev=>prev.map((x,j)=>j===i?null:x))} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}} title="Clear photo">×</button>}
                  {vibePhotos.length>1&&<button onClick={()=>{setVibePhotos(prev=>prev.filter((_,j)=>j!==i)); setVibeLabels(prev=>prev.filter((_,j)=>j!==i));}} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.4)"}} title="Remove cell">−</button>}
                </div>
                );
              })}
              {vibePhotos.length<6&&<button onClick={()=>{setVibePhotos(prev=>[...prev,null]); setVibeLabels(prev=>[...prev,""]);}} style={{...B,marginBottom:"0.6rem",fontSize:"0.55rem"}}>+ Add cell ({vibePhotos.length}/6)</button>}
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>
              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",lineHeight:1.5,marginTop:"4px"}}>
                Pro tip: use a light bg (cream / linen / sage) and cut-out photos (Photoroom / remove.bg) for the Local Girl Network look. This same template generates one post per letter of the alphabet — endless content from one design.
              </p>
            </>}

            {/* SCENE COMPOSER — slot-based flyer for parties, mixers,
                festivals, watch parties. 4 photo slots (bg + hero + left
                + right) get composed into a layered scene; big text
                renders BEHIND the cutouts so they occlude part of it
                (the "designed by hand" trick). Halftone toggle ties
                disparate sources together visually. */}
            {mode==="scene"&&<>
              <div style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"6px",fontWeight:700}}>1 · Cutouts (transparent PNGs work best)</div>

              <div style={{display:"grid",gridTemplateColumns:"60px 1fr auto auto auto",gap:"0.3rem",marginBottom:"0.3rem",alignItems:"center"}}>
                <span style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.55)",letterSpacing:"1px"}}>BG</span>
                <span style={{fontSize:"0.6rem",color:"rgba(245,240,232,0.5)"}}>{sceneBgPhoto?"✓ background loaded":"upload backdrop / texture"}</span>
                <button onClick={()=>sceneBgRef.current?.click()} style={{...B,fontSize:"0.55rem"}}>Upload</button>
                <button onClick={()=>openLibrary("scene-bg")} style={{...B,padding:"4px 8px"}}>📚</button>
                {sceneBgPhoto&&<button onClick={()=>setSceneBgPhoto(null)} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}}>×</button>}
                <input ref={sceneBgRef} type="file" accept="image/*" onChange={handleSceneBg} style={{display:"none"}}/>
              </div>
              <FocalPointPicker
                photo={sceneBgPhoto}
                focalX={sceneFocalX}
                focalY={sceneFocalY}
                onChange={(x, y) => { setSceneFocalX(x); setSceneFocalY(y); }}
              />

              <div style={{display:"grid",gridTemplateColumns:"60px 1fr auto auto auto",gap:"0.3rem",marginBottom:"0.3rem",alignItems:"center"}}>
                <span style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.55)",letterSpacing:"1px"}}>HERO</span>
                <span style={{fontSize:"0.6rem",color:"rgba(245,240,232,0.5)"}}>{sceneHero?"✓ hero loaded":"center cutout (trophy, drink, item, mascot…)"}</span>
                <button onClick={()=>sceneHeroRef.current?.click()} style={{...B,fontSize:"0.55rem"}}>Upload</button>
                <button onClick={()=>openLibrary("scene-hero")} style={{...B,padding:"4px 8px"}}>📚</button>
                {sceneHero&&<button onClick={()=>setSceneHero(null)} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}}>×</button>}
                <input ref={sceneHeroRef} type="file" accept="image/*" onChange={handleSceneHero} style={{display:"none"}}/>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"60px 1fr auto auto auto",gap:"0.3rem",marginBottom:"0.3rem",alignItems:"center"}}>
                <span style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.55)",letterSpacing:"1px"}}>LEFT</span>
                <span style={{fontSize:"0.6rem",color:"rgba(245,240,232,0.5)"}}>{sceneLeft?"✓ left loaded":"left cutout (flag, person, decor…)"}</span>
                <button onClick={()=>sceneLeftRef.current?.click()} style={{...B,fontSize:"0.55rem"}}>Upload</button>
                <button onClick={()=>openLibrary("scene-left")} style={{...B,padding:"4px 8px"}}>📚</button>
                {sceneLeft&&<button onClick={()=>setSceneLeft(null)} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}}>×</button>}
                <input ref={sceneLeftRef} type="file" accept="image/*" onChange={handleSceneLeft} style={{display:"none"}}/>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"60px 1fr auto auto auto",gap:"0.3rem",marginBottom:"0.5rem",alignItems:"center"}}>
                <span style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.55)",letterSpacing:"1px"}}>RIGHT</span>
                <span style={{fontSize:"0.6rem",color:"rgba(245,240,232,0.5)"}}>{sceneRight?"✓ right loaded":"right cutout"}</span>
                <button onClick={()=>sceneRightRef.current?.click()} style={{...B,fontSize:"0.55rem"}}>Upload</button>
                <button onClick={()=>openLibrary("scene-right")} style={{...B,padding:"4px 8px"}}>📚</button>
                {sceneRight&&<button onClick={()=>setSceneRight(null)} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}}>×</button>}
                <input ref={sceneRightRef} type="file" accept="image/*" onChange={handleSceneRight} style={{display:"none"}}/>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div>
                  <label style={L}>Hero scale · {Math.round(sceneHeroScale*100)}%</label>
                  <input type="range" min="0.40" max="1.20" step="0.02" value={sceneHeroScale} onChange={e=>setSceneHeroScale(parseFloat(e.target.value))} style={{width:"100%",accentColor:accent}}/>
                </div>
                <div>
                  <label style={L}>Side scale · {Math.round(sceneSideScale*100)}%</label>
                  <input type="range" min="0.30" max="0.90" step="0.02" value={sceneSideScale} onChange={e=>setSceneSideScale(parseFloat(e.target.value))} style={{width:"100%",accentColor:accent}}/>
                </div>
              </div>

              <div style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"6px",fontWeight:700,marginTop:"8px"}}>2 · Text</div>

              <div style={{marginBottom:"0.5rem"}}><label style={L}>Top label (letterspaced ribbon)</label>
                <input value={sceneTopLabel} onChange={e=>setSceneTopLabel(e.target.value)} style={I} placeholder="CENTRALGROUPEVENTS"/>
              </div>
              <div style={{marginBottom:"0.5rem"}}><label style={L}>Title (front, top)</label>
                <input value={sceneTitle} onChange={e=>setSceneTitle(e.target.value)} style={I} placeholder="JERSEY PARTY"/>
              </div>
              <div style={{marginBottom:"0.5rem"}}><label style={L}>Big text (behind cutouts · multi-line)</label>
                <textarea value={sceneBigText} onChange={e=>setSceneBigText(e.target.value)} style={{...I,height:50,resize:"vertical"}} placeholder={"SUMMER\nKICKOFF"}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.5rem"}}>
                <div><label style={L}>Left meta (multi-line)</label>
                  <textarea value={sceneLeftMeta} onChange={e=>setSceneLeftMeta(e.target.value)} style={{...I,height:60,resize:"vertical"}} placeholder={"HOSTED BY\nCGE"}/></div>
                <div><label style={L}>Right meta (multi-line)</label>
                  <textarea value={sceneRightMeta} onChange={e=>setSceneRightMeta(e.target.value)} style={{...I,height:60,resize:"vertical"}} placeholder={"SOUNDS BY\nTBA"}/></div>
              </div>
              <div style={{marginBottom:"0.5rem"}}><label style={L}>Info line (date · time)</label>
                <input value={sceneInfo} onChange={e=>setSceneInfo(e.target.value)} style={I} placeholder="JUNE 13 · 8PM–12AM"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Address</label>
                <input value={sceneAddress} onChange={e=>setSceneAddress(e.target.value)} style={I} placeholder="248 MULBERRY ST NEWARK, NJ"/>
              </div>

              <div style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"6px",fontWeight:700,marginTop:"4px"}}>3 · Style</div>

              <div style={{display:"flex",gap:"0.4rem",alignItems:"center",marginBottom:"0.6rem"}}>
                <button onClick={()=>setSceneHalftone(v=>!v)} style={{padding:"6px 12px",borderRadius:"5px",fontSize:"0.6rem",fontWeight:700,cursor:"pointer",border:sceneHalftone?"2px solid #FACC15":"2px solid rgba(245,240,232,0.1)",background:sceneHalftone?"rgba(250,204,21,0.12)":"transparent",color:sceneHalftone?"#FACC15":"rgba(245,240,232,0.4)",fontFamily:"'Syne'",letterSpacing:"1.5px",textTransform:"uppercase"}}>{sceneHalftone?"✓ Halftone":"○ Halftone"}</button>
              </div>

              {!sceneBgPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color (no bg photo)</label><div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}

              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",lineHeight:1.5,marginTop:"6px"}}>
                The "designed by hand" trick: big text renders <strong>behind</strong> the cutouts so they overlap part of it. The viewer's brain fills in the gap — the partial obscuration adds depth instead of breaking it. Works for parties, mixers, festivals, watch parties, brunches (food cutouts), markets (product cutouts) — content-agnostic.
              </p>
            </>}

            {/* POSTER — magazine-style flyer template. Photo background,
                massive stacked title, two-column offerings list. Title
                controls (size/X/Y/align/color) live up front so the user
                can dodge background features or push the title flush-left
                for editorial vibes. Works for fitness/wellness events,
                parties, mixers, vendor pop-ups — anything that benefits
                from a photo+huge-title layout. */}
            {mode==="poster"&&<>
              <AiSlotBtn slot="poster" label="Poster" onClick={setAiSlotOpen} />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>posterFileRef.current?.click()} style={{...B,flex:1}}>{posterPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("poster")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {posterPhoto&&<button onClick={()=>setPosterPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={posterFileRef} type="file" accept="image/*" onChange={handlePosterPhoto} style={{display:"none"}}/>
                </div>
                {posterPhoto&&<div style={{marginTop:"6px"}}>
                  <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                    Darken · {Math.round(posterOpacity*100)}%
                  </div>
                  <input type="range" min="0" max="0.7" step="0.01" value={posterOpacity} onChange={e=>setPosterOpacity(parseFloat(e.target.value))} style={{width:"100%",accentColor:accent}}/>
                </div>}
              </div>
              <FocalPointPicker
                photo={posterPhoto}
                focalX={posterFocalX}
                focalY={posterFocalY}
                onChange={(x, y) => { setPosterFocalX(x); setPosterFocalY(y); }}
              />

              <div style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"6px",fontWeight:700,marginTop:"4px"}}>1 · Title controls (the big stacked text)</div>

              <div style={{marginBottom:"0.5rem"}}><label style={L}>Title (one word per line for the stacked look)</label>
                <textarea value={posterTitle} onChange={e=>setPosterTitle(e.target.value)} style={{...I,height:80,resize:"vertical",fontFamily:"'Syne'"}} placeholder={"PILATES\nON THE\nPIER"}/>
              </div>

              {/* Title color — preset chips from the brand palette + custom hex */}
              <div style={{marginBottom:"0.5rem"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px"}}>
                  <label style={{...L,marginBottom:0}}>Title color</label>
                  <span style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1px"}}>· brand presets or custom hex</span>
                </div>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap",alignItems:"center"}}>
                  {[
                    {hex:"#FB7185",name:"Wine"},
                    {hex:"#FACC15",name:"Yellow"},
                    {hex:"#C084FC",name:"Purple"},
                    {hex:"#34D399",name:"Emerald"},
                    {hex:"#FBBF24",name:"Gold"},
                    {hex:"#FFFFFF",name:"White"},
                    {hex:"#0a0a0a",name:"Black"},
                  ].map(c=>(
                    <button key={c.hex} onClick={()=>setPosterTitleColor(c.hex)} title={c.name}
                      style={{width:30,height:30,borderRadius:"5px",cursor:"pointer",background:c.hex,border:posterTitleColor===c.hex?"2px solid #FFF":"2px solid transparent",boxShadow:posterTitleColor===c.hex?"0 0 6px rgba(255,255,255,0.3)":"none"}}/>
                  ))}
                  <input
                    type="text"
                    value={posterTitleColor}
                    onChange={e=>setPosterTitleColor(e.target.value)}
                    style={{...I,width:90,padding:"4px 6px",fontSize:"0.6rem",fontFamily:"ui-monospace, Menlo, monospace"}}
                    placeholder="#RRGGBB"
                    title="Custom hex color"
                  />
                </div>
              </div>

              {/* Align buttons (L/C/R) */}
              <div style={{marginBottom:"0.5rem"}}>
                <label style={L}>Title alignment</label>
                <div style={{display:"flex",gap:"4px"}}>
                  {[["left","← Left"],["center","Center"],["right","Right →"]].map(([k,lbl])=>(
                    <button key={k} onClick={()=>setPosterTitleAlign(k)}
                      style={{flex:1,padding:"6px 8px",borderRadius:"4px",border:posterTitleAlign===k?"2px solid "+accent:"2px solid rgba(245,240,232,0.1)",background:posterTitleAlign===k?accent+"22":"transparent",color:posterTitleAlign===k?accent:"rgba(245,240,232,0.5)",fontSize:"0.6rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Syne'"}}
                    >{lbl}</button>
                  ))}
                </div>
              </div>

              {/* Sliders: size + X + Y */}
              <div style={{marginBottom:"0.6rem"}}>
                <label style={L}>Title size · {Math.round(posterTitleSize*100)}%</label>
                <input type="range" min="0.4" max="2.0" step="0.02" value={posterTitleSize} onChange={e=>setPosterTitleSize(parseFloat(e.target.value))} style={{width:"100%",accentColor:accent}}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem",marginBottom:"0.6rem"}}>
                <div>
                  <label style={L}>Title X · {posterTitleX > 0 ? "+" : ""}{posterTitleX}px</label>
                  <input type="range" min="-300" max="300" step="2" value={posterTitleX} onChange={e=>setPosterTitleX(parseInt(e.target.value,10))} style={{width:"100%",accentColor:accent}}/>
                </div>
                <div>
                  <label style={L}>Title Y · {posterTitleY > 0 ? "+" : ""}{posterTitleY}px</label>
                  <input type="range" min="-300" max="300" step="2" value={posterTitleY} onChange={e=>setPosterTitleY(parseInt(e.target.value,10))} style={{width:"100%",accentColor:accent}}/>
                </div>
              </div>
              <button onClick={()=>{setPosterTitleSize(1.0);setPosterTitleX(0);setPosterTitleY(0);setPosterTitleAlign("center");}} style={{...B,padding:"4px 10px",fontSize:"0.55rem",marginBottom:"10px"}}>↺ Reset title position + size</button>

              <div style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"6px",fontWeight:700,marginTop:"4px"}}>2 · Surrounding text</div>

              <div style={{marginBottom:"0.5rem"}}><label style={L}>Top line (location · mono caps)</label>
                <input value={posterTopLine} onChange={e=>setPosterTopLine(e.target.value)} style={I} placeholder="PIER A PARK — HOBOKEN, NJ"/>
              </div>
              <div style={{marginBottom:"0.5rem"}}><label style={L}>Hosts (first line italic, rest caps · accent colored)</label>
                <textarea value={posterHosts} onChange={e=>setPosterHosts(e.target.value)} style={{...I,height:50,resize:"vertical"}} placeholder={"jela &\nLIVE HIGHER"}/>
              </div>
              <div style={{marginBottom:"0.5rem"}}><label style={L}>Kicker (italic subhead above title)</label>
                <input value={posterKicker} onChange={e=>setPosterKicker(e.target.value)} style={I} placeholder="wellness morning edition"/>
              </div>
              <div style={{marginBottom:"0.5rem"}}><label style={L}>Subtitle (italic, below title)</label>
                <input value={posterSubtitle} onChange={e=>setPosterSubtitle(e.target.value)} style={I} placeholder="girls only."/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem",marginBottom:"0.5rem"}}>
                <div><label style={L}>Left list (accent · one item per line)</label>
                  <textarea value={posterLeftList} onChange={e=>setPosterLeftList(e.target.value)} style={{...I,height:120,resize:"vertical"}} placeholder={"LIVE DJ\nREFRESHMENTS"}/></div>
                <div><label style={L}>Right list (accent · one item per line)</label>
                  <textarea value={posterRightList} onChange={e=>setPosterRightList(e.target.value)} style={{...I,height:120,resize:"vertical"}} placeholder={"MASSAGES\nICE BATHS"}/></div>
              </div>
              <div style={{marginBottom:"0.5rem"}}><label style={L}>Dress code / tagline (italic, above date)</label>
                <input value={posterDressCode} onChange={e=>setPosterDressCode(e.target.value)} style={I} placeholder="wear pink / orange / red!"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Date line (mono caps, very bottom)</label>
                <input value={posterDateLine} onChange={e=>setPosterDateLine(e.target.value)} style={I} placeholder="JUNE 20: 9:00 AM – 12:00 PM"/>
              </div>

              {!posterPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}

              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",lineHeight:1.5,marginTop:"6px"}}>
                Title color, accent (hosts + lists), and bg color are all changeable — defaults land on the CGE wine accent so the first render is on-brand. Push the title around with the X/Y sliders if it lands on a building, a face, or a sign in your photo. The mono top-line and bottom date use the system mono font (Menlo / Courier) for an editorial feel.
              </p>
            </>}

            {/* PRESS — editorial event flyer. Big distressed title, 4-cell
                mono meta row at top, optional red badge, lineup names,
                marquee-style genre strip, big date bar. Three color
                regions (genre + date + badge) are user-pickable. */}
            {mode==="press"&&<>
              <AiSlotBtn slot="press" label="Press" onClick={setAiSlotOpen} />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>pressFileRef.current?.click()} style={{...B,flex:1}}>{pressPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("press")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {pressPhoto&&<button onClick={()=>setPressPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={pressFileRef} type="file" accept="image/*" onChange={handlePressPhoto} style={{display:"none"}}/>
                </div>
                <FocalPointPicker
                  photo={pressPhoto}
                  focalX={pressFocalX}
                  focalY={pressFocalY}
                  onChange={(x, y) => { setPressFocalX(x); setPressFocalY(y); }}
                />
                {pressPhoto&&<div style={{marginTop:"6px"}}>
                  <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                    Photo darken · {Math.round(pressPhotoOpacity*100)}%
                  </div>
                  <input type="range" min="0" max="0.7" step="0.02" value={pressPhotoOpacity} onChange={e=>setPressPhotoOpacity(parseFloat(e.target.value))} style={{width:"100%",accentColor:accent}}/>
                </div>}
              </div>

              <div style={{marginBottom:"0.5rem",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700}}>Top meta · 4 cells · use ⏎ for 2nd line in each cell</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                {[0,1,2,3].map(i => (
                  <div key={i}>
                    <label style={L}>Cell {i+1}</label>
                    <textarea
                      value={pressTopMeta[i] || ""}
                      onChange={e=>setPressTopMeta(prev=>prev.map((c,j)=>j===i?e.target.value:c))}
                      style={{...I,height:50,resize:"vertical",fontFamily:"ui-monospace, monospace",fontSize:"0.65rem"}}
                      placeholder={["CASA SAVANA\nRUA CAMERINO","—\n162","RIO DE\nBRASIL","JANEIRO\n2026"][i]}
                    />
                  </div>
                ))}
              </div>

              <div style={{marginBottom:"0.6rem"}}><label style={L}>Title (big distressed display word)</label>
                <input value={pressTitle} onChange={e=>setPressTitle(e.target.value)} style={{...I,fontWeight:900,letterSpacing:"-0.5px"}} placeholder="AFROGROOVE"/>
              </div>

              <div style={{marginBottom:"0.6rem"}}>
                <label style={L}>Badge text · OPTIONAL · disappears when blank</label>
                <input value={pressBadge} onChange={e=>setPressBadge(e.target.value)} style={I} placeholder="RIO DE JANEIRO (leave empty to hide the badge)"/>
              </div>

              <div style={{marginBottom:"0.6rem"}}><label style={L}>Lineup · one or two lines (⏎ for line 2)</label>
                <textarea value={pressLineup} onChange={e=>setPressLineup(e.target.value)} style={{...I,height:55,resize:"vertical"}} placeholder={"CABANECO · DJ TALIE · NAIRO PUMA\nCRAZY  JEFFS · YURE  IDD"}/>
              </div>

              <div style={{marginBottom:"0.6rem"}}><label style={L}>Genres · comma-separated · render as marquee strip</label>
                <input value={pressGenres} onChange={e=>setPressGenres(e.target.value)} style={I} placeholder="AMAPIANO, AFROHOUSE, AFROBEATS"/>
              </div>

              <div style={{marginBottom:"0.6rem"}}><label style={L}>Date · use ★ for the star separator</label>
                <input value={pressDateLine} onChange={e=>setPressDateLine(e.target.value)} style={{...I,fontFamily:"ui-monospace, monospace"}} placeholder="21 DE JUNHO ★ 22H"/>
              </div>

              <div style={{marginBottom:"0.5rem",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,marginTop:"10px"}}>Colors · the three pickable regions</div>

              {[
                { label: "Genre Strip", bg: pressGenreBg, setBg: setPressGenreBg, txt: pressGenreText, setTxt: setPressGenreText },
                { label: "Date Bar",    bg: pressDateBg,  setBg: setPressDateBg,  txt: pressDateText,  setTxt: setPressDateText  },
                { label: "Badge",       bg: pressBadgeBg, setBg: setPressBadgeBg, txt: pressBadgeText, setTxt: setPressBadgeText },
              ].map(row => (
                <div key={row.label} style={{display:"grid",gridTemplateColumns:"90px 1fr 1fr",gap:"6px",alignItems:"center",marginBottom:"0.4rem"}}>
                  <div style={{fontSize:"0.6rem",color:"rgba(245,240,232,0.55)",letterSpacing:"1px",textTransform:"uppercase",fontWeight:700}}>{row.label}</div>
                  <div>
                    <div style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"2px"}}>Background</div>
                    <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                      <input type="color" value={row.bg} onChange={e=>row.setBg(e.target.value)} style={{width:32,height:28,padding:0,border:"1px solid rgba(245,240,232,0.1)",borderRadius:4,background:"transparent",cursor:"pointer"}}/>
                      <input type="text" value={row.bg} onChange={e=>row.setBg(e.target.value)} style={{...I,fontFamily:"ui-monospace, monospace",fontSize:"0.65rem",padding:"4px 6px"}}/>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"2px"}}>Text</div>
                    <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                      <input type="color" value={row.txt} onChange={e=>row.setTxt(e.target.value)} style={{width:32,height:28,padding:0,border:"1px solid rgba(245,240,232,0.1)",borderRadius:4,background:"transparent",cursor:"pointer"}}/>
                      <input type="text" value={row.txt} onChange={e=>row.setTxt(e.target.value)} style={{...I,fontFamily:"ui-monospace, monospace",fontSize:"0.65rem",padding:"4px 6px"}}/>
                    </div>
                  </div>
                </div>
              ))}

              {!pressPhoto&&<div style={{marginBottom:"0.6rem",marginTop:"8px"}}><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px",flexWrap:"wrap"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}

              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",lineHeight:1.5,marginTop:"6px"}}>
                Three pickable color regions: <strong>genre strip</strong> (the marquee bar), <strong>date bar</strong> (bottom band), <strong>badge</strong> (the small accent box next to the title). Each has independent BG + Text pickers — set wild contrasts like yellow-on-green or black-on-orange. Badge auto-hides if its text is empty. Title font follows your current font-pair selection.
              </p>
            </>}

            {mode==="features"&&<>
              <AiSlotBtn slot="features" label="Features" onClick={setAiSlotOpen} />
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional · shares Text-mode photo)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>textFileRef.current?.click()} style={{...B,flex:1}}>{textPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("text")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {textPhoto&&<button onClick={()=>setTextPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={textFileRef} type="file" accept="image/*" onChange={handleTextPhoto} style={{display:"none"}}/>
                </div>
                {textPhoto&&<div style={{marginTop:"6px"}}>
                  <div style={{fontSize:"0.5rem",color:"rgba(245,240,232,0.45)",letterSpacing:"1px",textTransform:"uppercase",marginBottom:"3px"}}>
                    Darken overlay · {Math.round(textOpacity*100)}% {textOpacity >= 0.85 ? "(photo mostly hidden)" : textOpacity >= 0.55 ? "(photo subtle backdrop)" : "(photo more visible)"}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>20%</span>
                    <input type="range" min="0.20" max="1.0" step="0.01" value={textOpacity} onChange={e=>setTextOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                    <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
                  </div>
                </div>}
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Title</label><input value={featuresTitle} onChange={e=>setFeaturesTitle(e.target.value)} style={I} placeholder="e.g. Here's the night"/></div>
              <div style={{marginBottom:"0.5rem",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1.5px",textTransform:"uppercase"}}>{features.length} Card{features.length===1?"":"s"} · {features.length===1?"full width":features.length===2?"2×1":features.length<=4?"2 cols":"2 cols, 3 rows"} · 1-6</div>
              {features.map((card,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr auto",gap:"0.3rem",marginBottom:"0.4rem",alignItems:"center"}}>
                  <EmojiPicker
                    value={card.emoji}
                    onChange={(v) => setFeatures(p => p.map((c, j) => j === i ? { ...c, emoji: v } : c))}
                  />
                  <input value={card.headline} onChange={e=>setFeatures(p=>p.map((c,j)=>j===i?{...c,headline:e.target.value}:c))} style={{...I,fontSize:"0.6rem"}} placeholder="Headline"/>
                  <input value={card.sub} onChange={e=>setFeatures(p=>p.map((c,j)=>j===i?{...c,sub:e.target.value}:c))} style={{...I,fontSize:"0.6rem"}} placeholder="Sub copy"/>
                  {features.length>1&&<button onClick={()=>setFeatures(p=>p.filter((_,j)=>j!==i))} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}} title="Remove this card">×</button>}
                </div>
              ))}
              {features.length<6&&<button onClick={()=>setFeatures(p=>[...p,{emoji:"",headline:"",sub:""}])} style={{...B,marginBottom:"0.6rem",fontSize:"0.55rem"}}>+ Add card ({features.length}/6)</button>}
              {!textPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
            </>}

            <div style={{marginBottom:"0.6rem"}}><label style={L}>Highlight Color</label><div style={{display:"flex",gap:"4px"}}>
              {Object.entries(COLORS).map(([k,v])=><button key={k} onClick={()=>setAccentKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:accentKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:accentKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
              <div><label style={L}>This slide #</label><input type="number" min="1" max="20" value={dots} onChange={e=>setDots(Math.max(1,parseInt(e.target.value)||1))} style={{...I,textAlign:"center",fontWeight:700}}/></div>
              <div><label style={L}>Total slides</label><input type="number" min="1" max="20" value={totalDots} onChange={e=>setTotalDots(Math.max(1,parseInt(e.target.value)||1))} style={{...I,textAlign:"center",fontWeight:700}}/></div>
            </div>
            <button onClick={dl} style={{width:"100%",padding:"12px",background:accent,color:"#000",border:"none",borderRadius:"6px",fontSize:"0.85rem",fontWeight:700,cursor:"pointer"}}>Download {mode.charAt(0).toUpperCase()+mode.slice(1)} Slide (PNG · {exportRatio})</button>
            <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.18)",marginTop:"6px",lineHeight:1.5}}>{EXPORT_RATIOS[exportRatio].w}×{EXPORT_RATIOS[exportRatio].h}px · Syne 800 + DM Sans · CGE branded</p>
          </div>
        </div>
          {/* === LEFT COLUMN END === */}
          </div>

          {/* === RIGHT COLUMN — sticky preview === */}
          <div className="cge-builder-preview" style={{position:"sticky",top:"80px"}}>
            <label style={{...L,marginBottom:"6px"}}>Preview</label>
            <canvas ref={cvRef} style={{width:"100%",maxWidth:"100%",aspectRatio:"1 / 1",borderRadius:"4px",display:"block",background:"#000"}}/>
          </div>
        </div>
        {/* === OUTER GRID END === */}
      </div>
      <PhotoLibraryModal
        open={libOpen}
        onClose={() => setLibOpen(false)}
        onPick={onLibraryPick}
        outputAs="image"
        initialFilter="media"
      />
      {/* Hidden file input for per-slide upload (📤 button under each
          carousel thumbnail). Slide ID is held in slideUploadTargetId
          state; onSlideFilePick consumes it once and clears. */}
      <input
        ref={slideFileRef}
        type="file"
        accept="image/*"
        onChange={onSlideFilePick}
        style={{display:"none"}}
      />
      {/* AI Slide Generator modal — opens when ✨ AI Generate is clicked
          on Cover or CTA form. Accept callback populates the active form's
          fields with the chosen option. */}
      <AiSlideGeneratorModal
        open={!!aiSlotOpen}
        slotType={aiSlotOpen || "cover"}
        apiKey={geminiKey}
        initialTopic={getAiInitialTopicFor(aiSlotOpen)}
        onClose={() => setAiSlotOpen(null)}
        onAccept={(opt) => applyAiOptionToMode(aiSlotOpen, opt)}
      />
      {/* AI Template Fill modal — whole-carousel generation. Generates
          slot content for every slide in a selected template's sequence
          in one Gemini call. Snapshots get built from the result and
          pushed via buildCarouselFromSnapshots. */}
      <AiTemplateFillModal
        open={aiFillOpen}
        apiKey={geminiKey}
        onClose={() => setAiFillOpen(false)}
        onAccept={onAiTemplateAccept}
      />
    </div>
  );
}

const L={display:"block",fontSize:"0.5rem",letterSpacing:"1.5px",textTransform:"uppercase",color:"rgba(245,240,232,0.22)",marginBottom:"3px"};
const I={width:"100%",padding:"5px 7px",background:"#111",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif",fontSize:"0.7rem",outline:"none"};
const B={padding:"5px 8px",background:"rgba(245,240,232,0.04)",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"rgba(245,240,232,0.35)",fontSize:"0.65rem",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"};
