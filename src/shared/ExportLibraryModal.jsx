import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listExports, loadExportRecord, deleteExport, onExportsChange, exportsUsageBytes } from "./photoLibrary.js";

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

// In-tool export browser. Lists every export from one source tool. Click
// a tile → the host receives the full record's snapshot via onPick and
// applies it in-place (no route navigation needed). Pairs with each
// tool's applySnapshot() helper.
export function ExportLibraryModal({
  open,
  onClose,
  onPick,
  sourceTool,     // "calendar" | "flyer" | "media" — required filter
  title = "Saved exports",
  hint = "Click a saved export to reopen it here.",
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    let urls = [];
    const reload = async () => {
      try {
        const list = await listExports({ sourceTool });
        if (!live) { list.forEach(p => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl)); return; }
        const prev = urls;
        urls = list.map(p => p.thumbUrl).filter(Boolean);
        setItems(list);
        prev.forEach(u => URL.revokeObjectURL(u));
        setTotal(await exportsUsageBytes());
      } catch (e) {
        console.error("Export library load failed:", e);
        if (live) setItems([]);
      }
    };
    reload();
    const off = onExportsChange(reload);
    return () => { live = false; off(); urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [open, sourceTool]);

  const pick = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      const rec = await loadExportRecord(id);
      if (!rec || !rec.snapshot) {
        alert("This export wasn't saved with edit data. Re-export to capture it.");
        return;
      }
      onPick(rec.snapshot, rec);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this export from the library?")) return;
    await deleteExport(id);
  };

  if (!open) return null;

  // React Portal: render directly into <body>, escaping any ancestor
  // stacking context / transform / overflow rule that could trap the
  // position:fixed overlay below the page content.
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
          width: "min(960px, 100%)",
          maxHeight: "85vh",
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
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "#E5BC4F" }}>
            {title}
          </div>
          <div className="cge-modal-subtitle" style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {hint}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {items.length} export{items.length === 1 ? "" : "s"} · {formatBytes(total)}
          </div>
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
          {items.length === 0 ? (
            <div style={{ padding: "3rem 1rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.75rem", lineHeight: 1.6 }}>
              No {sourceTool} exports archived yet.<br />
              Download a slide/PNG/ZIP from this tool and a copy will land here.
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              gap: "10px",
            }}>
              {items.map(p => (
                <div
                  key={p.id}
                  onClick={() => p.hasSnapshot ? pick(p.id) : alert("This export wasn't saved with edit data. Re-export to capture it.")}
                  title={`${p.name} · ${formatBytes(p.bytes)}${p.hasSnapshot ? "" : " · no edit data"}`}
                  style={{
                    position: "relative",
                    background: "#000",
                    border: `1px solid ${p.hasSnapshot ? "rgba(245,240,232,0.1)" : "rgba(245,240,232,0.05)"}`,
                    borderRadius: "5px",
                    overflow: "hidden",
                    cursor: busy ? "wait" : (p.hasSnapshot ? "pointer" : "not-allowed"),
                    aspectRatio: "1 / 1",
                    opacity: p.hasSnapshot ? 1 : 0.55,
                  }}
                >
                  {p.thumbUrl ? (
                    <img src={p.thumbUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{
                      width: "100%", height: "100%",
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      background: "linear-gradient(135deg, #1a1a1a, #0d0d0d)",
                      color: "rgba(245,240,232,0.5)", fontFamily: "'Syne',sans-serif",
                      padding: "10px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: "2rem" }}>{p.mime?.includes("zip") ? "🗜" : p.mime?.includes("webm") ? "🎬" : "📄"}</div>
                      <div style={{ fontSize: "0.5rem", letterSpacing: "1px", textTransform: "uppercase", marginTop: "6px" }}>
                        {p.kind === "archive" ? "Archive" : "File"}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={(e) => remove(p.id, e)}
                    title="Delete from library"
                    style={{
                      position: "absolute", top: 4, right: 4,
                      width: 22, height: 22, borderRadius: 4,
                      background: "rgba(0,0,0,0.75)", color: "#FB7185",
                      border: "1px solid rgba(251,113,133,0.4)",
                      fontSize: "0.7rem", cursor: "pointer", padding: 0,
                      fontFamily: "inherit", lineHeight: 1,
                    }}
                  >×</button>
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    padding: "4px 6px",
                    background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
                    fontSize: "0.5rem", color: "#F5F0E8",
                    letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700,
                    display: "flex", justifyContent: "space-between",
                  }}>
                    <span>{p.sourceMode || p.kind}</span>
                    <span style={{ color: "rgba(245,240,232,0.5)" }}>{formatWhen(p.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
