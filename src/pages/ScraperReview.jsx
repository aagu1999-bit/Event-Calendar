// ScraperReview — the Insta-Scraper → Review handoff page.
//
// Reads the Weekend_Review tab the scraper wrote, filters to NJ events
// that haven't already been sent, and pushes them into the /review
// page's pending queue with one click. The user's workflow always ends
// in /review for the final refinement, so this page is intentionally
// thin — no per-card approve/reject (would just duplicate work the
// user does in /review anyway).
//
// On send:
//   1. Filter to NJ events (SECTION OF NJ in {NORTH, CENTRAL, SOUTH})
//      and not already pushed (PUSHED_AT empty)
//   2. Map Weekend_Review rows → Event-Calendar event shape
//   3. Stage in useScraperIntakeStore (consumed by ReviewQueue on mount)
//   4. Stamp PUSHED_AT on the sheet rows so they don't re-send next time
//   5. Navigate to /review

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useScraperIntakeStore } from "../store";

// Inline fetch wrapper that surfaces server errors as a thrown string.
async function api(path, opts) {
  const r = await fetch(path, opts);
  let body;
  try { body = await r.json(); } catch { body = {}; }
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

// NJ check — relies on the scraper's SECTION OF NJ tagging. The scraper
// runs every row through nj_municipalities.json (682 NJ cities) and
// fills North/Central/South. If the column is anything else (blank,
// "Out of state", etc.), we treat as non-NJ. Trust the scraper rather
// than re-implement the lookup on this side.
function isNJEvent(row) {
  const r = String(row?.["SECTION OF NJ"] || "").toUpperCase().trim();
  return r === "NORTH" || r === "CENTRAL" || r === "SOUTH";
}

function alreadyPushed(row) {
  return String(row?.PUSHED_AT || "").trim() !== "";
}

// Parse the DATE column into a JS Date. Server returns formattedValue
// (text the user sees in the Sheet), which the scraper writes as
// "M/D/YYYY". Tolerant of a few other forms in case past stagings used
// different formats.
function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  // M/D/YYYY or MM/DD/YYYY
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    const d = new Date(yr, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    return isNaN(d) ? null : d;
  }
  // YYYY-MM-DD
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return isNaN(d) ? null : d;
  }
  // Last-ditch: let JS try
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// JS getDay() index → Fri/Sat/Sun string. Anything else returns empty
// (the calendar only renders Fri/Sat/Sun, but if the user staged a
// weekday range we shouldn't drop those silently — pass through so
// they can see + handle in /review).
function dayOfWeek(date) {
  if (!date) return "";
  const wd = date.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  if (wd === 5) return "Fri";
  if (wd === 6) return "Sat";
  if (wd === 0) return "Sun";
  return "";  // Mon-Thu — user can fix or reject in /review
}

// Map a Weekend_Review row into the event shape ReviewQueue expects.
// The ReviewQueue's parseRows() emits objects with these keys, so we
// match them exactly. id is stable per POST ID so re-staging the same
// event later won't create dupes (ReviewQueue dedupes by id).
function rowToEvent(row) {
  const date = parseDate(row["DATE"]);
  const postId = String(row["POST ID"] || "").trim();
  return {
    id: `scraper_${postId || Math.random().toString(36).slice(2)}`,
    name: row["EVENT NAME"] || "",
    day: dayOfWeek(date),
    time: row["START TIME"] || "",
    venue: row["VENUE NAME"] || "",
    area: row["CITY"] || "",
    region: row["SECTION OF NJ"] || "",
    type: row["EVENT TYPE"] || "",
    link: row["INSTAGRAM POST URL"] || row["POST URL"] || "",
    igHandle: row["INSTAGRAM HANDLE"] ? `@${String(row["INSTAGRAM HANDLE"]).replace(/^@/, "")}` : "",
    // Optional metadata fields some reviewers reference. Empty strings
    // are fine — ReviewQueue's warnings handle missing fields gracefully.
    description: row["NEWSLETTER DESCRIPTION"] || "",
    flyerUrl: row["DISPLAY URL"] || "",
    // Audit-trail provenance — lets the user trace back to the original
    // scraper run if a row looks wrong.
    _scraperPostId: postId,
    _scraperRunId: row["RUN ID"] || "",
  };
}

export default function ScraperReview() {
  const navigate = useNavigate();
  const setIntake = useScraperIntakeStore((s) => s.setEvents);

  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState("");
  const [events, setEvents]     = useState([]);
  const [debugInfo, setDebugInfo] = useState(null);
  const [filter, setFilter]     = useState("nj_ready");  // nj_ready | non_nj | already_sent | all

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/weekend-review");
      setEvents(data.events || []);
      setDebugInfo(data._debug || null);
    } catch (e) {
      setError(String(e.message || e));
      setDebugInfo(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // Derived counts. Each row falls into exactly one of {nj_ready, non_nj,
  // already_sent}, so the filter chip totals don't overlap.
  const counts = useMemo(() => {
    let nj_ready = 0, non_nj = 0, already_sent = 0;
    for (const ev of events) {
      if (alreadyPushed(ev)) already_sent++;
      else if (isNJEvent(ev)) nj_ready++;
      else non_nj++;
    }
    return { nj_ready, non_nj, already_sent, all: events.length };
  }, [events]);

  const visible = useMemo(() => {
    return events.filter((ev) => {
      const pushed = alreadyPushed(ev);
      const nj = isNJEvent(ev);
      if (filter === "nj_ready")     return nj && !pushed;
      if (filter === "non_nj")       return !nj && !pushed;
      if (filter === "already_sent") return pushed;
      return true;
    });
  }, [events, filter]);

  // The set the Send button will actually push — always "NJ + not yet pushed",
  // regardless of which filter is currently shown. The button label uses
  // this count, not the visible count, to avoid confusion.
  const sendable = useMemo(() => {
    return events.filter((ev) => isNJEvent(ev) && !alreadyPushed(ev));
  }, [events]);

  async function sendToReview() {
    if (sendable.length === 0) return;
    setSending(true);
    setError("");
    try {
      const mapped = sendable.map(rowToEvent);
      // 1. Stage in the intake store for ReviewQueue to consume on mount
      setIntake(mapped);
      // 2. Stamp PUSHED_AT on the sheet so these rows don't re-send next time
      const updates = sendable.map((ev) => ({
        post_id: String(ev["POST ID"] || "").trim(),
        fields: { PUSHED_AT: new Date().toISOString() },
      }));
      await api("/api/weekend-review/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      // 3. Navigate — ReviewQueue's mount effect picks up the intake
      navigate("/review");
    } catch (e) {
      setError(`Send failed: ${e.message}`);
      // Roll back the intake so /review doesn't get a half-sent batch
      setIntake([]);
    } finally {
      setSending(false);
    }
  }

  // Top status strip — same color-coded card pattern as before
  const statusStrip = (() => {
    if (loading) {
      return <div style={statusStripStyle("#6b7280")}>
        <span style={dotStyle("#6b7280")} /> Loading Weekend_Review…
      </div>;
    }
    if (error) {
      return <div style={statusStripStyle("#dc2626")}>
        <span style={dotStyle("#dc2626")} />
        <span><b>Couldn't load:</b> {error}</span>
      </div>;
    }
    if (counts.all === 0) {
      return <div style={statusStripStyle("#f59e0b")}>
        <span style={dotStyle("#f59e0b")} />
        <span>
          <b>Connected, but Weekend_Review is empty.</b> Open the
          Insta-Scraper UI → Stage Review → click <b>🎯 Stage for Review</b>.
        </span>
      </div>;
    }
    return <div style={statusStripStyle("#16a34a")}>
      <span style={dotStyle("#16a34a")} />
      <span>
        <b>{counts.all} row(s) in Weekend_Review</b> ·
        <span style={{ color: "#15803d", marginLeft: 6 }}>{counts.nj_ready} NJ ready</span> ·
        <span style={{ color: "#92400e", marginLeft: 6 }}>{counts.non_nj} non-NJ filtered out</span> ·
        <span style={{ color: "#6b7280", marginLeft: 6 }}>{counts.already_sent} already sent</span>
        {debugInfo && (
          <span style={{ color: "#6b7280", marginLeft: 8, fontSize: 12 }}>
            ({debugInfo.headerCount} columns)
          </span>
        )}
      </span>
    </div>;
  })();

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Scraper → Review</h1>
        <div style={{ color: "#6b7280", fontSize: 14 }}>
          Pulls events from the Insta-Scraper's <code>Weekend_Review</code> tab,
          filters to NJ, and pushes them into the /review pending queue
          where you do your final refinement.
        </div>
      </div>

      {statusStrip}

      {/* Primary action — Send + filter chips on one row */}
      <div style={{
        display: "flex",
        gap: 12,
        marginTop: 16,
        alignItems: "center",
        flexWrap: "wrap",
        padding: "12px 16px",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
      }}>
        <button
          onClick={sendToReview}
          disabled={sendable.length === 0 || sending}
          style={{
            padding: "12px 20px",
            background: sendable.length > 0 ? "#2563eb" : "#9ca3af",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 15,
            cursor: sendable.length > 0 && !sending ? "pointer" : "not-allowed",
          }}
        >
          {sending
            ? "Sending…"
            : sendable.length === 0
              ? "📤 Nothing new to send"
              : `📤 Send ${sendable.length} NJ event${sendable.length === 1 ? "" : "s"} to Review`}
        </button>
        <button
          onClick={load}
          disabled={loading || sending}
          style={{
            padding: "10px 14px",
            background: "white",
            color: "#1f2937",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 13,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Loading…" : "↻ Refresh from Sheet"}
        </button>
        <span style={{ color: "#6b7280", fontSize: 13, marginLeft: "auto" }}>
          Non-NJ events ({counts.non_nj}) are skipped automatically based on
          the scraper's SECTION OF NJ tagging.
        </span>
      </div>

      {/* Filter chips — view-only, don't affect what gets sent */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {[
          { key: "nj_ready",     label: "NJ ready",     n: counts.nj_ready,     color: "#16a34a" },
          { key: "non_nj",       label: "Non-NJ",       n: counts.non_nj,       color: "#f59e0b" },
          { key: "already_sent", label: "Already sent", n: counts.already_sent, color: "#6b7280" },
          { key: "all",          label: "All",          n: counts.all,          color: "#2563eb" },
        ].map(({ key, label, n, color }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: "6px 12px",
                borderRadius: 16,
                border: `1px solid ${active ? color : "#d1d5db"}`,
                background: active ? color : "white",
                color: active ? "white" : "#1f2937",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {label} · {n}
            </button>
          );
        })}
      </div>

      {!loading && !error && visible.length === 0 && (
        <div style={{ marginTop: 24, padding: 24, textAlign: "center", color: "#6b7280" }}>
          No events in the <b>{filter.replace("_", " ")}</b> filter.
        </div>
      )}

      {/* Read-only preview cards. No buttons — sending is bulk only.
          Edits happen later in /review. */}
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {visible.map((ev) => {
          const nj = isNJEvent(ev);
          const pushed = alreadyPushed(ev);
          const photo = ev["DISPLAY URL"] || "";
          const accent = pushed ? "#6b7280" : nj ? "#16a34a" : "#f59e0b";
          return (
            <div
              key={String(ev._row)}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr auto",
                gap: 12,
                padding: 10,
                border: `1px solid ${accent}33`,
                borderLeft: `4px solid ${accent}`,
                borderRadius: 6,
                background: "white",
              }}
            >
              {photo ? (
                <img
                  src={photo}
                  alt=""
                  style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4 }}
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              ) : (
                <div style={{
                  width: 80, height: 80, background: "#f3f4f6",
                  borderRadius: 4, display: "flex", alignItems: "center",
                  justifyContent: "center", color: "#9ca3af", fontSize: 10,
                }}>
                  (no image)
                </div>
              )}
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {ev["EVENT NAME"] || <span style={{ color: "#9ca3af" }}>(no name)</span>}
                </div>
                <div style={{ fontSize: 12, color: "#4b5563", marginTop: 2 }}>
                  <b>{ev["DATE"] || "(no date)"}</b>
                  {ev["START TIME"] && ` · ${ev["START TIME"]}`}
                  {" · "}
                  {ev["VENUE NAME"] || "(no venue)"}
                  {ev["CITY"] && `, ${ev["CITY"]}`}
                  {ev["SECTION OF NJ"] && (
                    <span style={{ color: nj ? "#16a34a" : "#f59e0b", marginLeft: 6 }}>
                      [{ev["SECTION OF NJ"]}]
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  @{ev["INSTAGRAM HANDLE"] || "?"}
                  {ev["CONFIDENCE"] && ` · conf ${ev["CONFIDENCE"]}`}
                  {pushed && (
                    <span style={{ marginLeft: 6, color: "#6b7280" }}>
                      · ✓ sent {String(ev.PUSHED_AT).slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                {ev["INSTAGRAM POST URL"] && (
                  <a
                    href={ev["INSTAGRAM POST URL"]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "#2563eb" }}
                  >
                    IG ↗
                  </a>
                )}
                {!nj && !pushed && (
                  <span style={{ fontSize: 10, color: "#f59e0b", fontWeight: 600 }}>
                    (filtered out)
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function statusStripStyle(color) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    marginTop: 12,
    border: `1px solid ${color}33`,
    borderLeft: `4px solid ${color}`,
    background: `${color}0d`,
    borderRadius: 6,
    fontSize: 13,
    color: "#1f2937",
  };
}
function dotStyle(color) {
  return {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  };
}
