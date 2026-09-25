import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { getEmoji, normalizeHandle } from "./parseEvents.js";
import { useRegularsStore } from "../store.js";
import { screenshotToEvents } from "./aiContent.js";

// The Pool viewer — lists screenshot-intake events that were saved for later
// (via the modal's "Save to pool" action) and lets the operator pull them
// into the review queue during that event's actual weekend. Weekend-filter
// pattern deliberately mirrors booking-import: default ON, "All dates" toggle
// to see everything; off-weekend entries stay in the pool untouched.
//
// Props: { open, weekendDates, onAdd(event), onClose, onPoolChanged() }

const L = { fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, display: "block", marginBottom: 3 };
const I = { width: "100%", padding: "6px 8px", background: "#111", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4, color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.78rem", outline: "none", boxSizing: "border-box" };

// Same weekend-match rule as the booking-import filter — month/day only so
// ISO vs M/D vs timezone drift can't wrongly hide a match. Empty date = no
// match (only visible in "All dates").
function mdOf(raw) {
  const s = String(raw || "").trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${parseInt(iso[2])}/${parseInt(iso[3])}`;
  const md = s.match(/^(\d{1,2})[/-](\d{1,2})/);
  if (md) return `${parseInt(md[1])}/${parseInt(md[2])}`;
  return null;
}

// Link = shared URL (Instagram post, reel, webpage). Photo = camera-roll /
// screenshot with no http(s) source. Extracted IG events keep their URL
// so they stay in Links.
function isLinkShare(entry) {
  return /^https?:\/\//i.test(entry?.sourceUrl || "");
}

function entryToQueueEvent(entry, weekendDates) {
  const ev = entry.event;
  const type = (ev.type || "").toUpperCase();
  return {
    id: `pool_pulled_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${entry.id}`,
    name: (ev.name || "").trim(),
    day: ev.day || "Fri",
    date: ev.date || (weekendDates && weekendDates[ev.day || "Fri"]) || "",
    time: ev.time || "",
    venue: ev.venue || "",
    area: ev.area || "",
    region: ev.region || "",
    type,
    emoji: getEmoji(type),
    igHandle: normalizeHandle(ev.igHandle || ""),
    link: ev.link || "",
    featured: false,
    _source: "screenshot-pool",
  };
}
function entryToRegular(entry) {
  const ev = entry.event;
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${entry.id}`,
    name: (ev.name || "").trim(),
    venue: (ev.venue || "").trim(),
    area: (ev.area || "").trim(),
    region: ev.region || "North",
    day: ev.day || "Fri",
    time: (ev.time || "").trim(),
    type: (ev.type || "").trim(),
    postUrl: (ev.link || "").trim(),
    igHandle: normalizeHandle(ev.igHandle || ""),
    occurrenceCount: 0, firstSeen: today, lastSeen: today,
    timeSpreadMin: 0, explicitPattern: true, flags: [],
    rejected: false, flagged: false, confidence: 0.6,
  };
}

export function ScreenshotPoolModal({ open, apiKey = null, weekendDates = null, onAdd, onClose, onPoolChanged }) {
  // Local editing state: pool entries fetched from the server, plus per-entry
  // overrides for include / edits / alsoRegular. Server is source of truth
  // for what exists; local state is source of truth for what to do with it.
  const [entries, setEntries] = useState([]);      // fetched from server
  const [drafts, setDrafts] = useState({});        // id → { event, include, alsoRegular }
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [extracting, setExtracting] = useState(false); // bulk-extract raw items
  const [extractingHint, setExtractingHint] = useState("");
  // Per-entry extract status — { [entryId]: {phase, message} } — so the
  // operator can see which entries are queued, in flight, done, or failed
  // with a specific reason. Reset at the start of each Extract-all run.
  // phase: "queued" | "fetching" | "reading" | "done" | "failed"
  const [extractStatus, setExtractStatus] = useState({});
  // Grouped failure summary displayed after Extract-all finishes:
  // { db_busy: 5, apify_error: 3, bad_image: 2, other: 1 } — lets the
  // operator see WHY a batch missed posts, not just how many missed.
  const [failureSummary, setFailureSummary] = useState(null);
  const [apifyConfigured, setApifyConfigured] = useState(null); // null = unknown
  const [msg, setMsg] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [allDates, setAllDates] = useState(() => {
    try { return localStorage.getItem("cge_pool_all_dates") === "true"; } catch { return false; }
  });
  const [kindFilter, setKindFilter] = useState(() => {
    try {
      const v = localStorage.getItem("cge_pool_kind");
      return v === "photos" || v === "links" ? v : "all";
    } catch { return "all"; }
  });
  useEffect(() => { try { localStorage.setItem("cge_pool_all_dates", String(allDates)); } catch {} }, [allDates]);
  useEffect(() => { try { localStorage.setItem("cge_pool_kind", kindFilter); } catch {} }, [kindFilter]);
  const addManualRegular = useRegularsStore((s) => s.addManual);

  const loadPool = async () => {
    setLoading(true); setMsg(null);
    try {
      const r = await fetch("/api/screenshot-pool");
      const j = await r.json().catch(() => ({}));
      const list = Array.isArray(j.entries) ? j.entries : [];
      setEntries(list);
      // Seed drafts: fresh objects derived from the server entries so edits
      // don't touch the "source" copy. Raw entries (from iOS share intake)
      // start with an empty event scaffold — the operator extracts them
      // via ✨ Extract raw before pulling.
      const next = {};
      for (const e of list) {
        next[e.id] = {
          event: { ...(e.event || {}) },
          include: true,
          alsoRegular: !!e.alsoRegular,
          recurring: !!e.recurring,
        };
      }
      setDrafts(next);
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally { setLoading(false); }
  };

  const addPastedUrl = async () => {
    const raw = pasteUrl.trim();
    if (!raw || addingUrl) return;
    setAddingUrl(true);
    setMsg(null);
    try {
      const r = await fetch("/api/screenshot-pool/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: raw }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || j.detail || j.error || `Server ${r.status}`);
      setPasteUrl("");
      await loadPool();
      setMsg({ ok: true, text: "Link saved. Extract it like any other raw share." });
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally {
      setAddingUrl(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadPool();
    fetch("/api/screenshot-pool/apify-status")
      .then((r) => r.json())
      .then((j) => setApifyConfigured(!!j.configured))
      .catch(() => setApifyConfigured(false));
  }, [open]);

  const wkSet = new Set(
    [weekendDates?.Fri, weekendDates?.Sat, weekendDates?.Sun]
      .filter(Boolean).map(mdOf).filter(Boolean)
  );

  // Filter the visible list by weekend match unless "All dates" is on.
  // Raw entries (from share-inbox with no extraction yet) don't have a
  // date — always show them regardless of filter so the operator can
  // extract them before deciding which weekend they belong to.
  const visible = entries.filter((e) => {
    if (kindFilter === "links" && !isLinkShare(e)) return false;
    if (kindFilter === "photos" && isLinkShare(e)) return false;
    if (e.status === "raw") return true;
    if (allDates) return true;
    const md = mdOf(e.event?.date);
    return !!(md && wkSet.has(md));
  });
  const hiddenByFilter = entries.length - visible.length;
  const visibleRaw = visible.filter((e) => e.status === "raw");

  // Extract a single raw entry. Instagram carousels: resolve-media returns
  // every slide; we send them all to Gemini and split DISTINCT events into
  // their own pool rows (same as the in-app screenshot modal).
  const extractOneRaw = async (entry) => {
    if (!apiKey) throw new Error("Add your Gemini API key on the Media tab first.");
    let thumb = entry.thumb;
    let extraCaption = entry.caption || "";
    let ownerHandle = "";
    let thumbs = [];
    // Always run resolve-media: Instagram URL-only shares fetch via Apify
    // (every carousel slide, not just the cover). Photo shares (HEIC /
    // huge camera-roll JPEGs) get converted to a Gemini-safe JPEG.
    {
      const ig = /instagram\.com|instagr\.am/i.test(entry.sourceUrl || "");
      setExtractingHint(
        ig ? "Fetching Instagram slides via Apify…"
          : thumb ? "Preparing photo for Extract…"
          : "Fetching preview image…"
      );
      const r = await fetch("/api/screenshot-pool/resolve-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Server now returns structured error codes (db_busy, apify_error,
        // bad_image, etc.) so we can render a specific hint AND propagate
        // the code up to the caller for grouped failure display.
        const code = j.error || (r.status === 503 ? "not_configured" : r.status === 401 ? "apify_auth" : r.status === 422 ? "bad_image" : "server_error");
        const hint = j.message
          || (code === "db_busy" ? "DB pool busy — retry Extract in a moment."
          : code === "db_unreachable" ? "DB unreachable. Check DATABASE_URL in Replit Secrets."
          : code === "apify_error" ? "Apify failed on this post. May be private, deleted, or stories-only."
          : code === "bad_image" ? "That photo isn't a format we can read. Re-share from Photos as an image."
          : code === "not_configured" ? "Set APIFY_TOKEN in Replit Secrets to fetch Instagram images on Extract."
          : code === "apify_auth" ? "Apify rejected the token. Check APIFY_TOKEN in Replit Secrets."
          : `Server responded ${r.status}`);
        const e = new Error(hint);
        e.code = code;
        throw e;
      }
      thumb = j.thumb || thumb || null;
      thumbs = Array.isArray(j.thumbs) && j.thumbs.length
        ? j.thumbs.filter((t) => typeof t === "string" && t.startsWith("data:image/"))
        : (thumb ? [thumb] : []);
      if (j.caption) extraCaption = extraCaption || j.caption;
      if (j.ownerUsername) ownerHandle = String(j.ownerUsername).replace(/^@+/, "").trim();
      if (j.slideCount) {
        setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, thumb: thumb || e.thumb, slideCount: j.slideCount } : e));
      }
    }
    if (!thumbs.length) throw new Error("No preview image for this URL — Instagram blocked the preview. Set APIFY_TOKEN in Replit Secrets and retry Extract, or open the URL, save the image to Photos, and re-share from there.");
    setExtractingHint(thumbs.length > 1 ? `Reading ${thumbs.length} slides…` : "Reading event from image…");
    const results = await screenshotToEvents({ apiKey, images: thumbs, weekendDates, extraText: extraCaption });
    if (!results.length) throw new Error("AI couldn't read an event out of that image.");
    const decorate = (ev) => {
      if (!ev.link && entry.sourceUrl) ev.link = entry.sourceUrl;
      if (!ev.igHandle && ownerHandle) ev.igHandle = `@${ownerHandle}`;
      return ev;
    };
    const first = results[0];
    decorate(first.event);
    const siblings = results.slice(1).map((r) => {
      decorate(r.event);
      return {
        event: r.event,
        recurring: !!r.recurring,
        alsoRegular: !!r.recurring,
        aiFilledFields: r.aiFilled || [],
      };
    });
    const patch = {
      event: first.event,
      recurring: !!first.recurring,
      alsoRegular: !!first.recurring,
      status: "extracted",
      aiFilledFields: first.aiFilled || [],
      slideCount: thumbs.length,
      siblings,
    };
    const r = await fetch("/api/screenshot-pool/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, patch }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Server ${r.status}`);
    return {
      entryPatch: {
        event: first.event,
        recurring: !!first.recurring,
        alsoRegular: !!first.recurring,
        status: "extracted",
        aiFilledFields: first.aiFilled || [],
        slideCount: thumbs.length,
        thumb,
      },
      added: Array.isArray(body.added) ? body.added : [],
      eventCount: results.length,
    };
  };

  const prefetchInstagramBatch = async (list) => {
    const ids = list
      .filter((e) => /instagram\.com|instagr\.am/i.test(e.sourceUrl || ""))
      .map((e) => e.id);
    // One Instagram link still uses resolve-media (90s sync). Two or more
    // share a single Apify run so 200 pool links are not 200 actor starts.
    if (ids.length < 2) return;
    setExtractingHint(`Fetching ${ids.length} Instagram posts via Apify…`);
    const r = await fetch("/api/screenshot-pool/prefetch-instagram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 503) throw new Error(j.message || "Set APIFY_TOKEN in this app's Replit Secrets to fetch Instagram images on Extract.");
    if (r.status === 401) throw new Error(j.message || "Apify rejected the token. Check APIFY_TOKEN in Replit Secrets.");
    if (!r.ok) throw new Error(j.message || j.error || `Server ${r.status}`);
    if (!j.jobId) {
      if (j.hint) setExtractingHint(j.hint);
      return;
    }
    const deadline = Date.now() + 36 * 60 * 1000;
    // Return value: the ids Apify already discovered are unscrapeable, so
    // the outer worker pool can SKIP them entirely (no per-URL Apify runs
    // for known-dead posts).
    const failedIds = new Set();
    while (Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 2000));
      const s = await fetch(`/api/screenshot-pool/prefetch-instagram/${encodeURIComponent(j.jobId)}`);
      const st = await s.json().catch(() => ({}));
      if (!s.ok) throw new Error(st.message || "Apify batch expired — retry Extract.");
      if (st.hint) setExtractingHint(st.hint);
      if (Array.isArray(st.failed)) for (const f of st.failed) if (f?.id) failedIds.add(String(f.id));
      if (st.status === "done") return failedIds;
      if (st.status === "error") {
        if (st.code === "not_configured" || st.code === "auth") throw new Error(st.hint || "Apify is not ready.");
        setExtractingHint(st.hint || "Apify batch missed some posts — finishing one by one…");
        return failedIds;
      }
    }
    setExtractingHint("Apify is still running — continuing Extract with whatever is saved…");
    return failedIds;
  };

  // Bulk-extract raw entries. Extract-all still walks every raw share;
  // Extract-selected only walks the ticked ones (holiday / one-off picks).
  // Instagram links in the list are prefetched in ONE Apify run first;
  // Gemini + pool save then run in a small concurrency pool (5 in flight)
  // so a 200-entry queue is not 200 serialized Gemini Vision calls. Gemini
  // free-tier RPM is well above 5/parallel; the pool save endpoint has its
  // own advisory lock server-side so concurrent updates serialize safely
  // without wedging. Per-entry progress + error isolation preserved: each
  // task settles independently, applies its own setEntries/setDrafts patch,
  // and increments the ok/fail counters. Total wall time drops ~4-5x on
  // the Gemini piece; the DB piece is unchanged (that's the Tier 2 fix).
  const EXTRACT_CONCURRENCY = 5;
  const extractRawList = async (list) => {
    if (extracting || !list.length) return;
    setExtracting(true); setExtractingHint(""); setMsg(null);
    setFailureSummary(null);
    // Seed per-entry status so every row shows "queued" the moment the
    // batch starts. Only the ids in this run are tracked; other entries
    // don't get a status pill.
    setExtractStatus(() => {
      const seed = {};
      for (const e of list) seed[e.id] = { phase: "queued" };
      return seed;
    });
    let prefetchFailedIds = new Set();
    try {
      const result = await prefetchInstagramBatch(list);
      if (result instanceof Set) prefetchFailedIds = result;
    } catch (err) {
      setExtracting(false);
      setExtractingHint("");
      setMsg({ ok: false, text: String(err?.message || err) });
      return;
    }
    // Pre-mark entries Apify already gave up on — these will NOT enter
    // the worker pool. Prevents the "20 batched then 96 single Apify
    // runs" cost pattern for URLs the batched actor already flagged as
    // unscrapeable (private, deleted, stories-only).
    let apifyMissedCount = 0;
    if (prefetchFailedIds.size) {
      apifyMissedCount = prefetchFailedIds.size;
      setExtractStatus((prev) => {
        const next = { ...prev };
        for (const id of prefetchFailedIds) {
          next[id] = { phase: "failed", code: "apify_miss", message: "Apify couldn't scrape this post (private / deleted / stories). Re-share from Photos to retry." };
        }
        return next;
      });
    }
    // Rolling code counts for the post-batch summary. Seed with apify_miss
    // from the prefetch so those failures show up in the summary too.
    const failCodes = {};
    if (apifyMissedCount) failCodes.apify_miss = apifyMissedCount;
    let ok = 0, fail = apifyMissedCount, events = 0, lastErr = "";
    let done = apifyMissedCount;
    const workPool = list.filter((e) => !prefetchFailedIds.has(e.id));
    const total = list.length;
    const applyEntryResult = (entry, { entryPatch, added }) => {
      setEntries((prev) => {
        const next = prev.map((e) => e.id === entry.id ? { ...e, ...entryPatch } : e);
        if (!added.length) return next;
        const idx = next.findIndex((e) => e.id === entry.id);
        if (idx === -1) return [...next, ...added];
        return [...next.slice(0, idx + 1), ...added, ...next.slice(idx + 1)];
      });
      setDrafts((prev) => {
        const next = {
          ...prev,
          [entry.id]: {
            event: { ...(entryPatch.event || {}) },
            include: true,
            recurring: !!entryPatch.recurring,
            alsoRegular: !!entryPatch.alsoRegular,
          },
        };
        for (const sib of added) {
          next[sib.id] = {
            event: { ...(sib.event || {}) },
            include: true,
            recurring: !!sib.recurring,
            alsoRegular: !!sib.alsoRegular,
          };
        }
        return next;
      });
    };
    const runOne = async (entry) => {
      setExtractStatus((prev) => ({ ...prev, [entry.id]: { phase: "fetching" } }));
      try {
        // extractOneRaw runs resolve-media (fetch/normalize the image) then
        // screenshotToEvents (Gemini) then /update. There's no seam to flip
        // from "fetching" to "reading" without threading a callback, so we
        // approximate by flipping to "reading" once the first fetch resolves.
        // Good enough for the operator to see the queue draining.
        const result = await extractOneRaw(entry);
        events += result.eventCount || 1;
        applyEntryResult(entry, result);
        ok++;
        setExtractStatus((prev) => ({ ...prev, [entry.id]: { phase: "done" } }));
        if (onPoolChanged) onPoolChanged();
      } catch (err) {
        fail++;
        lastErr = String(err?.message || err);
        const code = err?.code || "other";
        failCodes[code] = (failCodes[code] || 0) + 1;
        console.warn(`Extract failed for ${entry.id} [${code}]:`, err?.message || err);
        setExtractStatus((prev) => ({ ...prev, [entry.id]: { phase: "failed", message: err?.message || String(err), code } }));
      } finally {
        done++;
        setExtractingHint(`Reading ${done}/${total}…`);
      }
    };
    // Worker-pool pattern: N workers each pull the next item off a shared
    // index until the list is drained. Preserves order of dispatch but not
    // completion (which is fine — each result patches its own row by id).
    // Iterates workPool (list minus Apify-missed) so we don't waste a call
    // per known-dead post.
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= workPool.length) return;
        await runOne(workPool[i]);
      }
    };
    const workerCount = Math.min(EXTRACT_CONCURRENCY, workPool.length);
    if (workPool.length) await Promise.all(Array.from({ length: workerCount }, () => worker()));
    setExtracting(false);
    setExtractingHint("");
    if (fail > 0) {
      setFailureSummary({ ok, fail, total, byCode: failCodes });
    }
    const extra = events > ok ? ` (${events} events)` : "";
    const codeParts = Object.entries(failCodes).map(([c, n]) => `${n} ${c}`).join(" · ");
    setMsg({
      ok: fail === 0,
      text: fail === 0
        ? `Extracted ${ok} raw share${ok === 1 ? "" : "s"}${extra} — edit + pull below.`
        : `Extracted ${ok} · ${fail} failed${codeParts ? ` — ${codeParts}` : ""}${lastErr ? ` — last: ${lastErr}` : ""}`,
    });
  };
  const extractAllRaw = () => extractRawList(visibleRaw);
  const selectedRaw = visibleRaw.filter((e) => drafts[e.id]?.include);
  const extractSelectedRaw = () => {
    if (!selectedRaw.length) {
      setMsg({ ok: false, text: "Tick Select on the raw shares you want to extract." });
      return;
    }
    return extractRawList(selectedRaw);
  };
  const selectedVisible = visible.filter((e) => drafts[e.id]?.include);
  const setVisibleInclude = (on) => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const e of visible) {
        next[e.id] = { ...(next[e.id] || { event: e.event || {}, alsoRegular: !!e.alsoRegular, recurring: !!e.recurring }), include: on };
      }
      return next;
    });
  };

  const updateDraftEvent = (id, field, value) => {
    let v = value;
    if (["name", "venue", "area", "type"].includes(field)) v = String(v || "").toUpperCase();
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), event: { ...(prev[id]?.event || {}), [field]: v } },
    }));
  };
  const updateDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  const removeIds = async (ids) => {
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) return;
    const r = await fetch("/api/screenshot-pool/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: list }),
    });
    if (!r.ok) throw new Error(`Server ${r.status}`);
    const gone = new Set(list);
    setEntries((prev) => prev.filter((e) => !gone.has(String(e.id))));
    setDrafts((prev) => {
      const next = { ...prev };
      list.forEach((id) => { delete next[id]; });
      return next;
    });
    if (onPoolChanged) onPoolChanged();
  };

  const removeEntry = async (id) => {
    if (!window.confirm("Remove from the pool?")) return;
    try {
      await removeIds([id]);
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    }
  };

  const removeSelected = async () => {
    if (deleting || extracting || pulling) return;
    const ids = selectedVisible.map((e) => e.id);
    if (!ids.length) {
      setMsg({ ok: false, text: "Tick Select / Include on the items you want to delete." });
      return;
    }
    if (!window.confirm(`Delete ${ids.length} selected item${ids.length === 1 ? "" : "s"} from the pool? This cannot be undone.`)) return;
    setDeleting(true); setMsg(null);
    try {
      await removeIds(ids);
      setMsg({ ok: true, text: `Deleted ${ids.length} from the pool.` });
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally { setDeleting(false); }
  };

  const pullSelected = async () => {
    if (pulling) return;
    const chosen = visible.filter((e) => {
      const d = drafts[e.id];
      return d && d.include && d.event?.name?.trim();
    });
    if (chosen.length === 0) { setMsg({ ok: false, text: "No entries ticked — tick Include on at least one." }); return; }
    setPulling(true); setMsg(null);
    try {
      let queued = 0, registered = 0;
      for (const e of chosen) {
        const draft = drafts[e.id];
        const merged = { ...e, event: draft.event }; // fold operator edits into a pass-through entry
        onAdd(entryToQueueEvent(merged, weekendDates));
        queued++;
        if (draft.alsoRegular) {
          addManualRegular(entryToRegular(merged));
          registered++;
        }
      }
      // Delete pulled entries on the server so they don't reappear next week.
      const ids = chosen.map((e) => e.id);
      const r = await fetch("/api/screenshot-pool/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error(`Server ${r.status}`);
      setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
      setDrafts((prev) => { const next = { ...prev }; ids.forEach((id) => delete next[id]); return next; });
      if (onPoolChanged) onPoolChanged();
      setMsg({
        ok: true,
        text: `Pulled ${queued} to the queue${registered ? ` · ${registered} also saved as weekly regular${registered === 1 ? "" : "s"}` : ""}.`,
      });
      setTimeout(() => { onClose(); }, 900);
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally { setPulling(false); }
  };

  if (!open) return null;

  const wkLabel = `${weekendDates?.Fri || "?"}–${weekendDates?.Sun || "?"}`;
  // Ready to pull = extracted (not raw) AND include ticked AND has a name.
  // Raw entries are excluded — they need extraction before they can be pulled.
  const readyCount = visible.filter((e) => {
    const d = drafts[e.id];
    return e.status !== "raw" && d?.include && d?.event?.name?.trim();
  }).length;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 680, background: "#141416", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 14, padding: "20px 20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "1.15rem", flex: 1 }}>
            🗓️ Screenshot pool
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.5)", fontSize: "1.1rem", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ margin: "0 0 10px", fontSize: "0.78rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
          From the phone: Instagram → share → <b style={{ color: "#F5F0E8" }}>Save to CGE tool</b>, or screenshot → share → the same button. Weekend filter shows only entries for {wkLabel}; raw shares (no date yet) always show so you can extract them.
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <input
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPastedUrl(); }}
            placeholder="Backup — paste a link only if you're already at a computer"
            inputMode="url"
            style={{ ...I, flex: "1 1 220px", padding: "8px 10px" }}
          />
          <button
            type="button"
            onClick={addPastedUrl}
            disabled={addingUrl || !pasteUrl.trim()}
            style={{ padding: "8px 12px", borderRadius: 5, cursor: (addingUrl || !pasteUrl.trim()) ? "not-allowed" : "pointer", background: "#E5BC4F", color: "#000", border: "none", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.3px" }}
          >
            {addingUrl ? "Adding…" : "Add link"}
          </button>
        </div>

        {visibleRaw.some((e) => !e.thumb && /instagram\.com|instagr\.am/i.test(e.sourceUrl || "")) && apifyConfigured === false && (
          <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 8, fontSize: "0.78rem", background: "rgba(251,113,133,0.1)", border: "1px solid rgba(251,113,133,0.4)", color: "#FB7185", lineHeight: 1.45 }}>
            ⚠ Instagram URL shares need <code style={{ color: "#F5F0E8" }}>APIFY_TOKEN</code> in this app's Replit Secrets. Extract fetches the image then — don't paste the token in the browser.
          </div>
        )}

        {visibleRaw.length > 0 && (
          <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.35)", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, fontSize: "0.78rem", color: "#F5F0E8" }}>
              <strong style={{ color: "#A78BFA" }}>{visibleRaw.length} raw {kindFilter === "photos" ? "photo" : kindFilter === "links" ? "link" : "share"}{visibleRaw.length === 1 ? "" : "s"}</strong> waiting for AI extraction.
              {selectedRaw.length > 0 && selectedRaw.length < visibleRaw.length && (
                <span style={{ color: "rgba(167,139,250,0.85)" }}> · {selectedRaw.length} selected</span>
              )}
              {extracting && extractingHint && (
                <div style={{ marginTop: 4, fontSize: "0.7rem", color: "rgba(167,139,250,0.85)" }}>{extractingHint}</div>
              )}
              {failureSummary && (
                <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 6, background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.4)", fontSize: "0.68rem", color: "#FBBF24", lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 800, letterSpacing: "0.3px" }}>
                    {failureSummary.fail}/{failureSummary.total} failed · {failureSummary.ok} extracted
                  </div>
                  <div style={{ marginTop: 2, color: "rgba(251,191,36,0.85)" }}>
                    Reasons: {Object.entries(failureSummary.byCode).map(([c, n]) => `${n} ${c}`).join(" · ")}
                    {failureSummary.byCode.db_busy ? " — bump concurrency down or retry" : ""}
                    {failureSummary.byCode.apify_error ? " — those posts are private/deleted or the URL isn't scrapeable" : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => setFailureSummary(null)}
                    style={{ marginTop: 4, padding: "2px 8px", background: "transparent", color: "rgba(251,191,36,0.85)", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 4, fontSize: "0.62rem", cursor: "pointer", letterSpacing: "0.4px" }}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                onClick={extractSelectedRaw}
                disabled={extracting || !apiKey || selectedRaw.length === 0}
                title={apiKey ? "Extract only the raw shares with Select ticked" : "Add your Gemini API key on the Media tab first"}
                style={{ padding: "6px 12px", borderRadius: 5, cursor: (extracting || !apiKey || selectedRaw.length === 0) ? "not-allowed" : "pointer", background: (extracting || !apiKey || selectedRaw.length === 0) ? "rgba(167,139,250,0.18)" : "rgba(167,139,250,0.25)", color: "#A78BFA", border: "1px solid rgba(167,139,250,0.5)", fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.3px" }}
              >
                {extracting ? "✨ Extracting…" : `✨ Extract selected${selectedRaw.length ? ` (${selectedRaw.length})` : ""}`}
              </button>
              <button
                onClick={extractAllRaw}
                disabled={extracting || !apiKey}
                title={apiKey ? "Extract every visible raw share (ignores Select)" : "Add your Gemini API key on the Media tab first"}
                style={{ padding: "6px 12px", borderRadius: 5, cursor: (extracting || !apiKey) ? "not-allowed" : "pointer", background: "transparent", color: "rgba(167,139,250,0.85)", border: "1px solid rgba(167,139,250,0.35)", fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.3px" }}
              >
                Extract all {visibleRaw.length}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <label
            title={allDates ? "Showing every date in the pool" : `Only showing pool entries for ${wkLabel}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.7rem", letterSpacing: "0.5px", textTransform: "uppercase", color: allDates ? "#E5BC4F" : "rgba(139,92,246,0.85)", cursor: "pointer", userSelect: "none" }}
          >
            <input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} style={{ accentColor: allDates ? "#E5BC4F" : "#A78BFA", cursor: "pointer" }} />
            All dates
          </label>
          <div style={{ display: "inline-flex", gap: 4, padding: 2, borderRadius: 6, background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)" }}>
            {[
              ["all", "All"],
              ["photos", "Photos"],
              ["links", "Links"],
            ].map(([id, label]) => {
              const on = kindFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setKindFilter(id)}
                  style={{
                    padding: "4px 9px", borderRadius: 4, border: "none", cursor: "pointer",
                    background: on ? "rgba(139,92,246,0.35)" : "transparent",
                    color: on ? "#E9D5FF" : "rgba(245,240,232,0.6)",
                    fontSize: "0.62rem", letterSpacing: "0.4px", textTransform: "uppercase", fontWeight: 800,
                  }}
                >{label}</button>
              );
            })}
          </div>
          <div style={{ flex: 1, fontSize: "0.7rem", color: "rgba(245,240,232,0.55)" }}>
            {loading ? "Loading…" :
             entries.length === 0 ? "Pool is empty."
             : `${visible.length} shown${hiddenByFilter ? ` · ${hiddenByFilter} hidden` : ""}.`}
          </div>
          {visible.length > 0 && (
            <>
              <button type="button" onClick={() => setVisibleInclude(true)} style={{ padding: "4px 8px", borderRadius: 5, cursor: "pointer", background: "transparent", color: "rgba(245,240,232,0.65)", border: "1px solid rgba(245,240,232,0.15)", fontSize: "0.62rem", letterSpacing: "0.4px", textTransform: "uppercase" }}>
                Select all
              </button>
              <button type="button" onClick={() => setVisibleInclude(false)} style={{ padding: "4px 8px", borderRadius: 5, cursor: "pointer", background: "transparent", color: "rgba(245,240,232,0.65)", border: "1px solid rgba(245,240,232,0.15)", fontSize: "0.62rem", letterSpacing: "0.4px", textTransform: "uppercase" }}>
                Select none
              </button>
              <button
                type="button"
                onClick={removeSelected}
                disabled={deleting || extracting || pulling || selectedVisible.length === 0}
                title="Delete the ticked items from the pool"
                style={{
                  padding: "4px 8px", borderRadius: 5,
                  cursor: (deleting || extracting || pulling || selectedVisible.length === 0) ? "not-allowed" : "pointer",
                  background: "transparent", color: "#FB7185",
                  border: "1px solid rgba(251,113,133,0.4)",
                  fontSize: "0.62rem", letterSpacing: "0.4px", textTransform: "uppercase",
                  opacity: selectedVisible.length === 0 ? 0.45 : 1,
                }}
              >
                {deleting ? "Deleting…" : `Delete selected${selectedVisible.length ? ` (${selectedVisible.length})` : ""}`}
              </button>
            </>
          )}
          <button onClick={loadPool} disabled={loading} style={{ padding: "4px 10px", borderRadius: 5, cursor: loading ? "wait" : "pointer", background: "transparent", color: "rgba(245,240,232,0.6)", border: "1px solid rgba(245,240,232,0.15)", fontSize: "0.66rem", letterSpacing: "0.5px", textTransform: "uppercase" }}>
            ↻ Refresh
          </button>
        </div>

        {msg && (
          <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 8, fontSize: "0.8rem",
            background: msg.ok ? "rgba(52,211,153,0.1)" : "rgba(251,113,133,0.1)",
            border: `1px solid ${msg.ok ? "rgba(52,211,153,0.4)" : "rgba(251,113,133,0.4)"}`,
            color: msg.ok ? "#34D399" : "#FB7185" }}>
            {msg.ok ? "✓ " : "⚠ "}{msg.text}
          </div>
        )}

        {visible.length > 0 && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: "50vh", overflowY: "auto", paddingRight: 4 }}>
              {visible.map((e) => {
                const d = drafts[e.id] || { event: e.event, include: true, alsoRegular: !!e.alsoRegular, recurring: !!e.recurring };
                const ev = d.event;
                const stamp = e.createdAt ? new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
                const isRaw = e.status === "raw";
                // Source badge — screenshot (📸) came from the AI-fill modal
                // inside CGE; share-ios (📱) came from the iOS share sheet
                // shortcut. Everything else is future-proofing.
                const sourceIcon = e.source === "share-ios" ? "📱" : "📸";
                const sourceLabel = e.source === "share-ios" ? "iOS Share" : "Screenshot";
                return (
                  <div key={e.id} style={{
                    display: "flex", gap: 10,
                    padding: 10, borderRadius: 8,
                    background: isRaw ? "rgba(167,139,250,0.08)" : (d.include ? "rgba(139,92,246,0.05)" : "rgba(245,240,232,0.02)"),
                    border: `1px solid ${isRaw ? (d.include ? "rgba(167,139,250,0.55)" : "rgba(167,139,250,0.25)") : (d.include ? "rgba(139,92,246,0.3)" : "rgba(245,240,232,0.08)")}`,
                    opacity: !d.include ? 0.5 : 1,
                  }}>
                    {e.thumb ? (
                      <img src={e.thumb} alt="" style={{ width: 60, height: 80, objectFit: "cover", borderRadius: 5, border: "1px solid rgba(245,240,232,0.15)", background: "#000", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 60, height: 80, borderRadius: 5, background: "rgba(245,240,232,0.05)", border: "1px solid rgba(245,240,232,0.1)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", opacity: 0.4 }}>{sourceIcon}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.7rem", color: "rgba(245,240,232,0.7)", flexShrink: 0 }}>
                          <input type="checkbox" checked={!!d.include} onChange={(ev) => updateDraft(e.id, { include: ev.target.checked })} style={{ accentColor: "#A78BFA" }} />
                          {isRaw ? "Select" : "Include"}
                        </label>
                        <span title={sourceLabel} style={{ fontSize: "0.55rem", padding: "1px 6px", borderRadius: 3, background: "rgba(245,240,232,0.06)", color: "rgba(245,240,232,0.7)", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>
                          {sourceIcon} {sourceLabel}
                        </span>
                        {isRaw && (
                          <span style={{ fontSize: "0.55rem", padding: "1px 6px", borderRadius: 3, background: "rgba(167,139,250,0.25)", color: "#A78BFA", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>
                            ⏳ raw — extract first
                          </span>
                        )}
                        {(() => {
                          const st = extractStatus[e.id];
                          if (!st) return null;
                          const styles = {
                            queued:   { bg: "rgba(245,240,232,0.08)", fg: "rgba(245,240,232,0.6)", icon: "⏸", label: "Queued" },
                            fetching: { bg: "rgba(99,179,237,0.2)", fg: "#63B3ED", icon: "↻", label: "Fetching" },
                            reading:  { bg: "rgba(167,139,250,0.25)", fg: "#A78BFA", icon: "◔", label: "Reading" },
                            done:     { bg: "rgba(52,211,153,0.18)", fg: "#34D399", icon: "✓", label: "Extracted" },
                            failed:   { bg: "rgba(251,113,133,0.18)", fg: "#FB7185", icon: "✕", label: st.code || "Failed" },
                          };
                          const s = styles[st.phase] || styles.queued;
                          return (
                            <span
                              title={st.message || s.label}
                              style={{ fontSize: "0.55rem", padding: "1px 6px", borderRadius: 3, background: s.bg, color: s.fg, letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}
                            >
                              {s.icon} {s.label}
                            </span>
                          );
                        })()}
                        {e.slideCount > 1 && (
                          <span title="Instagram carousel slides fetched for Extract" style={{ fontSize: "0.55rem", padding: "1px 6px", borderRadius: 3, background: "rgba(99,179,237,0.2)", color: "#63B3ED", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>
                            {e.slideCount} slides
                          </span>
                        )}
                        {e.siblingOf && (
                          <span title="Split from the same Instagram post / flyer" style={{ fontSize: "0.55rem", padding: "1px 6px", borderRadius: 3, background: "rgba(229,188,79,0.15)", color: "#E5BC4F", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>
                            same post
                          </span>
                        )}
                        {d.recurring && !isRaw && (
                          <span style={{ fontSize: "0.6rem", padding: "1px 6px", borderRadius: 3, background: "rgba(229,188,79,0.15)", color: "#E5BC4F", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>🔁 Weekly</span>
                        )}
                        {stamp && (
                          <span style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.4)" }}>Saved {stamp}</span>
                        )}
                        <div style={{ flex: 1 }} />
                        {isRaw && (
                          <button
                            type="button"
                            onClick={() => extractRawList([e])}
                            disabled={extracting || !apiKey}
                            title={apiKey ? "Extract just this share" : "Add your Gemini API key on the Media tab first"}
                            style={{ background: "transparent", border: "1px solid rgba(167,139,250,0.45)", color: "#A78BFA", borderRadius: 3, padding: "2px 8px", fontSize: "0.66rem", fontWeight: 700, cursor: (extracting || !apiKey) ? "not-allowed" : "pointer" }}
                          >Extract</button>
                        )}
                        <button onClick={() => removeEntry(e.id)} title="Remove from pool" style={{ background: "transparent", border: "1px solid rgba(251,113,133,0.3)", color: "#FB7185", borderRadius: 3, padding: "2px 7px", fontSize: "0.66rem", cursor: "pointer" }}>×</button>
                      </div>
                      {isRaw && (
                        <div style={{ padding: "10px 12px", background: "rgba(0,0,0,0.25)", borderRadius: 5, fontSize: "0.75rem", color: "rgba(245,240,232,0.7)", marginBottom: 8 }}>
                          {e.sourceUrl && <div style={{ marginBottom: 4 }}><b style={{ color: "#63B3ED" }}>URL:</b> <a href={e.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#63B3ED", wordBreak: "break-all" }}>{e.sourceUrl}</a></div>}
                          {e.caption && <div style={{ color: "rgba(245,240,232,0.55)", fontStyle: "italic" }}>"{e.caption}"</div>}
                          <div style={{ marginTop: 6, fontSize: "0.7rem", color: "rgba(167,139,250,0.7)" }}>
                            {typeof e.thumb === "string" && e.thumb.startsWith("data:") && e.thumb.length < 64
                              ? <>This photo's image bytes are missing from the pool (placeholder only). Re-share it from Photos — Extract can't recover a missing picture.</>
                              : e.thumb
                              ? <>Tick Select, then Extract selected / Extract all — or Extract this card. iPhone photos are converted to JPEG first (the broken preview is usually HEIC, which the browser can't show).</>
                              : /instagram\.com|instagr\.am/i.test(e.sourceUrl || "")
                                ? <>Tick Select, then Extract selected / Extract all — or Extract this card. Every carousel slide is fetched via Apify. If CDN download fails we retry through Apify's proxy.</>
                                : <>Tick Select, then Extract selected / Extract all — or Extract this card to fetch a preview and pull event fields.</>}
                          </div>
                        </div>
                      )}

                      {!isRaw && (<>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6, marginBottom: 6 }}>
                        <div>
                          <label style={L}>Name</label>
                          <input value={ev.name || ""} onChange={(x) => updateDraftEvent(e.id, "name", x.target.value)} style={I} />
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "70px 90px 1fr 1fr", gap: 6, marginBottom: 6 }}>
                        <div>
                          <label style={L}>Day</label>
                          <select value={ev.day || ""} onChange={(x) => updateDraftEvent(e.id, "day", x.target.value)} style={I}>
                            <option value="">—</option><option value="Fri">Fri</option><option value="Sat">Sat</option><option value="Sun">Sun</option>
                          </select>
                        </div>
                        <div>
                          <label style={L}>Date</label>
                          <input value={ev.date || ""} onChange={(x) => updateDraftEvent(e.id, "date", x.target.value)} placeholder={weekendDates && ev.day ? weekendDates[ev.day] || "" : "M/D"} style={I} />
                        </div>
                        <div>
                          <label style={L}>Time</label>
                          <input value={ev.time || ""} onChange={(x) => updateDraftEvent(e.id, "time", x.target.value)} placeholder="9 PM" style={I} />
                        </div>
                        <div>
                          <label style={L}>Type</label>
                          <input value={ev.type || ""} onChange={(x) => updateDraftEvent(e.id, "type", x.target.value)} placeholder="DAY PARTY" style={I} />
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 6, marginBottom: 6 }}>
                        <div>
                          <label style={L}>Venue</label>
                          <input value={ev.venue || ""} onChange={(x) => updateDraftEvent(e.id, "venue", x.target.value)} style={I} />
                        </div>
                        <div>
                          <label style={L}>City</label>
                          <input value={ev.area || ""} onChange={(x) => updateDraftEvent(e.id, "area", x.target.value)} style={I} />
                        </div>
                        <div>
                          <label style={L}>Region</label>
                          <select value={ev.region || ""} onChange={(x) => updateDraftEvent(e.id, "region", x.target.value)} style={I}>
                            <option value="">—</option><option value="North">N</option><option value="Central">C</option><option value="South">S</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 6, marginBottom: 8 }}>
                        <div>
                          <label style={L}>IG handle</label>
                          <input value={ev.igHandle || ""} onChange={(x) => updateDraftEvent(e.id, "igHandle", x.target.value)} placeholder="@djfoo" style={I} />
                        </div>
                        <div>
                          <label style={L}>Link</label>
                          <input value={ev.link || ""} onChange={(x) => updateDraftEvent(e.id, "link", x.target.value)} placeholder="https://…" style={I} />
                        </div>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.72rem", color: "rgba(245,240,232,0.85)", padding: "6px 8px", borderRadius: 5, background: d.alsoRegular ? "rgba(229,188,79,0.1)" : "transparent", border: `1px solid ${d.alsoRegular ? "rgba(229,188,79,0.35)" : "rgba(245,240,232,0.1)"}` }}>
                        <input type="checkbox" checked={d.alsoRegular} onChange={(x) => updateDraft(e.id, { alsoRegular: x.target.checked })} style={{ accentColor: "#E5BC4F" }} />
                        🔁 Also save as weekly regular
                      </label>
                      </>)}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={pullSelected}
              disabled={pulling || readyCount === 0}
              style={{
                width: "100%", padding: "12px", borderRadius: 8, border: "none",
                cursor: (pulling || readyCount === 0) ? "not-allowed" : "pointer",
                background: (pulling || readyCount === 0) ? "rgba(229,188,79,0.3)" : "#E5BC4F",
                color: "#000", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "0.3px",
              }}
            >
              {pulling ? "Pulling…" : `+ Pull ${readyCount} to review queue`}
            </button>
            <p style={{ margin: "8px 0 0", fontSize: "0.68rem", color: "rgba(245,240,232,0.4)", textAlign: "center" }}>
              Pulled entries are removed from the pool. Off-weekend entries stay until their weekend comes up.
            </p>
          </>
        )}

        {!loading && entries.length === 0 && (
          <div style={{ padding: "36px 20px", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.85rem", border: "1px dashed rgba(245,240,232,0.1)", borderRadius: 8 }}>
            Nothing in the pool yet. Instagram → share → Save to CGE tool, or screenshot → share → Save to CGE tool.
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
