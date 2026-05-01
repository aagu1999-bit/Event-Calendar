import { useState, useRef, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

// ==================== COLOR SYSTEM ====================
const COLORS = {
  purple: { name: "Purple", hex: "#7C3AED", light: false, accent: "#C084FC", rowBg: "rgba(0,0,0,0.25)", textMain: "#FFFFFF", textSub: "rgba(255,255,255,0.75)", timeFill: "#FFFFFF", spotR: 255, spotG: 255, spotB: 255, spotA: 0.50 },
  gold:   { name: "Gold",   hex: "#D4943A", light: true,  accent: "#D4943A", rowBg: "rgba(0,0,0,0.75)", textMain: "#FFFFFF", textSub: "rgba(255,255,255,0.75)", timeFill: "#D4943A", spotR: 255, spotG: 255, spotB: 255, spotA: 0.55 },
  wine:   { name: "Wine",   hex: "#BE3A34", light: false, accent: "#FB7185", rowBg: "rgba(0,0,0,0.30)", textMain: "#FFFFFF", textSub: "rgba(255,255,255,0.75)", timeFill: "#FFFFFF", spotR: 255, spotG: 255, spotB: 255, spotA: 0.50 },
  emerald:{ name: "Emerald",hex: "#059669", light: false, accent: "#34D399", rowBg: "rgba(0,0,0,0.30)", textMain: "#FFFFFF", textSub: "rgba(255,255,255,0.75)", timeFill: "#FFFFFF", spotR: 255, spotG: 255, spotB: 255, spotA: 0.50 },
  yellow: { name: "Yellow", hex: "#EAB308", light: true,  accent: "#EAB308", rowBg: "rgba(0,0,0,0.80)", textMain: "#FFFFFF", textSub: "rgba(255,255,255,0.75)", timeFill: "#EAB308", spotR: 255, spotG: 255, spotB: 255, spotA: 0.55 },
  black:  { name: "Black",  hex: "#000000", light: false, accent: "#E5BC4F", rowBg: "rgba(229,188,79,0.12)", textMain: "#FFFFFF", textSub: "rgba(255,255,255,0.75)", timeFill: "#E5BC4F", spotR: 229, spotG: 188, spotB: 79, spotA: 0.45 },
};

// ==================== EMOJI MAPPING ====================
const EMOJI_MAP = {
  "🎧": ["CLUB NIGHT","CONCERT","DJ NIGHT","DJ SET","LIVE MUSIC","MUSIC","MUSIC & DRINKS","MUSIC/NIGHTLIFE","NIGHTLIFE","JOUVERT EXPERIENCE","NIGHTCLUB","ENTERTAINMENT","PERFORMANCE"],
  "💃": ["PARTY","DAY PARTY","ANNIVERSARY PARTY","BIRTHDAY CELEBRATION","BRUNCH & DAY PARTY","POST-RACE PARTY","LADIES NIGHT","DANCE","LINE DANCING"],
  "🥂": ["ACTIVATION","ANNIVERSARY","HAPPY HOUR","MEETUP","MIXER","SOCIAL","SPEED DATING","LOUNGE","GALA","LUNCHEON"],
  "🎭": ["ART","ARTS","ART EXHIBITION","ART SHOW","ARTS & CULTURE","BOOK CLUB","BOOK LAUNCH/","CRAFT WORKSHOP","OPEN MIC","OPEN MIC/PERFORMANCE","POETRY SLAM","SERIES","WORKSHOP"],
  "🎨": ["PAINT AND SIP","SIP AND PAINT","ART WORKSHOP"],
  "🎤": ["KARAOKE"],
  "🛍️": ["MARKET","MARKETPLACE","POP-UP"],
  "🍷": ["BINGO BRUNCH","BRUNCH","DINNER PARTY","FOOD","FOOD & DRINK","FOOD FESTIVAL","GOSPEL BRUNCH","GOSPEL BRUNCH AND"],
  "💪": ["ADULT SKATE","DANCE CLASS","FAMILY SKATE","FITNESS","FITNESS CLASS","GROUP RUN","PAINTBALL","RACE","RUN","RUNNING","SKATING","SKATING EVENT","SPORTS","WALK","WALK CLUB","WALK/RUN","YOGA","COMPETITION","CHEER ZONE","SOUND HEALING"],
  "🎬": ["MOVIE","MOVIE SCREENING"],
  "😂": ["COMEDY","COMEDY SHOW"],
  "🎪": ["EXHIBITION","FESTIVAL","CAR SHOW"],
  "🎲": ["BOWLING","GAME NIGHT","GAMING","TRIVIA"],
  "🤝": ["ADOPTION EVENT","CLASS","CLEANUP","COMMUNITY","COMMUNITY CELEBRATION","VOLUNTEER"],
};

function getEmoji(type) {
  if (!type) return "🎧";
  const upper = String(type).toUpperCase().trim();
  for (const [emoji, types] of Object.entries(EMOJI_MAP)) {
    if (types.includes(upper)) return emoji;
  }
  return "🎧"; // default
}

// ==================== CONSTANTS ====================
const SIZES = { "4:5": { w: 1080, h: 1350 }, "1:1": { w: 1080, h: 1080 }, "9:16": { w: 1080, h: 1920 } };
const MAX_FIRST = { "4:5": 7, "1:1": 5, "9:16": 11 };
const MAX_CONT = { "4:5": 11, "1:1": 8, "9:16": 16 };
const WEEKDAYS = ["Fri","Sat","Sun"];
const REGIONS = ["North","Central","South"];
const DAY_ORDER = { "Fri": 0, "Sat": 1, "Sun": 2 };
const REGION_ORDER = { "North": 0, "Central": 1, "South": 2 };

// ==================== PARSE HELPERS ====================
function parseTime(t) {
  if (!t) return 9999;
  const raw = String(t).trim();
  
  // Try string match FIRST (catches "1 PM", "9:30 AM", etc.)
  const m = raw.match(/(\d+)(?::(\d+))?(?::(\d+))?\s*(AM|PM|am|pm|A|P|a|p)?/i);
  if (m && m[4]) {
    // Has AM/PM marker — parse as time string
    let h = parseInt(m[1]), min = parseInt(m[2] || "0");
    const p = m[4].toUpperCase();
    if (p.startsWith("P") && h < 12) h += 12;
    if (p.startsWith("A") && h === 12) h = 0;
    return h * 60 + min;
  }
  
  // Handle Excel decimal time (only if it has a decimal point)
  const numVal = parseFloat(raw);
  const hasDecimal = raw.includes(".");
  if (!isNaN(numVal) && hasDecimal && numVal >= 0 && numVal < 2) {
    const frac = numVal >= 1 ? numVal - 1 : numVal;
    return Math.round(frac * 24 * 60);
  }
  
  // Bare number without AM/PM (e.g. "1", "8", "10")
  if (m && !m[4]) {
    let h = parseInt(m[1]), min = parseInt(m[2] || "0");
    if (h >= 1 && h <= 8) h += 12; // assume PM
    return h * 60 + min;
  }
  
  return 9999;
}

// Convert Excel decimal time or normalize time strings for display
function formatTimeOutput(h, min, ampm) {
  if (min === 15 || min === 30 || min === 45) return `${h}:${String(min).padStart(2, "0")} ${ampm}`;
  return `${h} ${ampm}`;
}

function formatTime(t) {
  if (!t) return "";
  const raw = String(t).trim();
  
  // Handle Excel decimal (only if it actually has decimal places like 0.541, not whole numbers like "1")
  const numVal = parseFloat(raw);
  const hasDecimal = raw.includes(".");
  if (!isNaN(numVal) && hasDecimal && numVal >= 0 && numVal < 2) {
    const frac = numVal >= 1 ? numVal - 1 : numVal;
    const totalMin = Math.round(frac * 24 * 60);
    let h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return formatTimeOutput(h, min, ampm);
  }
  
  // Handle string time like "9:00 PM", "9:30:00 PM", "10 PM", "1 PM", or bare numbers like "1" "8"
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM|am|pm|A|P|a|p)?$/i);
  if (m) {
    let h = parseInt(m[1]);
    const min = parseInt(m[2] || "0");
    let p = (m[4] || "").toUpperCase();
    if (p.startsWith("P") && h < 12) h += 12;
    if (p.startsWith("A") && h === 12) h = 0;
    // No AM/PM given: assume PM for 1-8, assume the number as-is for 9-12
    if (!p && h >= 1 && h <= 8) h += 12;
    const ampm = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return formatTimeOutput(h, min, ampm);
  }
  
  return raw;
}

function sortEv(evts) {
  return [...evts].sort((a, b) => {
    const da = DAY_ORDER[a.day] ?? 9, db = DAY_ORDER[b.day] ?? 9;
    if (da !== db) return da - db;
    const ra = REGION_ORDER[a.region] ?? 9, rb = REGION_ORDER[b.region] ?? 9;
    if (ra !== rb) return ra - rb;
    return parseTime(a.time) - parseTime(b.time);
  });
}

function parseLine(line) {
  let parts;
  if (line.includes("\t")) parts = line.split("\t").map(s => s.trim());
  else if (line.includes("|")) parts = line.split("|").map(s => s.trim());
  else { parts = []; let cur = "", inQ = false; for (const ch of line) { if (ch === '"') { inQ = !inQ; continue; } if (ch === ',' && !inQ) { parts.push(cur.trim()); cur = ""; continue; } cur += ch; } parts.push(cur.trim()); }
  return parts;
}

function parseDay(d) {
  if (!d || !String(d).trim()) return "Fri";
  const lower = String(d).toLowerCase().trim().replace(/[.]/g, "");
  if (lower.startsWith("fri") || lower === "f") return "Fri";
  if (lower.startsWith("sat") || lower === "sa" || lower === "s") return "Sat";
  if (lower.startsWith("sun") || lower === "su") return "Sun";
  return null;
}

function parseRegion(r) {
  if (!r || !String(r).trim()) return null;
  const lower = String(r).toLowerCase().replace(/\s*(nj|jersey)$/i, "").trim();
  if (lower === "north" || lower === "n" || lower === "northern") return "North";
  if (lower === "central" || lower === "c" || lower === "cent" || lower === "middle") return "Central";
  if (lower === "south" || lower === "so" || lower === "southern" || lower === "shore") return "South";
  return null;
}

function parseDateToDay(dateStr) {
  if (!dateStr || !String(dateStr).trim()) return null;
  const raw = String(dateStr).trim();
  let d = null;
  const num = parseFloat(raw);
  if (!isNaN(num) && num > 40000 && num < 60000) d = new Date((num - 25569) * 86400000);
  if (!d) { const mdy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/); if (mdy) { const yr = mdy[3] ? (mdy[3].length === 2 ? 2000 + parseInt(mdy[3]) : parseInt(mdy[3])) : new Date().getFullYear(); d = new Date(yr, parseInt(mdy[1]) - 1, parseInt(mdy[2])); } }
  if (!d) { const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (iso) d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3])); }
  if (!d) { const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11}; const mn = raw.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i); if (mn) { const mi = months[mn[1].slice(0,3).toLowerCase()]; if (mi !== undefined) { const yr = mn[3] ? parseInt(mn[3]) : new Date().getFullYear(); d = new Date(yr, mi, parseInt(mn[2])); } } }
  if (d && !isNaN(d.getTime())) {
    const dow = d.getDay();
    const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return { day: names[dow], date: `${d.getMonth()+1}/${d.getDate()}` };
  }
  return null;
}

const COL_PATTERNS = {
  date: /^(date|event\s*date|calendar\s*date|start\s*date)$/i,
  day: /^(day|weekday|dow|day\s*of\s*week|event\s*day)$/i,
  time: /^(time|start|start\s*time|event\s*time|begins?|hour)$/i,
  name: /^(name|event|event\s*name|title|event\s*title|show|party)$/i,
  venue: /^(venue|venue\s*name|location|place|spot|club|lounge|restaurant|bar|space)$/i,
  area: /^(area|city|town|neighborhood|hood|municipality|address|where|locale)$/i,
  region: /^(region|zone|section|nj\s*region|part|area\s*region|region\s*nj|nj\s*area)$/i,
  type: /^(type|category|genre|event\s*type|event\s*category|kind)$/i,
  _ignore: /^(ticket|link|url|price|cost|notes|description|promoter|capacity|id|#|number|status|flyer|image|phone|email|contact|website|rsvp|age|dress\s*code)$/i,
};

function matchColumns(headers) {
  const map = {};
  // First pass: strict regex
  headers.forEach((h, i) => {
    const clean = String(h).trim();
    if (COL_PATTERNS._ignore.test(clean)) return;
    for (const [field, pattern] of Object.entries(COL_PATTERNS)) {
      if (field === "_ignore") continue;
      if (pattern.test(clean) && !(field in map)) { map[field] = i; break; }
    }
  });
  // Second pass: fuzzy keyword match
  const fuzzy = { date: /\bdate\b/i, day: /\bday\b|\bweekday\b/i, time: /\btime\b|\bhour\b/i, name: /\bevent\s*name\b|\btitle\b/i, venue: /\bvenue\b|\blocation\b|\bplace\b/i, area: /\bcity\b|\btown\b|\bneighborhood\b/i, region: /\bregion\b|\bzone\b|\bsection\b/i, type: /\btype\b|\bcategory\b|\bgenre\b/i };
  headers.forEach((h, i) => {
    const clean = String(h).trim();
    if (Object.values(map).includes(i)) return;
    if (COL_PATTERNS._ignore.test(clean)) return;
    for (const [f, rx] of Object.entries(fuzzy)) { if (!(f in map) && rx.test(clean)) { map[f] = i; break; } }
  });
  return map;
}

function rowToEvent(row, colMap, defaultRegion) {
  const get = (field) => {
    if (field in colMap && colMap[field] < row.length) return String(row[colMap[field]] ?? "").replace(/^["']+|["']+$/g, "").trim();
    return "";
  };
  const region = parseRegion(get("region")) || defaultRegion || "North";

  // Determine day: prefer day column, fall back to date column
  let day = null;
  if ("day" in colMap) day = parseDay(get("day"));
  if (!day && "date" in colMap) {
    const dateInfo = parseDateToDay(get("date"));
    if (dateInfo) day = dateInfo.day;
  }
  if (!day) day = "Fri";

  const type = get("type");
  const rawTime = get("time");
  return {
    id: Date.now() + Math.random() * 100000,
    day, time: formatTime(rawTime), name: get("name"), venue: get("venue"), area: get("area"),
    region, type, emoji: getEmoji(type), featured: false,
  };
}

function parseStructuredRows(rows, defaultRegion) {
  if (!rows || rows.length === 0) return [];
  const firstRow = rows[0].map(c => String(c ?? "").trim());
  const colMap = matchColumns(firstRow);
  const hasHeaders = Object.keys(colMap).length >= 2;
  const dataRows = hasHeaders ? rows.slice(1) : rows;
  const finalMap = hasHeaders ? colMap : { day: 0, time: 1, name: 2, venue: 3, area: 4, region: 5 };
  if (hasHeaders && !("name" in finalMap)) {
    for (let i = 0; i < firstRow.length; i++) {
      if (!Object.values(finalMap).includes(i)) { finalMap.name = i; break; }
    }
  }
  return dataRows
    .filter(r => r && r.some(c => c != null && String(c).trim() !== ""))
    .map(r => rowToEvent(r, finalMap, defaultRegion))
    .filter(e => e.name && e.day !== null);
}

function calcDates(friDate) {
  const parts = friDate.split("/");
  if (parts.length !== 2) return { Fri: friDate, Sat: "", Sun: "" };
  const month = parseInt(parts[0]), day = parseInt(parts[1]);
  if (isNaN(month) || isNaN(day)) return { Fri: friDate, Sat: "", Sun: "" };
  const daysInMonth = [0,31,29,31,30,31,30,31,31,30,31,30,31];
  const max = daysInMonth[month] || 31;
  const sat = day + 1 > max ? `${month+1}/1` : `${month}/${day+1}`;
  const sun = day + 2 > max ? `${month+1}/${day+2-max}` : `${month}/${day+2}`;
  return { Fri: friDate, Sat: sat, Sun: sun };
}

// ==================== CANVAS RENDERER ====================
function renderCal(canvas, events, cfg) {
  const { colorKey, friDate, size, pageIdx, totalPages, dates, texture, isContinuation } = cfg;
  const co = COLORS[colorKey];
  const W = size.w, H = size.h;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const s = W / 1080;
  const px = 50 * s;
  const isLight = co.light;
  const pureHead = isLight ? "#000000" : "#FFFFFF";
  const pureSub = isLight ? "#000000" : "#FFFFFF";

  // === SOLID BACKGROUND ===
  ctx.fillStyle = co.hex;
  ctx.fillRect(0, 0, W, H);

  // === CGE LETTER TEXTURE ===
  const letters = ["C", "G", "E"];
  const isSmall = texture === "small";
  const isXL = texture === "xlarge";
  const letterSize = isSmall ? (14 * s) : isXL ? (42 * s) : (26 * s);
  const letterSpacingX = isSmall ? (24 * s) : isXL ? (65 * s) : (42 * s);
  const letterSpacingY = isSmall ? (22 * s) : isXL ? (58 * s) : (38 * s);
  const letterColor = colorKey === "black" ? co.accent : "#000000";
  const letterOpacity = colorKey === "black" ? 0.14 : (co.light ? 0.16 : 0.18);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-5 * Math.PI / 180);
  ctx.translate(-W / 2, -H / 2);
  ctx.font = `800 ${letterSize}px 'Syne',sans-serif`;
  ctx.fillStyle = letterColor;
  ctx.globalAlpha = letterOpacity;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const startX = -80 * s;
  const startY = -80 * s;
  const endX = W + 80 * s;
  const endY = H + 80 * s;
  let letterIdx = 0;

  for (let y = startY; y < endY; y += letterSpacingY) {
    const rowOffset = (Math.round((y - startY) / letterSpacingY) % 2 === 1) ? letterSpacingX * 0.5 : 0;
    for (let x = startX + rowOffset; x < endX; x += letterSpacingX) {
      ctx.fillText(letters[letterIdx % 3], x, y);
      letterIdx++;
    }
  }

  ctx.restore();

  // === SPOTLIGHT SYSTEM ===
  const sR = co.spotR, sG = co.spotG, sB = co.spotB, sA = co.spotA;

  // Source point (top-left)
  const srcGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 250 * s);
  srcGrad.addColorStop(0, `rgba(${sR},${sG},${sB},${sA})`);
  srcGrad.addColorStop(0.3, `rgba(${sR},${sG},${sB},${sA * 0.45})`);
  srcGrad.addColorStop(0.65, `rgba(${sR},${sG},${sB},${sA * 0.12})`);
  srcGrad.addColorStop(1, "transparent");
  ctx.fillStyle = srcGrad;
  ctx.fillRect(0, 0, W, H);

  // Cone body
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W * 0.65, H * 0.55);
  ctx.lineTo(W * 0.35, H * 0.70);
  ctx.closePath();
  const coneGrad = ctx.createLinearGradient(0, 0, W * 0.5, H * 0.6);
  coneGrad.addColorStop(0, `rgba(${sR},${sG},${sB},${sA * 0.35})`);
  coneGrad.addColorStop(0.4, `rgba(${sR},${sG},${sB},${sA * 0.15})`);
  coneGrad.addColorStop(0.7, `rgba(${sR},${sG},${sB},${sA * 0.06})`);
  coneGrad.addColorStop(1, "transparent");
  ctx.fillStyle = coneGrad;
  ctx.fill();
  ctx.restore();

  // Diagonal streak
  const streakGrad = ctx.createLinearGradient(0, 0, W, H);
  streakGrad.addColorStop(0, `rgba(${sR},${sG},${sB},${sA * 0.35})`);
  streakGrad.addColorStop(0.25, `rgba(${sR},${sG},${sB},${sA * 0.10})`);
  streakGrad.addColorStop(0.5, "transparent");
  streakGrad.addColorStop(0.75, `rgba(${sR},${sG},${sB},${sA * 0.08})`);
  streakGrad.addColorStop(1, `rgba(${sR},${sG},${sB},${sA * 0.25})`);
  ctx.fillStyle = streakGrad;
  ctx.fillRect(0, 0, W, H);

  // Landing pool (bottom-right oval)
  const poolGrad = ctx.createRadialGradient(W * 0.78, H * 0.88, 0, W * 0.78, H * 0.88, 280 * s);
  poolGrad.addColorStop(0, `rgba(${sR},${sG},${sB},${sA * 0.55})`);
  poolGrad.addColorStop(0.25, `rgba(${sR},${sG},${sB},${sA * 0.25})`);
  poolGrad.addColorStop(0.5, `rgba(${sR},${sG},${sB},${sA * 0.08})`);
  poolGrad.addColorStop(1, "transparent");
  ctx.save();
  ctx.scale(1, 0.6);
  ctx.fillStyle = poolGrad;
  ctx.fillRect(0, 0, W, H / 0.6);
  ctx.restore();

  // Inner pool bright spot
  const poolInner = ctx.createRadialGradient(W * 0.80, H * 0.90, 0, W * 0.80, H * 0.90, 120 * s);
  poolInner.addColorStop(0, `rgba(${sR},${sG},${sB},${sA * 0.40})`);
  poolInner.addColorStop(0.5, `rgba(${sR},${sG},${sB},${sA * 0.12})`);
  poolInner.addColorStop(1, "transparent");
  ctx.fillStyle = poolInner;
  ctx.fillRect(0, 0, W, H);

  // Top-right corner glow (faded light matching the reference)
  const trGlow = ctx.createRadialGradient(W, 0, 0, W, 0, 300 * s);
  trGlow.addColorStop(0, `rgba(${sR},${sG},${sB},${sA * 0.35})`);
  trGlow.addColorStop(0.3, `rgba(${sR},${sG},${sB},${sA * 0.15})`);
  trGlow.addColorStop(0.6, `rgba(${sR},${sG},${sB},${sA * 0.04})`);
  trGlow.addColorStop(1, "transparent");
  ctx.fillStyle = trGlow;
  ctx.fillRect(0, 0, W, H);

  // === HEADER ===
  const pageDays = [...new Set(events.map(e => e.day))];
  const pageDay = pageDays[0] || "Fri";
  const dayFull = { Fri: "FRIDAY", Sat: "SATURDAY", Sun: "SUNDAY" };
  const dayDate = dates[pageDay] || friDate;
  const activeRegs = [...new Set(events.map(e => e.region))];
  const isMultiReg = activeRegs.length > 1;

  ctx.textBaseline = "top";

  let evTop;

  if (isContinuation) {
    // === MINI HEADER (continuation pages) ===
    // Slim bar with day + date + page number
    const miniH = 70 * s;
    const miniBg = isLight ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.25)";
    ctx.fillStyle = miniBg;
    ctx.fillRect(0, 0, W, miniH);

    // Bottom border of mini header
    const miniBorder = isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.12)";
    ctx.fillStyle = miniBorder;
    ctx.fillRect(px, miniH - 1.5 * s, W - px * 2, 1.5 * s);

    // Day + date left
    ctx.font = `800 ${36 * s}px 'Syne',sans-serif`;
    ctx.fillStyle = pureHead;
    ctx.textBaseline = "middle";
    ctx.fillText(`${dayFull[pageDay]}  ${dayDate}`, px, miniH / 2);

    // "NJ WEEKEND EVENTS" right
    ctx.font = `700 ${16 * s}px 'DM Sans',sans-serif`;
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.40)" : "rgba(255,255,255,0.40)";
    ctx.textAlign = "right";
    ctx.fillText("NJ WEEKEND EVENTS", W - px, miniH / 2 - 10 * s);

    // Page indicator right
    if (totalPages > 1) {
      ctx.font = `400 ${18 * s}px 'DM Sans',sans-serif`;
      ctx.fillStyle = isLight ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.25)";
      ctx.fillText(`${pageIdx + 1}/${totalPages}`, W - px, miniH / 2 + 10 * s);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // Region on continuation page (same treatment as full header)
    if (!isMultiReg && events.length > 0) {
      const region = events[0].region || "North";
      ctx.font = `800 ${38 * s}px 'Syne',sans-serif`;
      ctx.fillStyle = pureHead;
      ctx.textAlign = "center";
      ctx.fillText(region.toUpperCase(), W / 2, miniH + 10 * s);
      ctx.textAlign = "left";

      const regionLineColor = isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.20)";
      ctx.fillStyle = regionLineColor;
      ctx.fillRect(px, miniH + 52 * s, W - px * 2, 1.5 * s);

      evTop = miniH + 60 * s;
    } else {
      // Multi-region — dividers will render inline, start events right after mini header
      evTop = miniH + 10 * s;
    }

  } else {
    // === FULL HEADER (first page of each day) ===

    // "NJ WEEKEND EVENTS" masthead
    ctx.font = `700 ${36 * s}px 'DM Sans',sans-serif`;
    ctx.fillStyle = pureHead;
    ctx.letterSpacing = `${5 * s}px`;
    ctx.fillText("NJ WEEKEND EVENTS", px, 28 * s);
    ctx.letterSpacing = "0px";

    // Day name (stacked)
    ctx.font = `800 ${98 * s}px 'Syne',sans-serif`;
    ctx.fillStyle = pureHead;
    ctx.fillText(dayFull[pageDay], px, 65 * s);

    // Date (stacked below day)
    ctx.font = `800 ${98 * s}px 'Syne',sans-serif`;
    ctx.fillText(dayDate, px, 160 * s);

    // Line under header
    const lineY = 265 * s;
    const lineGrad = ctx.createLinearGradient(px, 0, W - px, 0);
    if (isLight) {
      lineGrad.addColorStop(0, "rgba(0,0,0,0.45)");
      lineGrad.addColorStop(0.5, "rgba(0,0,0,0.12)");
      lineGrad.addColorStop(1, "transparent");
    } else {
      lineGrad.addColorStop(0, "rgba(255,255,255,0.50)");
      lineGrad.addColorStop(0.5, "rgba(255,255,255,0.15)");
      lineGrad.addColorStop(1, "transparent");
    }
    ctx.fillStyle = lineGrad;
    ctx.fillRect(px, lineY, W - px * 2, 2 * s);

    // Region handling
    const regionStartY = lineY + 6 * s;

    // Single region header (centered)
    if (!isMultiReg && events.length > 0) {
      const region = events[0].region || "North";
      ctx.font = `800 ${38 * s}px 'Syne',sans-serif`;
      ctx.fillStyle = pureHead;
      ctx.textAlign = "center";
      ctx.fillText(region.toUpperCase(), W / 2, regionStartY + 6 * s);
      ctx.textAlign = "left";

      const regionLineColor = isLight ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.20)";
      ctx.fillStyle = regionLineColor;
      ctx.fillRect(px, regionStartY + 48 * s, W - px * 2, 1.5 * s);
    }

    // Page indicator
    if (totalPages > 1) {
      ctx.font = `400 ${24 * s}px 'DM Sans',sans-serif`;
      ctx.fillStyle = isLight ? "rgba(0,0,0,0.30)" : "rgba(255,255,255,0.30)";
      ctx.textAlign = "right";
      ctx.fillText(`${pageIdx + 1}/${totalPages}`, W - px, 28 * s);
      ctx.textAlign = "left";
    }

    const regionStartYCalc = 265 * s + 6 * s;
    evTop = isMultiReg ? (regionStartYCalc + 6 * s) : (regionStartYCalc + 55 * s);
  }

  // === EVENTS ===
  const footerH = 90 * s;
  const evBot = H - footerH - 16 * s;
  const evH = evBot - evTop;

  // Group by region
  const regGroups = [];
  let curReg = null;
  events.forEach(ev => {
    if (ev.region !== curReg && isMultiReg) {
      regGroups.push({ region: ev.region, events: [ev] });
      curReg = ev.region;
    } else if (regGroups.length === 0) {
      regGroups.push({ region: ev.region, events: [ev] });
      curReg = ev.region;
    } else {
      regGroups[regGroups.length - 1].events.push(ev);
    }
  });

  const regDivH = isMultiReg ? 58 * s : 0;
  let totalDivH = 0;
  regGroups.forEach((rg, ri) => { if (ri > 0 || isMultiReg) totalDivH += regDivH; });
  const rowH = events.length > 0 ? Math.min(140 * s, Math.max(100 * s, (evH - totalDivH) / events.length)) : 120 * s;

  let curY = evTop;

  regGroups.forEach((rg, ri) => {
    if (isMultiReg) {
      curY += (ri > 0 ? 10 : 2) * s;
      const regLabel = rg.region.toUpperCase();
      ctx.font = `800 ${38 * s}px 'Syne',sans-serif`;
      ctx.fillStyle = pureHead;
      ctx.textAlign = "center";
      ctx.fillText(regLabel, W / 2, curY + 10 * s);
      ctx.textAlign = "left";

      const divColor = isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)";
      ctx.fillStyle = divColor;
      ctx.fillRect(px, curY + 50 * s, W - px * 2, 1.5 * s);
      curY += regDivH;
    }

    rg.events.forEach(ev => {
      const rY = curY, rW = W - px * 2, rH = rowH - 8 * s;

      // SAFETY: skip rendering if this row would touch or overlap the footer
      if (rY + rH > H - footerH - 8 * s) {
        curY += rowH;
        return;
      }

      // CGE Pick yellow glow
      if (ev.featured) {
        for (let i = 12; i >= 0; i--) {
          const inset = i * 1.3 * s;
          const opacity = 0.015 + (12 - i) * 0.012;
          ctx.fillStyle = `rgba(234,179,8,${opacity})`;
          ctx.beginPath();
          ctx.roundRect(px - inset, rY - inset, rW + inset * 2, rH + inset * 2, (10 + inset / s) * s);
          ctx.fill();
        }
      }

      // Row background
      ctx.fillStyle = co.rowBg;
      ctx.beginPath();
      ctx.roundRect(px, rY, rW, rH, 10 * s);
      ctx.fill();

      // CGE Pick outline
      if (ev.featured) {
        ctx.strokeStyle = "rgba(234,179,8,0.55)";
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.roundRect(px, rY, rW, rH, 10 * s);
        ctx.stroke();

        // CGE PICK badge
        const bW = 120 * s, bH = 30 * s;
        const bX = px + rW - bW - 14 * s;
        ctx.fillStyle = "#FACC15";
        ctx.beginPath();
        ctx.roundRect(bX, rY - 1, bW, bH, [0, 0, 6 * s, 6 * s]);
        ctx.fill();
        ctx.font = `700 ${16 * s}px 'DM Sans',sans-serif`;
        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("CGE PICK", bX + bW / 2, rY + bH / 2);
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
      }

      // Emoji — FULL OPACITY, HIGH CONTRAST
      const emojiX = px + 18 * s;
      const cY = rY + rH / 2;
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.font = `${38 * s}px sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(ev.emoji || "", emojiX, cY);
      ctx.restore();
      // Store emoji hit area
      if (cfg._emojiPositions) cfg._emojiPositions.push({ id: ev.id, x: emojiX - 10*s, y: cY - 22*s, w: 55*s, h: 44*s });

      // Event name — ALWAYS WHITE (rows are always dark)
      const nameX = emojiX + 50 * s;
      ctx.font = `700 ${34 * s}px 'DM Sans',sans-serif`;
      ctx.fillStyle = "#FFFFFF";
      const maxNW = W - nameX - px - 100 * s;
      let nm = ev.name.toUpperCase();
      if (ctx.measureText(nm).width > maxNW) {
        while (ctx.measureText(nm + "...").width > maxNW && nm.length > 0) nm = nm.slice(0, -1);
        nm += "...";
      }
      ctx.fillText(nm, nameX, cY - (ev.featured ? 16 : 18) * s);

      // Venue · City — ALWAYS WHITE (rows are always dark)
      ctx.font = `400 ${26 * s}px 'DM Sans',sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      let venueStr = ev.venue;
      if (ev.area) venueStr += ` · ${ev.area}`;
      ctx.fillText(venueStr, nameX, cY + (ev.featured ? 16 : 14) * s);

      // Time — BIGGER, PURE WHITE/BLACK
      ctx.font = `700 ${34 * s}px 'DM Sans',sans-serif`;
      ctx.fillStyle = co.timeFill;
      ctx.textAlign = "right";
      const timeY = ev.featured ? cY + 12 * s : cY;
      ctx.fillText(ev.time, W - px - 18 * s, timeY);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";

      curY += rowH;
    });
  });

  // === FOOTER (with visible bar) ===
  const footerY = H - footerH;
  const footerBorderColor = isLight ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.15)";
  const footerBgColor = isLight ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.30)";

  // Footer background bar
  ctx.fillStyle = footerBgColor;
  ctx.fillRect(0, footerY, W, footerH);

  // Top border of footer
  ctx.fillStyle = footerBorderColor;
  ctx.fillRect(px, footerY, W - px * 2, 1.5 * s);

  // Brand name — BIGGER
  ctx.font = `800 ${26 * s}px 'Syne',sans-serif`;
  ctx.fillStyle = pureHead;
  ctx.textBaseline = "middle";
  ctx.fillText("CENTRAL GROUP EVENTS", px, footerY + footerH / 2);

  // Website — BOLDER, MORE VISIBLE
  ctx.font = `600 ${22 * s}px 'DM Sans',sans-serif`;
  ctx.fillStyle = isLight ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.60)";
  ctx.textAlign = "right";
  ctx.fillText("centralgroupevents.com", W - px, footerY + footerH / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Swipe indicator (below footer text)
  if (pageIdx < totalPages - 1 && totalPages > 1) {
    ctx.font = `400 ${18 * s}px 'DM Sans',sans-serif`;
    ctx.fillStyle = isLight ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.20)";
    ctx.textAlign = "center";
    ctx.fillText("Swipe for more →", W / 2, footerY + footerH / 2 + 18 * s);
    ctx.textAlign = "left";
  }
}

// ==================== PREVIEW RENDERER ====================
function renderPreview(canvas, pageEvents, cfg) {
  const { colorKey, friDate, size, dates, texture, bgImage, bgOpacity, pageDay, isContinuation, pageIdx, totalPages } = cfg;
  const co = COLORS[colorKey];
  const W = size.w, H = size.h;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const s = W / 1080;
  const px = 40 * s;
  const isLight = co.light;
  const pureHead = isLight ? "#000000" : "#FFFFFF";
  const dayFull = { Fri: "FRIDAY", Sat: "SATURDAY", Sun: "SUNDAY" };
  const dayDate = dates[pageDay] || friDate;

  // === BACKGROUND ===
  if (bgImage) {
    // Photo background with dark overlay
    const imgW = bgImage.width, imgH = bgImage.height;
    const scale = Math.max(W / imgW, H / imgH);
    const dw = imgW * scale, dh = imgH * scale;
    ctx.drawImage(bgImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
    // Dark overlay for readability
    ctx.fillStyle = `rgba(0,0,0,${bgOpacity || 0.90})`;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = co.hex;
    ctx.fillRect(0, 0, W, H);
  }

  // === CGE LETTER TEXTURE ===
  const letters = ["C", "G", "E"];
  const isSmall = texture === "small";
  const isXL = texture === "xlarge";
  const letterSize = isSmall ? (14 * s) : isXL ? (42 * s) : (26 * s);
  const letterSpacingX = isSmall ? (24 * s) : isXL ? (65 * s) : (42 * s);
  const letterSpacingY = isSmall ? (22 * s) : isXL ? (58 * s) : (38 * s);
  const letterColor = bgImage ? "rgba(255,255,255,1)" : (colorKey === "black" ? co.accent : "#000000");
  const letterOpacity = bgImage ? 0.06 : (colorKey === "black" ? 0.14 : (isLight ? 0.16 : 0.18));

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-5 * Math.PI / 180);
  ctx.translate(-W / 2, -H / 2);
  ctx.font = `800 ${letterSize}px 'Syne',sans-serif`;
  ctx.fillStyle = letterColor;
  ctx.globalAlpha = letterOpacity;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const startX = -80 * s, startY = -80 * s, endX = W + 80 * s, endY = H + 80 * s;
  let letterIdx = 0;
  for (let y = startY; y < endY; y += letterSpacingY) {
    const rowOff = (Math.round((y - startY) / letterSpacingY) % 2 === 1) ? letterSpacingX * 0.5 : 0;
    for (let x = startX + rowOff; x < endX; x += letterSpacingX) {
      ctx.fillText(letters[letterIdx % 3], x, y);
      letterIdx++;
    }
  }
  ctx.restore();

  // === SPOTLIGHT ===
  const sR = co.spotR, sG = co.spotG, sB = co.spotB, sA = bgImage ? co.spotA * 0.5 : co.spotA;
  const srcGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 250 * s);
  srcGrad.addColorStop(0, `rgba(${sR},${sG},${sB},${sA})`);
  srcGrad.addColorStop(0.3, `rgba(${sR},${sG},${sB},${sA * 0.45})`);
  srcGrad.addColorStop(0.65, `rgba(${sR},${sG},${sB},${sA * 0.12})`);
  srcGrad.addColorStop(1, "transparent");
  ctx.fillStyle = srcGrad; ctx.fillRect(0, 0, W, H);

  const streakGrad = ctx.createLinearGradient(0, 0, W, H);
  streakGrad.addColorStop(0, `rgba(${sR},${sG},${sB},${sA * 0.30})`);
  streakGrad.addColorStop(0.25, `rgba(${sR},${sG},${sB},${sA * 0.08})`);
  streakGrad.addColorStop(0.5, "transparent");
  streakGrad.addColorStop(0.75, `rgba(${sR},${sG},${sB},${sA * 0.06})`);
  streakGrad.addColorStop(1, `rgba(${sR},${sG},${sB},${sA * 0.22})`);
  ctx.fillStyle = streakGrad; ctx.fillRect(0, 0, W, H);

  const trGlow = ctx.createRadialGradient(W, 0, 0, W, 0, 280 * s);
  trGlow.addColorStop(0, `rgba(${sR},${sG},${sB},${sA * 0.30})`);
  trGlow.addColorStop(0.35, `rgba(${sR},${sG},${sB},${sA * 0.12})`);
  trGlow.addColorStop(1, "transparent");
  ctx.fillStyle = trGlow; ctx.fillRect(0, 0, W, H);

  // === HEADER ===
  const txtColor = bgImage ? "#FFFFFF" : pureHead;
  ctx.textBaseline = "top";
  let evTop;

  if (isContinuation) {
    // Mini header for continuation pages
    const miniH = 70 * s;
    ctx.fillStyle = bgImage ? "rgba(0,0,0,0.35)" : (isLight ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.25)");
    ctx.fillRect(0, 0, W, miniH);
    ctx.fillStyle = bgImage ? "rgba(255,255,255,0.12)" : (isLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.12)");
    ctx.fillRect(px, miniH - 1.5 * s, W - px * 2, 1.5 * s);

    ctx.font = `800 ${32 * s}px 'Syne',sans-serif`;
    ctx.fillStyle = txtColor;
    ctx.textBaseline = "middle";
    ctx.fillText(`${dayFull[pageDay]}  ${dayDate}`, px, miniH / 2);

    if (totalPages > 1) {
      ctx.font = `400 ${18 * s}px 'DM Sans',sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.textAlign = "right";
      ctx.fillText(`${pageIdx + 1}/${totalPages}`, W - px, miniH / 2);
      ctx.textAlign = "left";
    }
    ctx.textBaseline = "top";

    // Region
    const regs = [...new Set(pageEvents.map(e => e.region))];
    if (regs.length === 1) {
      ctx.font = `800 ${30 * s}px 'Syne',sans-serif`;
      ctx.fillStyle = txtColor;
      ctx.textAlign = "center";
      ctx.fillText(regs[0].toUpperCase(), W / 2, miniH + 8 * s);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(px, miniH + 42 * s, W - px * 2, 1 * s);
      evTop = miniH + 50 * s;
    } else {
      evTop = miniH + 10 * s;
    }
  } else {
    // Full header — COMPACT, leaves room for events to fill the page
    ctx.font = `700 ${28 * s}px 'DM Sans',sans-serif`;
    ctx.fillStyle = txtColor;
    ctx.letterSpacing = `${4 * s}px`;
    ctx.fillText("NJ WEEKEND EVENTS", px, 24 * s);
    ctx.letterSpacing = "0px";

    // Auto-fit "THIS WEEKEND"
    let twFS = 80;
    ctx.font = `800 ${twFS * s}px 'Syne',sans-serif`;
    while (ctx.measureText("THIS WEEKEND").width > W - px * 2 && twFS > 40) { twFS -= 2; ctx.font = `800 ${twFS * s}px 'Syne',sans-serif`; }
    ctx.fillStyle = txtColor;
    ctx.fillText("THIS WEEKEND", px, 55 * s);

    ctx.font = `800 ${40 * s}px 'Syne',sans-serif`;
    ctx.fillText(`${dates.Fri} — ${dates.Sun}`, px, 140 * s);

    // Line
    const lineY = 186 * s;
    const lineGrad = ctx.createLinearGradient(px, 0, W - px, 0);
    lineGrad.addColorStop(0, "rgba(255,255,255,0.45)");
    lineGrad.addColorStop(0.5, "rgba(255,255,255,0.12)");
    lineGrad.addColorStop(1, "transparent");
    ctx.fillStyle = lineGrad;
    ctx.fillRect(px, lineY, W - px * 2, 2 * s);

    if (totalPages > 1) {
      ctx.font = `400 ${22 * s}px 'DM Sans',sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.textAlign = "right";
      ctx.fillText(`${pageIdx + 1}/${totalPages}`, W - px, 24 * s);
      ctx.textAlign = "left";
    }

    // Day + region header
    const dayHeaderY = lineY + 8 * s;
    const regs = [...new Set(pageEvents.map(e => e.region))];
    const regionLabel = regs.length === 1 ? ` — ${regs[0].toUpperCase()}` : "";
    ctx.font = `800 ${30 * s}px 'Syne',sans-serif`;
    ctx.fillStyle = txtColor;
    ctx.textAlign = "center";
    ctx.fillText(`${dayFull[pageDay]}${regionLabel}`, W / 2, dayHeaderY + 4 * s);
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(px, dayHeaderY + 38 * s, W - px * 2, 1 * s);

    evTop = dayHeaderY + 46 * s;
  }

  // === TWO-COLUMN EVENT LAYOUT — STRETCHED TO FILL PAGE ===
  const colW = (W - px * 2 - 24 * s) / 2;
  const footerH = 80 * s;
  const availH = H - footerH - 12 * s - evTop;

  // Calculate rows needed (two columns, so rows = ceil(events/2) + region dividers)
  const regs = [...new Set(pageEvents.map(e => e.region))];
  const isMultiReg = regs.length > 1;
  const dividerRows = isMultiReg ? regs.length : 0;
  const eventRows = Math.ceil(pageEvents.length / 2);
  const totalRows = eventRows + dividerRows;
  const rowH = totalRows > 0 ? Math.min(70 * s, Math.max(48 * s, availH / totalRows)) : 56 * s;

  // Scale font sizes based on row height
  const nameFontSize = Math.min(28, Math.max(20, rowH / s * 0.38));
  const venueFontSize = Math.min(22, Math.max(16, rowH / s * 0.28));
  const emojiFontSize = Math.min(28, Math.max(20, rowH / s * 0.36));

  let leftY = evTop;
  let rightY = evTop;
  let lastRegion = null;

  pageEvents.forEach((ev, ei) => {
    // Region divider for multi-region
    if (isMultiReg && ev.region !== lastRegion) {
      const divY = Math.max(leftY, rightY) + 4 * s;
      leftY = divY;
      rightY = divY;
      ctx.font = `800 ${28 * s}px 'Syne',sans-serif`;
      ctx.fillStyle = txtColor;
      ctx.textAlign = "center";
      ctx.fillText(ev.region.toUpperCase(), W / 2, divY + 2 * s);
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(px, divY + 32 * s, W - px * 2, 1 * s);
      leftY = divY + 40 * s;
      rightY = divY + 40 * s;
      lastRegion = ev.region;
    }
    if (!isMultiReg) lastRegion = ev.region;

    const isLeft = (isMultiReg) ? (leftY <= rightY) : (ei % 2 === 0);
    const colX = isLeft ? px : (px + colW + 24 * s);
    const rowY = isLeft ? leftY : rightY;

    // Skip if overlaps footer
    if (rowY + rowH > H - footerH - 6 * s) return;

    // Emoji
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.font = `${emojiFontSize * s}px sans-serif`;
    ctx.textBaseline = "top";
    const emojiY = rowY + (rowH - emojiFontSize * s) / 2.5;
    ctx.fillText(ev.emoji || "", colX, emojiY);
    ctx.restore();
    if (cfg._emojiPositions) cfg._emojiPositions.push({ id: ev.id, x: colX - 5*s, y: emojiY - 5*s, w: emojiFontSize*s + 10*s, h: emojiFontSize*s + 10*s });

    // Event name
    ctx.font = `700 ${nameFontSize * s}px 'DM Sans',sans-serif`;
    ctx.fillStyle = bgImage ? "#FFFFFF" : pureHead;
    ctx.textBaseline = "top";
    let nm = ev.name.toUpperCase();
    const maxNmW = colW - 38 * s;
    if (ctx.measureText(nm).width > maxNmW) {
      while (ctx.measureText(nm + "..").width > maxNmW && nm.length > 0) nm = nm.slice(0, -1);
      nm += "..";
    }
    ctx.fillText(nm, colX + 34 * s, rowY + rowH * 0.12);

    // Venue · City
    ctx.font = `400 ${venueFontSize * s}px 'DM Sans',sans-serif`;
    ctx.fillStyle = bgImage ? "rgba(255,255,255,0.60)" : (isLight ? "rgba(0,0,0,0.50)" : "rgba(255,255,255,0.55)");
    let venueStr = ev.venue || "";
    if (ev.area) venueStr += ` · ${ev.area}`;
    if (ctx.measureText(venueStr).width > maxNmW) {
      while (ctx.measureText(venueStr + "..").width > maxNmW && venueStr.length > 0) venueStr = venueStr.slice(0, -1);
      venueStr += "..";
    }
    ctx.fillText(venueStr, colX + 34 * s, rowY + rowH * 0.55);

    if (isLeft) leftY += rowH;
    else rightY += rowH;
  });

  // === FOOTER ===
  const footerY = H - footerH;
  ctx.fillStyle = bgImage ? "rgba(0,0,0,0.50)" : (isLight ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.30)");
  ctx.fillRect(0, footerY, W, footerH);
  ctx.fillStyle = bgImage ? "rgba(255,255,255,0.12)" : (isLight ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.15)");
  ctx.fillRect(px, footerY, W - px * 2, 1.5 * s);

  ctx.font = `800 ${24 * s}px 'Syne',sans-serif`;
  ctx.fillStyle = bgImage ? "#FFFFFF" : pureHead;
  ctx.textBaseline = "middle";
  ctx.fillText("CENTRAL GROUP EVENTS", px, footerY + footerH / 2);

  ctx.font = `600 ${18 * s}px 'DM Sans',sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.textAlign = "right";
  ctx.fillText("Full calendar Friday", W - px, footerY + footerH / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

// ==================== APP ====================
export default function App() {
  const [events, setEvents] = useState([]);
  const [dayColors, setDayColors] = useState({ Fri: "yellow", Sat: "emerald", Sun: "gold" });
  const [friDate, setFriDate] = useState("4/18");
  const [sz, setSz] = useState("4:5");
  const [texture, setTexture] = useState("large");
  const [mode, setMode] = useState("calendar"); // "calendar" or "preview"
  const [previewColorKey, setPreviewColorKey] = useState("purple");
  const [pg, setPg] = useState(0);
  const [sel, setSel] = useState(new Set());
  const [showEd, setShowEd] = useState(false);
  const [edTxt, setEdTxt] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [nev, setNev] = useState({ day: "Fri", time: "", name: "", venue: "", area: "", region: "North", type: "", featured: false });
  const [bulkReg, setBulkReg] = useState("");
  const [bulkDay, setBulkDay] = useState("");
  const [dismissed, setDismissed] = useState(new Set());
  const canvasRef = useRef(null);
  const fileRef = useRef(null);
  const bgFileRef = useRef(null);
  const [bgImage, setBgImage] = useState(null);
  const [bgOpacity, setBgOpacity] = useState(0.90);
  // Column mapping
  const [rawRows, setRawRows] = useState(null);
  const [colHeaders, setColHeaders] = useState([]);
  const [colMap, setColMap] = useState({ date: "", day: "", time: "", name: "", venue: "", area: "", region: "", type: "" });
  const [showMapping, setShowMapping] = useState(false);
  const COL_FIELDS = [
    { key: "date", label: "Date", required: false },
    { key: "day", label: "Day", required: false },
    { key: "time", label: "Time", required: false },
    { key: "name", label: "Event Name", required: true },
    { key: "venue", label: "Venue", required: false },
    { key: "area", label: "City", required: false },
    { key: "region", label: "Region", required: false },
    { key: "type", label: "Event Type", required: false },
  ];
  // Emoji picker
  const [emojiPickId, setEmojiPickId] = useState(null);
  const [emojiPickPos, setEmojiPickPos] = useState({ x: 0, y: 0 });
  const emojiPositionsRef = useRef([]);
  const ALL_EMOJIS = ["🎧","💃","🥂","🎭","🎨","🎤","🛍️","🍷","💪","🎬","😂","🎪","🎲","🤝",""];
  const [listFilter, setListFilter] = useState("all"); // "all" | "flagged"
  const eventRefs = useRef({});

  // Find partner events for a flag group
  const findFlagPartners = (evId, flagMsg) => {
    const match = flagMsg.match(/#(\d+)/);
    if (!match) return [];
    const groupNum = match[1];
    return Object.entries(warnings).filter(([id, ws]) => 
      String(id) !== String(evId) && ws.some(w => w.msg.includes(`#${groupNum}`) && w.msg.startsWith(flagMsg.replace(/#\d+/, "").trim()))
    ).map(([id]) => Number(id) || id);
  };

  const scrollToEvent = (targetId) => {
    const el = eventRefs.current[targetId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.transition = "background 0.3s";
      el.style.background = "rgba(250,204,21,0.20)";
      setTimeout(() => { el.style.background = ""; }, 1500);
    }
  };

  const handleCanvasClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const hit = emojiPositionsRef.current.find(p => cx >= p.x && cx <= p.x + p.w && cy >= p.y && cy <= p.y + p.h);
    if (hit) {
      setEmojiPickId(hit.id);
      setEmojiPickPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    } else {
      setEmojiPickId(null);
    }
  };

  const maxFirst = MAX_FIRST[sz];
  const maxCont = MAX_CONT[sz];
  const dates = calcDates(friDate);
  const sorted = sortEv(events);

  // === VALIDATION: duplicates + missing fields + venue conflicts ===
  const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const warnings = {};
  let flagGroup = 1;

  // Check missing fields
  events.forEach(ev => {
    const w = [];
    if (!ev.name || !ev.name.trim()) w.push({ type: "red", msg: "NO NAME" });
    if (!ev.day) w.push({ type: "red", msg: "NO DAY" });
    if (!ev.time || !ev.time.trim()) w.push({ type: "yellow", msg: "NO TIME" });
    if (!ev.venue || !ev.venue.trim()) w.push({ type: "yellow", msg: "NO VENUE" });
    if (!ev.region) w.push({ type: "yellow", msg: "NO REGION" });
    if (!ev.area || !ev.area.trim()) w.push({ type: "gray", msg: "NO CITY" });
    if (!ev.type || !ev.type.trim()) w.push({ type: "gray", msg: "NO TYPE" });
    if (w.length > 0) warnings[ev.id] = w;
  });

  // Check exact name+day duplicates
  const seenNameDay = {};
  events.forEach(ev => {
    const key = normalize(ev.name) + "|" + (ev.day || "");
    if (!key || key === "|" || !normalize(ev.name)) return;
    if (seenNameDay[key]) {
      if (!seenNameDay[key].group) { seenNameDay[key].group = flagGroup++; }
      const g = seenNameDay[key].group;
      seenNameDay[key].ids.push(ev.id);
      // Flag all in group
      seenNameDay[key].ids.forEach(id => {
        if (!warnings[id]) warnings[id] = [];
        if (!warnings[id].some(w => w.msg.startsWith("DUPE"))) warnings[id].push({ type: "yellow", msg: `DUPE #${g}` });
      });
    } else {
      seenNameDay[key] = { ids: [ev.id], group: null };
    }
  });

  // Check same venue + same day (different events at same location)
  const seenVenueDay = {};
  events.forEach(ev => {
    if (!ev.venue || !ev.venue.trim()) return;
    const key = normalize(ev.venue) + "|" + (ev.day || "");
    if (seenVenueDay[key]) {
      if (!seenVenueDay[key].group) { seenVenueDay[key].group = flagGroup++; }
      const g = seenVenueDay[key].group;
      seenVenueDay[key].ids.push(ev.id);
      seenVenueDay[key].ids.forEach(id => {
        if (!warnings[id]) warnings[id] = [];
        if (!warnings[id].some(w => w.msg.startsWith("VENUE"))) warnings[id].push({ type: "gray", msg: `VENUE #${g}` });
      });
    } else {
      seenVenueDay[key] = { ids: [ev.id], group: null };
    }
  });

  // Check same event across different days (same name+venue+time, different day)
  const seenCrossDay = {};
  events.forEach(ev => {
    if (!ev.name || !ev.venue) return;
    const key = normalize(ev.name) + "|" + normalize(ev.venue) + "|" + normalize(ev.time);
    if (seenCrossDay[key]) {
      if (!seenCrossDay[key].group) { seenCrossDay[key].group = flagGroup++; }
      const g = seenCrossDay[key].group;
      seenCrossDay[key].ids.push(ev.id);
      seenCrossDay[key].ids.forEach(id => {
        if (!warnings[id]) warnings[id] = [];
        if (!warnings[id].some(w => w.msg.startsWith("MULTI"))) warnings[id].push({ type: "yellow", msg: `MULTI #${g}` });
      });
    } else {
      seenCrossDay[key] = { ids: [ev.id], group: null };
    }
  });

  // Check event name contains a day that doesn't match its assigned day
  const dayNames = { "friday": "Fri", "fridays": "Fri", "saturday": "Sat", "saturdays": "Sat", "sunday": "Sun", "sundays": "Sun" };
  events.forEach(ev => {
    if (!ev.name) return;
    const nameLower = ev.name.toLowerCase();
    for (const [dayWord, dayAbbr] of Object.entries(dayNames)) {
      if (nameLower.includes(dayWord) && ev.day !== dayAbbr) {
        if (!warnings[ev.id]) warnings[ev.id] = [];
        warnings[ev.id].push({ type: "yellow", msg: `WRONG DAY?` });
        break;
      }
    }
  });

  // Count active (non-dismissed) warnings
  const activeWarnings = Object.entries(warnings).filter(([id]) => !dismissed.has(Number(id) || id));
  const redCount = activeWarnings.filter(([, ws]) => ws.some(w => w.type === "red")).length;
  const yellowCount = activeWarnings.filter(([, ws]) => ws.some(w => w.type === "yellow") && !ws.some(w => w.type === "red")).length;
  const dupeCount = activeWarnings.filter(([, ws]) => ws.some(w => w.msg.startsWith("DUPE"))).length;
  const totalWarnings = activeWarnings.length;

  // Smart page builder — first page gets full header, continuation pages get mini header with more events
  // Region orphan protection: if a region header + ≤1 event would be alone at page bottom, push to next page
  const preventOrphan = (evts, sliceEnd) => {
    if (sliceEnd >= evts.length || sliceEnd <= 2) return sliceEnd;
    // Check if last 1-2 events on this page start a new region
    const lastEv = evts[sliceEnd - 1];
    const prevEv = evts[sliceEnd - 2];
    if (lastEv && prevEv && lastEv.region !== prevEv.region) {
      // Last event is alone in its region on this page — push it to next
      return sliceEnd - 1;
    }
    // Check if last 2 events are a new region with only 2 events
    if (sliceEnd >= 3) {
      const ev3 = evts[sliceEnd - 3];
      if (lastEv && prevEv && ev3 && lastEv.region === prevEv.region && prevEv.region !== ev3.region) {
        // Only 2 events from a new region at bottom — check if more follow on next page
        if (sliceEnd < evts.length && evts[sliceEnd]?.region === lastEv.region) {
          return sliceEnd - 2; // push both to keep region together
        }
      }
    }
    return sliceEnd;
  };

  const buildCalPages = () => {
    if (sorted.length === 0) return [{ day: "Fri", events: [], isContinuation: false }];
    const dayGroups = {};
    sorted.forEach(ev => {
      if (!dayGroups[ev.day]) dayGroups[ev.day] = [];
      dayGroups[ev.day].push(ev);
    });
    const pageList = [];
    ["Fri", "Sat", "Sun"].forEach(d => {
      if (!dayGroups[d]) return;
      const evts = dayGroups[d];
      const regions = [...new Set(evts.map(e => e.region))];
      const numDividers = regions.length > 1 ? regions.length : 0;
      const divCost = Math.ceil(numDividers * 0.6);
      const firstMax = maxFirst;
      const contMax = maxCont;
      const adjustedFirst = preventOrphan(evts, firstMax);
      const firstSlice = evts.slice(0, adjustedFirst);
      pageList.push({ day: d, events: firstSlice, isContinuation: false });
      let offset = adjustedFirst;
      while (offset < evts.length) {
        const end = Math.min(offset + contMax, evts.length);
        const adjustedEnd = preventOrphan(evts, end);
        const slice = evts.slice(offset, adjustedEnd);
        pageList.push({ day: d, events: slice, isContinuation: true });
        offset = adjustedEnd;
      }
    });
    return pageList.length > 0 ? pageList : [{ day: "Fri", events: [], isContinuation: false }];
  };

  // Preview page builder — two-column layout, per-day, ~20 first / ~24 continuation
  const PREVIEW_FIRST = 18;
  const PREVIEW_CONT = 24;
  const buildPreviewPages = () => {
    if (sorted.length === 0) return [{ day: "Fri", events: [], isContinuation: false }];
    const dayGroups = {};
    sorted.forEach(ev => {
      if (!dayGroups[ev.day]) dayGroups[ev.day] = [];
      dayGroups[ev.day].push(ev);
    });
    const pageList = [];
    ["Fri", "Sat", "Sun"].forEach(d => {
      if (!dayGroups[d]) return;
      const evts = dayGroups[d];
      const regions = [...new Set(evts.map(e => e.region))];
      const numDividers = regions.length > 1 ? regions.length : 0;
      const divCost = Math.ceil(numDividers * 1.5); // dividers cost more in two-column
      const firstMax = Math.max(6, PREVIEW_FIRST - divCost);
      const contMax = Math.max(10, PREVIEW_CONT - divCost);
      const adjustedFirst = preventOrphan(evts, firstMax);
      const firstSlice = evts.slice(0, adjustedFirst);
      pageList.push({ day: d, events: firstSlice, isContinuation: false });
      let offset = adjustedFirst;
      while (offset < evts.length) {
        const end = Math.min(offset + contMax, evts.length);
        const adjustedEnd = preventOrphan(evts, end);
        const slice = evts.slice(offset, adjustedEnd);
        pageList.push({ day: d, events: slice, isContinuation: true });
        offset = adjustedEnd;
      }
    });
    return pageList.length > 0 ? pageList : [{ day: "Fri", events: [], isContinuation: false }];
  };

  const allPages = mode === "preview" ? buildPreviewPages() : buildCalPages();
  const pages = allPages.length;
  const safePg = Math.min(pg, pages - 1);
  const pgEvts = allPages[safePg]?.events || [];
  const pgDay = allPages[safePg]?.day || "Fri";
  const activeColor = dayColors[pgDay] || "purple";
  const previewColor = previewColorKey;
  const co = mode === "preview" ? COLORS[previewColor] : COLORS[activeColor];

  const pgIsCont = allPages[safePg]?.isContinuation || false;

  const render = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const positions = [];
    if (mode === "preview") {
      renderPreview(cv, pgEvts, { colorKey: previewColor, friDate, size: SIZES[sz], dates, texture, bgImage, bgOpacity, pageDay: pgDay, isContinuation: pgIsCont, pageIdx: safePg, totalPages: pages, _emojiPositions: positions });
    } else {
      renderCal(cv, pgEvts, { colorKey: activeColor, friDate, size: SIZES[sz], pageIdx: safePg, totalPages: pages, dates, texture, isContinuation: pgIsCont, _emojiPositions: positions });
    }
    emojiPositionsRef.current = positions;
  }, [pgEvts, activeColor, previewColor, friDate, sz, safePg, pages, dates, texture, pgIsCont, mode, bgImage, bgOpacity, pgDay]);

  useEffect(() => { const t = setTimeout(render, 60); return () => clearTimeout(t); }, [render]);

  const addEv = () => {
    if (!nev.time || !nev.name) return;
    const emoji = getEmoji(nev.type);
    if (editId !== null) { setEvents(p => p.map(e => e.id === editId ? { ...nev, emoji, id: editId } : e)); setEditId(null); }
    else { setEvents(p => [...p, { ...nev, emoji, id: Date.now() }]); }
    setNev({ day: nev.day, time: "", name: "", venue: "", area: "", region: nev.region, type: "", featured: false });
    setShowAdd(false);
  };

  const importLines = (text) => {
    const lines = text.split("\n").filter(l => l.trim() && !l.startsWith("#"));
    if (lines.length === 0) return [];
    const rows = lines.map(l => parseLine(l));
    return parseStructuredRows(rows, "North");
  };

  const handleEdImport = () => { setEvents(p => [...p, ...importLines(edTxt)]); setShowEd(false); setEdTxt(""); setDismissed(new Set()); };

  const loadRows = (rows) => {
    if (!rows || !rows.length) return;
    const hdrs = rows[0].map(c => String(c ?? "").trim());
    setRawRows(rows);
    setColHeaders(hdrs);
    const auto = matchColumns(hdrs);
    const newMap = { date: "", day: "", time: "", name: "", venue: "", area: "", region: "", type: "" };
    Object.entries(auto).forEach(([field, idx]) => { if (field !== "_ignore" && field in newMap) newMap[field] = String(idx); });
    setColMap(newMap);
    setShowMapping(true);
  };

  const applyMapping = () => {
    if (!rawRows || !rawRows.length) return;
    const fm = {};
    Object.entries(colMap).forEach(([field, idx]) => { if (idx !== "" && idx !== "-1") fm[field] = parseInt(idx); });
    if (!("name" in fm)) { alert("Please select which column is the Event Name."); return; }
    const dataRows = rawRows.slice(1);
    const hasDateCol = "date" in fm, hasDayCol = "day" in fm;
    const parsed = dataRows.filter(r => r && r.some(c => c != null && String(c).trim() !== "")).map(r => {
      const g = f => (f in fm && fm[f] < r.length) ? String(r[fm[f]] ?? "").replace(/^["']+|["']+$/g, "").trim() : "";
      let day = null;
      if (hasDayCol) day = parseDay(g("day"));
      if (!day && hasDateCol) { const di = parseDateToDay(g("date")); if (di) day = di.day; }
      if (!day) day = "Fri";
      const type = g("type"), region = parseRegion(g("region")) || "North";
      return { id: Date.now() + Math.random() * 100000, day, time: formatTime(g("time")), name: g("name"), venue: g("venue"), area: g("area"), region, type, emoji: getEmoji(type), featured: false };
    }).filter(e => e.name && e.day !== null);
    if (parsed.length === 0) { alert("No valid events found with this mapping."); return; }
    setEvents(p => [...p, ...parsed]);
    setDismissed(new Set());
    setShowMapping(false);
    // Auto-detect Friday date
    if (hasDateCol) {
      for (const r of dataRows) {
        const dv = r[fm.date];
        if (dv) { const info = parseDateToDay(String(dv).replace(/^["']+|["']+$/g, "").trim()); if (info && info.day === "Fri") { setFriDate(info.date); break; } }
      }
    }
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
          loadRows(rows);
        } catch (err) { alert("Error reading file: " + err.message); }
      };
      reader.readAsArrayBuffer(f);
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const lines = ev.target.result.split("\n").filter(l => l.trim());
        const rows = lines.map(l => l.includes("\t") ? l.split("\t").map(s => s.trim()) : l.split(",").map(s => s.trim()));
        loadRows(rows);
      };
      reader.readAsText(f);
    }
    e.target.value = "";
  };

  const bulkEdit = () => {
    if (sel.size === 0) return;
    setEvents(p => p.map(e => {
      if (!sel.has(e.id)) return e;
      const u = { ...e };
      if (bulkReg) u.region = bulkReg;
      if (bulkDay) u.day = bulkDay;
      return u;
    }));
    setSel(new Set()); setBulkReg(""); setBulkDay("");
  };

  const handleBgUpload = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => setBgImage(img);
      img.onerror = () => alert("Could not load image");
      img.src = ev.target.result;
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const dl = (pi) => {
    const cv = document.createElement("canvas");
    const pd = allPages[pi];
    if (!pd) return;
    if (mode === "preview") {
      renderPreview(cv, pd.events, { colorKey: previewColor, friDate, size: SIZES[sz], dates, texture, bgImage, bgOpacity, pageDay: pd.day, isContinuation: pd.isContinuation, pageIdx: pi, totalPages: pages });
    } else {
      const dayColor = dayColors[pd.day] || "purple";
      renderCal(cv, pd.events, { colorKey: dayColor, friDate, size: SIZES[sz], pageIdx: pi, totalPages: pages, dates, texture, isContinuation: pd.isContinuation });
    }
    cv.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const prefix = mode === "preview" ? "CGE_Preview" : "CGE";
      a.download = `${prefix}_${pd.day}_${friDate.replace("/", "-")}_P${pi + 1}.png`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const dlAll = async () => {
    const files = [];
    for (let i = 0; i < pages; i++) {
      const cv = document.createElement("canvas");
      const pd = allPages[i];
      if (!pd) continue;
      if (mode === "preview") {
        renderPreview(cv, pd.events, { colorKey: previewColor, friDate, size: SIZES[sz], dates, texture, bgImage, bgOpacity, pageDay: pd.day, isContinuation: pd.isContinuation, pageIdx: i, totalPages: pages });
      } else {
        const dayColor = dayColors[pd.day] || "purple";
        renderCal(cv, pd.events, { colorKey: dayColor, friDate, size: SIZES[sz], pageIdx: i, totalPages: pages, dates, texture, isContinuation: pd.isContinuation });
      }
      const blob = await new Promise(res => cv.toBlob(res, "image/png"));
      const prefix = mode === "preview" ? "CGE_Preview" : "CGE";
      files.push({ name: `${prefix}_${pd.day}_${friDate.replace("/", "-")}_P${i + 1}.png`, blob });
    }
    // Build zip
    const zipParts = []; const centralDir = []; let offset = 0;
    for (const file of files) {
      const buf = await file.blob.arrayBuffer(); const data = new Uint8Array(buf); const nameBytes = new TextEncoder().encode(file.name);
      const lh = new Uint8Array(30 + nameBytes.length); const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true);
      let crc = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) { crc ^= data[i]; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0); } crc ^= 0xFFFFFFFF;
      lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true); lh.set(nameBytes, 30);
      const cd = new Uint8Array(46 + nameBytes.length); const cv2 = new DataView(cd.buffer);
      cv2.setUint32(0, 0x02014b50, true); cv2.setUint16(4, 20, true); cv2.setUint16(6, 20, true); cv2.setUint32(16, crc, true); cv2.setUint32(20, data.length, true); cv2.setUint32(24, data.length, true); cv2.setUint16(28, nameBytes.length, true); cv2.setUint32(42, offset, true); cd.set(nameBytes, 46);
      centralDir.push(cd); zipParts.push(lh); zipParts.push(data); offset += lh.length + data.length;
    }
    const cdOffset = offset; let cdSize = 0; centralDir.forEach(cd => { zipParts.push(cd); cdSize += cd.length; });
    const eocd = new Uint8Array(22); const ev2 = new DataView(eocd.buffer);
    ev2.setUint32(0, 0x06054b50, true); ev2.setUint16(8, files.length, true); ev2.setUint16(10, files.length, true); ev2.setUint32(12, cdSize, true); ev2.setUint32(16, cdOffset, true);
    zipParts.push(eocd);
    const zipBlob = new Blob(zipParts, { type: "application/zip" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.download = `CGE_Weekend_${friDate.replace("/", "-")}.zip`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const si = SIZES[sz]; const pw = 390, ph = pw / (si.w / si.h);
  const dayFull = { Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;900&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.25rem" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase" }}>CGE Calendar Builder</h1>
          <span style={{ fontSize: "0.6rem", color: co.accent, letterSpacing: "1.5px", textTransform: "uppercase", padding: "2px 8px", border: `1px solid rgba(255,255,255,0.08)`, borderRadius: "14px" }}>V6 · {events.length} events · {pages} pg</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 410px", gap: "1.5rem", alignItems: "start" }}>
          {/* LEFT PANEL */}
          <div>
            {/* Mode toggle */}
            <div style={{ marginBottom: "0.6rem" }}>
              <label style={L}>Mode</label>
              <div style={{ display: "flex", gap: "0.25rem" }}>
                {[["calendar", "Full Calendar"], ["preview", "Week Preview"]].map(([val, label]) => (
                  <button key={val} onClick={() => { setMode(val); setPg(0); }} style={{
                    padding: "5px 14px", borderRadius: "5px", fontSize: "0.68rem", cursor: "pointer", fontWeight: 600,
                    border: mode === val ? `2px solid #FACC15` : "2px solid rgba(245,240,232,0.06)",
                    background: mode === val ? "rgba(250,204,21,0.12)" : "transparent",
                    color: mode === val ? "#FACC15" : "rgba(245,240,232,0.25)",
                  }}>{label}</button>
                ))}
              </div>
            </div>

            {/* Friday date */}
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "0.4rem", marginBottom: "0.5rem" }}>
              <div>
                <label style={L}>Friday Date</label>
                <input value={friDate} onChange={e => setFriDate(e.target.value)} style={I} placeholder="4/18" />
              </div>
              <div>
                <label style={L}>Weekend Range</label>
                <div style={{ padding: "5px 7px", background: "#111", borderRadius: "4px", fontSize: "0.7rem", color: "rgba(245,240,232,0.4)", border: "1px solid rgba(245,240,232,0.04)" }}>
                  Fri {dates.Fri} → Sat {dates.Sat} → Sun {dates.Sun}
                </div>
              </div>
            </div>

            {/* Color selection — per-day for calendar, single for preview */}
            <div style={{ marginBottom: "0.6rem" }}>
              {mode === "preview" ? (
                <>
                  <label style={L}>Preview color</label>
                  <div style={{ display: "flex", gap: "3px", alignItems: "center" }}>
                    {Object.entries(COLORS).map(([k, v]) => (
                      <button key={k} onClick={() => setPreviewColorKey(k)} style={{
                        width: 28, height: 28, borderRadius: "5px", cursor: "pointer",
                        background: v.hex, border: previewColorKey === k ? "2px solid #FFFFFF" : "2px solid transparent",
                        boxShadow: previewColorKey === k ? "0 0 6px rgba(255,255,255,0.3)" : "none",
                      }} title={v.name} />
                    ))}
                    <span style={{ width: 1, height: 20, background: "rgba(255,255,255,0.08)", margin: "0 4px" }}></span>
                    <button onClick={() => bgFileRef.current?.click()} style={{ ...B, fontSize: "0.55rem", padding: "4px 8px" }}>{bgImage ? "Change Photo" : "Add Photo BG"}</button>
                    {bgImage && <button onClick={() => setBgImage(null)} style={{ ...B, fontSize: "0.55rem", padding: "4px 6px", color: "rgba(251,113,133,0.5)" }}>×</button>}
                    <input ref={bgFileRef} type="file" accept="image/*" onChange={handleBgUpload} style={{ display: "none" }} />
                  </div>
                  {bgImage && <p style={{ fontSize: "0.5rem", color: "rgba(250,204,21,0.4)", margin: "3px 0 0" }}>Photo background active — overlay: {Math.round(bgOpacity * 100)}%</p>}
                  {bgImage && <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "3px" }}>
                    <span style={{ fontSize: "0.45rem", color: "rgba(245,240,232,0.3)" }}>85%</span>
                    <input type="range" min="0.60" max="1.0" step="0.01" value={bgOpacity} onChange={e => setBgOpacity(parseFloat(e.target.value))} style={{ flex: 1, accentColor: "#FACC15" }} />
                    <span style={{ fontSize: "0.45rem", color: "rgba(245,240,232,0.3)" }}>100%</span>
                  </div>}
                </>
              ) : (
                <>
                  <label style={L}>Color per day</label>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    {WEEKDAYS.map(d => (
                      <div key={d} style={{ flex: 1 }}>
                        <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.3)", marginBottom: "3px", fontWeight: 600 }}>{dayFull[d]}</div>
                        <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
                          {Object.entries(COLORS).map(([k, v]) => (
                            <button key={k} onClick={() => { setDayColors(p => ({ ...p, [d]: k })); }} style={{
                              width: 22, height: 22, borderRadius: "4px", cursor: "pointer",
                              background: v.hex, border: dayColors[d] === k ? "2px solid #FFFFFF" : "2px solid transparent",
                              boxShadow: dayColors[d] === k ? "0 0 6px rgba(255,255,255,0.3)" : "none",
                            }} title={v.name} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Size + Texture */}
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.6rem", alignItems: "end" }}>
              <div>
                <label style={L}>Size</label>
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  {Object.keys(SIZES).map(s2 => (
                    <button key={s2} onClick={() => { setSz(s2); setPg(0); }} style={{
                      padding: "4px 10px", borderRadius: "5px", fontSize: "0.63rem", cursor: "pointer",
                      border: sz === s2 ? `2px solid ${co.accent}` : "2px solid rgba(245,240,232,0.06)",
                      background: sz === s2 ? "rgba(255,255,255,0.06)" : "transparent", color: sz === s2 ? co.accent : "rgba(245,240,232,0.25)",
                    }}>{s2}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={L}>Texture</label>
                <div style={{ display: "flex", gap: "0.25rem" }}>
                  {[["small", "Small"], ["large", "Large"], ["xlarge", "XL"]].map(([val, label]) => (
                    <button key={val} onClick={() => setTexture(val)} style={{
                      padding: "4px 10px", borderRadius: "5px", fontSize: "0.63rem", cursor: "pointer",
                      border: texture === val ? `2px solid ${co.accent}` : "2px solid rgba(245,240,232,0.06)",
                      background: texture === val ? "rgba(255,255,255,0.06)" : "transparent", color: texture === val ? co.accent : "rgba(245,240,232,0.25)",
                    }}>{label}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Toolbar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem", flexWrap: "wrap", gap: "0.2rem" }}>
              <span style={{ ...L, marginBottom: 0 }}>Events ({events.length}){sel.size > 0 ? ` · ${sel.size} sel` : ""}</span>
              <div style={{ display: "flex", gap: "0.2rem", flexWrap: "wrap" }}>
                <button onClick={() => setSel(sel.size === events.length && events.length > 0 ? new Set() : new Set(events.map(e => e.id)))} style={B}>{sel.size === events.length && events.length > 0 ? "Deselect" : "Sel All"}</button>
                <button onClick={() => setShowEd(!showEd)} style={B}>Bulk Editor</button>
                <button onClick={() => fileRef.current?.click()} style={B}>Upload File</button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
                <button onClick={() => { setEditId(null); setNev({ day: "Fri", time: "", name: "", venue: "", area: "", region: "North", type: "", featured: false }); setShowAdd(!showAdd); }} style={{ ...B, background: "rgba(250,204,21,0.15)", color: "#FACC15" }}>+ Add</button>
              </div>
            </div>

            {/* Column mapping */}
            {showMapping && colHeaders.length > 0 && (
              <div style={{ padding: "0.5rem", background: "rgba(250,204,21,0.04)", border: "1px solid rgba(250,204,21,0.12)", borderRadius: "6px", marginBottom: "0.4rem" }}>
                <p style={{ fontSize: "0.58rem", fontWeight: 700, color: "#FACC15", margin: "0 0 6px" }}>Map your columns</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "5px" }}>
                  {COL_FIELDS.map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: "0.42rem", color: "rgba(245,240,232,0.3)", display: "block", marginBottom: "2px" }}>
                        {f.label} {f.required && <span style={{ color: "#FB7185" }}>*</span>}
                      </label>
                      <select value={colMap[f.key]} onChange={e => setColMap(prev => ({ ...prev, [f.key]: e.target.value }))} style={{ ...I, fontSize: "0.55rem", padding: "3px 4px" }}>
                        <option value="">— skip —</option>
                        {colHeaders.map((h, i) => <option key={i} value={String(i)}>{h || `Col ${i+1}`}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {/* Preview first 3 rows */}
                {rawRows && rawRows.length > 1 && (
                  <div style={{ marginTop: "6px", padding: "6px", background: "rgba(0,0,0,0.3)", borderRadius: "4px", maxHeight: 100, overflowY: "auto" }}>
                    <p style={{ fontSize: "0.42rem", color: "rgba(245,240,232,0.25)", margin: "0 0 4px", letterSpacing: "1px" }}>PREVIEW — FIRST {Math.min(3, rawRows.length - 1)} EVENTS</p>
                    {rawRows.slice(1, 4).map((row, ri) => {
                      const mapped = COL_FIELDS.filter(f => colMap[f.key] !== "" && colMap[f.key] !== "-1").map(f => {
                        const idx = parseInt(colMap[f.key]);
                        const val = row?.[idx] ?? "";
                        return { label: f.label, val: String(val).replace(/^["']+|["']+$/g, "").trim().slice(0, 25) };
                      });
                      return (
                        <div key={ri} style={{ fontSize: "0.45rem", color: "rgba(245,240,232,0.45)", lineHeight: 1.5, borderBottom: ri < 2 ? "1px solid rgba(245,240,232,0.06)" : "none", paddingBottom: "3px", marginBottom: "3px" }}>
                          {mapped.map((m, mi) => <span key={mi} style={{ marginRight: "6px" }}><strong style={{ color: "rgba(250,204,21,0.5)" }}>{m.label}:</strong> {m.val || "—"}</span>)}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: "flex", gap: "0.3rem", marginTop: "6px" }}>
                  <button onClick={applyMapping} style={{ ...B, flex: 1, background: "#FACC15", color: "#000", fontWeight: 700 }}>Apply & Import</button>
                  <button onClick={() => setShowMapping(false)} style={B}>Cancel</button>
                </div>
              </div>
            )}
            {sel.size > 0 && (
              <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.4rem", padding: "0.4rem", background: "#1A1A1A", borderRadius: "5px", border: "1px solid rgba(255,255,255,0.06)", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.58rem", color: "rgba(245,240,232,0.3)" }}>Bulk ({sel.size}):</span>
                <select value={bulkDay} onChange={e => setBulkDay(e.target.value)} style={{ ...I, width: 65 }}>
                  <option value="">Day...</option>
                  {WEEKDAYS.map(d => <option key={d}>{d}</option>)}
                </select>
                <select value={bulkReg} onChange={e => setBulkReg(e.target.value)} style={{ ...I, width: 80 }}>
                  <option value="">Region...</option>
                  {REGIONS.map(r => <option key={r}>{r}</option>)}
                </select>
                <button onClick={bulkEdit} disabled={!bulkReg && !bulkDay} style={{ ...B, opacity: (bulkReg || bulkDay) ? 1 : 0.3 }}>Apply</button>
                <button onClick={() => { setEvents(p => p.filter(e => !sel.has(e.id))); setSel(new Set()); }} style={{ ...B, background: "rgba(196,115,110,0.12)", color: "#FB7185" }}>Delete</button>
              </div>
            )}

            {/* Bulk editor */}
            {showEd && (
              <div style={{ marginBottom: "0.4rem", padding: "0.6rem", background: "#1A1A1A", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ background: "#0d0d0d", borderRadius: "4px", padding: "0.4rem", marginBottom: "0.3rem", fontSize: "0.55rem", color: "rgba(245,240,232,0.2)", lineHeight: 1.8, fontFamily: "monospace" }}>
                  <strong style={{ color: "#FACC15" }}>Paste from Excel or type manually.</strong> Columns auto-detected by header.<br />
                  <strong style={{ color: "#FACC15" }}>Headers:</strong> Day · Time · Name · Venue · Area · Region · Type/Category<br />
                  Type column auto-maps to emoji categories (🎧🥂🎭🍷💪🎬😂🎪🎲🤝)
                </div>
                <textarea value={edTxt} onChange={e => setEdTxt(e.target.value)} placeholder={"Paste from Excel or type:\nFri, 7 PM, Jazz Night, Blue Note, Newark, North, Live Music"} style={{ ...I, height: 130, resize: "vertical", fontFamily: "monospace", fontSize: "0.63rem", lineHeight: 1.7 }} />
                <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.3rem" }}>
                  <button onClick={handleEdImport} style={{ ...B, background: "#FACC15", color: "#000", fontWeight: 700 }}>Import</button>
                  <button onClick={() => { setShowEd(false); setEdTxt(""); }} style={B}>Cancel</button>
                </div>
              </div>
            )}

            {/* Add form */}
            {showAdd && (
              <div style={{ marginBottom: "0.4rem", padding: "0.5rem", background: "#1A1A1A", borderRadius: "5px", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "50px 58px 1fr 1fr 70px 70px 85px", gap: "0.25rem", marginBottom: "0.3rem" }}>
                  <select value={nev.day} onChange={e => setNev({ ...nev, day: e.target.value })} style={I}>{WEEKDAYS.map(d => <option key={d}>{d}</option>)}</select>
                  <input value={nev.time} onChange={e => setNev({ ...nev, time: e.target.value })} placeholder="7 PM" style={I} />
                  <input value={nev.name} onChange={e => setNev({ ...nev, name: e.target.value })} placeholder="Event Name" style={I} />
                  <input value={nev.venue} onChange={e => setNev({ ...nev, venue: e.target.value })} placeholder="Venue" style={I} />
                  <input value={nev.area} onChange={e => setNev({ ...nev, area: e.target.value })} placeholder="City" style={I} />
                  <select value={nev.region} onChange={e => setNev({ ...nev, region: e.target.value })} style={I}>{REGIONS.map(r => <option key={r}>{r}</option>)}</select>
                  <input value={nev.type} onChange={e => setNev({ ...nev, type: e.target.value })} placeholder="Type" style={I} />
                </div>
                <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                  <label style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}><input type="checkbox" checked={nev.featured} onChange={e => setNev({ ...nev, featured: e.target.checked })} /> CGE Pick</label>
                  <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.2)" }}>Emoji: {getEmoji(nev.type)}</span>
                  <button onClick={addEv} style={{ ...B, background: "#FACC15", color: "#000", fontWeight: 700 }}>{editId ? "Update" : "Add"}</button>
                  <button onClick={() => { setShowAdd(false); setEditId(null); }} style={B}>Cancel</button>
                </div>
              </div>
            )}

            {/* Warning banner */}
            {events.length > 0 && totalWarnings > 0 && (
              <div style={{ padding: "6px 10px", background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.12)", borderRadius: "5px", marginBottom: "0.4rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "0.55rem" }}>
                  {redCount > 0 && <span style={{ color: "#FB7185", fontWeight: 700 }}>{redCount} missing critical</span>}
                  {yellowCount > 0 && <span style={{ color: "#FACC15", fontWeight: 700 }}>{yellowCount} missing fields</span>}
                  {dupeCount > 0 && <span style={{ color: "#FBBF24", fontWeight: 700 }}>{dupeCount} dupe{dupeCount > 1 ? "s" : ""}</span>}
                  {(() => { const vc = activeWarnings.filter(([,ws]) => ws.some(w => w.msg.startsWith("VENUE"))).length; return vc > 0 ? <span style={{ color: "rgba(245,240,232,0.4)", fontWeight: 700 }}>{vc} same venue</span> : null; })()}
                  {(() => { const mc = activeWarnings.filter(([,ws]) => ws.some(w => w.msg.startsWith("MULTI"))).length; return mc > 0 ? <span style={{ color: "#C084FC", fontWeight: 700 }}>{mc} multi-day</span> : null; })()}
                  {(() => { const wc = activeWarnings.filter(([,ws]) => ws.some(w => w.msg === "WRONG DAY?")).length; return wc > 0 ? <span style={{ color: "#FB923C", fontWeight: 700 }}>{wc} wrong day?</span> : null; })()}
                </div>
                <button onClick={() => setDismissed(new Set(Object.keys(warnings).map(k => Number(k) || k)))} style={{ ...B, fontSize: "0.5rem", padding: "2px 8px" }}>Dismiss all</button>
              </div>
            )}

            {/* Event list filter toggle */}
            {events.length > 0 && (
              <div style={{ display: "flex", gap: "3px", marginBottom: "0.3rem" }}>
                <button onClick={() => setListFilter("all")} style={{ ...B, flex: 1, fontSize: "0.55rem", background: listFilter === "all" ? "rgba(250,204,21,0.12)" : "rgba(245,240,232,0.04)", color: listFilter === "all" ? "#FACC15" : "rgba(245,240,232,0.25)", border: listFilter === "all" ? "1px solid rgba(250,204,21,0.20)" : "1px solid rgba(245,240,232,0.04)" }}>All ({sorted.length})</button>
                <button onClick={() => setListFilter("flagged")} style={{ ...B, flex: 1, fontSize: "0.55rem", background: listFilter === "flagged" ? "rgba(251,113,133,0.12)" : "rgba(245,240,232,0.04)", color: listFilter === "flagged" ? "#FB7185" : "rgba(245,240,232,0.25)", border: listFilter === "flagged" ? "1px solid rgba(251,113,133,0.20)" : "1px solid rgba(245,240,232,0.04)" }}>Flagged ({Object.keys(warnings).filter(id => !dismissed.has(Number(id) || id)).length})</button>
              </div>
            )}

            {/* Event list */}
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {(() => {
                let displayEvents = sorted;
                if (listFilter === "flagged") {
                  displayEvents = sorted.filter(ev => (warnings[ev.id]?.length > 0) && !dismissed.has(ev.id));
                }
                return displayEvents.map(ev => {
                const evWarnings = warnings[ev.id] || [];
                const isDismissed = dismissed.has(ev.id);
                const hasWarning = evWarnings.length > 0;
                const worstType = evWarnings.some(w => w.type === "red") ? "red" : evWarnings.some(w => w.type === "yellow") ? "yellow" : "gray";
                const borderColor = !hasWarning ? (ev.featured ? "#FACC15" : "transparent")
                  : isDismissed ? "rgba(245,240,232,0.08)"
                  : worstType === "red" ? "#FB7185"
                  : worstType === "yellow" ? "#FACC15"
                  : "rgba(245,240,232,0.15)";

                return (
                <div key={ev.id} ref={el => { if (el) eventRefs.current[ev.id] = el; }} style={{
                  display: "flex", alignItems: "center", gap: "0.2rem", padding: "0.3rem 0.4rem", marginBottom: "1px",
                  background: sel.has(ev.id) ? "rgba(250,204,21,0.06)" : ev.featured ? "rgba(250,204,21,0.03)" : "#0e0e0e",
                  borderRadius: "3px", fontSize: "0.6rem", borderLeft: `2px solid ${borderColor}`,
                  opacity: isDismissed && hasWarning ? 0.5 : 1,
                }}>
                  <input type="checkbox" checked={sel.has(ev.id)} onChange={() => { const s2 = new Set(sel); s2.has(ev.id) ? s2.delete(ev.id) : s2.add(ev.id); setSel(s2); }} style={{ accentColor: "#FACC15" }} />
                  <span style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.3)", minWidth: 22, fontWeight: 600 }}>{ev.day}</span>
                  <select value={ev.emoji || ""} onChange={e => { 
                    if (e.target.value === "__custom__") { 
                      const c = prompt("Paste any emoji:"); 
                      if (c) setEvents(p => p.map(x => x.id === ev.id ? { ...x, emoji: c.trim().slice(0,2) } : x)); 
                    } else { 
                      setEvents(p => p.map(x => x.id === ev.id ? { ...x, emoji: e.target.value } : x)); 
                    }
                  }} style={{ background: "transparent", border: "none", fontSize: "0.65rem", cursor: "pointer", minWidth: 22, padding: 0, outline: "none" }}>
                    {ALL_EMOJIS.map((em, ei) => <option key={ei} value={em}>{em || "— none —"}</option>)}
                    <option value="__custom__">✏️ Pick...</option>
                  </select>
                  <span style={{ color: co.accent, fontWeight: 600, minWidth: 38 }}>{ev.time || "—"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "0.58rem", fontWeight: 700, textTransform: "uppercase", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{ev.name || "(no name)"}</p>
                    <p style={{ fontSize: "0.48rem", color: "rgba(245,240,232,0.25)", margin: 0 }}>{ev.venue || "(no venue)"}{ev.area ? ` · ${ev.area}` : ""}</p>
                  </div>
                  <span style={{ fontSize: "0.45rem", color: "rgba(245,240,232,0.2)", minWidth: 36 }}>{ev.region}</span>
                  {/* Warning badges — clickable to scroll to partner */}
                  {hasWarning && !isDismissed && (
                    <div style={{ display: "flex", gap: "2px", flexShrink: 0 }}>
                      {evWarnings.slice(0, 3).map((w, wi) => {
                        const hasGroup = w.msg.includes("#");
                        return (
                          <span key={wi} onClick={hasGroup ? () => {
                            const partners = findFlagPartners(ev.id, w.msg);
                            if (partners.length > 0) {
                              setListFilter("all");
                              setTimeout(() => scrollToEvent(partners[0]), 100);
                            }
                          } : undefined} style={{ fontSize: "0.38rem", padding: "1px 3px", borderRadius: "2px", fontWeight: 700, letterSpacing: "0.3px",
                            cursor: hasGroup ? "pointer" : "default",
                            background: w.type === "red" ? "rgba(251,113,133,0.15)" : w.type === "yellow" ? "rgba(250,204,21,0.12)" : "rgba(245,240,232,0.06)",
                            color: w.type === "red" ? "#FB7185" : w.type === "yellow" ? "#FACC15" : "rgba(245,240,232,0.30)",
                          }}>{w.msg}</span>
                        );
                      })}
                    </div>
                  )}
                  {hasWarning && isDismissed && <span style={{ fontSize: "0.38rem", color: "rgba(245,240,232,0.15)", padding: "1px 3px" }}>✓</span>}
                  {ev.featured && <span style={{ fontSize: "0.4rem", background: "rgba(250,204,21,0.15)", color: "#FACC15", padding: "1px 4px", borderRadius: "2px", fontWeight: 700 }}>PICK</span>}
                  {/* Action buttons */}
                  {hasWarning && !isDismissed && (
                    <button onClick={() => setDismissed(p => { const n = new Set(p); n.add(ev.id); return n; })} title="Dismiss warning" style={{ ...IB, color: "rgba(250,204,21,0.35)", fontSize: "0.55rem" }}>✓</button>
                  )}
                  <button onClick={() => { setEvents(p => p.map(e => e.id === ev.id ? { ...e, featured: !e.featured } : e)); }} style={{ ...IB, color: ev.featured ? "#FACC15" : "rgba(245,240,232,0.1)" }}>★</button>
                  <button onClick={() => { setNev({ ...ev }); setEditId(ev.id); setShowAdd(true); }} style={IB}>✎</button>
                  <button onClick={() => { setEvents(p => p.filter(e => e.id !== ev.id)); }} style={{ ...IB, color: "rgba(251,113,133,0.35)" }}>×</button>
                </div>
                );
              }); })()}
              {events.length === 0 && <p style={{ textAlign: "center", padding: "1.5rem", color: "rgba(245,240,232,0.1)", fontSize: "0.7rem" }}>No events yet — upload a file or add manually</p>}
            </div>
            {events.length > 0 && <button onClick={() => { setEvents([]); setSel(new Set()); setDismissed(new Set()); setRawRows(null); setColHeaders([]); setShowMapping(false); setEmojiPickId(null); }} style={{ ...B, marginTop: "0.3rem", color: "rgba(251,113,133,0.35)" }}>Clear All</button>}
          </div>

          {/* RIGHT: CANVAS PREVIEW */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
              {mode === "preview" ? (
                <label style={{ ...L, marginBottom: 0 }}>Week Preview — {pgDay}{pgIsCont ? " (cont.)" : ""}{bgImage ? " + Photo" : ""}</label>
              ) : (
                <label style={{ ...L, marginBottom: 0 }}>{pgDay}{pgIsCont ? " (cont.)" : ""} ({COLORS[activeColor].name})</label>
              )}
              {pages > 1 && <div style={{ display: "flex", gap: "0.2rem", flexWrap: "wrap" }}>
                {allPages.map((p, i) => {
                  const pColor = mode === "preview" ? COLORS[previewColor] : COLORS[dayColors[p.day] || "purple"];
                  return (
                    <button key={i} onClick={() => setPg(i)} style={{
                      padding: "2px 8px", borderRadius: "3px", border: "none", cursor: "pointer",
                      background: pg === i ? pColor.hex : "rgba(245,240,232,0.04)",
                      color: pg === i ? (pColor.light ? "#000" : "#FFF") : "rgba(245,240,232,0.2)", fontSize: "0.55rem", fontWeight: 700,
                    }}>{p.day}{p.isContinuation ? "+" : ""}</button>
                  );
                })}
              </div>}
            </div>
            <div style={{ position: "relative" }}>
              <canvas ref={canvasRef} onClick={handleCanvasClick} style={{ width: pw, height: ph, borderRadius: "4px", display: "block", cursor: "pointer" }} />
              {emojiPickId !== null && (
                <div style={{ position: "absolute", top: emojiPickPos.y, left: emojiPickPos.x, zIndex: 50, background: "#1a1a1a", border: "1px solid rgba(250,204,21,0.20)", borderRadius: "6px", padding: "4px", boxShadow: "0 4px 20px rgba(0,0,0,0.6)" }}>
                  <select value={events.find(e => e.id === emojiPickId)?.emoji || ""} onChange={e => { 
                    if (e.target.value === "__custom__") {
                      const c = prompt("Paste any emoji:");
                      if (c) setEvents(p => p.map(x => x.id === emojiPickId ? { ...x, emoji: c.trim().slice(0,2) } : x));
                    } else {
                      setEvents(p => p.map(x => x.id === emojiPickId ? { ...x, emoji: e.target.value } : x));
                    }
                    setEmojiPickId(null);
                  }} style={{ background: "#111", border: "1px solid rgba(250,204,21,0.15)", borderRadius: "4px", color: "#F5F0E8", fontSize: "1rem", padding: "4px 8px", cursor: "pointer", outline: "none" }}>
                    {ALL_EMOJIS.map((em, ei) => <option key={ei} value={em}>{em || "— none —"}</option>)}
                    <option value="__custom__">✏️ Pick...</option>
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
              <button onClick={() => dl(safePg)} style={{ flex: 1, padding: "10px", background: co.hex, color: co.light ? "#000" : "#FFF", border: "none", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>Download {pgDay}{mode === "preview" ? " Preview" : ""}</button>
              {pages > 1 && <button onClick={dlAll} style={{ padding: "10px 14px", background: "rgba(245,240,232,0.05)", color: "rgba(245,240,232,0.45)", border: "1px solid rgba(245,240,232,0.06)", borderRadius: "6px", fontSize: "0.7rem", cursor: "pointer" }}>All (.zip)</button>}
            </div>
            <p style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.18)", marginTop: "0.4rem", lineHeight: 1.5 }}>
              {mode === "preview" ? `${events.length} events · ${pages} preview slides · Two-column layout` : `PNG at ${si.w}×${si.h}px · Sorted: North→Central→South, earliest→latest`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const L = { display: "block", fontSize: "0.5rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.22)", marginBottom: "3px" };
const I = { width: "100%", padding: "5px 7px", background: "#111", border: "1px solid rgba(245,240,232,0.04)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif", fontSize: "0.7rem", outline: "none" };
const B = { padding: "4px 8px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.04)", borderRadius: "4px", color: "rgba(245,240,232,0.35)", fontSize: "0.6rem", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" };
const IB = { background: "none", border: "none", color: "rgba(245,240,232,0.1)", cursor: "pointer", fontSize: "0.65rem", padding: "1px 2px" };
