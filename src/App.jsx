import { useRef, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import JSZip from "jszip";
import CalendarBuilder from "./pages/CalendarBuilder.jsx";
import NewsletterBuilder from "./pages/NewsletterBuilder.jsx";
import ReelTool from "./pages/ReelTool.jsx";
import FlyerBuilder from "./pages/FlyerBuilder.jsx";
import MediaTool from "./pages/MediaTool.jsx";
import RecapPicker from "./pages/RecapPicker.jsx";
import ReviewQueue from "./pages/ReviewQueue.jsx";
import ReviewBeta from "./pages/ReviewBeta.jsx";
import ScraperReview from "./pages/ScraperReview.jsx";
import Regulars from "./pages/Regulars.jsx";
import BrandKit from "./pages/BrandKit.jsx";
import { useEventsStore } from "./store";
import { exportWorkspace, previewWorkspace, importWorkspace, workspaceFilename } from "./shared/workspaceSync.js";
import { checkCloudAvailable, cloudSave, cloudLoad } from "./shared/cloudSync.js";
import { CloudWorkspaceModal } from "./shared/CloudWorkspaceModal.jsx";
import { saveExport, loadExportRecord, savePhotoAndNotify } from "./shared/photoLibrary.js";
import { readCgeExportTag } from "./shared/pngMetadata.js";
import { useRestoreStore } from "./store";

// Wrap a CSV cell — quote if it contains a comma, quote, or newline.
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Derive a single user-facing URL per event:
//   - if the user typed an explicit ticket/event link, use that
//   - otherwise fall back to instagram.com/<igHandle> when an IG handle exists
//   - else blank
// Lets a CSV consumer (downstream tool, partner spreadsheet, etc.) have ONE
// column to point a click at, instead of having to glue link + igHandle together
// every time.
function deriveDisplayUrl(ev) {
  const link = (ev.link || "").trim();
  if (link) return link;
  const ig = (ev.igHandle || "").trim().replace(/^@+/, "");
  if (ig) return `https://instagram.com/${ig}`;
  return "";
}

function exportEventsCsv(events) {
  if (!events.length) return;
  // `date` (M/D) and `displayUrl` are first-class columns now — older
  // exports were dropping the calendar date entirely (only day-of-week
  // survived) and forcing the user to reassemble a clickable URL from
  // `link` + `igHandle` themselves.
  const cols = ["date", "day", "time", "name", "venue", "area", "region", "type", "link", "igHandle", "displayUrl", "featured", "emoji"];
  const lines = [cols.join(",")];
  for (const ev of events) {
    lines.push(cols.map(c => {
      const v = c === "displayUrl" ? deriveDisplayUrl(ev) : ev[c];
      return csvCell(v);
    }).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const filename = `CGE_events_${stamp}.csv`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  // Archive to the cloud library — same pattern as media/flyer/reel exports.
  // Fire-and-forget: a network blip doesn't block the immediate download.
  saveExport(blob, {
    sourceTool: "events",
    sourceMode: "csv-export",
    name: filename,
    kind: "archive",
  }).catch(err => console.warn("CSV archive failed:", err));
}

// Tool list — single source of truth for the picker. Order is the
// order they appear in the dropdown; current route is auto-derived
// from useLocation so the select label always reflects where you are.
const TOOLS = [
  { path: "/calendar",    label: "Calendar" },
  { path: "/newsletter",  label: "Newsletter" },
  { path: "/reel",        label: "Reel" },
  { path: "/flyer",       label: "Flyer" },
  { path: "/media",       label: "Media" },
  { path: "/recap",       label: "Recap" },
  { path: "/review",      label: "Review" },
  { path: "/review-beta", label: "Review β" },
  { path: "/scraper",     label: "📥 Scraper" },
  { path: "/regulars",    label: "Regulars" },
  { path: "/brand",       label: "Brand" },
];

function ToolPicker() {
  const navigate = useNavigate();
  const location = useLocation();
  // Match exact path first, then prefix (handles /review-beta vs /review)
  const matched = TOOLS.find(t => t.path === location.pathname)
              || TOOLS.find(t => location.pathname.startsWith(t.path + "/"))
              || TOOLS[0];
  return (
    <select
      className="cge-mobile-only"
      value={matched.path}
      onChange={(e) => navigate(e.target.value)}
      style={{
        padding: "6px 26px 6px 10px",
        background: "#111",
        color: "#F5F0E8",
        border: "1px solid rgba(245,240,232,0.12)",
        borderRadius: 4,
        fontSize: "0.72rem",
        fontWeight: 700,
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        cursor: "pointer",
        fontFamily: "'Syne',sans-serif",
        minWidth: 130,
        // Hidden on desktop (cge-mobile-only CSS override flips this
        // to inline-flex below 768px so the dropdown only appears on
        // narrow screens where horizontal NavLink scrolling would hurt).
        display: "none",
        // Custom dropdown arrow (gold) so it's discoverable as
        // interactive — the default browser arrow disappears in dark
        // mode in some browsers.
        appearance: "none",
        WebkitAppearance: "none",
        backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='%23E5BC4F' d='M4 6l4 4 4-4z'/></svg>\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 6px center",
        backgroundSize: "14px",
      }}
      title="Pick a tool"
    >
      {TOOLS.map(t => (
        <option key={t.path} value={t.path} style={{ color: "#000", background: "#fff" }}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

// Workspace menu — collapses Save/Load/Export/Import/Clear into a
// single dropdown so the nav doesn't carry 5-7 button pills (especially
// painful on mobile where the nav already has a tool dropdown + brand
// + event counter). Click "⋯ Workspace" to open; click outside or
// pick an action to close.
function WorkspaceMenu({
  cloudOk, wsBusy, importBusy, eventCount,
  onCloudSave, onOpenCloudPicker, onExportWorkspace,
  onTriggerImportWorkspace, onTriggerImportFromDisk,
  onExportCsv, onClearAll,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    // Also close on Escape
    const keyHandler = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const fire = (fn) => () => { fn?.(); setOpen(false); };

  // One menu item — color sets the accent (gold/blue/purple/red) so the
  // dropdown visually groups by intent (cloud/workspace/import/destructive).
  const item = (label, onClick, color, opts = {}) => (
    <button
      onClick={fire(onClick)}
      disabled={opts.disabled}
      title={opts.title}
      style={{
        display: "block",
        width: "100%",
        padding: "10px 14px",
        background: "transparent",
        color: opts.disabled ? "rgba(245,240,232,0.25)" : color,
        border: "none",
        borderTop: opts.divider ? "1px solid rgba(245,240,232,0.06)" : "none",
        fontSize: "0.65rem",
        fontWeight: 700,
        letterSpacing: "1px",
        textTransform: "uppercase",
        cursor: opts.disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        textAlign: "left",
      }}
      onMouseEnter={(e) => { if (!opts.disabled) e.currentTarget.style.background = "rgba(245,240,232,0.04)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Workspace actions — save, load, import, export, clear"
        style={{
          padding: "4px 10px",
          background: open ? "rgba(229,188,79,0.20)" : "rgba(229,188,79,0.08)",
          border: "1px solid rgba(229,188,79,0.35)",
          borderRadius: "4px",
          color: "#E5BC4F",
          fontSize: "0.6rem",
          letterSpacing: "1px",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: "inherit",
          fontWeight: 700,
        }}
      >⋯ Workspace</button>
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          right: 0,
          marginTop: 4,
          minWidth: 200,
          background: "#0a0a0a",
          border: "1px solid rgba(245,240,232,0.12)",
          borderRadius: 6,
          boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          zIndex: 200,
          overflow: "hidden",
        }}>
          {cloudOk && item(`☁️ ${wsBusy ? "Saving…" : "Save to Repl"}`,    onCloudSave,                   "#63B3ED", { disabled: wsBusy })}
          {cloudOk && item("Load from Repl",                                onOpenCloudPicker,             "#63B3ED", { disabled: wsBusy })}
          {item(`📦 ${wsBusy ? "Exporting…" : "Export workspace"}`,         onExportWorkspace,             "#C084FC", { disabled: wsBusy, divider: cloudOk })}
          {item("Import workspace…",                                        onTriggerImportWorkspace,      "#C084FC", { disabled: wsBusy })}
          {item(`📥 ${importBusy ? "Reading…" : "Import PNG/ZIP from disk"}`, onTriggerImportFromDisk,     "#63B3ED", { disabled: importBusy, divider: true })}
          {eventCount > 0 && item("Export CSV",                             onExportCsv,                   "#E5BC4F", { divider: true })}
          {eventCount > 0 && item("Clear all events",                       onClearAll,                    "#FB7185", {})}
        </div>
      )}
    </div>
  );
}

function Nav() {
  const events = useEventsStore(s => s.events);
  const eventCount = events.length;
  const clear = useEventsStore(s => s.clearEvents);
  const wsFileRef = useRef(null);
  const importFileRef = useRef(null);
  const [wsBusy, setWsBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const setPending = useRestoreStore(s => s.setPending);
  const navigate = useNavigate();
  // Cloud sync is only available when running through `npm run dev` (Node
  // + Vite middleware). In the static deployed build there's no Express
  // server, so we probe /api/health on boot and only show the cloud
  // buttons if it answers.
  const [cloudOk, setCloudOk] = useState(false);
  const [cloudPickOpen, setCloudPickOpen] = useState(false);
  useEffect(() => {
    let live = true;
    checkCloudAvailable().then(ok => { if (live) setCloudOk(ok); });
    return () => { live = false; };
  }, []);

  const onCloudSave = async () => {
    if (wsBusy) return;
    const defaultName = workspaceFilename();
    const userName = prompt(
      "Save this workspace to the Repl as:",
      defaultName.replace(/\.cgework\.zip$/, "")
    );
    if (!userName) return;
    const name = userName.endsWith(".cgework.zip") ? userName
               : userName.endsWith(".zip") ? userName
               : `${userName}.cgework.zip`;
    setWsBusy(true);
    try {
      const blob = await exportWorkspace();
      await cloudSave(name, blob);
      alert(`Saved ${name} to the Repl (${(blob.size / 1024 / 1024).toFixed(1)} MB).`);
    } catch (err) {
      console.error(err);
      alert("Save to Repl failed: " + (err.message || err));
    } finally {
      setWsBusy(false);
    }
  };

  const onCloudPick = async (item) => {
    setCloudPickOpen(false);
    if (wsBusy) return;
    setWsBusy(true);
    try {
      const blob = await cloudLoad(item.name);
      const { manifest, zip, summary } = await previewWorkspace(blob);
      const when = new Date(summary.exportedAt).toLocaleString();
      const msg =
        `Replace this browser's workspace with the contents of\n\n${item.name}\n\n` +
        `Saved on the Repl on ${new Date(item.mtime).toLocaleString()}\n` +
        `Original workspace exported ${when}\n\n` +
        `• ${summary.events} event${summary.events === 1 ? "" : "s"}\n` +
        `• ${summary.regulars} weekly regular${summary.regulars === 1 ? "" : "s"}\n` +
        `• ${summary.photos} saved photo${summary.photos === 1 ? "" : "s"}\n` +
        `• ${summary.exports} saved export${summary.exports === 1 ? "" : "s"}\n\n` +
        `Your current data will be OVERWRITTEN — there's no undo.`;
      if (!confirm(msg)) return;
      await importWorkspace({ manifest, zip });
      alert(`Loaded.\n${summary.events} events · ${summary.regulars} regulars · ${summary.photos} photos · ${summary.exports} exports.\n\nReload the page to be safe.`);
    } catch (err) {
      console.error(err);
      alert("Load from Repl failed: " + (err.message || err));
    } finally {
      setWsBusy(false);
    }
  };

  const onExportWorkspace = async () => {
    if (wsBusy) return;
    setWsBusy(true);
    try {
      const blob = await exportWorkspace();
      const filename = workspaceFilename();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Workspace export failed: " + (err.message || err));
    } finally {
      setWsBusy(false);
    }
  };

  const onImportWorkspace = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || wsBusy) return;
    setWsBusy(true);
    try {
      const { manifest, zip, summary } = await previewWorkspace(file);
      const when = new Date(summary.exportedAt).toLocaleString();
      const msg =
        `Replace this browser's workspace with the contents of\n\n${file.name}\n\n` +
        `From: ${when}\n\n` +
        `• ${summary.events} event${summary.events === 1 ? "" : "s"}\n` +
        `• ${summary.regulars} weekly regular${summary.regulars === 1 ? "" : "s"}\n` +
        `• ${summary.photos} saved photo${summary.photos === 1 ? "" : "s"}\n` +
        `• ${summary.exports} saved export${summary.exports === 1 ? "" : "s"}\n\n` +
        `Your current data will be OVERWRITTEN — there's no undo. Export your current workspace first if you want a backup.`;
      if (!confirm(msg)) return;
      await importWorkspace({ manifest, zip });
      alert(`Workspace imported.\n${summary.events} events · ${summary.regulars} regulars · ${summary.photos} photos · ${summary.exports} exports.\n\nReload the page to be safe.`);
    } catch (err) {
      console.error(err);
      alert("Workspace import failed: " + (err.message || err));
    } finally {
      setWsBusy(false);
    }
  };

  const linkBase = {
    padding: "8px 14px",
    fontSize: "0.72rem",
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    textDecoration: "none",
    color: "rgba(245,240,232,0.55)",
    borderRadius: "6px",
    fontWeight: 500,
  };
  const linkActive = {
    ...linkBase,
    color: "#F5F0E8",
    background: "rgba(245,240,232,0.08)",
  };

  // Common NavLink props: layer the cge-nav-link class on every tab
  // (used by the mobile media query) while keeping the existing
  // active/inactive inline-style swap.
  const navLinkCommon = {
    style: ({ isActive }) => isActive ? linkActive : linkBase,
    className: "cge-nav-link",
  };

  // === IMPORT FROM DISK ===
  // Reads a PNG (tEXt cgeExport tag) or ZIP (.cgeexport sidecar), looks
  // the id up in the cloud exports library, and routes the user to the
  // right tool with the snapshot restored via useRestoreStore. Same
  // pipeline as the ✎ Edit-in-tool button on saved library exports.
  //
  // Files without a tag (third-party PNGs, pre-tagging exports) get
  // offered as photo-library uploads instead — still useful as
  // background images even when the editable state is gone.
  const TOOL_ROUTE = { media: "/media", flyer: "/flyer", calendar: "/calendar" };

  const onImportFromDisk = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    if (importBusy) return;
    setImportBusy(true);
    try {
      const name = (file.name || "").toLowerCase();
      let tag = null;

      if (name.endsWith(".png") || file.type === "image/png") {
        tag = await readCgeExportTag(file);
      } else if (name.endsWith(".zip") || file.type === "application/zip") {
        // Parse zip, look for .cgeexport sidecar with id + tool + mode.
        try {
          const zip = await JSZip.loadAsync(file);
          const sidecar = zip.file(".cgeexport");
          if (sidecar) {
            const json = JSON.parse(await sidecar.async("string"));
            if (json?.id) tag = { id: json.id, tool: json.tool, mode: json.mode };
          }
        } catch { /* not a readable zip — fall through to "unidentified" */ }
      }

      if (!tag) {
        // Untagged. If it's an image, offer the photo library as a Plan B.
        if (file.type && file.type.startsWith("image/")) {
          if (confirm(
            `"${file.name}" doesn't carry a CGE export tag — can't auto-restore the editor state.\n\n` +
            `Save it to the Photo Library so it's available as a background image in the tools?`
          )) {
            await savePhotoAndNotify(file, { sourceTool: "import", sourceMode: "untagged" });
            alert("Saved to Photo Library.");
          }
        } else {
          alert(`"${file.name}" doesn't carry a CGE export tag. Only PNGs and ZIPs exported from CGE Tools after this update can be re-imported.`);
        }
        return;
      }

      // We have a tag. Look up the cloud record for the snapshot.
      const rec = await loadExportRecord(tag.id).catch(() => null);
      if (!rec || !rec.snapshot) {
        alert(
          `Found a CGE tag (${tag.tool || "unknown tool"}) but the source export is no longer in the cloud library — ` +
          `it was probably deleted from Recap → Library → Exports. The file's editable state is gone.`
        );
        return;
      }

      const route = TOOL_ROUTE[tag.tool];
      if (!route) {
        alert(`Got a tagged file for tool "${tag.tool}" but no editor matches that tool. (Reels aren't re-importable yet.)`);
        return;
      }

      setPending({ tool: tag.tool, snapshot: rec.snapshot });
      navigate(route);
    } catch (err) {
      console.error(err);
      alert("Import failed: " + (err.message || err));
    } finally {
      setImportBusy(false);
    }
  };

  return (
    // Fragment so the CloudWorkspaceModal can render as a sibling of <nav>.
    // <nav> is position:sticky + zIndex:100, which creates a stacking
    // context that trapped the modal's zIndex:9999 — on mobile the modal
    // ended up appearing behind the main builder content.
    <>
    <nav className="cge-nav" style={{
      padding: "0.6rem 1rem",
      background: "#0a0a0a",
      borderBottom: "1px solid rgba(245,240,232,0.06)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      {/* Inner wrapper — caps content width at 1200px to match the
          Calendar page wrapper (cge-cal-page). Background bar stays
          full-bleed; content aligns with the calendar preview below. */}
      <div className="cge-nav-inner" style={{
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
        maxWidth: 1200,
        margin: "0 auto",
      }}>
      <div className="cge-nav-brand" style={{
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: "2px",
        color: "#E5BC4F",
        marginRight: "1rem",
      }}>
        CGE TOOLS
      </div>
      {/* Desktop: keep the horizontal NavLink row (active-tab highlight
          + one-click access). Mobile: replaced by the ToolPicker
          dropdown below — 11 tabs in a row required horizontal
          swiping to reach Brand or Scraper. */}
      <div className="cge-desktop-only" style={{ display: "contents" }}>
        <NavLink to="/calendar"    {...navLinkCommon}>Calendar</NavLink>
        <NavLink to="/newsletter"  {...navLinkCommon}>Newsletter</NavLink>
        <NavLink to="/reel"        {...navLinkCommon}>Reel</NavLink>
        <NavLink to="/flyer"       {...navLinkCommon}>Flyer</NavLink>
        <NavLink to="/media"       {...navLinkCommon}>Media</NavLink>
        <NavLink to="/recap"       {...navLinkCommon}>Recap</NavLink>
        <NavLink to="/review"      {...navLinkCommon}>Review</NavLink>
        <NavLink to="/review-beta" {...navLinkCommon}>Review β</NavLink>
        <NavLink to="/scraper"     {...navLinkCommon}>📥 Scraper</NavLink>
        <NavLink to="/regulars"    {...navLinkCommon}>Regulars</NavLink>
        <NavLink to="/brand"       {...navLinkCommon}>Brand</NavLink>
      </div>
      <ToolPicker />

      <div className="cge-nav-spacer" style={{ flex: 1 }} />
      <div className="cge-nav-count" style={{
        fontSize: "0.6rem",
        color: "rgba(245,240,232,0.35)",
        letterSpacing: "1px",
        textTransform: "uppercase",
      }}>
        {eventCount} event{eventCount === 1 ? "" : "s"} loaded
      </div>
      {/* Hidden file inputs for workspace + disk import. Triggered by
          the WorkspaceMenu items. Kept inside the nav DOM since the
          handlers + refs live here. */}
      <input
        ref={wsFileRef}
        type="file"
        accept=".zip,.cgework,application/zip"
        onChange={onImportWorkspace}
        style={{ display: "none" }}
      />
      <input
        ref={importFileRef}
        type="file"
        accept=".png,.zip,image/png,application/zip"
        onChange={onImportFromDisk}
        style={{ display: "none" }}
      />
      {/* Workspace dropdown — collapses 5-7 action button pills into
          one menu (Save to Repl / Load from Repl / Export workspace /
          Import workspace / Import PNG-ZIP / Export CSV / Clear all). */}
      <WorkspaceMenu
        cloudOk={cloudOk}
        wsBusy={wsBusy}
        importBusy={importBusy}
        eventCount={eventCount}
        onCloudSave={onCloudSave}
        onOpenCloudPicker={() => setCloudPickOpen(true)}
        onExportWorkspace={onExportWorkspace}
        onTriggerImportWorkspace={() => wsFileRef.current?.click()}
        onTriggerImportFromDisk={() => importFileRef.current?.click()}
        onExportCsv={() => exportEventsCsv(events)}
        onClearAll={() => { if (confirm("Clear all events from all tools?")) clear(); }}
      />
      </div>
    </nav>
    <CloudWorkspaceModal
      open={cloudPickOpen}
      onClose={() => setCloudPickOpen(false)}
      onPick={onCloudPick}
    />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Navigate to="/calendar" replace />} />
        <Route path="/calendar" element={<CalendarBuilder />} />
        <Route path="/newsletter" element={<NewsletterBuilder />} />
        <Route path="/reel" element={<ReelTool />} />
        <Route path="/flyer" element={<FlyerBuilder />} />
        <Route path="/media" element={<MediaTool />} />
        <Route path="/recap" element={<RecapPicker />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/review-beta" element={<ReviewBeta />} />
        <Route path="/scraper" element={<ScraperReview />} />
        <Route path="/regulars" element={<Regulars />} />
        <Route path="/brand" element={<BrandKit />} />
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
