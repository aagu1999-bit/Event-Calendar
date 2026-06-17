import { useState, useRef, useMemo, useEffect, Fragment } from "react";
import * as XLSX from "xlsx";
import { useEventsStore, useRegularsStore } from "../store";
import { parseRows, DAYFUL, getEmoji } from "../shared/parseEvents";
import { computeWarnings, findFlagPartners } from "../shared/validateEvents";
import { detectRegulars } from "../shared/regulars";
import { normalizeHandle } from "../shared/parseEvents";
import { UInput } from "../shared/inputs.jsx";
import { ReviewSessionsModal } from "../shared/ReviewSessionsModal.jsx";
import { rememberLastSession, getLastSession, forgetLastSession, loadSession } from "../shared/reviewSessions.js";

// Flag glossary — shown in the collapsible cheat sheet. Order matters
// (most-severe first); descriptions are 1-line so the grid stays tight.
const FLAG_GLOSSARY = [
  { tag: "NO NAME",                 desc: "Event has no name. Can't be rendered. Auto-rejected." },
  { tag: "NO DAY",                  desc: "No day assigned (Fri/Sat/Sun). Auto-rejected." },
  { tag: "NO TIME",                 desc: "Time missing. Event will show without a time." },
  { tag: "NO VENUE",                desc: "Venue missing." },
  { tag: "NO REGION",               desc: "Region missing (North/Central/South)." },
  { tag: "NO CITY",                 desc: "City/area missing. Minor — won't break renders." },
  { tag: "NO TYPE",                 desc: "Event type missing. Won't get an emoji." },
  { tag: "DUPE #N",                 desc: "Exact name+day match in this upload. Click to trace partners." },
  { tag: "VENUE #N",                desc: "Same venue+day, different name (possible mix-up). Click to trace." },
  { tag: "MULTI #N",                desc: "Same event listed on multiple days. Could be a real recurring event." },
  { tag: "WRONG DAY?",              desc: "Name mentions a day that doesn't match the assigned day." },
  { tag: "ALREADY IN STORE",        desc: "Same name+day already exists in your shared events store (used by every tool — Calendar/Newsletter/Reel/Flyer/Media). Probably a re-import." },
  { tag: "SAME VENUE/DAY IN STORE", desc: "Different event with same venue+day as something already in the shared store. Possible double-booking or scheduling conflict." },
  { tag: "REGION? (... NORTH)",     desc: "Union County city not tagged NORTH per local convention." },
  { tag: "TIME?",                   desc: "Time/type combo looks suspicious (e.g. PARTY at 11am)." },
];

// User's local NJ convention: Union County cities are tagged NORTH locally,
// not CENTRAL (per [[event_scout_nj_region_convention]] memory).
const NJ_NORTH_OVERRIDE_CITIES = [
  "elizabeth", "union", "hillside", "clark",
  "linden", "rahway", "kenilworth", "roselle", "roselle park",
  "cranford", "summit", "berkeley heights", "garwood",
  "mountainside", "new providence", "plainfield", "scotch plains",
  "springfield", "westfield",
];

// Suspicious time vs event-type combos that hint at a typo.
function timeTypeSuspect(ev) {
  if (!ev.time || !ev.type) return null;
  const t = String(ev.time).toLowerCase();
  const isAM = /\b(am|a\.m\.)\b/.test(t);
  const isLatePM = /\b(10|11|12)\s*pm\b/.test(t);
  const type = String(ev.type).toUpperCase();
  const morningTypes = ["BRUNCH", "DAY PARTY", "YOGA", "WALK", "RUN", "MARKET", "POP-UP", "FAMILY SKATE"];
  const nightTypes = ["CLUB NIGHT", "NIGHTCLUB", "PARTY", "DJ NIGHT", "DJ SET"];
  if (isLatePM && morningTypes.includes(type)) return "TIME?";
  if (isAM && nightTypes.includes(type)) return "TIME?";
  return null;
}

function augmentEvents(newEvents, existingEvents) {
  // Start from existing validateEvents warning system (covers missing fields,
  // name+day dupes, venue+day collisions, multi-day reposts, wrong-day mentions).
  const warnings = computeWarnings(newEvents);

  // NJ region override — Union County cities should be NORTH locally.
  newEvents.forEach(ev => {
    const area = (ev.area || "").toLowerCase().trim();
    if (!area) return;
    const isUnionCounty = NJ_NORTH_OVERRIDE_CITIES.some(c => area === c || area.includes(c));
    if (isUnionCounty && ev.region && ev.region !== "North") {
      if (!warnings[ev.id]) warnings[ev.id] = [];
      warnings[ev.id].push({ type: "yellow", msg: `REGION? (${ev.area} is locally NORTH)` });
    }
  });

  // Cross-reference against existing events store — flag potential dupes.
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const existingKeys = new Set(existingEvents.map(e => norm(e.name) + "|" + (e.day || "")));
  const existingVenueDay = new Set(existingEvents.map(e => norm(e.venue) + "|" + (e.day || "")));
  newEvents.forEach(ev => {
    const k = norm(ev.name) + "|" + (ev.day || "");
    if (k && norm(ev.name) && existingKeys.has(k)) {
      if (!warnings[ev.id]) warnings[ev.id] = [];
      warnings[ev.id].push({ type: "yellow", msg: "ALREADY IN STORE" });
    }
    const vk = norm(ev.venue) + "|" + (ev.day || "");
    if (vk && norm(ev.venue) && existingVenueDay.has(vk) && !existingKeys.has(k)) {
      if (!warnings[ev.id]) warnings[ev.id] = [];
      warnings[ev.id].push({ type: "gray", msg: "SAME VENUE/DAY IN STORE" });
    }
  });

  // Suspicious time/type combinations.
  newEvents.forEach(ev => {
    const sus = timeTypeSuspect(ev);
    if (sus) {
      if (!warnings[ev.id]) warnings[ev.id] = [];
      warnings[ev.id].push({ type: "yellow", msg: sus });
    }
  });

  return warnings;
}

const L = { display: "block", fontSize: "0.6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.55)", marginBottom: "6px" };
const B = { padding: "8px 14px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.7rem", cursor: "pointer", letterSpacing: "1px", textTransform: "uppercase" };
const Bgold = { ...B, background: "#E5BC4F", color: "#000", border: "none", fontWeight: 700 };
const editInputStyle = {
  padding: "6px 8px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(245,240,232,0.18)",
  borderRadius: "4px",
  color: "#F5F0E8",
  fontFamily: "inherit",
  fontSize: "0.78rem",
  outline: "none",
};

// All pills use brand gold (no severity color split) — uniform gold catches
// the eye more than a muted yellow/gray scale, and severity is already
// implicit in the tag name + the row-level 🚩 emoji.
const PILL_STYLE = {
  bg: "rgba(229,188,79,0.18)",
  color: "#E5BC4F",
  border: "1px solid rgba(229,188,79,0.4)",
};
const PILL_HIGHLIGHTED = {
  bg: "rgba(229,188,79,0.85)",
  color: "#0a0a0a",
  border: "1px solid #E5BC4F",
};

export default function ReviewQueue() {
  const events = useEventsStore(s => s.events);
  const updateEvents = useEventsStore(s => s.updateEvents);
  // Approvals lifted into the store (was useState here) so Review Sessions
  // can save and restore the user's checkbox state alongside the events.
  const approvals = useEventsStore(s => s.approvals);
  const setApprovals = useEventsStore(s => s.setApprovals);

  // Review Sessions modal state + last-loaded session name (drives the
  // "Session: <name>" pill in the header so the user remembers where
  // they are).
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [lastSessionName, setLastSessionName] = useState(() => getLastSession());

  const setEvents = useEventsStore(s => s.setEvents);

  // Auto-load the most-recently-used session on mount (once). Skipped if
  // local already has events (user came back to an in-progress workspace)
  // or no session is remembered.
  useEffect(() => {
    const name = getLastSession();
    if (!name) return;
    if ((events?.length || 0) > 0) return; // user has working state — don't clobber
    (async () => {
      try {
        const payload = await loadSession(name);
        if (Array.isArray(payload?.events)) setEvents(payload.events);
        if (payload?.approvals && typeof payload.approvals === "object") setApprovals(payload.approvals);
        if (Array.isArray(payload?.vetted)) setVettedArr(payload.vetted);
        setLastSessionName(name);
      } catch (err) {
        // Session was deleted or Repl offline — clear the pointer so we
        // don't keep trying to load a ghost.
        console.warn("Auto-load session failed:", err);
        forgetLastSession();
        setLastSessionName(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the payload Review Sessions snapshots — captures the full
  // working state so loading a session puts you back exactly where you
  // were: every event (worked-on OR not), the ✓ vetted markers, the
  // selection checkboxes, the filter + sort. Flagged status is computed
  // from the events themselves at render time, so it doesn't need to be
  // persisted explicitly.
  const getSessionPayload = () => ({
    events,
    approvals,
    vetted: vettedArr,
    filter,
    sortByTag,
  });

  // Apply a loaded session: replace store events + approvals + vetted,
  // remember the session name so the header pill updates and the next
  // boot can auto-load it.
  const applyLoadedSession = (payload, name) => {
    if (Array.isArray(payload?.events)) setEvents(payload.events);
    if (payload?.approvals && typeof payload.approvals === "object") setApprovals(payload.approvals);
    if (Array.isArray(payload?.vetted)) setVettedArr(payload.vetted);
    if (typeof payload?.filter === "string") setFilter(payload.filter);
    if (typeof payload?.sortByTag === "string" || payload?.sortByTag === null) setSortByTag(payload?.sortByTag || null);
    rememberLastSession(name);
    setLastSessionName(name);
  };

  const [pending, setPending] = useState([]); // parsed Event[]
  // Approval is a separate stamp from selection: marking a row "approved"
  // says it has been vetted, distinct from "selected for an action".
  // Backed by the store now (was useState) so it survives nav AND gets
  // captured in Review Sessions. Component code still consumes a Set
  // (existing .has() + function-updater callsites) — we shim Set ↔ Array
  // around the store's array-backed `vetted` field.
  const vettedArr = useEventsStore(s => s.vetted);
  const setVettedArr = useEventsStore(s => s.setVetted);
  const approvedSet = useMemo(() => new Set(vettedArr || []), [vettedArr]);
  const setApprovedSet = (updaterOrSet) => {
    const current = new Set(vettedArr || []);
    const next = typeof updaterOrSet === "function" ? updaterOrSet(current) : updaterOrSet;
    setVettedArr(Array.from(next || []));
  };
  const [filter, setFilter] = useState("all"); // all | clean | flagged | unapproved | approved
  const [sortByTag, setSortByTag] = useState(null); // tag name to float to top (separate from filter)
  // Highlighted group captures the event IDs at click time so the sort/highlight
  // survives re-validation (group numbers renumber when events are deleted).
  // Shape: { prefix: "VENUE", label: "VENUE #31", ids: Set<id> } or null.
  const [highlightedGroup, setHighlightedGroup] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [storeOpen, setStoreOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);   // event id being inline-edited
  const [editDraft, setEditDraft] = useState({});     // in-progress edit fields (separate from pending so validation doesn't re-run per keystroke)
  // Collapse state persists across sessions so the user's preference sticks.
  const [legendOpen, setLegendOpen] = useState(() => {
    try { return localStorage.getItem("review_legendOpen") === "true"; } catch { return false; }
  });
  const [summaryOpen, setSummaryOpen] = useState(() => {
    try { return localStorage.getItem("review_summaryOpen") !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("review_legendOpen", String(legendOpen)); } catch {} }, [legendOpen]);
  useEffect(() => { try { localStorage.setItem("review_summaryOpen", String(summaryOpen)); } catch {} }, [summaryOpen]);
  // Auto-clear highlighted group when all its events are gone from pending
  useEffect(() => {
    if (!highlightedGroup) return;
    const stillThere = pending.some(e => highlightedGroup.ids.has(e.id));
    if (!stillThere) setHighlightedGroup(null);
  }, [pending, highlightedGroup]);
  const fileRef = useRef(null);
  const masterFileRef = useRef(null);
  const rowsRef = useRef(null);

  // Weekly Regulars — master-sheet importer.
  const regulars = useRegularsStore(s => s.regulars);
  const lastRegularsImport = useRegularsStore(s => s.lastImport);
  const replaceRegulars = useRegularsStore(s => s.replaceAll);
  const [masterImporting, setMasterImporting] = useState(false);

  const handleMasterSheet = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMasterImporting(true);
    try {
      // Read as text so xlsx doesn't convert ISO date strings into serial
      // numbers (which then get timezone-shifted on the way back to strings).
      const text = await file.text();
      const wb = XLSX.read(text, { type: "string", raw: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
      const { regulars: regs, stats } = detectRegulars(rows);
      replaceRegulars(regs, stats);
      const flagLine = Object.entries(stats.byFlag).map(([k, v]) => `${k}: ${v}`).join(" · ");
      alert(
        `Master sheet imported.\n\n` +
        `${stats.parsed.toLocaleString()} weekend events parsed · ${stats.skipped.toLocaleString()} skipped\n` +
        `${regs.length} weekly regulars detected\n\n` +
        `Internal flags — ${flagLine || "(none)"}`
      );
    } catch (err) {
      console.error("Master sheet import failed:", err);
      alert("Couldn't import master sheet. Make sure it's a CSV with the expected columns. Error: " + err.message);
    } finally {
      setMasterImporting(false);
      if (masterFileRef.current) masterFileRef.current.value = "";
    }
  };

  // When a sort activates (tag chip or group pill), scroll the list top into
  // view so the user sees the floated events without manual scrolling.
  useEffect(() => {
    if ((sortByTag || highlightedGroup) && rowsRef.current) {
      rowsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [sortByTag, highlightedGroup]);

  // Augmenter runs whenever pending/store changes
  const warnings = useMemo(() => augmentEvents(pending, events), [pending, events]);

  // Count how many events carry each flag-tag (DUPE #1 and DUPE #2 collapse
  // into one "DUPE" bucket so the summary stays readable).
  const flagSummary = useMemo(() => {
    const counts = {};
    Object.values(warnings).forEach(ws => {
      ws.forEach(w => {
        // Strip group numbers ("DUPE #3" -> "DUPE", "REGION? (...)" -> "REGION?")
        const key = w.msg.replace(/\s*#\d+\s*/, "").replace(/\s*\(.*\)\s*/, "").trim();
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [warnings]);

  // Helper — match a flag tag in summary to its event count for filter
  const eventsWithFlagTag = (tag) => pending.filter(ev => {
    const ws = warnings[ev.id] || [];
    return ws.some(w => {
      const key = w.msg.replace(/\s*#\d+\s*/, "").replace(/\s*\(.*\)\s*/, "").trim();
      return key === tag;
    });
  });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      const parsed = parseRows(rows);
      // Give each event a stable string id so React keys + selection work
      const withIds = parsed.map((ev, i) => ({ ...ev, id: `pending_${Date.now()}_${i}` }));
      setPending(withIds);
      // Nothing pre-selected and nothing pre-approved — clicking the checkbox
      // now means "select for a bulk action", and Approve is a separate
      // explicit stamp. User wants full control: hit + Add to push straight
      // to the calendar, or multi-select then bulk-approve / bulk-add / delete.
      setApprovals({});
      setApprovedSet(new Set());
    } catch (err) {
      console.error("CSV parse failed:", err);
      alert("Couldn't parse that file. Make sure it's CSV/XLSX with a header row.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const toggle = (id) => setApprovals(a => ({ ...a, [id]: !a[id] }));
  const approveAll = () => setApprovals(Object.fromEntries(pending.map(e => [e.id, true])));
  const approveClean = () => {
    const next = {};
    pending.forEach(ev => {
      const w = warnings[ev.id] || [];
      next[ev.id] = w.length === 0;
    });
    setApprovals(next);
  };
  const rejectAll = () => setApprovals(Object.fromEntries(pending.map(e => [e.id, false])));

  // Direct-add: push a single event to the events store immediately, no
  // queue / no "import" step. User asked for an explicit + Add button per
  // row that bypasses the selection model.
  const addRowToCalendar = (id) => {
    const ev = pending.find(e => e.id === id);
    if (!ev) return;
    const fresh = { ...ev, id: Date.now() + Math.random() * 1e5 };
    updateEvents(prev => [...prev, fresh]);
    setPending(p => p.filter(e => e.id !== id));
    setApprovals(a => { const next = { ...a }; delete next[id]; return next; });
    setApprovedSet(s => { const next = new Set(s); next.delete(id); return next; });
    if (editingId === id) { setEditingId(null); setEditDraft({}); }
  };

  // Bulk-add: push every currently-selected event to the store at once.
  const addSelectedToCalendar = () => {
    const sel = pending.filter(e => approvals[e.id]);
    if (sel.length === 0) return;
    const fresh = sel.map(e => ({ ...e, id: Date.now() + Math.random() * 1e5 }));
    updateEvents(prev => [...prev, ...fresh]);
    const ids = new Set(sel.map(e => e.id));
    setPending(p => p.filter(e => !ids.has(e.id)));
    setApprovals(a => { const next = { ...a }; ids.forEach(id => { delete next[id]; }); return next; });
    setApprovedSet(s => { const next = new Set(s); ids.forEach(id => next.delete(id)); return next; });
    if (editingId && ids.has(editingId)) { setEditingId(null); setEditDraft({}); }
  };

  // Approval is independent of selection: a row can be selected, approved,
  // both, or neither. Approve stamps "I've vetted this"; the row stays in the
  // queue (use + Add or bulk-add to push it to the calendar).
  const toggleApprove = (id) => setApprovedSet(s => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const approveSelected = () => {
    const ids = pending.filter(e => approvals[e.id]).map(e => e.id);
    if (ids.length === 0) return;
    setApprovedSet(s => { const next = new Set(s); ids.forEach(id => next.add(id)); return next; });
  };
  const unapproveSelected = () => {
    const ids = pending.filter(e => approvals[e.id]).map(e => e.id);
    if (ids.length === 0) return;
    setApprovedSet(s => { const next = new Set(s); ids.forEach(id => next.delete(id)); return next; });
  };

  // Bulk-delete: remove every currently-selected event from the pending list.
  const deleteSelected = () => {
    const ids = new Set(pending.filter(e => approvals[e.id]).map(e => e.id));
    if (ids.size === 0) return;
    if (ids.size > 5 && !window.confirm(`Delete ${ids.size} selected rows from this review?`)) return;
    setPending(p => p.filter(e => !ids.has(e.id)));
    setApprovals(a => { const next = { ...a }; ids.forEach(id => { delete next[id]; }); return next; });
    setApprovedSet(s => { const next = new Set(s); ids.forEach(id => next.delete(id)); return next; });
    if (editingId && ids.has(editingId)) { setEditingId(null); setEditDraft({}); }
  };

  const visible = useMemo(() => {
    let list;
    if (filter === "all") list = pending;
    else if (filter === "clean") list = pending.filter(e => (warnings[e.id] || []).length === 0);
    else if (filter === "flagged") list = pending.filter(e => (warnings[e.id] || []).length > 0 && !approvals[e.id]);
    else if (filter === "approved") list = pending.filter(e => approvedSet.has(e.id));
    else if (filter === "unapproved") list = pending.filter(e => !approvals[e.id]);
    else list = pending;

    // Search filter — additive on top of the active filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(e =>
        (e.name || "").toLowerCase().includes(q) ||
        (e.venue || "").toLowerCase().includes(q) ||
        (e.area || "").toLowerCase().includes(q)
      );
    }

    // Sort-to-top by tag (broad): when a tag is selected from the breakdown,
    // float all matching events up. Hides nothing — context stays visible.
    if (sortByTag) {
      const tagMatch = (ev) => {
        const ws = warnings[ev.id] || [];
        return ws.some(w => {
          const key = w.msg.replace(/\s*#\d+\s*/, "").replace(/\s*\(.*\)\s*/, "").trim();
          return key === sortByTag;
        });
      };
      list = [...list].sort((a, b) => {
        const aHas = tagMatch(a);
        const bHas = tagMatch(b);
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        return 0;
      });
    }

    // Sort-to-top by group (narrow — wins over tag sort): float events whose
    // IDs were captured when the user clicked the numbered flag pill. IDs are
    // stable across re-validation, so deleting a row doesn't break the focus.
    if (highlightedGroup) {
      const ids = highlightedGroup.ids;
      list = [...list].sort((a, b) => {
        const aIn = ids.has(a.id);
        const bIn = ids.has(b.id);
        if (aIn && !bIn) return -1;
        if (!aIn && bIn) return 1;
        return 0;
      });
    }
    return list;
  }, [pending, warnings, approvals, approvedSet, filter, searchQuery, sortByTag, highlightedGroup]);

  const approvedCount = pending.filter(e => approvals[e.id]).length;
  const flaggedCount = pending.filter(e => (warnings[e.id] || []).length > 0).length;

  // Filter-aware select-all toggle for the visible subset
  const allVisibleApproved = visible.length > 0 && visible.every(e => approvals[e.id]);
  const someVisibleApproved = visible.some(e => approvals[e.id]);
  const toggleAllVisible = () => {
    const next = !allVisibleApproved;
    setApprovals(a => {
      const updated = { ...a };
      visible.forEach(e => { updated[e.id] = next; });
      return updated;
    });
  };

  // Click flag pill → capture all event ids sharing that group at click time
  // (stable across re-validation). Click again on same group → clear.
  const clickFlag = (msg) => {
    if (!/#\d+/.test(msg)) return; // only grouped flags are clickable
    if (highlightedGroup && highlightedGroup.label === msg) {
      setHighlightedGroup(null);
      return;
    }
    const numMatch = msg.match(/#(\d+)/);
    if (!numMatch) return;
    const num = numMatch[1];
    const prefix = msg.replace(/#\d+.*$/, "").trim();
    const ids = new Set();
    Object.entries(warnings).forEach(([id, ws]) => {
      if (ws.some(w => {
        const wm = w.msg.match(/#(\d+)/);
        const wp = w.msg.replace(/#\d+.*$/, "").trim();
        return wm && wp === prefix && wm[1] === num;
      })) ids.add(id);
    });
    setHighlightedGroup({ prefix, label: msg, ids });
  };
  const isPillInHighlightedGroup = (msg, evId) => {
    if (!highlightedGroup) return false;
    if (!highlightedGroup.ids.has(evId)) return false;
    const wp = msg.replace(/#\d+.*$/, "").trim();
    return wp === highlightedGroup.prefix;
  };
  const isRowInHighlightedGroup = (ev) => {
    return highlightedGroup ? highlightedGroup.ids.has(ev.id) : false;
  };

  // Events in the currently highlighted group — by captured ids, not by
  // current group number (which may have renumbered after deletions).
  const eventsInHighlightedGroup = () => {
    if (!highlightedGroup) return [];
    return pending.filter(ev => highlightedGroup.ids.has(ev.id));
  };
  const approveGroup = () => {
    const ids = eventsInHighlightedGroup().map(e => e.id);
    if (ids.length === 0) return;
    setApprovals(a => { const next = { ...a }; ids.forEach(id => { next[id] = true; }); return next; });
  };
  const skipGroup = () => {
    const ids = eventsInHighlightedGroup().map(e => e.id);
    if (ids.length === 0) return;
    setApprovals(a => { const next = { ...a }; ids.forEach(id => { next[id] = false; }); return next; });
  };
  const deleteGroup = () => {
    const grp = eventsInHighlightedGroup();
    if (grp.length === 0) return;
    if (!window.confirm(`Delete ${grp.length} events in ${highlightedGroup} from the upload?`)) return;
    const ids = new Set(grp.map(e => e.id));
    setPending(p => p.filter(e => !ids.has(e.id)));
    setApprovals(a => { const next = { ...a }; ids.forEach(id => { delete next[id]; }); return next; });
    setApprovedSet(s => { const next = new Set(s); ids.forEach(id => next.delete(id)); return next; });
    setHighlightedGroup(null);
  };

  // Delete row(s) from pending entirely — distinct from "deselect" which
  // leaves the row in view. Delete removes them and they no longer count
  // toward any tally.
  const deleteRow = (id) => {
    setPending(p => p.filter(e => e.id !== id));
    setApprovals(a => { const next = { ...a }; delete next[id]; return next; });
    setApprovedSet(s => { const next = new Set(s); next.delete(id); return next; });
    if (editingId === id) { setEditingId(null); setEditDraft({}); }
  };
  const deleteVisible = () => {
    if (visible.length === 0) return;
    if (visible.length > 5 && !window.confirm(`Delete ${visible.length} rows from the upload? They'll be gone from this review — re-upload the sheet to get them back.`)) return;
    const ids = new Set(visible.map(e => e.id));
    setPending(p => p.filter(e => !ids.has(e.id)));
    setApprovals(a => {
      const next = { ...a };
      ids.forEach(id => { delete next[id]; });
      return next;
    });
    setApprovedSet(s => { const next = new Set(s); ids.forEach(id => next.delete(id)); return next; });
    if (editingId && ids.has(editingId)) { setEditingId(null); setEditDraft({}); }
  };

  // Inline-edit helpers
  const startEdit = (ev) => {
    setEditingId(ev.id);
    setEditDraft({
      name:     ev.name     || "",
      day:      ev.day      || "Fri",
      time:     ev.time     || "",
      venue:    ev.venue    || "",
      area:     ev.area     || "",
      region:   ev.region   || "North",
      type:     ev.type     || "",
      igHandle: ev.igHandle || "",
      link:     ev.link     || "",
    });
  };
  const saveEdit = () => {
    if (!editingId) return;
    // Normalize handle on save so trailing slashes / URL paste / leading @
    // collapse into the canonical form.
    const cleaned = { ...editDraft, igHandle: normalizeHandle(editDraft.igHandle) };
    setPending(p => p.map(e => e.id === editingId ? { ...e, ...cleaned } : e));
    setEditingId(null);
    setEditDraft({});
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft({});
  };
  const editField = (k, v) => setEditDraft(d => ({ ...d, [k]: v }));

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1rem" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "2px" }}>
            Review Queue
          </h1>
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Augment your sheet — extra checks Excel can't do
          </span>
        </div>

        {/* Upload bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: "1rem",
          padding: "12px 16px", marginBottom: "1rem",
          background: "rgba(229,188,79,0.06)",
          border: "1px solid rgba(229,188,79,0.18)",
          borderRadius: "6px",
        }}>
          <div style={{ flex: 1, fontSize: "0.7rem", color: "rgba(245,240,232,0.7)" }}>
            {pending.length === 0
              ? <>Upload your cleaned <strong>CSV or XLSX</strong> from Excel / Google Sheets. The augmenter will flag missing fields, dupes (within batch <em>and</em> against the {events.length}-event store), region-convention mismatches, and suspicious time/type combos. Hit <strong>+ Add</strong> on a row to push it straight to the calendar, <strong>Approve</strong> to mark as vetted, or use the checkboxes to multi-select for bulk actions.</>
              : <>
                  <strong>{pending.length}</strong> events parsed ·
                  <strong style={{ marginLeft: 8 }}>{flaggedCount}</strong> flagged ·
                  <strong style={{ marginLeft: 8 }}>{approvedSet.size}</strong> approved ·
                  <strong style={{ marginLeft: 8 }}>{approvedCount}</strong> selected
                </>
            }
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
          <button onClick={() => fileRef.current?.click()} style={Bgold}>
            {pending.length === 0 ? "Upload sheet" : "+ Add sheet"}
          </button>
          {/* Sessions — named save points for the events + approvals.
              Replaces the deleted live-sync architecture. Click to open
              the picker (load existing) or use the "+ Save Current as New"
              button inside to capture the current state. */}
          <button
            onClick={() => setSessionsOpen(true)}
            title={lastSessionName ? `Sessions — currently working in "${lastSessionName}". Click to load another or save the current state.` : "Save the current events + approvals as a named session, or load one."}
            style={{
              padding: "6px 12px",
              background: "rgba(52,211,153,0.10)",
              border: "1px solid rgba(52,211,153,0.35)",
              borderRadius: "5px",
              color: "#34D399",
              fontSize: "0.6rem",
              fontWeight: 700,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >📁 {lastSessionName ? `Session: ${lastSessionName.length > 14 ? lastSessionName.slice(0, 14) + "…" : lastSessionName}` : "Sessions"}</button>
        </div>

        {/* Weekly Regulars — master-sheet importer (step 1: no browse UI yet). */}
        <div style={{
          marginBottom: "1rem",
          padding: "10px 14px",
          background: "rgba(124,58,237,0.06)",
          border: "1px solid rgba(124,58,237,0.18)",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          gap: "0.8rem",
        }}>
          <div style={{ flex: 1, fontSize: "0.65rem", color: "rgba(245,240,232,0.7)", lineHeight: 1.5 }}>
            <strong style={{ color: "#C084FC", letterSpacing: "1.5px", textTransform: "uppercase", fontSize: "0.6rem", display: "block", marginBottom: "3px" }}>
              Weekly Regulars · master sheet
            </strong>
            {regulars.length === 0
              ? <>Upload your full history CSV (e.g. <em>Instagram_Events_Master</em>) to detect recurring Fri/Sat/Sun events. Stored locally; browse UI coming next step.</>
              : <>
                  <strong style={{ color: "#C084FC" }}>{regulars.length}</strong> weekly regulars detected ·
                  imported {lastRegularsImport ? new Date(lastRegularsImport).toLocaleDateString() : "—"}
                </>
            }
          </div>
          <input ref={masterFileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleMasterSheet} style={{ display: "none" }} />
          <button
            onClick={() => masterFileRef.current?.click()}
            disabled={masterImporting}
            style={{
              ...B,
              background: masterImporting ? "rgba(124,58,237,0.15)" : "rgba(124,58,237,0.18)",
              borderColor: "rgba(124,58,237,0.45)",
              color: "#C084FC",
              opacity: masterImporting ? 0.6 : 1,
              cursor: masterImporting ? "wait" : "pointer",
            }}
          >
            {masterImporting ? "Detecting…" : regulars.length > 0 ? "Re-import" : "Import master CSV"}
          </button>
        </div>

        {/* What's in your store — explains where ALREADY IN STORE flags come from */}
        <details
          open={storeOpen}
          onToggle={e => setStoreOpen(e.target.open)}
          style={{ marginBottom: "1rem", background: "rgba(245,240,232,0.03)", border: "1px solid rgba(245,240,232,0.08)", borderRadius: "6px" }}
        >
          <summary style={{ padding: "10px 14px", cursor: "pointer", fontSize: "0.65rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.7)" }}>
            {storeOpen ? "▾" : "▸"} What's in your store ({events.length} event{events.length === 1 ? "" : "s"})
          </summary>
          <div style={{ padding: "0 14px 14px" }}>
            <p style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.6, marginBottom: "10px" }}>
              The <strong style={{ color: "#E5BC4F" }}>store</strong> is your shared event database used by every tool in the app — Calendar, Newsletter, Reel, Flyer, Media. Events land here from any tool's upload (this Review tab's import, Calendar's Excel import, Newsletter's paste, etc.) and persist across sessions (localStorage).
              The <strong style={{ color: "#E5BC4F" }}>ALREADY IN STORE</strong> flag means a new event in your current upload has the same name+day as something already in here. Probably a re-import — fine to skip, OR fine to approve if you meant to update.
            </p>
            {events.length === 0 ? (
              <p style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.4)", fontStyle: "italic" }}>
                Store is empty. First import from this tab will populate it. After that, every subsequent upload gets cross-referenced against what's here.
              </p>
            ) : (
              <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "3px" }}>
                {events.slice(0, 30).map((ev, i) => (
                  <div
                    key={ev.id || i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "40px 1fr auto",
                      gap: "10px",
                      padding: "4px 8px",
                      fontSize: "0.6rem",
                      background: "rgba(245,240,232,0.02)",
                      borderRadius: "3px",
                    }}
                  >
                    <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, color: "#E5BC4F", letterSpacing: "1px" }}>
                      {DAYFUL[ev.day]?.slice(0, 3) || "?"}
                    </span>
                    <span style={{ color: "rgba(245,240,232,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.name || <em>(no name)</em>} <span style={{ color: "rgba(245,240,232,0.4)" }}>· {ev.venue || "no venue"}{ev.area ? ", " + ev.area : ""}</span>
                    </span>
                    <span style={{ color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>
                      {ev.time || ""}
                    </span>
                  </div>
                ))}
                {events.length > 30 && (
                  <div style={{ padding: "6px 8px", fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", fontStyle: "italic", textAlign: "center" }}>
                    … and {events.length - 30} more
                  </div>
                )}
              </div>
            )}
          </div>
        </details>

        {pending.length > 0 && (
          <>
            {/* Flag glossary — collapsible cheat sheet */}
            <details
              open={legendOpen}
              onToggle={e => setLegendOpen(e.target.open)}
              style={{ marginBottom: "1rem", background: "rgba(245,240,232,0.03)", border: "1px solid rgba(245,240,232,0.08)", borderRadius: "6px" }}
            >
              <summary style={{ padding: "10px 14px", cursor: "pointer", fontSize: "0.65rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.7)" }}>
                {legendOpen ? "▾" : "▸"} Flag glossary — what each tag means
              </summary>
              <div style={{ padding: "0 14px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "8px 18px" }}>
                {FLAG_GLOSSARY.map(g => (
                  <div key={g.tag} style={{ display: "flex", gap: "10px", alignItems: "baseline", fontSize: "0.65rem" }}>
                    <span style={{
                      ...PILL_STYLE, padding: "2px 7px", fontWeight: 700, letterSpacing: "1px",
                      textTransform: "uppercase", borderRadius: "3px", whiteSpace: "nowrap",
                      background: PILL_STYLE.bg, color: PILL_STYLE.color, border: PILL_STYLE.border,
                      flexShrink: 0,
                    }}>{g.tag}</span>
                    <span style={{ color: "rgba(245,240,232,0.55)", lineHeight: 1.4 }}>{g.desc}</span>
                  </div>
                ))}
              </div>
            </details>

            {/* Flag-type summary — counts per tag, click to filter */}
            {flagSummary.length > 0 && (
              <details
                open={summaryOpen}
                onToggle={e => setSummaryOpen(e.target.open)}
                style={{ marginBottom: "1rem", background: "rgba(229,188,79,0.04)", border: "1px solid rgba(229,188,79,0.18)", borderRadius: "6px" }}
              >
                <summary style={{ padding: "10px 14px", cursor: "pointer", fontSize: "0.65rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E5BC4F" }}>
                  {summaryOpen ? "▾" : "▸"} Flag breakdown ({flagSummary.reduce((s, [, n]) => s + n, 0)} total · click a tag to float its events to the top)
                </summary>
                <div style={{ padding: "0 14px 14px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {flagSummary.map(([tag, count]) => {
                    const isActive = sortByTag === tag;
                    return (
                      <button
                        key={tag}
                        onClick={() => setSortByTag(isActive ? null : tag)}
                        style={{
                          padding: "5px 10px",
                          background: isActive ? "#E5BC4F" : "rgba(229,188,79,0.12)",
                          color: isActive ? "#0a0a0a" : "#E5BC4F",
                          border: `1px solid ${isActive ? "#E5BC4F" : "rgba(229,188,79,0.35)"}`,
                          borderRadius: "4px",
                          fontSize: "0.6rem",
                          fontWeight: 700,
                          letterSpacing: "1px",
                          textTransform: "uppercase",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {tag} · {count}
                      </button>
                    );
                  })}
                </div>
              </details>
            )}

            {/* Filter + sort */}
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Filter</span>
              {[["all", "All"], ["clean", "Clean"], ["flagged", "Flagged"], ["approved", "Approved"], ["unapproved", "Unselected"]].map(([k, lbl]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  style={filter === k ? { ...B, background: "rgba(229,188,79,0.15)", borderColor: "#E5BC4F", color: "#E5BC4F" } : B}
                >{lbl}</button>
              ))}
              {sortByTag && (
                <button
                  onClick={() => setSortByTag(null)}
                  style={{ ...B, background: "#E5BC4F", color: "#000", borderColor: "#E5BC4F" }}
                  title="Clear sort — events return to their original positions"
                >× Sorting {sortByTag} to top</button>
              )}
              <div style={{ flex: 1 }} />
              <button onClick={approveClean} style={B} title="Select all clean (no warnings) rows for bulk action">Select clean</button>
              <button onClick={approveAll} style={B} title="Select every row">Select all</button>
              <button onClick={rejectAll} style={B} title="Clear selection">Clear selection</button>
            </div>

            {/* Bulk action bar — appears when something is selected. Selection
                is decoupled from approval/import: the checkbox just marks rows
                for a follow-up action (add to calendar, delete, ...). */}
            <div className="cge-bulk-bar" style={{
              display: "flex", gap: "0.4rem", alignItems: "center",
              padding: approvedCount > 0 ? "8px 12px" : 0,
              marginBottom: approvedCount > 0 ? "0.5rem" : 0,
              background: approvedCount > 0 ? "rgba(52,211,153,0.06)" : "transparent",
              border: approvedCount > 0 ? "1px solid rgba(52,211,153,0.25)" : "none",
              borderRadius: "5px",
              flexWrap: "wrap",
              height: approvedCount > 0 ? "auto" : 0,
              overflow: "hidden",
            }}>
              {approvedCount > 0 && (
                <>
                  <span style={{ fontSize: "0.65rem", color: "#34D399", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700 }}>
                    {approvedCount} selected — pick a bulk action:
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={approveSelected}
                    style={{ ...B, background: "rgba(52,211,153,0.10)", borderColor: "rgba(52,211,153,0.4)", color: "#34D399" }}
                    title="Mark every selected row as approved (vetted). Doesn't push to the calendar."
                  >
                    ✓ Approve {approvedCount}
                  </button>
                  <button
                    onClick={unapproveSelected}
                    style={B}
                    title="Un-approve every selected row"
                  >
                    Un-approve
                  </button>
                  <button
                    onClick={addSelectedToCalendar}
                    style={{ ...B, background: "rgba(52,211,153,0.18)", borderColor: "rgba(52,211,153,0.5)", color: "#34D399", fontWeight: 700 }}
                    title="Add every selected row to the calendar / store"
                  >
                    + Add {approvedCount} to calendar
                  </button>
                  <button
                    onClick={deleteSelected}
                    style={{ ...B, background: "rgba(251,113,133,0.1)", borderColor: "rgba(251,113,133,0.35)", color: "#FB7185" }}
                    title="Delete every selected row from this review"
                  >
                    ✕ Delete {approvedCount} selected
                  </button>
                  <button onClick={rejectAll} style={B} title="Unselect all">Clear</button>
                </>
              )}
            </div>

            {/* Visible-row maintenance (delete-visible kept for filter-scoped cleanup) */}
            {visible.length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                <div style={{ flex: 1 }} />
                <button
                  onClick={deleteVisible}
                  title="Remove all visible rows from this review entirely (not skip — delete)"
                  style={{ ...B, background: "rgba(251,113,133,0.06)", borderColor: "rgba(251,113,133,0.2)", color: "rgba(251,113,133,0.85)" }}
                >
                  Delete {visible.length} visible
                </button>
              </div>
            )}

            {/* Search row */}
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.75rem" }}>
              <UInput
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, venue, or city…"
                style={{
                  flex: 1, padding: "8px 12px",
                  background: "rgba(245,240,232,0.04)",
                  border: "1px solid rgba(245,240,232,0.1)",
                  borderRadius: "4px",
                  color: "#F5F0E8",
                  fontFamily: "inherit",
                  fontSize: "0.78rem",
                }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} style={B}>Clear</button>
              )}
              <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase", marginLeft: "4px" }}>
                {visible.length} match{visible.length === 1 ? "" : "es"}
              </span>
            </div>

            {/* Filter-aware select-all row */}
            {visible.length > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "8px 14px", marginBottom: "0.5rem",
                background: "rgba(245,240,232,0.05)",
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: "5px",
                fontSize: "0.65rem", color: "rgba(245,240,232,0.7)",
                letterSpacing: "1px", textTransform: "uppercase",
              }}>
                <input
                  type="checkbox"
                  checked={allVisibleApproved}
                  ref={el => { if (el) el.indeterminate = !allVisibleApproved && someVisibleApproved; }}
                  onChange={toggleAllVisible}
                  style={{ width: 18, height: 18, accentColor: "#E5BC4F", cursor: "pointer" }}
                />
                <span>
                  {allVisibleApproved ? "Deselect" : "Select"} all in this filter ({visible.length} visible)
                </span>
                {highlightedGroup && (
                  <span style={{ marginLeft: "auto", color: "#E5BC4F", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <strong>{highlightedGroup.label}</strong> at top
                    <button
                      onClick={approveGroup}
                      title="Select every event in this group for bulk action"
                      style={{ ...B, padding: "3px 8px", fontSize: "0.5rem", background: "rgba(52,211,153,0.15)", borderColor: "rgba(52,211,153,0.4)", color: "#34D399" }}
                    >
                      ✓ Select group
                    </button>
                    <button
                      onClick={skipGroup}
                      title="Unselect every event in this group"
                      style={{ ...B, padding: "3px 8px", fontSize: "0.5rem" }}
                    >
                      Unselect group
                    </button>
                    <button
                      onClick={deleteGroup}
                      title="Delete every event in this group from the upload entirely"
                      style={{ ...B, padding: "3px 8px", fontSize: "0.5rem", background: "rgba(251,113,133,0.1)", borderColor: "rgba(251,113,133,0.35)", color: "#FB7185" }}
                    >
                      ✕ Delete group
                    </button>
                    <button onClick={() => setHighlightedGroup(null)} style={{ ...B, padding: "3px 8px", fontSize: "0.5rem" }}>Clear</button>
                  </span>
                )}
              </div>
            )}

            {/* Event rows */}
            <div ref={rowsRef} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {visible.length === 0 && (
                <div style={{ padding: "2rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.75rem" }}>
                  No events match this filter.
                </div>
              )}
              {visible.map(ev => {
                const w = warnings[ev.id] || [];
                const approved = approvals[ev.id];
                const isApproved = approvedSet.has(ev.id);
                const isFlagged = w.length > 0;
                const inHighlightedGroup = isRowInHighlightedGroup(ev);
                const isEditing = editingId === ev.id;
                return (
                  <Fragment key={ev.id}>
                  <div
                    className="cge-review-row"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto auto 50px 1fr auto auto auto auto",
                      gap: "12px",
                      alignItems: "center",
                      padding: "10px 14px",
                      // Approved rows get a stronger green tint so the vetted
                      // stamp is obvious at a glance (independent of selection).
                      background: inHighlightedGroup
                        ? "rgba(229,188,79,0.12)"
                        : isEditing ? "rgba(229,188,79,0.06)"
                          : isApproved ? "rgba(52,211,153,0.12)"
                          : approved ? "rgba(52,211,153,0.05)" : "rgba(245,240,232,0.06)",
                      borderLeft: isApproved ? "3px solid #34D399" : undefined,
                      border: `1px solid ${
                        inHighlightedGroup ? "#E5BC4F" :
                        isEditing ? "#E5BC4F" :
                        isApproved ? "#34D399" :
                        approved ? "rgba(52,211,153,0.18)" : "rgba(245,240,232,0.12)"
                      }`,
                      borderRadius: isEditing ? "5px 5px 0 0" : "5px",
                      // Keep full readability on unapproved rows — visual
                      // "won't import" cue comes from the unchecked box +
                      // muted bg, not from opacity (which made text hard to
                      // read on the dark theme).
                      opacity: approved ? 1 : 0.88,
                      transition: "background 120ms ease, border-color 120ms ease",
                    }}
                  >
                    <button
                      onClick={() => toggle(ev.id)}
                      className="cge-row-check"
                      title={approved ? "Selected — click to deselect" : "Click to select for bulk action (delete, add to calendar, …)"}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "5px",
                        background: approved ? "#34D399" : "rgba(245,240,232,0.04)",
                        color: approved ? "#0a0a0a" : "rgba(245,240,232,0.35)",
                        border: `1.5px solid ${approved ? "#34D399" : "rgba(245,240,232,0.22)"}`,
                        fontSize: "0.95rem",
                        fontWeight: 800,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "inherit",
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      {approved ? "✓" : ""}
                    </button>
                    <span className="cge-row-flag" style={{ fontSize: "1rem", width: "20px", textAlign: "center", lineHeight: 1 }}>
                      {isFlagged ? "🚩" : ""}
                    </span>
                    <span className="cge-row-day" style={{ fontFamily: "'Syne', sans-serif", fontSize: "0.8rem", fontWeight: 700, color: "#E5BC4F", letterSpacing: "1px" }}>
                      {DAYFUL[ev.day]?.slice(0, 3) || "?"}
                    </span>
                    <div className="cge-row-info">
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "2px" }}>
                        {getEmoji(ev.type)} {ev.name || <em style={{ color: "#FB7185" }}>(no name)</em>}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)" }}>
                        {[ev.venue, ev.area, ev.time].filter(Boolean).join(" · ") || <em>no details</em>}
                        {ev.igHandle && <span style={{ marginLeft: "8px", color: "#C084FC", fontWeight: 600 }}>@{ev.igHandle}</span>}
                      </div>
                    </div>
                    <span className="cge-row-meta" style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
                      {ev.region || "—"}
                    </span>
                    <span className="cge-row-meta" style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
                      {ev.type || "—"}
                    </span>
                    <div className="cge-row-tags" style={{ display: "flex", gap: "4px", flexWrap: "wrap", maxWidth: "320px", justifyContent: "flex-end" }}>
                      {w.map((warn, i) => {
                        const hasGroup = /#\d+/.test(warn.msg);
                        const isHighlighted = isPillInHighlightedGroup(warn.msg, ev.id);
                        const style = isHighlighted ? PILL_HIGHLIGHTED : PILL_STYLE;
                        return (
                          <span
                            key={i}
                            onClick={(e) => { e.stopPropagation(); clickFlag(warn.msg); }}
                            title={hasGroup ? "Click to float this group to the top + highlight matches" : undefined}
                            style={{
                              padding: "2px 7px",
                              background: style.bg,
                              color: style.color,
                              border: style.border,
                              fontSize: "0.55rem",
                              fontWeight: 700,
                              letterSpacing: "1px",
                              textTransform: "uppercase",
                              borderRadius: "3px",
                              whiteSpace: "nowrap",
                              cursor: hasGroup ? "pointer" : "default",
                            }}
                          >
                            {warn.msg}
                          </span>
                        );
                      })}
                      {w.length === 0 && (
                        <span style={{ fontSize: "0.55rem", color: "rgba(52,211,153,0.7)", letterSpacing: "1px", textTransform: "uppercase" }}>
                          ✓ clean
                        </span>
                      )}
                    </div>
                    <div className="cge-row-actions" style={{ display: "flex", gap: "4px" }}>
                      {ev.link && (
                        <a
                          href={ev.link}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open source link: ${ev.link}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            padding: "5px 9px",
                            background: "rgba(99,179,237,0.10)",
                            color: "#63B3ED",
                            border: "1px solid rgba(99,179,237,0.35)",
                            borderRadius: "4px",
                            fontSize: "0.7rem",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          ↗
                        </a>
                      )}
                      <button
                        onClick={() => toggleApprove(ev.id)}
                        title={approvedSet.has(ev.id) ? "Approved — click to un-approve" : "Mark as approved (vetted). Doesn't push to the calendar — use + Add for that."}
                        style={{
                          padding: "5px 9px",
                          background: approvedSet.has(ev.id) ? "#34D399" : "rgba(52,211,153,0.06)",
                          color: approvedSet.has(ev.id) ? "#0a0a0a" : "#34D399",
                          border: `1px solid ${approvedSet.has(ev.id) ? "#34D399" : "rgba(52,211,153,0.3)"}`,
                          borderRadius: "4px",
                          fontSize: "0.6rem",
                          fontWeight: 700,
                          letterSpacing: "0.5px",
                          textTransform: "uppercase",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {approvedSet.has(ev.id) ? "✓ Approved" : "Approve"}
                      </button>
                      <button
                        onClick={() => addRowToCalendar(ev.id)}
                        title="Add this event to the calendar / store right now (no queue)"
                        style={{
                          padding: "5px 9px",
                          background: "rgba(52,211,153,0.12)",
                          color: "#34D399",
                          border: "1px solid rgba(52,211,153,0.4)",
                          borderRadius: "4px",
                          fontSize: "0.65rem",
                          fontWeight: 700,
                          letterSpacing: "0.5px",
                          textTransform: "uppercase",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        + Add
                      </button>
                      <button
                        onClick={() => isEditing ? cancelEdit() : startEdit(ev)}
                        title={isEditing ? "Cancel edit" : "Edit this event in place"}
                        style={{
                          padding: "5px 9px",
                          background: isEditing ? "#E5BC4F" : "rgba(245,240,232,0.04)",
                          color: isEditing ? "#000" : "#F5F0E8",
                          border: `1px solid ${isEditing ? "#E5BC4F" : "rgba(245,240,232,0.1)"}`,
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {isEditing ? "✕" : "✎"}
                      </button>
                      <button
                        onClick={() => deleteRow(ev.id)}
                        title="Delete this row from the upload entirely (not skip — delete)"
                        style={{
                          padding: "5px 9px",
                          background: "rgba(251,113,133,0.06)",
                          color: "rgba(251,113,133,0.7)",
                          border: "1px solid rgba(251,113,133,0.2)",
                          borderRadius: "4px",
                          fontSize: "0.7rem",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Inline edit form — expands below the row */}
                  {isEditing && (
                    <div style={{
                      padding: "12px 14px",
                      background: "rgba(229,188,79,0.06)",
                      border: "1px solid #E5BC4F",
                      borderTop: "none",
                      borderRadius: "0 0 5px 5px",
                      marginTop: "-0.4rem",
                    }}>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 80px 1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                        <UInput
                          autoFocus
                          value={editDraft.name || ""}
                          onChange={e => editField("name", e.target.value)}
                          placeholder="Name"
                          style={{ ...editInputStyle }}
                        />
                        <select value={editDraft.day || "Fri"} onChange={e => editField("day", e.target.value)} style={editInputStyle}>
                          <option value="Fri">Fri</option>
                          <option value="Sat">Sat</option>
                          <option value="Sun">Sun</option>
                        </select>
                        <UInput
                          value={editDraft.time || ""}
                          onChange={e => editField("time", e.target.value)}
                          placeholder="Time (e.g. 8 PM)"
                          style={editInputStyle}
                        />
                        <UInput
                          value={editDraft.type || ""}
                          onChange={e => editField("type", e.target.value)}
                          placeholder="Type (PARTY, BRUNCH...)"
                          style={editInputStyle}
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto auto", gap: "8px", alignItems: "center" }}>
                        <UInput
                          value={editDraft.venue || ""}
                          onChange={e => editField("venue", e.target.value)}
                          placeholder="Venue"
                          style={editInputStyle}
                        />
                        <UInput
                          value={editDraft.area || ""}
                          onChange={e => editField("area", e.target.value)}
                          placeholder="City / area"
                          style={editInputStyle}
                        />
                        <select value={editDraft.region || "North"} onChange={e => editField("region", e.target.value)} style={editInputStyle}>
                          <option value="North">North</option>
                          <option value="Central">Central</option>
                          <option value="South">South</option>
                        </select>
                        <button onClick={cancelEdit} style={B}>Cancel</button>
                        <button onClick={saveEdit} style={Bgold}>Save & re-validate</button>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                        <span style={{ fontSize: "0.55rem", color: "rgba(192,132,252,0.7)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", minWidth: 22 }}>IG</span>
                        <input
                          value={editDraft.igHandle || ""}
                          onChange={e => editField("igHandle", e.target.value)}
                          placeholder="@handle to tag (won't show on slide)"
                          style={{ ...editInputStyle, flex: 1, color: "#C084FC" }}
                        />
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                        <span style={{ fontSize: "0.55rem", color: "rgba(99,179,237,0.7)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", minWidth: 22 }}>Link</span>
                        <input
                          value={editDraft.link || ""}
                          onChange={e => editField("link", e.target.value)}
                          placeholder="Source URL (Instagram post, ticket page, etc.)"
                          style={{ ...editInputStyle, flex: 1, color: "#63B3ED" }}
                        />
                      </div>
                    </div>
                  )}
                  </Fragment>
                );
              })}
            </div>
          </>
        )}

        {pending.length === 0 && (
          <div style={{ padding: "2rem", borderRadius: "8px", border: "1px dashed rgba(245,240,232,0.12)", color: "rgba(245,240,232,0.5)", fontSize: "0.75rem", lineHeight: 1.6 }}>
            <strong style={{ color: "#E5BC4F", letterSpacing: "1.5px", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>What this does</strong>
            Excel / Sheets is great for bulk text curation. This page adds the checks Excel can't:
            <ul style={{ marginTop: "8px", paddingLeft: "20px", lineHeight: 1.7 }}>
              <li>Cross-references each event against your {events.length}-event store — flags ALREADY IN STORE and SAME VENUE/DAY collisions</li>
              <li>Validates field completeness — missing NAME / DAY / TIME / VENUE / REGION</li>
              <li>Detects in-batch dupes — name+day, venue+day, multi-day reposts</li>
              <li>Region convention — flags when Union County cities aren't tagged NORTH (your local rule)</li>
              <li>Surface "WRONG DAY?" when event name mentions a day that doesn't match its assigned day</li>
              <li>Time/type sanity — flags "PARTY at 11am" or "BRUNCH at 11pm"</li>
            </ul>
            Upload your cleaned sheet → see flags → uncheck anything you want to skip → import the rest.
          </div>
        )}
      </div>
      <ReviewSessionsModal
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onLoad={applyLoadedSession}
        getCurrent={getSessionPayload}
      />
    </div>
  );
}
