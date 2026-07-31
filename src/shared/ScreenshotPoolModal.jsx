import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { getEmoji, normalizeHandle } from "./parseEvents.js";
import { useRegularsStore } from "../store.js";

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

export function ScreenshotPoolModal({ open, weekendDates = null, onAdd, onClose, onPoolChanged }) {
  // Local editing state: pool entries fetched from the server, plus per-entry
  // overrides for include / edits / alsoRegular. Server is source of truth
  // for what exists; local state is source of truth for what to do with it.
  const [entries, setEntries] = useState([]);      // fetched from server
  const [drafts, setDrafts] = useState({});        // id → { event, include, alsoRegular }
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [msg, setMsg] = useState(null);
  const [allDates, setAllDates] = useState(() => {
    try { return localStorage.getItem("cge_pool_all_dates") === "true"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("cge_pool_all_dates", String(allDates)); } catch {} }, [allDates]);
  const addManualRegular = useRegularsStore((s) => s.addManual);

  const loadPool = async () => {
    setLoading(true); setMsg(null);
    try {
      const r = await fetch("/api/screenshot-pool");
      const j = await r.json().catch(() => ({}));
      const list = Array.isArray(j.entries) ? j.entries : [];
      setEntries(list);
      // Seed drafts: fresh objects derived from the server entries so edits
      // don't touch the "source" copy.
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

  useEffect(() => { if (open) loadPool(); }, [open]);

  const wkSet = new Set(
    [weekendDates?.Fri, weekendDates?.Sat, weekendDates?.Sun]
      .filter(Boolean).map(mdOf).filter(Boolean)
  );

  // Filter the visible list by weekend match unless "All dates" is on.
  const visible = entries.filter((e) => {
    if (allDates) return true;
    const md = mdOf(e.event?.date);
    return !!(md && wkSet.has(md));
  });
  const hiddenByFilter = entries.length - visible.length;

  const updateDraftEvent = (id, field, value) => {
    let v = value;
    if (["name", "venue", "area", "type"].includes(field)) v = String(v || "").toUpperCase();
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), event: { ...(prev[id]?.event || {}), [field]: v } },
    }));
  };
  const updateDraft = (id, patch) => setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));

  const removeEntry = async (id) => {
    if (!window.confirm("Remove from the pool?")) return;
    try {
      const r = await fetch("/api/screenshot-pool/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!r.ok) throw new Error(`Server ${r.status}`);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
      if (onPoolChanged) onPoolChanged();
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    }
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
  const readyCount = visible.filter((e) => drafts[e.id]?.include).length;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 680, background: "#141416", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 14, padding: "20px 20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "1.15rem", flex: 1 }}>
            🗓️ Screenshot pool
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.5)", fontSize: "1.1rem", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: "0.78rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
          Screenshots you saved for later. By default only entries for the reviewed weekend ({wkLabel}) show. Toggle "All dates" to see the whole stash.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <label
            title={allDates ? "Showing every date in the pool" : `Only showing pool entries for ${wkLabel}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.7rem", letterSpacing: "0.5px", textTransform: "uppercase", color: allDates ? "#E5BC4F" : "rgba(139,92,246,0.85)", cursor: "pointer", userSelect: "none" }}
          >
            <input type="checkbox" checked={allDates} onChange={(e) => setAllDates(e.target.checked)} style={{ accentColor: allDates ? "#E5BC4F" : "#A78BFA", cursor: "pointer" }} />
            All dates
          </label>
          <div style={{ flex: 1, fontSize: "0.7rem", color: "rgba(245,240,232,0.55)" }}>
            {loading ? "Loading…" :
             entries.length === 0 ? "Pool is empty."
             : allDates ? `${entries.length} total in pool.`
             : `${visible.length} for this weekend${hiddenByFilter ? ` · ${hiddenByFilter} on other dates hidden` : ""}.`}
          </div>
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
                return (
                  <div key={e.id} style={{
                    display: "flex", gap: 10,
                    padding: 10, borderRadius: 8,
                    background: d.include ? "rgba(139,92,246,0.05)" : "rgba(245,240,232,0.02)",
                    border: `1px solid ${d.include ? "rgba(139,92,246,0.3)" : "rgba(245,240,232,0.08)"}`,
                    opacity: d.include ? 1 : 0.5,
                  }}>
                    {e.thumb ? (
                      <img src={e.thumb} alt="" style={{ width: 60, height: 80, objectFit: "cover", borderRadius: 5, border: "1px solid rgba(245,240,232,0.15)", background: "#000", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 60, height: 80, borderRadius: 5, background: "rgba(245,240,232,0.05)", border: "1px solid rgba(245,240,232,0.1)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", opacity: 0.4 }}>📸</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.7rem", color: "rgba(245,240,232,0.7)", flexShrink: 0 }}>
                          <input type="checkbox" checked={d.include} onChange={(ev) => updateDraft(e.id, { include: ev.target.checked })} style={{ accentColor: "#A78BFA" }} />
                          Include
                        </label>
                        {d.recurring && (
                          <span style={{ fontSize: "0.6rem", padding: "1px 6px", borderRadius: 3, background: "rgba(229,188,79,0.15)", color: "#E5BC4F", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>🔁 Weekly</span>
                        )}
                        {stamp && (
                          <span style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.4)" }}>Saved {stamp}</span>
                        )}
                        <div style={{ flex: 1 }} />
                        <button onClick={() => removeEntry(e.id)} title="Remove from pool" style={{ background: "transparent", border: "1px solid rgba(251,113,133,0.3)", color: "#FB7185", borderRadius: 3, padding: "2px 7px", fontSize: "0.66rem", cursor: "pointer" }}>×</button>
                      </div>

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
            Nothing in the pool yet. Drop a screenshot in "📸 Add from screenshot" and hit <b>🗓️ Save to pool</b>.
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
