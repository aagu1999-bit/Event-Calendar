import { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import { useEventsStore } from "../store";

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

function drawTexture(ctx, W, H, color, alpha, startY = 0) {
  ctx.save();
  if (startY > 0) { ctx.beginPath(); ctx.rect(0, startY, W, H - startY); ctx.clip(); }
  ctx.translate(W/2, H*0.6); ctx.rotate(-5*Math.PI/180); ctx.translate(-W/2, -H*0.6);
  ctx.font = "800 22px 'Syne',sans-serif"; ctx.fillStyle = color; ctx.globalAlpha = alpha;
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
  ctx.globalAlpha = 1;
  ctx.fillStyle = `${accent}25`; ctx.strokeStyle = `${accent}50`; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(58,52,28,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.font = "800 17px 'Syne',sans-serif"; ctx.fillStyle = accent; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText("CGE",58,53); ctx.textAlign = "left";
  ctx.font = "700 22px 'DM Sans',sans-serif"; ctx.fillStyle = "#FFF"; ctx.textBaseline = "top"; ctx.fillText("Central Group Events",96,35);
  ctx.font = "500 17px 'DM Sans',sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.50)"; ctx.fillText("@centralgroupevents",96,60);
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
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(60, H-38, W-120, 1);
  ctx.font = "800 16px 'Syne',sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.20)"; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
  ctx.fillText("CENTRAL GROUP EVENTS", 60, H-14);
  ctx.font = "500 14px 'DM Sans',sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.textAlign = "right";
  ctx.fillText("centralgroupevents.com", W-60, H-14); ctx.textAlign = "left";
}

function drawPageNum(ctx, W, H, current, total, accent) {
  if (total <= 1) return;
  ctx.font = "600 16px 'DM Sans',sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.20)";
  ctx.textBaseline = "bottom"; ctx.textAlign = "right";
  ctx.fillText(`${current}/${total}`, W-60, H-14); ctx.textAlign = "left";
}

// === COVER RENDERER ===
function renderCover(canvas, cfg) {
  const { photo, headline, highlights, accent, dots, totalDots, subtitle, opacity } = cfg;
  const W=1080, H=1080; canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext("2d");
  if (photo) { const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s; ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh); }
  else { ctx.fillStyle="#111"; ctx.fillRect(0,0,W,H); }
  const grd=ctx.createLinearGradient(0,H*0.25,0,H); grd.addColorStop(0,"transparent"); grd.addColorStop(0.3,`rgba(0,0,0,${opacity*0.6})`); grd.addColorStop(0.55,`rgba(0,0,0,${opacity*0.88})`); grd.addColorStop(1,`rgba(0,0,0,${opacity})`); ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
  drawTexture(ctx,W,H,"#FFF",0.04,H*0.4);
  drawLogo(ctx,accent,W); drawDots(ctx,W,dots,totalDots,accent);
  if (subtitle?.trim()) { ctx.font="700 24px 'DM Sans',sans-serif"; ctx.fillStyle=accent; ctx.textBaseline="top"; ctx.letterSpacing="3px"; }
  if (!headline?.trim()) { drawFooter(ctx,W,H); return; }
  const words=headline.split(/\s+/).filter(w=>w), px=60, maxW=W-px*2;
  let fs=72; ctx.font=`800 ${fs}px 'Syne',sans-serif`;
  const wrap=(f)=>{ ctx.font=`800 ${f}px 'Syne',sans-serif`; const r=[]; let cl=[],cw=0; const sw=ctx.measureText(" ").width;
    for(let i=0;i<words.length;i++){const t=words[i].toUpperCase(),ww=ctx.measureText(t).width;if(cl.length>0&&cw+sw+ww>maxW){r.push(cl);cl=[{text:t,idx:i,width:ww}];cw=ww;}else{cw+=(cl.length>0?sw:0)+ww;cl.push({text:t,idx:i,width:ww});}}if(cl.length)r.push(cl);return r;};
  let lines=wrap(fs); while(lines.length*(fs*1.05)>H*0.55&&fs>36){fs-=2;lines=wrap(fs);}
  const lh=fs*1.05, totalH=lines.length*lh, startY=H-50-totalH;
  if(subtitle?.trim()){ctx.font="700 24px 'DM Sans',sans-serif";ctx.fillStyle=accent;ctx.textBaseline="bottom";ctx.letterSpacing="3px";ctx.fillText(subtitle.toUpperCase(),60,startY-12);ctx.letterSpacing="0px";}
  ctx.font=`800 ${fs}px 'Syne',sans-serif`; ctx.textBaseline="top"; const sw=ctx.measureText(" ").width;
  lines.forEach((lw,li)=>{let x=px;const y=startY+li*lh;lw.forEach(w=>{ctx.fillStyle=highlights.has(w.idx)?accent:"#FFF";ctx.fillText(w.text,x,y);x+=w.width+sw;});});
  drawFooter(ctx,W,H);
}

// === LIST RENDERER ===
function renderList(canvas, cfg) {
  const { items, accent, bgKey, dots, totalDots, listTitle, listSubtitle, photo, opacity } = cfg;
  const W=1080,H=1080; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity||0.75})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    const bg=BG_COLORS[bgKey]||BG_COLORS.black;
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack=bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.04:0.14);
    if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.40);
    else drawSpotlight(ctx,W,H,"229,188,79",0.30);
  }

  ctx.globalAlpha=1; ctx.textBaseline="top"; ctx.textAlign="left";
  drawDots(ctx,W,dots,totalDots,accent);
  ctx.font="800 52px 'Syne',sans-serif"; ctx.fillStyle=accent; ctx.fillText((listTitle||"FRIDAY").toUpperCase(),60,50);
  ctx.font="700 22px 'DM Sans',sans-serif"; ctx.fillStyle="rgba(255,255,255,0.35)"; ctx.letterSpacing="2px";
  ctx.fillText((listSubtitle||"TOP PICKS").toUpperCase(),60,108); ctx.letterSpacing="0px";
  ctx.fillStyle = `${accent}30`; ctx.fillRect(60,140,W-120,2);

  const startY=155, rowH=100, maxItems=Math.min(items.length,8);
  items.slice(0,maxItems).forEach((item,i)=>{
    const y=startY+i*rowH;
    ctx.fillStyle="rgba(255,255,255,0.06)"; ctx.beginPath(); ctx.roundRect(60,y,W-120,rowH-12,10); ctx.fill();
    ctx.fillStyle=item.featured?accent:"rgba(255,255,255,0.10)";
    ctx.beginPath(); ctx.roundRect(60,y,4,rowH-12,[10,0,0,10]); ctx.fill();
    ctx.font="700 34px 'DM Sans',sans-serif"; ctx.fillStyle=item.featured?accent:"#FFF"; ctx.textBaseline="top";
    let nm=item.name.toUpperCase(); if(ctx.measureText(nm).width>W-240){while(ctx.measureText(nm+"..").width>W-240&&nm.length>0)nm=nm.slice(0,-1);nm+="..";}
    ctx.fillText(nm,82,y+14);
    ctx.font="400 26px 'DM Sans',sans-serif"; ctx.fillStyle="rgba(255,255,255,0.45)";
    ctx.fillText(item.detail||"",82,y+54);
  });

  drawFooter(ctx,W,H);
}

// === STAT RENDERER ===
function renderStat(canvas, cfg) {
  const { statNumber, statLabel, statSub, accent, bgKey, dots, totalDots, photo, opacity } = cfg;
  const W=1080,H=1080; canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  if (photo) {
    const s=Math.max(W/photo.width,H/photo.height); const dw=photo.width*s,dh=photo.height*s;
    ctx.drawImage(photo,(W-dw)/2,(H-dh)/2,dw,dh);
    ctx.fillStyle=`rgba(0,0,0,${opacity||0.85})`; ctx.fillRect(0,0,W,H);
    drawTexture(ctx,W,H,"#FFF",0.03);
  } else {
    const bg=BG_COLORS[bgKey]||BG_COLORS.purple;
    ctx.fillStyle=bg.hex; ctx.fillRect(0,0,W,H);
    const isBlack=bgKey==="black";
    drawTexture(ctx,W,H,isBlack?"#FACC15":"#000",isBlack?0.06:0.14);
    if(!isBlack) drawSpotlight(ctx,W,H,"255,255,255",0.45);
    else drawSpotlight(ctx,W,H,"229,188,79",0.35);
  }

  ctx.globalAlpha=1;
  ctx.font="800 280px 'Syne',sans-serif"; ctx.fillStyle="#FFF"; ctx.textBaseline="middle"; ctx.textAlign="center";
  let numFS=280; ctx.font=`800 ${numFS}px 'Syne',sans-serif`;
  while(ctx.measureText(statNumber||"47").width>W-160&&numFS>80){numFS-=10;ctx.font=`800 ${numFS}px 'Syne',sans-serif`;}
  ctx.fillText(statNumber||"47",W/2,H*0.42);

  ctx.font="800 52px 'Syne',sans-serif"; ctx.fillStyle="#FFF"; ctx.letterSpacing="6px";
  ctx.fillText((statLabel||"EVENTS").toUpperCase(),W/2,H*0.58); ctx.letterSpacing="0px";

  ctx.fillStyle="rgba(255,255,255,0.25)"; ctx.fillRect(W/2-40,H*0.64,80,3);

  if(statSub?.trim()){
    ctx.font="400 28px 'DM Sans',sans-serif"; ctx.fillStyle="rgba(255,255,255,0.55)"; ctx.textBaseline="top";
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
  let fs=60; ctx.font=`800 ${fs}px 'Syne',sans-serif`;
  const wrap=(f)=>{ctx.font=`800 ${f}px 'Syne',sans-serif`;const r=[];let cl=[],cw=0;const sw=ctx.measureText(" ").width;
    for(let i=0;i<words.length;i++){const t=words[i].toUpperCase(),ww=ctx.measureText(t).width;if(cl.length>0&&cw+sw+ww>maxW){r.push(cl);cl=[{text:t,idx:i,width:ww}];cw=ww;}else{cw+=(cl.length>0?sw:0)+ww;cl.push({text:t,idx:i,width:ww});}}if(cl.length)r.push(cl);return r;};
  let lines=wrap(fs); while(lines.length*(fs*1.05)>H*0.30&&fs>30){fs-=2;lines=wrap(fs);}
  const lh=fs*1.05, sw=ctx.measureText(" ").width;
  const titleY=55;
  lines.forEach((lw,li)=>{let x=px;const y=titleY+li*lh;lw.forEach(w=>{ctx.fillStyle=textTitleHighlights.has(w.idx)?accent:"#FFF";ctx.fillText(w.text,x,y);x+=w.width+sw;});});

  const barY=titleY+lines.length*lh+16;
  ctx.fillStyle=accent; ctx.fillRect(px,barY,50,4);

  if(textBody?.trim()){
    ctx.font="400 30px 'DM Sans',sans-serif"; ctx.fillStyle="rgba(255,255,255,0.65)";
    const bodyY=barY+28;
    const bodyWords=textBody.split(/\s+/);
    const bodyLines=[];let bl="";
    for(const w of bodyWords){const test=bl?bl+" "+w:w;if(ctx.measureText(test).width>maxW&&bl){bodyLines.push(bl);bl=w;}else bl=test;}
    if(bl)bodyLines.push(bl);

    bodyLines.forEach((ln,i)=>{
      const y=bodyY+i*42;
      if(y>H-60) return;
      let x=px;
      const parts=ln.split(/(\*[^*]+\*)/g);
      parts.forEach(part=>{
        if(part.startsWith("*")&&part.endsWith("*")){
          const inner=part.slice(1,-1);
          ctx.font="700 30px 'DM Sans',sans-serif"; ctx.fillStyle="#FFF";
          ctx.fillText(inner,x,y); x+=ctx.measureText(inner).width;
          ctx.font="400 30px 'DM Sans',sans-serif"; ctx.fillStyle="rgba(255,255,255,0.65)";
        } else {
          ctx.fillText(part,x,y); x+=ctx.measureText(part).width;
        }
      });
    });
  }

  ctx.fillStyle="rgba(255,255,255,0.08)"; ctx.fillRect(60,H-38,W-120,1);
  ctx.font="800 16px 'Syne',sans-serif"; ctx.fillStyle="rgba(255,255,255,0.20)"; ctx.textBaseline="bottom";
  ctx.fillText("CENTRAL GROUP EVENTS",60,H-14);
  drawPageNum(ctx,W,H,pageNum,totalPages,accent);
  drawDots(ctx,W,dots,totalDots,accent);
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
  const [listPhoto, setListPhoto] = useState(null);
  const [listOpacity, setListOpacity] = useState(0.75);
  const [statPhoto, setStatPhoto] = useState(null);
  const [statOpacity, setStatOpacity] = useState(0.85);
  const [editItem, setEditItem] = useState(null);
  // In-memory photo bin — drag-drop multiple images, click a thumbnail to
  // bind it to the active slide. Carousel auto-gen falls back to the bin
  // by position when a slide has no explicit photo pinned.
  const [photoBin, setPhotoBin] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const cvRef = useRef(null), fileRef = useRef(null), textFileRef = useRef(null);
  const listFileRef = useRef(null), statFileRef = useRef(null), binFileRef = useRef(null);
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
    if(mode==="cover") renderCover(cv,{photo,headline,highlights,accent,dots,totalDots,subtitle,opacity});
    else if(mode==="list") renderList(cv,{items,accent,bgKey,dots,totalDots,listTitle,listSubtitle,photo:listPhoto,opacity:listOpacity});
    else if(mode==="stat") renderStat(cv,{statNumber,statLabel,statSub,accent,bgKey,dots,totalDots,photo:statPhoto,opacity:statOpacity});
    else if(mode==="text") renderText(cv,{textTitle,textTitleHighlights:textTitleHL,textBody,accent,bgKey,dots,totalDots,pageNum,totalPages,photo:textPhoto,textOpacity});
  },[mode,photo,headline,highlights,accent,dots,totalDots,subtitle,opacity,items,bgKey,listTitle,listSubtitle,listPhoto,listOpacity,statNumber,statLabel,statSub,statPhoto,statOpacity,textTitle,textTitleHL,textBody,pageNum,totalPages,textPhoto,textOpacity]);

  useEffect(()=>{const t=setTimeout(render,60);return()=>clearTimeout(t);},[render]);

  // Convert a File to a decoded Image (data-URL src) — used by both the bin
  // and the per-slide upload buttons. Returns a Promise so callers can chain.
  const fileToImage = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = ev => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = ev.target.result;
    };
    r.readAsDataURL(file);
  });
  // Per-slide uploads now also drop the photo into the bin so it can be
  // re-used on other slides without re-uploading.
  const handleSlidePhoto = async (file, setter) => {
    try {
      const img = await fileToImage(file);
      setter(img);
      setPhotoBin(prev => [...prev, img]);
    } catch (err) { console.error("Photo load failed:", err); }
  };
  const handlePhoto     = (e) => { const f = e.target.files[0]; if (f) handleSlidePhoto(f, setPhoto);     e.target.value = ""; };
  const handleTextPhoto = (e) => { const f = e.target.files[0]; if (f) handleSlidePhoto(f, setTextPhoto); e.target.value = ""; };
  const handleListPhoto = (e) => { const f = e.target.files[0]; if (f) handleSlidePhoto(f, setListPhoto); e.target.value = ""; };
  const handleStatPhoto = (e) => { const f = e.target.files[0]; if (f) handleSlidePhoto(f, setStatPhoto); e.target.value = ""; };

  // Bin-only adds — multi-file picker and drag-drop. Doesn't auto-bind to
  // any slide; user clicks a thumbnail to pin to the active slide, or the
  // carousel auto-gen picks them up by position.
  const addFilesToBin = async (files) => {
    const list = Array.from(files || []).filter(f => f.type.startsWith("image/"));
    if (list.length === 0) return;
    const imgs = await Promise.all(list.map(f => fileToImage(f).catch(() => null)));
    const ok = imgs.filter(Boolean);
    if (ok.length) setPhotoBin(prev => [...prev, ...ok]);
  };
  const handleBinFileInput = (e) => { addFilesToBin(e.target.files); e.target.value = ""; };
  const handleBinDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFilesToBin(e.dataTransfer?.files);
  };
  const removeFromBin = (idx) => {
    const removed = photoBin[idx];
    setPhotoBin(prev => prev.filter((_, i) => i !== idx));
    // If any slide was pinned to this photo, clear its pin so the slide
    // either falls back to bin-by-position (in carousel) or has no photo.
    if (photo === removed)     setPhoto(null);
    if (listPhoto === removed) setListPhoto(null);
    if (statPhoto === removed) setStatPhoto(null);
    if (textPhoto === removed) setTextPhoto(null);
  };

  // Active slide → which photo state to read/write when the user clicks a
  // bin thumbnail. Keeps the bin UI mode-aware without separate strips.
  const activePhoto =
    mode === "cover" ? photo :
    mode === "list"  ? listPhoto :
    mode === "stat"  ? statPhoto :
    mode === "text"  ? textPhoto : null;
  const setActivePhoto = (img) => {
    if (mode === "cover") setPhoto(img);
    else if (mode === "list") setListPhoto(img);
    else if (mode === "stat") setStatPhoto(img);
    else if (mode === "text") setTextPhoto(img);
  };

  const dl=()=>{const cv=document.createElement("canvas");
    if(mode==="cover") renderCover(cv,{photo,headline,highlights,accent,dots,totalDots,subtitle,opacity});
    else if(mode==="list") renderList(cv,{items,accent,bgKey,dots,totalDots,listTitle,listSubtitle,photo:listPhoto,opacity:listOpacity});
    else if(mode==="stat") renderStat(cv,{statNumber,statLabel,statSub,accent,bgKey,dots,totalDots,photo:statPhoto,opacity:statOpacity});
    else if(mode==="text") renderText(cv,{textTitle,textTitleHighlights:textTitleHL,textBody,accent,bgKey,dots,totalDots,pageNum,totalPages,photo:textPhoto,textOpacity});
    cv.toBlob(blob=>{const url=URL.createObjectURL(blob);const a=document.createElement("a");a.download=`CGE_${mode}_slide.png`;a.href=url;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);},"image/png");
  };

  const MODES=[["cover","Cover"],["list","List"],["stat","Stat"],["text","Text"]];

  // Auto-generate a 5-slide weekend carousel from the events store:
  //   1. Cover — headline with event count
  //   2. List — Friday top picks
  //   3. List — Saturday top picks
  //   4. List — Sunday top picks
  //   5. Stat — closing event-count slide
  // All zipped + downloaded in one click. Photo (if uploaded) used on Cover.
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

      // Bin-by-position fallback: if a slide has no explicit photo pinned,
      // use the bin photo at its intended carousel position (1-indexed slot:
      // cover=0, fri=1, sat=2, sun=3, stat=4 in the bin). Manual pins win.
      const binAt = (i) => photoBin[i] || null;
      const slides = [
        {
          mode: "cover",
          name: "01_cover",
          cfg: {
            photo: photo || binAt(0),
            headline: `This weekend in NJ has ${events.length} events. Here's what you need to know`,
            highlights: new Set([5, 6, 9]),
            accent, dots: 1, totalDots: 5,
            subtitle: "WEEKEND GUIDE",
            opacity,
          },
        },
        ...(friItems.length > 0 ? [{
          mode: "list",
          name: "02_friday",
          cfg: { items: friItems, accent, bgKey: "purple", dots: 2, totalDots: 5, listTitle: "FRIDAY", listSubtitle: "TOP PICKS", photo: listPhoto || binAt(1), opacity: listOpacity },
        }] : []),
        ...(satItems.length > 0 ? [{
          mode: "list",
          name: "03_saturday",
          cfg: { items: satItems, accent, bgKey: "wine", dots: 3, totalDots: 5, listTitle: "SATURDAY", listSubtitle: "TOP PICKS", photo: listPhoto || binAt(2), opacity: listOpacity },
        }] : []),
        ...(sunItems.length > 0 ? [{
          mode: "list",
          name: "04_sunday",
          cfg: { items: sunItems, accent, bgKey: "emerald", dots: 4, totalDots: 5, listTitle: "SUNDAY", listSubtitle: "TOP PICKS", photo: listPhoto || binAt(3), opacity: listOpacity },
        }] : []),
        {
          mode: "stat",
          name: "05_stat",
          cfg: {
            statNumber: String(events.length),
            statLabel: "EVENTS",
            statSub: `Across ${dayCount} day${dayCount === 1 ? "" : "s"}, ${regionCount} region${regionCount === 1 ? "" : "s"},\nand ${typeCount} categor${typeCount === 1 ? "y" : "ies"}`,
            accent, bgKey: "black", dots: 5, totalDots: 5,
            photo: statPhoto || binAt(4), opacity: statOpacity,
          },
        },
      ];

      // Re-tag dots based on the actual slide count (some days may be empty).
      slides.forEach((s, i) => {
        s.cfg.dots = i + 1;
        s.cfg.totalDots = slides.length;
      });

      const zip = new JSZip();
      for (const s of slides) {
        const cv = document.createElement("canvas");
        if (s.mode === "cover") renderCover(cv, s.cfg);
        else if (s.mode === "list") renderList(cv, s.cfg);
        else if (s.mode === "stat") renderStat(cv, s.cfg);
        const blob = await new Promise(res => cv.toBlob(res, "image/png"));
        zip.file(`CGE_carousel_${s.name}.png`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `CGE_weekend_carousel_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Auto-generate failed:", err);
      alert("Auto-generate failed — see console.");
    } finally {
      setIsAutoGen(false);
    }
  };

  return(
    <div style={{minHeight:"calc(100vh - 60px)",background:"#080808",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{maxWidth:1150,margin:"0 auto",padding:"1.25rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem"}}>
          <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:"1.2rem",fontWeight:800,textTransform:"uppercase"}}>CGE Media Template</h1>
          <span style={{fontSize:"0.6rem",color:accent,letterSpacing:"1.5px",textTransform:"uppercase",padding:"2px 8px",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px"}}>{mode} Slide · 1:1</span>
        </div>

        <div style={{display:"flex",gap:"0.3rem",marginBottom:"1rem"}}>
          {MODES.map(([k,lb])=><button key={k} onClick={()=>setMode(k)} style={{padding:"6px 16px",borderRadius:"5px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer",border:mode===k?"2px solid #FACC15":"2px solid rgba(245,240,232,0.06)",background:mode===k?"rgba(250,204,21,0.12)":"transparent",color:mode===k?"#FACC15":"rgba(245,240,232,0.25)",fontFamily:"'Syne',sans-serif",letterSpacing:"1px",textTransform:"uppercase"}}>{lb}</button>)}
        </div>

        {events.length > 0 && (
          <div style={{
            marginBottom: "1rem",
            padding: "10px 14px",
            background: "rgba(229,188,79,0.06)",
            border: "1px solid rgba(229,188,79,0.22)",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "0.6rem", color: "#E5BC4F", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: "2px" }}>
                Auto-generate weekend carousel
              </div>
              <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.55)" }}>
                {events.length} events → Cover + Fri / Sat / Sun lists + closing stat · zipped as 5 PNGs
              </div>
            </div>
            <button
              onClick={autoGenerateCarousel}
              disabled={isAutoGen}
              style={{
                padding: "8px 14px",
                background: isAutoGen ? "rgba(229,188,79,0.4)" : "#E5BC4F",
                color: "#000",
                border: "none",
                borderRadius: "4px",
                fontSize: "0.65rem",
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                cursor: isAutoGen ? "wait" : "pointer",
                fontFamily: "'Syne', sans-serif",
                whiteSpace: "nowrap",
              }}
            >
              {isAutoGen ? "Generating…" : "Generate ZIP"}
            </button>
          </div>
        )}

        {/* Photo Bin — drop multiple, click a thumbnail to bind to the active
            slide. Carousel auto-gen falls back to bin-by-position when a
            slide has no explicit pin. In-memory only (clears on refresh). */}
        <div
          onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
          onDrop={handleBinDrop}
          style={{
            marginBottom: "1rem",
            padding: "10px 14px",
            background: dragOver ? "rgba(250,204,21,0.10)" : "rgba(245,240,232,0.03)",
            border: `1px ${dragOver ? "solid #FACC15" : "dashed rgba(245,240,232,0.15)"}`,
            borderRadius: "6px",
            transition: "background 100ms, border-color 100ms",
          }}
        >
          <div style={{display:"flex",alignItems:"center",gap:"0.6rem",marginBottom: photoBin.length ? "8px" : 0}}>
            <div style={{flex:1}}>
              <div style={{fontSize:"0.6rem",color:accent,letterSpacing:"1.5px",textTransform:"uppercase",marginBottom:"2px",fontWeight:700}}>
                Photo Bin · {photoBin.length} {photoBin.length === 1 ? "photo" : "photos"}
              </div>
              <div style={{fontSize:"0.6rem",color:"rgba(245,240,232,0.45)"}}>
                {photoBin.length === 0
                  ? <>Drop multiple photos here, or click <strong>Add Photos</strong>. Carousel auto-gen uses them in order — position #1 = Cover, #2 = Fri, #3 = Sat, #4 = Sun, #5 = Stat.</>
                  : <>Click a thumbnail to use it on the <strong style={{color:accent}}>{mode}</strong> slide. Numbered badges show default carousel position.</>
                }
              </div>
            </div>
            <button onClick={()=>binFileRef.current?.click()} style={{...B,whiteSpace:"nowrap"}}>+ Add Photos</button>
            <input ref={binFileRef} type="file" accept="image/*" multiple onChange={handleBinFileInput} style={{display:"none"}}/>
          </div>
          {photoBin.length > 0 && (
            <div style={{display:"flex",gap:"6px",overflowX:"auto",paddingBottom:"2px"}}>
              {photoBin.map((img, i) => {
                const isActive = activePhoto === img;
                return (
                  <div key={i} style={{position:"relative",flexShrink:0}}>
                    <button
                      onClick={()=>setActivePhoto(isActive ? null : img)}
                      title={isActive ? `Currently on ${mode} · click to unpin` : `Pin to ${mode} slide`}
                      style={{
                        width:62, height:62, padding:0, cursor:"pointer",
                        background:`url(${img.src}) center/cover`,
                        border:`2px solid ${isActive ? "#FACC15" : "rgba(255,255,255,0.12)"}`,
                        borderRadius:"5px",
                        boxShadow: isActive ? "0 0 8px rgba(250,204,21,0.4)" : "none",
                      }}
                    />
                    <span style={{
                      position:"absolute",top:2,left:2,
                      background:"rgba(0,0,0,0.7)",color:accent,
                      fontSize:"0.5rem",fontWeight:700,
                      padding:"1px 4px",borderRadius:"2px",
                      letterSpacing:"0.5px",pointerEvents:"none",
                    }}>{i+1}</span>
                    <button
                      onClick={()=>removeFromBin(i)}
                      title="Remove from bin"
                      style={{
                        position:"absolute",top:-6,right:-6,
                        width:18,height:18,padding:0,
                        background:"#FB7185",color:"#000",
                        border:"none",borderRadius:"50%",
                        fontSize:"0.65rem",fontWeight:800,
                        cursor:"pointer",lineHeight:1,
                      }}
                    >×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 400px",gap:"1.5rem",alignItems:"start"}}>
          <div>
            {mode==="cover"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo</label>
                <div style={{display:"flex",gap:"0.3rem"}}><button onClick={()=>fileRef.current?.click()} style={{...B,flex:1}}>{photo?"Change Photo":"Upload Photo"}</button>{photo&&<button onClick={()=>setPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}<input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{display:"none"}}/></div></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Subtitle (optional)</label><input value={subtitle} onChange={e=>setSubtitle(e.target.value)} style={I} placeholder="e.g. WEEKEND GUIDE · APRIL 2026"/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Headline</label><textarea value={headline} onChange={e=>setHeadline(e.target.value)} style={{...I,height:55,resize:"vertical"}} placeholder="Type headline..."/></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Click words to highlight</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:"3px",padding:"6px",background:"#111",borderRadius:"6px",border:"1px solid rgba(245,240,232,0.04)"}}>
                  {words.map((w,i)=><button key={i} onClick={()=>toggleHL(i)} style={{padding:"3px 7px",borderRadius:"4px",cursor:"pointer",fontSize:"0.65rem",fontWeight:700,fontFamily:"'Syne'",textTransform:"uppercase",background:highlights.has(i)?`${accent}22`:"rgba(245,240,232,0.04)",color:highlights.has(i)?accent:"rgba(245,240,232,0.30)",border:highlights.has(i)?`2px solid ${accent}55`:"2px solid transparent"}}>{w}</button>)}
                </div></div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Darken: {Math.round(opacity*100)}%</label><input type="range" min="0.70" max="1.0" step="0.01" value={opacity} onChange={e=>setOpacity(parseFloat(e.target.value))} style={{width:"100%",accentColor:accent}}/></div>
            </>}

            {mode==="list"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>listFileRef.current?.click()} style={{...B,flex:1}}>{listPhoto?"Change Photo":"Upload Photo"}</button>
                  {listPhoto&&<button onClick={()=>setListPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={listFileRef} type="file" accept="image/*" onChange={handleListPhoto} style={{display:"none"}}/>
                </div>
                {listPhoto&&<div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"4px"}}>
                  <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>50%</span>
                  <input type="range" min="0.50" max="0.95" step="0.01" value={listOpacity} onChange={e=>setListOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                  <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>95%</span>
                </div>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Title</label><input value={listTitle} onChange={e=>setListTitle(e.target.value)} style={I}/></div>
                <div><label style={L}>Subtitle</label><input value={listSubtitle} onChange={e=>setListSubtitle(e.target.value)} style={I}/></div>
              </div>
              {!listPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
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
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>statFileRef.current?.click()} style={{...B,flex:1}}>{statPhoto?"Change Photo":"Upload Photo"}</button>
                  {statPhoto&&<button onClick={()=>setStatPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={statFileRef} type="file" accept="image/*" onChange={handleStatPhoto} style={{display:"none"}}/>
                </div>
                {statPhoto&&<div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"4px"}}>
                  <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>70%</span>
                  <input type="range" min="0.70" max="0.98" step="0.01" value={statOpacity} onChange={e=>setStatOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                  <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>98%</span>
                </div>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"120px 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
                <div><label style={L}>Number</label><input value={statNumber} onChange={e=>setStatNumber(e.target.value)} style={{...I,fontSize:"1.2rem",fontWeight:800,textAlign:"center",fontFamily:"'Syne'"}}/></div>
                <div><label style={L}>Label</label><input value={statLabel} onChange={e=>setStatLabel(e.target.value)} style={I}/></div>
              </div>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Subtitle (use \n for line breaks)</label><textarea value={statSub} onChange={e=>setStatSub(e.target.value)} style={{...I,height:50,resize:"vertical"}}/></div>
              {!statPhoto&&<div style={{marginBottom:"0.6rem"}}><label style={L}>Background Color</label><div style={{display:"flex",gap:"3px"}}>
                {Object.entries(BG_COLORS).map(([k,v])=><button key={k} onClick={()=>setBgKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:bgKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:bgKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>}
            </>}

            {mode==="text"&&<>
              <div style={{marginBottom:"0.6rem"}}><label style={L}>Background Photo (optional)</label>
                <div style={{display:"flex",gap:"0.3rem",alignItems:"center"}}>
                  <button onClick={()=>textFileRef.current?.click()} style={{...B,flex:1}}>{textPhoto?"Change Photo":"Upload Photo"}</button>
                  {textPhoto&&<button onClick={()=>setTextPhoto(null)} style={{...B,color:"rgba(251,113,133,0.5)"}}>×</button>}
                  <input ref={textFileRef} type="file" accept="image/*" onChange={handleTextPhoto} style={{display:"none"}}/>
                </div>
                {textPhoto&&<div style={{display:"flex",alignItems:"center",gap:"6px",marginTop:"4px"}}>
                  <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>70%</span>
                  <input type="range" min="0.70" max="1.0" step="0.01" value={textOpacity} onChange={e=>setTextOpacity(parseFloat(e.target.value))} style={{flex:1,accentColor:accent}}/>
                  <span style={{fontSize:"0.45rem",color:"rgba(245,240,232,0.3)"}}>100%</span>
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

            <div style={{marginBottom:"0.6rem"}}><label style={L}>Highlight Color</label><div style={{display:"flex",gap:"4px"}}>
              {Object.entries(COLORS).map(([k,v])=><button key={k} onClick={()=>setAccentKey(k)} style={{width:28,height:28,borderRadius:"5px",cursor:"pointer",background:v.hex,border:accentKey===k?"2px solid #FFF":"2px solid transparent",boxShadow:accentKey===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}</div></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
              <div><label style={L}>This slide #</label><input type="number" min="1" max="20" value={dots} onChange={e=>setDots(Math.max(1,parseInt(e.target.value)||1))} style={{...I,textAlign:"center",fontWeight:700}}/></div>
              <div><label style={L}>Total slides</label><input type="number" min="1" max="20" value={totalDots} onChange={e=>setTotalDots(Math.max(1,parseInt(e.target.value)||1))} style={{...I,textAlign:"center",fontWeight:700}}/></div>
            </div>
            <button onClick={dl} style={{width:"100%",padding:"12px",background:accent,color:"#000",border:"none",borderRadius:"6px",fontSize:"0.85rem",fontWeight:700,cursor:"pointer"}}>Download {mode.charAt(0).toUpperCase()+mode.slice(1)} Slide (PNG)</button>
            <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.18)",marginTop:"6px",lineHeight:1.5}}>1080×1080px · Syne 800 + DM Sans · CGE branded</p>
          </div>

          <div><label style={{...L,marginBottom:"6px"}}>Preview</label>
            <canvas ref={cvRef} style={{width:390,height:390,borderRadius:"4px",display:"block",background:"#000"}}/>
          </div>
        </div>
      </div>
    </div>
  );
}

const L={display:"block",fontSize:"0.5rem",letterSpacing:"1.5px",textTransform:"uppercase",color:"rgba(245,240,232,0.22)",marginBottom:"3px"};
const I={width:"100%",padding:"5px 7px",background:"#111",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif",fontSize:"0.7rem",outline:"none"};
const B={padding:"5px 8px",background:"rgba(245,240,232,0.04)",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"rgba(245,240,232,0.35)",fontSize:"0.65rem",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"};
