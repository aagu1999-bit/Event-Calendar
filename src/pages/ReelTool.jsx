import { useState, useRef, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { useEventsStore } from "../store";
import { EMOJI_MAP, getEmoji, parseRegion } from "../shared/parseEvents";
import { saveExport } from "../shared/photoLibrary.js";

// Aliases so the existing minified call sites (EM, gE, pR) still work.
const EM = EMOJI_MAP;
const gE = getEmoji;
const pR = parseRegion;

const COLORS = {
  purple:{name:"Purple",hex:"#7C3AED",accent:"#C084FC",sg:false},
  gold:{name:"Gold",hex:"#D4943A",accent:"#FBBF24",sg:false},
  wine:{name:"Wine",hex:"#BE3A34",accent:"#FB7185",sg:false},
  emerald:{name:"Emerald",hex:"#059669",accent:"#34D399",sg:false},
  yellow:{name:"Yellow",hex:"#EAB308",accent:"#FACC15",sg:false},
  black:{name:"Black",hex:"#000000",accent:"#E5BC4F",sg:true},
};
function pT(t){if(!t)return 9999;const raw=String(t).trim();
const m=raw.match(/(\d+)(?::(\d+))?(?::(\d+))?\s*(AM|PM|am|pm|A|P|a|p)?/i);
if(m&&m[4]){let h=parseInt(m[1]),min=parseInt(m[2]||"0");const p=m[4].toUpperCase();if(p.startsWith("P")&&h<12)h+=12;if(p.startsWith("A")&&h===12)h=0;return h*60+min;}
const numVal=parseFloat(raw);const hasDecimal=raw.includes(".");
if(!isNaN(numVal)&&hasDecimal&&numVal>=0&&numVal<2){const frac=numVal>=1?numVal-1:numVal;return Math.round(frac*1440);}
if(m&&!m[4]){let h=parseInt(m[1]),min=parseInt(m[2]||"0");if(h>=1&&h<=8)h+=12;return h*60+min;}
return 9999;}
function fT(t){if(!t)return"";const raw=String(t).trim();const numVal=parseFloat(raw);const hasDecimal=raw.includes(".");
if(!isNaN(numVal)&&hasDecimal&&numVal>=0&&numVal<2){const frac=numVal>=1?numVal-1:numVal;const tm=Math.round(frac*1440);let h=Math.floor(tm/60);const min=tm%60,ap=h>=12?"PM":"AM";if(h>12)h-=12;if(h===0)h=12;return(min===15||min===30||min===45)?`${h}:${String(min).padStart(2,"0")} ${ap}`:`${h} ${ap}`;}
const m=raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM|am|pm|A|P|a|p)?$/i);
if(m){let h=parseInt(m[1]);const min=parseInt(m[2]||"0");let p=(m[4]||"").toUpperCase();if(p.startsWith("P")&&h<12)h+=12;if(p.startsWith("A")&&h===12)h=0;if(!p&&h>=1&&h<=8)h+=12;const ap=h>=12?"PM":"AM";if(h>12)h-=12;if(h===0)h=12;return(min===15||min===30||min===45)?`${h}:${String(min).padStart(2,"0")} ${ap}`:`${h} ${ap}`;}
return raw;}
function pdToDay(ds){if(!ds||!String(ds).trim())return null;const raw=String(ds).trim();let d=null;
const num=parseFloat(raw);if(!isNaN(num)&&num>40000&&num<60000)d=new Date((num-25569)*86400000);
if(!d){const mdy=raw.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);if(mdy){const yr=mdy[3]?(mdy[3].length===2?2000+parseInt(mdy[3]):parseInt(mdy[3])):new Date().getFullYear();d=new Date(yr,parseInt(mdy[1])-1,parseInt(mdy[2]));}}
if(!d){const iso=raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(iso)d=new Date(parseInt(iso[1]),parseInt(iso[2])-1,parseInt(iso[3]));}
if(d&&!isNaN(d.getTime())){const dow=d.getDay();const names=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];return{day:names[dow],date:`${d.getMonth()+1}/${d.getDate()}`};}return null;}
const DO={"Fri":0,"Sat":1,"Sun":2},RO={"North":0,"Central":1,"South":2};
function sE(evts){return[...evts].sort((a,b)=>{const da=DO[a.day]??9,db=DO[b.day]??9;if(da!==db)return da-db;const ra=RO[a.region]??9,rb=RO[b.region]??9;if(ra!==rb)return ra-rb;return pT(a.time)-pT(b.time);});}
function pD(d){if(!d||!String(d).trim())return"Fri";const l=String(d).toLowerCase().trim().replace(/[.]/g,"");if(l.startsWith("fri")||l==="f")return"Fri";if(l.startsWith("sat")||l==="sa"||l==="s")return"Sat";if(l.startsWith("sun")||l==="su")return"Sun";return null;}
const CP={date:/^(date|event\s*date|calendar\s*date|start\s*date)$/i,day:/^(day|weekday|dow|day\s*of\s*week|event\s*day)$/i,time:/^(time|start|start\s*time|event\s*time|begins?|hour)$/i,name:/^(name|event|event\s*name|title|event\s*title|show|party)$/i,venue:/^(venue|venue\s*name|location|place|spot|club|lounge|restaurant|bar|space)$/i,area:/^(area|city|town|neighborhood|hood|municipality|address|where|locale)$/i,region:/^(region|zone|section|nj\s*region|part|area\s*region|region\s*nj|nj\s*area)$/i,type:/^(type|category|genre|event\s*type|event\s*category|kind)$/i,_ig:/^(ticket|link|url|price|cost|notes|description|promoter|capacity|id|#|number|status|flyer|image|phone|email|contact|website|rsvp|age|dress\s*code|featured|pick|emoji)$/i};
function mC(hds){const m={};hds.forEach((h,i)=>{const c=String(h).trim();if(CP._ig.test(c))return;for(const[f,p]of Object.entries(CP)){if(f==="_ig")continue;if(p.test(c)&&!(f in m)){m[f]=i;break;}}});
const fuzzy={date:/\bdate\b/i,day:/\bday\b|\bweekday\b/i,time:/\btime\b|\bhour\b/i,name:/\bevent\s*name\b|\btitle\b/i,venue:/\bvenue\b|\blocation\b|\bplace\b/i,area:/\bcity\b|\btown\b/i,region:/\bregion\b|\bzone\b/i,type:/\btype\b|\bcategory\b/i};
hds.forEach((h,i)=>{const c=String(h).trim();if(Object.values(m).includes(i))return;if(CP._ig.test(c))return;for(const[f,rx]of Object.entries(fuzzy)){if(!(f in m)&&rx.test(c)){m[f]=i;break;}}});return m;}
function pF(rows,dr){if(!rows||!rows.length)return[];const fr=rows[0].map(c=>String(c??"").trim());const cm=mC(fr);const hh=Object.keys(cm).length>=2;const drs=hh?rows.slice(1):rows;const fm=hh?cm:{day:0,time:1,name:2,venue:3,area:4,region:5};if(hh&&!("name" in fm))for(let i=0;i<fr.length;i++){if(!Object.values(fm).includes(i)){fm.name=i;break;}}
const hasDateCol="date" in fm,hasDayCol="day" in fm;
return drs.filter(r=>r&&r.some(c=>c!=null&&String(c).trim()!=="")).map(r=>{const g=f=>(f in fm&&fm[f]<r.length)?String(r[fm[f]]??"").replace(/^["']+|["']+$/g,"").trim():"";
let day=null;if(hasDayCol)day=pD(g("day"));if(!day&&hasDateCol){const di=pdToDay(g("date"));if(di)day=di.day;}if(!day)day="Fri";
const type=g("type");return{id:Date.now()+Math.random()*1e5,day,time:fT(g("time")),name:g("name"),venue:g("venue"),area:g("area"),region:pR(g("region"))||dr||"North",type,emoji:gE(type),featured:false};}).filter(e=>e.name&&e.day!==null);}
const DF={Fri:"FRIDAY",Sat:"SATURDAY",Sun:"SUNDAY"};
const MAX_VIS = 13; // max events visible at once

function renderFrame(canvas, events, cfg, time) {
  const { colorKey, dayLabel, dateLabel, style, duration, batches, batchCount } = cfg;
  const co = COLORS[colorKey];
  const W = 1080, H = 1920;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = co.hex; ctx.fillRect(0,0,W,H);

  // CGE texture
  ctx.save(); ctx.translate(W/2,H/2); ctx.rotate(-5*Math.PI/180); ctx.translate(-W/2,-H/2);
  ctx.font="800 28px 'Syne',sans-serif"; ctx.fillStyle=co.sg?co.accent:"#000"; ctx.globalAlpha=co.sg?0.12:0.16;
  ctx.textBaseline="middle"; ctx.textAlign="center";
  const lts=["C","G","E"]; let li=0;
  for(let y=-80;y<H+80;y+=40){const off=(Math.round((y+80)/40)%2===1)?22:0;for(let x=-80+off;x<W+80;x+=44){ctx.fillText(lts[li%3],x,y);li++;}}
  ctx.restore();

  // Spotlight — matching Calendar Builder system
  const sCol=co.sg?"229,188,79":"255,255,255", sA=co.sg?0.45:0.50;
  let g;
  // Source point (top-left) — bright
  g=ctx.createRadialGradient(0,0,0,0,0,550);g.addColorStop(0,`rgba(${sCol},${sA})`);g.addColorStop(0.3,`rgba(${sCol},${sA*0.45})`);g.addColorStop(0.65,`rgba(${sCol},${sA*0.12})`);g.addColorStop(1,"transparent");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // Cone body (triangle from top-left to center-right)
  ctx.save();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(W*0.65,H*0.55);ctx.lineTo(W*0.35,H*0.70);ctx.closePath();
  g=ctx.createLinearGradient(0,0,W*0.5,H*0.6);g.addColorStop(0,`rgba(${sCol},${sA*0.35})`);g.addColorStop(0.4,`rgba(${sCol},${sA*0.15})`);g.addColorStop(0.7,`rgba(${sCol},${sA*0.06})`);g.addColorStop(1,"transparent");ctx.fillStyle=g;ctx.fill();ctx.restore();

  // Diagonal streak (top-left to bottom-right)
  g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,`rgba(${sCol},${sA*0.35})`);g.addColorStop(0.25,`rgba(${sCol},${sA*0.10})`);g.addColorStop(0.5,"transparent");g.addColorStop(0.75,`rgba(${sCol},${sA*0.08})`);g.addColorStop(1,`rgba(${sCol},${sA*0.25})`);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // Landing pool (bottom-right oval)
  g=ctx.createRadialGradient(W*0.78,H*0.88,0,W*0.78,H*0.88,500);g.addColorStop(0,`rgba(${sCol},${sA*0.55})`);g.addColorStop(0.25,`rgba(${sCol},${sA*0.25})`);g.addColorStop(0.5,`rgba(${sCol},${sA*0.08})`);g.addColorStop(1,"transparent");
  ctx.save();ctx.scale(1,0.6);ctx.fillStyle=g;ctx.fillRect(0,0,W,H/0.6);ctx.restore();
  // Inner pool bright
  g=ctx.createRadialGradient(W*0.80,H*0.90,0,W*0.80,H*0.90,200);g.addColorStop(0,`rgba(${sCol},${sA*0.40})`);g.addColorStop(0.5,`rgba(${sCol},${sA*0.12})`);g.addColorStop(1,"transparent");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // Top-right corner glow
  g=ctx.createRadialGradient(W,0,0,W,0,550);g.addColorStop(0,`rgba(${sCol},${sA*0.35})`);g.addColorStop(0.3,`rgba(${sCol},${sA*0.15})`);g.addColorStop(0.6,`rgba(${sCol},${sA*0.04})`);g.addColorStop(1,"transparent");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

  // Timing
  const introT = 0.6;
  const outroT = 0.3;
  const contentT = duration - introT - outroT;
  const transT = 0.35; // transition between batches

  // Header
  const hAlpha = Math.min(1, time / introT);
  ctx.globalAlpha = hAlpha; ctx.textBaseline = "top";
  ctx.font = "700 42px 'DM Sans',sans-serif"; ctx.fillStyle = "#FFFFFF";
  ctx.letterSpacing = "6px"; ctx.fillText("NJ WEEKEND EVENTS", 60, 60); ctx.letterSpacing = "0px";

  // Auto-fit day label
  let dayFS = 140;
  ctx.font = `800 ${dayFS}px 'Syne',sans-serif`;
  while (ctx.measureText(dayLabel).width > W - 120 && dayFS > 60) { dayFS -= 4; ctx.font = `800 ${dayFS}px 'Syne',sans-serif`; }
  ctx.fillText(dayLabel, 60, 115);

  ctx.font = "800 130px 'Syne',sans-serif"; ctx.fillText(dateLabel, 60, 115 + dayFS + 5);

  const lineY = 115 + dayFS + 145;
  g = ctx.createLinearGradient(60,0,W-60,0); g.addColorStop(0,"rgba(255,255,255,0.50)"); g.addColorStop(0.5,"rgba(255,255,255,0.12)"); g.addColorStop(1,"transparent");
  ctx.fillStyle = g; ctx.fillRect(60, lineY, W-120, 3);
  ctx.globalAlpha = 1;

  // Events area
  const evTop = lineY + 15;
  const footerH = 120;
  const evAreaH = H - evTop - footerH;
  const rowH = 96;
  const regDivH = 75;
  const isLight = colorKey === "gold" || colorKey === "yellow";

  if (style === "scroll") {
    // === SCROLL MODE: continuous scroll ===
    const evAlpha = time < introT ? 0 : Math.min(1, (time - introT) / 0.4);
    // Calculate total height
    const rgs = []; let cr = null;
    events.forEach(ev => { if(ev.region !== cr){rgs.push({region:ev.region,events:[ev]});cr=ev.region;}else rgs[rgs.length-1].events.push(ev); });
    let totalH = 0; rgs.forEach(rg => { if(rgs.length>1) totalH += regDivH; totalH += rg.events.length * rowH; });
    const maxScroll = Math.max(0, totalH - evAreaH + 30);
    const scrollStart = introT + 0.5;
    const scrollEnd = duration - outroT - 0.3;
    const scrollDur = scrollEnd - scrollStart;
    let scrollOff = 0;
    if (time > scrollStart && maxScroll > 0) {
      const p = Math.min((time - scrollStart) / scrollDur, 1);
      const es = p < 0.5 ? 2*p*p : 1 - Math.pow(-2*p+2,2)/2;
      scrollOff = es * maxScroll;
    }

    ctx.save(); ctx.beginPath(); ctx.rect(0, evTop, W, evAreaH); ctx.clip();
    let dy = evTop - scrollOff;
    rgs.forEach(rg => {
      ctx.globalAlpha = evAlpha;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.roundRect(60, dy, W-120, regDivH-8, 10); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(60, dy, 4, regDivH-8);
      ctx.font = "800 48px 'Syne',sans-serif"; ctx.fillStyle = "#FFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((rg.region || "—").toUpperCase(), W/2, dy+regDivH/2-4);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      dy += regDivH;
      rg.events.forEach(ev => {
        if (dy+rowH > evTop-20 && dy < evTop+evAreaH+20) {
          ctx.globalAlpha = evAlpha;
          // CGE Pick glow
          if (ev.featured) {
            ctx.shadowColor = "#FACC15"; ctx.shadowBlur = 18;
            ctx.strokeStyle = "#FACC15"; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.roundRect(60,dy+3,W-120,rowH-8,14); ctx.stroke();
            ctx.shadowBlur = 0;
          }
          ctx.fillStyle = isLight ? "rgba(0,0,0,0.70)" : "rgba(0,0,0,0.28)";
          ctx.beginPath(); ctx.roundRect(60,dy+3,W-120,rowH-8,14); ctx.fill();
          if (ev.emoji) { ctx.globalAlpha = 1; ctx.font = "52px sans-serif"; ctx.textBaseline = "middle"; ctx.fillText(ev.emoji,80,dy+rowH/2); }
          ctx.globalAlpha = evAlpha; ctx.font = "700 36px 'DM Sans',sans-serif"; ctx.fillStyle = ev.featured ? "#FACC15" : "#FFF"; ctx.textBaseline = "top";
          let nm = ev.name.toUpperCase(); const mw = W-300; if(ctx.measureText(nm).width>mw){while(ctx.measureText(nm+"..").width>mw&&nm.length>0)nm=nm.slice(0,-1);nm+="..";}
          ctx.fillText(nm, ev.emoji ? 148 : 80, dy+12);
          ctx.font = "400 28px 'DM Sans',sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.60)";
          let vs = ev.venue||""; if(ev.area)vs+=` · ${ev.area}`; ctx.fillText(vs, ev.emoji ? 148 : 80, dy+52);
          ctx.font = "700 36px 'DM Sans',sans-serif"; ctx.fillStyle = "#FFF"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(ev.time,W-80,dy+rowH/2); ctx.textAlign = "left"; ctx.textBaseline = "top";
        }
        dy += rowH;
      });
    });
    ctx.restore();
  } else {
    // === BATCH MODE: Stack / Spotlight / Fade ===
    const batchTime = batchCount > 1 ? (contentT - (batchCount-1)*transT) / batchCount : contentT;

    // Determine current batch and transition state
    let currentBatch = 0;
    let batchAlpha = 1;
    let batchSlide = 0;
    let spotFlash = 0;

    if (time < introT) {
      batchAlpha = 0;
    } else {
      const ct = time - introT;
      const cycleT = batchTime + transT;
      if (batchCount <= 1) {
        currentBatch = 0;
        batchAlpha = Math.min(1, ct / 0.4);
        if (style === "stack") batchSlide = Math.max(0, (1 - ct/0.4) * 60);
        if (style === "paparazzi") spotFlash = ct < 0.6 ? Math.max(0, 1 - ct/0.6) : 0;
      } else {
        const rawBatch = ct / cycleT;
        currentBatch = Math.min(Math.floor(rawBatch), batchCount - 1);
        const posInCycle = ct - currentBatch * cycleT;

        if (posInCycle < 0.2) {
          // Entering new batch — flash burst
          const p = posInCycle / 0.2;
          if (style === "fade") batchAlpha = p;
          else if (style === "stack") { batchAlpha = p; batchSlide = (1-p) * 60; }
          else if (style === "paparazzi") { batchAlpha = p; spotFlash = Math.pow(1-p, 0.5); }
        } else if (posInCycle > batchTime - 0.05 && currentBatch < batchCount - 1) {
          // Exiting batch — smaller flash on exit
          const exitP = (posInCycle - (batchTime - 0.05)) / (transT + 0.05);
          if (style === "fade") batchAlpha = Math.max(0, 1 - exitP);
          else if (style === "stack") { batchAlpha = Math.max(0, 1 - exitP); batchSlide = -exitP * 40; }
          else if (style === "paparazzi") { batchAlpha = Math.max(0, 1 - exitP); spotFlash = exitP * 0.6; }
        } else {
          batchAlpha = 1;
          batchSlide = 0;
        }
      }
    }

    // Paparazzi camera flashes — random bursts across the screen
    if (style === "paparazzi" && time > introT * 0.5) {
      // Generate deterministic flash positions using time
      const flashInterval = 0.25; // new flash every 0.25s
      const flashDuration = 0.18; // each flash lasts 0.18s
      const numFlashSources = 12; // total flash positions to cycle through

      // Deterministic positions (seeded by index)
      const flashPositions = [];
      for (let i = 0; i < numFlashSources; i++) {
        const seed = i * 7919 + 1;
        flashPositions.push({
          x: (((seed * 13) % 900) + 90),
          y: (((seed * 17) % 1600) + 160),
          size: 200 + (((seed * 23) % 400)),
          delay: (((seed * 31) % 100) / 100) * 0.12,
        });
      }

      const ct = time - introT * 0.5;
      // Continuous flashes throughout
      for (let i = 0; i < numFlashSources; i++) {
        const cycleTime = flashInterval * numFlashSources;
        const flashStart = (i * flashInterval + flashPositions[i].delay) % cycleTime;
        const elapsed = ct % cycleTime;
        const dt = elapsed - flashStart;
        // Flash is active if within its duration window
        const active = (dt >= 0 && dt < flashDuration) || (dt + cycleTime >= 0 && dt + cycleTime < flashDuration);
        if (active) {
          const localT = dt >= 0 ? dt : dt + cycleTime;
          const intensity = localT < 0.04 ? localT / 0.04 : Math.max(0, 1 - (localT - 0.04) / (flashDuration - 0.04));
          const fp = flashPositions[i];
          // Bright white burst
          g = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, fp.size);
          g.addColorStop(0, `rgba(255,255,255,${intensity * 0.85})`);
          g.addColorStop(0.08, `rgba(255,255,255,${intensity * 0.55})`);
          g.addColorStop(0.2, `rgba(${sCol},${intensity * 0.25})`);
          g.addColorStop(0.45, `rgba(${sCol},${intensity * 0.08})`);
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
          // Hot white center
          if (intensity > 0.5) {
            g = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, 40);
            g.addColorStop(0, `rgba(255,255,255,${intensity * 0.95})`);
            g.addColorStop(1, "transparent");
            ctx.fillStyle = g; ctx.fillRect(fp.x-40, fp.y-40, 80, 80);
          }
        }
      }

      // Extra bright burst on batch transitions
      if (spotFlash > 0) {
        // Screen-wide bright flash
        ctx.fillStyle = `rgba(255,255,255,${spotFlash * 0.45})`;
        ctx.fillRect(0, 0, W, H);
        // Multiple random flash points
        for (let i = 0; i < 5; i++) {
          const fp = flashPositions[i];
          g = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, fp.size * 1.5);
          g.addColorStop(0, `rgba(255,255,255,${spotFlash * 0.9})`);
          g.addColorStop(0.1, `rgba(255,255,255,${spotFlash * 0.5})`);
          g.addColorStop(0.3, `rgba(${sCol},${spotFlash * 0.2})`);
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
      }
    } else if (spotFlash > 0 && style !== "paparazzi") {
      // Non-spotlight styles: simple fade flash
      g = ctx.createRadialGradient(W/2, evTop + evAreaH/2, 0, W/2, evTop + evAreaH/2, 600);
      g.addColorStop(0, `rgba(${sCol},${spotFlash * 0.3})`); g.addColorStop(0.5, `rgba(${sCol},${spotFlash * 0.10})`); g.addColorStop(1, "transparent");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    // Draw current batch
    const batchEvents = batches[currentBatch] || [];
    // Build region groups for this batch
    const rgs = []; let cr = null;
    batchEvents.forEach(ev => { if(ev.region !== cr){rgs.push({region:ev.region,events:[ev]});cr=ev.region;}else rgs[rgs.length-1].events.push(ev); });

    ctx.save(); ctx.beginPath(); ctx.rect(0, evTop, W, evAreaH); ctx.clip();
    let dy = evTop + batchSlide;

    rgs.forEach(rg => {
      ctx.globalAlpha = batchAlpha;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.roundRect(60, dy, W-120, regDivH-8, 10); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(60, dy, 4, regDivH-8);
      ctx.font = "800 48px 'Syne',sans-serif"; ctx.fillStyle = "#FFF"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText((rg.region || "—").toUpperCase(), W/2, dy+regDivH/2-4);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      dy += regDivH;
      rg.events.forEach(ev => {
        ctx.globalAlpha = batchAlpha;
        // CGE Pick glow
        if (ev.featured) {
          ctx.shadowColor = "#FACC15"; ctx.shadowBlur = 18;
          ctx.strokeStyle = "#FACC15"; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.roundRect(60,dy+3,W-120,rowH-8,14); ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = isLight ? "rgba(0,0,0,0.70)" : "rgba(0,0,0,0.28)";
        ctx.beginPath(); ctx.roundRect(60,dy+3,W-120,rowH-8,14); ctx.fill();
        if (ev.emoji) { ctx.globalAlpha = 1; ctx.font = "52px sans-serif"; ctx.textBaseline = "middle"; ctx.fillText(ev.emoji,80,dy+rowH/2); }
        ctx.globalAlpha = batchAlpha;
        ctx.font = "700 36px 'DM Sans',sans-serif"; ctx.fillStyle = ev.featured ? "#FACC15" : "#FFF"; ctx.textBaseline = "top";
        let nm = ev.name.toUpperCase(); const mw = W-300; if(ctx.measureText(nm).width>mw){while(ctx.measureText(nm+"..").width>mw&&nm.length>0)nm=nm.slice(0,-1);nm+="..";}
        ctx.fillText(nm, ev.emoji ? 148 : 80, dy+12);
        ctx.font = "400 28px 'DM Sans',sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.60)";
        let vs = ev.venue||""; if(ev.area)vs+=` · ${ev.area}`; ctx.fillText(vs, ev.emoji ? 148 : 80, dy+52);
        ctx.font = "700 36px 'DM Sans',sans-serif"; ctx.fillStyle = "#FFF"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(ev.time,W-80,dy+rowH/2); ctx.textAlign = "left"; ctx.textBaseline = "top";
        dy += rowH;
      });
    });
    ctx.restore();

    // Batch indicator dots
    if (batchCount > 1) {
      ctx.globalAlpha = 0.6;
      const dotY = H - footerH - 30;
      const dotW = batchCount * 18;
      for (let i = 0; i < batchCount; i++) {
        ctx.fillStyle = i === currentBatch ? "#FFFFFF" : "rgba(255,255,255,0.25)";
        ctx.beginPath(); ctx.arc(W/2 - dotW/2 + i*18 + 5, dotY, i===currentBatch?5:3, 0, Math.PI*2); ctx.fill();
      }
    }
  }

  ctx.globalAlpha = 1;
  // Footer
  const fy = H - footerH;
  ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(0,fy,W,footerH);
  ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(60,fy,W-120,2);
  ctx.font = "800 32px 'Syne',sans-serif"; ctx.fillStyle = "#FFF"; ctx.textBaseline = "top";
  ctx.fillText("CENTRAL GROUP EVENTS",60,fy+25);
  ctx.font = "600 24px 'DM Sans',sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText("centralgroupevents.com",60,fy+68);
}

export default function ReelTool(){
  const events = useEventsStore(s => s.events);
  const setEvents = useEventsStore(s => s.updateEvents);
  const addEvents = useEventsStore(s => s.addEvents);
  const[color,setColor]=useState("purple");
  const[style,setStyle]=useState("paparazzi");
  const[duration,setDuration]=useState(8);
  const[playing,setPlaying]=useState(false);
  const[recording,setRecording]=useState(false);
  const[day,setDay]=useState("Fri");
  const[friDate,setFriDate]=useState("4/18");
  const[editId,setEditId]=useState(null);
  const[dismissed,setDismissed]=useState(new Set());
  const[listFilter,setListFilter]=useState("all");
  const cvRef=useRef(null),fileRef=useRef(null),animRef=useRef(null),startRef=useRef(null),recRef=useRef(null);
  const eventRefs=useRef({});
  const ALL_EMOJIS=["🎧","💃","🥂","🎭","🎨","🎤","🛍️","🍷","💪","🎬","😂","🎪","🎲","🤝",""];

  const co=COLORS[color];
  const sorted=sE(events);
  const dayEv=sorted.filter(e=>e.day===day);
  const dates=(()=>{const p=friDate.split("/");if(p.length!==2)return{Fri:friDate,Sat:"",Sun:""};const m=parseInt(p[0]),d=parseInt(p[1]);if(isNaN(m)||isNaN(d))return{Fri:friDate,Sat:"",Sun:""};const mx=[0,31,29,31,30,31,30,31,31,30,31,30,31][m]||31;return{Fri:friDate,Sat:d+1>mx?`${m+1}/1`:`${m}/${d+1}`,Sun:d+2>mx?`${m+1}/${d+2-mx}`:`${m}/${d+2}`};})();
  const regions=[...new Set(dayEv.map(e=>e.region))];

  // Validation
  const normalize=(s)=>(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
  const warnings={};
  let flagGroup=1;
  events.forEach(ev=>{const w=[];if(!ev.name||!ev.name.trim())w.push({type:"red",msg:"NO NAME"});if(!ev.day)w.push({type:"red",msg:"NO DAY"});if(!ev.time||!ev.time.trim())w.push({type:"yellow",msg:"NO TIME"});if(!ev.venue||!ev.venue.trim())w.push({type:"yellow",msg:"NO VENUE"});if(!ev.region)w.push({type:"yellow",msg:"NO REGION"});if(w.length>0)warnings[ev.id]=w;});
  const seenND={};
  events.forEach(ev=>{const key=normalize(ev.name)+"|"+(ev.day||"");if(!key||key==="|"||!normalize(ev.name))return;if(seenND[key]){if(!seenND[key].group)seenND[key].group=flagGroup++;const g=seenND[key].group;seenND[key].ids.push(ev.id);seenND[key].ids.forEach(id=>{if(!warnings[id])warnings[id]=[];if(!warnings[id].some(w=>w.msg.startsWith("DUPE")))warnings[id].push({type:"yellow",msg:`DUPE #${g}`});});}else{seenND[key]={ids:[ev.id],group:null};}});
  const seenVD={};
  events.forEach(ev=>{if(!ev.venue||!ev.venue.trim())return;const key=normalize(ev.venue)+"|"+(ev.day||"");if(seenVD[key]){if(!seenVD[key].group)seenVD[key].group=flagGroup++;const g=seenVD[key].group;seenVD[key].ids.push(ev.id);seenVD[key].ids.forEach(id=>{if(!warnings[id])warnings[id]=[];if(!warnings[id].some(w=>w.msg.startsWith("VENUE")))warnings[id].push({type:"gray",msg:`VENUE #${g}`});});}else{seenVD[key]={ids:[ev.id],group:null};}});
  const dayNames={"friday":"Fri","fridays":"Fri","saturday":"Sat","saturdays":"Sat","sunday":"Sun","sundays":"Sun"};
  events.forEach(ev=>{if(!ev.name)return;const nl=ev.name.toLowerCase();for(const[dw,da]of Object.entries(dayNames)){if(nl.includes(dw)&&ev.day!==da){if(!warnings[ev.id])warnings[ev.id]=[];warnings[ev.id].push({type:"gray",msg:"WRONG DAY?"});break;}}});
  const activeWarnings=Object.entries(warnings).filter(([id])=>!dismissed.has(Number(id)||id));
  const totalWarnings=activeWarnings.length;
  const findFlagPartners=(evId,flagMsg)=>{const match=flagMsg.match(/#(\d+)/);if(!match)return[];const gn=match[1];return Object.entries(warnings).filter(([id,ws])=>String(id)!==String(evId)&&ws.some(w=>w.msg.includes(`#${gn}`))).map(([id])=>Number(id)||id);};
  const scrollToEvent=(tid)=>{const el=eventRefs.current[tid];if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.style.transition="background 0.3s";el.style.background="rgba(250,204,21,0.20)";setTimeout(()=>{el.style.background="";},1500);}};

  // Build batches
  const batches = [];
  for (let i = 0; i < dayEv.length; i += MAX_VIS) {
    batches.push(dayEv.slice(i, i + MAX_VIS));
  }
  const batchCount = Math.max(1, batches.length);

  const handleFile=(e)=>{const f=e.target.files[0];if(!f)return;const ext=f.name.split(".").pop().toLowerCase();if(ext==="xlsx"||ext==="xls"){const r=new FileReader();r.onload=ev=>{try{const wb=XLSX.read(ev.target.result,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];const r2=addEvents(pF(XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:false}),"North"));setDismissed(new Set());if(r2.skipped>0)alert(`Added ${r2.added} new events (${r2.skipped} duplicate${r2.skipped===1?"":"s"} skipped).`);else if(r2.added>0)alert(`Added ${r2.added} new event${r2.added===1?"":"s"}.`);}catch(err){alert("Error: "+err.message);}};r.readAsArrayBuffer(f);}else{const r=new FileReader();r.onload=ev=>{const ls=ev.target.result.split("\n").filter(l=>l.trim());const rs=ls.map(l=>l.includes("\t")?l.split("\t").map(s=>s.trim()):l.split(",").map(s=>s.trim()));const r2=addEvents(pF(rs,"North"));setDismissed(new Set());if(r2.skipped>0)alert(`Added ${r2.added} new events (${r2.skipped} duplicate${r2.skipped===1?"":"s"} skipped).`);else if(r2.added>0)alert(`Added ${r2.added} new event${r2.added===1?"":"s"}.`);};r.readAsText(f);}e.target.value="";};

  const animate=useCallback(ts=>{
    if(!startRef.current)startRef.current=ts;
    const el=(ts-startRef.current)/1000;
    const cv=cvRef.current;if(!cv)return;
    renderFrame(cv,dayEv,{colorKey:color,dayLabel:DF[day],dateLabel:dates[day],style,duration,batches,batchCount},el);
    if(el<duration){animRef.current=requestAnimationFrame(animate);}
    else{setPlaying(false);if(recRef.current&&recRef.current.state==="recording")recRef.current.stop();}
  },[dayEv,color,day,dates,style,duration,batches,batchCount]);

  const play=()=>{startRef.current=null;setPlaying(true);};
  const stop=()=>{if(animRef.current)cancelAnimationFrame(animRef.current);setPlaying(false);startRef.current=null;if(recRef.current&&recRef.current.state==="recording")recRef.current.stop();};

  const dlVideo=()=>{
    const cv=cvRef.current;if(!cv)return;
    try{
      const stream=cv.captureStream(30);const chunks=[];
      const rec=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp9"});
      rec.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
      rec.onstop=()=>{const blob=new Blob(chunks,{type:"video/webm"});const url=URL.createObjectURL(blob);const a=document.createElement("a");const filename=`CGE_Reel_${day}_${friDate.replace("/","-")}.webm`;a.download=filename;a.href=url;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);setRecording(false);saveExport(blob,{sourceTool:"reel",sourceMode:day,name:filename,kind:"archive"}).catch(err=>console.warn("Export archive failed:",err));};
      recRef.current=rec;rec.start();setRecording(true);startRef.current=null;setPlaying(true);
    }catch(err){alert("Video recording not supported here. Use screen recording instead.");}
  };

  useEffect(()=>{if(playing){animRef.current=requestAnimationFrame(animate);}return()=>{if(animRef.current)cancelAnimationFrame(animRef.current);};},[playing,animate]);
  useEffect(()=>{if(!playing){const cv=cvRef.current;if(cv)renderFrame(cv,dayEv,{colorKey:color,dayLabel:DF[day],dateLabel:dates[day],style,duration,batches,batchCount},0.8);}},[dayEv,color,day,dates,style,playing,duration,batches,batchCount]);

  const isLight=color==="gold"||color==="yellow";

  return(
    <div style={{minHeight:"100vh",background:"#080808",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;900&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet"/>
      <div style={{maxWidth:1100,margin:"0 auto",padding:"1.25rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem"}}>
          <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:"1.2rem",fontWeight:800,textTransform:"uppercase"}}>CGE Reel Tool</h1>
          <span style={{fontSize:"0.6rem",color:co.accent,letterSpacing:"1.5px",textTransform:"uppercase",padding:"2px 8px",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"14px"}}>{dayEv.length} events · {batchCount} batch{batchCount>1?"es":""} · {duration}s</span>
          {recording&&<span style={{fontSize:"0.6rem",color:"#FB7185",fontWeight:700}}>● REC</span>}
        </div>
        <div className="cge-builder-layout" style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:"1.5rem",alignItems:"start"}}>
          <div>
            <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"0.4rem",marginBottom:"0.6rem"}}>
              <div><label style={L}>Friday Date</label><input value={friDate} onChange={e=>setFriDate(e.target.value)} style={I} placeholder="4/18"/></div>
              <div><label style={L}>Upload Events</label><button onClick={()=>fileRef.current?.click()} style={{...B,width:"100%"}}>Upload .xlsx / .csv</button><input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={handleFile} style={{display:"none"}}/></div>
            </div>
            <div style={{marginBottom:"0.6rem"}}><label style={L}>Day</label><div style={{display:"flex",gap:"0.25rem"}}>
              {["Fri","Sat","Sun"].map(d=><button key={d} onClick={()=>{setDay(d);stop();}} style={{padding:"5px 16px",borderRadius:"5px",fontSize:"0.7rem",cursor:"pointer",fontWeight:600,flex:1,border:day===d?`2px solid ${co.accent}`:"2px solid rgba(245,240,232,0.06)",background:day===d?"rgba(255,255,255,0.06)":"transparent",color:day===d?co.accent:"rgba(245,240,232,0.25)"}}>{DF[d]} {dates[d]}</button>)}
            </div></div>
            <div style={{marginBottom:"0.6rem"}}><label style={L}>Color</label><div style={{display:"flex",gap:"3px"}}>
              {Object.entries(COLORS).map(([k,v])=><button key={k} onClick={()=>{setColor(k);stop();}} style={{width:32,height:32,borderRadius:"5px",cursor:"pointer",background:v.hex,border:color===k?"2px solid #FFF":"2px solid transparent",boxShadow:color===k?"0 0 6px rgba(255,255,255,0.3)":"none"}} title={v.name}/>)}
            </div></div>
            <div style={{marginBottom:"0.6rem"}}><label style={L}>Animation</label><div style={{display:"flex",gap:"0.25rem",flexWrap:"wrap"}}>
              {[["stack","Stack"],["paparazzi","Paparazzi"],["fade","Fade"],["scroll","Scroll"]].map(([k,lb])=><button key={k} onClick={()=>{setStyle(k);stop();}} style={{padding:"5px 12px",borderRadius:"5px",fontSize:"0.63rem",cursor:"pointer",fontWeight:600,border:style===k?"2px solid #FACC15":"2px solid rgba(245,240,232,0.06)",background:style===k?"rgba(250,204,21,0.12)":"transparent",color:style===k?"#FACC15":"rgba(245,240,232,0.25)"}}>{lb}</button>)}
            </div></div>
            <div style={{marginBottom:"0.6rem"}}><label style={L}>Duration (seconds)</label><input type="number" min="5" max="30" step="1" value={duration} onChange={e=>{const v=Math.max(5,Math.min(30,parseInt(e.target.value)||5));setDuration(v);stop();}} style={{...I,width:"80px",fontSize:"0.85rem",fontWeight:700,textAlign:"center"}} /></div>
            <div style={{display:"flex",gap:"0.4rem",marginBottom:"0.5rem"}}>
              <button onClick={play} style={{flex:1,padding:"10px",background:co.hex,color:isLight?"#000":"#FFF",border:"none",borderRadius:"6px",fontSize:"0.85rem",fontWeight:700,cursor:"pointer"}}>{playing?"⟳ Replay":"▶ Play"}</button>
              {playing&&<button onClick={stop} style={{padding:"10px 16px",background:"rgba(245,240,232,0.05)",color:"rgba(245,240,232,0.45)",border:"1px solid rgba(245,240,232,0.06)",borderRadius:"6px",fontSize:"0.75rem",cursor:"pointer"}}>Stop</button>}
            </div>
            <button onClick={dlVideo} disabled={recording} style={{width:"100%",padding:"10px",background:"rgba(250,204,21,0.12)",color:"#FACC15",border:"1px solid rgba(250,204,21,0.20)",borderRadius:"6px",fontSize:"0.75rem",fontWeight:700,cursor:recording?"not-allowed":"pointer",opacity:recording?0.5:1,marginBottom:"0.5rem"}}>{recording?"Recording...":"⬇ Download Video (.webm)"}</button>
            <div style={{padding:"0.5rem",background:"#1A1A1A",borderRadius:"6px",border:"1px solid rgba(255,255,255,0.06)"}}>
              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.3)",margin:0,lineHeight:1.5}}><strong style={{color:"#FACC15"}}>Stack/Paparazzi/Fade:</strong> Events appear in batches of ~13. Each batch swaps to the next. Paparazzi mode adds camera flashes across the screen.</p>
              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.3)",margin:"3px 0 0",lineHeight:1.5}}><strong style={{color:"#FACC15"}}>Scroll:</strong> All events appear, then auto-scroll so every event gets screen time.</p>
              <p style={{fontSize:"0.55rem",color:"rgba(245,240,232,0.2)",margin:"4px 0 0"}}>{dayEv.length} events · {batchCount} batch{batchCount>1?"es":""} · {regions.join(" + ")}</p>
            </div>
            <div style={{marginTop:"0.6rem"}}><label style={L}>Events ({dayEv.length}) — ★ for CGE Pick</label>
              {/* Filter toggle */}
              {events.length>0&&(
                <div style={{display:"flex",gap:"3px",marginBottom:"0.3rem"}}>
                  <button onClick={()=>setListFilter("all")} style={{...B,flex:1,fontSize:"0.55rem",background:listFilter==="all"?"rgba(250,204,21,0.12)":"rgba(245,240,232,0.04)",color:listFilter==="all"?"#FACC15":"rgba(245,240,232,0.25)",border:listFilter==="all"?"1px solid rgba(250,204,21,0.20)":"1px solid rgba(245,240,232,0.04)"}}>All ({dayEv.length})</button>
                  <button onClick={()=>setListFilter("flagged")} style={{...B,flex:1,fontSize:"0.55rem",background:listFilter==="flagged"?"rgba(251,113,133,0.12)":"rgba(245,240,232,0.04)",color:listFilter==="flagged"?"#FB7185":"rgba(245,240,232,0.25)",border:listFilter==="flagged"?"1px solid rgba(251,113,133,0.20)":"1px solid rgba(245,240,232,0.04)"}}>Flagged ({totalWarnings})</button>
                </div>
              )}
              {/* Warning banner */}
              {totalWarnings>0&&(
                <div style={{padding:"4px 8px",background:"rgba(250,204,21,0.06)",border:"1px solid rgba(250,204,21,0.12)",borderRadius:"4px",marginBottom:"0.3rem",display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:"0.5rem"}}>
                  <span style={{color:"#FACC15",fontWeight:700}}>{totalWarnings} flagged</span>
                  <button onClick={()=>setDismissed(new Set(Object.keys(warnings).map(k=>Number(k)||k)))} style={{...B,fontSize:"0.45rem",padding:"2px 6px"}}>Dismiss all</button>
                </div>
              )}
              <div style={{maxHeight:250,overflowY:"auto"}}>{(()=>{
                let displayEvents=dayEv;
                if(listFilter==="flagged")displayEvents=dayEv.filter(ev=>(warnings[ev.id]?.length>0)&&!dismissed.has(ev.id));
                const regColors={North:"#C084FC",Central:"#34D399",South:"#FBBF24"};
                const regGroups=[];
                let curReg=null;
                displayEvents.forEach(ev=>{
                  if(ev.region!==curReg){regGroups.push({region:ev.region,events:[]});curReg=ev.region;}
                  regGroups[regGroups.length-1].events.push(ev);
                });
                return regGroups.map((rg,gi)=>(
                  <div key={gi}>
                    {regGroups.length>1&&<div style={{padding:"3px 8px",margin:"2px 0",background:"rgba(245,240,232,0.03)",borderRadius:"3px",borderLeft:`2px solid ${regColors[rg.region]||"#FFF"}`}}>
                      <span style={{fontSize:"0.45rem",fontWeight:700,color:regColors[rg.region]||"#FFF",letterSpacing:"1px"}}>{rg.region.toUpperCase()} <span style={{color:"rgba(245,240,232,0.2)",fontWeight:400}}>({rg.events.length})</span></span>
                    </div>}
                    {rg.events.map((ev,i)=>{
                const evW=warnings[ev.id]||[];const isDis=dismissed.has(ev.id);const hasW=evW.length>0;
                const worstType=evW.some(w=>w.type==="red")?"red":evW.some(w=>w.type==="yellow")?"yellow":"gray";
                const borderColor=!hasW?(ev.featured?"#FACC15":"transparent"):isDis?"rgba(245,240,232,0.08)":worstType==="red"?"#FB7185":worstType==="yellow"?"#FACC15":"rgba(245,240,232,0.15)";
                const isEditing=editId===ev.id;
                if(isEditing){
                  return <div key={ev.id} ref={el=>{if(el)eventRefs.current[ev.id]=el;}} style={{display:"flex",gap:"0.2rem",padding:"0.3rem 0.4rem",fontSize:"0.55rem",background:"rgba(250,204,21,0.06)",borderRadius:"3px",alignItems:"center",borderLeft:"2px solid #FACC15",flexWrap:"wrap"}}>
                    <select value={ev.emoji||""} onChange={e=>{if(e.target.value==="__custom__"){const c=prompt("Paste any emoji:");if(c)setEvents(p=>p.map(x=>x.id===ev.id?{...x,emoji:c.trim().slice(0,2)}:x));}else{setEvents(p=>p.map(x=>x.id===ev.id?{...x,emoji:e.target.value}:x));}}} style={{background:"transparent",border:"none",fontSize:"0.65rem",cursor:"pointer",minWidth:22,padding:0,outline:"none"}}>
                      {ALL_EMOJIS.map((em,ei)=><option key={ei} value={em}>{em||"— none —"}</option>)}
                      <option value="__custom__">✏️ Pick...</option>
                    </select>
                    <select value={ev.day} onChange={e=>setEvents(p=>p.map(x=>x.id===ev.id?{...x,day:e.target.value}:x))} style={{...I,width:48,fontSize:"0.55rem",padding:"3px 4px"}}>
                      <option value="Fri">Fri</option><option value="Sat">Sat</option><option value="Sun">Sun</option>
                    </select>
                    <input value={ev.name} onChange={e=>{const v=e.target.value;setEvents(p=>p.map(x=>x.id===ev.id?{...x,name:v}:x));}} style={{...I,flex:1,fontSize:"0.6rem",padding:"3px 5px"}} placeholder="Event name" />
                    <input value={ev.time} onChange={e=>{const v=e.target.value;setEvents(p=>p.map(x=>x.id===ev.id?{...x,time:v}:x));}} style={{...I,width:50,fontSize:"0.55rem",padding:"3px 5px",textAlign:"center"}} placeholder="Time" />
                    <input value={ev.venue||""} onChange={e=>setEvents(p=>p.map(x=>x.id===ev.id?{...x,venue:e.target.value}:x))} style={{...I,width:80,fontSize:"0.55rem",padding:"3px 5px"}} placeholder="Venue" />
                    <input value={ev.area||""} onChange={e=>setEvents(p=>p.map(x=>x.id===ev.id?{...x,area:e.target.value}:x))} style={{...I,width:65,fontSize:"0.55rem",padding:"3px 5px"}} placeholder="City" />
                    <select value={ev.region} onChange={e=>setEvents(p=>p.map(x=>x.id===ev.id?{...x,region:e.target.value}:x))} style={{...I,width:60,fontSize:"0.55rem",padding:"3px 4px"}}>
                      <option value="North">North</option><option value="Central">Central</option><option value="South">South</option>
                    </select>
                    <button onClick={()=>setEditId(null)} style={{background:"none",border:"none",color:"#FACC15",cursor:"pointer",fontSize:"0.6rem"}}>✓</button>
                  </div>;
                }
                return <div key={ev.id} ref={el=>{if(el)eventRefs.current[ev.id]=el;}} style={{display:"flex",gap:"0.2rem",padding:"0.2rem 0.4rem",fontSize:"0.55rem",background:ev.featured?"rgba(250,204,21,0.04)":(i%2===0?"#0e0e0e":"transparent"),borderRadius:"2px",alignItems:"center",borderLeft:`2px solid ${borderColor}`,opacity:isDis&&hasW?0.5:1}}>
                  <select value={ev.emoji||""} onChange={e=>{if(e.target.value==="__custom__"){const c=prompt("Paste any emoji:");if(c)setEvents(p=>p.map(x=>x.id===ev.id?{...x,emoji:c.trim().slice(0,2)}:x));}else{setEvents(p=>p.map(x=>x.id===ev.id?{...x,emoji:e.target.value}:x));}}} style={{background:"transparent",border:"none",fontSize:"0.65rem",cursor:"pointer",minWidth:22,padding:0,outline:"none"}}>
                    {ALL_EMOJIS.map((em,ei)=><option key={ei} value={em}>{em||"— none —"}</option>)}
                    <option value="__custom__">✏️ Pick...</option>
                  </select>
                  <span style={{fontWeight:700,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:ev.featured?"#FACC15":"inherit",cursor:"pointer"}} onClick={()=>setEditId(ev.id)}>{ev.name}</span>
                  {hasW&&!isDis&&(
                    <div style={{display:"flex",gap:"2px",flexShrink:0}}>
                      {evW.slice(0,2).map((w,wi)=>{const hasG=w.msg.includes("#");return(
                        <span key={wi} onClick={hasG?()=>{const partners=findFlagPartners(ev.id,w.msg);if(partners.length>0){setListFilter("all");setTimeout(()=>scrollToEvent(partners[0]),100);}}:undefined} style={{fontSize:"0.35rem",padding:"1px 3px",borderRadius:"2px",fontWeight:700,cursor:hasG?"pointer":"default",background:w.type==="red"?"rgba(251,113,133,0.15)":w.type==="yellow"?"rgba(250,204,21,0.12)":"rgba(245,240,232,0.06)",color:w.type==="red"?"#FB7185":w.type==="yellow"?"#FACC15":"rgba(245,240,232,0.30)"}}>{w.msg}</span>
                      );})}
                    </div>
                  )}
                  {hasW&&isDis&&<span style={{fontSize:"0.35rem",color:"rgba(245,240,232,0.15)"}}>✓</span>}
                  {ev.featured&&<span style={{fontSize:"0.38rem",background:"rgba(250,204,21,0.15)",color:"#FACC15",padding:"1px 4px",borderRadius:"2px",fontWeight:700}}>PICK</span>}
                  <span style={{color:"rgba(245,240,232,0.3)",fontSize:"0.45rem"}}>{ev.time}</span>
                  {hasW&&!isDis&&<button onClick={()=>setDismissed(p=>{const n=new Set(p);n.add(ev.id);return n;})} style={{background:"none",border:"none",color:"rgba(250,204,21,0.35)",cursor:"pointer",fontSize:"0.5rem",padding:"1px 2px"}}>✓</button>}
                  <button onClick={(e)=>{e.stopPropagation();setEvents(p=>p.map(x=>x.id===ev.id?{...x,featured:!x.featured}:x));}} style={{background:"none",border:"none",color:ev.featured?"#FACC15":"rgba(245,240,232,0.12)",cursor:"pointer",fontSize:"0.7rem",padding:"1px 3px"}}>★</button>
                  <button onClick={()=>setEvents(p=>p.filter(x=>x.id!==ev.id))} style={{background:"none",border:"none",color:"rgba(251,113,133,0.3)",cursor:"pointer",fontSize:"0.6rem",padding:"1px 3px"}}>×</button>
                </div>;
              })}
                  </div>
                ));
              })()}{dayEv.length===0&&<p style={{textAlign:"center",padding:"1rem",color:"rgba(245,240,232,0.1)",fontSize:"0.7rem"}}>Upload events</p>}</div>
            </div>
          </div>
          <div className="cge-builder-preview"><label style={{...L,marginBottom:"6px"}}>Preview (9:16)</label>
            <canvas ref={cvRef} style={{width:300,height:533,borderRadius:"8px",display:"block",background:"#000"}}/>
          </div>
        </div>
      </div>
    </div>
  );
}
const L={display:"block",fontSize:"0.5rem",letterSpacing:"1.5px",textTransform:"uppercase",color:"rgba(245,240,232,0.22)",marginBottom:"3px"};
const I={width:"100%",padding:"5px 7px",background:"#111",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"#F5F0E8",fontFamily:"'DM Sans',sans-serif",fontSize:"0.7rem",outline:"none"};
const B={padding:"5px 8px",background:"rgba(245,240,232,0.04)",border:"1px solid rgba(245,240,232,0.04)",borderRadius:"4px",color:"rgba(245,240,232,0.35)",fontSize:"0.65rem",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"};
