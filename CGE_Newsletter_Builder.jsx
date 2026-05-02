import { useState, useRef } from "react";
import * as XLSX from "xlsx";

const DAY_ORDER = { Fri: 0, Sat: 1, Sun: 2 };
const REGION_ORDER = { North: 0, Central: 1, South: 2 };
const DAYFUL = { Fri: "FRIDAY", Sat: "SATURDAY", Sun: "SUNDAY" };
const DAY_EMOJI = { Fri: "🌙", Sat: "🔥", Sun: "☀️" };

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
  if (!type) return "";
  const upper = String(type).toUpperCase().trim();
  for (const [emoji, types] of Object.entries(EMOJI_MAP)) { if (types.includes(upper)) return emoji; }
  return "";
}

function parseTime(t) {
  if (!t) return 9999;
  const raw = String(t).trim();
  const m = raw.match(/(\d+)(?::(\d+))?(?::(\d+))?\s*(AM|PM|am|pm|A|P|a|p)?/i);
  if (m && m[4]) {
    let h = parseInt(m[1]), min = parseInt(m[2] || "0");
    const p = m[4].toUpperCase();
    if (p.startsWith("P") && h < 12) h += 12;
    if (p.startsWith("A") && h === 12) h = 0;
    return h * 60 + min;
  }
  const numVal = parseFloat(raw);
  const hasDecimal = raw.includes(".");
  if (!isNaN(numVal) && hasDecimal && numVal >= 0 && numVal < 2) {
    const frac = numVal >= 1 ? numVal - 1 : numVal;
    return Math.round(frac * 1440);
  }
  if (m && !m[4]) {
    let h = parseInt(m[1]), min = parseInt(m[2] || "0");
    if (h >= 1 && h <= 8) h += 12;
    return h * 60 + min;
  }
  return 9999;
}
function formatTime(t) {
  if (!t) return "";
  const raw = String(t).trim();
  const numVal = parseFloat(raw);
  const hasDecimal = raw.includes(".");
  if (!isNaN(numVal) && hasDecimal && numVal >= 0 && numVal < 2) {
    const f = numVal >= 1 ? numVal - 1 : numVal, tm = Math.round(f * 1440);
    let h = Math.floor(tm / 60); const min = tm % 60, ap = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12; if (h === 0) h = 12;
    return min === 0 ? `${h} ${ap}` : `${h}:${String(min).padStart(2, "0")} ${ap}`;
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
function parseDay(d) {
  if (!d || !String(d).trim()) return "Fri";
  const l = String(d).toLowerCase().trim().replace(/[.]/g, "");
  if (l.startsWith("fri") || l === "f") return "Fri";
  if (l.startsWith("sat") || l === "sa" || l === "s") return "Sat";
  if (l.startsWith("sun") || l === "su") return "Sun";
  return null;
}
function parseRegion(r) {
  if (!r || !String(r).trim()) return null;
  const l = String(r).toLowerCase().replace(/\s*(nj|jersey)$/i, "").trim();
  if (l === "north" || l === "n" || l === "northern") return "North";
  if (l === "central" || l === "c" || l === "cent" || l === "middle") return "Central";
  if (l === "south" || l === "so" || l === "southern" || l === "shore") return "South";
  return null;
}
const CP = {
  date: /^(date|event\s*date|event\s*date\s*\(|calendar\s*date|start\s*date)$/i,
  day: /^(day|weekday|dow|day\s*of\s*week|event\s*day)$/i,
  time: /^(time|start|start\s*time|event\s*time|begins?|hour)$/i,
  name: /^(name|event|event\s*name|title|event\s*title|show|party)$/i,
  venue: /^(venue|venue\s*name|location|place|spot|club|lounge|restaurant|bar|space)$/i,
  area: /^(area|city|town|neighborhood|hood|municipality|address|where|locale)$/i,
  region: /^(region|zone|section|nj\s*region|part|area\s*region|region\s*nj|nj\s*area)$/i,
  type: /^(type|category|genre|event\s*type|event\s*category|kind)$/i,
  link: /^(link|url|ticket|ticket\s*link|event\s*link|event\s*url|website|rsvp|registration|tickets)$/i,
  _ig: /^(price|cost|notes|description|promoter|capacity|id|#|number|status|flyer|image|phone|email|contact|age|dress\s*code|featured|pick|emoji)$/i
};
function matchColumns(hds) {
  const m = {};
  // First pass: strict regex match
  hds.forEach((h, i) => {
    const c = String(h).trim();
    if (CP._ig.test(c)) return;
    for (const [f, p] of Object.entries(CP)) {
      if (f === "_ig") continue;
      if (p.test(c) && !(f in m)) { m[f] = i; break; }
    }
  });
  // Second pass: fuzzy/contains match for any fields not yet matched
  const fuzzy = {
    day: /\bday\b|\bweekday\b/i,
    date: /\bdate\b/i,
    time: /\btime\b|\bhour\b/i,
    name: /\bevent\s*name\b|\btitle\b/i,
    venue: /\bvenue\b|\blocation\b|\bplace\b/i,
    area: /\bcity\b|\btown\b|\bneighborhood\b/i,
    region: /\bregion\b|\bzone\b|\bsection\b/i,
    type: /\btype\b|\bcategory\b|\bgenre\b/i,
    link: /\blink\b|\burl\b|\bticket\b/i,
  };
  hds.forEach((h, i) => {
    const c = String(h).trim();
    if (Object.values(m).includes(i)) return;
    if (CP._ig.test(c)) return;
    for (const [f, rx] of Object.entries(fuzzy)) {
      if (!(f in m) && rx.test(c)) { m[f] = i; break; }
    }
  });
  return m;
}
function parseDateToDay(dateStr) {
  if (!dateStr || !String(dateStr).trim()) return null;
  const raw = String(dateStr).trim();
  
  // Try parsing as a date
  let d = null;
  
  // Excel serial number (e.g. 46132)
  const num = parseFloat(raw);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    d = new Date((num - 25569) * 86400000);
  }
  
  // M/D/YYYY or M/D/YY or M/D
  if (!d) {
    const mdy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
    if (mdy) {
      const yr = mdy[3] ? (mdy[3].length === 2 ? 2000 + parseInt(mdy[3]) : parseInt(mdy[3])) : new Date().getFullYear();
      d = new Date(yr, parseInt(mdy[1]) - 1, parseInt(mdy[2]));
    }
  }
  
  // YYYY-MM-DD
  if (!d) {
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  }
  
  // Month name: "April 25" or "April 25, 2026"
  if (!d) {
    const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const mn = raw.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i);
    if (mn) {
      const mi = months[mn[1].slice(0,3).toLowerCase()];
      if (mi !== undefined) {
        const yr = mn[3] ? parseInt(mn[3]) : new Date().getFullYear();
        d = new Date(yr, mi, parseInt(mn[2]));
      }
    }
  }
  
  if (d && !isNaN(d.getTime())) {
    const dow = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
    if (dow === 5) return { day: "Fri", date: `${d.getMonth()+1}/${d.getDate()}` };
    if (dow === 6) return { day: "Sat", date: `${d.getMonth()+1}/${d.getDate()}` };
    if (dow === 0) return { day: "Sun", date: `${d.getMonth()+1}/${d.getDate()}` };
    // Non-weekend day — still return it but mark as the day name
    const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return { day: names[dow], date: `${d.getMonth()+1}/${d.getDate()}` };
  }
  return null;
}

function cleanField(s) {
  if (!s) return "";
  return String(s).replace(/^["']+|["']+$/g, "").trim();
}
function isDateLike(s) {
  if (!s) return false;
  const v = String(s).trim();
  return /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(v) || /^\d{4}-\d{1,2}-\d{1,2}/.test(v);
}
function formatTimeClean(t) {
  if (!t) return "";
  const raw = String(t).trim();
  // Strip seconds from "9:00:00 PM" → "9:00 PM" → "9 PM"
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::00)?\s*(AM|PM|am|pm)?$/i);
  if (m) {
    const h = parseInt(m[1]), min = m[2], ap = (m[3] || "").toUpperCase();
    if (min === "00") return `${h} ${ap}`.trim();
    return `${h}:${min} ${ap}`.trim();
  }
  return formatTime(raw);
}

function parseFile(rows, dr) {
  if (!rows || !rows.length) return [];
  const fr = rows[0].map(c => String(c ?? "").trim());
  const cm = matchColumns(fr);
  const hh = Object.keys(cm).length >= 2;
  const drs = hh ? rows.slice(1) : rows;
  const fm = hh ? cm : { day: 0, time: 1, name: 2, venue: 3, area: 4, region: 5 };
  if (hh && !("name" in fm)) {
    for (let i = 0; i < fr.length; i++) { if (!Object.values(fm).includes(i)) { fm.name = i; break; } }
  }
  const hasDateCol = "date" in fm;
  const hasDayCol = "day" in fm;
  
  return drs.filter(r => r && r.some(c => c != null && String(c).trim() !== "")).map(r => {
    const g = f => (f in fm && fm[f] < r.length) ? cleanField(r[fm[f]]) : "";
    
    let day = null;
    if (hasDayCol) day = parseDay(g("day"));
    if (!day && hasDateCol) {
      const dateInfo = parseDateToDay(g("date"));
      if (dateInfo) day = dateInfo.day;
    }
    if (!day) day = "Fri";
    
    // Get fields and strip any date-like values that leaked into wrong columns
    let name = g("name");
    let venue = g("venue");
    let area = g("area");
    if (isDateLike(name)) name = "";
    if (isDateLike(venue)) venue = "";
    if (isDateLike(area)) area = "";
    
    const region = parseRegion(g("region")) || dr || "North";
    const time = formatTimeClean(g("time"));
    return { id: Date.now() + Math.random() * 1e5, day, time, name, venue, area, region, type: g("type"), featured: false };
  }).filter(e => e.name && e.day !== null);
}

function calcDates(friDate) {
  const parts = friDate.split("/");
  if (parts.length !== 2) return { Fri: friDate, Sat: "", Sun: "" };
  const m = parseInt(parts[0]), d = parseInt(parts[1]);
  if (isNaN(m) || isNaN(d)) return { Fri: friDate, Sat: "", Sun: "" };
  const mx = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m] || 31;
  return { Fri: friDate, Sat: d + 1 > mx ? `${m + 1}/1` : `${m}/${d + 1}`, Sun: d + 2 > mx ? `${m + 1}/${d + 2 - mx}` : `${m}/${d + 2}` };
}

function buildHTML(events, intro, friDate, showPicks) {
  const sorted = sortEv(events);
  const picks = sorted.filter(e => e.featured);
  const dates = calcDates(friDate);
  const total = events.length;
  const dayCount = {};
  events.forEach(e => { dayCount[e.day] = (dayCount[e.day] || 0) + 1; });

  let html = "";

  // Header bar
  html += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr>`;
  html += `<td style="font-size:24px;font-weight:800;font-family:sans-serif;color:#000;letter-spacing:1px;">CENTRAL GROUP EVENTS</td>`;
  html += `<td style="text-align:right;font-size:13px;color:#999;">Weekend of ${dates.Fri} — ${dates.Sun}</td>`;
  html += `</tr></table>\n`;

  // Divider
  html += `<div style="height:3px;background:linear-gradient(90deg,#7C3AED,#D4943A,#FACC15);margin-bottom:20px;border-radius:2px;"></div>\n`;

  // Intro
  html += `<p style="font-size:16px;color:#333;line-height:1.7;margin-bottom:24px;">${intro || `<strong>${total} events</strong> this weekend across New Jersey. Here's everything happening — curated and organized so you always know what's going on around you.`}</p>\n`;

  // CGE Picks
  if (showPicks && picks.length > 0) {
    html += `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:16px 20px;margin-bottom:28px;">\n`;
    html += `<h2 style="font-family:sans-serif;font-size:18px;font-weight:800;color:#000;margin:0 0 12px;">⭐ CGE PICKS — Our Top Recommendations</h2>\n`;
    picks.forEach((ev, i) => {
      const emoji = getEmoji(ev.type);
      html += `<div style="padding:10px 0;${i < picks.length - 1 ? 'border-bottom:1px solid #FDE68A;' : ''}">`;
      html += `<div style="font-size:15px;font-weight:700;color:#000;margin-bottom:2px;">${emoji ? emoji + " " : ""}${ev.link ? `<a href="${ev.link}" style="color:#000;text-decoration:underline;">${ev.name}</a>` : ev.name}</div>`;
      html += `<div style="font-size:13px;color:#666;">${ev.venue || ""}${ev.area ? ", " + ev.area : ""} · ${ev.time}</div>`;
      html += `</div>\n`;
    });
    html += `</div>\n`;
  }

  // Full list by Day → Region
  ["Fri", "Sat", "Sun"].forEach(d => {
    const dayEvts = sorted.filter(e => e.day === d);
    if (dayEvts.length === 0) return;

    // Day header
    html += `<div style="margin-top:32px;margin-bottom:16px;">\n`;
    html += `<table width="100%" cellpadding="0" cellspacing="0"><tr>`;
    html += `<td style="font-size:28px;font-weight:800;font-family:sans-serif;color:#000;">${DAY_EMOJI[d]} ${DAYFUL[d]} <span style="color:#999;font-size:15px;font-weight:400;">${dates[d]}</span></td>`;
    html += `<td style="text-align:right;"><span style="background:#f0f0f0;color:#666;font-size:12px;font-weight:600;padding:4px 10px;border-radius:12px;">${dayEvts.length} events</span></td>`;
    html += `</tr></table>\n`;
    html += `<div style="height:2px;background:#e5e5e5;margin-top:8px;"></div>\n`;
    html += `</div>\n`;

    const regions = [...new Set(dayEvts.map(e => e.region))].sort((a, b) => (REGION_ORDER[a] ?? 9) - (REGION_ORDER[b] ?? 9));

    regions.forEach(reg => {
      const regEvts = dayEvts.filter(e => e.region === reg);

      // Region header
      if (regions.length > 1) {
        html += `<div style="margin:16px 0 10px;padding:6px 12px;background:#f5f5f5;border-radius:6px;border-left:3px solid ${reg === "North" ? "#7C3AED" : reg === "Central" ? "#059669" : "#D4943A"};">`;
        html += `<span style="font-size:14px;font-weight:700;color:#333;text-transform:uppercase;letter-spacing:1.5px;">${reg}</span>`;
        html += ` <span style="font-size:11px;color:#999;margin-left:6px;">${regEvts.length} events</span>`;
        html += `</div>\n`;
      }

      // Event rows
      regEvts.forEach((ev, ei) => {
        const isPick = ev.featured;
        const emoji = getEmoji(ev.type);
        html += `<div style="padding:8px ${regions.length > 1 ? '16px' : '8px'};${ei < regEvts.length - 1 ? 'border-bottom:1px solid #f0f0f0;' : ''}${isPick ? 'background:#FFFEF5;border-left:3px solid #FACC15;padding-left:12px;' : ''}">`;
        html += `<table width="100%" cellpadding="0" cellspacing="0"><tr>`;
        // Left: emoji + name + venue
        html += `<td style="vertical-align:top;">`;
        html += `<div style="font-size:14px;font-weight:700;color:#000;">${emoji ? emoji + " " : ""}${ev.link ? `<a href="${ev.link}" style="color:#000;text-decoration:underline;">${ev.name}</a>` : ev.name}`;
        if (isPick) html += ` <span style="background:#FACC15;color:#000;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;margin-left:4px;vertical-align:middle;">CGE PICK</span>`;
        html += `</div>`;
        html += `<div style="font-size:12px;color:#888;margin-top:1px;">${ev.venue || ""}${ev.area ? ", " + ev.area : ""}</div>`;
        html += `</td>`;
        // Right: time
        html += `<td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:12px;">`;
        html += `<span style="font-size:13px;font-weight:600;color:#555;">${ev.time || ""}</span>`;
        html += `</td>`;
        html += `</tr></table>`;
        html += `</div>\n`;
      });
    });
  });

  // Outro
  html += `<div style="margin-top:36px;padding-top:24px;border-top:2px solid #e5e5e5;">\n`;
  html += `<p style="font-size:15px;color:#333;line-height:1.7;margin-bottom:16px;">That's <strong>${total} events</strong> across <strong>${Object.keys(dayCount).length} days</strong> and <strong>${[...new Set(events.map(e => e.region))].length} regions</strong> this weekend. Whether you're looking for a night out, a daytime vibe, or something lowkey — NJ has it.</p>\n`;
  html += `<p style="font-size:15px;color:#333;line-height:1.7;margin-bottom:16px;">See something you like? Forward this to someone who needs weekend plans. The more people know, the better the scene gets for everyone.</p>\n`;
  html += `<div style="background:#000;color:#fff;padding:20px 24px;border-radius:8px;margin-top:20px;">\n`;
  html += `<div style="font-size:18px;font-weight:800;letter-spacing:1px;margin-bottom:4px;">CENTRAL GROUP EVENTS</div>\n`;
  html += `<div style="font-size:13px;color:#999;margin-bottom:12px;">We find it all so you don't have to.</div>\n`;
  html += `<div style="font-size:13px;color:#aaa;">`;
  html += `<a href="https://centralgroupevents.com" style="color:#FACC15;text-decoration:none;font-weight:600;">centralgroupevents.com</a>`;
  html += ` · `;
  html += `<a href="https://instagram.com/centralgroupevents" style="color:#FACC15;text-decoration:none;font-weight:600;">@centralgroupevents</a>`;
  html += `</div>\n`;
  html += `</div>\n`;
  html += `</div>\n`;

  return html;
}

function buildPlainText(events, intro, friDate, showPicks) {
  const sorted = sortEv(events);
  const picks = sorted.filter(e => e.featured);
  const dates = calcDates(friDate);
  const total = events.length;
  const dayCount = {};
  events.forEach(e => { dayCount[e.day] = (dayCount[e.day] || 0) + 1; });
  let txt = "";

  txt += "CENTRAL GROUP EVENTS\n";
  txt += `Weekend of ${dates.Fri} — ${dates.Sun}\n`;
  txt += "─".repeat(40) + "\n\n";

  txt += (intro || `${total} events this weekend across New Jersey. Here's everything happening — curated and organized so you always know what's going on around you.`) + "\n\n";

  if (showPicks && picks.length > 0) {
    txt += "⭐ CGE PICKS — Our Top Recommendations\n";
    txt += "─".repeat(40) + "\n";
    picks.forEach(ev => {
      const emoji = getEmoji(ev.type);
      txt += `${emoji ? emoji + " " : ""}${ev.name} · ${ev.venue || ""}${ev.area ? ", " + ev.area : ""} · ${ev.time}\n`;
    });
    txt += "\n";
  }

  ["Fri", "Sat", "Sun"].forEach(d => {
    const dayEvts = sorted.filter(e => e.day === d);
    if (dayEvts.length === 0) return;
    txt += `${DAY_EMOJI[d]} ${DAYFUL[d]} ${dates[d]} (${dayEvts.length} events)\n`;
    txt += "═".repeat(40) + "\n\n";
    const regions = [...new Set(dayEvts.map(e => e.region))].sort((a, b) => (REGION_ORDER[a] ?? 9) - (REGION_ORDER[b] ?? 9));
    regions.forEach(reg => {
      const regEvts = dayEvts.filter(e => e.region === reg);
      if (regions.length > 1) txt += `▸ ${reg.toUpperCase()} (${regEvts.length})\n`;
      regEvts.forEach(ev => {
        const emoji = getEmoji(ev.type);
        const pick = ev.featured ? " ⭐ CGE PICK" : "";
        txt += `  ${emoji ? emoji + " " : ""}${ev.name} · ${ev.venue || ""}${ev.area ? ", " + ev.area : ""} · ${ev.time}${pick}\n`;
      });
      txt += "\n";
    });
  });

  txt += "─".repeat(40) + "\n\n";
  txt += `That's ${total} events across ${Object.keys(dayCount).length} days and ${[...new Set(events.map(e => e.region))].length} regions this weekend.\n\n`;
  txt += "See something you like? Forward this to someone who needs weekend plans.\n\n";
  txt += "CENTRAL GROUP EVENTS\n";
  txt += "We find it all so you don't have to.\n";
  txt += "centralgroupevents.com · @centralgroupevents\n";
  return txt;
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [friDate, setFriDate] = useState("4/25");
  const [intro, setIntro] = useState("");
  const [showPicks, setShowPicks] = useState(true);
  const [copied, setCopied] = useState("");
  const [editId, setEditId] = useState(null);
  const [colInfo, setColInfo] = useState(null);
  const fileRef = useRef(null);
  const previewRef = useRef(null);

  // Column mapping state
  const [rawRows, setRawRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [colMap, setColMap] = useState({ date: "", day: "", time: "", name: "", venue: "", area: "", region: "", type: "", link: "" });
  const [showMapping, setShowMapping] = useState(false);

  const FIELDS = [
    { key: "date", label: "Date", desc: "e.g. 4/25/2026", required: false },
    { key: "day", label: "Day", desc: "Fri / Sat / Sun", required: false },
    { key: "time", label: "Time", desc: "e.g. 8 PM", required: false },
    { key: "name", label: "Event Name", desc: "Name of event", required: true },
    { key: "venue", label: "Venue", desc: "Venue / location name", required: false },
    { key: "area", label: "City", desc: "City / town", required: false },
    { key: "region", label: "Region", desc: "North / Central / South", required: false },
    { key: "type", label: "Event Type", desc: "For emoji mapping", required: false },
    { key: "link", label: "Link / URL", desc: "Hyperlink for event", required: false },
  ];

  const sorted = sortEv(events);
  const picks = sorted.filter(e => e.featured);
  const dates = calcDates(friDate);
  const dayCount = {};
  events.forEach(e => { dayCount[e.day] = (dayCount[e.day] || 0) + 1; });
  const regionCount = {};
  events.forEach(e => { regionCount[e.region] = (regionCount[e.region] || 0) + 1; });

  const applyMapping = () => {
    if (!rawRows || !rawRows.length) return;
    const fm = {};
    Object.entries(colMap).forEach(([field, idx]) => {
      if (idx !== "" && idx !== "-1") fm[field] = parseInt(idx);
    });
    if (!("name" in fm)) { alert("Please select which column is the Event Name."); return; }

    const dataRows = rawRows.slice(1);
    const hasDateCol = "date" in fm;
    const hasDayCol = "day" in fm;

    const parsed = dataRows.filter(r => r && r.some(c => c != null && String(c).trim() !== "")).map(r => {
      const g = f => (f in fm && fm[f] < r.length) ? cleanField(r[fm[f]]) : "";
      let day = null;
      if (hasDayCol) day = parseDay(g("day"));
      if (!day && hasDateCol) {
        const dateInfo = parseDateToDay(g("date"));
        if (dateInfo) day = dateInfo.day;
      }
      if (!day) day = "Fri";
      let name = g("name"), venue = g("venue"), area = g("area");
      if (isDateLike(name)) name = "";
      if (isDateLike(venue)) venue = "";
      if (isDateLike(area)) area = "";
      const region = parseRegion(g("region")) || "North";
      const time = formatTimeClean(g("time"));
      const link = g("link");
      return { id: Date.now() + Math.random() * 1e5, day, time, name, venue, area, region, type: g("type"), link, featured: false };
    }).filter(e => e.name && e.day !== null);

    if (parsed.length === 0) { alert("No valid events found with this mapping."); return; }
    setEvents(parsed);
    setShowMapping(false);

    // Auto-detect Friday date
    if (hasDateCol) {
      for (const r of dataRows) {
        const dateVal = r[fm.date];
        if (dateVal) {
          const info = parseDateToDay(cleanField(dateVal));
          if (info && info.day === "Fri") { setFriDate(info.date); break; }
        }
      }
    }
  };

  const handleFile = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const ext = f.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
          loadRows(rows);
        } catch (err) { alert("Error: " + err.message); }
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

  const loadRows = (rows) => {
    if (!rows || !rows.length) return;
    const hdrs = rows[0].map(c => String(c ?? "").trim());
    setRawRows(rows);
    setHeaders(hdrs);

    // Auto-suggest column mapping
    const auto = matchColumns(hdrs);
    const newMap = { date: "", day: "", time: "", name: "", venue: "", area: "", region: "", type: "", link: "" };
    Object.entries(auto).forEach(([field, idx]) => {
      if (field !== "_ig" && field in newMap) newMap[field] = String(idx);
    });
    setColMap(newMap);
    setShowMapping(true);
    setEvents([]);
  };

  const copyRich = () => {
    const html = buildHTML(events, intro, friDate, showPicks);
    try {
      // Create a hidden div with the HTML content
      const el = document.createElement("div");
      el.innerHTML = html;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      el.style.top = "0";
      el.style.opacity = "0";
      document.body.appendChild(el);
      
      // Select the content
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      
      // Copy
      document.execCommand("copy");
      sel.removeAllRanges();
      document.body.removeChild(el);
      
      setCopied("rich");
      setTimeout(() => setCopied(""), 2000);
    } catch (err) {
      console.error("Rich copy failed:", err);
      alert("Copy failed — try selecting the preview manually and pressing Ctrl+C / Cmd+C.");
    }
  };

  const copyPlain = () => {
    const plain = buildPlainText(events, intro, friDate, showPicks);
    try {
      const ta = document.createElement("textarea");
      ta.value = plain;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      
      setCopied("plain");
      setTimeout(() => setCopied(""), 2000);
    } catch (err) {
      console.error("Plain copy failed:", err);
      alert("Copy failed — try selecting the preview manually.");
    }
  };

  const copyHTML = () => {
    const html = buildHTML(events, intro, friDate, showPicks);
    try {
      const ta = document.createElement("textarea");
      ta.value = html;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      
      setCopied("html");
      setTimeout(() => setCopied(""), 2000);
    } catch (err) {
      console.error("HTML copy failed:", err);
      alert("Copy failed.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;900&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase" }}>CGE Newsletter Builder</h1>
          <span style={{ fontSize: "0.6rem", color: "#FACC15", letterSpacing: "1.5px", textTransform: "uppercase", padding: "2px 8px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px" }}>
            {events.length} events · {picks.length} picks · {Object.keys(dayCount).length} days
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: "1.5rem", alignItems: "start" }}>
          {/* LEFT: CONTROLS */}
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: "0.4rem", marginBottom: "0.6rem" }}>
              <div><label style={L}>Friday Date</label><input value={friDate} onChange={e => setFriDate(e.target.value)} style={I} placeholder="4/25" /></div>
              <div><label style={L}>Upload Events</label><button onClick={() => fileRef.current?.click()} style={{ ...B, width: "100%" }}>Upload .xlsx / .csv</button><input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} /></div>
            </div>

            <div style={{ marginBottom: "0.6rem" }}>
              <label style={L}>Intro Line</label>
              <textarea value={intro} onChange={e => setIntro(e.target.value)} style={{ ...I, height: 50, resize: "vertical" }} placeholder={`${events.length || "50+"} events this weekend across NJ. Here's everything happening.`} />
            </div>

            <div style={{ marginBottom: "0.6rem", display: "flex", alignItems: "center", gap: "8px" }}>
              <label style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                <input type="checkbox" checked={showPicks} onChange={e => setShowPicks(e.target.checked)} style={{ accentColor: "#FACC15" }} />
                Show CGE Picks section
              </label>
              <span style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.2)" }}>{picks.length} selected</span>
            </div>

            {/* Copy buttons */}
            <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.6rem" }}>
              <button onClick={copyRich} style={{ flex: 1, padding: "10px", background: "#FACC15", color: "#000", border: "none", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
                {copied === "rich" ? "✓ Copied!" : "Copy Rich Text"}
              </button>
              <button onClick={copyHTML} style={{ padding: "10px 14px", background: "rgba(245,240,232,0.05)", color: "rgba(245,240,232,0.45)", border: "1px solid rgba(245,240,232,0.06)", borderRadius: "6px", fontSize: "0.7rem", cursor: "pointer" }}>
                {copied === "html" ? "✓ Copied!" : "Copy HTML"}
              </button>
              <button onClick={copyPlain} style={{ padding: "10px 14px", background: "rgba(245,240,232,0.05)", color: "rgba(245,240,232,0.45)", border: "1px solid rgba(245,240,232,0.06)", borderRadius: "6px", fontSize: "0.7rem", cursor: "pointer" }}>
                {copied === "plain" ? "✓ Copied!" : "Plain Text"}
              </button>
            </div>

            <div style={{ padding: "0.5rem", background: "#1A1A1A", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)", marginBottom: "0.6rem" }}>
              <p style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.3)", margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: "#FACC15" }}>How to use:</strong> Upload your spreadsheet → star your CGE Picks → write an intro → Copy Rich Text (for rich editors), Copy HTML (for HTML/code editors), or Plain Text → paste into your website editor → send.
              </p>
            </div>

            {/* Column detection info */}
            {showMapping && headers.length > 0 && (
              <div style={{ padding: "0.6rem", background: "rgba(250,204,21,0.04)", border: "1px solid rgba(250,204,21,0.12)", borderRadius: "6px", marginBottom: "0.6rem" }}>
                <p style={{ fontSize: "0.6rem", fontWeight: 700, color: "#FACC15", margin: "0 0 8px" }}>Map your columns</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  {FIELDS.map(f => (
                    <div key={f.key}>
                      <label style={{ fontSize: "0.45rem", color: "rgba(245,240,232,0.35)", letterSpacing: "0.5px", display: "block", marginBottom: "2px" }}>
                        {f.label} {f.required && <span style={{ color: "#FB7185" }}>*</span>}
                      </label>
                      <select
                        value={colMap[f.key]}
                        onChange={e => setColMap(prev => ({ ...prev, [f.key]: e.target.value }))}
                        style={{ ...I, fontSize: "0.6rem", padding: "4px 6px", cursor: "pointer" }}
                      >
                        <option value="">— skip —</option>
                        {headers.map((h, i) => (
                          <option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {/* Preview first row of data */}
                {rawRows && rawRows.length > 1 && (
                  <div style={{ marginTop: "8px", padding: "6px", background: "rgba(0,0,0,0.3)", borderRadius: "4px" }}>
                    <p style={{ fontSize: "0.45rem", color: "rgba(245,240,232,0.25)", margin: "0 0 4px", letterSpacing: "1px" }}>PREVIEW — FIRST EVENT</p>
                    <div style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.5)", lineHeight: 1.6 }}>
                      {FIELDS.filter(f => colMap[f.key] !== "" && colMap[f.key] !== "-1").map(f => {
                        const idx = parseInt(colMap[f.key]);
                        const val = rawRows[1]?.[idx] ?? "";
                        return <span key={f.key} style={{ marginRight: "8px" }}><strong style={{ color: "rgba(245,240,232,0.35)" }}>{f.label}:</strong> {cleanField(String(val))}</span>;
                      })}
                    </div>
                  </div>
                )}
                <button onClick={applyMapping} style={{ marginTop: "8px", width: "100%", padding: "10px", background: "#FACC15", color: "#000", border: "none", borderRadius: "6px", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
                  Apply & Build Newsletter
                </button>
              </div>
            )}

            {/* Active mapping summary */}
            {events.length > 0 && !showMapping && (
              <div style={{ padding: "0.4rem 0.5rem", background: "rgba(5,150,105,0.06)", border: "1px solid rgba(5,150,105,0.12)", borderRadius: "5px", marginBottom: "0.6rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.25)", margin: 0 }}>
                  {events.length} events · {Object.keys(dayCount).length} days ({Object.entries(dayCount).map(([d, c]) => `${d}: ${c}`).join(", ")}) · {Object.keys(regionCount).length} regions ({Object.entries(regionCount).map(([r, c]) => `${r}: ${c}`).join(", ")})
                </p>
                <button onClick={() => setShowMapping(true)} style={{ ...B, fontSize: "0.45rem", padding: "2px 8px" }}>Remap</button>
              </div>
            )}


            {/* Event list with star toggle */}
            <div>
              <label style={L}>Events — ★ to feature as CGE Pick</label>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {sorted.map((ev, i) => {
                  if (editId === ev.id) {
                    return <div key={ev.id} style={{ display: "flex", gap: "0.2rem", padding: "0.3rem 0.4rem", fontSize: "0.55rem", background: "rgba(250,204,21,0.06)", borderRadius: "3px", alignItems: "center", borderLeft: "2px solid #FACC15" }}>
                      <input value={ev.name} onChange={e => { const v = e.target.value; setEvents(p => p.map(x => x.id === ev.id ? { ...x, name: v } : x)); }} style={{ ...I, flex: 2, fontSize: "0.58rem", padding: "3px 5px" }} />
                      <input value={ev.venue} onChange={e => { const v = e.target.value; setEvents(p => p.map(x => x.id === ev.id ? { ...x, venue: v } : x)); }} style={{ ...I, flex: 1, fontSize: "0.58rem", padding: "3px 5px" }} placeholder="Venue" />
                      <input value={ev.time} onChange={e => { const v = e.target.value; setEvents(p => p.map(x => x.id === ev.id ? { ...x, time: v } : x)); }} style={{ ...I, width: 50, fontSize: "0.58rem", padding: "3px 5px", textAlign: "center" }} />
                      <button onClick={() => setEditId(null)} style={{ background: "none", border: "none", color: "#FACC15", cursor: "pointer", fontSize: "0.6rem" }}>✓</button>
                    </div>;
                  }
                  return (
                    <div key={ev.id} style={{
                      display: "flex", gap: "0.2rem", padding: "0.25rem 0.4rem", fontSize: "0.55rem",
                      background: ev.featured ? "rgba(250,204,21,0.04)" : (i % 2 === 0 ? "#0e0e0e" : "transparent"),
                      borderRadius: "2px", alignItems: "center",
                      borderLeft: ev.featured ? "2px solid #FACC15" : "2px solid transparent",
                    }}>
                      <button onClick={() => setEvents(p => p.map(x => x.id === ev.id ? { ...x, featured: !x.featured } : x))} style={{ background: "none", border: "none", color: ev.featured ? "#FACC15" : "rgba(245,240,232,0.12)", cursor: "pointer", fontSize: "0.7rem", padding: "0 3px" }}>★</button>
                      <span style={{ fontSize: "0.6rem", minWidth: 16 }}>{getEmoji(ev.type)}</span>
                      <span style={{ fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ev.featured ? "#FACC15" : "inherit", cursor: "pointer" }} onClick={() => setEditId(ev.id)}>{ev.name}</span>
                      <span style={{ color: "rgba(245,240,232,0.25)", fontSize: "0.45rem", flexShrink: 0 }}>{ev.venue ? ev.venue.slice(0, 15) : ""}</span>
                      <span style={{ color: "rgba(245,240,232,0.2)", fontSize: "0.45rem", minWidth: 30, textAlign: "right" }}>{ev.time}</span>
                      {ev.featured && <span style={{ fontSize: "0.38rem", background: "rgba(250,204,21,0.15)", color: "#FACC15", padding: "1px 4px", borderRadius: "2px", fontWeight: 700 }}>PICK</span>}
                    </div>
                  );
                })}
                {events.length === 0 && <p style={{ textAlign: "center", padding: "1.5rem", color: "rgba(245,240,232,0.1)", fontSize: "0.7rem" }}>Upload your event spreadsheet</p>}
              </div>
            </div>

            {events.length > 0 && (
              <button onClick={() => { setEvents([]); setRawRows(null); setHeaders([]); setShowMapping(false); setColMap({ date: "", day: "", time: "", name: "", venue: "", area: "", region: "", type: "", link: "" }); }} style={{ ...B, marginTop: "0.3rem", color: "rgba(251,113,133,0.35)" }}>Clear All</button>
            )}
          </div>

          {/* RIGHT: PREVIEW */}
          <div>
            <label style={{ ...L, marginBottom: "6px" }}>Newsletter Preview</label>
            <div ref={previewRef} style={{
              background: "#FFFFFF", borderRadius: "8px", padding: "28px 32px", minHeight: 400,
              maxHeight: "80vh", overflowY: "auto", color: "#333", fontFamily: "sans-serif", fontSize: "14px", lineHeight: 1.6,
            }} dangerouslySetInnerHTML={{ __html: events.length > 0 ? buildHTML(events, intro, friDate, showPicks) : '<p style="color:#ccc;text-align:center;padding:60px 0;">Upload events to see the newsletter preview</p>' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

const L = { display: "block", fontSize: "0.5rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.22)", marginBottom: "3px" };
const I = { width: "100%", padding: "5px 7px", background: "#111", border: "1px solid rgba(245,240,232,0.04)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif", fontSize: "0.7rem", outline: "none" };
const B = { padding: "5px 8px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.04)", borderRadius: "4px", color: "rgba(245,240,232,0.35)", fontSize: "0.65rem", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" };
