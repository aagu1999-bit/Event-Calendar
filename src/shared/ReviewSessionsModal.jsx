import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listSessions, loadSession, saveSession, deleteSession } from "./reviewSessions.js";

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
}) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

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

  useEffect(() => { if (open) reload(); }, [open]);

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
      if (!confirm(`Overwrite "${overwriteName}" with the current state?`)) return;
    }
    setBusy(true);
    try {
      const cur = getCurrent();
      await saveSession(name, cur);
      await reload();
      alert(`Saved "${name}" with ${cur.events?.length || 0} events + ${Object.keys(cur.approvals || {}).length} approvals.`);
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
          display: "flex", alignItems: "center", gap: "12px",
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "#34D399" }}>
            📁 Review Sessions
          </div>
          <div className="cge-modal-subtitle" style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {mode === "save" ? "Save the current events + approvals as a named snapshot" : "Click a session to load · save the current state as a new snapshot"}
          </div>
          <div style={{ flex: 1 }} />
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
            <div
              key={s.name}
              onClick={() => onPickLoad(s.name)}
              title={`${s.name} · ${s.eventCount} events · ${s.approvalCount} approvals · ${formatBytes(s.size)}`}
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
                  {s.eventCount} event{s.eventCount === 1 ? "" : "s"} · {s.approvalCount} approved · saved {formatWhen(s.savedAt || s.mtime)}
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
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
