import { useState, useRef, useMemo, useEffect, Fragment } from "react";
import * as XLSX from "xlsx";
import { useEventsStore, useRegularsStore, useScraperIntakeStore } from "../store";
import { parseRows, DAYFUL, getEmoji, sortChrono, parseRegion, parseDateToDay } from "../shared/parseEvents";
import { computeWarnings, findFlagPartners } from "../shared/validateEvents";
import { detectRegulars } from "../shared/regulars";
import { normalizeHandle } from "../shared/parseEvents";
import { UInput, todaysFridayMD } from "../shared/inputs.jsx";
import { ReviewSessionsModal } from "../shared/ReviewSessionsModal.jsx";
import { WebsitePublishModal } from "../shared/WebsitePublishModal.jsx";
import { ColumnMapperModal } from "../shared/ColumnMapperModal.jsx";
import { ConflictSweepModal } from "../shared/ConflictSweepModal.jsx";
import { CleanSweepModal } from "../shared/CleanSweepModal.jsx";
import { FixFlagsModal } from "../shared/FixFlagsModal.jsx";
import { saveExport } from "../shared/photoLibrary.js";
import { rememberLastSession, getLastSession, forgetLastSession, loadSession, mergeSession, pingPresence, rememberServerPendingIds, getServerPendingIds } from "../shared/reviewSessions.js";

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
const Bgold = { ...B, background: "#E5BC4F", color: "#000", border: "none", fontWeight: 700, whiteSpace: "nowrap" };
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

export default function ReviewQueue({ betaMode = false } = {}) {
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
  const [websiteOpen, setWebsiteOpen] = useState(false);
  const [lastSessionName, setLastSessionName] = useState(() => getLastSession());
  const [autoSaveStatus, setAutoSaveStatus] = useState("idle"); // "idle" | "saving" | "saved" | "error"
  // How many devices are actively working in the current session (incl.
  // this one). Powers the "👥 2 devices" live-collab pill.
  const [activeDevices, setActiveDevices] = useState(0);

  // Presence heartbeat: while a session is active and this tab is visible,
  // check in every 10s so both devices see each other within ~10-20s.
  useEffect(() => {
    if (!lastSessionName) { setActiveDevices(0); return; }
    let stopped = false;
    const ping = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const n = await pingPresence(lastSessionName);
        if (!stopped) setActiveDevices(n);
      } catch { /* server offline — leave the count as-is */ }
    };
    ping();
    const iv = setInterval(ping, 10000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [lastSessionName]);

  // Vetted & approvals state (needed by auto-save effect)
  const vettedArr = useEventsStore(s => s.vetted);
  const setVettedArr = useEventsStore(s => s.setVetted);
  const approvedSet = useMemo(() => new Set(vettedArr || []), [vettedArr]);
  const setApprovedSet = (updaterOrSet) => {
    const current = new Set(vettedArr || []);
    const next = typeof updaterOrSet === "function" ? updaterOrSet(current) : updaterOrSet;
    setVettedArr(Array.from(next || []));
  };

  // Pending queue state (needed by auto-save effect)
  const REVIEW_PENDING_KEY = "cge_review_pending";
  const [pending, setPending] = useState(() => {
    try {
      const raw = localStorage.getItem(REVIEW_PENDING_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(REVIEW_PENDING_KEY, JSON.stringify(pending)); } catch {}
  }, [pending]);

  // Filter and sort states (needed by auto-save effect)
  const [filter, setFilter] = useState("all"); // all | clean | flagged | unapproved | approved
  const [sortByTag, setSortByTag] = useState(null); // tag name to float to top (separate from filter)

  const setEvents = useEventsStore(s => s.setEvents);

  const getSessionPayload = () => ({
    events,
    approvals,
    vetted: vettedArr,
    pending,
    filter,
    sortByTag,
  });

  // ---- Collaborative sync -------------------------------------------------
  // Two people can work in the SAME session on separate devices. Instead of
  // overwriting the whole session (last-write-wins), each device sends only
  // WHAT IT CHANGED as granular ops; the server merges them atomically. A
  // light poll pulls the partner's changes back in.
  //
  // Calendar events have special rules: additions sync both ways (so a
  // partner's "add to calendar" shows up), but deletions never propagate —
  // that keeps "Clear All" on one device from nuking the partner's calendar
  // and keeps auto-load from resurrecting a cleared calendar.

  const evKey = (e) =>
    e && e.id != null ? String(e.id) : JSON.stringify([e?.name || "", e?.date || "", e?.venue || ""]);
  // Serialize just the queue state (pending + vetted + approvals) — the part
  // that merges cleanly. Used for "is this device dirty vs. server?" checks.
  const pvaSerialize = (p) => JSON.stringify({
    approvals: p?.approvals || {},
    vetted: p?.vetted || [],
    pending: p?.pending || [],
  });

  // syncBase = our last known copy of the SERVER state:
  // { payload:{approvals,vetted,pending}, pvaStr, eventsMap:Map, version }
  const syncBaseRef = useRef(null);
  const flightRef = useRef(false);       // a merge request is in the air
  const [syncTick, setSyncTick] = useState(0); // re-arms the sync effect after a flight
  // Live snapshot of the synced state, readable inside async callbacks.
  const stateRef = useRef(null);
  stateRef.current = { events, approvals, vetted: vettedArr, pending };

  const makeBase = (payload) => ({
    payload: {
      approvals: payload?.approvals || {},
      vetted: payload?.vetted || [],
      pending: payload?.pending || [],
    },
    pvaStr: pvaSerialize(payload),
    eventsMap: new Map((Array.isArray(payload?.events) ? payload.events : []).map((e) => [evKey(e), e])),
    version: Number(payload?.version) || 0,
  });

  // Diff this device's state against the last known server copy → ops.
  const diffOps = (base, curr) => {
    const ops = {};
    const bp = new Map((base.payload.pending || []).map((e) => [String(e.id), e]));
    const cp = new Map((curr.pending || []).filter((e) => e && e.id != null).map((e) => [String(e.id), e]));
    const upsertPending = [];
    for (const [id, row] of cp) {
      const old = bp.get(id);
      if (!old || JSON.stringify(old) !== JSON.stringify(row)) upsertPending.push(row);
    }
    const removePending = [...bp.keys()].filter((id) => !cp.has(id));
    if (upsertPending.length) ops.upsertPending = upsertPending;
    if (removePending.length) ops.removePending = removePending;

    const bv = new Set(base.payload.vetted || []);
    const cv = new Set(curr.vetted || []);
    const addVetted = [...cv].filter((x) => !bv.has(x));
    const removeVetted = [...bv].filter((x) => !cv.has(x));
    if (addVetted.length) ops.addVetted = addVetted;
    if (removeVetted.length) ops.removeVetted = removeVetted;

    const ba = base.payload.approvals || {};
    const ca = curr.approvals || {};
    const setApprovalsOp = {};
    for (const k of Object.keys(ca)) if (ba[k] !== ca[k]) setApprovalsOp[k] = ca[k];
    for (const k of Object.keys(ba)) if (!(k in ca)) setApprovalsOp[k] = null;
    if (Object.keys(setApprovalsOp).length) ops.setApprovals = setApprovalsOp;

    // Events: ADDITIONS only. Edits and removals of calendar events never
    // sync — sending edits while reconcile only applies additions would put
    // the two devices in a stale-overwrite loop, so neither propagates.
    const upsertEvents = [];
    for (const ev of curr.events || []) {
      if (!base.eventsMap.has(evKey(ev))) upsertEvents.push(ev);
    }
    if (upsertEvents.length) ops.upsertEvents = upsertEvents;

    return Object.keys(ops).length ? ops : null;
  };

  // Fold a fresh server copy into local state. `snapAtFlush` is what local
  // state looked like when the request left — if it changed since, we keep
  // the local queue (the next sync pass will merge it) and only take safe
  // event additions.
  const reconcileFromServer = (serverData, prevBase, snapAtFlush) => {
    const newBase = makeBase(serverData);
    syncBaseRef.current = newBase;
    // Persist the server's pending ids so a later reload can tell "partner
    // deleted this row" apart from "this device added this row" (tombstones).
    if (lastSessionName) {
      rememberServerPendingIds(
        lastSessionName,
        (newBase.payload.pending || []).map((e) => String(e.id)),
      );
    }

    // Calendar: append events that are NEW on the server since our last
    // known copy and not already here. (Events we deleted locally were in
    // prevBase, so they don't come back.)
    const cur = stateRef.current;
    const localKeys = new Set((cur.events || []).map(evKey));
    const additions = (serverData.events || []).filter(
      (e) => !prevBase.eventsMap.has(evKey(e)) && !localKeys.has(evKey(e)),
    );
    if (additions.length) setEvents([...(cur.events || []), ...additions]);

    // Queue: adopt the merged copy only if this device hasn't typed anything
    // new while the request was in flight.
    if (pvaSerialize(cur) === pvaSerialize(snapAtFlush)) {
      setPending(Array.isArray(serverData.pending) ? serverData.pending : []);
      setVettedArr(Array.isArray(serverData.vetted) ? serverData.vetted : []);
      setApprovals(serverData.approvals && typeof serverData.approvals === "object" ? serverData.approvals : {});
    } else {
      // This device kept typing while the request was in flight, so we keep
      // the local queue — BUT we still apply the PARTNER'S DELETIONS. Rows
      // that were in our last server copy and are now gone from the server
      // were deleted by the partner; leaving them in the local list would
      // re-upsert them on the next diff and silently undo the partner's
      // sweep. Deletion wins over a concurrent local edit by design.
      const serverIds = new Set((serverData.pending || []).map((e) => String(e.id)));
      const removedByPartner = (prevBase.payload.pending || [])
        .map((e) => String(e.id))
        .filter((id) => !serverIds.has(id));
      // …and rows the partner ADDED (or a backup restore re-added). A row
      // that's new on the server, absent locally, absent from our previous
      // server copy AND absent from our in-flight snapshot can't be
      // something this device deleted — append it, otherwise the next diff
      // would emit it as removePending and undo the partner's addition.
      const prevBaseIds = new Set((prevBase.payload.pending || []).map((e) => String(e.id)));
      const snapIds = new Set(((snapAtFlush?.pending) || []).map((e) => String(e.id)));
      const localIds = new Set((cur.pending || []).map((e) => String(e.id)));
      const addedByPartner = (serverData.pending || []).filter((e) => {
        const id = String(e.id);
        return !localIds.has(id) && !prevBaseIds.has(id) && !snapIds.has(id);
      });
      if (removedByPartner.length > 0 || addedByPartner.length > 0) {
        const gone = new Set(removedByPartner);
        setPending((p) => {
          const have = new Set((p || []).map((e) => String(e.id)));
          const fresh = addedByPartner.filter((e) => !have.has(String(e.id)));
          return [...(p || []).filter((e) => !gone.has(String(e.id))), ...fresh];
        });
        if (removedByPartner.length > 0) {
          setApprovals((a) => {
            const next = { ...a };
            removedByPartner.forEach((id) => { delete next[id]; });
            return next;
          });
        }
      }
    }
  };

  const applyLoadedSession = (payload, name, isAutoLoad = false) => {
    // Auto-load NEVER touches the calendar. It only restores the review
    // queue (pending + approvals + vetted). Silently repopulating the
    // calendar made "Clear All" look broken — everything came back on the
    // next visit to /review. Calendar restore only happens on a MANUAL
    // session load, where the user gets the confirm prompt below.
    let shouldLoadEvents = !isAutoLoad;
    if (!isAutoLoad && Array.isArray(payload?.events) && payload.events.length > 0) {
      shouldLoadEvents = window.confirm(
        `This session was saved with ${payload.events.length} calendar event(s).\n\n` +
        `Do you want to restore these events to the calendar?\n` +
        `• Click OK to restore them (overwrites your current calendar).\n` +
        `• Click Cancel to keep your current calendar (only restores the review queue).`
      );
    }

    // The base always mirrors the SERVER copy (including its events), so
    // diffs against it are correct regardless of what we load locally.
    syncBaseRef.current = makeBase(payload);
    // BEFORE overwriting the remembered server ids, grab the previous set —
    // the auto-load merge below needs it to spot partner deletions.
    const prevServerIds = getServerPendingIds(name);
    rememberServerPendingIds(
      name,
      (Array.isArray(payload?.pending) ? payload.pending : []).map((e) => String(e.id)),
    );

    if (shouldLoadEvents && Array.isArray(payload?.events)) setEvents(payload.events);
    if (payload?.approvals && typeof payload.approvals === "object") setApprovals(payload.approvals);
    if (Array.isArray(payload?.vetted)) setVettedArr(payload.vetted);
    // Restore the triage queue so a mid-sweep session resumes with the same
    // flagged/clean/conflicting rows. Older sessions have no `pending` key —
    // leave the current queue untouched rather than blanking it.
    //
    // AUTO-load MERGES with what's already in the queue instead of replacing
    // it. Reason: "send to Review" from the Scraper lands rows in the queue,
    // then this auto-load resolves a moment later — a plain replace was
    // silently wiping the freshly staged batch. Local-only rows survive and
    // then sync UP to the shared session via the diff sync. A MANUAL load
    // still replaces (the user explicitly asked for that session's state).
    if (Array.isArray(payload?.pending)) {
      if (isAutoLoad) {
        setPending((prev) => {
          const seen = new Set(payload.pending.map((e) => String(e.id)));
          // Keep only rows that are genuinely NEW on this device (e.g. a
          // scraper batch staged before this auto-load resolved). A row
          // missing from the server that WAS in our last-known server copy
          // means the partner deleted it — dropping it here is what keeps
          // his sweep from being silently undone. If we have no remembered
          // server copy (first load on this device), fall back to keeping
          // local rows, matching the old behavior.
          const localOnly = (prev || []).filter((e) => {
            const id = String(e.id);
            if (seen.has(id)) return false;
            if (prevServerIds && prevServerIds.has(id)) return false; // partner deleted it
            return true;
          });
          return [...payload.pending, ...localOnly];
        });
      } else {
        setPending(payload.pending);
      }
    }
    if (typeof payload?.filter === "string" && payload.filter) setFilter(payload.filter);
    if (typeof payload?.sortByTag === "string" || payload?.sortByTag === null) setSortByTag(payload?.sortByTag || null);

    rememberLastSession(name);
    setLastSessionName(name);
    setAutoSaveStatus("idle");
  };

  // Auto-load the most-recently-used session on mount (once). Always runs
  // when a session is remembered — it establishes the sync base so this
  // device can merge into the shared session. (Auto-load still never
  // touches the calendar.)
  useEffect(() => {
    const name = getLastSession();
    if (!name) return;
    (async () => {
      try {
        const payload = await loadSession(name);
        applyLoadedSession(payload, name, true);
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

  // Debounced merge-sync: whenever local state drifts from the server base,
  // send just the diff as ops.
  useEffect(() => {
    if (!lastSessionName) {
      setAutoSaveStatus("idle");
      return;
    }
    const base = syncBaseRef.current;
    if (!base) return; // waiting for auto-load to establish the base
    const ops = diffOps(base, stateRef.current);
    if (!ops) return;

    setAutoSaveStatus("saving");
    const timer = setTimeout(async () => {
      if (flightRef.current) return; // flight in progress — syncTick re-arms us
      const baseNow = syncBaseRef.current;
      if (!baseNow) return;
      const snap = stateRef.current;
      const opsNow = diffOps(baseNow, snap);
      if (!opsNow) { setAutoSaveStatus("saved"); return; }
      flightRef.current = true;
      try {
        const merged = await mergeSession(lastSessionName, opsNow);
        reconcileFromServer(merged, baseNow, snap);
        setAutoSaveStatus("saved");
      } catch (err) {
        console.error("Session sync failed:", err);
        setAutoSaveStatus("error");
      } finally {
        flightRef.current = false;
        setSyncTick((t) => t + 1); // re-run this effect to flush anything queued meanwhile
      }
    }, 1200);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, approvals, vettedArr, pending, lastSessionName, syncTick]);

  // Poll for the partner's changes every 8s (only while the tab is visible
  // and this device is idle — a dirty device gets the merged copy back from
  // its own flush instead).
  useEffect(() => {
    if (!lastSessionName) return;
    const id = setInterval(async () => {
      if (document.hidden || flightRef.current) return;
      const base = syncBaseRef.current;
      if (!base) return;
      if (pvaSerialize(stateRef.current) !== base.pvaStr) return; // local changes pending — flush handles it
      try {
        const data = await loadSession(lastSessionName);
        if ((Number(data?.version) || 0) === base.version) return;
        reconcileFromServer(data, base, stateRef.current);
      } catch { /* transient network blip — next tick retries */ }
    }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSessionName]);

  // The working review list (Seeded from localStorage on mount, written back when it changes, moved to top).

  // Scraper-intake handoff. ScraperReview stashes a batch of events into
  // useScraperIntakeStore then navigates here. Consume once on mount —
  // appends to whatever's already pending (so user doesn't lose
  // in-progress Excel-paste work). consumeIntake() clears the store
  // atomically so a refresh on /review can't re-import the same batch.
  const consumeIntake = useScraperIntakeStore((s) => s.consumeIntake);
  const [intakeBanner, setIntakeBanner] = useState(null);  // { count } | null
  useEffect(() => {
    const incoming = consumeIntake();
    if (incoming && incoming.length > 0) {
      setPending((prev) => {
        // Dedup by id so re-imports of the same row don't pile up.
        const seen = new Set(prev.map((e) => String(e.id)));
        const fresh = incoming.filter((e) => !seen.has(String(e.id)));
        return [...prev, ...fresh];
      });
      setIntakeBanner({ count: incoming.length });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === Website booking intake (Pipe 1) ===
  // Pull promoter bookings from centralgroupevents.com (via the server proxy so
  // the token + PII stay server-side) and drop new ones into the review queue.
  // reference_id is the stable dedup key: already-imported ids are remembered in
  // localStorage so bookings you delete here don't march back in on the next pull.
  const IMPORTED_BOOKINGS_KEY = "cge_imported_bookings";
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState(null); // { ok, text } | null

  const mapBooking = (b) => {
    const ref = String(b.reference_id || b.id || "");
    const di = b.event_date ? parseDateToDay(b.event_date) : null;
    const type = (b.event_type === "Other" && b.event_type_other) ? b.event_type_other : (b.event_type || "");
    return {
      id: "booking_" + ref,
      name: b.event_name || "(untitled booking)",
      day: di?.day || "Fri",
      date: di?.date || b.event_date || "",
      time: b.event_time || "",
      venue: b.venue_name || "",
      area: b.city || "",
      region: parseRegion(b.region) || "North",
      type,
      emoji: getEmoji(type),
      igHandle: normalizeHandle(b.instagram_handle || ""),
      link: "",
      featured: false,
      // Provenance + who to follow up with — kept so a booking is actionable,
      // not just an event row.
      _source: "website-booking",
      _booking: {
        reference_id: ref,
        contact_name: b.contact_name || "",
        email: b.email || "",
        phone: b.phone || "",
        budget_range: b.budget_range || "",
        ready: b.ready_to_move_forward || "",
        status: b.status || "",
        created_at: b.created_at || "",
      },
    };
  };

  const importFromWebsite = async () => {
    if (importBusy) return;
    setImportBusy(true); setImportMsg(null);
    try {
      const r = await fetch("/api/website/bookings");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const hint = r.status === 503 ? "Add CGE_INTEGRATION_TOKEN in this app's Replit Secrets (same value as the website)."
          : r.status === 401 ? "Token mismatch — the website rejected it. Make sure both secrets are identical."
          : (j.message || j.detail || `Server responded ${r.status}`);
        throw new Error(hint);
      }
      const bookings = Array.isArray(j.bookings) ? j.bookings : [];
      let seen;
      try { seen = new Set(JSON.parse(localStorage.getItem(IMPORTED_BOOKINGS_KEY) || "[]")); } catch { seen = new Set(); }
      const fresh = [];
      for (const b of bookings) {
        const ref = String(b.reference_id || b.id || "");
        if (!ref || seen.has(ref)) continue;
        seen.add(ref);
        fresh.push(mapBooking(b));
      }
      if (fresh.length) {
        setPending((prev) => {
          const existing = new Set(prev.map((e) => String(e.id)));
          return [...prev, ...fresh.filter((e) => !existing.has(String(e.id)))];
        });
      }
      try { localStorage.setItem(IMPORTED_BOOKINGS_KEY, JSON.stringify([...seen])); } catch {}
      setImportMsg({
        ok: true,
        text: fresh.length
          ? `Imported ${fresh.length} new booking${fresh.length === 1 ? "" : "s"} from your website.`
          : "No new bookings — you're all caught up.",
      });
    } catch (e) {
      setImportMsg({ ok: false, text: String(e?.message || e) });
    } finally {
      setImportBusy(false);
    }
  };

  // Column-mapper state. After file upload, raw rows + filename are
  // stashed here while the user picks how columns map to event fields.
  // applyImport() consumes them and clears once import completes/cancels.
  const [mapperOpen, setMapperOpen] = useState(false);
  const [importRows, setImportRows] = useState(null);
  const [importFileName, setImportFileName] = useState("");
  // Approval and vetting states (moved to top).
  // Mobile-only Sweep Mode — focused one-conflict-group-at-a-time
  // triage. Button surfaces under .cge-mobile-only CSS so desktop users
  // keep the existing flag-pill workflow.
  const [sweepOpen, setSweepOpen] = useState(false);
  const [cleanSweepOpen, setCleanSweepOpen] = useState(false);
  const [fixFlagsOpen, setFixFlagsOpen] = useState(false);
  // Weekend date anchor — same UX as CalendarBuilder. Type the upcoming
  // Friday in M/D format; Saturday and Sunday derive automatically. Used
  // to fill the `date` column on export AND to stamp pending events with
  // a concrete date when they're committed to the store. Defaults to
  // the next upcoming Friday (today if today is Friday).
  const [friDate, setFriDate] = useState(() => todaysFridayMD());
  // Pagination cap — rendering 200+ rich event rows up-front was the
  // most likely cause of "Aw, Snap!" tab crashes on big imports. Show
  // first N, button to load the rest. Resets whenever pending changes
  // (new import) so the cap re-engages.
  const ROW_RENDER_CAP = 100;
  const [showAllRows, setShowAllRows] = useState(false);
  useEffect(() => { setShowAllRows(false); }, [pending.length]);
  // sortByTag state (moved to top).
  // Highlighted group captures the event IDs at click time so the sort/highlight
  // survives re-validation (group numbers renumber when events are deleted).
  // Shape: { prefix: "VENUE", label: "VENUE #31", ids: Set<id> } or null.
  const [highlightedGroup, setHighlightedGroup] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Debounced copy of searchQuery that actually feeds the `visible` list.
  // The text field stays bound to searchQuery (instant feedback), but the
  // expensive filter + full-list re-render only fires 200ms after you pause
  // typing — otherwise every character re-filtered and re-rendered all rows.
  const [searchTerm, setSearchTerm] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchQuery), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);
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

  // Count of #N-grouped conflicts (DUPE / VENUE / MULTI) — used to label
  // the mobile Sweep button so the user knows what's queued.
  const conflictGroupCount = useMemo(() => {
    const seen = new Set();
    Object.values(warnings || {}).forEach(ws => {
      (ws || []).forEach(w => {
        const m = String(w.msg || "").match(/^(DUPE|VENUE|MULTI)\s+#(\d+)/);
        if (m) seen.add(`${m[1]}-${m[2]}`);
      });
    });
    return seen.size;
  }, [warnings]);

  // Count of events that have non-partner warnings (i.e., the queue
  // for FixFlagsModal). DUPE/VENUE/MULTI are handled by Sweep — Fix
  // Flags only counts events whose ONLY warnings are single-event
  // (NO X / WRONG DAY? / REGION? / ALREADY IN STORE / etc.).
  const singleFlagEventCount = useMemo(() => {
    let n = 0;
    Object.values(warnings || {}).forEach(ws => {
      const hasNonPartner = (ws || []).some(w => !/^(DUPE|VENUE|MULTI)\s+#\d+/.test(String(w.msg || "")));
      if (hasNonPartner) n++;
    });
    return n;
  }, [warnings]);

  // Clean events — no warnings at all. These sailed past Conflict Sweep and
  // Fix Flags, but "clean" isn't "wanted": Clean Sweep lets the user keep/cut
  // them one at a time. Exclude already-vetted ones (already decided).
  const cleanEvents = useMemo(
    () => pending.filter(e => (warnings[e.id] || []).length === 0 && !approvedSet.has(e.id)),
    [pending, warnings, approvedSet]
  );
  const cleanCount = cleanEvents.length;

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
      // Archive the RAW imported file to the cloud library FIRST, before
      // anything else. This preserves the original spreadsheet even after
      // the user prunes conflicts/dupes during Review — they can always
      // re-download the source from the library or via the workspace
      // export. Fire-and-forget: a library write failure doesn't block
      // the import itself.
      saveExport(file, {
        sourceTool: "review",
        sourceMode: "raw-import",
        name: file.name || "import.csv",
        kind: "raw-import",
      }).catch(err => console.warn("Raw import archive failed:", err));

      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      // Surface the column-mapper modal instead of parsing immediately.
      // The modal returns a { columnMap, hasHeaderRow } to applyImport()
      // below, which then runs parseRows with the user's mapping.
      setImportRows(rows);
      setImportFileName(file.name || "Spreadsheet");
      setMapperOpen(true);
    } catch (err) {
      console.error("CSV parse failed:", err);
      alert("Couldn't parse that file. Make sure it's CSV/XLSX with a header row.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  // Derive Sat + Sun M/D from the user-set Friday date. Mirrors the
  // calcDates helper in CalendarBuilder. Wrap-around for end-of-month
  // edge cases (e.g. Fri 5/30 → Sat 5/31 → Sun 6/1).
  const weekendDates = useMemo(() => {
    const parts = String(friDate || "").split("/");
    if (parts.length !== 2) return { Fri: friDate || "", Sat: "", Sun: "" };
    const m = parseInt(parts[0]), d = parseInt(parts[1]);
    if (isNaN(m) || isNaN(d)) return { Fri: friDate || "", Sat: "", Sun: "" };
    const daysInMonth = [0,31,29,31,30,31,30,31,31,30,31,30,31];
    const max = daysInMonth[m] || 31;
    const sat = d + 1 > max ? `${m+1}/1` : `${m}/${d+1}`;
    const sun = d + 2 > max ? `${m+1}/${d+2-max}` : `${m}/${d+2}`;
    return { Fri: friDate, Sat: sat, Sun: sun };
  }, [friDate]);

  // Resolve the date for a single event: prefer its own .date if it was
  // populated at parse time (the sheet had a date column), else fall
  // back to the weekend anchor mapped by day-of-week. Used for CSV
  // export and for stamping events on commit.
  const dateForEvent = (ev) => ev.date || weekendDates[ev.day] || "";

  // Export the FULL current pending list as CSV — captures everything
  // that's still in Review (including flagged events the user hasn't
  // resolved yet) BEFORE any Sweep-mode deletions or per-row removals
  // refine it down. This is the "everything I imported" export — the
  // main "Export CSV" in the top nav exports the refined events store.
  const exportFullPendingCsv = () => {
    if (pending.length === 0) {
      alert("Pending list is empty.");
      return;
    }
    const cols = ["date", "day", "time", "name", "venue", "area", "region", "type", "link", "igHandle", "featured", "emoji"];
    const csvCell = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const ev of pending) {
      lines.push(cols.map(c => {
        // date column uses the weekend-anchor fallback when the event
        // didn't come in with its own date — fixes the empty column
        // issue for sheets imported without an explicit date col.
        const v = c === "date" ? dateForEvent(ev) : ev[c];
        return csvCell(v);
      }).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const filename = `CGE_pending_full_${stamp}.csv`;
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    // Also archive so it's recoverable from the cloud library later.
    saveExport(blob, {
      sourceTool: "review",
      sourceMode: "pending-full-export",
      name: filename,
      kind: "archive",
    }).catch(err => console.warn("Pending archive failed:", err));
  };

  // Column-mapper handoff — called by ColumnMapperModal when the user
  // confirms their column → field assignment. Runs parseRows with the
  // chosen mapping then drops the events into `pending` for review.
  const applyImport = ({ columnMap, hasHeaderRow }) => {
    try {
      const parsed = parseRows(importRows, { columnMap, hasHeaderRow });
      const withIds = parsed.map((ev, i) => ({ ...ev, id: `pending_${Date.now()}_${i}` }));
      setPending(withIds);
      // Same approve/select reset as the original handleFile.
      setApprovals({});
      setApprovedSet(new Set());
    } catch (err) {
      console.error("Mapped parse failed:", err);
      alert("Import failed: " + (err.message || err));
    } finally {
      setMapperOpen(false);
      setImportRows(null);
      setImportFileName("");
    }
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

  // Empty the whole review triage list. This is the "clear all events" the
  // filter/selection "Clear" buttons DON'T do — those only unselect. Clears
  // the pending queue + its selection/vetted marks. Does NOT touch events
  // already added to the Calendar (that has its own Clear All), and doesn't
  // forget the saved session, so a re-upload or session load can restore.
  const clearReview = () => {
    if (pending.length === 0) return;
    if (!window.confirm(
      `Clear all ${pending.length} event${pending.length === 1 ? "" : "s"} from the review list?\n\n` +
      `This empties the triage queue here. It does NOT remove events you already added to the Calendar. ` +
      `Re-upload the sheet (or load a session) to bring them back.`
    )) return;
    setPending([]);
    setApprovals({});
    setVettedArr([]);
    setSearchQuery("");
  };

  // Direct-add: push a single event to the events store immediately, no
  // queue / no "import" step. User asked for an explicit + Add button per
  // row that bypasses the selection model.
  const addRowToCalendar = (id) => {
    const ev = pending.find(e => e.id === id);
    if (!ev) return;
    // Stamp .date if missing — derive from weekend anchor + day-of-week.
    // The store/CSV export depends on this; without it the date column
    // would be empty for any sheet imported without a date column.
    const fresh = { ...ev, date: ev.date || dateForEvent(ev), id: Date.now() + Math.random() * 1e5 };
    updateEvents(prev => [...prev, fresh]);
    setPending(p => p.filter(e => e.id !== id));
    setApprovals(a => { const next = { ...a }; delete next[id]; return next; });
    setApprovedSet(s => { const next = new Set(s); next.delete(id); return next; });
    if (editingId === id) { setEditingId(null); setEditDraft({}); }
  };

  // Bulk-add: push every currently-selected event to the store at once.
  // We only add events that are both selected (checked) AND approved/vetted!
  const addSelectedToCalendar = () => {
    const sel = pending.filter(e => approvals[e.id] && approvedSet.has(e.id));
    if (sel.length === 0) return;
    const fresh = sel.map(e => ({
      ...e,
      // Same date-stamping rule as the single-row add — derive from
      // friDate + day when the event didn't come in with its own date.
      date: e.date || dateForEvent(e),
      id: Date.now() + Math.random() * 1e5,
    }));
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

    // Base order: earliest → latest (day, then time) so the list reads
    // chronologically. The tag/group float-sorts below are stable, so they
    // lift matches to the top while keeping this order within each partition.
    list = sortChrono(list);

    // Search filter — additive on top of the active filter
    const q = searchTerm.trim().toLowerCase();
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
  }, [pending, warnings, approvals, approvedSet, filter, searchTerm, sortByTag, highlightedGroup]);

  const approvedCount = pending.filter(e => approvals[e.id]).length;
  const selectedApprovedCount = pending.filter(e => approvals[e.id] && approvedSet.has(e.id)).length;
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
      <style>{`
        @keyframes cge-pulse {
          0% { transform: scale(0.85); opacity: 0.5; }
          50% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.85); opacity: 0.5; }
        }
      `}</style>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
        {/* Scraper-intake banner — surfaces when ScraperReview pushed a
            batch of events into pending via the navigation handoff. One-shot
            (the consumeIntake() in the useEffect already cleared the store);
            this banner dismisses itself when the user clicks the ×. */}
        {intakeBanner && (
          <div style={{
            padding: "10px 14px",
            marginBottom: "1rem",
            background: "rgba(52,211,153,0.1)",
            border: "1px solid rgba(52,211,153,0.4)",
            borderLeft: "4px solid #34D399",
            borderRadius: 4,
            fontSize: "0.85rem",
            color: "#34D399",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}>
            <span style={{ flex: 1 }}>
              ✓ Imported <b>{intakeBanner.count}</b> event{intakeBanner.count === 1 ? "" : "s"} from
              the Insta-Scraper. They're appended to your pending list below — refine + approve as usual.
            </span>
            <button
              onClick={() => setIntakeBanner(null)}
              style={{
                background: "transparent",
                border: "1px solid rgba(52,211,153,0.4)",
                color: "#34D399",
                borderRadius: 3,
                padding: "2px 8px",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        )}
        {importMsg && (
          <div style={{
            padding: "10px 14px", marginBottom: "1rem",
            background: importMsg.ok ? "rgba(99,179,237,0.1)" : "rgba(251,113,133,0.1)",
            border: `1px solid ${importMsg.ok ? "rgba(99,179,237,0.4)" : "rgba(251,113,133,0.4)"}`,
            borderLeft: `4px solid ${importMsg.ok ? "#63B3ED" : "#FB7185"}`,
            borderRadius: 4, fontSize: "0.85rem", color: importMsg.ok ? "#63B3ED" : "#FB7185",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ flex: 1 }}>{importMsg.ok ? "✓ " : "⚠ "}{importMsg.text}</span>
            <button onClick={() => setImportMsg(null)} style={{
              background: "transparent", border: `1px solid ${importMsg.ok ? "rgba(99,179,237,0.4)" : "rgba(251,113,133,0.4)"}`,
              color: importMsg.ok ? "#63B3ED" : "#FB7185", borderRadius: 3, padding: "2px 8px", fontSize: "0.75rem", cursor: "pointer",
            }}>×</button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "2px" }}>
            Review Queue {betaMode && <span style={{ color: "#E5BC4F", letterSpacing: "1px" }}>Beta</span>}
          </h1>
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            {betaMode
              ? "Sweep-first variant — testing focused conflict triage on any device"
              : "Augment your sheet — extra checks Excel can't do"}
          </span>
        </div>
        {/* Beta-mode banner — surfaces what's different about this
            variant and points the user at the Sweep button. Lives just
            above the regular toolbar so it's the first thing read. */}
        {betaMode && (
          <div style={{
            marginBottom: "1rem",
            padding: "10px 14px",
            background: "rgba(229,188,79,0.06)",
            border: "1px dashed rgba(229,188,79,0.4)",
            borderRadius: "6px",
            fontSize: "0.7rem",
            color: "rgba(245,240,232,0.8)",
            lineHeight: 1.5,
          }}>
            <strong style={{ color: "#E5BC4F", letterSpacing: "1.2px", textTransform: "uppercase", fontSize: "0.6rem", fontFamily: "'Syne',sans-serif" }}>🧪 Beta variant</strong>
            <span style={{ marginLeft: 8 }}>
              The <strong>⚡ Sweep</strong> button is always visible here (not mobile-only). Use this tab to test the focused one-group-at-a-time conflict triage flow. The regular Review tab remains the production flow.
            </span>
          </div>
        )}

        {/* Upload bar — wraps to columns on mobile (cge-row-wrap-mobile)
            so the buttons don't get crushed and render text per-character
            when the long description hogs the row width. */}
        <div className="cge-row-wrap-mobile" style={{
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
          {/* Pipe 1 — pull promoter bookings from centralgroupevents.com into
              the queue so they don't have to be retyped. */}
          <button
            onClick={importFromWebsite}
            disabled={importBusy}
            title="Pull new promoter bookings submitted on centralgroupevents.com into this review queue"
            style={{ ...B, background: "rgba(99,179,237,0.12)", color: "#63B3ED", border: "1px solid rgba(99,179,237,0.4)", cursor: importBusy ? "wait" : "pointer" }}
          >
            {importBusy ? "⬇ Importing…" : "⬇ Import bookings from website"}
          </button>
          {/* Weekend Friday-date anchor — fills the date column on
              export AND stamps event.date when committing to the store
              (via + Add). Default = upcoming Friday. Sat/Sun derive
              automatically. Hidden when no pending events (nothing to
              date-stamp yet). */}
          {pending.length > 0 && (
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 8px",
              background: "rgba(229,188,79,0.06)",
              border: "1px solid rgba(229,188,79,0.25)",
              borderRadius: "5px",
            }} title={`Sets the date column on export. Fri ${weekendDates.Fri} · Sat ${weekendDates.Sat} · Sun ${weekendDates.Sun}`}>
              <span style={{ fontSize: "0.55rem", color: "#E5BC4F", letterSpacing: "1.2px", textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif" }}>
                Fri Date
              </span>
              <input
                value={friDate}
                onChange={(e) => setFriDate(e.target.value)}
                placeholder="6/27"
                style={{
                  width: "55px",
                  padding: "4px 6px",
                  background: "#111",
                  color: "#F5F0E8",
                  border: "1px solid rgba(245,240,232,0.08)",
                  borderRadius: "3px",
                  fontSize: "0.7rem",
                  fontFamily: "inherit",
                  outline: "none",
                  textAlign: "center",
                  fontWeight: 700,
                }}
              />
              <span style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.4)", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
                Sat {weekendDates.Sat} · Sun {weekendDates.Sun}
              </span>
            </div>
          )}
          {/* Export the FULL pending list as CSV — captures everything
              the user has imported (including conflicts not yet resolved)
              BEFORE refinement. The raw uploaded file is also auto-saved
              to the cloud library on import for ZIP-workspace recovery. */}
          {pending.length > 0 && (
            <button
              onClick={exportFullPendingCsv}
              title={`Export all ${pending.length} pending events as CSV — the unrefined import, including conflicts. The original uploaded file is also archived in the cloud library automatically on every import.`}
              style={{
                padding: "6px 12px",
                background: "rgba(99,179,237,0.10)",
                border: "1px solid rgba(99,179,237,0.35)",
                borderRadius: "5px",
                color: "#63B3ED",
                fontSize: "0.6rem",
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                cursor: "pointer",
                fontFamily: "'Syne',sans-serif",
                whiteSpace: "nowrap",
              }}
            >📥 Export full import ({pending.length})</button>
          )}
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

          {lastSessionName && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.6rem",
                fontWeight: 700,
                letterSpacing: "1px",
                textTransform: "uppercase",
                padding: "5px 10px",
                borderRadius: "5px",
                background: "rgba(52,211,153,0.03)",
                border: "1px solid rgba(52,211,153,0.12)",
                color: autoSaveStatus === "saving" ? "#F59E0B" : autoSaveStatus === "saved" ? "#34D399" : autoSaveStatus === "error" ? "#EF4444" : "#A3A3A3",
                transition: "all 0.3s ease",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: autoSaveStatus === "saving" ? "#F59E0B" : autoSaveStatus === "saved" ? "#34D399" : autoSaveStatus === "error" ? "#EF4444" : "#A3A3A3",
                  display: "inline-block",
                  animation: autoSaveStatus === "saving" ? "cge-pulse 1.2s infinite ease-in-out" : "none",
                }}
              />
              {autoSaveStatus === "saving" && "Saving..."}
              {autoSaveStatus === "saved" && "Saved"}
              {autoSaveStatus === "error" && "Save Failed"}
              {autoSaveStatus === "idle" && "Saved"}
            </span>
          )}

          {/* No-session warning chip — the silent-loss trap: without a
              session attached, sweeps/edits live ONLY on this phone and
              nothing ever syncs. Make that state impossible to miss. */}
          {!lastSessionName && (
            <span
              title="Your work is only saved on this phone. Open Sessions and load (or save) a session so it syncs to the cloud and your partner."
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.6rem",
                fontWeight: 800,
                letterSpacing: "1px",
                textTransform: "uppercase",
                padding: "5px 10px",
                borderRadius: "5px",
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.5)",
                color: "#F87171",
                whiteSpace: "nowrap",
              }}
            >⚠️ This phone only — not synced</span>
          )}

          {/* Live-collab indicator: shows when 2+ devices are working in
              this session right now (partner on their phone, etc.). */}
          {lastSessionName && activeDevices > 1 && (
            <span
              title={`${activeDevices} devices are working in "${lastSessionName}" right now. Changes sync between them automatically.`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.6rem",
                fontWeight: 800,
                letterSpacing: "1px",
                textTransform: "uppercase",
                padding: "5px 10px",
                borderRadius: "999px",
                background: "rgba(52,211,153,0.12)",
                border: "1px solid rgba(52,211,153,0.45)",
                color: "#34D399",
                whiteSpace: "nowrap",
                cursor: "help",
              }}
            >
              <span
                style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: "#34D399", display: "inline-block",
                  animation: "cge-pulse 1.6s infinite ease-in-out",
                }}
              />
              👥 {activeDevices} devices live
            </span>
          )}
          {/* Send the reviewed/curated events store to the CGE website repo
              as a single events.json commit. */}
          <button
            onClick={() => setWebsiteOpen(true)}
            title={`Publish the ${events.length} reviewed events (the curated store) to your Central Group Events website as events.json.`}
            style={{
              padding: "6px 12px",
              background: "rgba(99,179,237,0.10)",
              border: "1px solid rgba(99,179,237,0.35)",
              borderRadius: "5px",
              color: "#63B3ED",
              fontSize: "0.6rem",
              fontWeight: 700,
              letterSpacing: "1.5px",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >🌐 Send to Website ({events.length})</button>
        </div>

        {/* Sync-failure banner — when merges keep failing, the little
            "Save Failed" chip is far too easy to miss on a phone. This
            banner makes it unmistakable that work is stranded locally. */}
        {lastSessionName && autoSaveStatus === "error" && (
          <div style={{
            marginBottom: "1rem",
            padding: "12px 14px",
            background: "rgba(239,68,68,0.14)",
            border: "2px solid #EF4444",
            borderRadius: "8px",
            color: "#FCA5A5",
            fontSize: "0.8rem",
            lineHeight: 1.5,
          }}>
            <strong style={{ color: "#F87171" }}>⚠️ Your changes are NOT reaching the cloud.</strong>{" "}
            They're safe on this phone, but your partner can't see them and they could be
            lost if this page is cleared. Check your internet connection — the app retries
            automatically. If this stays red for more than a minute, screenshot your work
            before closing the tab.
          </div>
        )}

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

            {/* Sweep Conflicts button — opens the ConflictSweepModal,
                which walks the user through DUPE/VENUE/MULTI groups
                one at a time. In standard Review: mobile-only via the
                cge-mobile-only class. In Beta: always visible AND
                rendered larger/brighter so the user can stress-test
                the Sweep flow on any device. */}
            {conflictGroupCount > 0 && (
              <button
                className={betaMode ? "" : "cge-mobile-only"}
                onClick={() => setSweepOpen(true)}
                style={{
                  width: "100%",
                  padding: betaMode ? "16px 18px" : "12px 16px",
                  marginBottom: "0.8rem",
                  background: betaMode ? "rgba(229,188,79,0.18)" : "rgba(229,188,79,0.12)",
                  border: betaMode ? "2px solid #E5BC4F" : "1.5px solid rgba(229,188,79,0.45)",
                  color: "#E5BC4F",
                  borderRadius: 6,
                  fontSize: betaMode ? "0.95rem" : "0.8rem",
                  fontWeight: 800,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "'Syne',sans-serif",
                  display: betaMode ? "flex" : "none", /* beta: always shown; standard: CSS overrides on mobile */
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: betaMode ? "0 0 16px rgba(229,188,79,0.20)" : "none",
                }}
              >
                ⚡ Sweep {conflictGroupCount} Conflict Group{conflictGroupCount === 1 ? "" : "s"}
              </button>
            )}

            {/* Fix Flags button — opens FixFlagsModal for single-event
                triage (missing fields, soft warnings). Pairs with Sweep:
                Sweep handles partner conflicts, Fix Flags handles
                everything else. Same visibility rules: mobile-only in
                standard Review, always visible in betaMode. */}
            {singleFlagEventCount > 0 && (
              <button
                className={betaMode ? "" : "cge-mobile-only"}
                onClick={() => setFixFlagsOpen(true)}
                style={{
                  width: "100%",
                  padding: betaMode ? "16px 18px" : "12px 16px",
                  marginBottom: "0.8rem",
                  background: betaMode ? "rgba(251,113,133,0.16)" : "rgba(251,113,133,0.10)",
                  border: betaMode ? "2px solid #FB7185" : "1.5px solid rgba(251,113,133,0.45)",
                  color: "#FB7185",
                  borderRadius: 6,
                  fontSize: betaMode ? "0.95rem" : "0.8rem",
                  fontWeight: 800,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "'Syne',sans-serif",
                  display: betaMode ? "flex" : "none",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  boxShadow: betaMode ? "0 0 16px rgba(251,113,133,0.18)" : "none",
                }}
              >
                ⚠ Fix {singleFlagEventCount} Flagged Event{singleFlagEventCount === 1 ? "" : "s"}
              </button>
            )}

            {/* Clean Sweep — keep/cut the unflagged events one at a time.
                Always visible (any device): it's a deliberate final curation
                step, distinct from the flag-triage buttons above. */}
            {cleanCount > 0 && (
              <button
                onClick={() => setCleanSweepOpen(true)}
                style={{
                  width: "100%",
                  padding: betaMode ? "16px 18px" : "12px 16px",
                  marginBottom: "0.8rem",
                  background: "rgba(139,92,246,0.12)",
                  border: "1.5px solid rgba(139,92,246,0.5)",
                  color: "#A78BFA",
                  borderRadius: 6,
                  fontSize: betaMode ? "0.95rem" : "0.8rem",
                  fontWeight: 800,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  cursor: "pointer",
                  fontFamily: "'Syne',sans-serif",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                ✨ Clean Sweep {cleanCount} Clean Event{cleanCount === 1 ? "" : "s"}
              </button>
            )}

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

            {/* Filter + sort — wraps on desktop, single horizontal-scroll
                row on mobile (cge-toolbar-row CSS in index.css). */}
            <div className="cge-toolbar-row" style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Filter</span>
              {[["all", "All"], ["clean", "Clean"], ["flagged", "Flagged"], ["approved", "Approved"], ["unapproved", "Unselected"]].map(([k, lbl]) => (
                <button
                  key={k}
                  // Click an active filter again to toggle it back to "All".
                  onClick={() => { setFilter(f => f === k ? "all" : k); if (rowsRef.current) rowsRef.current.scrollIntoView({ block: "start", behavior: "smooth" }); }}
                  style={filter === k ? { ...B, background: "rgba(229,188,79,0.2)", borderColor: "#E5BC4F", color: "#E5BC4F", fontWeight: 800 } : B}
                >{lbl}</button>
              ))}
              {sortByTag && (
                <button
                  onClick={() => setSortByTag(null)}
                  style={{ ...B, background: "#E5BC4F", color: "#000", borderColor: "#E5BC4F" }}
                  title="Clear sort — events return to their original positions"
                >× Sorting {sortByTag} to top</button>
              )}
              <div className="cge-toolbar-spacer" style={{ flex: 1 }} />
              <button onClick={approveClean} style={B} title="Select all clean (no warnings) rows for bulk action">Select clean</button>
              <button onClick={approveAll} style={B} title="Select every row">Select all</button>
              <button onClick={rejectAll} style={B} title="Unselect every row (doesn't delete anything)">Deselect</button>
              {pending.length > 0 && (
                <button
                  onClick={clearReview}
                  style={{ ...B, background: "rgba(251,113,133,0.12)", borderColor: "rgba(251,113,133,0.4)", color: "#FB7185", fontWeight: 700 }}
                  title="Empty the whole review list (all imported events here). Does not touch the Calendar."
                >🗑 Clear all {pending.length}</button>
              )}
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
                    disabled={selectedApprovedCount === 0}
                    style={{
                      ...B,
                      background: selectedApprovedCount === 0 ? "rgba(52,211,153,0.04)" : "rgba(52,211,153,0.18)",
                      borderColor: selectedApprovedCount === 0 ? "rgba(52,211,153,0.15)" : "rgba(52,211,153,0.5)",
                      color: selectedApprovedCount === 0 ? "rgba(52,211,153,0.4)" : "#34D399",
                      fontWeight: 700,
                      cursor: selectedApprovedCount === 0 ? "not-allowed" : "pointer"
                    }}
                    title={selectedApprovedCount === 0 ? "No selected events are approved yet. Approve them first!" : "Add every selected approved row to the calendar / store"}
                  >
                    + Add {selectedApprovedCount} to calendar
                  </button>
                  <button
                    onClick={deleteSelected}
                    style={{ ...B, background: "rgba(251,113,133,0.1)", borderColor: "rgba(251,113,133,0.35)", color: "#FB7185" }}
                    title="Delete every selected row from this review"
                  >
                    ✕ Delete {approvedCount} selected
                  </button>
                  <button onClick={rejectAll} style={B} title="Unselect all (doesn't delete anything)">Deselect</button>
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
              {(showAllRows ? visible : visible.slice(0, ROW_RENDER_CAP)).map(ev => {
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
              {/* Show-all toggle — caps initial render at ROW_RENDER_CAP
                  to prevent "Aw, Snap!" tab crashes on big imports.
                  Reveals the rest on demand. Hidden when below the cap
                  or when already expanded. */}
              {!showAllRows && visible.length > ROW_RENDER_CAP && (
                <button
                  onClick={() => setShowAllRows(true)}
                  style={{
                    width: "100%",
                    padding: "14px",
                    marginTop: "8px",
                    background: "rgba(192,132,252,0.08)",
                    color: "#C084FC",
                    border: "1px dashed rgba(192,132,252,0.4)",
                    borderRadius: "6px",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    letterSpacing: "1.5px",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    fontFamily: "'Syne', sans-serif",
                  }}
                  title={`Showing first ${ROW_RENDER_CAP} of ${visible.length}. Click to render the rest (slower).`}
                >
                  Show all {visible.length} events ({visible.length - ROW_RENDER_CAP} more)
                </button>
              )}
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
        onSaveSuccess={async (name) => {
          // Clear the base FIRST (synchronously) so the sync effect can't
          // fire against the previous session's base while we re-fetch.
          syncBaseRef.current = null;
          rememberLastSession(name);
          setLastSessionName(name);
          // A manual save overwrote the server copy with this device's full
          // state — re-fetch it so the sync base (incl. version) matches.
          try {
            const payload = await loadSession(name);
            syncBaseRef.current = makeBase(payload);
            setSyncTick((t) => t + 1); // re-arm sync now that the base exists
          } catch {
            syncBaseRef.current = null; // sync effect waits until base exists
          }
          setAutoSaveStatus("idle");
        }}
        onDeleteSuccess={(name) => {
          if (lastSessionName === name) {
            forgetLastSession();
            setLastSessionName(null);
            syncBaseRef.current = null;
            setAutoSaveStatus("idle");
          }
        }}
      />
      <WebsitePublishModal
        open={websiteOpen}
        events={events}
        onClose={() => setWebsiteOpen(false)}
      />
      <ColumnMapperModal
        open={mapperOpen}
        rows={importRows}
        fileName={importFileName}
        onCancel={() => { setMapperOpen(false); setImportRows(null); setImportFileName(""); }}
        onConfirm={applyImport}
      />
      {/* Mobile Sweep Conflicts modal — opens via the ⚡ button. On
          Apply, deletes the selected event IDs from pending and clears
          their approval rows; warnings auto-recompute via useMemo. */}
      <ConflictSweepModal
        open={sweepOpen}
        events={pending}
        warnings={warnings}
        onClose={() => setSweepOpen(false)}
        onEdit={(eventId, patch) => {
          setPending(p => p.map(e => String(e.id) === String(eventId) ? { ...e, ...patch } : e));
        }}
        onApplyDeletions={(idsToDelete) => {
          if (!idsToDelete || idsToDelete.length === 0) return;
          const idSet = new Set(idsToDelete.map(String));
          setPending(p => p.filter(e => !idSet.has(String(e.id))));
          setApprovals(a => {
            const next = { ...a };
            idsToDelete.forEach(id => { delete next[id]; });
            return next;
          });
        }}
      />
      {/* Clean Sweep — keep/cut the unflagged events. Cut deletes from
          pending (like the Conflict Sweep); Keep marks the event ✓ vetted
          so it's confirmed to go through. warnings recompute via useMemo. */}
      <CleanSweepModal
        open={cleanSweepOpen}
        events={cleanEvents}
        onClose={() => setCleanSweepOpen(false)}
        onEdit={(eventId, patch) => {
          setPending(p => p.map(e => String(e.id) === String(eventId) ? { ...e, ...patch } : e));
        }}
        onApply={({ keepIds, cutIds }) => {
          if (cutIds && cutIds.length > 0) {
            const cutSet = new Set(cutIds.map(String));
            setPending(p => p.filter(e => !cutSet.has(String(e.id))));
            setApprovals(a => {
              const next = { ...a };
              cutIds.forEach(id => { delete next[id]; });
              return next;
            });
          }
          if (keepIds && keepIds.length > 0) {
            setApprovedSet(s => {
              const next = new Set(s);
              keepIds.forEach(id => next.add(id));
              return next;
            });
          }
        }}
      />
      {/* Fix Flags — single-event triage modal. Edits commit live via
          onEdit so warnings recompute and flags clear in real-time.
          onApply batches the approve/delete decisions: approve marks
          the event as vetted; delete removes it from pending. */}
      <FixFlagsModal
        open={fixFlagsOpen}
        events={pending}
        warnings={warnings}
        onEdit={(eventId, patch) => {
          setPending(p => p.map(e => String(e.id) === String(eventId) ? { ...e, ...patch } : e));
        }}
        onApply={({ approveIds, deleteIds }) => {
          if (deleteIds && deleteIds.length > 0) {
            const delSet = new Set(deleteIds.map(String));
            setPending(p => p.filter(e => !delSet.has(String(e.id))));
            setApprovals(a => {
              const next = { ...a };
              deleteIds.forEach(id => { delete next[id]; });
              return next;
            });
          }
          if (approveIds && approveIds.length > 0) {
            setApprovedSet(s => {
              const next = new Set(s);
              approveIds.forEach(id => next.add(id));
              return next;
            });
          }
        }}
        onClose={() => setFixFlagsOpen(false)}
      />
    </div>
  );
}
