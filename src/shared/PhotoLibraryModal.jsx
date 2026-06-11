import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listPhotos, loadPhotoBlob, loadPhotoAsImage, loadPhotoAsDataUrl, deletePhotoAndNotify, onLibraryChange, usageBytes, countLegacyLibrary, migrateLegacyToCloud } from "./photoLibrary.js";

const TOOLS = [
  { key: "",         label: "All" },
  { key: "media",    label: "Media" },
  { key: "calendar", label: "Calendar" },
  { key: "flyer",    label: "Flyer" },
];

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

// Modal picker — list every saved photo, click to pick. The host tool tells
// us which output shape it wants (Image / Blob / data URL) via `outputAs`.
export function PhotoLibraryModal({ open, onClose, onPick, outputAs = "image", initialFilter = "" }) {
  const [photos, setPhotos] = useState([]);
  const [filter, setFilter] = useState(initialFilter);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  // Legacy migration UX — see the bottom of photoLibrary.js. We check on
  // open and offer to upload anything sitting in the per-browser IndexedDB
  // to the cloud library so the user doesn't lose pre-cloud uploads.
  const [legacy, setLegacy] = useState({ photos: 0, exports: 0 });
  const [migrateProgress, setMigrateProgress] = useState(null); // null | {done, total}
  const [migrateBusy, setMigrateBusy] = useState(false);

  // Re-query on open, on filter change, and whenever the library changes
  // (a parallel save from another tab / a delete from the grid).
  useEffect(() => {
    if (!open) return;
    let live = true;
    let revokeOnUnmount = [];
    const reload = async () => {
      try {
        const list = await listPhotos(filter ? { sourceTool: filter } : {});
        if (!live) {
          list.forEach(p => URL.revokeObjectURL(p.thumbUrl));
          return;
        }
        // Revoke previous thumbs after we install the new ones
        const prev = revokeOnUnmount;
        revokeOnUnmount = list.map(p => p.thumbUrl);
        setPhotos(list);
        prev.forEach(u => URL.revokeObjectURL(u));
        setTotal(await usageBytes());
      } catch (e) {
        console.error("Photo library load failed:", e);
        if (live) setPhotos([]);
      }
    };
    reload();
    const off = onLibraryChange(reload);
    // Probe the legacy IndexedDB whenever the modal opens. Cheap
    // (just counts) and answers in <50ms even on a large library.
    countLegacyLibrary().then(c => { if (live) setLegacy(c); });
    return () => {
      live = false;
      off();
      revokeOnUnmount.forEach(u => URL.revokeObjectURL(u));
    };
  }, [open, filter]);

  const runMigration = async () => {
    if (migrateBusy) return;
    const total = legacy.photos + legacy.exports;
    if (!confirm(
      `Upload ${legacy.photos} photo${legacy.photos === 1 ? "" : "s"} + ` +
      `${legacy.exports} export${legacy.exports === 1 ? "" : "s"} from this browser's local cache to the cloud library?\n\n` +
      `After upload, the local cache will be cleared (the cloud is now the source of truth). ` +
      `Other browsers / accounts on the Repl URL will see these photos too.`
    )) return;
    setMigrateBusy(true);
    setMigrateProgress({ done: 0, total });
    try {
      const result = await migrateLegacyToCloud({
        onProgress: (p) => setMigrateProgress({ done: p.done, total: p.total }),
        clearAfter: true,
      });
      alert(
        `Migrated ${result.migrated} of ${result.total} item${result.total === 1 ? "" : "s"}.` +
        (result.errors > 0 ? `\n\n${result.errors} item${result.errors === 1 ? "" : "s"} failed (see console).` : "")
      );
      setLegacy({ photos: 0, exports: 0 });
    } catch (e) {
      alert("Migration failed: " + (e.message || e));
    } finally {
      setMigrateBusy(false);
      setMigrateProgress(null);
    }
  };

  const pick = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      let payload;
      if (outputAs === "blob")    payload = await loadPhotoBlob(id);
      else if (outputAs === "dataUrl") payload = await loadPhotoAsDataUrl(id);
      else                        payload = await loadPhotoAsImage(id);
      if (payload) {
        onPick(payload, id);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this photo from the library?")) return;
    await deletePhotoAndNotify(id);
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
        {/* Header */}
        <div className="cge-modal-header" style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(245,240,232,0.08)",
          display: "flex", alignItems: "center", gap: "12px",
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "#E5BC4F" }}>
            Photo Library
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            {TOOLS.map(t => (
              <button
                key={t.key}
                onClick={() => setFilter(t.key)}
                style={{
                  padding: "4px 10px", borderRadius: "4px",
                  background: filter === t.key ? "rgba(229,188,79,0.18)" : "rgba(245,240,232,0.04)",
                  color: filter === t.key ? "#E5BC4F" : "rgba(245,240,232,0.55)",
                  border: `1px solid ${filter === t.key ? "rgba(229,188,79,0.5)" : "rgba(245,240,232,0.1)"}`,
                  fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1px",
                  textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
                }}
              >{t.label}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {photos.length} photo{photos.length === 1 ? "" : "s"} · {formatBytes(total)}
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

        {/* Legacy migration banner — only when the per-browser IndexedDB
            still has unmigrated records. Disappears after the user clicks
            Migrate (or after a fresh-from-clouds visit on a new browser). */}
        {(legacy.photos + legacy.exports) > 0 && (
          <div style={{
            padding: "10px 18px",
            background: "rgba(192,132,252,0.08)",
            borderBottom: "1px solid rgba(192,132,252,0.18)",
            display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, fontSize: "0.7rem", color: "rgba(245,240,232,0.8)", lineHeight: 1.4 }}>
              <strong style={{ color: "#C084FC", letterSpacing: "1px", textTransform: "uppercase", fontSize: "0.6rem" }}>
                Legacy local cache
              </strong>{" "}
              · {legacy.photos} photo{legacy.photos === 1 ? "" : "s"} + {legacy.exports} export{legacy.exports === 1 ? "" : "s"} are sitting only in <em>this browser's</em> IndexedDB. Upload them to the cloud so every account on the Repl URL can see them.
              {migrateProgress && (
                <div style={{ fontSize: "0.6rem", color: "#C084FC", marginTop: "4px" }}>
                  Migrating · {migrateProgress.done} / {migrateProgress.total}
                </div>
              )}
            </div>
            <button
              onClick={runMigration}
              disabled={migrateBusy}
              style={{
                padding: "6px 14px", borderRadius: "4px",
                background: "rgba(192,132,252,0.18)", color: "#C084FC",
                border: "1px solid rgba(192,132,252,0.5)",
                fontSize: "0.65rem", fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase", cursor: migrateBusy ? "wait" : "pointer",
                fontFamily: "'Syne', sans-serif",
              }}
            >{migrateBusy ? "Uploading…" : "📤 Migrate → Cloud"}</button>
          </div>
        )}

        {/* Grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {photos.length === 0 ? (
            <div style={{ padding: "3rem 1rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.75rem", lineHeight: 1.6 }}>
              No photos in the library{filter ? ` from ${filter}` : ""} yet.<br />
              Upload a photo in any tool and it'll show up here automatically.
            </div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: "10px",
            }}>
              {photos.map(p => (
                <div
                  key={p.id}
                  onClick={() => pick(p.id)}
                  title={`${p.name} · ${p.width}×${p.height} · ${formatBytes(p.bytes)}`}
                  style={{
                    position: "relative",
                    background: "#000",
                    border: "1px solid rgba(245,240,232,0.1)",
                    borderRadius: "5px",
                    overflow: "hidden",
                    cursor: busy ? "wait" : "pointer",
                    aspectRatio: "1 / 1",
                  }}
                >
                  <img
                    src={p.thumbUrl}
                    alt={p.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
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
                    <span>{p.sourceTool || "—"}{p.sourceMode ? ` · ${p.sourceMode}` : ""}</span>
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
