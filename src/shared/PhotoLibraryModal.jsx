import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { listPhotos, loadPhotoBlob, loadPhotoAsImage, loadPhotoAsDataUrl, deletePhotoAndNotify, deletePhotosAndNotify, onLibraryChange, usageBytes, countLegacyLibrary, migrateLegacyToCloud, savePhotoAndNotify } from "./photoLibrary.js";

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
  // URL import panel — collapsible section above the grid. Textarea takes
  // any number of URLs (one per line). Server fetches each; image URLs
  // save directly, HTML URLs surface their <img> tags in a picker.
  const [urlOpen, setUrlOpen] = useState(false);
  const [urlText, setUrlText] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlProgress, setUrlProgress] = useState(null); // null | { done, total, msg }
  const [scrapeQueue, setScrapeQueue] = useState([]); // [{ sourceUrl, images: [], picked: Set }]
  // Paste-from-clipboard status — shows a brief toast after a clipboard
  // image saves so the user knows it landed without scrolling to find
  // the new tile.
  const [pasteToast, setPasteToast] = useState(null); // null | { msg, error }
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

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

    // Clipboard paste — listen at the document level while the modal is
    // open. Skip when the user is pasting text into an input / textarea
    // (e.g. the URL panel) so we don't hijack their input. Multiple
    // images in one clipboard event all save.
    const onPaste = async (e) => {
      const targetIsTextField =
        e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = [];
      for (const it of items) {
        if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
          imageItems.push(it);
        }
      }
      if (imageItems.length === 0) return;
      // If the paste is going into a text field AND the clipboard has
      // text too, let the field handle the text. We only steal the
      // paste when there's an image to save.
      if (targetIsTextField) {
        // Bail unless this is purely image content (no text companion).
        const hasText = Array.from(items).some(x => x.kind === "string");
        if (hasText) return;
      }
      e.preventDefault();
      // Show progress toast IMMEDIATELY — uploading a screenshot can take
      // 3-10 seconds (PNG → base64 → POST to Repl filesystem) and without
      // feedback the user thinks the paste didn't register.
      if (live) {
        setPasteToast({
          msg: `📋 Saving ${imageItems.length} image${imageItems.length === 1 ? "" : "s"}… (this can take a few seconds for big screenshots)`,
          error: false,
        });
      }
      try {
        let savedCount = 0;
        for (const it of imageItems) {
          const blob = it.getAsFile();
          if (!blob) continue;
          // Update toast per-image so the user sees progress during a
          // multi-image paste.
          if (live && imageItems.length > 1) {
            setPasteToast({
              msg: `📋 Saving ${savedCount + 1}/${imageItems.length} (${(blob.size / 1024 / 1024).toFixed(1)} MB)…`,
              error: false,
            });
          }
          const ext = (blob.type.split("/")[1] || "png").split(";")[0];
          const name = blob.name || `pasted-${Date.now()}-${savedCount}.${ext}`;
          await savePhotoAndNotify(
            new File([blob], name, { type: blob.type }),
            { sourceTool: "import", sourceMode: "paste" }
          );
          savedCount++;
        }
        if (savedCount > 0 && live) {
          setPasteToast({ msg: `✓ Pasted ${savedCount} image${savedCount === 1 ? "" : "s"} → saved`, error: false });
          setTimeout(() => { if (live) setPasteToast(null); }, 2500);
        } else if (live) {
          // Paste fired but no image got through (rare — maybe an empty
          // image item from a weird app). Tell the user.
          setPasteToast({ msg: "No image data found on the clipboard.", error: true });
          setTimeout(() => { if (live) setPasteToast(null); }, 2500);
        }
      } catch (err) {
        console.warn("Paste save failed:", err);
        if (live) {
          setPasteToast({ msg: `Paste failed: ${err.message || err}`, error: true });
          setTimeout(() => { if (live) setPasteToast(null); }, 4500);
        }
      }
    };
    document.addEventListener("paste", onPaste);

    return () => {
      live = false;
      off();
      revokeOnUnmount.forEach(u => URL.revokeObjectURL(u));
      document.removeEventListener("paste", onPaste);
    };
  }, [open, filter]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setDeleting(false);
    }
  }, [open]);

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

  const toggleSelect = (id, e) => {
    if (e) e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedVisible = photos.filter((p) => selected.has(p.id));

  const setVisibleSelected = (on) => {
    setSelected(on ? new Set(photos.map((p) => p.id)) : new Set());
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!confirm("Delete this photo from the library?")) return;
    await deletePhotoAndNotify(id);
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const removeSelected = async () => {
    const ids = selectedVisible.map((p) => p.id);
    if (!ids.length || deleting) return;
    if (!confirm(`Delete ${ids.length} photo${ids.length === 1 ? "" : "s"} from the library? This can't be undone.`)) return;
    setDeleting(true);
    const gone = new Set(ids);
    setPhotos((prev) => prev.filter((p) => !gone.has(p.id)));
    setSelected(new Set());
    try {
      await deletePhotosAndNotify(ids);
    } catch (err) {
      alert("Couldn't delete those photos: " + (err.message || err));
    } finally {
      setDeleting(false);
    }
  };

  // === URL IMPORT ===
  // Fetch a list of URLs serially through /api/library/import-url. Each
  // image URL → save to library. Each HTML URL → queue its scraped
  // <img> srcs into a per-source picker so the user can choose which to
  // import. Progress reported per URL processed.
  const dataUrlToBlob = (b64, mime) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };

  const importOneUrl = async (url) => {
    const res = await fetch("/api/library/import-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); if (j?.error) msg += ` — ${j.error}`; } catch {}
      throw new Error(msg);
    }
    return res.json();
  };

  const runUrlImport = async () => {
    if (urlBusy) return;
    const lines = urlText.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      alert("Paste at least one URL (one per line).");
      return;
    }
    setUrlBusy(true);
    setUrlProgress({ done: 0, total: lines.length, msg: "" });
    const newScrapes = [];
    let imported = 0;
    let failed = 0;
    for (let i = 0; i < lines.length; i++) {
      const url = lines[i];
      setUrlProgress({ done: i, total: lines.length, msg: url.slice(0, 70) });
      try {
        const result = await importOneUrl(url);
        if (result.kind === "image") {
          const blob = dataUrlToBlob(result.data, result.mime);
          // Tag with sourceTool="import" so the user can filter to recently
          // imported items in the library grid.
          await savePhotoAndNotify(
            new File([blob], result.name || "imported.jpg", { type: result.mime }),
            { sourceTool: "import", sourceMode: "url" }
          );
          imported++;
        } else if (result.kind === "html") {
          if (Array.isArray(result.images) && result.images.length) {
            newScrapes.push({
              sourceUrl: result.sourceUrl,
              images: result.images,
              picked: new Set(),
            });
          }
        }
      } catch (err) {
        failed++;
        console.warn(`Import failed for ${url}:`, err);
      }
    }
    setUrlProgress(null);
    setUrlBusy(false);
    if (newScrapes.length) {
      // Surface the pickers; keep the textarea content in case the user
      // wants to re-run a subset.
      setScrapeQueue(prev => [...prev, ...newScrapes]);
    } else {
      setUrlText("");
    }
    const parts = [];
    if (imported) parts.push(`${imported} image${imported === 1 ? "" : "s"} imported`);
    if (newScrapes.length) parts.push(`${newScrapes.reduce((s, x) => s + x.images.length, 0)} found on ${newScrapes.length} webpage${newScrapes.length === 1 ? "" : "s"} — pick which to keep`);
    if (failed) parts.push(`${failed} failed`);
    if (parts.length) {
      // Tiny non-blocking status — keep it lightweight.
      console.log("URL import done:", parts.join(" · "));
    }
  };

  const togglePicked = (idx, url) => {
    setScrapeQueue(prev => prev.map((q, i) => {
      if (i !== idx) return q;
      const next = new Set(q.picked);
      if (next.has(url)) next.delete(url); else next.add(url);
      return { ...q, picked: next };
    }));
  };

  const importPickedScrape = async (idx) => {
    if (urlBusy) return;
    const queue = scrapeQueue[idx];
    if (!queue || queue.picked.size === 0) return;
    const urls = Array.from(queue.picked);
    setUrlBusy(true);
    setUrlProgress({ done: 0, total: urls.length, msg: "" });
    let ok = 0;
    for (let i = 0; i < urls.length; i++) {
      setUrlProgress({ done: i, total: urls.length, msg: urls[i].slice(0, 70) });
      try {
        const r = await importOneUrl(urls[i]);
        if (r.kind === "image") {
          const blob = dataUrlToBlob(r.data, r.mime);
          await savePhotoAndNotify(
            new File([blob], r.name || "scraped.jpg", { type: r.mime }),
            { sourceTool: "import", sourceMode: "scrape" }
          );
          ok++;
        }
      } catch (err) {
        console.warn("Scrape pick failed:", err);
      }
    }
    setUrlProgress(null);
    setUrlBusy(false);
    setScrapeQueue(prev => prev.filter((_, i) => i !== idx));
  };

  const dismissScrape = (idx) => setScrapeQueue(prev => prev.filter((_, i) => i !== idx));

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
          position: "relative",  // anchor for the paste-toast
        }}
      >
        {/* Header */}
        <div className="cge-modal-header" style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(245,240,232,0.08)",
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
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
          {photos.length > 0 && (
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setVisibleSelected(true)}
                style={{
                  padding: "4px 8px", borderRadius: "4px",
                  background: "rgba(245,240,232,0.04)", color: "rgba(245,240,232,0.7)",
                  border: "1px solid rgba(245,240,232,0.1)",
                  fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px",
                  textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
                }}
              >Select all</button>
              <button
                type="button"
                onClick={() => setVisibleSelected(false)}
                disabled={selectedVisible.length === 0}
                style={{
                  padding: "4px 8px", borderRadius: "4px",
                  background: "rgba(245,240,232,0.04)", color: "rgba(245,240,232,0.7)",
                  border: "1px solid rgba(245,240,232,0.1)",
                  fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px",
                  textTransform: "uppercase", cursor: selectedVisible.length === 0 ? "not-allowed" : "pointer", fontFamily: "inherit",
                  opacity: selectedVisible.length === 0 ? 0.45 : 1,
                }}
              >Select none</button>
              <button
                type="button"
                onClick={removeSelected}
                disabled={deleting || selectedVisible.length === 0}
                title="Delete the ticked photos from the library"
                style={{
                  padding: "4px 8px", borderRadius: "4px",
                  background: "rgba(251,113,133,0.08)", color: "#FB7185",
                  border: "1px solid rgba(251,113,133,0.4)",
                  fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px",
                  textTransform: "uppercase",
                  cursor: (deleting || selectedVisible.length === 0) ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  opacity: selectedVisible.length === 0 ? 0.45 : 1,
                }}
              >{deleting ? "Deleting…" : `Delete selected${selectedVisible.length ? ` (${selectedVisible.length})` : ""}`}</button>
            </div>
          )}
          <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {photos.length} photo{photos.length === 1 ? "" : "s"} · {formatBytes(total)}
          </div>
          <div title="Tip: copy any image (Cmd+C / Ctrl+C) and press Cmd+V / Ctrl+V here to save it to the library directly" style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            📋 paste image to add
          </div>
          <button
            onClick={() => {
              // Force-refresh: invalidate the client-side cache by
              // changing the filter pointer briefly. Cheap and uses the
              // existing reload machinery.
              const f = filter; setFilter("__refreshing__"); setTimeout(() => setFilter(f), 0);
            }}
            title="Re-fetch the library from the Repl — useful if a recent paste / import isn't showing yet"
            style={{
              padding: "4px 10px", borderRadius: "4px",
              background: "rgba(245,240,232,0.04)", color: "rgba(245,240,232,0.7)",
              border: "1px solid rgba(245,240,232,0.1)",
              fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1px",
              textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
            }}
          >↻ Refresh</button>
          <button
            onClick={() => setUrlOpen(v => !v)}
            title="Paste image URLs (or webpage URLs to scrape <img> tags) and import directly to the library"
            style={{
              padding: "4px 10px", borderRadius: "4px",
              background: urlOpen ? "rgba(99,179,237,0.18)" : "rgba(99,179,237,0.06)",
              color: "#63B3ED",
              border: `1px solid ${urlOpen ? "#63B3ED" : "rgba(99,179,237,0.3)"}`,
              fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1px",
              textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
            }}
          >🔗 Import URL</button>
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

        {/* URL import panel — collapsible. Single textarea takes one or
            many URLs (one per line, commas also work). Image URLs save
            directly; HTML URLs surface their <img> tags in a picker. */}
        {urlOpen && (
          <div style={{
            padding: "12px 18px",
            background: "rgba(99,179,237,0.04)",
            borderBottom: "1px solid rgba(99,179,237,0.15)",
          }}>
            <div style={{ fontSize: "0.55rem", color: "#63B3ED", letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700, marginBottom: "6px" }}>
              🔗 Import from URL · paste one image URL or many (one per line · webpages get their images scraped)
            </div>
            <textarea
              value={urlText}
              onChange={e => setUrlText(e.target.value)}
              placeholder={"https://example.com/photo.jpg\nhttps://venue.com/gallery (← webpage, will scrape images)\nhttps://other.com/another.png"}
              disabled={urlBusy}
              style={{
                width: "100%",
                minHeight: "70px",
                maxHeight: "200px",
                padding: "8px 10px",
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(245,240,232,0.1)",
                borderRadius: "4px",
                color: "#F5F0E8",
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: "0.7rem",
                resize: "vertical",
                outline: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
              <button
                onClick={runUrlImport}
                disabled={urlBusy || !urlText.trim()}
                style={{
                  padding: "6px 12px",
                  background: urlBusy ? "rgba(99,179,237,0.4)" : "#63B3ED",
                  color: "#000",
                  border: "none",
                  borderRadius: "4px",
                  fontSize: "0.65rem", fontWeight: 700, letterSpacing: "1.5px",
                  textTransform: "uppercase",
                  cursor: urlBusy ? "wait" : (urlText.trim() ? "pointer" : "not-allowed"),
                  fontFamily: "'Syne', sans-serif",
                }}
              >{urlBusy ? "Fetching…" : "Import"}</button>
              {urlProgress && (
                <div style={{ flex: 1, fontSize: "0.6rem", color: "rgba(245,240,232,0.65)", display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ flex: 1, height: "4px", background: "rgba(245,240,232,0.08)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: `${(urlProgress.done / urlProgress.total) * 100}%`, height: "100%", background: "#63B3ED", transition: "width 120ms" }} />
                  </div>
                  <span style={{ whiteSpace: "nowrap" }}>{urlProgress.done}/{urlProgress.total}</span>
                  {urlProgress.msg && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(245,240,232,0.4)", fontFamily: "ui-monospace, monospace", fontSize: "0.55rem" }}>{urlProgress.msg}</span>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Per-webpage scrape pickers — one panel per HTML URL that came
            back with <img> tags. Click thumbnails to select, hit
            "Import N" to save the selected images. */}
        {scrapeQueue.length > 0 && (
          <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(245,240,232,0.08)" }}>
            {scrapeQueue.map((q, qi) => (
              <div key={qi} style={{ marginBottom: "12px", padding: "10px 12px", background: "rgba(192,132,252,0.06)", border: "1px solid rgba(192,132,252,0.2)", borderRadius: "5px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <div style={{ fontSize: "0.55rem", color: "#C084FC", letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700 }}>
                    🌐 Scraped from
                  </div>
                  <div style={{ flex: 1, fontSize: "0.65rem", color: "rgba(245,240,232,0.7)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>
                    {q.sourceUrl}
                  </div>
                  <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)" }}>
                    {q.picked.size} / {q.images.length} picked
                  </div>
                  <button
                    onClick={() => importPickedScrape(qi)}
                    disabled={urlBusy || q.picked.size === 0}
                    style={{
                      padding: "4px 10px",
                      background: q.picked.size > 0 ? "rgba(52,211,153,0.18)" : "rgba(245,240,232,0.04)",
                      color: q.picked.size > 0 ? "#34D399" : "rgba(245,240,232,0.3)",
                      border: `1px solid ${q.picked.size > 0 ? "#34D399" : "rgba(245,240,232,0.1)"}`,
                      borderRadius: "4px",
                      fontSize: "0.55rem", fontWeight: 700, letterSpacing: "1px",
                      textTransform: "uppercase",
                      cursor: q.picked.size > 0 && !urlBusy ? "pointer" : "not-allowed",
                      fontFamily: "inherit",
                    }}
                  >Import {q.picked.size}</button>
                  <button
                    onClick={() => dismissScrape(qi)}
                    style={{
                      padding: "4px 8px",
                      background: "rgba(251,113,133,0.06)", color: "#FB7185",
                      border: "1px solid rgba(251,113,133,0.25)",
                      borderRadius: "4px", fontSize: "0.55rem",
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >×</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: "6px", maxHeight: "240px", overflowY: "auto" }}>
                  {q.images.slice(0, 80).map((src, i) => {
                    const picked = q.picked.has(src);
                    return (
                      <div
                        key={i}
                        onClick={() => togglePicked(qi, src)}
                        title={src}
                        style={{
                          position: "relative",
                          aspectRatio: "1 / 1",
                          background: "#000",
                          border: picked ? "2px solid #34D399" : "1px solid rgba(245,240,232,0.1)",
                          borderRadius: "4px",
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                      >
                        <img
                          src={src}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: picked ? 1 : 0.7 }}
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                        />
                        {picked && (
                          <div style={{
                            position: "absolute", top: 2, right: 2,
                            width: 18, height: 18, borderRadius: 3,
                            background: "#34D399", color: "#000",
                            fontSize: "0.7rem", fontWeight: 800,
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>✓</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {q.images.length > 80 && (
                  <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", marginTop: "4px", textAlign: "center" }}>
                    Showing first 80 of {q.images.length} — refine the URL or visit a specific gallery page for the rest.
                  </div>
                )}
              </div>
            ))}
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
              {photos.map(p => {
                const isSel = selected.has(p.id);
                return (
                <div
                  key={p.id}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) toggleSelect(p.id, e);
                    else pick(p.id);
                  }}
                  title={`${p.name} · ${p.width}×${p.height} · ${formatBytes(p.bytes)}`}
                  style={{
                    position: "relative",
                    background: "#000",
                    border: `1px solid ${isSel ? "#E5BC4F" : "rgba(245,240,232,0.1)"}`,
                    boxShadow: isSel ? "inset 0 0 0 2px #E5BC4F" : "none",
                    borderRadius: "5px",
                    overflow: "hidden",
                    cursor: busy ? "wait" : "pointer",
                    aspectRatio: "1 / 1",
                  }}
                >
                  <img
                    src={p.thumbUrl}
                    alt={p.name}
                    loading="lazy"
                    decoding="async"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  <label
                    title={isSel ? "Unselect" : "Select for bulk delete"}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: "absolute", top: 4, left: 4,
                      width: 24, height: 24, borderRadius: 4,
                      background: isSel ? "#E5BC4F" : "rgba(0,0,0,0.75)",
                      border: `1px solid ${isSel ? "#E5BC4F" : "rgba(245,240,232,0.35)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", margin: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={(e) => toggleSelect(p.id, e)}
                      style={{ accentColor: "#E5BC4F", width: 14, height: 14, margin: 0, cursor: "pointer" }}
                    />
                  </label>
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
                );
              })}
            </div>
          )}
        </div>
        {/* Paste toast — bottom-center inside the modal so it's anchored
            to the library context rather than the global viewport. */}
        {pasteToast && (
          <div style={{
            position: "absolute",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 16px",
            background: pasteToast.error ? "rgba(251,113,133,0.95)" : "rgba(52,211,153,0.95)",
            color: "#0a0a0a",
            borderRadius: 6,
            fontSize: "0.7rem",
            fontWeight: 700,
            letterSpacing: "0.5px",
            boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
            pointerEvents: "none",
            fontFamily: "'DM Sans', sans-serif",
            zIndex: 1,
          }}>
            {pasteToast.msg}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
