// Shared event validation. Returns { warnings, totals } given an events array.
// `warnings` is a map of eventId → array of { type, msg } objects.
// `type` is "red" | "yellow" | "gray" by severity; `msg` may include a group
// suffix like "DUPE #3" so multiple events flagged together share a number.

const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function computeWarnings(events) {
  const warnings = {};
  let flagGroup = 1;

  const addWarn = (id, warn) => {
    (warnings[id] || (warnings[id] = [])).push(warn);
  };

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

  // Group-flagging passes. Each event is tagged AT MOST ONCE per pass, so we
  // tag on the fly instead of re-walking the whole group every time a new
  // member joins. The old code re-scanned + `.some()`-checked every existing
  // member on each insert — O(M²) per bucket, which froze the tab (and OOM'd)
  // on large or duplicate-heavy imports where one bucket holds hundreds of
  // rows. This is O(N): the first member is tagged when the group forms (its
  // second member arrives), every later member tags only itself.
  //
  //   keyFor  — returns the bucket key, or null to skip this event
  //   prefix  — flag label prefix ("DUPE" / "VENUE" / "MULTI")
  //   type    — severity color for the pushed warning
  const flagGroups = (keyFor, prefix, type) => {
    const seen = {};
    events.forEach(ev => {
      const key = keyFor(ev);
      if (key == null) return;
      const bucket = seen[key];
      if (!bucket) {
        seen[key] = { firstId: ev.id, group: null };
        return;
      }
      if (bucket.group == null) {
        bucket.group = flagGroup++;
        addWarn(bucket.firstId, { type, msg: `${prefix} #${bucket.group}` });
      }
      addWarn(ev.id, { type, msg: `${prefix} #${bucket.group}` });
    });
  };

  // Exact name+day duplicates
  flagGroups(ev => {
    const n = normalize(ev.name);
    if (!n) return null;
    return n + "|" + (ev.day || "");
  }, "DUPE", "yellow");

  // Same venue + same day (different events at same location)
  flagGroups(ev => {
    if (!ev.venue || !String(ev.venue).trim()) return null;
    return normalize(ev.venue) + "|" + (ev.day || "");
  }, "VENUE", "gray");

  // Same name+venue+time across different days (probably same event listed twice)
  flagGroups(ev => {
    if (!ev.name || !ev.venue) return null;
    return normalize(ev.name) + "|" + normalize(ev.venue) + "|" + normalize(ev.time);
  }, "MULTI", "yellow");

  // Event name mentions a day that doesn't match its assigned day
  const dayNames = { friday: "Fri", fridays: "Fri", saturday: "Sat", saturdays: "Sat", sunday: "Sun", sundays: "Sun" };
  events.forEach(ev => {
    if (!ev.name) return;
    const nameLower = String(ev.name).toLowerCase();
    for (const [word, abbr] of Object.entries(dayNames)) {
      if (nameLower.includes(word) && ev.day !== abbr) {
        if (!warnings[ev.id]) warnings[ev.id] = [];
        warnings[ev.id].push({ type: "gray", msg: "WRONG DAY?" });
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
