// Shared event validation. Returns { warnings, totals } given an events array.
// `warnings` is a map of eventId → array of { type, msg } objects.
// `type` is "red" | "yellow" | "gray" by severity; `msg` may include a group
// suffix like "DUPE #3" so multiple events flagged together share a number.

const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function computeWarnings(events) {
  const warnings = {};
  let flagGroup = 1;

  // Missing fields
  events.forEach(ev => {
    const w = [];
    if (!ev.name || !ev.name.trim()) w.push({ type: "red", msg: "NO NAME" });
    if (!ev.day) w.push({ type: "red", msg: "NO DAY" });
    if (!ev.time || !String(ev.time).trim()) w.push({ type: "yellow", msg: "NO TIME" });
    if (!ev.venue || !String(ev.venue).trim()) w.push({ type: "yellow", msg: "NO VENUE" });
    if (!ev.region) w.push({ type: "yellow", msg: "NO REGION" });
    if (!ev.area || !String(ev.area).trim()) w.push({ type: "gray", msg: "NO CITY" });
    if (!ev.type || !String(ev.type).trim()) w.push({ type: "gray", msg: "NO TYPE" });
    if (w.length > 0) warnings[ev.id] = w;
  });

  // Exact name+day duplicates
  const seenNameDay = {};
  events.forEach(ev => {
    const key = normalize(ev.name) + "|" + (ev.day || "");
    if (!key || key === "|" || !normalize(ev.name)) return;
    if (seenNameDay[key]) {
      if (!seenNameDay[key].group) seenNameDay[key].group = flagGroup++;
      const g = seenNameDay[key].group;
      seenNameDay[key].ids.push(ev.id);
      seenNameDay[key].ids.forEach(id => {
        if (!warnings[id]) warnings[id] = [];
        if (!warnings[id].some(w => w.msg.startsWith("DUPE"))) {
          warnings[id].push({ type: "yellow", msg: `DUPE #${g}` });
        }
      });
    } else {
      seenNameDay[key] = { ids: [ev.id], group: null };
    }
  });

  // Same venue + same day (different events at same location)
  const seenVenueDay = {};
  events.forEach(ev => {
    if (!ev.venue || !String(ev.venue).trim()) return;
    const key = normalize(ev.venue) + "|" + (ev.day || "");
    if (seenVenueDay[key]) {
      if (!seenVenueDay[key].group) seenVenueDay[key].group = flagGroup++;
      const g = seenVenueDay[key].group;
      seenVenueDay[key].ids.push(ev.id);
      seenVenueDay[key].ids.forEach(id => {
        if (!warnings[id]) warnings[id] = [];
        if (!warnings[id].some(w => w.msg.startsWith("VENUE"))) {
          warnings[id].push({ type: "gray", msg: `VENUE #${g}` });
        }
      });
    } else {
      seenVenueDay[key] = { ids: [ev.id], group: null };
    }
  });

  // Same name+venue+time across different days (probably same event listed twice)
  const seenCrossDay = {};
  events.forEach(ev => {
    if (!ev.name || !ev.venue) return;
    const key = normalize(ev.name) + "|" + normalize(ev.venue) + "|" + normalize(ev.time);
    if (seenCrossDay[key]) {
      if (!seenCrossDay[key].group) seenCrossDay[key].group = flagGroup++;
      const g = seenCrossDay[key].group;
      seenCrossDay[key].ids.push(ev.id);
      seenCrossDay[key].ids.forEach(id => {
        if (!warnings[id]) warnings[id] = [];
        if (!warnings[id].some(w => w.msg.startsWith("MULTI"))) {
          warnings[id].push({ type: "yellow", msg: `MULTI #${g}` });
        }
      });
    } else {
      seenCrossDay[key] = { ids: [ev.id], group: null };
    }
  });

  // Event name mentions a day that doesn't match its assigned day
  const dayNames = { friday: "Fri", fridays: "Fri", saturday: "Sat", saturdays: "Sat", sunday: "Sun", sundays: "Sun" };
  events.forEach(ev => {
    if (!ev.name) return;
    const nameLower = String(ev.name).toLowerCase();
    for (const [word, abbr] of Object.entries(dayNames)) {
      if (nameLower.includes(word) && ev.day !== abbr) {
        if (!warnings[ev.id]) warnings[ev.id] = [];
        warnings[ev.id].push({ type: "yellow", msg: "WRONG DAY?" });
        break;
      }
    }
  });

  return warnings;
}

// Helper: find event ids that share the same flag group (e.g. all DUPE #3 events).
export function findFlagPartners(warnings, evId, flagMsg) {
  const match = String(flagMsg).match(/#(\d+)/);
  if (!match) return [];
  const groupNum = match[1];
  return Object.entries(warnings)
    .filter(([id, ws]) => String(id) !== String(evId) && ws.some(w => w.msg.includes(`#${groupNum}`)))
    .map(([id]) => Number(id) || id);
}
