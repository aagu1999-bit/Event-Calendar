import { useState, useMemo, useEffect, useRef } from "react";
import { useRegularsStore, useEventsStore } from "../store";
import { regularToEvent } from "../shared/regulars";
import { normalizeHandle } from "../shared/parseEvents";
import { UInput, todaysFridayMD } from "../shared/inputs.jsx";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const FLAG_DESC = {
  STALE: "Last occurrence > 8 weeks ago. Might have ended.",
  LOW_CONFIDENCE: "Only 3 occurrences spread across more than 6 months.",
  GENERIC_NAME: 'Generic name like "Live Music" — could be many different events.',
  TIME_DRIFT: "Time spread across occurrences > 90 minutes.",
  RECENT_GAP: "Hasn't appeared in the last 6 weeks.",
};
const FLAG_COLORS = {
  STALE: "#FB7185",
  LOW_CONFIDENCE: "#FACC15",
  GENERIC_NAME: "#C084FC",
  TIME_DRIFT: "#FACC15",
  RECENT_GAP: "#FACC15",
};
const L = { display: "block", fontSize: "0.6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.55)", marginBottom: "6px" };
const B = { padding: "8px 14px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.7rem", cursor: "pointer", letterSpacing: "1px", textTransform: "uppercase" };
const I = { padding: "8px 10px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(245,240,232,0.18)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.78rem", outline: "none" };

function daysAgo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function formatLastSeen(iso) {
  const n = daysAgo(iso);
  if (n == null) return iso || "—";
  if (n < 7) return `${n}d ago`;
  if (n < 60) return `${Math.floor(n / 7)}w ago`;
  return `${Math.floor(n / 30)}mo ago`;
}

// Friday-date default now comes from the shared helper so Calendar +
// Regulars stay in sync.
const defaultFridayStr = todaysFridayMD;

export default function Regulars() {
  const regulars = useRegularsStore(s => s.regulars);
  const lastImport = useRegularsStore(s => s.lastImport);
  const stats = useRegularsStore(s => s.stats);
  const addManual = useRegularsStore(s => s.addManual);
  const updateRegular = useRegularsStore(s => s.updateRegular);
  const rejectRegular = useRegularsStore(s => s.reject);
  const events = useEventsStore(s => s.events);
  const addEvents = useEventsStore(s => s.addEvents);
  const updateEvents = useEventsStore(s => s.updateEvents);

  const [dayFilter, setDayFilter] = useState("all");
  const [showRejected, setShowRejected] = useState(false);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("confidence");
  const [friDate, setFriDate] = useState(defaultFridayStr());
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  // Selected regulars (by id) — feeds the bulk-action bar. Decoupled from
  // "rejected" / "flagged" / "used" so user can mix bulk delete, bulk add,
  // and bulk open-all-links without flipping any state until they click.
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Auto-sync lastSeen on tab mount: if an event in the current store matches
  // a regular's (name+venue+day), bump that regular's lastSeen to today. The
  // events store doesn't carry full dates for upload-imported events, so we
  // proxy with today's date — close enough to "this week" for the use case.
  const syncDoneRef = useRef(false);
  useEffect(() => {
    if (syncDoneRef.current || !regulars.length || !events.length) return;
    syncDoneRef.current = true;
    const today = new Date().toISOString().slice(0, 10);
    const regIndex = new Map();
    regulars.forEach(r => {
      if (r.rejected) return;
      regIndex.set(`${norm(r.name)}|${norm(r.venue)}|${r.day}`, r);
    });
    const updates = [];
    events.forEach(ev => {
      const r = regIndex.get(`${norm(ev.name)}|${norm(ev.venue)}|${ev.day}`);
      if (r && (!r.lastSeen || r.lastSeen < today)) {
        updates.push({ id: r.id, lastSeen: today });
      }
    });
    // Dedupe updates (multiple events per regular)
    const seen = new Set();
    updates.forEach(u => {
      if (seen.has(u.id)) return;
      seen.add(u.id);
      updateRegular(u.id, { lastSeen: u.lastSeen });
    });
  }, [regulars, events, updateRegular]);

  // Stamp regular as already used this week if an event in the store has a
  // matching fromRegular link. Dedupes the visual cue across the list.
  const usedThisWeek = useMemo(() => {
    const set = new Set();
    events.forEach(e => { if (e.fromRegular) set.add(e.fromRegular); });
    return set;
  }, [events]);

  const visible = useMemo(() => {
    let list = regulars.filter(r => showRejected ? r.rejected : !r.rejected);
    if (showFlaggedOnly) list = list.filter(r => r.flagged);
    if (showUnusedOnly) list = list.filter(r => !r.usedCount);
    if (dayFilter !== "all") list = list.filter(r => r.day === dayFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(r =>
        (r.name || "").toLowerCase().includes(q) ||
        (r.venue || "").toLowerCase().includes(q) ||
        (r.area || "").toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    if (sortMode === "confidence") sorted.sort((a, b) => b.confidence - a.confidence);
    else if (sortMode === "recent") sorted.sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
    else if (sortMode === "count") sorted.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
    return sorted;
  }, [regulars, dayFilter, showRejected, showFlaggedOnly, showUnusedOnly, query, sortMode]);

  const counts = useMemo(() => ({
    total: regulars.length,
    active: regulars.filter(r => !r.rejected).length,
    rejected: regulars.filter(r => r.rejected).length,
    flagged: regulars.filter(r => !r.rejected && r.flagged).length,
    unused: regulars.filter(r => !r.rejected && !r.usedCount).length,
    Fri: regulars.filter(r => !r.rejected && r.day === "Fri").length,
    Sat: regulars.filter(r => !r.rejected && r.day === "Sat").length,
    Sun: regulars.filter(r => !r.rejected && r.day === "Sun").length,
  }), [regulars]);

  // ===== Selection + bulk actions =====
  const toggleSel = (id) => setSelectedIds(s => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearSel = () => setSelectedIds(new Set());
  // Select-all toggle scoped to whatever rows are currently visible.
  const selectAllVisible = () => {
    const ids = visible.map(r => r.id);
    const allSel = ids.length > 0 && ids.every(id => selectedIds.has(id));
    setSelectedIds(allSel ? new Set() : new Set(ids));
  };
  // Bulk add — every selected regular gets pushed to this week's events.
  const bulkAdd = () => {
    const sel = regulars.filter(r => selectedIds.has(r.id) && !r.rejected);
    if (sel.length === 0) return;
    const evs = sel.map(r => regularToEvent(r, friDate)).filter(Boolean);
    if (evs.length === 0) { alert("Set this Friday's date first (e.g. 5/15)."); return; }
    const res = addEvents(evs);
    if (res.added > 0) {
      const nowIso = new Date().toISOString();
      sel.slice(0, res.added).forEach(r => {
        updateRegular(r.id, { usedCount: (r.usedCount || 0) + 1, lastUsed: nowIso });
      });
    }
    alert(`Added ${res.added} regular${res.added === 1 ? "" : "s"} for the week of ${friDate}.${res.skipped > 0 ? ` (${res.skipped} already there.)` : ""}`);
  };
  // Bulk open — every selected regular with a postUrl gets opened in a new
  // tab. Saves clicking 30+ links one at a time. Browsers throttle a flood
  // of window.open calls, so we stagger them slightly.
  const bulkOpenLinks = () => {
    const links = regulars.filter(r => selectedIds.has(r.id) && r.postUrl).map(r => r.postUrl);
    if (links.length === 0) { alert("None of the selected regulars have source URLs."); return; }
    if (links.length > 8 && !window.confirm(`Open ${links.length} links in new tabs? Your browser may block more than a few — make sure pop-ups are allowed for this site.`)) return;
    links.forEach((u, i) => setTimeout(() => window.open(u, "_blank", "noopener,noreferrer"), i * 60));
  };
  const bulkReject = () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Reject ${selectedIds.size} selected regulars? They'll hide from future suggestions (use "Show rejected" to restore).`)) return;
    selectedIds.forEach(id => { rejectRegular(id); });
    setSelectedIds(new Set());
  };
  const bulkFlag = () => {
    if (selectedIds.size === 0) return;
    selectedIds.forEach(id => {
      const r = regulars.find(x => x.id === id);
      if (r) updateRegular(id, { flagged: !r.flagged });
    });
  };

  // Add a regular to this week's events + bump usedCount/lastUsed.
  const useOne = (r) => {
    const ev = regularToEvent(r, friDate);
    if (!ev) { alert("Set this Friday's date first (e.g. 5/15)."); return; }
    const res = addEvents([ev]);
    if (res.added > 0) {
      updateRegular(r.id, { usedCount: (r.usedCount || 0) + 1, lastUsed: new Date().toISOString() });
    } else if (res.skipped > 0) {
      alert("Already in this week's events list.");
    }
  };
  // Remove the event(s) that came from this regular from the current store.
  const unuseOne = (r) => {
    updateEvents(prev => prev.filter(e => e.fromRegular !== r.id));
  };
  const useAllVisible = () => {
    if (visible.length === 0) return;
    const evs = visible.map(r => regularToEvent(r, friDate)).filter(Boolean);
    if (evs.length === 0) { alert("Set this Friday's date first (e.g. 5/15)."); return; }
    const res = addEvents(evs);
    // Credit each visible regular as used. Only credit ones whose event made
    // it into the store (skipped events were duplicates — already credited
    // last time they were added).
    if (res.added > 0) {
      const nowIso = new Date().toISOString();
      visible.slice(0, res.added).forEach(r => {
        updateRegular(r.id, { usedCount: (r.usedCount || 0) + 1, lastUsed: nowIso });
      });
    }
    alert(`Added ${res.added} regular${res.added === 1 ? "" : "s"} for the week of ${friDate}.${res.skipped > 0 ? ` (${res.skipped} already there.)` : ""}`);
  };

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1rem" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "2px" }}>
            Weekly Regulars
          </h1>
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Recurring Fri/Sat/Sun events from your master sheet
          </span>
        </div>

        {regulars.length === 0 ? (
          <div style={{ padding: "2rem", borderRadius: "8px", border: "1px dashed rgba(245,240,232,0.12)", color: "rgba(245,240,232,0.5)", fontSize: "0.75rem", lineHeight: 1.6 }}>
            <strong style={{ color: "#C084FC", letterSpacing: "1.5px", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
              No regulars detected yet
            </strong>
            Open the <strong>Review</strong> tab and use the purple <em>Weekly Regulars · master sheet</em> card to upload your master CSV. Or click "+ Add manual" below to add one by hand.
            <div style={{ marginTop: "1rem" }}>
              <button onClick={() => setShowAddForm(true)} style={B}>+ Add manual regular</button>
            </div>
            {showAddForm && (
              <div style={{ marginTop: "1rem" }}>
                <RegularForm onSave={(reg) => { addManual(reg); setShowAddForm(false); }} onCancel={() => setShowAddForm(false)} />
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Summary + friDate */}
            <div style={{
              padding: "10px 14px", marginBottom: "1rem",
              background: "rgba(124,58,237,0.06)",
              border: "1px solid rgba(124,58,237,0.18)",
              borderRadius: "6px",
              display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
            }}>
              <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.7)" }}>
                <strong style={{ color: "#C084FC" }}>{counts.active}</strong> active ·
                <strong style={{ marginLeft: 4 }}>{counts.Fri}</strong> Fri ·
                <strong style={{ marginLeft: 4 }}>{counts.Sat}</strong> Sat ·
                <strong style={{ marginLeft: 4 }}>{counts.Sun}</strong> Sun
                {counts.flagged > 0 && <> · <strong style={{ color: "#FACC15" }}>{counts.flagged}</strong> flagged</>}
                {counts.rejected > 0 && <> · {counts.rejected} rejected</>}
              </div>
              <div style={{ flex: 1 }} />
              <label style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.55)", letterSpacing: "1px", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "6px" }}>
                This Friday
                <input value={friDate} onChange={e => setFriDate(e.target.value)} placeholder="5/15" style={{ ...I, width: 70, padding: "4px 8px", fontSize: "0.7rem" }} />
              </label>
              <div style={{ color: "rgba(245,240,232,0.4)", fontSize: "0.55rem", letterSpacing: "1px", textTransform: "uppercase" }}>
                Imported {lastImport ? new Date(lastImport).toLocaleDateString() : "—"}
                {stats && <> · {stats.parsed.toLocaleString()} parsed</>}
              </div>
            </div>

            {/* Filters */}
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Day</span>
              {[["all", "All"], ["Fri", "Fri"], ["Sat", "Sat"], ["Sun", "Sun"]].map(([k, lbl]) => (
                <button key={k} onClick={() => setDayFilter(k)}
                  style={dayFilter === k ? { ...B, background: "rgba(192,132,252,0.15)", borderColor: "#C084FC", color: "#C084FC" } : B}>
                  {lbl}
                </button>
              ))}
              <span style={{ ...L, marginBottom: 0, marginLeft: "12px", marginRight: "4px" }}>Sort</span>
              {[["confidence", "Confidence"], ["recent", "Recent"], ["count", "Occurrences"]].map(([k, lbl]) => (
                <button key={k} onClick={() => setSortMode(k)}
                  style={sortMode === k ? { ...B, background: "rgba(229,188,79,0.15)", borderColor: "#E5BC4F", color: "#E5BC4F" } : B}>
                  {lbl}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={() => { setShowAddForm(true); setEditingId(null); }} style={B}>+ Add manual</button>
              <button onClick={useAllVisible} disabled={visible.length === 0}
                style={visible.length > 0
                  ? { ...B, background: "rgba(52,211,153,0.15)", borderColor: "rgba(52,211,153,0.4)", color: "#34D399" }
                  : { ...B, opacity: 0.4, cursor: "not-allowed" }}
                title={`Add all ${visible.length} visible regulars to this week's events (${friDate})`}>
                ✓ Use all visible ({visible.length})
              </button>
            </div>

            <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <UInput
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, venue, or city…"
                style={{ flex: 1, padding: "8px 12px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.78rem" }}
              />
              <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)", display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
                <input type="checkbox" checked={showFlaggedOnly} onChange={e => setShowFlaggedOnly(e.target.checked)} style={{ accentColor: "#FACC15" }} />
                Flagged only ({counts.flagged})
              </label>
              <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)", display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
                <input type="checkbox" checked={showUnusedOnly} onChange={e => setShowUnusedOnly(e.target.checked)} style={{ accentColor: "#34D399" }} />
                Never used ({counts.unused})
              </label>
              <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)", display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
                <input type="checkbox" checked={showRejected} onChange={e => setShowRejected(e.target.checked)} style={{ accentColor: "#FB7185" }} />
                Show rejected ({counts.rejected})
              </label>
            </div>

            {showAddForm && (
              <RegularForm onSave={(reg) => { addManual(reg); setShowAddForm(false); }} onCancel={() => setShowAddForm(false)} />
            )}

            {/* Bulk action bar — appears when ≥1 row is selected. Selection
                is independent of "used / rejected / flagged"; user picks the
                action (add, open links, reject, flag) here. */}
            {selectedIds.size > 0 && (
              <div style={{
                display: "flex", gap: "0.4rem", alignItems: "center",
                padding: "8px 12px", marginBottom: "0.5rem",
                background: "rgba(52,211,153,0.06)",
                border: "1px solid rgba(52,211,153,0.3)",
                borderRadius: "5px", flexWrap: "wrap",
              }}>
                <span style={{ fontSize: "0.65rem", color: "#34D399", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700 }}>
                  {selectedIds.size} selected — pick a bulk action:
                </span>
                <div style={{ flex: 1 }} />
                <button
                  onClick={bulkAdd}
                  style={{ ...B, background: "rgba(52,211,153,0.18)", borderColor: "rgba(52,211,153,0.45)", color: "#34D399", fontWeight: 700 }}
                  title={`Add every selected regular to the calendar for ${friDate}`}
                >
                  + Add {selectedIds.size} to calendar
                </button>
                <button
                  onClick={bulkOpenLinks}
                  style={{ ...B, background: "rgba(229,188,79,0.12)", borderColor: "rgba(229,188,79,0.4)", color: "#E5BC4F" }}
                  title="Open every selected regular's source URL in new tabs"
                >
                  ↗ Open all links
                </button>
                <button
                  onClick={bulkFlag}
                  style={{ ...B, background: "rgba(250,204,21,0.12)", borderColor: "rgba(250,204,21,0.4)", color: "#FACC15" }}
                  title="Toggle the flag on every selected regular"
                >
                  🚩 Flag
                </button>
                <button
                  onClick={bulkReject}
                  style={{ ...B, background: "rgba(251,113,133,0.1)", borderColor: "rgba(251,113,133,0.35)", color: "#FB7185" }}
                  title="Reject every selected regular (hides from future suggestions)"
                >
                  ✕ Reject
                </button>
                <button onClick={clearSel} style={B}>Clear</button>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem", fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>
              <span>Showing {visible.length} of {showRejected ? counts.rejected : counts.active}</span>
              {visible.length > 0 && (
                <button
                  onClick={selectAllVisible}
                  style={{ ...B, padding: "3px 8px", fontSize: "0.55rem" }}
                  title="Select / deselect every currently-visible row"
                >
                  {visible.every(r => selectedIds.has(r.id)) ? "Deselect all visible" : `Select all ${visible.length} visible`}
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {visible.length === 0 && (
                <div style={{ padding: "2rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.75rem" }}>
                  No regulars match these filters.
                </div>
              )}
              {visible.map(r => (
                <RegularRow
                  key={r.id}
                  r={r}
                  used={usedThisWeek.has(r.id)}
                  selected={selectedIds.has(r.id)}
                  onToggleSel={() => toggleSel(r.id)}
                  onUse={() => useOne(r)}
                  onUnuse={() => unuseOne(r)}
                  onEdit={() => setEditingId(editingId === r.id ? null : r.id)}
                  isEditing={editingId === r.id}
                  onCancelEdit={() => setEditingId(null)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RegularRow({ r, used, selected, onToggleSel, onUse, onUnuse, onEdit, isEditing, onCancelEdit }) {
  const reject = useRegularsStore(s => s.reject);
  const restore = useRegularsStore(s => s.restore);
  const updateRegular = useRegularsStore(s => s.updateRegular);
  const removeRegular = useRegularsStore(s => s.removeRegular);

  const confPct = Math.round(r.confidence * 100);
  const confColor = r.confidence >= 0.75 ? "#34D399" : r.confidence >= 0.5 ? "#E5BC4F" : "#FB7185";

  return (
    <>
      <div style={{
        display: "grid",
        gridTemplateColumns: "26px 44px 1fr 70px 70px 60px 1fr auto",
        gap: "10px",
        alignItems: "center",
        padding: "10px 14px",
        background: selected
          ? "rgba(229,188,79,0.10)"
          : used ? "rgba(52,211,153,0.06)"
          : r.rejected ? "rgba(251,113,133,0.04)"
          : r.flagged ? "rgba(250,204,21,0.05)"
          : "rgba(245,240,232,0.04)",
        border: `1px solid ${
          selected ? "#E5BC4F" :
          used ? "rgba(52,211,153,0.25)" :
          r.rejected ? "rgba(251,113,133,0.15)" :
          r.flagged ? "rgba(250,204,21,0.2)" :
          "rgba(245,240,232,0.08)"
        }`,
        borderRadius: isEditing ? "5px 5px 0 0" : "5px",
        opacity: r.rejected ? 0.7 : 1,
      }}>
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSel}
          title={selected ? "Selected — click to deselect" : "Click to select for a bulk action (add to calendar, open links, …)"}
          style={{ width: 18, height: 18, accentColor: "#E5BC4F", cursor: "pointer" }}
        />
        <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: "#C084FC", letterSpacing: "1.5px", fontSize: "0.8rem" }}>
          {r.day.toUpperCase()}
        </span>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {r.name}
          </div>
          <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[r.venue, r.area, r.time].filter(Boolean).join(" · ")}
            {r.igHandle && <span style={{ marginLeft: "8px", color: "#C084FC", fontWeight: 600 }}>@{r.igHandle}</span>}
          </div>
        </div>

        <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", textAlign: "center" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#F5F0E8" }}>{r.occurrenceCount}×</div>
          <div style={{ letterSpacing: "1px", textTransform: "uppercase" }}>seen</div>
        </div>

        <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", textAlign: "center", letterSpacing: "1px", textTransform: "uppercase" }}>
          <div style={{ fontSize: "0.72rem", color: "#F5F0E8" }}>{formatLastSeen(r.lastSeen)}</div>
          <div>last</div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 800, color: confColor }}>{confPct}%</div>
          <div style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>conf</div>
          {r.usedCount > 0 && (
            <div title={`Used ${r.usedCount} time${r.usedCount === 1 ? "" : "s"} this season`} style={{ marginTop: "3px", fontSize: "0.48rem", color: "rgba(52,211,153,0.7)", letterSpacing: "1px", textTransform: "uppercase" }}>
              ✓ {r.usedCount}×
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-start" }}>
          {r.source === "manual" && (
            <span style={{ padding: "2px 7px", fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", borderRadius: "3px", whiteSpace: "nowrap", background: "rgba(229,188,79,0.12)", color: "#E5BC4F", border: "1px solid rgba(229,188,79,0.3)" }}>MANUAL</span>
          )}
          {r.explicitPattern && (
            <span title="Master sheet's RECURRENCE_PATTERN explicitly marked this weekly" style={{ padding: "2px 7px", fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", borderRadius: "3px", whiteSpace: "nowrap", background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.35)" }}>EXPLICIT</span>
          )}
          {(r.flags || []).map(f => (
            <span key={f} title={FLAG_DESC[f] || ""} style={{
              padding: "2px 7px", fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase",
              borderRadius: "3px", whiteSpace: "nowrap",
              background: "rgba(245,240,232,0.05)",
              color: FLAG_COLORS[f] || "rgba(245,240,232,0.6)",
              border: `1px solid ${FLAG_COLORS[f] || "rgba(245,240,232,0.18)"}40`,
            }}>{f}</span>
          ))}
        </div>

        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {r.postUrl && (
            <a href={r.postUrl} target="_blank" rel="noreferrer" title="Open the original post" style={{
              padding: "5px 9px", background: "rgba(229,188,79,0.08)", color: "#E5BC4F",
              border: "1px solid rgba(229,188,79,0.25)", borderRadius: "4px", fontSize: "0.65rem",
              cursor: "pointer", textDecoration: "none", fontFamily: "inherit",
            }}>↗</a>
          )}
          {!r.rejected && (
            <>
              <button
                onClick={used ? onUnuse : onUse}
                title={used ? "Already added to this week's events — click to remove" : "Add this regular to the calendar right now"}
                style={{
                  padding: "5px 9px",
                  background: used ? "rgba(52,211,153,0.25)" : "rgba(52,211,153,0.12)",
                  color: used ? "#0a0a0a" : "#34D399",
                  border: used ? "1px solid #34D399" : "1px solid rgba(52,211,153,0.4)",
                  borderRadius: "4px", fontSize: "0.65rem", cursor: "pointer", fontFamily: "inherit",
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                }}
              >
                {used ? "✓ Added" : "+ Add"}
              </button>
              <button
                onClick={() => updateRegular(r.id, { flagged: !r.flagged })}
                title={r.flagged ? "Unflag" : "Flag for re-review"}
                style={{
                  padding: "5px 9px",
                  background: r.flagged ? "rgba(250,204,21,0.2)" : "rgba(245,240,232,0.04)",
                  color: r.flagged ? "#FACC15" : "rgba(245,240,232,0.4)",
                  border: r.flagged ? "1px solid #FACC15" : "1px solid rgba(245,240,232,0.1)",
                  borderRadius: "4px", fontSize: "0.65rem", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                🚩
              </button>
              <button
                onClick={onEdit}
                title={isEditing ? "Cancel edit" : "Edit fields"}
                style={{
                  padding: "5px 9px",
                  background: isEditing ? "#E5BC4F" : "rgba(245,240,232,0.04)",
                  color: isEditing ? "#000" : "#F5F0E8",
                  border: `1px solid ${isEditing ? "#E5BC4F" : "rgba(245,240,232,0.1)"}`,
                  borderRadius: "4px", fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {isEditing ? "✕" : "✎"}
              </button>
            </>
          )}
          {r.rejected ? (
            <button onClick={() => restore(r.id)} title="Restore this regular" style={{
              padding: "5px 9px", background: "rgba(52,211,153,0.08)", color: "#34D399",
              border: "1px solid rgba(52,211,153,0.25)", borderRadius: "4px", fontSize: "0.65rem",
              cursor: "pointer", fontFamily: "inherit",
            }}>↩</button>
          ) : (
            <button onClick={() => reject(r.id)} title="Reject — hide from future suggestions" style={{
              padding: "5px 9px", background: "rgba(251,113,133,0.06)", color: "rgba(251,113,133,0.7)",
              border: "1px solid rgba(251,113,133,0.2)", borderRadius: "4px", fontSize: "0.7rem",
              cursor: "pointer", fontFamily: "inherit",
            }}>✕</button>
          )}
          {r.source === "manual" && (
            <button onClick={() => { if (confirm(`Delete "${r.name}" entirely? Manual regulars can't be restored.`)) removeRegular(r.id); }} title="Delete this manual regular permanently" style={{
              padding: "5px 9px", background: "transparent", color: "rgba(251,113,133,0.45)",
              border: "1px solid rgba(251,113,133,0.15)", borderRadius: "4px", fontSize: "0.65rem",
              cursor: "pointer", fontFamily: "inherit",
            }}>🗑</button>
          )}
        </div>
      </div>

      {isEditing && (
        <RegularForm
          editing={r}
          onSave={(patch) => { updateRegular(r.id, patch); onCancelEdit(); }}
          onCancel={onCancelEdit}
          attachedAbove
        />
      )}
    </>
  );
}

function RegularForm({ editing, onSave, onCancel, attachedAbove }) {
  const [draft, setDraft] = useState(() => editing ? { ...editing } : {
    name: "", venue: "", area: "", region: "North", day: "Fri", time: "", type: "", postUrl: "", igHandle: "",
  });
  const field = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const isEdit = !!editing;
  const submit = () => {
    if (!draft.name || !draft.venue) { alert("Name and venue are required."); return; }
    const handle = normalizeHandle(draft.igHandle);
    if (isEdit) {
      onSave({ name: draft.name, venue: draft.venue, area: draft.area, region: draft.region, day: draft.day, time: draft.time, type: draft.type, postUrl: draft.postUrl, igHandle: handle });
    } else {
      // Build a manual regular. The store will tag source: "manual".
      const id = "manual_" + Date.now();
      const today = new Date().toISOString().slice(0, 10);
      onSave({
        id, name: draft.name.trim(), venue: draft.venue.trim(), area: draft.area.trim(),
        region: draft.region, day: draft.day, time: draft.time.trim(), type: draft.type.trim(),
        postUrl: draft.postUrl.trim(), igHandle: handle,
        occurrenceCount: 0, firstSeen: today, lastSeen: today,
        timeSpreadMin: 0, explicitPattern: false, flags: [], rejected: false, flagged: false,
        confidence: 0.5,
      });
    }
  };

  return (
    <div style={{
      padding: "12px 14px", marginBottom: attachedAbove ? "0.4rem" : "0.6rem",
      marginTop: attachedAbove ? "-0.4rem" : 0,
      background: "rgba(229,188,79,0.06)",
      border: "1px solid #E5BC4F",
      borderTop: attachedAbove ? "none" : "1px solid #E5BC4F",
      borderRadius: attachedAbove ? "0 0 5px 5px" : "5px",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 70px 90px 1fr", gap: "8px", marginBottom: "8px" }}>
        <UInput autoFocus value={draft.name} onChange={e => field("name", e.target.value)} placeholder="Event name *" style={I} />
        <select value={draft.day} onChange={e => field("day", e.target.value)} style={I}>
          <option value="Fri">Fri</option><option value="Sat">Sat</option><option value="Sun">Sun</option>
        </select>
        <UInput value={draft.time} onChange={e => field("time", e.target.value)} placeholder="Time (e.g. 9 PM)" style={I} />
        <UInput value={draft.type} onChange={e => field("type", e.target.value)} placeholder="Type (PARTY, BRUNCH…)" style={I} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 90px 2fr", gap: "8px", marginBottom: "8px" }}>
        <UInput value={draft.venue} onChange={e => field("venue", e.target.value)} placeholder="Venue *" style={I} />
        <UInput value={draft.area} onChange={e => field("area", e.target.value)} placeholder="City" style={I} />
        <select value={draft.region} onChange={e => field("region", e.target.value)} style={I}>
          <option value="North">North</option><option value="Central">Central</option><option value="South">South</option>
        </select>
        <input value={draft.postUrl} onChange={e => field("postUrl", e.target.value)} placeholder="Source URL (optional)" style={I} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px", alignItems: "center" }}>
        <input
          value={draft.igHandle || ""}
          onChange={e => field("igHandle", e.target.value)}
          placeholder="@handle to tag (won't show on slide)"
          style={{ ...I, color: "#C084FC" }}
        />
        <button onClick={onCancel} style={B}>Cancel</button>
        <button onClick={submit} style={{ ...B, background: "#E5BC4F", color: "#000", borderColor: "#E5BC4F", fontWeight: 700 }}>
          {isEdit ? "Save" : "Add regular"}
        </button>
      </div>
    </div>
  );
}
