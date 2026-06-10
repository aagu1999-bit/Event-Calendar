import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import { useEventsStore, useRestoreStore } from "../store";
import { generateCaptions } from "../shared/gemini";
import { savePhotoAndNotify, saveExport } from "../shared/photoLibrary.js";
import { PhotoLibraryModal } from "../shared/PhotoLibraryModal.jsx";

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
  "9:16": { w: 1080, h: 1920, label: "9:16 · Story/Reel" },
};

// Module-level state for fonts + watermark, synced from the React component.
// Renderers read these so we don't have to thread them through every cfg.
let _displayFont = "Syne";
let _bodyFont = "DM Sans";
let _watermark = true;
const ff = (s) => s.replace(/'Syne'/g, `'${_displayFont}'`).replace(/'DM Sans'/g, `'${_bodyFont}'`);
const setActiveFonts = (d, b) => { _displayFont = d; _bodyFont = b; };
const setActiveWatermark = (w) => { _watermark = w; };

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
  ctx.font=ff("800 22px 'Syne',sans-serif"); ctx.fillStyle = color; ctx.globalAlpha = alpha;
  ctx.textBaseline = "middle"; ctx.textAlign = "center";
  const lts = ["C","G","E"]; let li = 0;
  for (let y = -60; y < H + 60; y += 32) {
    const off = (Math.round((y+60)/32) % 2 === 1) ? 18 : 0;
    for (let x = -60+off; x < W+60; x += 36) { ctx.fillText(lts[li%3], x, y); li++; }
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
  // CGE in the circle — use weight 700 (every font pair has it). Weight
  // 800 silently failed for Bebas Neue (only 400) and Space Grotesk (max
  // 700), making the swap look "locked to Syne" when the browser was
  // actually falling back to system sans-serif (which happens to look
  // geometric, so the bug masked itself).
  ctx.font=ff("700 17px 'Syne',sans-serif"); ctx.fillStyle = accent; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText("CGE",58,53); ctx.textAlign = "left";
  const primaryText = isLight ? "#0a0a0a" : "#FFF";
  const secondaryText = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.50)";
  ctx.font=ff("700 22px 'DM Sans',sans-serif"); ctx.fillStyle = primaryText; ctx.textBaseline = "top"; ctx.fillText("Central Group Events",96,35);
  ctx.font=ff("500 17px 'DM Sans',sans-serif"); ctx.fillStyle = secondaryText; ctx.fillText("@centralgroupevents",96,60);
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
  ctx.font=ff("800 16px 'Syne',sans-serif"); ctx.fillStyle = brand; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
  ctx.fillText("CENTRAL GROUP EVENTS", 60, H-14);
  ctx.font=ff("500 14px 'DM Sans',sans-serif"); ctx.fillStyle = url; ctx.textAlign = "right";
  ctx.fillText("centralgroupevents.com", W-60, H-14); ctx.textAlign = "left";
}

function drawPageNum(ctx, W, H, current, total, accent, isLight = false) {
  if (total <= 1) return;
  ctx.font=ff("600 16px 'DM Sans',sans-serif"); ctx.fillStyle = isLight ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.20)";
  ctx.textBaseline = "bottom"; ctx.textAlign = "right";
  ctx.fillText(`${current}/${total}`, W-60, H-14); ctx.textAlign = "left";
}

// === COVER RENDERER ===
function renderCover(canvas, cfg) {
  const { photo, headline, highlights, accent, dots, totalDots, subtitle, opacity, ribbon } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");
  if (photo) { const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s; ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh); }
  else { ctx.fillStyle="#111"; ctx.fillRect(0,0,W,H); }
  const grd=ctx.createLinearGradient(0,H*0.25,0,H); grd.addColorStop(0,"transparent"); grd.addColorStop(0.3,`rgba(0,0,0,${opacity*0.6})`); grd.addColorStop(0.55,`rgba(0,0,0,${opacity*0.88})`); grd.addColorStop(1,`rgba(0,0,0,${opacity})`); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
  drawTexture(ctx,W,H,"#FFF",0.04);
  drawLogo(ctx,accent,W); drawDots(ctx,W,dots,totalDots,accent);
  if (subtitle?.trim()) { ctx.font=ff("700 24px 'DM Sans',sans-serif"); ctx.fillStyle=accent; ctx.textBaseline="top"; ctx.letterSpacing="3px"; }
  if (!headline?.trim()) { drawFooter(ctx,W,H); return; }
  const words=headline.split(/\s+/).filter(w=>w), px=60, maxW=W-px*2;
  let fs=72; ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`);
  const wrap=(f)=>{ ctx.font=ff(`800 ${f}px 'Syne',sans-serif`); const r=[]; let cl=[],cw=0; const sw=ctx.measureText(" ").width;
    for(let i=0;i<words.length;i++){const t=words[i].toUpperCase(),ww=ctx.measureText(t).width;if(cl.length>0&&cw+sw+ww>maxW){r.push(cl);cl=[{text:t,idx:i,width:ww}];cw=ww;}else{cw+=(cl.length>0?sw:0)+ww;cl.push({text:t,idx:i,width:ww});}}if(cl.length)r.push(cl);return r;};
  let lines=wrap(fs); while(lines.length*(fs*1.05)>H*0.55&&fs>36){fs-=2;lines=wrap(fs);}
  const lh=fs*1.05, totalH=lines.length*lh, startY=H-50-totalH;
  if(ribbon?.trim()){
    const rt=ribbon.toUpperCase();
    ctx.font=ff("800 22px 'Syne',sans-serif"); ctx.letterSpacing="4px";
    const tw=ctx.measureText(rt).width, rpadX=20, rectW=tw+rpadX*2, rectH=44;
    const ribbonY=subtitle?.trim()?startY-94:startY-60;
    ctx.fillStyle=accent; ctx.beginPath(); ctx.roundRect(60,ribbonY,rectW,rectH,4); ctx.fill();
    ctx.fillStyle="#000"; ctx.textBaseline="middle"; ctx.textAlign="left";
    ctx.fillText(rt,60+rpadX,ribbonY+rectH/2);
    ctx.letterSpacing="0px"; ctx.textBaseline="top";
  }
  if(subtitle?.trim()){ctx.font=ff("700 24px 'DM Sans',sans-serif");ctx.fillStyle=accent;ctx.textBaseline="bottom";ctx.letterSpacing="3px";ctx.fillText(subtitle.toUpperCase(),60,startY-12);ctx.letterSpacing="0px";}
  ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`); ctx.textBaseline="top"; const sw=ctx.measureText(" ").width;
  lines.forEach((lw,li)=>{let x=px;const y=startY+li*lh;lw.forEach(w=>{ctx.fillStyle=highlights.has(w.idx)?accent:"#FFF";ctx.fillText(w.text,x,y);x+=w.width+sw;});});
  drawFooter(ctx,W,H);
}

// === LIST RENDERER ===
function renderList(canvas, cfg) {
  const { items, accent, bgKey, dots, totalDots, listTitle, listSubtitle } = cfg;
  const W=1080,H=1080; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !!bg.isLight;
  ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
  const isBlack=bgKey==="black";
  drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:(isLight?0.08:0.14));
  // Spotlight is a nightclub-light effect — skip on light backgrounds.
  if(!isLight){
    if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.40);
    else drawSpotlight(ctx,W,H,"229,188,79",0.30);
  }

  // Day mode flips every text + card surface from white-on-dark to dark-on-light.
  const textPrimary  = isLight ? "#0a0a0a" : "#FFF";
  const textSubtle   = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.35)";
  const textMuted    = isLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.45)";
  const cardFill     = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
  const accentStripe = isLight ? "rgba(0,0,0,0.10)" : "rgba(255,255,255,0.10)";

  ctx.globalAlpha=1; ctx.textBaseline="top"; ctx.textAlign="left";
  drawDots(ctx,W,dots,totalDots,accent,isLight);
  ctx.font=ff("800 52px 'Syne',sans-serif"); ctx.fillStyle=accent; ctx.fillText((listTitle||"FRIDAY").toUpperCase(),60,50);
  ctx.font=ff("700 22px 'DM Sans',sans-serif"); ctx.fillStyle=textSubtle; ctx.letterSpacing="2px";
  ctx.fillText((listSubtitle||"TOP PICKS").toUpperCase(),60,108); ctx.letterSpacing="0px";
  ctx.fillStyle = `${accent}30`; ctx.fillRect(60,140,W-120,2);

  const startY=155, rowH=100, maxItems=Math.min(items.length,8);
  items.slice(0,maxItems).forEach((item,i)=>{
    const y=startY+i*rowH;
    ctx.fillStyle=cardFill; ctx.beginPath(); ctx.roundRect(60,y,W-120,rowH-12,10); ctx.fill();
    ctx.fillStyle=item.featured?accent:accentStripe;
    ctx.beginPath(); ctx.roundRect(60,y,4,rowH-12,[10,0,0,10]); ctx.fill();
    ctx.font=ff("700 34px 'DM Sans',sans-serif"); ctx.fillStyle=item.featured?accent:textPrimary; ctx.textBaseline="top";
    let nm=item.name.toUpperCase(); if(ctx.measureText(nm).width>W-240){while(ctx.measureText(nm+"..").width>W-240&&nm.length>0)nm=nm.slice(0,-1);nm+="..";}
    ctx.fillText(nm,82,y+14);
    ctx.font=ff("400 26px 'DM Sans',sans-serif"); ctx.fillStyle=textMuted;
    ctx.fillText(item.detail||"",82,y+54);
  });

  drawFooter(ctx,W,H,isLight);
}

// === STAT RENDERER ===
function renderStat(canvas, cfg) {
  const { statNumber, statLabel, statSub, accent, bgKey, dots, totalDots } = cfg;
  const W=1080,H=1080; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  const bg=BG_COLORS[bgKey]||BG_COLORS.purple;
  const isLight = !!bg.isLight;
  ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
  const isBlack=bgKey==="black";
  drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.06:(isLight?0.08:0.14));
  if(!isLight){
    if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.45);
    else drawSpotlight(ctx,W,H,"229,188,79",0.35);
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
    const subLines=statSub.split("\n");
    subLines.forEach((ln,i)=>ctx.fillText(ln.trim(),W/2,H*0.67+i*36));
  }

  ctx.textAlign="left"; ctx.textBaseline="top";
  drawDots(ctx,W,dots,totalDots,accent,isLight); drawFooter(ctx,W,H,isLight);
}

// === TEXT RENDERER ===
function renderText(canvas, cfg) {
  const { textTitle, textTitleHighlights, textBody, accent, bgKey, dots, totalDots, pageNum, totalPages, photo, textOpacity } = cfg;
  const W=1080,H=1080; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");

  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
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
  const px=60, maxW=W-px*2;
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
    const lineH=42, blockH=bodyLines.length*lineH;
    let startY=H/2-blockH/2;
    const minY=barY+30, maxBottom=H-70;
    if(startY<minY)startY=minY;
    if(startY+blockH>maxBottom)startY=maxBottom-blockH;

    bodyLines.forEach((ln,i)=>{
      const y=startY+i*lineH;
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
  const { ctaKicker, ctaDate, ctaVenue, ctaUrl, photo, accent, bgKey, dots, totalDots, opacity } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  const bg = BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
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
  const { photo, caption, captionSecondary, alignment, accent, bgKey, dots, totalDots } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
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

  // Secondary line — small, letterspaced, accent
  if (captionSecondary?.trim()) {
    ctx.font=ff("700 22px 'DM Sans',sans-serif");
    ctx.fillStyle=accent; ctx.letterSpacing="3px"; ctx.textAlign=align; ctx.textBaseline="bottom";
    ctx.fillText(captionSecondary.toUpperCase(), ax, H-60);
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
function renderSpotlight(canvas, cfg) {
  const { photo, spotName, spotMeta, spotTime, spotPrice, spotCta, accent, bgKey, dots, totalDots } = cfg;
  const W = 1080, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Day mode applies only when there's no photo. With a photo, the dark
  // gradient at the bottom always carries the text — irrespective of bg
  // color choice — so text stays white-on-photo.
  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  // Background — photo full-bleed or solid bg.
  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
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
  const px = 60;

  // Text colors flip in day mode (no photo + light bg).
  const headlineColor = isLight ? "#0a0a0a" : "#FFF";
  const detailColor   = isLight ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.78)";
  const footerLeftColor = isLight ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.95)";
  const counterColor  = isLight ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.9)";

  // Layout from bottom up: footer (time/price/cta), detail line, venue name.
  const FOOTER_BOTTOM = 60;
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

  // DETAIL line — address-style, monospace-ish feel via letterSpacing.
  if (spotMeta && spotMeta.trim()) {
    ctx.font = ff("600 26px 'DM Sans',sans-serif");
    ctx.fillStyle = detailColor;
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(spotMeta, px, yBottom);
    yBottom -= 44;
  }

  // VENUE NAME — big bold uppercase, wraps if long, scales down to fit.
  if (spotName && spotName.trim()) {
    const words = spotName.toUpperCase().split(/\s+/).filter(w => w);
    let fs = 92;
    const wrap = (f) => {
      ctx.font = ff(`900 ${f}px 'Syne',sans-serif`);
      const r = []; let bl = "";
      for (const w of words) {
        const test = bl ? bl + " " + w : w;
        if (ctx.measureText(test).width > W - px * 2 && bl) { r.push(bl); bl = w; }
        else bl = test;
      }
      if (bl) r.push(bl);
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
    ctx.fillStyle = headlineColor;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    lines.forEach((ln, i) => ctx.fillText(ln, px, startY + i * lh));
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
  } = cfg;
  const W = 1080, H = 1080;
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
    ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
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
    const px = 60, maxW = W - px * 2;
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
function renderSaveDate(canvas, cfg) {
  const {
    photo, saveKicker, saveDay, saveDateBig, saveEvent, saveVenue, saveCta,
    accent, bgKey, dots, totalDots, opacity,
  } = cfg;
  const W = 1080, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
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
    const px = 60, maxW = W - px * 2;
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
    ctx.fillText(saveVenue, W / 2, 800);
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
  } = cfg;
  const W = 1080, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  const bg = BG_COLORS[bgKey] || BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s = Math.max(W / photo.width, H / photo.height);
    const dw = photo.width * s, dh = photo.height * s;
    ctx.drawImage(photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
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

  const px = 60;
  const ctaSpace = savesCta?.trim() ? 110 : 60;
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

  // CTA at bottom
  if (savesCta?.trim()) {
    ctx.font = ff("700 30px 'DM Sans',sans-serif");
    ctx.fillStyle = accent; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(savesCta, W / 2, H - 70);
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

function renderScene(canvas, cfg) {
  const {
    bgPhoto, sceneHero, sceneLeft, sceneRight,
    sceneTopLabel, sceneTitle, sceneBigText, sceneLeftMeta, sceneRightMeta,
    sceneInfo, sceneAddress,
    sceneHalftone, sceneHeroScale, sceneSideScale,
    accent, bgKey, dots, totalDots,
  } = cfg;
  const W = 1080, H = 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 1. BACKGROUND (photo OR solid color)
  if (bgPhoto) {
    const s = Math.max(W / bgPhoto.width, H / bgPhoto.height);
    const dw = bgPhoto.width * s, dh = bgPhoto.height * s;
    ctx.drawImage(bgPhoto, (W - dw) / 2, (H - dh) / 2, dw, dh);
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
    // Anchor lower-mid so cutouts placed centrally cross the text.
    const startY = H * 0.78 - (lines.length - 1) * lh / 2;
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
  if (sceneLeftMeta?.trim()) {
    ctx.font = ff("800 20px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF"; ctx.textAlign = "left";
    sceneLeftMeta.split("\n").forEach((ln, i) => ctx.fillText(ln.toUpperCase(), 32, 220 + i * 26));
  }
  if (sceneRightMeta?.trim()) {
    ctx.font = ff("800 20px 'DM Sans',sans-serif");
    ctx.fillStyle = "#FFF"; ctx.textAlign = "right";
    sceneRightMeta.split("\n").forEach((ln, i) => ctx.fillText(ln.toUpperCase(), W - 32, 220 + i * 26));
  }

  // 9. BOTTOM INFO BAR — info line + address
  if (sceneInfo?.trim()) {
    let fs = 30;
    ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    while (ctx.measureText(sceneInfo.toUpperCase()).width > W - 60 && fs > 16) {
      fs -= 2; ctx.font = ff(`800 ${fs}px 'Syne',sans-serif`);
    }
    ctx.fillStyle = "#FFF";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(sceneInfo.toUpperCase(), W / 2, H - 56);
  }
  if (sceneAddress?.trim()) {
    ctx.font = ff("700 20px 'DM Sans',sans-serif");
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(sceneAddress.toUpperCase(), W / 2, H - 24);
  }

  // 10. ACCENT EDGE BAR
  ctx.fillStyle = accent;
  ctx.fillRect(0, H - 6, W, 6);

  ctx.textAlign = "left"; ctx.textBaseline = "top";
  drawDots(ctx, W, dots, totalDots, accent);
  // No drawLogo / drawFooter — the composition includes its own brand cues.
}

// === VIBE BOARD ===
// Moodboard collage. Headline at top (quoted, conversational), 5-cell
// grid of photo cards below (4 in a 2x2 plus 1 hero, OR 2x3 layout).
// Inspired by The Local Girl Network's "Vitamin F / C" carousels — a
// reusable template that generates endless content (one per letter,
// season, vibe, etc) and works as the non-event content engine you
// don't have yet.
function renderVibeBoard(canvas, cfg) {
  const { vibePhotos, vibeHeadline, vibeLabels, accent, bgKey, dots, totalDots } = cfg;
  const W = 1080, H = 1080;
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

  const px = 60;
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
  const { featuresTitle, features, accent, bgKey, dots, totalDots, photo, opacity } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  const bg=BG_COLORS[bgKey]||BG_COLORS.black;
  const isLight = !photo && !!bg.isLight;

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
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

  // 2x2 grid of cards
  const cards = (features || []).slice(0, 4);
  const margin = 60;
  const gap = 36;
  const cw = (W - margin*2 - gap) / 2;
  const ch = 300;
  const gridTop = Math.max(titleBottom + 40, 240);

  cards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * (cw + gap);
    const y = gridTop + row * (ch + gap);

    // Card bg
    ctx.fillStyle = cardFill;
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.fill();

    // Left accent stripe
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(x, y, 5, ch, [12, 0, 0, 12]); ctx.fill();

    // Emoji
    if (card.emoji?.trim()) {
      ctx.font=ff("78px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif");
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillStyle = emojiBg;
      ctx.fillText(card.emoji, x + 28, y + 30);
    }

    // Headline
    if (card.headline?.trim()) {
      let hfs = 30;
      const headlineText = card.headline.toUpperCase();
      ctx.font=ff(`800 ${hfs}px 'Syne',sans-serif`);
      while (ctx.measureText(headlineText).width > cw - 50 && hfs > 18) {
        hfs -= 2; ctx.font=ff(`800 ${hfs}px 'Syne',sans-serif`);
      }
      ctx.fillStyle = cardHeadlineColor; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(headlineText, x + 28, y + 144);
    }

    // Sub (wrap to 2 lines max)
    if (card.sub?.trim()) {
      ctx.font=ff("400 20px 'DM Sans',sans-serif");
      ctx.fillStyle = cardSubColor;
      const subWords = card.sub.split(/\s+/);
      const subLines = []; let bl = "";
      for (const w of subWords) {
        const test = bl ? bl + " " + w : w;
        if (ctx.measureText(test).width > cw - 50 && bl) { subLines.push(bl); bl = w; }
        else bl = test;
      }
      if (bl) subLines.push(bl);
      subLines.slice(0, 2).forEach((ln, j) => ctx.fillText(ln, x + 28, y + 188 + j*26));
    }
  });

  ctx.textAlign = "left";
  drawDots(ctx, W, dots, totalDots, accent, isLight);
  drawFooter(ctx, W, H, isLight);
}

// === MEDIA TOOL ===
export default function MediaTool() {
  const events = useEventsStore(s => s.events);

  const [mode, setMode] = useState("cover");
  const [photo, setPhoto] = useState(null);
  const [headline, setHeadline] = useState("This weekend in NJ has 47 events. Here's what you need to know");
  const [subtitle, setSubtitle] = useState("");
  const [highlights, setHighlights] = useState(new Set([1,6,10]));
  const [accentKey, setAccentKey] = useState("yellow");
  const [bgKey, setBgKey] = useState("black");
  const [dots, setDots] = useState(1);
  const [totalDots, setTotalDots] = useState(5);
  const [opacity, setOpacity] = useState(0.92);
  const [ribbon, setRibbon] = useState("");
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
  const [statNumber, setStatNumber] = useState("47");
  const [statLabel, setStatLabel] = useState("EVENTS");
  const [statSub, setStatSub] = useState("Across 3 days, 3 regions,\nand 12 categories");
  const [textTitle, setTextTitle] = useState("The Rooftop Scene");
  const [textTitleHL, setTextTitleHL] = useState(new Set([1]));
  const [textBody, setTextBody] = useState("Three new rooftop venues opened in North Jersey this spring, joining the wave of outdoor-focused social spaces targeting young professionals.\n\nThe biggest? *Newark Standard's expansion* — doubling their outdoor capacity for summer 2026.");
  const [pageNum, setPageNum] = useState(3);
  const [totalPages, setTotalPages] = useState(5);
  const [textPhoto, setTextPhoto] = useState(null);
  const [textOpacity, setTextOpacity] = useState(0.85);
  const [editItem, setEditItem] = useState(null);
  const [template, setTemplate] = useState("weekend");
  const [clientCfg, setClientCfg] = useState({
    problemTitle: "Tired of swiping?",
    problemHighlights: "swiping",
    problemBody: "Apps put you in a queue of profiles. *Real life puts you in a room of people.* Sunday, June 14 — we're filling that room.",
    benefitsTitle: "Here's the night",
    benefits: "*Pickleball games* — no partner needed\n*Speed connections* — meet everyone\n*Bachata dancing* — beginner friendly\n*Gift baskets* — good vibes",
  });
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
  const [caption, setCaption] = useState("When the music finds you.");
  const [captionSecondary, setCaptionSecondary] = useState("JERSEY CITY · APRIL 2026");
  const [captionAlign, setCaptionAlign] = useState("left");

  // Spotlight — one-venue-per-slide body for roundup carousels.
  const [spotPhoto, setSpotPhoto] = useState(null);
  const [spotName, setSpotName] = useState("ROOFTOP NIGHT AT THE STANDARD");
  const [spotMeta, setSpotMeta] = useState("9 Clinton St | Newark");
  const [spotTime, setSpotTime] = useState("Friday · 8 PM");
  const [spotPrice, setSpotPrice] = useState("$30");
  const [spotCta, setSpotCta] = useState("tix in bio");

  // Countdown — T-minus anticipation card. Use as a series leading up
  // to a single big event (World Cup, NBA Finals, opening night, etc).
  const [countPhoto, setCountPhoto] = useState(null);
  const [countText, setCountText] = useState("3 WEEKS");
  const [countEvent, setCountEvent] = useState("WORLD CUP OPENING NIGHT");
  const [countWhen, setCountWhen] = useState("Friday, June 12 · The Standard");
  const [countCta, setCountCta] = useState("tix in bio");
  const [countOpacity, setCountOpacity] = useState(0.78);

  // Save the Date — single hero announcement.
  const [savePhoto, setSavePhoto] = useState(null);
  const [saveKicker, setSaveKicker] = useState("SAVE THE DATE");
  const [saveDay, setSaveDay] = useState("FRIDAY");
  const [saveDateBig, setSaveDateBig] = useState("JUNE 12");
  const [saveEvent, setSaveEvent] = useState("WORLD CUP OPENING NIGHT");
  const [saveVenue, setSaveVenue] = useState("The Standard · Newark · 8 PM");
  const [saveCta, setSaveCta] = useState("RSVP in bio");
  const [saveOpacity, setSaveOpacity] = useState(0.80);

  // Save These Dates — multi-event announcement (2-4 items).
  const [savesPhoto, setSavesPhoto] = useState(null);
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

  // Vibe Board — moodboard collage with headline + 5 photo cells.
  const [vibePhotos, setVibePhotos] = useState([null, null, null, null, null]);
  const [vibeHeadline, setVibeHeadline] = useState('"I NEED SOME VITAMIN F"');
  const [vibeLabels, setVibeLabels] = useState([
    "farmers market", "french fries", "firmchella", "festivals", "family trivia",
  ]);

  // Custom carousel composer — snapshots of slides, reorderable, exportable
  const [carousel, setCarousel] = useState([]);
  const [dragIdx, setDragIdx] = useState(null);

  // Global render flags — synced into module-level vars via useEffect.
  const [watermark, setWatermark] = useState(true);
  const [fontPairKey, setFontPairKey] = useState("default");
  // Aspect ratio applied at export time — preview stays 1:1 since the
  // renderers are coded for 1080×1080.
  const [exportRatio, setExportRatio] = useState("1:1");
  useEffect(() => { setActiveWatermark(watermark); }, [watermark]);
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
  const [captionsError, setCaptionsError] = useState("");
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
          problemTitle: clientCfg.problemTitle, problemBody: clientCfg.problemBody,
          benefits: clientCfg.benefits,
          statNumber, statLabel, statSub,
          ctaDate, ctaVenue, ctaUrl,
        };
      }
      const images = (useVision && carousel.length > 0) ? carousel.map(s => s.thumb) : [];
      const results = await generateCaptions(geminiKey, ctx, images);
      if (!results.length) throw new Error("Got 0 captions back");
      setCaptions(results);
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
  // One file input ref per Vibe Board slot (5 max).
  const vibeFileRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];
  const accent = COLORS[accentKey]?.hex || "#FACC15";
  const words = headline.split(/\s+/).filter(w=>w);
  const textWords = textTitle.split(/\s+/).filter(w=>w);

  const toggleHL = (idx) => setHighlights(p=>{const n=new Set(p);n.has(idx)?n.delete(idx):n.add(idx);return n;});
  const toggleTextHL = (idx) => setTextTitleHL(p=>{const n=new Set(p);n.has(idx)?n.delete(idx):n.add(idx);return n;});

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

  const render = useCallback(()=>{
    const cv=cvRef.current; if(!cv) return;
    if(mode==="cover") renderCover(cv,{photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,ribbon});
    else if(mode==="list") renderList(cv,{items,accent,bgKey,dots,totalDots,listTitle,listSubtitle});
    else if(mode==="stat") renderStat(cv,{statNumber,statLabel,statSub,accent,bgKey,dots,totalDots});
    else if(mode==="text") renderText(cv,{textTitle,textTitleHighlights:textTitleHL,textBody,accent,bgKey,dots,totalDots,pageNum,totalPages,photo:textPhoto,textOpacity});
    else if(mode==="cta") renderCTA(cv,{ctaKicker,ctaDate,ctaVenue,ctaUrl,photo:textPhoto,accent,bgKey,dots,totalDots,opacity:textOpacity});
    else if(mode==="features") renderFeatures(cv,{featuresTitle,features,accent,bgKey,dots,totalDots,photo:textPhoto,opacity:textOpacity});
    else if(mode==="photo") renderPhotoCaption(cv,{photo:captionPhoto,caption,captionSecondary,alignment:captionAlign,accent,bgKey,dots,totalDots});
    else if(mode==="spotlight") renderSpotlight(cv,{photo:spotPhoto,spotName,spotMeta,spotTime,spotPrice,spotCta,accent,bgKey,dots,totalDots});
    else if(mode==="countdown") renderCountdown(cv,{photo:countPhoto,countText,countEvent,countWhen,countCta,accent,bgKey,dots,totalDots,opacity:countOpacity});
    else if(mode==="savedate") renderSaveDate(cv,{photo:savePhoto,saveKicker,saveDay,saveDateBig,saveEvent,saveVenue,saveCta,accent,bgKey,dots,totalDots,opacity:saveOpacity});
    else if(mode==="savedates") renderSaveDates(cv,{photo:savesPhoto,savesHeader,savesItems,savesCta,accent,bgKey,dots,totalDots,opacity:savesOpacity});
    else if(mode==="vibe") renderVibeBoard(cv,{vibePhotos,vibeHeadline,vibeLabels,accent,bgKey,dots,totalDots});
    else if(mode==="scene") renderScene(cv,{bgPhoto:sceneBgPhoto,sceneHero,sceneLeft,sceneRight,sceneTopLabel,sceneTitle,sceneBigText,sceneLeftMeta,sceneRightMeta,sceneInfo,sceneAddress,sceneHalftone,sceneHeroScale,sceneSideScale,accent,bgKey,dots,totalDots});
  },[mode,photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,ribbon,items,bgKey,listTitle,listSubtitle,statNumber,statLabel,statSub,textTitle,textTitleHL,textBody,pageNum,totalPages,textPhoto,textOpacity,ctaKicker,ctaDate,ctaVenue,ctaUrl,featuresTitle,features,captionPhoto,caption,captionSecondary,captionAlign,spotPhoto,spotName,spotMeta,spotTime,spotPrice,spotCta,countPhoto,countText,countEvent,countWhen,countCta,countOpacity,savePhoto,saveKicker,saveDay,saveDateBig,saveEvent,saveVenue,saveCta,saveOpacity,savesPhoto,savesHeader,savesItems,savesCta,savesOpacity,vibePhotos,vibeHeadline,vibeLabels,sceneBgPhoto,sceneHero,sceneLeft,sceneRight,sceneTopLabel,sceneTitle,sceneBigText,sceneLeftMeta,sceneRightMeta,sceneInfo,sceneAddress,sceneHalftone,sceneHeroScale,sceneSideScale,watermark,fontTick]);

  useEffect(()=>{const t=setTimeout(render,60);return()=>clearTimeout(t);},[render]);

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
  const handlePhoto = makeUploadHandler(setPhoto, "cover");
  const handleTextPhoto = makeUploadHandler(setTextPhoto, mode); // text/cta/features all share this
  const handleCaptionPhoto = makeUploadHandler(setCaptionPhoto, "photo");
  const handleSpotPhoto = makeUploadHandler(setSpotPhoto, "spotlight");
  const handleCountPhoto = makeUploadHandler(setCountPhoto, "countdown");
  const handleSavePhoto = makeUploadHandler(setSavePhoto, "savedate");
  const handleSavesPhoto = makeUploadHandler(setSavesPhoto, "savedates");
  // Scene Composer — 4 image slots: bg + hero + left + right
  const handleSceneBg    = makeUploadHandler(setSceneBgPhoto, "scene-bg");
  const handleSceneHero  = makeUploadHandler(setSceneHero,    "scene-hero");
  const handleSceneLeft  = makeUploadHandler(setSceneLeft,    "scene-left");
  const handleSceneRight = makeUploadHandler(setSceneRight,   "scene-right");
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
  const [pickTarget, setPickTarget] = useState(null); // "cover" | "text" | "photo" | "spotlight"
  const openLibrary = (target) => { setPickTarget(target); setLibOpen(true); };
  const onLibraryPick = (img) => {
    if (pickTarget === "cover")          setPhoto(img);
    else if (pickTarget === "photo")     setCaptionPhoto(img);
    else if (pickTarget === "spotlight") setSpotPhoto(img);
    else if (pickTarget === "countdown") setCountPhoto(img);
    else if (pickTarget === "savedate")  setSavePhoto(img);
    else if (pickTarget === "savedates") setSavesPhoto(img);
    else if (pickTarget && pickTarget.startsWith("vibe-")) {
      const idx = parseInt(pickTarget.split("-")[1], 10);
      setVibePhotos(prev => prev.map((p,i)=>i===idx?img:p));
    }
    else if (pickTarget === "scene-bg")    setSceneBgPhoto(img);
    else if (pickTarget === "scene-hero")  setSceneHero(img);
    else if (pickTarget === "scene-left")  setSceneLeft(img);
    else if (pickTarget === "scene-right") setSceneRight(img);
    else                                  setTextPhoto(img); // text/cta/features share textPhoto
  };

  const dl=()=>{const cv=document.createElement("canvas");
    if(mode==="cover") renderCover(cv,{photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,ribbon});
    else if(mode==="list") renderList(cv,{items,accent,bgKey,dots,totalDots,listTitle,listSubtitle});
    else if(mode==="stat") renderStat(cv,{statNumber,statLabel,statSub,accent,bgKey,dots,totalDots});
    else if(mode==="text") renderText(cv,{textTitle,textTitleHighlights:textTitleHL,textBody,accent,bgKey,dots,totalDots,pageNum,totalPages,photo:textPhoto,textOpacity});
    else if(mode==="cta") renderCTA(cv,{ctaKicker,ctaDate,ctaVenue,ctaUrl,photo:textPhoto,accent,bgKey,dots,totalDots,opacity:textOpacity});
    else if(mode==="features") renderFeatures(cv,{featuresTitle,features,accent,bgKey,dots,totalDots,photo:textPhoto,opacity:textOpacity});
    else if(mode==="photo") renderPhotoCaption(cv,{photo:captionPhoto,caption,captionSecondary,alignment:captionAlign,accent,bgKey,dots,totalDots});
    else if(mode==="spotlight") renderSpotlight(cv,{photo:spotPhoto,spotName,spotMeta,spotTime,spotPrice,spotCta,accent,bgKey,dots,totalDots});
    else if(mode==="countdown") renderCountdown(cv,{photo:countPhoto,countText,countEvent,countWhen,countCta,accent,bgKey,dots,totalDots,opacity:countOpacity});
    else if(mode==="savedate") renderSaveDate(cv,{photo:savePhoto,saveKicker,saveDay,saveDateBig,saveEvent,saveVenue,saveCta,accent,bgKey,dots,totalDots,opacity:saveOpacity});
    else if(mode==="savedates") renderSaveDates(cv,{photo:savesPhoto,savesHeader,savesItems,savesCta,accent,bgKey,dots,totalDots,opacity:savesOpacity});
    else if(mode==="vibe") renderVibeBoard(cv,{vibePhotos,vibeHeadline,vibeLabels,accent,bgKey,dots,totalDots});
    else if(mode==="scene") renderScene(cv,{bgPhoto:sceneBgPhoto,sceneHero,sceneLeft,sceneRight,sceneTopLabel,sceneTitle,sceneBigText,sceneLeftMeta,sceneRightMeta,sceneInfo,sceneAddress,sceneHalftone,sceneHeroScale,sceneSideScale,accent,bgKey,dots,totalDots});
    const exportCv = wrapForExport(cv, exportRatio);
    exportCv.toBlob(blob=>{
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      const filename=`CGE_${mode}_slide_${exportRatio.replace(":","x")}.png`;
      a.download=filename;
      a.href=url;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      URL.revokeObjectURL(url);
      saveExport(blob, { sourceTool: "media", sourceMode: `${mode}-${exportRatio}`, name: filename, snapshot: makeMediaExportSnapshot("single") })
        .catch(err => console.warn("Export archive failed:", err));
    },"image/png");
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
      if (mode === "cover") renderCover(thumbCv, {...cfg, photo, headline, highlights, subtitle, opacity, ribbon});
      else if (mode === "list") renderList(thumbCv, {...cfg, items, listTitle, listSubtitle});
      else if (mode === "stat") renderStat(thumbCv, {...cfg, statNumber, statLabel, statSub});
      else if (mode === "text") renderText(thumbCv, {...cfg, textTitle, textTitleHighlights: textTitleHL, textBody, pageNum, totalPages, photo: textPhoto, textOpacity});
      else if (mode === "cta") renderCTA(thumbCv, {...cfg, ctaKicker, ctaDate, ctaVenue, ctaUrl, photo: textPhoto, opacity: textOpacity});
      else if (mode === "features") renderFeatures(thumbCv, {...cfg, featuresTitle, features, photo: textPhoto, opacity: textOpacity});
      else if (mode === "photo") renderPhotoCaption(thumbCv, {...cfg, photo: captionPhoto, caption, captionSecondary, alignment: captionAlign});
      else if (mode === "spotlight") renderSpotlight(thumbCv, {...cfg, photo: spotPhoto, spotName, spotMeta, spotTime, spotPrice, spotCta});
      else if (mode === "countdown") renderCountdown(thumbCv, {...cfg, photo: countPhoto, countText, countEvent, countWhen, countCta, opacity: countOpacity});
      else if (mode === "savedate") renderSaveDate(thumbCv, {...cfg, photo: savePhoto, saveKicker, saveDay, saveDateBig, saveEvent, saveVenue, saveCta, opacity: saveOpacity});
      else if (mode === "savedates") renderSaveDates(thumbCv, {...cfg, photo: savesPhoto, savesHeader, savesItems, savesCta, opacity: savesOpacity});
      else if (mode === "vibe") renderVibeBoard(thumbCv, {...cfg, vibePhotos, vibeHeadline, vibeLabels});
      else if (mode === "scene") renderScene(thumbCv, {...cfg, bgPhoto: sceneBgPhoto, sceneHero, sceneLeft, sceneRight, sceneTopLabel, sceneTitle, sceneBigText, sceneLeftMeta, sceneRightMeta, sceneInfo, sceneAddress, sceneHalftone, sceneHeroScale, sceneSideScale});

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

  const MODES=[["cover","Cover"],["list","List"],["stat","Stat"],["text","Text"],["cta","CTA"],["features","Features"],["photo","Photo"],["spotlight","Spotlight"],["countdown","Countdown"],["savedate","Save Date"],["savedates","Save Dates"],["vibe","Vibe Board"],["scene","Scene"]];

  // Templates push snapshots into the carousel composer.
  // Weekend (5 slides): Cover + Fri/Sat/Sun lists + Stat.
  // Client (6 slides): Cover + Text + Features + Photo + Stat + CTA.
  const [isAutoGen, setIsAutoGen] = useState(false);
  const autoGenerateCarousel = async () => {
    if (events.length === 0 || isAutoGen) return;
    setIsAutoGen(true);
    try {
      await document.fonts.ready;
      const byDay = (d) => events
        .filter(e => e.day === d)
        .slice(0, 6)
        .map(e => ({
          name: e.name || "Untitled",
          detail: [e.venue, e.area, e.time].filter(Boolean).join(" · "),
          featured: false,
        }));
      const friItems = byDay("Fri");
      const satItems = byDay("Sat");
      const sunItems = byDay("Sun");
      const dayCount = [friItems, satItems, sunItems].filter(a => a.length > 0).length;
      const regionCount = new Set(events.map(e => e.region).filter(Boolean)).size;
      const typeCount = new Set(events.map(e => e.type).filter(Boolean)).size;
      const common = { accent, accentKey };
      const snapshots = [
        { type: "cover", snapshot: { ...common, bgKey, photo,
          headline: `This weekend in NJ has ${events.length} events. Here's what you need to know`,
          highlights: new Set([5, 6, 9]),
          subtitle: "WEEKEND GUIDE", opacity, ribbon: "" } },
        ...(friItems.length > 0 ? [{ type: "list", snapshot: { ...common, bgKey: "purple",
          items: friItems, listTitle: "FRIDAY", listSubtitle: "TOP PICKS" } }] : []),
        ...(satItems.length > 0 ? [{ type: "list", snapshot: { ...common, bgKey: "wine",
          items: satItems, listTitle: "SATURDAY", listSubtitle: "TOP PICKS" } }] : []),
        ...(sunItems.length > 0 ? [{ type: "list", snapshot: { ...common, bgKey: "emerald",
          items: sunItems, listTitle: "SUNDAY", listSubtitle: "TOP PICKS" } }] : []),
        { type: "stat", snapshot: { ...common, bgKey: "black",
          statNumber: String(events.length), statLabel: "EVENTS",
          statSub: `Across ${dayCount} day${dayCount === 1 ? "" : "s"}, ${regionCount} region${regionCount === 1 ? "" : "s"},\nand ${typeCount} categor${typeCount === 1 ? "y" : "ies"}` } },
      ];
      buildCarouselFromSnapshots(snapshots);
    } catch (err) {
      console.error("Weekend template failed:", err);
      alert("Build failed — see console.");
    } finally {
      setIsAutoGen(false);
    }
  };

  const generateClientEventCarousel = async () => {
    if (isAutoGen) return;
    setIsAutoGen(true);
    try {
      await document.fonts.ready;
      const problemWords = clientCfg.problemTitle.split(/\s+/).filter(w => w);
      const hlWords = clientCfg.problemHighlights.toLowerCase().split(/\s+/).filter(w => w);
      const problemHLSet = new Set();
      problemWords.forEach((w, i) => { if (hlWords.includes(w.toLowerCase())) problemHLSet.add(i); });
      const common = { accent, accentKey, bgKey };
      const snapshots = [
        { type: "cover", snapshot: { ...common, photo, headline,
          highlights: new Set(highlights), subtitle, opacity, ribbon } },
        { type: "text", snapshot: { ...common,
          textTitle: clientCfg.problemTitle, textTitleHL: problemHLSet,
          textBody: clientCfg.problemBody, photo: textPhoto, textOpacity,
          pageNum: 2, totalPages: 6 } },
        { type: "features", snapshot: { ...common,
          featuresTitle: clientCfg.benefitsTitle,
          features: features.map(f => ({...f})), photo: null, textOpacity } },
        { type: "photo", snapshot: { ...common, photo: captionPhoto,
          caption, captionSecondary, captionAlign } },
        { type: "stat", snapshot: { ...common, statNumber, statLabel, statSub } },
        { type: "cta", snapshot: { ...common, ctaKicker, ctaDate, ctaVenue, ctaUrl,
          photo: textPhoto, textOpacity } },
      ];
      buildCarouselFromSnapshots(snapshots);
    } catch (err) {
      console.error("Client template failed:", err);
      alert("Build failed — see console.");
    } finally {
      setIsAutoGen(false);
    }
  };

  const handleGenerate = () => {
    if (template === "weekend") return autoGenerateCarousel();
    if (template === "client") return generateClientEventCarousel();
  };

  // === CAROUSEL COMPOSER ===
  const renderSlide = (cv, type, s, dotsNum, dotsTot) => {
    const common = { accent: s.accent, dots: dotsNum, totalDots: dotsTot };
    if (type === "cover") renderCover(cv, { ...common, photo: s.photo, headline: s.headline,
      highlights: s.highlights instanceof Set ? s.highlights : new Set(s.highlights || []),
      subtitle: s.subtitle, opacity: s.opacity, ribbon: s.ribbon });
    else if (type === "list") renderList(cv, { ...common, items: s.items, bgKey: s.bgKey,
      listTitle: s.listTitle, listSubtitle: s.listSubtitle });
    else if (type === "stat") renderStat(cv, { ...common, statNumber: s.statNumber,
      statLabel: s.statLabel, statSub: s.statSub, bgKey: s.bgKey });
    else if (type === "text") renderText(cv, { ...common, textTitle: s.textTitle,
      textTitleHighlights: s.textTitleHL instanceof Set ? s.textTitleHL : new Set(s.textTitleHL || []),
      textBody: s.textBody, bgKey: s.bgKey, pageNum: s.pageNum, totalPages: s.totalPages,
      photo: s.photo, textOpacity: s.textOpacity });
    else if (type === "cta") renderCTA(cv, { ...common, ctaKicker: s.ctaKicker, ctaDate: s.ctaDate,
      ctaVenue: s.ctaVenue, ctaUrl: s.ctaUrl, photo: s.photo, bgKey: s.bgKey, opacity: s.textOpacity });
    else if (type === "features") renderFeatures(cv, { ...common, featuresTitle: s.featuresTitle,
      features: s.features, bgKey: s.bgKey, photo: s.photo, opacity: s.textOpacity });
    else if (type === "photo") renderPhotoCaption(cv, { ...common, photo: s.photo,
      caption: s.caption, captionSecondary: s.captionSecondary, alignment: s.captionAlign,
      bgKey: s.bgKey });
    else if (type === "spotlight") renderSpotlight(cv, { ...common, photo: s.photo,
      spotName: s.spotName, spotMeta: s.spotMeta, spotTime: s.spotTime,
      spotPrice: s.spotPrice, spotCta: s.spotCta, bgKey: s.bgKey });
    else if (type === "countdown") renderCountdown(cv, { ...common, photo: s.photo,
      countText: s.countText, countEvent: s.countEvent, countWhen: s.countWhen,
      countCta: s.countCta, bgKey: s.bgKey, opacity: s.countOpacity });
    else if (type === "savedate") renderSaveDate(cv, { ...common, photo: s.photo,
      saveKicker: s.saveKicker, saveDay: s.saveDay, saveDateBig: s.saveDateBig,
      saveEvent: s.saveEvent, saveVenue: s.saveVenue, saveCta: s.saveCta,
      bgKey: s.bgKey, opacity: s.saveOpacity });
    else if (type === "savedates") renderSaveDates(cv, { ...common, photo: s.photo,
      savesHeader: s.savesHeader, savesItems: s.savesItems, savesCta: s.savesCta,
      bgKey: s.bgKey, opacity: s.savesOpacity });
    else if (type === "vibe") renderVibeBoard(cv, { ...common, vibePhotos: s.vibePhotos,
      vibeHeadline: s.vibeHeadline, vibeLabels: s.vibeLabels, bgKey: s.bgKey });
    else if (type === "scene") renderScene(cv, { ...common, bgPhoto: s.bgPhoto,
      sceneHero: s.sceneHero, sceneLeft: s.sceneLeft, sceneRight: s.sceneRight,
      sceneTopLabel: s.sceneTopLabel, sceneTitle: s.sceneTitle, sceneBigText: s.sceneBigText,
      sceneLeftMeta: s.sceneLeftMeta, sceneRightMeta: s.sceneRightMeta,
      sceneInfo: s.sceneInfo, sceneAddress: s.sceneAddress,
      sceneHalftone: s.sceneHalftone, sceneHeroScale: s.sceneHeroScale, sceneSideScale: s.sceneSideScale,
      bgKey: s.bgKey });
  };

  const makeSnapshot = () => {
    const common = { accent, accentKey, bgKey };
    switch (mode) {
      case "cover": return { ...common, photo, headline, highlights, subtitle, opacity, ribbon };
      case "list": return { ...common, items: items.map(x=>({...x})), listTitle, listSubtitle };
      case "stat": return { ...common, statNumber, statLabel, statSub };
      case "text": return { ...common, textTitle, textTitleHL, textBody, photo: textPhoto, textOpacity, pageNum, totalPages };
      case "cta": return { ...common, ctaKicker, ctaDate, ctaVenue, ctaUrl, photo: textPhoto, textOpacity };
      case "features": return { ...common, featuresTitle, features: features.map(f=>({...f})), photo: textPhoto, textOpacity };
      case "photo": return { ...common, photo: captionPhoto, caption, captionSecondary, captionAlign };
      case "spotlight": return { ...common, photo: spotPhoto, spotName, spotMeta, spotTime, spotPrice, spotCta };
      case "countdown": return { ...common, photo: countPhoto, countText, countEvent, countWhen, countCta, countOpacity };
      case "savedate":  return { ...common, photo: savePhoto, saveKicker, saveDay, saveDateBig, saveEvent, saveVenue, saveCta, saveOpacity };
      case "savedates": return { ...common, photo: savesPhoto, savesHeader, savesItems: savesItems.map(x=>({...x})), savesCta, savesOpacity };
      case "vibe":      return { ...common, vibePhotos: [...vibePhotos], vibeHeadline, vibeLabels: [...vibeLabels] };
      case "scene":     return { ...common, bgPhoto: sceneBgPhoto, sceneHero, sceneLeft, sceneRight, sceneTopLabel, sceneTitle, sceneBigText, sceneLeftMeta, sceneRightMeta, sceneInfo, sceneAddress, sceneHalftone, sceneHeroScale, sceneSideScale };
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
        break;
      case "list":
        setItems(snapshot.items.map(x=>({...x})));
        setListTitle(snapshot.listTitle); setListSubtitle(snapshot.listSubtitle);
        break;
      case "stat":
        setStatNumber(snapshot.statNumber); setStatLabel(snapshot.statLabel); setStatSub(snapshot.statSub);
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
        break;
      case "spotlight":
        setSpotPhoto(snapshot.photo);
        setSpotName(snapshot.spotName || ""); setSpotMeta(snapshot.spotMeta || "");
        setSpotTime(snapshot.spotTime || ""); setSpotPrice(snapshot.spotPrice || "");
        setSpotCta(snapshot.spotCta || "");
        break;
      case "countdown":
        setCountPhoto(snapshot.photo);
        setCountText(snapshot.countText || ""); setCountEvent(snapshot.countEvent || "");
        setCountWhen(snapshot.countWhen || ""); setCountCta(snapshot.countCta || "");
        if (typeof snapshot.countOpacity === "number") setCountOpacity(snapshot.countOpacity);
        break;
      case "savedate":
        setSavePhoto(snapshot.photo);
        setSaveKicker(snapshot.saveKicker || ""); setSaveDay(snapshot.saveDay || "");
        setSaveDateBig(snapshot.saveDateBig || ""); setSaveEvent(snapshot.saveEvent || "");
        setSaveVenue(snapshot.saveVenue || ""); setSaveCta(snapshot.saveCta || "");
        if (typeof snapshot.saveOpacity === "number") setSaveOpacity(snapshot.saveOpacity);
        break;
      case "savedates":
        setSavesPhoto(snapshot.photo);
        setSavesHeader(snapshot.savesHeader || "");
        if (Array.isArray(snapshot.savesItems)) setSavesItems(snapshot.savesItems.map(x=>({...x})));
        setSavesCta(snapshot.savesCta || "");
        if (typeof snapshot.savesOpacity === "number") setSavesOpacity(snapshot.savesOpacity);
        break;
      case "vibe":
        if (Array.isArray(snapshot.vibePhotos)) setVibePhotos([...snapshot.vibePhotos]);
        setVibeHeadline(snapshot.vibeHeadline || "");
        if (Array.isArray(snapshot.vibeLabels)) setVibeLabels([...snapshot.vibeLabels]);
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
    "photo",        // cover / text / cta / features / photoCaption / spotlight / countdown / savedate / savedates
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

  const addToCarousel = async () => {
    await document.fonts.ready;
    const snapshot = makeSnapshot();
    const cv = document.createElement("canvas");
    renderSlide(cv, mode, snapshot, 1, 1);
    const thumb = cv.toDataURL("image/png");
    setCarousel(prev => {
      const next = [...prev, {
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
        type: mode, snapshot, thumb,
      }];
      // Advance the live preview's slide-counter to the brand-new slide so
      // the next snapshot lands at the right position automatically.
      setDots(next.length);
      setTotalDots(next.length);
      return next;
    });
  };

  // Templates call this to push their snapshot list into the carousel.
  const buildCarouselFromSnapshots = (snapshots) => {
    if (carousel.length > 0 && !confirm(`Replace ${carousel.length} existing carousel slide${carousel.length===1?"":"s"} with this template?`)) return;
    const newSlides = snapshots.map((s, i) => {
      const cv = document.createElement("canvas");
      renderSlide(cv, s.type, s.snapshot, 1, 1);
      const thumb = cv.toDataURL("image/png");
      return {
        id: `s_${Date.now()}_${i}_${Math.random().toString(36).slice(2,4)}`,
        type: s.type, snapshot: s.snapshot, thumb,
      };
    });
    setCarousel(newSlides);
  };

  const deleteSlide = (idx) => setCarousel(p => p.filter((_, i) => i !== idx));
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
  const wrapForExport = (baseCanvas, ratio) => {
    const target = EXPORT_RATIOS[ratio] || EXPORT_RATIOS["1:1"];
    if (ratio === "1:1" || (target.w === baseCanvas.width && target.h === baseCanvas.height)) {
      return baseCanvas;
    }
    const out = document.createElement("canvas");
    out.width = target.w;
    out.height = target.h;
    const ctx = out.getContext("2d");
    ctx.fillStyle = (BG_COLORS[bgKey] && BG_COLORS[bgKey].hex) || "#000000";
    ctx.fillRect(0, 0, target.w, target.h);
    // Fit the base into the target keeping aspect — anchored at center.
    const scale = Math.min(target.w / baseCanvas.width, target.h / baseCanvas.height);
    const dw = baseCanvas.width * scale;
    const dh = baseCanvas.height * scale;
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
        renderSlide(cv, s.type, s.snapshot, i+1, carousel.length);
        const exportCv = wrapForExport(cv, exportRatio);
        const blob = await new Promise(r => exportCv.toBlob(r, "image/png"));
        zip.file(`CGE_carousel_${String(i+1).padStart(2,"0")}_${s.type}_${exportRatio.replace(":","x")}.png`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      const zipName = `CGE_custom_carousel_${exportRatio.replace(":","x")}.zip`;
      a.href = url; a.download = zipName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      saveExport(zipBlob, { sourceTool: "media", sourceMode: `carousel-${exportRatio}`, name: zipName, kind: "archive", snapshot: makeMediaExportSnapshot("carousel") })
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
      return next;
    });
    setDragIdx(null);
  };

  return(
    <div style={{minHeight:"calc(100vh - 60px)",background:"#080808",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{maxWidth:1150,margin:"0 auto",padding:"1.25rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem"}}>
          <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:"1.2rem",fontWeight:800,textTransform:"uppercase"}}>CGE Media Template</h1>
          <span style={{fontSize:"0.6rem",color:accent,letterSpacing:"1.5px",textTransform:"uppercase",padding:"2px 8px",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px"}}>{mode} Slide · Export {exportRatio}</span>
        </div>

        <div style={{display:"flex",gap:"0.3rem",marginBottom:"0.6rem",flexWrap:"wrap",alignItems:"center"}}>
          {MODES.map(([k,lb])=><button key={k} onClick={()=>setMode(k)} style={{padding:"6px 16px",borderRadius:"5px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer",border:mode===k?"2px solid #FACC15":"2px solid rgba(245,240,232,0.06)",background:mode===k?"rgba(250,204,21,0.12)":"transparent",color:mode===k?"#FACC15":"rgba(245,240,232,0.25)",fontFamily:"'Syne',sans-serif",letterSpacing:"1px",textTransform:"uppercase"}}>{lb}</button>)}
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
          <button
            onClick={saveDraft}
            disabled={isDrafting}
            title="Save the current state as a draft you can come back to. Lives in Library → Exports with a DRAFT badge."
            style={{padding:"6px 12px",borderRadius:"5px",fontSize:"0.6rem",fontWeight:700,cursor:isDrafting?"wait":"pointer",border:"2px solid rgba(192,132,252,0.4)",background:"rgba(192,132,252,0.12)",color:"#C084FC",fontFamily:"'Syne',sans-serif",letterSpacing:"1.5px",textTransform:"uppercase",opacity:isDrafting?0.6:1}}
          >💾 {isDrafting ? "…" : "Save Draft"}</button>
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
          {envKey ? (
            <div style={{flex:1,fontSize:"0.6rem",color:"rgba(245,240,232,0.7)"}}>
              ✓ Loaded from <code style={{color:"#34D399",background:"rgba(52,211,153,0.1)",padding:"1px 5px",borderRadius:"3px",fontSize:"0.55rem"}}>.env.local</code>
            </div>
          ) : (
            <>
              <input
                type={showKey ? "text" : "password"}
                value={uiKey}
                onChange={e=>saveKey(e.target.value)}
                placeholder="Paste key — or set VITE_GEMINI_API_KEY in .env.local + restart"
                style={{...I,flex:1,fontSize:"0.6rem"}}
              />
              <button onClick={()=>setShowKey(v=>!v)} style={{...B,padding:"5px 10px",fontSize:"0.55rem"}}>{showKey ? "Hide" : "Show"}</button>
              {uiKey && <span style={{fontSize:"0.5rem",color:"#34D399",letterSpacing:"1px"}}>✓ SAVED</span>}
            </>
          )}
        </div>

        <div style={{
          marginBottom: "1rem",
          padding: "10px 14px",
          background: "rgba(229,188,79,0.06)",
          border: "1px solid rgba(229,188,79,0.22)",
          borderRadius: "6px",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
            <div style={{ fontSize: "0.6rem", color: "#E5BC4F", letterSpacing: "1.5px", textTransform: "uppercase", flexShrink: 0 }}>Template</div>
            <select value={template} onChange={e=>setTemplate(e.target.value)} style={{...I, flex: 1, fontSize: "0.7rem"}}>
              <option value="weekend">Weekend Roundup{events.length > 0 ? ` (${events.length} events)` : " (no events)"}</option>
              <option value="client">Client Event · Hype + Benefits</option>
            </select>
            <button
              onClick={handleGenerate}
              disabled={isAutoGen || (template === "weekend" && events.length === 0)}
              style={{
                padding: "8px 14px",
                background: (isAutoGen || (template === "weekend" && events.length === 0)) ? "rgba(229,188,79,0.4)" : "#E5BC4F",
                color: "#000", border: "none", borderRadius: "4px",
                fontSize: "0.65rem", fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase",
                cursor: isAutoGen ? "wait" : "pointer",
                fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap",
              }}
            >{isAutoGen ? "Building…" : "→ Carousel"}</button>
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

          {template === "weekend" && (
            <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.55)", marginTop: "6px" }}>
              {events.length > 0
                ? `${events.length} events → 5 slides pushed to carousel (Cover + Fri/Sat/Sun + Stat). Edit/reorder below, then Export ZIP.`
                : "Import events on Calendar tab to enable this template."}
            </div>
          )}

          {template === "client" && (
            <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
                <strong style={{color:"#E5BC4F"}}>Slide 1</strong> Cover · <strong style={{color:"#E5BC4F"}}>2</strong> Text+photo · <strong style={{color:"#E5BC4F"}}>3</strong> Features · <strong style={{color:"#E5BC4F"}}>4</strong> Photo+caption · <strong style={{color:"#E5BC4F"}}>5</strong> Stat · <strong style={{color:"#E5BC4F"}}>6</strong> CTA. → pushes to carousel below, edit/reorder/export from there.
              </div>
              <div><label style={L}>Slide 2 Title (problem hook)</label>
                <input value={clientCfg.problemTitle} onChange={e=>setClientCfg(p=>({...p,problemTitle:e.target.value}))} style={I}/></div>
              <div><label style={L}>Slide 2 highlights (space-separated words)</label>
                <input value={clientCfg.problemHighlights} onChange={e=>setClientCfg(p=>({...p,problemHighlights:e.target.value}))} style={I}/></div>
              <div><label style={L}>Slide 2 Body (*bold*)</label>
                <textarea value={clientCfg.problemBody} onChange={e=>setClientCfg(p=>({...p,problemBody:e.target.value}))} style={{...I,height:60,resize:"vertical"}}/></div>
              <div><label style={L}>Slide 3 Title (benefits)</label>
                <input value={clientCfg.benefitsTitle} onChange={e=>setClientCfg(p=>({...p,benefitsTitle:e.target.value}))} style={I}/></div>
              <div><label style={L}>CTA Kicker pill</label><input value={ctaKicker} onChange={e=>setCtaKicker(e.target.value)} style={I} placeholder="SAVE YOUR SPOT"/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem"}}>
                <div><label style={L}>CTA Date</label><input value={ctaDate} onChange={e=>setCtaDate(e.target.value)} style={I}/></div>
                <div><label style={L}>CTA Venue</label><input value={ctaVenue} onChange={e=>setCtaVenue(e.target.value)} style={I}/></div>
              </div>
              <div><label style={L}>CTA URL</label>
                <input value={ctaUrl} onChange={e=>setCtaUrl(e.target.value)} style={I}/></div>
            </div>
          )}
        </div>

        {captionsError && (
          <div style={{marginBottom:"1rem",padding:"10px 14px",background:"rgba(251,113,133,0.08)",border:"1px solid rgba(251,113,133,0.3)",borderRadius:"6px",fontSize:"0.6rem",color:"rgba(251,113,133,0.9)"}}>
            <strong>Captions error:</strong> {captionsError}
          </div>
        )}

        {captions.length > 0 && (
          <div style={{marginBottom:"1rem",display:"flex",flexDirection:"column",gap:"6px"}}>
            <div style={{fontSize:"0.55rem",color:"#63B3ED",letterSpacing:"1.5px",textTransform:"uppercase",fontWeight:700,marginBottom:"2px"}}>
              {captions.length} captions · click Copy
            </div>
            {captions.map((c, i) => (
              <div key={i} style={{padding:"10px 12px",background:"rgba(99,179,237,0.04)",border:"1px solid rgba(99,179,237,0.15)",borderRadius:"6px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px"}}>
                  <div style={{fontSize:"0.55rem",color:"#63B3ED",letterSpacing:"2px",textTransform:"uppercase",fontWeight:700,fontFamily:"'Syne',sans-serif"}}>
                    {c.tone || `Variant ${i+1}`}
                  </div>
                  <button onClick={()=>copyCaption(c.text || "", i)} style={{padding:"4px 10px",background:copiedIdx===i?"#34D399":"rgba(99,179,237,0.18)",color:copiedIdx===i?"#000":"#63B3ED",border:"none",borderRadius:"3px",fontSize:"0.55rem",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",cursor:"pointer",fontFamily:"'Syne',sans-serif"}}>
                    {copiedIdx===i?"Copied ✓":"Copy"}
                  </button>
                </div>
                <div style={{fontSize:"0.65rem",lineHeight:1.6,whiteSpace:"pre-wrap",color:"rgba(245,240,232,0.8)"}}>
                  {c.text}
                </div>
              </div>
            ))}
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
              title="Snapshot the current slide and add it to the carousel"
            >+ Add Current Slide</button>
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
                <div key={slide.id}
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
                    border: dragIdx===idx ? "2px solid #A855F7" : "1px solid rgba(168,85,247,0.3)",
                    background:"#000",
                    flexShrink:0,
                    opacity: dragIdx===idx ? 0.5 : 1,
                    userSelect: "none",
                  }}
                  title={`Slide ${idx+1} · ${slide.type} · click to edit, drag to reorder`}
                  onClick={()=>{
                    if (dragIdx !== null) return;
                    loadSnapshot(slide.snapshot, slide.type);
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
                    onClick={(e)=>{e.stopPropagation();deleteSlide(idx);}}
                    style={{position:"absolute",top:"2px",right:"2px",width:"18px",height:"18px",background:"rgba(0,0,0,0.75)",color:"#FFF",border:"none",borderRadius:"3px",fontSize:"0.85rem",lineHeight:"14px",cursor:"pointer",padding:0,fontFamily:"sans-serif"}}
                    title="Remove from carousel"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 400px",gap:"1.5rem",alignItems:"start"}}>
          <div>
            {mode==="cover"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo</label>
                <div style={{display:"flex",gap:"0.3rem"}}>
                  <button onClick={()=>fileRef.current?.click()} style={{...B,flex:1}}>{photo?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("cover")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {photo&&<button onClick={()=>setPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:"none"}}/>
                </div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Subtitle (optional)</label><input value={subtitle} onChange={e=>setSubtitle(e.target.value)} style={I} placeholder="e.g. WEEKEND GUIDE · APRIL 2026"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Ribbon (optional · short kicker)</label><input value={ribbon} onChange={e=>setRibbon(e.target.value)} style={I} placeholder="e.g. ANNOUNCING / EXCLUSIVE / BREAKING"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Headline</label><textarea value={headline} onChange={e=>setHeadline(e.target.value)} style={{...I,height:55,resize:"vertical"}} placeholder="Type headline..."/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Click words to highlight</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:"3px",padding:"6px",background:"#111",borderRadius:"6px",border:"1px solid rgba(245,240,232,0.04)"}}>
                  {words.map((w,i)=><button key={i} onClick={()=>toggleHL(i)} style={{padding:"3px 7px",borderRadius:"4px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:highlights.has(i)?`${accent}22`:"rgba(245,240,232,0.04)",color:highlights.has(i)?accent:"rgba(245,240,232,0.30)",border:highlights.has(i)?`2px solid ${accent}55`:"2px solid transparent"}}>{w}</button>)}
                </div></div>
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
            </>}

            {mode==="list"&&<>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Title</label><input value={listTitle} onChange={e=>setListTitle(e.target.value)} style={I}/></div>
                <div><label style={L}>Subtitle</label><input value={listSubtitle} onChange={e=>setListSubtitle(e.target.value)} style={I}/></div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background</label><div style={{display:"flex",gap:"3px"}}>
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
              <div style={{display:"grid",gridTemplateColumns:"120px 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Number</label><input value={statNumber} onChange={e=>setStatNumber(e.target.value)} style={{...I,fontSize:"1.2rem",fontWeight:800,textAlign:"center",fontFamily:"'Syne'"}}/></div>
                <div><label style={L}>Label</label><input value={statLabel} onChange={e=>setStatLabel(e.target.value)} style={I}/></div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Subtitle (use \n for line breaks)</label><textarea value={statSub} onChange={e=>setStatSub(e.target.value)} style={{...I,height:50,resize:"vertical"}}/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>
            </>}

            {mode==="text"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
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
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Title</label><input value={textTitle} onChange={e=>setTextTitle(e.target.value)} style={I}/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Click words to highlight</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:"3px",padding:"6px",background:"#111",borderRadius:"6px",border:"1px solid rgba(245,240,232,0.04)"}}>
                  {textWords.map((w,i)=><button key={i} onClick={()=>toggleTextHL(i)} style={{padding:"3px 7px",borderRadius:"4px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:textTitleHL.has(i)?`${accent}22`:"rgba(245,240,232,0.04)",color:textTitleHL.has(i)?accent:"rgba(245,240,232,0.30)",border:textTitleHL.has(i)?`2px solid ${accent}55`:"2px solid transparent"}}>{w}</button>)}
                </div></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Body (wrap *text* in asterisks to bold)</label><textarea value={textBody} onChange={e=>setTextBody(e.target.value)} style={{...I,height:100,resize:"vertical"}}/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Page #</label><input type="number" min="1" value={pageNum} onChange={e=>setPageNum(parseInt(e.target.value)||1)} style={{...I,textAlign:"center",fontWeight:700}}/></div>
                <div><label style={L}>Total pages</label><input type="number" min="1" value={totalPages} onChange={e=>setTotalPages(parseInt(e.target.value)||1)} style={{...I,textAlign:"center",fontWeight:700}}/></div>
              </div>
              {!textPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
            </>}

            {mode==="cta"&&<>
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
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Kicker pill (top)</label><input value={ctaKicker} onChange={e=>setCtaKicker(e.target.value)} style={I} placeholder="e.g. SAVE YOUR SPOT / JOIN US"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Date (use \n for multi-line)</label><textarea value={ctaDate} onChange={e=>setCtaDate(e.target.value)} style={{...I,height:55,resize:"vertical"}} placeholder="e.g. Sunday, June 14 · 6 PM"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Venue</label><input value={ctaVenue} onChange={e=>setCtaVenue(e.target.value)} style={I} placeholder="e.g. Pickleball HQ — Aberdeen"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>URL</label><input value={ctaUrl} onChange={e=>setCtaUrl(e.target.value)} style={I} placeholder="e.g. pbdates.org"/></div>
              {!textPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
            </>}

            {mode==="photo"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Photo</label>
                <div style={{display:"flex",gap:"0.3rem"}}>
                  <button onClick={()=>captionFileRef.current?.click()} style={{...B,flex:1}}>{captionPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("photo")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {captionPhoto&&<button onClick={()=>setCaptionPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={captionFileRef} type="file" accept="image/*" onChange={handleCaptionPhoto} style={{display:"none"}}/>
                </div>
              </div>
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
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Venue Photo</label>
                <div style={{display:"flex",gap:"0.3rem"}}>
                  <button onClick={()=>spotFileRef.current?.click()} style={{...B,flex:1}}>{spotPhoto?"✓ Photo loaded — change":"Upload Photo"}</button>
                  <button onClick={()=>openLibrary("spotlight")} style={{...B,padding:"5px 10px"}} title="Pick a photo from the library">📚</button>
                  {spotPhoto&&<button onClick={()=>setSpotPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={spotFileRef} type="file" accept="image/*" onChange={handleSpotPhoto} style={{display:"none"}}/>
                </div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Venue / event name (headline)</label>
                <textarea value={spotName} onChange={e=>setSpotName(e.target.value)} style={{...I,height:55,resize:"vertical",fontFamily:"'Syne'"}} placeholder="e.g. ROOFTOP NIGHT AT THE STANDARD"/>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Detail line (address · city)</label>
                <input value={spotMeta} onChange={e=>setSpotMeta(e.target.value)} style={I} placeholder="e.g. 9 Clinton St | Newark"/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Day · Time</label>
                  <input value={spotTime} onChange={e=>setSpotTime(e.target.value)} style={I} placeholder="Friday · 8 PM"/></div>
                <div><label style={L}>Price</label>
                  <input value={spotPrice} onChange={e=>setSpotPrice(e.target.value)} style={I} placeholder="$30 / Free"/></div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>CTA (right-side footer, accent color)</label>
                <input value={spotCta} onChange={e=>setSpotCta(e.target.value)} style={I} placeholder="tix in bio / RSVP in bio / comment SAVE"/>
              </div>
              {!spotPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color (no photo)</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.4)",lineHeight:1.5,marginTop:"4px"}}>
                Tip: build a roundup carousel by using <strong>Cover</strong> ("12 SPOTS THIS WEEKEND") as slide 1, then a Spotlight slide per venue, then a <strong>CTA</strong> slide ("comment SAVE for the full list").
              </p>
            </>}

            {/* COUNTDOWN — big "3 WEEKS / TOMORROW / TONIGHT" anticipation
                card. Run as a series leading up to a single event (World
                Cup, NBA Finals, opening night, app launch). Each new post
                you just change countText and re-export. */}
            {mode==="countdown"&&<>
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
              <div style={{marginBottom:"0.5rem",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1.5px",textTransform:"uppercase"}}>Cells · 5 max (top row 2 hero, bottom row 3 smaller)</div>
              {vibePhotos.map((p,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"32px 1fr 1.2fr auto",gap:"0.3rem",marginBottom:"0.3rem",alignItems:"center"}}>
                  <span style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.5)",letterSpacing:"1px",fontWeight:700}}>{i+1}</span>
                  <input value={vibeLabels[i]||""} onChange={e=>setVibeLabels(prev=>prev.map((x,j)=>j===i?e.target.value:x))} style={I} placeholder={"label, e.g. " + ["farmers market","french fries","firmchella","festivals","family trivia"][i]}/>
                  <div style={{display:"flex",gap:"3px"}}>
                    <button onClick={()=>vibeFileRefs[i].current?.click()} style={{...B,flex:1,fontSize:"0.55rem"}}>{p?"✓ Photo":"Upload"}</button>
                    <button onClick={()=>openLibrary(`vibe-${i}`)} style={{...B,padding:"4px 8px"}} title="Library">📚</button>
                    <input ref={vibeFileRefs[i]} type="file" accept="image/*" onChange={handleVibePhoto(i)} style={{display:"none"}}/>
                  </div>
                  {p&&<button onClick={()=>setVibePhotos(prev=>prev.map((x,j)=>j===i?null:x))} style={{...B,padding:"4px 6px",color:"rgba(251,113,133,0.6)"}}>×</button>}
                </div>
              ))}
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

            {mode==="features"&&<>
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
              <div style={{marginBottom:"0.5rem",fontSize:"0.5rem",color:"rgba(245,240,232,0.4)",letterSpacing:"1.5px",textTransform:"uppercase"}}>4 Cards · 2×2 Grid</div>
              {features.map((card,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr",gap:"0.3rem",marginBottom:"0.4rem",alignItems:"center"}}>
                  <input value={card.emoji} onChange={e=>setFeatures(p=>p.map((c,j)=>j===i?{...c,emoji:e.target.value}:c))} style={{...I,textAlign:"center",fontSize:"1rem",padding:"4px"}} placeholder="🎾" maxLength={4}/>
                  <input value={card.headline} onChange={e=>setFeatures(p=>p.map((c,j)=>j===i?{...c,headline:e.target.value}:c))} style={{...I,fontSize:"0.6rem"}} placeholder="Headline"/>
                  <input value={card.sub} onChange={e=>setFeatures(p=>p.map((c,j)=>j===i?{...c,sub:e.target.value}:c))} style={{...I,fontSize:"0.6rem"}} placeholder="Sub copy"/>
                </div>
              ))}
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

          <div><label style={{...L,marginBottom:"6px"}}>Preview</label>
            <canvas ref={cvRef} style={{width:390,height:390,borderRadius:"4px",display:"block",background:"#000"}}/>
          </div>
        </div>
      </div>
      <PhotoLibraryModal
        open={libOpen}
        onClose={() => setLibOpen(false)}
        onPick={onLibraryPick}
        outputAs="image"
        initialFilter="media"
      />
    </div>
  );
}

const L={display:"block",fontSize:"0.5rem",letterSpacing:"1.5px",textTransform:"uppercase",color:"rgba(245,240,232,0.22)",marginBottom:"3px"};
const I={width:"100%",padding:"5px 7px",background:"#111",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif",fontSize:"0.7rem",outline:"none"};
const B={padding:"5px 8px",background:"rgba(245,240,232,0.04)",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"rgba(245,240,232,0.35)",fontSize:"0.65rem",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"};
