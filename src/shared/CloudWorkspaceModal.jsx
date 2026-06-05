import { useEffect, useState } from "react";
import { cloudList, cloudDelete } from "./cloudSync.js";

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

// Modal that lists every cloud-saved workspace and lets the user pick one
// to load (or delete one). Loading replaces local state — the caller is
// responsible for the destructive confirmation prompt.
export function CloudWorkspaceModal({ open, onClose, onPick }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const reload = async () => {
    try {
      const list = await cloudList();
      setItems(list);
      setErr(null);
    } catch (e) {
      setErr(e.message || String(e));
      setItems([]);
    }
  };

  useEffect(() => { if (open) reload(); }, [open]);

  if (!open) return null;

  const remove = async (name, e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${name} from the Repl?\n\nThis can't be undone.`)) return;
    setBusy(true);
    try { await cloudDelete(name); await reload(); }
    catch (er) { alert("Delete failed: " + (er.message || er)); }
    finally { setBusy(false); }
  };

  return (
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
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "#C084FC" }}>
            ☁️ Load from Repl
          </div>
          <div className="cge-modal-subtitle" style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
            Workspaces saved by anyone using this Repl
          </div>
          <div style={{ flex: 1 }} />
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
              No workspaces saved here yet.<br />
              Hit ☁️ Save to Repl in the top nav to put one here.
            </div>
          )}
          {items.map(p => (
            <div
              key={p.name}
              onClick={() => !busy && onPick(p)}
              title={`${p.name} · ${formatBytes(p.size)}`}
              style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "10px 12px", marginBottom: "6px",
                background: "rgba(245,240,232,0.04)",
                border: "1px solid rgba(245,240,232,0.08)",
                borderRadius: "5px",
                cursor: busy ? "wait" : "pointer",
                fontSize: "0.75rem",
              }}
            >
              <div style={{ flex: 1, overflow: "hidden" }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "0.5px", textTransform: "uppercase", marginTop: "2px" }}>
                  {formatBytes(p.size)} · saved {formatWhen(p.mtime)}
                </div>
              </div>
              <button
                onClick={(e) => remove(p.name, e)}
                title="Delete this workspace from the Repl"
                style={{
                  padding: "4px 10px",
                  background: "rgba(251,113,133,0.08)", color: "#FB7185",
                  border: "1px solid rgba(251,113,133,0.3)",
                  borderRadius: "4px", fontSize: "0.6rem",
                  cursor: "pointer", fontFamily: "inherit",
                  letterSpacing: "1px", textTransform: "uppercase",
                }}
              >Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
