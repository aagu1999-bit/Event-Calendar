import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { listSessions, loadSession, saveSession, deleteSession, sessionBackend, listSessionBackups, restoreSessionBackup } from "./reviewSessions.js";

// Download an object as a pretty-printed JSON file. Pure client-side — no
// backend involved, so this works even when the app is served statically
// (no Repl server) and the file can be handed to anyone on any account.
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatWhen(ts) {
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 1) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

// Picker UI for named Review Sessions. Two modes via the `mode` prop:
//   - "load" → list existing sessions, click to load (replaces current
//     events + approvals). Includes a "Save current as new…" button at
//     the top so the user can capture the current state without leaving
//     the modal.
//   - "save" → name prompt + list of existing sessions to overwrite.
//
// The host (ReviewQueue) supplies the current events/approvals via
// `getCurrent()` and receives loaded state via `onLoad(payload)`. This
// keeps the modal stateless and reusable.
export function ReviewSessionsModal({
  open,
  onClose,
  onLoad,
  getCurrent,
  mode = "load",
  onSaveSuccess,
  onDeleteSuccess,
}) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Which backend is storing sessions: "replit-db" (truly cross-device),
  // "filesystem" (this instance's disk only), or null (server unreachable).
  const [backend, setBackend] = useState(undefined);
  const fileInputRef = useRef(null);
  // Backups expander: which session's snapshot list is open, and its rows.
  const [backupsFor, setBackupsFor] = useState(null);   // session name | null
  const [backups, setBackups] = useState([]);           // snapshots, newest first
  const [backupsLoading, setBackupsLoading] = useState(false);

  const toggleBackups = async (name, e) => {
    e.stopPropagation();
    if (backupsFor === name) { setBackupsFor(null); setBackups([]); return; }
    setBackupsFor(name);
    setBackups([]);
    setBackupsLoading(true);
    try {
      setBackups(await listSessionBackups(name));
    } catch (err) {
      alert("Couldn't load backups: " + (err.message || err));
      setBackupsFor(null);
    } finally {
      setBackupsLoading(false);
    }
  };

  const onRestoreBackup = async (name, snap, e) => {
    e.stopPropagation();
    if (busy) return;
    const when = new Date(snap.snappedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    if (!confirm(
      `Restore "${name}" to its backup from ${when}?\n\n` +
      `That copy has ${snap.pendingCount} in the triage queue and ${snap.vettedCount} vetted.\n\n` +
      `Don't worry — the current state gets backed up first, so you can undo this by restoring a newer backup.`
    )) return;
    setBusy(true);
    try {
      const restored = await restoreSessionBackup(name, snap.id);
      onLoad(restored, name);
      onClose();
    } catch (err) {
      alert("Restore failed: " + (err.message || err));
    } finally {
      setBusy(false);
    }
  };

  // Export the current review state to a downloadable .json file. Unlike the
  // server-backed "Save" (which writes to one Repl's disk and only syncs to
  // clients hitting that same live backend), a file works with zero backend
  // and can be handed to a teammate on any device or account.
  const exportToFile = () => {
    try {
      const cur = getCurrent() || {};
      const stamp = new Date().toISOString().slice(0, 10);
      const payload = {
        __cgeReviewSession: true,
        version: 1,
        exportedAt: Date.now(),
        events: Array.isArray(cur.events) ? cur.events : [],
        approvals: cur.approvals && typeof cur.approvals === "object" ? cur.approvals : {},
        vetted: Array.isArray(cur.vetted) ? cur.vetted : [],
        pending: Array.isArray(cur.pending) ? cur.pending : [],
        filter: typeof cur.filter === "string" ? cur.filter : "",
        sortByTag: typeof cur.sortByTag === "string" ? cur.sortByTag : null,
      };
      downloadJson(payload, `cge-review-session-${stamp}.json`);
    } catch (e) {
      alert("Export failed: " + (e.message || e));
    }
  };

  // Load a review session from a file the user picks. Mirrors onPickLoad but
  // reads the JSON locally instead of from the server.
  const importFromFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";   // reset so re-picking the same file fires onChange
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.events)) {
        throw new Error("That doesn't look like a CGE review-session file (no events array).");
      }
      const cur = getCurrent();
      if ((cur?.events?.length || 0) > 0 &&
          !confirm(`Replace the current ${cur.events.length} event(s) with the ${parsed.events.length} from this file?`)) {
        return;
      }
      onLoad(parsed, file.name.replace(/\.json$/i, ""));
      onClose();
    } catch (err) {
      alert("Import failed: " + (err.message || err));
    }
  };

  const reload = async () => {
    try {
      const list = await listSessions();
      setItems(list);
      setErr(null);
    } catch (e) {
      setErr(e.message || String(e));
      setItems([]);
    }
  };

  useEffect(() => {
    if (!open) return;
    reload();
    sessionBackend().then(setBackend);
  }, [open]);

  if (!open) return null;

  const onPickLoad = async (name) => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = await loadSession(name);
      onLoad(payload, name);
      onClose();
    } catch (e) {
      alert("Load failed: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveAs = async (overwriteName) => {
    if (busy) return;
    let name = overwriteName;
    if (!name) {
      const def = `triage-${new Date().toISOString().slice(0, 10)}`;
      name = prompt("Name this session (e.g. 'Friday triage', 'June recap'):", def);
      if (!name) return;
      name = name.trim();
      if (!name) return;
    } else {
      // Full-save REPLACES the whole session with this device's copy —
      // including any changes a partner made that this device hasn't seen
      // yet. When two people share a session, the ongoing auto-sync already
      // saves work continuously, so a manual overwrite is rarely needed and
      // can silently undo the partner's deletions. Make that risk explicit.
      if (!confirm(
        `Overwrite "${overwriteName}" with THIS device's copy?\n\n` +
        `⚠️ If someone else is working in this session, their recent changes ` +
        `(including deletions) will be REPLACED by what this device has right now.\n\n` +
        `If you're both working in the same session, you usually don't need this — ` +
        `changes auto-save and sync on their own.`
      )) return;
    }
    setBusy(true);
    try {
      const cur = getCurrent();
      await saveSession(name, cur);
      await reload();
      if (onSaveSuccess) onSaveSuccess(name);
      alert(
        `Saved "${name}":\n` +
        `· ${cur.events?.length || 0} events total (including untouched, flagged, and worked-on)\n` +
        `· ${(cur.vetted?.length) || 0} marked ✓ vetted\n` +
        `· ${Object.values(cur.approvals || {}).filter(Boolean).length} ☑ selected` +
        (cur.pending?.length ? `\n· ${cur.pending.length} in the triage queue (flagged / clean / conflicting)` : "")
      );
    } catch (e) {
      alert("Save failed: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (name, e) => {
    e.stopPropagation();
    if (busy) return;
    if (!confirm(`Delete session "${name}"?\n\nThis can't be undone (the workspace zip can still recover it if you've saved one).`)) return;
    setBusy(true);
    try {
      await deleteSession(name);
      await reload();
      if (onDeleteSuccess) onDeleteSuccess(name);
    } catch (e) {
      alert("Delete failed: " + (e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      className="cge-modal-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="cge-modal"
        style={{
          background: "#0d0d0d",
          border: "1px solid rgba(245,240,232,0.12)",
          borderRadius: "8px",
          width: "min(720px, 100%)",
          maxHeight: "80vh",
          display: "flex", flexDirection: "column",
          color: "#F5F0E8",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div className="cge-modal-header" style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(245,240,232,0.08)",
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "#34D399" }}>
            📁 Review Sessions
          </div>
          <div className="cge-modal-subtitle" style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {mode === "save" ? "Save the current events + approvals as a named snapshot" : "Click a session to load · save the current state as a new snapshot"}
          </div>
          {backend !== undefined && (() => {
            const cloud = backend === "postgres" || backend === "replit-db";
            const offline = backend === null;
            const c = cloud ? "#34D399" : offline ? "rgba(245,240,232,0.4)" : "#FBBF24";
            const label = cloud
              ? "☁️ Cloud sessions: on"
              : offline
                ? "⚠️ Sessions server offline"
                : "⚠️ Local only — won't cross devices";
            const tip = cloud
              ? "Sessions are stored in the shared database — they sync across every device and browser that opens this app, survive republishing, and support two people working in the same session at once."
              : offline
                ? "The session server isn't reachable. Use Import/Export File to move sessions by hand until it's back."
                : "Sessions are on THIS instance's local disk only. They won't reliably appear on another device or after a redeploy. Meanwhile use Export/Import File to hand sessions off.";
            return (
              <div
                title={tip}
                style={{
                  padding: "3px 9px", borderRadius: "999px",
                  background: `${c}1a`, color: c,
                  border: `1px solid ${c}66`,
                  fontSize: "0.5rem", fontWeight: 800, letterSpacing: "1px",
                  textTransform: "uppercase", whiteSpace: "nowrap", cursor: "help",
                }}
              >{label}</div>
            );
          })()}
          <div style={{ flex: 1 }} />
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={importFromFile}
            style={{ display: "none" }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            title="Load a session from a .json file a teammate sent you (no server needed)"
            style={{
              padding: "5px 12px", borderRadius: "4px",
              background: "rgba(99,179,237,0.1)", color: "#63B3ED",
              border: "1px solid rgba(99,179,237,0.4)",
              fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1.5px",
              textTransform: "uppercase", cursor: busy ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >⬆ Import File</button>
          <button
            onClick={exportToFile}
            disabled={busy}
            title="Download the current review state as a .json file you can hand to anyone, on any device or account"
            style={{
              padding: "5px 12px", borderRadius: "4px",
              background: "rgba(99,179,237,0.1)", color: "#63B3ED",
              border: "1px solid rgba(99,179,237,0.4)",
              fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1.5px",
              textTransform: "uppercase", cursor: busy ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >⬇ Export File</button>
          <button
            onClick={() => onSaveAs(null)}
            disabled={busy}
            style={{
              padding: "5px 12px", borderRadius: "4px",
              background: "rgba(52,211,153,0.12)", color: "#34D399",
              border: "1px solid rgba(52,211,153,0.4)",
              fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1.5px",
              textTransform: "uppercase", cursor: busy ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >+ Save Current as New</button>
          <button
            onClick={onClose}
            className="cge-modal-close"
            style={{
              padding: "4px 10px", borderRadius: "4px",
              background: "rgba(245,240,232,0.04)", color: "#F5F0E8",
              border: "1px solid rgba(245,240,232,0.1)",
              fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit",
            }}
          >Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {err && (
            <div style={{ padding: "1rem", color: "#FB7185", fontSize: "0.7rem" }}>
              Couldn't reach the Repl: {err}
            </div>
          )}
          {!err && items.length === 0 && (
            <div style={{ padding: "3rem 1rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.75rem", lineHeight: 1.6 }}>
              No saved sessions yet.<br />
              Hit <strong>+ Save Current as New</strong> in the header to capture your work.
            </div>
          )}
          {items.map(s => (
            <div key={s.name}>
            <div
              onClick={() => onPickLoad(s.name)}
              title={`${s.name} · ${s.eventCount} events total · ${s.vettedCount || 0} vetted · ${s.approvalCount} selected${s.pendingCount ? ` · ${s.pendingCount} in triage` : ""}`}
              style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "12px 14px", marginBottom: "6px",
                background: "rgba(245,240,232,0.04)",
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: "5px",
                cursor: busy ? "wait" : "pointer",
                fontSize: "0.75rem",
              }}
            >
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </div>
                <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "0.5px", textTransform: "uppercase", marginTop: "3px" }}>
                  {s.eventCount} event{s.eventCount === 1 ? "" : "s"} total · {s.vettedCount || 0} ✓ vetted · {s.approvalCount} ☑ selected{s.pendingCount ? ` · ${s.pendingCount} in triage` : ""} · saved {formatWhen(s.savedAt || s.mtime)}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onSaveAs(s.name); }}
                title="Overwrite this session with the current state"
                disabled={busy}
                style={{
                  padding: "5px 10px",
                  background: "rgba(99,179,237,0.08)", color: "#63B3ED",
                  border: "1px solid rgba(99,179,237,0.3)",
                  borderRadius: "4px", fontSize: "0.55rem",
                  cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
                  letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700,
                }}
              >Overwrite</button>
              <button
                onClick={(e) => onRemove(s.name, e)}
                title="Delete this session"
                disabled={busy}
                style={{
                  padding: "5px 10px",
                  background: "rgba(251,113,133,0.08)", color: "#FB7185",
                  border: "1px solid rgba(251,113,133,0.3)",
                  borderRadius: "4px", fontSize: "0.55rem",
                  cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
                  letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700,
                }}
              >Delete</button>
              <button
                onClick={(e) => toggleBackups(s.name, e)}
                title="Automatic backups — restore this session to how it looked earlier"
                disabled={busy}
                style={{
                  padding: "5px 10px",
                  background: backupsFor === s.name ? "rgba(229,188,79,0.18)" : "rgba(229,188,79,0.08)",
                  color: "#E5BC4F",
                  border: "1px solid rgba(229,188,79,0.35)",
                  borderRadius: "4px", fontSize: "0.55rem",
                  cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
                  letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700,
                }}
              >🕒 Backups</button>
            </div>
            {backupsFor === s.name && (
              <div style={{
                margin: "0 0 10px 14px",
                padding: "10px 12px",
                background: "rgba(229,188,79,0.04)",
                border: "1px solid rgba(229,188,79,0.18)",
                borderRadius: "5px",
              }}>
                <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 8 }}>
                  Automatic backups — newest first. Restoring makes a backup of the current state first, so you can always undo.
                </div>
                {backupsLoading && (
                  <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.5)" }}>Loading backups…</div>
                )}
                {!backupsLoading && backups.length === 0 && (
                  <div style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.5)" }}>
                    No backups yet — snapshots are taken automatically as the session changes (about one every 5 minutes of activity).
                  </div>
                )}
                {!backupsLoading && backups.map(b => (
                  <div key={b.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 4px",
                    borderTop: "1px solid rgba(245,240,232,0.05)",
                    fontSize: "0.65rem",
                  }}>
                    <div style={{ flex: 1 }}>
                      <strong>{new Date(b.snappedAt).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong>
                      <span style={{ color: "rgba(245,240,232,0.55)", marginLeft: 8 }}>
                        {b.pendingCount} in triage · {b.vettedCount} ✓ vetted{b.eventCount ? ` · ${b.eventCount} events` : ""}
                      </span>
                    </div>
                    <button
                      onClick={(e) => onRestoreBackup(s.name, b, e)}
                      disabled={busy}
                      style={{
                        padding: "4px 10px",
                        background: "rgba(52,211,153,0.1)", color: "#34D399",
                        border: "1px solid rgba(52,211,153,0.35)",
                        borderRadius: "4px", fontSize: "0.55rem",
                        cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
                        letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700,
                      }}
                    >Restore</button>
                  </div>
                ))}
              </div>
            )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
