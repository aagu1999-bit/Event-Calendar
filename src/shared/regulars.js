// Weekly Regulars — detect recurring weekend events from a master sheet.
// Input: 2D rows array (header row + data rows) as produced by
//   XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }).
//
// Output: { regulars: Regular[], stats: { total, qualified, byFlag } }
//
// A "Regular" is an event that runs on the same weekend-day (Fri/Sat/Sun)
// repeatedly at the same venue. Detection uses the master sheet's
// RECURRENCE_PATTERN column when set (trust the upstream pipeline), and
// otherwise applies a stricter heuristic: ≥3 distinct weekend dates,
// ≤2hr time spread, strict name match.

const GENERIC_NAMES = new Set([
  "LIVE MUSIC", "LIVE ENTERTAINMENT", "PRIVATE EVENT", "EVENT",
  "BRUNCH", "TBA", "TBD", "DJ NIGHT", "DJ SET",
]);

// Strict normalization for grouping keys.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Parse a date cell. Returns Date or null. Handles ISO, US M/D/Y, and Excel
// serials. Does NOT accept Mon-Thu (weekend events only).
function parseDate(s) {
  if (!s || !String(s).trim()) return null;
  const raw = String(s).trim();
  let d = null;
  const num = parseFloat(raw);
  if (!isNaN(num) && num > 40000 && num < 60000) {
    d = new Date((num - 25569) * 86400000);
  }
  if (!d) {
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) d = new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  }
  if (!d) {
    const mdy = raw.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?/);
    if (mdy) {
      const yr = mdy[3]
        ? (mdy[3].length === 2 ? 2000 + parseInt(mdy[3]) : parseInt(mdy[3]))
        : new Date().getFullYear();
      d = new Date(yr, parseInt(mdy[1]) - 1, parseInt(mdy[2]));
    }
  }
  return d && !isNaN(d.getTime()) ? d : null;
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function weekendDay(d) {
  const n = DOW_NAMES[d.getDay()];
  return (n === "Fri" || n === "Sat" || n === "Sun") ? n : null;
}

// Parse time → minutes since midnight, or null. Handles "9 PM", "9:30 PM",
// "21:00", and Excel decimal fractions like 0.875.
function parseTimeMin(t) {
  if (!t) return null;
  const raw = String(t).trim();
  const numVal = parseFloat(raw);
  if (!isNaN(numVal) && raw.includes(".") && numVal >= 0 && numVal < 2) {
    const frac = numVal >= 1 ? numVal - 1 : numVal;
    return Math.round(frac * 1440);
  }
  const m = raw.match(/(\d+):?(\d+)?\s*(AM|PM|am|pm)?/);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2] || "0");
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 8) h += 12; // bare 1-8 → PM (nightlife default)
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatTimeFromMin(m) {
  if (m == null) return "";
  let h = Math.floor(m / 60), min = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return min === 0 ? `${h} ${ap}` : `${h}:${String(min).padStart(2, "0")} ${ap}`;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function mostCommon(arr) {
  if (!arr.length) return "";
  const counts = new Map();
  let best = "", bestN = 0;
  for (const x of arr) {
    if (!x) continue;
    const n = (counts.get(x) || 0) + 1;
    counts.set(x, n);
    if (n > bestN) { bestN = n; best = x; }
  }
  return best;
}

// Map "EVERY FRIDAY"/"WEEKLY"/"WEEKEND" pattern strings to the days they cover.
function patternToDays(pat) {
  if (!pat) return null;
  const p = pat.toUpperCase();
  if (p.includes("FRIDAY")) return ["Fri"];
  if (p.includes("SATURDAY")) return ["Sat"];
  if (p.includes("SUNDAY")) return ["Sun"];
  if (p.includes("WEEKLY") || p.includes("WEEKEND") || p === "ONGOING") return ["Fri", "Sat", "Sun"];
  return null;
}

// Map master-sheet region values ("NORTH"/"CENTRAL"/"SOUTH"/...) → our app
// region names. Returns "North"|"Central"|"South" or "".
function normalizeRegion(r) {
  if (!r) return "";
  const u = String(r).toUpperCase().trim();
  if (u === "NORTH" || u.startsWith("NORTH ")) return "North";
  if (u === "CENTRAL" || u.startsWith("CENTRAL ")) return "Central";
  if (u === "SOUTH" || u.startsWith("SOUTH ") || u === "SHORE") return "South";
  return "";
}

// Find column index by header name (case-insensitive).
function indexCols(headers) {
  const map = {};
  headers.forEach((h, i) => { map[String(h || "").trim().toUpperCase()] = i; });
  return map;
}

export function detectRegulars(rows, opts = {}) {
  const minOccurrences = opts.minOccurrences ?? 3;
  const maxTimeSpread = opts.maxTimeSpread ?? 120; // minutes
  const today = opts.today || new Date();
  const minYear = today.getFullYear() - 2;
  const maxYear = today.getFullYear() + 1;
  const eightWeeksAgo = new Date(today.getTime() - 8 * 7 * 86400000);
  const sixMonthsAgo = new Date(today.getTime() - 26 * 7 * 86400000);

  if (!rows || rows.length < 2) {
    return { regulars: [], stats: { total: 0, qualified: 0, skipped: 0, byFlag: {} } };
  }

  const headers = rows[0];
  const col = indexCols(headers);
  const get = (row, key) => {
    const i = col[key];
    return i != null && i < row.length ? String(row[i] || "").trim() : "";
  };

  // Group rows by (name_norm, venue_norm, day-of-week).
  const groups = new Map();
  let parsedCount = 0, skippedCount = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const name = get(row, "EVENT NAME");
    const venue = get(row, "VENUE NAME");
    const dateStr = get(row, "DATE");
    if (!name || !venue || !dateStr) { skippedCount++; continue; }
    const d = parseDate(dateStr);
    if (!d) { skippedCount++; continue; }
    if (d.getFullYear() < minYear || d.getFullYear() > maxYear) { skippedCount++; continue; }
    const day = weekendDay(d);
    if (!day) { skippedCount++; continue; }
    const key = norm(name) + "|" + norm(venue) + "|" + day;
    const instance = {
      date: d,
      time: get(row, "START TIME"),
      city: get(row, "CITY"),
      region: get(row, "SECTION OF NJ"),
      type: get(row, "EVENT TYPE"),
      postUrl: get(row, "POST URL") || get(row, "INSTAGRAM POST URL"),
      recurPattern: get(row, "RECURRENCE_PATTERN"),
      origName: name,
      origVenue: venue,
      day,
    };
    if (groups.has(key)) groups.get(key).push(instance);
    else groups.set(key, [instance]);
    parsedCount++;
  }

  const regulars = [];
  const flagCounts = {};
  for (const [key, instances] of groups) {
    // Explicit-weekly via RECURRENCE_PATTERN bypasses the occurrence threshold.
    const explicitWeekly = instances.some(i => {
      const days = patternToDays(i.recurPattern);
      return days && days.includes(instances[0].day);
    });
    const distinctDates = new Set(instances.map(i => i.date.toISOString().slice(0, 10)));
    if (!explicitWeekly && distinctDates.size < minOccurrences) continue;

    // Time spread check (skip if explicitly weekly)
    const times = instances.map(i => parseTimeMin(i.time)).filter(t => t != null);
    let timeSpread = 0;
    if (times.length >= 2) {
      timeSpread = Math.max(...times) - Math.min(...times);
      if (timeSpread > maxTimeSpread && !explicitWeekly) continue;
    }

    // Build the regular
    const dates = instances.map(i => i.date).sort((a, b) => a - b);
    const firstSeen = dates[0];
    const lastSeen = dates[dates.length - 1];
    const dateSpanDays = (lastSeen - firstSeen) / 86400000;
    const typicalTime = times.length ? median(times) : null;

    // Derive display fields from the most recent instance's values, fallback
    // to most common across instances.
    const recent = instances.slice().sort((a, b) => b.date - a.date)[0];
    const reg = {
      id: key,
      name: recent.origName || mostCommon(instances.map(i => i.origName)),
      venue: recent.origVenue || mostCommon(instances.map(i => i.origVenue)),
      area: recent.city || mostCommon(instances.map(i => i.city)),
      region: normalizeRegion(recent.region) || normalizeRegion(mostCommon(instances.map(i => i.region))),
      day: instances[0].day,
      time: typicalTime != null ? formatTimeFromMin(typicalTime) : (recent.time || ""),
      type: recent.type || mostCommon(instances.map(i => i.type)),
      postUrl: recent.postUrl,
      occurrenceCount: distinctDates.size,
      firstSeen: firstSeen.toISOString().slice(0, 10),
      lastSeen: lastSeen.toISOString().slice(0, 10),
      timeSpreadMin: timeSpread,
      explicitPattern: explicitWeekly,
      flags: [],
      source: "auto",
      rejected: false,
      confidence: 0, // computed below
    };

    // Internal flags
    if (lastSeen < eightWeeksAgo) reg.flags.push("STALE");
    if (distinctDates.size === minOccurrences && dateSpanDays > 180) reg.flags.push("LOW_CONFIDENCE");
    if (GENERIC_NAMES.has(reg.name.toUpperCase())) reg.flags.push("GENERIC_NAME");
    if (timeSpread > 90) reg.flags.push("TIME_DRIFT");
    if (lastSeen < new Date(today.getTime() - 6 * 7 * 86400000) && !reg.flags.includes("STALE")) {
      reg.flags.push("RECENT_GAP");
    }

    // Confidence score (0..1)
    let conf = 0.5;
    conf += Math.min(0.4, Math.max(0, (distinctDates.size - 3) * 0.05));
    if (explicitWeekly) conf += 0.2;
    if (reg.flags.includes("STALE")) conf -= 0.2;
    if (reg.flags.includes("GENERIC_NAME")) conf -= 0.2;
    if (reg.flags.includes("TIME_DRIFT")) conf -= 0.1;
    if (reg.flags.includes("LOW_CONFIDENCE")) conf -= 0.1;
    reg.confidence = Math.max(0, Math.min(1, conf));

    reg.flags.forEach(f => { flagCounts[f] = (flagCounts[f] || 0) + 1; });
    regulars.push(reg);
  }

  // Sort: highest confidence first, then most recent
  regulars.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.lastSeen.localeCompare(a.lastSeen);
  });

  return {
    regulars,
    stats: {
      parsed: parsedCount,
      skipped: skippedCount,
      qualified: regulars.length,
      byFlag: flagCounts,
    },
  };
}

// Spawn an event-shape object (compatible with the events store) from a
// regular, stamped with a real date for the upcoming weekend. Used by the
// future "Use this week" flow.
export function regularToEvent(reg, friDateStr) {
  const friParts = String(friDateStr || "").match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!friParts) return null;
  const mo = parseInt(friParts[1]), da = parseInt(friParts[2]);
  const yr = friParts[3]
    ? (friParts[3].length === 2 ? 2000 + parseInt(friParts[3]) : parseInt(friParts[3]))
    : new Date().getFullYear();
  const fri = new Date(yr, mo - 1, da);
  const offset = reg.day === "Sat" ? 1 : reg.day === "Sun" ? 2 : 0;
  const eventDate = new Date(fri.getTime() + offset * 86400000);
  return {
    id: Date.now() + Math.random() * 1e5,
    day: reg.day,
    time: reg.time,
    name: reg.name,
    venue: reg.venue,
    area: reg.area,
    region: reg.region || "North",
    type: reg.type,
    link: reg.postUrl || "",
    featured: false,
    emoji: "",
    date: eventDate.toISOString().slice(0, 10),
    fromRegular: reg.id,
  };
}
