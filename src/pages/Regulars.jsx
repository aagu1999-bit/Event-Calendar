import { useState, useMemo } from "react";
import { useRegularsStore } from "../store";

// Internal-flag glossary (matches the flag names in src/shared/regulars.js).
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

export default function Regulars() {
  const regulars = useRegularsStore(s => s.regulars);
  const lastImport = useRegularsStore(s => s.lastImport);
  const stats = useRegularsStore(s => s.stats);

  const [dayFilter, setDayFilter] = useState("all"); // all|Fri|Sat|Sun
  const [showRejected, setShowRejected] = useState(false);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("confidence"); // confidence|recent|count

  const visible = useMemo(() => {
    let list = regulars.filter(r => showRejected ? r.rejected : !r.rejected);
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
  }, [regulars, dayFilter, showRejected, query, sortMode]);

  const counts = useMemo(() => ({
    total: regulars.length,
    active: regulars.filter(r => !r.rejected).length,
    rejected: regulars.filter(r => r.rejected).length,
    Fri: regulars.filter(r => !r.rejected && r.day === "Fri").length,
    Sat: regulars.filter(r => !r.rejected && r.day === "Sat").length,
    Sun: regulars.filter(r => !r.rejected && r.day === "Sun").length,
  }), [regulars]);

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1rem" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "2px" }}>
            Weekly Regulars
          </h1>
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Recurring Fri/Sat/Sun events detected from your master sheet
          </span>
        </div>

        {/* Status */}
        {regulars.length === 0 ? (
          <div style={{ padding: "2rem", borderRadius: "8px", border: "1px dashed rgba(245,240,232,0.12)", color: "rgba(245,240,232,0.5)", fontSize: "0.75rem", lineHeight: 1.6 }}>
            <strong style={{ color: "#C084FC", letterSpacing: "1.5px", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
              No regulars detected yet
            </strong>
            Open the <strong>Review</strong> tab and use the purple <em>Weekly Regulars · master sheet</em> card at the top to upload your master CSV. Detection runs locally — usually a few seconds for a ~20k-row sheet.
          </div>
        ) : (
          <>
            {/* Summary */}
            <div style={{
              padding: "10px 14px", marginBottom: "1rem",
              background: "rgba(124,58,237,0.06)",
              border: "1px solid rgba(124,58,237,0.18)",
              borderRadius: "6px",
              display: "flex", alignItems: "center", gap: "1.2rem", fontSize: "0.65rem",
            }}>
              <div style={{ color: "rgba(245,240,232,0.7)" }}>
                <strong style={{ color: "#C084FC" }}>{counts.active}</strong> active regulars ·
                <strong style={{ marginLeft: 4 }}>{counts.Fri}</strong> Fri ·
                <strong style={{ marginLeft: 4 }}>{counts.Sat}</strong> Sat ·
                <strong style={{ marginLeft: 4 }}>{counts.Sun}</strong> Sun
                {counts.rejected > 0 && <> · <strong>{counts.rejected}</strong> rejected</>}
              </div>
              <div style={{ flex: 1 }} />
              <div style={{ color: "rgba(245,240,232,0.4)", fontSize: "0.6rem", letterSpacing: "1px", textTransform: "uppercase" }}>
                Imported {lastImport ? new Date(lastImport).toLocaleDateString() : "—"}
                {stats && <> · {stats.parsed.toLocaleString()} weekend events parsed</>}
              </div>
            </div>

            {/* Controls */}
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
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
              <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)", display: "flex", alignItems: "center", gap: "5px", cursor: "pointer" }}>
                <input type="checkbox" checked={showRejected} onChange={e => setShowRejected(e.target.checked)} style={{ accentColor: "#FB7185" }} />
                Show rejected ({counts.rejected})
              </label>
            </div>

            {/* Search */}
            <div style={{ marginBottom: "0.75rem" }}>
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, venue, or city…"
                style={{
                  width: "100%", padding: "8px 12px",
                  background: "rgba(245,240,232,0.04)",
                  border: "1px solid rgba(245,240,232,0.1)",
                  borderRadius: "4px",
                  color: "#F5F0E8",
                  fontFamily: "inherit",
                  fontSize: "0.78rem",
                }}
              />
            </div>

            <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "0.4rem" }}>
              Showing {visible.length} of {showRejected ? counts.rejected : counts.active}
            </div>

            {/* List */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {visible.length === 0 && (
                <div style={{ padding: "2rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.75rem" }}>
                  No regulars match these filters.
                </div>
              )}
              {visible.map(r => <RegularRow key={r.id} r={r} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RegularRow({ r }) {
  const reject = useRegularsStore(s => s.reject);
  const restore = useRegularsStore(s => s.restore);
  const confPct = Math.round(r.confidence * 100);
  const confColor = r.confidence >= 0.75 ? "#34D399" : r.confidence >= 0.5 ? "#E5BC4F" : "#FB7185";
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "50px 1fr 90px 90px 70px 1fr auto",
      gap: "12px",
      alignItems: "center",
      padding: "10px 14px",
      background: r.rejected ? "rgba(251,113,133,0.04)" : "rgba(245,240,232,0.04)",
      border: `1px solid ${r.rejected ? "rgba(251,113,133,0.15)" : "rgba(245,240,232,0.08)"}`,
      borderRadius: "5px",
      opacity: r.rejected ? 0.7 : 1,
    }}>
      <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: "#C084FC", letterSpacing: "1.5px", fontSize: "0.85rem" }}>
        {r.day.toUpperCase()}
      </span>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {r.name}
        </div>
        <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[r.venue, r.area, r.time].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.5)", textAlign: "center" }}>
        <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#F5F0E8" }}>{r.occurrenceCount}×</div>
        <div style={{ letterSpacing: "1px", textTransform: "uppercase" }}>seen</div>
      </div>

      <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.5)", textAlign: "center", letterSpacing: "1px", textTransform: "uppercase" }}>
        <div style={{ fontSize: "0.75rem", color: "#F5F0E8" }}>{formatLastSeen(r.lastSeen)}</div>
        <div>last</div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 800, color: confColor }}>{confPct}%</div>
        <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>confidence</div>
      </div>

      <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-start" }}>
        {r.explicitPattern && (
          <span title="Master sheet's RECURRENCE_PATTERN explicitly marked this weekly" style={{
            padding: "2px 7px", fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase",
            borderRadius: "3px", whiteSpace: "nowrap",
            background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.35)",
          }}>EXPLICIT</span>
        )}
        {r.flags.map(f => (
          <span key={f} title={FLAG_DESC[f] || ""} style={{
            padding: "2px 7px", fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase",
            borderRadius: "3px", whiteSpace: "nowrap",
            background: "rgba(245,240,232,0.05)",
            color: FLAG_COLORS[f] || "rgba(245,240,232,0.6)",
            border: `1px solid ${FLAG_COLORS[f] || "rgba(245,240,232,0.18)"}40`,
          }}>{f}</span>
        ))}
      </div>

      <div style={{ display: "flex", gap: "4px" }}>
        {r.postUrl && (
          <a href={r.postUrl} target="_blank" rel="noreferrer" title="Open the original post" style={{
            padding: "5px 9px",
            background: "rgba(229,188,79,0.08)",
            color: "#E5BC4F",
            border: "1px solid rgba(229,188,79,0.25)",
            borderRadius: "4px",
            fontSize: "0.65rem",
            cursor: "pointer",
            textDecoration: "none",
            fontFamily: "inherit",
          }}>↗</a>
        )}
        {r.rejected ? (
          <button onClick={() => restore(r.id)} title="Restore this regular" style={{
            padding: "5px 9px",
            background: "rgba(52,211,153,0.08)",
            color: "#34D399",
            border: "1px solid rgba(52,211,153,0.25)",
            borderRadius: "4px",
            fontSize: "0.65rem",
            cursor: "pointer",
            fontFamily: "inherit",
          }}>↩</button>
        ) : (
          <button onClick={() => reject(r.id)} title="Reject — hide from future weekly suggestions" style={{
            padding: "5px 9px",
            background: "rgba(251,113,133,0.06)",
            color: "rgba(251,113,133,0.7)",
            border: "1px solid rgba(251,113,133,0.2)",
            borderRadius: "4px",
            fontSize: "0.7rem",
            cursor: "pointer",
            fontFamily: "inherit",
          }}>✕</button>
        )}
      </div>
    </div>
  );
}
