// Unified event parser shared by Calendar, Newsletter, and Reel tools.
// Behavior: superset of the three tools' previous logic. Calendar's column
// mapping + ignore patterns, Reel/Newsletter's flexible time/day/date parsing,
// and the most permissive region parser ("North", "Northern NJ", "South Jersey",
// "Shore", etc).

export const DAY_ORDER = { Fri: 0, Sat: 1, Sun: 2 };
export const REGION_ORDER = { North: 0, Central: 1, South: 2 };
export const DAYFUL = { Fri: "FRIDAY", Sat: "SATURDAY", Sun: "SUNDAY" };
export const DAY_EMOJI = { Fri: "🌙", Sat: "🔥", Sun: "☀️" };
export const WEEKDAYS = ["Fri", "Sat", "Sun"];
export const REGIONS = ["North", "Central", "South"];

// Superset emoji map (union of Newsletter and Reel; Calendar was a strict subset).
export const EMOJI_MAP = {
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

export function getEmoji(type) {
  if (!type) return "";
  const upper = String(type).toUpperCase().trim();
  for (const [emoji, types] of Object.entries(EMOJI_MAP)) {
    if (types.includes(upper)) return emoji;
  }
  return "";
}

// Parse time strings into "minutes since midnight" for sorting.
// Handles "9 PM", "9:30pm", "21:00", and Excel decimal fractions like 0.875.
// Bare hours 1–8 with no AM/PM marker default to PM (typical for nightlife).
export function parseTime(t) {
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

// Format a raw time cell into a clean display string ("9 PM", "9:30 PM").
export function formatTime(t) {
  if (!t) return "";
  const raw = String(t).trim();
  const numVal = parseFloat(raw);
  const hasDecimal = raw.includes(".");
  if (!isNaN(numVal) && hasDecimal && numVal >= 0 && numVal < 2) {
    const frac = numVal >= 1 ? numVal - 1 : numVal;
    const tm = Math.round(frac * 1440);
    let h = Math.floor(tm / 60);
    const min = tm % 60, ap = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return min === 0 ? `${h} ${ap}` : `${h}:${String(min).padStart(2, "0")} ${ap}`;
  }
  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM|am|pm|A|P|a|p)?$/i);
  if (m) {
    let h = parseInt(m[1]);
    const min = parseInt(m[2] || "0");
    const p = (m[4] || "").toUpperCase();
    if (p.startsWith("P") && h < 12) h += 12;
    if (p.startsWith("A") && h === 12) h = 0;
    if (!p && h >= 1 && h <= 8) h += 12;
    const ap = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return min === 0 ? `${h} ${ap}` : `${h}:${String(min).padStart(2, "0")} ${ap}`;
  }
  return raw;
}

export function parseDay(d) {
  if (!d || !String(d).trim()) return null;
  const l = String(d).toLowerCase().trim().replace(/[.]/g, "");
  if (l.startsWith("fri") || l === "f") return "Fri";
  if (l.startsWith("sat") || l === "sa" || l === "s") return "Sat";
  if (l.startsWith("sun") || l === "su") return "Sun";
  return null;
}

// Flexible region parser: strips trailing " NJ" / " Jersey", handles
// abbreviations (n/no/northern, c/cent/middle, s/so/southern/shore).
export function parseRegion(r) {
  if (!r || !String(r).trim()) return null;
  const l = String(r).toLowerCase().replace(/\s*(nj|jersey)$/i, "").trim();
  if (l === "north" || l === "n" || l === "no" || l === "northern") return "North";
  if (l === "central" || l === "c" || l === "cent" || l === "middle") return "Central";
  if (l === "south" || l === "so" || l === "s" || l === "southern" || l === "shore") return "South";
  return null;
}

// Convert a date string (or Excel serial) to {day: "Fri"|"Sat"|"Sun", date: "M/D"}
// Returns null if it can't parse, or if the resulting day isn't Fri/Sat/Sun.
export function parseDateToDay(dateStr) {
  if (!dateStr || !String(dateStr).trim()) return null;
  const raw = String(dateStr).trim();
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
      const yr = mdy[3]
        ? (mdy[3].length === 2 ? 2000 + parseInt(mdy[3]) : parseInt(mdy[3]))
        : new Date().getFullYear();
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
      const mi = months[mn[1].slice(0, 3).toLowerCase()];
      if (mi !== undefined) {
        const yr = mn[3] ? parseInt(mn[3]) : new Date().getFullYear();
        d = new Date(yr, mi, parseInt(mn[2]));
      }
    }
  }
  if (!d || isNaN(d.getTime())) return null;
  const dow = d.getDay();
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { day: names[dow], date: `${d.getMonth() + 1}/${d.getDate()}` };
}

export function sortEv(evts) {
  return [...evts].sort((a, b) => {
    const da = DAY_ORDER[a.day] ?? 9, db = DAY_ORDER[b.day] ?? 9;
    if (da !== db) return da - db;
    const ra = REGION_ORDER[a.region] ?? 9, rb = REGION_ORDER[b.region] ?? 9;
    if (ra !== rb) return ra - rb;
    return parseTime(a.time) - parseTime(b.time);
  });
}

// Split a single pasted line into cells. Handles tab, pipe, and CSV (with quotes).
export function parseLine(line) {
  if (line.includes("\t")) return line.split("\t").map(s => s.trim());
  if (line.includes("|")) return line.split("|").map(s => s.trim());
  const parts = [];
  let cur = "", inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === "," && !inQ) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

// Normalize an Instagram handle: strip leading "@" and URL prefix if pasted
// in. Empty/falsy → empty string. Doesn't validate — IG handle rules drift
// and we don't want to drop edge-case-but-valid handles.
export function normalizeHandle(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  if (!s) return "";
  // Strip URL prefixes like instagram.com/foo, www.instagram.com/foo/, etc.
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
       .replace(/^instagram\.com\//i, "").replace(/\/+$/, "");
  // Drop leading @ (we add it back on display)
  s = s.replace(/^@+/, "");
  return s;
}

// Column-name patterns. Strict regex first; if a header doesn't match strictly
// and isn't ignored, we fall back to fuzzy "contains" matching below.
const COL_PATTERNS = {
  date: /^(date|event\s*date|event\s*date\s*\(|calendar\s*date|start\s*date)$/i,
  day: /^(day|weekday|dow|day\s*of\s*week|event\s*day)$/i,
  time: /^(time|start|start\s*time|event\s*time|begins?|hour)$/i,
  name: /^(name|event|event\s*name|title|event\s*title|show|party)$/i,
  venue: /^(venue|venue\s*name|location|place|spot|club|lounge|restaurant|bar|space)$/i,
  area: /^(area|city|town|neighborhood|hood|municipality|address|where|locale)$/i,
  region: /^(region|zone|section|nj\s*region|part|area\s*region|region\s*nj|nj\s*area)$/i,
  type: /^(type|category|genre|event\s*type|event\s*category|kind)$/i,
  link: /^(link|url|ticket|ticket\s*link|event\s*link|event\s*url|website|rsvp|registration|tickets)$/i,
  // Instagram handle of whoever runs the event — kept off-slide, used only
  // to remember who to tag when posting. Bare "ig" and "handle" alone are
  // ambiguous, so the strict pass requires "ig handle" / "instagram" / etc.
  igHandle: /^(ig\s*handle|instagram|instagram\s*handle|ig\s*(account|user|name)|handle|tag|tags)$/i,
  _ignore: /^(price|cost|notes|description|promoter|capacity|id|#|number|status|flyer|image|phone|email|contact|age|dress\s*code|featured|pick|emoji)$/i,
};

const FUZZY_PATTERNS = {
  date: /\bdate\b/i,
  day: /\bday\b|\bweekday\b/i,
  time: /\btime\b|\bhour\b/i,
  name: /\bevent\s*name\b|\btitle\b/i,
  venue: /\bvenue\b|\blocation\b|\bplace\b/i,
  area: /\bcity\b|\btown\b|\bneighborhood\b/i,
  region: /\bregion\b|\bzone\b|\bsection\b/i,
  type: /\btype\b|\bcategory\b|\bgenre\b/i,
  link: /\blink\b|\burl\b|\bticket\b/i,
  igHandle: /\binstagram\b|\big\b|\bhandle\b|\btag\b/i,
};

export function matchColumns(headers) {
  const map = {};
  // Strict pass
  headers.forEach((h, i) => {
    const c = String(h).trim();
    if (COL_PATTERNS._ignore.test(c)) return;
    for (const [field, pattern] of Object.entries(COL_PATTERNS)) {
      if (field === "_ignore") continue;
      if (pattern.test(c) && !(field in map)) { map[field] = i; break; }
    }
  });
  // Fuzzy pass for unmatched fields
  headers.forEach((h, i) => {
    const c = String(h).trim();
    if (Object.values(map).includes(i)) return;
    if (COL_PATTERNS._ignore.test(c)) return;
    for (const [field, rx] of Object.entries(FUZZY_PATTERNS)) {
      if (!(field in map) && rx.test(c)) { map[field] = i; break; }
    }
  });
  return map;
}

// All target fields the column mapper exposes. The column mapper UI
// renders a dropdown per source column; the user picks one of these
// (or "Skip"). Mapping shape on the wire: { [fieldKey]: columnIndex }.
// Kept here next to parseRows so the modal and the parser agree on
// what each field means.
export const TARGET_FIELDS = [
  { key: "name",     label: "Event Name (title)", required: true },
  { key: "date",     label: "Date (M/D)" },
  { key: "day",      label: "Day (Fri/Sat/Sun)" },
  { key: "time",     label: "Time" },
  { key: "venue",    label: "Venue" },
  { key: "area",     label: "Area / City" },
  { key: "region",   label: "Region (North/Central/South)" },
  { key: "type",     label: "Type (Party/Brunch/etc)" },
  { key: "link",     label: "Link / URL" },
  { key: "igHandle", label: "Instagram Handle" },
];

// Top-level: take 2D rows (header row + data rows, like xlsx sheet_to_json with
// header:1, or pasted CSV/TSV split into rows) and return parsed Event[].
// `defaultRegion` is used when a row has no region cell.
//
// If `opts.columnMap` is provided, it's a { fieldKey: columnIndex } object
// supplied by the user via the column-mapper modal. When given, AUTO-
// DETECTION IS SKIPPED — the user's mapping is authoritative and
// `opts.hasHeaderRow` decides whether row 0 is data or headers.
export function parseRows(rows, defaultRegionOrOpts = "North", maybeOpts) {
  // Backwards-compat: old signature was parseRows(rows, defaultRegion).
  // New callers pass parseRows(rows, { columnMap, hasHeaderRow, defaultRegion }).
  let defaultRegion = "North";
  let columnMap = null;
  let hasHeaderRow = null; // null = auto-detect (existing behavior)
  if (typeof defaultRegionOrOpts === "string") {
    defaultRegion = defaultRegionOrOpts;
  } else if (defaultRegionOrOpts && typeof defaultRegionOrOpts === "object") {
    defaultRegion = defaultRegionOrOpts.defaultRegion || "North";
    columnMap = defaultRegionOrOpts.columnMap || null;
    hasHeaderRow = defaultRegionOrOpts.hasHeaderRow ?? null;
  } else if (maybeOpts && typeof maybeOpts === "object") {
    columnMap = maybeOpts.columnMap || null;
    hasHeaderRow = maybeOpts.hasHeaderRow ?? null;
  }

  if (!rows || !rows.length) return [];

  let fm, dataRows;
  if (columnMap) {
    // Explicit mapping from the column-mapper modal.
    fm = columnMap;
    dataRows = hasHeaderRow === false ? rows : rows.slice(1);
  } else {
    // Auto-detect (original behavior, kept for non-UI callers).
    const firstRow = rows[0].map(c => String(c ?? "").trim());
    const colMap = matchColumns(firstRow);
    const hasHeaders = Object.keys(colMap).length >= 2;
    dataRows = hasHeaders ? rows.slice(1) : rows;
    fm = hasHeaders ? colMap : { day: 0, time: 1, name: 2, venue: 3, area: 4, region: 5 };

    // Headers but no name column? Take the first unmapped column as name.
    if (hasHeaders && !("name" in fm)) {
      for (let i = 0; i < firstRow.length; i++) {
        if (!Object.values(fm).includes(i)) { fm.name = i; break; }
      }
    }
  }

  const hasDateCol = "date" in fm;
  const hasDayCol = "day" in fm;

  return dataRows
    .filter(r => r && r.some(c => c != null && String(c).trim() !== ""))
    .map(r => {
      const get = field =>
        field in fm && fm[field] < r.length
          ? String(r[fm[field]] ?? "").replace(/^["']+|["']+$/g, "").trim()
          : "";

      let day = null;
      if (hasDayCol) day = parseDay(get("day"));
      if (!day && hasDateCol) {
        const di = parseDateToDay(get("date"));
        if (di) day = di.day;
      }
      if (!day) day = "Fri";

      const type = get("type");
      return {
        id: Date.now() + Math.random() * 1e5,
        day,
        time: formatTime(get("time")),
        name: get("name"),
        venue: get("venue"),
        area: get("area"),
        region: parseRegion(get("region")) || defaultRegion || "North",
        type,
        emoji: getEmoji(type),
        link: get("link"),
        igHandle: normalizeHandle(get("igHandle")),
        featured: false,
      };
    })
    .filter(e => e.name);
}

// Convenience: turn a pasted block of text (one row per line) into Event[].
export function parsePastedText(text, defaultRegion = "North") {
  const lines = String(text || "").split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  return parseRows(lines.map(parseLine), defaultRegion);
}
