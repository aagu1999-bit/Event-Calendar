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
//   1. Filter out rows whose CITY/SECTION explicitly names a major
//      non-NJ city (NYC, Philadelphia, etc.) or out-of-state suffix
//      (", NY", ", PA"). Everything else passes — blank/unclear
//      location is no longer dropped. See isNJEvent below for details.
//   2. Skip rows already pushed (PUSHED_AT not empty)
//   3. Map Weekend_Review rows → Event-Calendar event shape
//   4. Stage in useScraperIntakeStore (consumed by ReviewQueue on mount)
//   5. Stamp PUSHED_AT on the sheet rows so they don't re-send next time
//   6. Navigate to /review

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

// NJ check — default-include with an out-of-state blacklist.
//
// History: this used to be a strict whitelist (only allow when
// SECTION OF NJ was explicitly NORTH/CENTRAL/SOUTH). That dropped a
// lot of real NJ events whose SECTION OF NJ was blank because the
// scraper's city → section lookup didn't match the extracted text.
//
// New rule:
//   1. If SECTION OF NJ is explicitly NJ → include (trust the scraper).
//   2. Otherwise look at CITY + SECTION for explicit non-NJ markers
//      (NYC, Philly, "NY" as a state suffix, etc.). If present → drop.
//   3. Everything else → include. Blank/unclear location no longer
//      gets filtered out — the user will catch obvious non-events
//      in /review anyway.
const NON_NJ_CITY_PATTERNS = [
  /\bnew york city\b/i, /\bnyc\b/i,
  /\bmanhattan\b/i, /\bbrooklyn\b/i, /\bqueens\b/i, /\bbronx\b/i,
  /\bstaten island\b/i, /\blong island\b/i,
  /\byonkers\b/i, /\balbany\b/i, /\bbuffalo\b/i,
  /\bphiladelphia\b/i, /\bphilly\b/i, /\bpittsburgh\b/i,
  /\ballentown\b/i, /\bbethlehem\b/i,
  /\bhartford\b/i, /\bnew haven\b/i, /\bstamford\b/i, /\bbridgeport\b/i,
  /\bwilmington\b/i, /\bbaltimore\b/i, /\bboston\b/i,
  /\bwashington,?\s*d\.?c\.?\b/i,
];
// State abbreviations only count when comma-prefixed (city, state form).
// Avoids false positives on event names that happen to contain the letters.
const NON_NJ_STATE_COMMA = /,\s*(NY|PA|CT|DE|MD|MA|DC)\b/i;
const NON_NJ_STATE_FULL  = /\b(pennsylvania|connecticut|delaware|maryland|massachusetts)\b/i;

function isExplicitlyNJ(row) {
  const r = String(row?.["SECTION OF NJ"] || "").toUpperCase().trim();
  return r === "NORTH" || r === "CENTRAL" || r === "SOUTH";
}

function isExplicitlyNonNJ(row) {
  // Look at CITY + SECTION OF NJ only. VENUE NAME / EVENT NAME are too
  // noisy ("New York Sports Club in Hoboken", "NYC-style pizza", etc.)
  // and would cause false drops.
  const city    = String(row?.["CITY"] || "");
  const section = String(row?.["SECTION OF NJ"] || "");
  const combined = `${city}, ${section}`;

  for (const pat of NON_NJ_CITY_PATTERNS) {
    if (pat.test(combined)) return true;
  }
  if (NON_NJ_STATE_COMMA.test(combined)) return true;
  if (NON_NJ_STATE_FULL.test(combined))  return true;
  return false;
}

function isNJEvent(row) {
  if (isExplicitlyNJ(row))   return true;   // scraper tagged NJ → trust
  return !isExplicitlyNonNJ(row);           // else default include
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
  // M/D for the new `date` column on events. Without this, scraper-
  // imported events would show blank in the date column on export.
  const dateMD = date ? `${date.getMonth() + 1}/${date.getDate()}` : "";
  return {
    id: `scraper_${postId || Math.random().toString(36).slice(2)}`,
    name: row["EVENT NAME"] || "",
    day: dayOfWeek(date),
    date: dateMD,
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

  // Idle = nothing fetched yet (user hasn't clicked Load). Distinct
  // from "loading" so the empty-state messaging is correct on first
  // visit ("click Load" instead of "connected but empty").
  const [loading, setLoading]   = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState("");
  const [events, setEvents]     = useState([]);
  const [debugInfo, setDebugInfo] = useState(null);
  const [filter, setFilter]     = useState("nj_ready");  // nj_ready | non_nj | already_sent | all
  // Render cap — a Weekend_Review with 100+ rows was crashing both
  // mobile Safari and desktop Chrome because every card was rendering
  // a full-resolution Instagram CDN image up-front (100 fetches +
  // 100 decoded bitmaps in memory). Cap initial render at 50; the
  // "Show all" button expands on demand. Resets on filter change.
  const ROW_RENDER_CAP = 50;
  const [showAllRows, setShowAllRows] = useState(false);
  useEffect(() => { setShowAllRows(false); }, [filter]);
  // Toggle to override the "skip already-sent" behavior. When the
  // user clears Review + the events store and wants to re-import the
  // SAME scraper batch (e.g. starting fresh on the same weekend),
  // the PUSHED_AT stamp on the sheet would otherwise lock those rows
  // out forever. With this flag ON, sendable includes already-sent
  // rows so they re-stage in Review. PUSHED_AT gets re-stamped on send.
  const [includeAlreadySent, setIncludeAlreadySent] = useState(false);

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
      setHasFetched(true);
    }
  }
  // No auto-load on mount. User taps "Load from Sheet" to fetch —
  // avoids surprise network requests on every page visit and removes
  // the auto-render of 100+ remote IG images that was OOMing tabs.

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

  // The set the Send button will actually push — "NJ + not yet pushed"
  // by default. When includeAlreadySent is ON, already-sent rows ALSO
  // qualify (useful for re-staging the same batch after a wipe).
  // The button label reads this count so the user sees what they'll
  // actually send.
  const sendable = useMemo(() => {
    return events.filter((ev) => isNJEvent(ev) && (includeAlreadySent || !alreadyPushed(ev)));
  }, [events, includeAlreadySent]);

  async function sendToReview() {
    if (sendable.length === 0) return;
    setSending(true);
    setError("");
    try {
      const mapped = sendable.map(rowToEvent);
      // 1. Stage in the intake store for ReviewQueue to consume on mount
      setIntake(mapped);
      // 2. Stamp PUSHED_AT on the sheet so these rows don't re-send next time.
      //    Use _row (1-indexed sheet row) when present — POST IDs occasionally
      //    differ between read and write paths (trailing whitespace, numeric
      //    coercion, etc.), but _row is what the server itself assigned and is
      //    always stable.
      const updates = sendable.map((ev) => ({
        post_id: String(ev["POST ID"] || "").trim(),
        row:     ev._row,
        fields: { PUSHED_AT: new Date().toISOString() },
      }));
      const resp = await api("/api/weekend-review/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      // 3. Verify the server actually stamped every row. If any failed
      //    (POST ID not found, etc.), surface the failure instead of
      //    silently navigating away — that's the cause of the "I sent
      //    them but they keep coming back" confusion.
      const failed = (resp?.results || []).filter((r) => !r.ok);
      if (failed.length > 0) {
        const sample = failed.slice(0, 5).map((f) => `${f.post_id} (${f.error})`).join(", ");
        setError(
          `Server reported ${failed.length}/${resp.total} rows could not be stamped. ` +
          `These will reappear on next refresh. First few: ${sample}`
        );
        setIntake([]);
        return;
      }
      // 4. Navigate — ReviewQueue's mount effect picks up the intake
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
    // Idle (first visit, nothing fetched yet) — instructs the user to
    // tap Load. Distinct from "empty result" so the messaging is
    // accurate when no API call has run.
    if (!hasFetched && !loading && !error) {
      return <div style={statusStripStyle("#2563eb")}>
        <span style={dotStyle("#2563eb")} />
        <span>
          <b>Ready to pull from Weekend_Review.</b> Click <b>↻ Load from Sheet</b> to fetch the latest staged events.
        </span>
      </div>;
    }
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
            background: !hasFetched && !loading ? "#2563eb" : "white",
            color: !hasFetched && !loading ? "white" : "#1f2937",
            border: !hasFetched && !loading ? "none" : "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: !hasFetched && !loading ? 700 : 400,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Loading…" : hasFetched ? "↻ Refresh from Sheet" : "↻ Load from Sheet"}
        </button>
        {/* Include-already-sent toggle. Off by default (the common case
            — only stage new events). Flip on to re-stage already-sent
            rows when you've wiped Review + the events store and want
            to work the same set again. */}
        {hasFetched && counts.already_sent > 0 && (
          <label
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 12px",
              background: includeAlreadySent ? "#fef3c7" : "#f9fafb",
              border: `1px solid ${includeAlreadySent ? "#f59e0b" : "#e5e7eb"}`,
              borderRadius: 6,
              fontSize: 12,
              color: includeAlreadySent ? "#92400e" : "#374151",
              cursor: "pointer",
              userSelect: "none",
              fontWeight: includeAlreadySent ? 700 : 500,
            }}
            title="Re-stage already-sent events (useful after clearing Review + the events store to rebuild the same set)"
          >
            <input
              type="checkbox"
              checked={includeAlreadySent}
              onChange={(e) => setIncludeAlreadySent(e.target.checked)}
              style={{ margin: 0 }}
            />
            Include already-sent ({counts.already_sent})
          </label>
        )}
        <span style={{ color: "#6b7280", fontSize: 13, marginLeft: "auto" }}>
          Only rows whose CITY/SECTION explicitly names a non-NJ city
          (NYC, Philly, etc.) are skipped ({counts.non_nj}). Blank or
          ambiguous locations pass through — you can drop them in /review.
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
          Edits happen later in /review.

          Capped at ROW_RENDER_CAP — beyond that the user gets a
          "Show all" button. Each card has a remote Instagram image, so
          rendering all 100+ cards at once means 100+ remote fetches and
          100+ decoded bitmaps in memory: enough to OOM mobile Safari
          and trigger Chrome's "Aw, Snap!" on desktop. */}
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {(showAllRows ? visible : visible.slice(0, ROW_RENDER_CAP)).map((ev) => {
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
                  loading="lazy"
                  decoding="async"
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
        {/* Show-all toggle — gates the rest of the cards (and their
            remote Instagram images) behind an explicit user click so
            big Weekend_Review batches don't crash the tab on load. */}
        {!showAllRows && visible.length > ROW_RENDER_CAP && (
          <button
            onClick={() => setShowAllRows(true)}
            style={{
              padding: "14px",
              marginTop: 4,
              background: "#f3f4f6",
              color: "#1f2937",
              border: "1px dashed #d1d5db",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
            title={`Showing first ${ROW_RENDER_CAP} of ${visible.length}. Click to render the rest (slower — loads more images).`}
          >
            Show all {visible.length} events ({visible.length - ROW_RENDER_CAP} more · slower)
          </button>
        )}
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
