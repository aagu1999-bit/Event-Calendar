import { useState, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import { useEventsStore } from "../store";
import { parseRows, DAYFUL, getEmoji } from "../shared/parseEvents";
import { computeWarnings, findFlagPartners } from "../shared/validateEvents";

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
  { tag: "ALREADY IN STORE",        desc: "Same name+day already exists in your loaded events." },
  { tag: "SAME VENUE/DAY IN STORE", desc: "Different event, same venue+day as something already in store." },
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

  const [pending, setPending] = useState([]); // parsed Event[]
  const [approvals, setApprovals] = useState({}); // id -> bool
  const [filter, setFilter] = useState("all"); // all | clean | flagged | unapproved | tag:<name>
  const [highlightedGroup, setHighlightedGroup] = useState(null); // e.g. "DUPE #3" — flag-msg string
  const [legendOpen, setLegendOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(true);
  const fileRef = useRef(null);

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
    if (filter.startsWith("tag:")) {
      const tag = filter.slice(4);
      return eventsWithFlagTag(tag);
    }
    return pending;
  }, [pending, warnings, approvals, filter]);

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

  // Click flag pill → highlight all events in same group (if it has #N).
  // Click again on same group → clear.
  const clickFlag = (msg) => {
    if (!/#\d+/.test(msg)) return; // only grouped flags are clickable
    setHighlightedGroup(prev => prev === msg ? null : msg);
  };
  const groupMatchKey = (msg) => {
    const m = msg.match(/#(\d+)/);
    return m ? m[1] : null;
  };
  const isPillInHighlightedGroup = (msg) => {
    if (!highlightedGroup) return false;
    const a = groupMatchKey(highlightedGroup);
    const b = groupMatchKey(msg);
    if (!a || !b) return false;
    // Same flag-type prefix + same #N number
    const prefixA = highlightedGroup.replace(/#\d+.*$/, "");
    const prefixB = msg.replace(/#\d+.*$/, "");
    return prefixA === prefixB && a === b;
  };
  const isRowInHighlightedGroup = (ev) => {
    const ws = warnings[ev.id] || [];
    return ws.some(w => isPillInHighlightedGroup(w.msg));
  };

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
                  {summaryOpen ? "▾" : "▸"} Flag breakdown ({flagSummary.reduce((s, [, n]) => s + n, 0)} total · click a tag to filter)
                </summary>
                <div style={{ padding: "0 14px 14px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {flagSummary.map(([tag, count]) => {
                    const isActive = filter === `tag:${tag}`;
                    return (
                      <button
                        key={tag}
                        onClick={() => setFilter(isActive ? "flagged" : `tag:${tag}`)}
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

            {/* Bulk actions + filter */}
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <span style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Filter</span>
              {[["all", "All"], ["clean", "Clean"], ["flagged", "Flagged"], ["unapproved", "Skipped"]].map(([k, lbl]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  style={filter === k ? { ...B, background: "rgba(229,188,79,0.15)", borderColor: "#E5BC4F", color: "#E5BC4F" } : B}
                >{lbl}</button>
              ))}
              {filter.startsWith("tag:") && (
                <button
                  onClick={() => setFilter("flagged")}
                  style={{ ...B, background: "#E5BC4F", color: "#000", borderColor: "#E5BC4F" }}
                >× {filter.slice(4)}</button>
              )}
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
                  {allVisibleApproved ? "Skip" : "Select"} all in this filter ({visible.length} visible)
                </span>
                {highlightedGroup && (
                  <span style={{ marginLeft: "auto", color: "#E5BC4F" }}>
                    Tracing group: <strong>{highlightedGroup}</strong>
                    <button onClick={() => setHighlightedGroup(null)} style={{ ...B, marginLeft: "8px", padding: "3px 8px", fontSize: "0.5rem" }}>Clear trace</button>
                  </span>
                )}
              </div>
            )}

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
                const isFlagged = w.length > 0;
                const inHighlightedGroup = isRowInHighlightedGroup(ev);
                return (
                  <div
                    key={ev.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto auto 50px 1fr auto auto auto",
                      gap: "12px",
                      alignItems: "center",
                      padding: "10px 14px",
                      background: inHighlightedGroup
                        ? "rgba(229,188,79,0.12)"
                        : approved ? "rgba(52,211,153,0.05)" : "rgba(245,240,232,0.03)",
                      border: `1px solid ${
                        inHighlightedGroup ? "#E5BC4F" :
                        approved ? "rgba(52,211,153,0.18)" : "rgba(245,240,232,0.06)"
                      }`,
                      borderRadius: "5px",
                      opacity: approved ? 1 : 0.65,
                      transition: "background 120ms ease, border-color 120ms ease",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={() => toggle(ev.id)}
                      style={{ width: 18, height: 18, accentColor: "#E5BC4F", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "1rem", width: "20px", textAlign: "center", lineHeight: 1 }}>
                      {isFlagged ? "🚩" : ""}
                    </span>
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
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", maxWidth: "320px", justifyContent: "flex-end" }}>
                      {w.map((warn, i) => {
                        const hasGroup = /#\d+/.test(warn.msg);
                        const isHighlighted = isPillInHighlightedGroup(warn.msg);
                        const style = isHighlighted ? PILL_HIGHLIGHTED : PILL_STYLE;
                        return (
                          <span
                            key={i}
                            onClick={(e) => { e.stopPropagation(); clickFlag(warn.msg); }}
                            title={hasGroup ? "Click to trace this group across all events" : undefined}
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
