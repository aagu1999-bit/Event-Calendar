import { useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { useEventsStore } from "../store";
import { parseRows, DAYFUL, getEmoji } from "../shared/parseEvents";
import { computeWarnings } from "../shared/validateEvents";

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

const WARN_COLORS = {
  red:    { bg: "rgba(251,113,133,0.15)", color: "#FB7185" },
  yellow: { bg: "rgba(250,204,21,0.15)",  color: "#FACC15" },
  gray:   { bg: "rgba(245,240,232,0.08)", color: "rgba(245,240,232,0.55)" },
};

export default function ReviewQueue() {
  const events = useEventsStore(s => s.events);
  const updateEvents = useEventsStore(s => s.updateEvents);

  const [pending, setPending] = useState([]); // parsed Event[]
  const [approvals, setApprovals] = useState({}); // id -> bool
  const [filter, setFilter] = useState("all"); // all | clean | flagged | unapproved
  const fileRef = useRef(null);

  // Augmenter runs whenever pending/store changes
  const warnings = useMemo(() => augmentEvents(pending, events), [pending, events]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
      const parsed = parseRows(rows);
      // Give each event a stable string id so React keys + approvals work
      const withIds = parsed.map((ev, i) => ({ ...ev, id: `pending_${Date.now()}_${i}` }));
      setPending(withIds);
      // Default-approve every event EXCEPT those with red (severe) warnings
      const tempWarnings = augmentEvents(withIds, events);
      const initial = {};
      withIds.forEach(ev => {
        const w = tempWarnings[ev.id] || [];
        initial[ev.id] = !w.some(x => x.type === "red");
      });
      setApprovals(initial);
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

  const visible = useMemo(() => {
    if (filter === "all") return pending;
    if (filter === "clean") return pending.filter(e => (warnings[e.id] || []).length === 0);
    if (filter === "flagged") return pending.filter(e => (warnings[e.id] || []).length > 0);
    if (filter === "unapproved") return pending.filter(e => !approvals[e.id]);
    return pending;
  }, [pending, warnings, approvals, filter]);

  const approvedCount = pending.filter(e => approvals[e.id]).length;
  const flaggedCount = pending.filter(e => (warnings[e.id] || []).length > 0).length;

  const importApproved = () => {
    const approved = pending.filter(e => approvals[e.id]).map(e => ({
      ...e,
      id: Date.now() + Math.random() * 1e5,  // give them fresh numeric IDs for the store
    }));
    if (approved.length === 0) return;
    updateEvents(prev => [...prev, ...approved]);
    setPending([]);
    setApprovals({});
    alert(`Imported ${approved.length} events to the store.`);
  };

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
              ? <>Upload your cleaned <strong>CSV or XLSX</strong> from Excel / Google Sheets. The augmenter will flag missing fields, dupes (within batch <em>and</em> against the {events.length}-event store), region-convention mismatches, and suspicious time/type combos.</>
              : <>
                  <strong>{pending.length}</strong> events parsed ·
                  <strong style={{ marginLeft: 8 }}>{flaggedCount}</strong> flagged ·
                  <strong style={{ marginLeft: 8 }}>{approvedCount}</strong> approved for import
                </>
            }
          </div>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} style={{ display: "none" }} />
          <button onClick={() => fileRef.current?.click()} style={Bgold}>
            {pending.length === 0 ? "Upload sheet" : "Re-upload"}
          </button>
        </div>

        {pending.length > 0 && (
          <>
            {/* Bulk actions + filter */}
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
              <span style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Filter</span>
              {[["all", "All"], ["clean", "Clean"], ["flagged", "Flagged"], ["unapproved", "Skipped"]].map(([k, lbl]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  style={filter === k ? { ...B, background: "rgba(229,188,79,0.15)", borderColor: "#E5BC4F", color: "#E5BC4F" } : B}
                >{lbl}</button>
              ))}
              <div style={{ flex: 1 }} />
              <button onClick={approveClean} style={B}>Approve clean only</button>
              <button onClick={approveAll} style={B}>Approve all</button>
              <button onClick={rejectAll} style={B}>Skip all</button>
              <button
                onClick={importApproved}
                disabled={approvedCount === 0}
                style={approvedCount > 0 ? Bgold : { ...B, opacity: 0.4, cursor: "not-allowed" }}
              >
                Import {approvedCount} → store
              </button>
            </div>

            {/* Event rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {visible.length === 0 && (
                <div style={{ padding: "2rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.75rem" }}>
                  No events match this filter.
                </div>
              )}
              {visible.map(ev => {
                const w = warnings[ev.id] || [];
                const approved = approvals[ev.id];
                return (
                  <div
                    key={ev.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 50px 1fr auto auto auto",
                      gap: "12px",
                      alignItems: "center",
                      padding: "10px 14px",
                      background: approved ? "rgba(52,211,153,0.05)" : "rgba(245,240,232,0.03)",
                      border: `1px solid ${approved ? "rgba(52,211,153,0.18)" : "rgba(245,240,232,0.06)"}`,
                      borderRadius: "5px",
                      opacity: approved ? 1 : 0.55,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={() => toggle(ev.id)}
                      style={{ width: 18, height: 18, accentColor: "#E5BC4F", cursor: "pointer" }}
                    />
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: "0.8rem", fontWeight: 700, color: "#E5BC4F", letterSpacing: "1px" }}>
                      {DAYFUL[ev.day]?.slice(0, 3) || "?"}
                    </span>
                    <div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "2px" }}>
                        {getEmoji(ev.type)} {ev.name || <em style={{ color: "#FB7185" }}>(no name)</em>}
                      </div>
                      <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.55)" }}>
                        {[ev.venue, ev.area, ev.time].filter(Boolean).join(" · ") || <em>no details</em>}
                      </div>
                    </div>
                    <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
                      {ev.region || "—"}
                    </span>
                    <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
                      {ev.type || "—"}
                    </span>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", maxWidth: "260px", justifyContent: "flex-end" }}>
                      {w.map((warn, i) => {
                        const c = WARN_COLORS[warn.type] || WARN_COLORS.gray;
                        return (
                          <span
                            key={i}
                            style={{
                              padding: "2px 7px",
                              background: c.bg,
                              color: c.color,
                              fontSize: "0.55rem",
                              fontWeight: 700,
                              letterSpacing: "1px",
                              textTransform: "uppercase",
                              borderRadius: "3px",
                              whiteSpace: "nowrap",
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
                  </div>
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
    </div>
  );
}
