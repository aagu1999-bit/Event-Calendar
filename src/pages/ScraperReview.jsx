// ScraperReview — the Insta-Scraper bridge.
//
// Reads the Weekend_Review tab the scraper wrote (via the new
// /api/weekend-review endpoint) and renders one card per event with
// approve / reject / edit. Approvals and edits are written back to
// the same Sheet so the scraper, this app, and the eventual website
// publisher all share one source of truth.
//
// This page is intentionally SEPARATE from /review (which handles the
// existing Excel-paste workflow). Different inputs, different lifecycle,
// no risk of accidentally breaking the long-standing manual review flow.

import { useState, useEffect, useMemo } from "react";

// Field labels we surface in the card header. Order matters — these are
// the four things the user most needs to see at a glance when deciding
// whether to approve a row.
const PRIMARY_FIELDS = ["EVENT NAME", "DATE", "VENUE NAME", "CITY"];

// Fields the user can edit inline before approving. Kept short — the
// most common mistakes the scraper makes are venue confusion and the
// date/time fields. Bigger fields (description, newsletter blurb) live
// behind the "Show all fields" expander.
const EDITABLE_FIELDS = ["EVENT NAME", "DATE", "START TIME", "VENUE NAME", "CITY"];

// Status filter — the user almost always only wants to see pending rows.
const STATUS_OPTIONS = ["pending", "approved", "rejected", "all"];

function statusOf(ev) {
  const v = String(ev?.APPROVED || "").toUpperCase();
  if (v === "TRUE") return "approved";
  if (v === "FALSE") return "rejected";
  return "pending";
}

// Inline fetch wrapper that surfaces server errors as a thrown string.
async function api(path, opts) {
  const r = await fetch(path, opts);
  let body;
  try { body = await r.json(); } catch { body = {}; }
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

export default function ScraperReview() {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [events, setEvents]     = useState([]);
  const [counts, setCounts]     = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [debugInfo, setDebugInfo] = useState(null);  // _debug from API
  const [statusFilter, setStatusFilter] = useState("pending");
  const [busy, setBusy]         = useState({});  // post_id -> bool
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/weekend-review");
      setEvents(data.events || []);
      setCounts({
        total:    data.total    || 0,
        pending:  data.pending  || 0,
        approved: data.approved || 0,
        rejected: data.rejected || 0,
      });
      setDebugInfo(data._debug || null);
    } catch (e) {
      setError(String(e.message || e));
      setDebugInfo(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    if (statusFilter === "all") return events;
    return events.filter((e) => statusOf(e) === statusFilter);
  }, [events, statusFilter]);

  async function updateRow(post_id, fields) {
    setBusy((b) => ({ ...b, [post_id]: true }));
    try {
      await api("/api/weekend-review/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id, fields }),
      });
      // Update local state so the UI reacts immediately without re-fetching
      // the whole sheet (a single change shouldn't burn a full read).
      setEvents((prev) => prev.map((e) =>
        String(e["POST ID"]) === String(post_id)
          ? { ...e, ...fields, REVIEWED_AT: fields.REVIEWED_AT || new Date().toISOString() }
          : e
      ));
      // Recompute counts cheaply
      setCounts((c) => {
        const wasPending = !events.find((e) => String(e["POST ID"]) === String(post_id))?.APPROVED;
        const isApproved = String(fields.APPROVED || "").toUpperCase() === "TRUE";
        const isRejected = String(fields.APPROVED || "").toUpperCase() === "FALSE";
        if (!wasPending) return c;
        if (isApproved) return { ...c, pending: c.pending - 1, approved: c.approved + 1 };
        if (isRejected) return { ...c, pending: c.pending - 1, rejected: c.rejected + 1 };
        return c;
      });
    } catch (e) {
      alert(`Update failed: ${e.message}`);
    } finally {
      setBusy((b) => ({ ...b, [post_id]: false }));
    }
  }

  function startEdit(ev) {
    setEditingId(ev["POST ID"]);
    const draft = {};
    for (const f of EDITABLE_FIELDS) draft[f] = ev[f] || "";
    setEditDraft(draft);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  async function saveEdit(ev) {
    const post_id = ev["POST ID"];
    const changes = {};
    const changedKeys = [];
    for (const f of EDITABLE_FIELDS) {
      const before = ev[f] || "";
      const after  = editDraft[f] || "";
      if (String(before) !== String(after)) {
        changes[f] = after;
        changedKeys.push(f);
      }
    }
    if (!changedKeys.length) {
      cancelEdit();
      return;
    }
    // Append to EDITED_FIELDS so audit trail records what was touched
    // without losing prior edits if the same row is edited twice.
    const priorEdited = ev.EDITED_FIELDS || "";
    const newEdited = priorEdited
      ? `${priorEdited}; ${changedKeys.join(",")}`
      : changedKeys.join(",");
    changes.EDITED_FIELDS = newEdited;
    await updateRow(post_id, changes);
    cancelEdit();
  }

  // Top-of-page connection status strip. Three states:
  //   · loading              → muted "connecting" pill
  //   · error                → red "couldn't connect" with the actual cause
  //   · connected (with data)→ green "Connected · N rows" with metadata
  //   · connected (no data)  → amber "Connected but Weekend_Review is empty"
  // Makes "is the bridge actually working" answerable in one glance,
  // without having to curl /api/weekend-review/debug from the shell.
  const statusStrip = (() => {
    if (loading) {
      return (
        <div style={statusStripStyle("#6b7280")}>
          <span style={dotStyle("#6b7280")} />
          Connecting to Google Sheets…
        </div>
      );
    }
    if (error) {
      return (
        <div style={statusStripStyle("#dc2626")}>
          <span style={dotStyle("#dc2626")} />
          <span>
            <b>Connection failed:</b> {error}
          </span>
        </div>
      );
    }
    if (counts.total === 0) {
      return (
        <div style={statusStripStyle("#f59e0b")}>
          <span style={dotStyle("#f59e0b")} />
          <span>
            <b>Connected to Google Sheets</b>, but the <code>Weekend_Review</code> tab is empty.
            Open the Insta-Scraper UI → <b>Stage Review</b> → click <b>🎯 Stage for Review</b> to populate it.
            {debugInfo && (
              <span style={{ color: "#92400e", marginLeft: 8, fontSize: 12 }}>
                (sheet has {debugInfo.sheetRowCount} rows, {debugInfo.headerCount} header columns detected)
              </span>
            )}
          </span>
        </div>
      );
    }
    return (
      <div style={statusStripStyle("#16a34a")}>
        <span style={dotStyle("#16a34a")} />
        <span>
          <b>Connected</b> · Reading <code>Weekend_Review</code> · {counts.total} total row(s)
          {debugInfo && (
            <span style={{ color: "#15803d", marginLeft: 8, fontSize: 12 }}>
              ({debugInfo.headerCount} columns)
            </span>
          )}
        </span>
      </div>
    );
  })();

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Scraper Review</h1>
        <div style={{ color: "#6b7280", fontSize: 14 }}>
          Events the Insta-Scraper staged into the <code>Weekend_Review</code> tab.
          Approvals + edits write back to the same Sheet.
        </div>
      </div>

      {statusStrip}

      {/* Summary + filter chips */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {STATUS_OPTIONS.map((s) => {
          const n = s === "all" ? counts.total : counts[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "6px 12px",
                borderRadius: 16,
                border: `1px solid ${active ? "#2563eb" : "#d1d5db"}`,
                background: active ? "#2563eb" : "white",
                color: active ? "white" : "#1f2937",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {s} · {n}
            </button>
          );
        })}
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: "6px 12px",
            borderRadius: 16,
            border: "1px solid #d1d5db",
            background: "white",
            cursor: loading ? "wait" : "pointer",
            fontSize: 13,
          }}
        >
          {loading ? "Loading…" : "↻ Refresh from Sheet"}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 12,
          padding: 12,
          border: "1px solid #fecaca",
          background: "#fef2f2",
          borderRadius: 6,
          color: "#991b1b",
          fontSize: 14,
        }}>
          <b>Couldn't load Weekend_Review:</b> {error}
          <br />
          <span style={{ color: "#6b7280", fontSize: 12 }}>
            Common causes: missing GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL
            / GOOGLE_SERVICE_ACCOUNT_KEY in Replit Secrets, or the scraper hasn't
            run "Stage for Review" yet so the tab doesn't exist.
          </span>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div style={{ marginTop: 24, padding: 24, textAlign: "center", color: "#6b7280" }}>
          No <b>{statusFilter}</b> events.
          {statusFilter === "pending" && counts.total > 0 &&
            " Try the 'all' filter to see approved/rejected rows."}
          {statusFilter === "pending" && counts.total === 0 &&
            " The Weekend_Review tab is empty. Open the scraper UI → Stage Review → click 'Stage for Review' to populate it."}
        </div>
      )}

      {/* Cards */}
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {visible.map((ev) => {
          const status = statusOf(ev);
          const post_id = ev["POST ID"];
          const isBusy = !!busy[post_id];
          const isEditing = editingId === post_id;
          const photo = ev["DISPLAY URL"] || ev["INSTAGRAM POST URL"] || "";
          const flags = ev["QUALITY FLAGS"] || "";

          return (
            <div
              key={post_id}
              style={{
                display: "grid",
                gridTemplateColumns: "160px 1fr auto",
                gap: 12,
                padding: 12,
                border: `1px solid ${
                  status === "approved" ? "#86efac" :
                  status === "rejected" ? "#fca5a5" : "#e5e7eb"
                }`,
                borderRadius: 8,
                background: status === "approved" ? "#f0fdf4" :
                            status === "rejected" ? "#fef2f2" : "white",
                opacity: isBusy ? 0.6 : 1,
              }}
            >
              {/* Photo column */}
              <div style={{ width: 160 }}>
                {photo ? (
                  <img
                    src={photo}
                    alt=""
                    style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 6, background: "#f3f4f6" }}
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                ) : (
                  <div style={{
                    width: "100%", height: 160, background: "#f3f4f6",
                    borderRadius: 6, display: "flex", alignItems: "center",
                    justifyContent: "center", color: "#9ca3af", fontSize: 12,
                  }}>
                    (no image)
                  </div>
                )}
                {ev["INSTAGRAM POST URL"] && (
                  <a
                    href={ev["INSTAGRAM POST URL"]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "#2563eb", marginTop: 4, display: "block" }}
                  >
                    Open on Instagram ↗
                  </a>
                )}
              </div>

              {/* Detail column */}
              <div>
                {!isEditing && (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                      {ev["EVENT NAME"] || <span style={{ color: "#9ca3af" }}>(no name)</span>}
                    </div>
                    <div style={{ fontSize: 13, color: "#4b5563", marginBottom: 6 }}>
                      <b>{ev["DATE"] || "(no date)"}</b>
                      {ev["START TIME"] && ` · ${ev["START TIME"]}`}
                      {" · "}
                      {ev["VENUE NAME"] || "(no venue)"}
                      {ev["CITY"] && ` · ${ev["CITY"]}`}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      @{ev["INSTAGRAM HANDLE"] || "?"}
                      {ev["CONFIDENCE"] && ` · conf ${ev["CONFIDENCE"]}`}
                      {flags && ` · `}
                      {flags && (
                        <span style={{ color: "#dc2626" }}>{flags}</span>
                      )}
                    </div>
                    {ev["NEWSLETTER DESCRIPTION"] && (
                      <details style={{ marginTop: 6, fontSize: 12, color: "#4b5563" }}>
                        <summary style={{ cursor: "pointer", color: "#6b7280" }}>Show description + all fields</summary>
                        <div style={{ marginTop: 6, padding: 8, background: "#f9fafb", borderRadius: 4 }}>
                          {ev["NEWSLETTER DESCRIPTION"]}
                        </div>
                        <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11, color: "#6b7280" }}>
                          {Object.entries(ev)
                            .filter(([k, v]) => v && !k.startsWith("_"))
                            .map(([k, v]) => (
                              <div key={k}><b>{k}:</b> {String(v).slice(0, 120)}</div>
                            ))}
                        </div>
                      </details>
                    )}
                    {status !== "pending" && ev.REVIEWED_AT && (
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
                        Reviewed: {ev.REVIEWED_AT.slice(0, 16).replace("T", " ")}
                        {ev.EDITED_FIELDS && ` · Edited: ${ev.EDITED_FIELDS}`}
                      </div>
                    )}
                  </>
                )}

                {isEditing && (
                  <div style={{ display: "grid", gap: 6 }}>
                    {EDITABLE_FIELDS.map((f) => (
                      <label key={f} style={{ fontSize: 12, color: "#4b5563" }}>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{f}</div>
                        <input
                          value={editDraft[f] || ""}
                          onChange={(e) => setEditDraft((d) => ({ ...d, [f]: e.target.value }))}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            border: "1px solid #d1d5db",
                            borderRadius: 4,
                            fontSize: 13,
                          }}
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 100 }}>
                {!isEditing && status === "pending" && (
                  <>
                    <button
                      onClick={() => updateRow(post_id, { APPROVED: "TRUE" })}
                      disabled={isBusy}
                      style={btnStyle("#16a34a")}
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={() => updateRow(post_id, { APPROVED: "FALSE" })}
                      disabled={isBusy}
                      style={btnStyle("#dc2626")}
                    >
                      ✗ Reject
                    </button>
                    <button
                      onClick={() => startEdit(ev)}
                      disabled={isBusy}
                      style={btnStyle("#6b7280", true)}
                    >
                      📝 Edit
                    </button>
                  </>
                )}
                {!isEditing && status !== "pending" && (
                  <button
                    onClick={() => updateRow(post_id, { APPROVED: "" })}
                    disabled={isBusy}
                    style={btnStyle("#6b7280", true)}
                  >
                    ↶ Reopen
                  </button>
                )}
                {isEditing && (
                  <>
                    <button
                      onClick={() => saveEdit(ev)}
                      disabled={isBusy}
                      style={btnStyle("#2563eb")}
                    >
                      💾 Save edits
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={isBusy}
                      style={btnStyle("#6b7280", true)}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Top-of-page status strip helpers — small left-border colored card
// with a tiny status dot. Color comes from caller (red/amber/green/gray).
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

function btnStyle(color, outline = false) {
  return {
    padding: "6px 10px",
    borderRadius: 6,
    border: outline ? `1px solid ${color}` : `1px solid ${color}`,
    background: outline ? "white" : color,
    color: outline ? color : "white",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  };
}
