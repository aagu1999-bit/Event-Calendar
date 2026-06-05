import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import { useEventsStore } from "../store";
import { generateCaptions } from "../shared/gemini";
import { savePhotoAndNotify, saveExport } from "../shared/photoLibrary.js";
import { PhotoLibraryModal } from "../shared/PhotoLibraryModal.jsx";

const COLORS = {
  yellow:{name:"Yellow",hex:"#FACC15"},purple:{name:"Purple",hex:"#C084FC"},
  wine:{name:"Wine",hex:"#FB7185"},emerald:{name:"Emerald",hex:"#34D399"},
  gold:{name:"Gold",hex:"#FBBF24"},white:{name:"White",hex:"#FFFFFF"},
};
const BG_COLORS = {
  black:{name:"Black",hex:"#000000"},purple:{name:"Purple",hex:"#7C3AED"},
  wine:{name:"Wine",hex:"#BE3A34"},emerald:{name:"Emerald",hex:"#059669"},
  gold:{name:"Gold",hex:"#D4943A"},yellow:{name:"Yellow",hex:"#EAB308"},
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

function drawLogo(ctx, accent, W) {
  if (!_watermark) return;
  ctx.globalAlpha = 1;
  ctx.fillStyle = `${accent}25`; ctx.strokeStyle = `${accent}50`; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(58,52,28,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.font=ff("800 17px 'Syne',sans-serif"); ctx.fillStyle = accent; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText("CGE",58,53); ctx.textAlign = "left";
  ctx.font=ff("700 22px 'DM Sans',sans-serif"); ctx.fillStyle = "#FFF"; ctx.textBaseline = "top"; ctx.fillText("Central Group Events",96,35);
  ctx.font=ff("500 17px 'DM Sans',sans-serif"); ctx.fillStyle = "rgba(255,255,255,0.50)"; ctx.fillText("@centralgroupevents",96,60);
}

function drawDots(ctx, W, current, total, accent) {
  if (total <= 1) return;
  const sx = W - 40 - (total-1)*18;
  for (let i = 0; i < total; i++) {
    ctx.beginPath(); ctx.arc(sx+i*18, 52, i===(current-1)?6:4, 0, Math.PI*2);
    ctx.fillStyle = i===(current-1) ? accent : "rgba(255,255,255,0.30)"; ctx.fill();
  }
}

function drawFooter(ctx, W, H) {
  if (!_watermark) return;
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(60, H-38, W-120, 1);
  ctx.font=ff("800 16px 'Syne',sans-serif"); ctx.fillStyle = "rgba(255,255,255,0.20)"; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
  ctx.fillText("CENTRAL GROUP EVENTS", 60, H-14);
  ctx.font=ff("500 14px 'DM Sans',sans-serif"); ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.textAlign = "right";
  ctx.fillText("centralgroupevents.com", W-60, H-14); ctx.textAlign = "left";
}

function drawPageNum(ctx, W, H, current, total, accent) {
  if (total <= 1) return;
  ctx.font=ff("600 16px 'DM Sans',sans-serif"); ctx.fillStyle = "rgba(255,255,255,0.20)";
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
  ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
  const isBlack=bgKey==="black";
  drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:0.14);
  if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.40);
  else drawSpotlight(ctx,W,H,"229,188,79",0.30);

  ctx.globalAlpha=1; ctx.textBaseline="top"; ctx.textAlign="left";
  drawDots(ctx,W,dots,totalDots,accent);
  ctx.font=ff("800 52px 'Syne',sans-serif"); ctx.fillStyle=accent; ctx.fillText((listTitle||"FRIDAY").toUpperCase(),60,50);
  ctx.font=ff("700 22px 'DM Sans',sans-serif"); ctx.fillStyle="rgba(255,255,255,0.35)"; ctx.letterSpacing="2px";
  ctx.fillText((listSubtitle||"TOP PICKS").toUpperCase(),60,108); ctx.letterSpacing="0px";
  ctx.fillStyle = `${accent}30`; ctx.fillRect(60,140,W-120,2);

  const startY=155, rowH=100, maxItems=Math.min(items.length,8);
  items.slice(0,maxItems).forEach((item,i)=>{
    const y=startY+i*rowH;
    ctx.fillStyle="rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.roundRect(60,y,W-120,rowH-12,10); ctx.fill();
    ctx.fillStyle=item.featured?accent:"rgba(255,255,255,0.10)";
    ctx.beginPath(); ctx.roundRect(60,y,4,rowH-12,[10,0,0,10]); ctx.fill();
    ctx.font=ff("700 34px 'DM Sans',sans-serif"); ctx.fillStyle=item.featured?accent:"#FFF"; ctx.textBaseline="top";
    let nm=item.name.toUpperCase(); if(ctx.measureText(nm).width>W-240){while(ctx.measureText(nm+"..").width>W-240&&nm.length>0)nm=nm.slice(0,-1);nm+="..";}
    ctx.fillText(nm,82,y+14);
    ctx.font=ff("400 26px 'DM Sans',sans-serif"); ctx.fillStyle="rgba(255,255,255,0.45)";
    ctx.fillText(item.detail||"",82,y+54);
  });

  drawFooter(ctx,W,H);
}

// === STAT RENDERER ===
function renderStat(canvas, cfg) {
  const { statNumber, statLabel, statSub, accent, bgKey, dots, totalDots } = cfg;
  const W=1080,H=1080; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  const bg=BG_COLORS[bgKey]||BG_COLORS.purple;
  ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
  const isBlack=bgKey==="black";
  drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.06:0.14);
  if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.45);
  else drawSpotlight(ctx,W,H,"229,188,79",0.35);

  ctx.globalAlpha=1;
  ctx.font=ff("800 280px 'Syne',sans-serif"); ctx.fillStyle="#FFF"; ctx.textBaseline="middle"; ctx.textAlign="center";
  let numFS=280; ctx.font=ff(`800 ${numFS}px 'Syne',sans-serif`);
  while(ctx.measureText(statNumber||"47").width>W-160&&numFS>80){numFS-=10;ctx.font=ff(`800 ${numFS}px 'Syne',sans-serif`);}
  ctx.fillText(statNumber||"47",W/2,H*0.42);

  ctx.font=ff("800 52px 'Syne',sans-serif"); ctx.fillStyle="#FFF"; ctx.letterSpacing="6px";
  ctx.fillText((statLabel||"EVENTS").toUpperCase(),W/2,H*0.58); ctx.letterSpacing="0px";

  ctx.fillStyle="rgba(255,255,255,0.25)"; ctx.fillRect(W/2-40,H*0.64,80,3);

  if(statSub?.trim()){
    ctx.font=ff("400 28px 'DM Sans',sans-serif"); ctx.fillStyle="rgba(255,255,255,0.55)"; ctx.textBaseline="top";
    const subLines=statSub.split("\n");
    subLines.forEach((ln,i)=>ctx.fillText(ln.trim(),W/2,H*0.67+i*36));
  }

  ctx.textAlign="left"; ctx.textBaseline="top";
  drawDots(ctx,W,dots,totalDots,accent); drawFooter(ctx,W,H);
}

// === TEXT RENDERER ===
function renderText(canvas, cfg) {
  const { textTitle, textTitleHighlights, textBody, accent, bgKey, dots, totalDots, pageNum, totalPages, photo, textOpacity } = cfg;
  const W=1080,H=1080; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.fillStyle=`rgba(0,0,0,${textOpacity||0.85})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    const bg=BG_COLORS[bgKey]||BG_COLORS.black;
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack=bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:0.10);
    if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.35);
  }

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
    lw.forEach(w=>{ctx.fillStyle=textTitleHighlights.has(w.idx)?accent:"#FFF";ctx.fillText(w.text,x,y);x+=w.width+sw;});
  });

  const barY=titleY+lines.length*lh+18;
  ctx.fillStyle=accent; ctx.fillRect(W/2-25,barY,50,4);

  if(textBody?.trim()){
    ctx.font=ff("400 30px 'DM Sans',sans-serif"); ctx.fillStyle="rgba(255,255,255,0.65)";
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
          ctx.font=ff("700 30px 'DM Sans',sans-serif"); ctx.fillStyle="#FFF";
          ctx.fillText(inner,x,y); x+=ctx.measureText(inner).width;
          ctx.font=ff("400 30px 'DM Sans',sans-serif"); ctx.fillStyle="rgba(255,255,255,0.65)";
        } else {
          ctx.fillText(part,x,y); x+=ctx.measureText(part).width;
        }
      });
    });
  }

  if (_watermark) {
    ctx.fillStyle="rgba(255,255,255,0.08)"; ctx.fillRect(60,H-38,W-120,1);
    ctx.font=ff("800 16px 'Syne',sans-serif"); ctx.fillStyle="rgba(255,255,255,0.20)"; ctx.textBaseline="bottom";
    ctx.fillText("CENTRAL GROUP EVENTS",60,H-14);
  }
  drawPageNum(ctx,W,H,pageNum,totalPages,accent);
  drawDots(ctx,W,dots,totalDots,accent);
}

// === CTA RENDERER ===
function renderCTA(canvas, cfg) {
  const { ctaKicker, ctaDate, ctaVenue, ctaUrl, photo, accent, bgKey, dots, totalDots, opacity } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity||0.88})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    const bg = BG_COLORS[bgKey]||BG_COLORS.black;
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack = bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:0.10);
    if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.40);
    else drawSpotlight(ctx,W,H,"229,188,79",0.30);
  }

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
  ctx.fillStyle="#FFF"; ctx.textAlign="center";
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
  ctx.font=ff("700 38px 'DM Sans',sans-serif"); ctx.fillStyle="rgba(255,255,255,0.88)";
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
  drawDots(ctx,W,dots,totalDots,accent);
  drawFooter(ctx,W,H);
}

// === PHOTO + CAPTION RENDERER ===
function renderPhotoCaption(canvas, cfg) {
  const { photo, caption, captionSecondary, alignment, accent, bgKey, dots, totalDots } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
  } else {
    const bg=BG_COLORS[bgKey]||BG_COLORS.black;
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.05);
  }

  // Bottom gradient for legibility
  if (caption?.trim() || captionSecondary?.trim()) {
    const grd=ctx.createLinearGradient(0,H*0.50,0,H);
    grd.addColorStop(0,"transparent");
    grd.addColorStop(0.4,"rgba(0,0,0,0.55)");
    grd.addColorStop(1,"rgba(0,0,0,0.88)");
    ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
  }

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
    ctx.fillStyle="#FFF"; ctx.textAlign=align;
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
  drawLogo(ctx, accent, W);
  drawDots(ctx, W, dots, totalDots, accent);
  drawFooter(ctx, W, H);
}

// === FEATURES RENDERER (2x2 emoji-card grid) ===
function renderFeatures(canvas, cfg) {
  const { featuresTitle, features, accent, bgKey, dots, totalDots, photo, opacity } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");

  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height);
    const dw=photo.width*s, dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity||0.88})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    const bg=BG_COLORS[bgKey]||BG_COLORS.black;
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack=bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:0.10);
    if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.35);
  }

  ctx.globalAlpha=1; ctx.textBaseline="top";

  // Title at top, centered
  let titleBottom = 70;
  if (featuresTitle?.trim()) {
    let fs = 52;
    ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`);
    const t = featuresTitle.toUpperCase();
    while (ctx.measureText(t).width > W-120 && fs > 32) { fs -= 2; ctx.font=ff(`800 ${fs}px 'Syne',sans-serif`); }
    ctx.fillStyle="#FFF"; ctx.textAlign="center";
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
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath(); ctx.roundRect(x, y, cw, ch, 12); ctx.fill();

    // Left accent stripe
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(x, y, 5, ch, [12, 0, 0, 12]); ctx.fill();

    // Emoji
    if (card.emoji?.trim()) {
      ctx.font=ff("78px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif");
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillStyle = "#FFF";
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
      ctx.fillStyle = "#FFF"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(headlineText, x + 28, y + 144);
    }

    // Sub (wrap to 2 lines max)
    if (card.sub?.trim()) {
      ctx.font=ff("400 20px 'DM Sans',sans-serif");
      ctx.fillStyle = "rgba(255,255,255,0.6)";
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
  drawDots(ctx, W, dots, totalDots, accent);
  drawFooter(ctx, W, H);
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
    const displayQ = pair.display.replace(/ /g, "+") + ":wght@800";
    const bodyQ = pair.body.replace(/ /g, "+") + ":wght@400;500;700";
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
  const runCaptions = async () => {
    if (!geminiKey || isGenCaptions) return;
    setIsGenCaptions(true); setCaptionsError(""); setCaptions([]);
    try {
      const ctx = {
        headline, subtitle, ribbon,
        problemTitle: clientCfg.problemTitle, problemBody: clientCfg.problemBody,
        benefits: clientCfg.benefits,
        statNumber, statLabel, statSub,
        ctaDate, ctaVenue, ctaUrl,
      };
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

  const cvRef = useRef(null), fileRef = useRef(null), textFileRef = useRef(null), captionFileRef = useRef(null);
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
  },[mode,photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,ribbon,items,bgKey,listTitle,listSubtitle,statNumber,statLabel,statSub,textTitle,textTitleHL,textBody,pageNum,totalPages,textPhoto,textOpacity,ctaKicker,ctaDate,ctaVenue,ctaUrl,featuresTitle,features,captionPhoto,caption,captionSecondary,captionAlign,watermark,fontTick]);

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

  // Library picker state — opened by the "📚 Library" button next to each
  // Upload Photo button. `pickTarget` decides which setter to feed.
  const [libOpen, setLibOpen] = useState(false);
  const [pickTarget, setPickTarget] = useState(null); // "cover" | "text" | "photo"
  const openLibrary = (target) => { setPickTarget(target); setLibOpen(true); };
  const onLibraryPick = (img) => {
    if (pickTarget === "cover")      setPhoto(img);
    else if (pickTarget === "photo") setCaptionPhoto(img);
    else                              setTextPhoto(img); // text/cta/features share textPhoto
  };

  const dl=()=>{const cv=document.createElement("canvas");
    if(mode==="cover") renderCover(cv,{photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,ribbon});
    else if(mode==="list") renderList(cv,{items,accent,bgKey,dots,totalDots,listTitle,listSubtitle});
    else if(mode==="stat") renderStat(cv,{statNumber,statLabel,statSub,accent,bgKey,dots,totalDots});
    else if(mode==="text") renderText(cv,{textTitle,textTitleHighlights:textTitleHL,textBody,accent,bgKey,dots,totalDots,pageNum,totalPages,photo:textPhoto,textOpacity});
    else if(mode==="cta") renderCTA(cv,{ctaKicker,ctaDate,ctaVenue,ctaUrl,photo:textPhoto,accent,bgKey,dots,totalDots,opacity:textOpacity});
    else if(mode==="features") renderFeatures(cv,{featuresTitle,features,accent,bgKey,dots,totalDots,photo:textPhoto,opacity:textOpacity});
    else if(mode==="photo") renderPhotoCaption(cv,{photo:captionPhoto,caption,captionSecondary,alignment:captionAlign,accent,bgKey,dots,totalDots});
    const exportCv = wrapForExport(cv, exportRatio);
    exportCv.toBlob(blob=>{
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      const filename=`CGE_${mode}_slide_${exportRatio.replace(":","x")}.png`;
      a.download=filename;
      a.href=url;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      URL.revokeObjectURL(url);
      saveExport(blob, { sourceTool: "media", sourceMode: `${mode}-${exportRatio}`, name: filename })
        .catch(err => console.warn("Export archive failed:", err));
    },"image/png");
  };

  const MODES=[["cover","Cover"],["list","List"],["stat","Stat"],["text","Text"],["cta","CTA"],["features","Features"],["photo","Photo"]];

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
    }
  };

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
      saveExport(zipBlob, { sourceTool: "media", sourceMode: `carousel-${exportRatio}`, name: zipName, kind: "archive" })
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
              title={!geminiKey ? "Paste your Gemini API key above first" : useVision && carousel.length>0 ? `Generate 8 captions using vision (${carousel.length} slide images)` : "Generate 8 caption variants"}
              style={{
                padding: "8px 14px",
                background: isGenCaptions ? "rgba(99,179,237,0.4)" : (geminiKey ? "#63B3ED" : "rgba(99,179,237,0.25)"),
                color: "#000", border: "none", borderRadius: "4px",
                fontSize: "0.65rem", fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase",
                cursor: !geminiKey ? "not-allowed" : (isGenCaptions ? "wait" : "pointer"),
                fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap",
              }}
            >{isGenCaptions ? "Writing…" : (useVision && carousel.length>0 ? `👁 Captions` : "Captions")}</button>
            <button
              onClick={()=>setUseVision(v=>!v)}
              disabled={carousel.length===0}
              title={carousel.length===0 ? "Add slides to the carousel first to enable vision" : "Toggle vision: send rendered slide images to Gemini for richer captions"}
              style={{
                padding: "6px 10px",
                background: useVision && carousel.length>0 ? "rgba(99,179,237,0.18)" : "transparent",
                color: useVision && carousel.length>0 ? "#63B3ED" : "rgba(245,240,232,0.4)",
                border: useVision && carousel.length>0 ? "2px solid #63B3ED" : "2px solid rgba(245,240,232,0.1)",
                borderRadius: "4px",
                fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase",
                cursor: carousel.length===0 ? "not-allowed" : "pointer",
                fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap",
                opacity: carousel.length===0 ? 0.4 : 1,
              }}
            >👁 Vision {useVision && carousel.length>0 ? "ON" : ""}</button>
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
