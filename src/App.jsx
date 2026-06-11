import { useRef, useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import CalendarBuilder from "./pages/CalendarBuilder.jsx";
import NewsletterBuilder from "./pages/NewsletterBuilder.jsx";
import ReelTool from "./pages/ReelTool.jsx";
import FlyerBuilder from "./pages/FlyerBuilder.jsx";
import MediaTool from "./pages/MediaTool.jsx";
import RecapPicker from "./pages/RecapPicker.jsx";
import ReviewQueue from "./pages/ReviewQueue.jsx";
import Regulars from "./pages/Regulars.jsx";
import { useEventsStore } from "./store";
import { exportWorkspace, previewWorkspace, importWorkspace, workspaceFilename } from "./shared/workspaceSync.js";
import { checkCloudAvailable, cloudSave, cloudLoad } from "./shared/cloudSync.js";
import { CloudWorkspaceModal } from "./shared/CloudWorkspaceModal.jsx";

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
  a.download = `CGE_events_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Nav() {
  const events = useEventsStore(s => s.events);
  const eventCount = events.length;
  const clear = useEventsStore(s => s.clearEvents);
  const wsFileRef = useRef(null);
  const [wsBusy, setWsBusy] = useState(false);
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

  return (
    // Fragment so the CloudWorkspaceModal can render as a sibling of <nav>.
    // <nav> is position:sticky + zIndex:100, which creates a stacking
    // context that trapped the modal's zIndex:9999 — on mobile the modal
    // ended up appearing behind the main builder content.
    <>
    <nav className="cge-nav" style={{
      display: "flex",
      alignItems: "center",
      gap: "0.4rem",
      padding: "0.6rem 1rem",
      background: "#0a0a0a",
      borderBottom: "1px solid rgba(245,240,232,0.06)",
      position: "sticky",
      top: 0,
      zIndex: 100,
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
      <NavLink to="/calendar"   {...navLinkCommon}>Calendar</NavLink>
      <NavLink to="/newsletter" {...navLinkCommon}>Newsletter</NavLink>
      <NavLink to="/reel"       {...navLinkCommon}>Reel</NavLink>
      <NavLink to="/flyer"      {...navLinkCommon}>Flyer</NavLink>
      <NavLink to="/media"      {...navLinkCommon}>Media</NavLink>
      <NavLink to="/recap"      {...navLinkCommon}>Recap</NavLink>
      <NavLink to="/review"     {...navLinkCommon}>Review</NavLink>
      <NavLink to="/regulars"   {...navLinkCommon}>Regulars</NavLink>
      <div className="cge-nav-spacer" style={{ flex: 1 }} />
      <div className="cge-nav-count" style={{
        fontSize: "0.6rem",
        color: "rgba(245,240,232,0.35)",
        letterSpacing: "1px",
        textTransform: "uppercase",
      }}>
        {eventCount} event{eventCount === 1 ? "" : "s"} loaded
      </div>
      {/* Cloud sync (Repl-side persistence). Hidden when the static build
          is served without the Express server. */}
      {cloudOk && (
        <>
          <button
            onClick={onCloudSave}
            disabled={wsBusy}
            title="Save the current workspace to a file on the Repl — teammates can load it from any browser."
            style={{
              padding: "4px 10px",
              background: "rgba(99,179,237,0.12)",
              border: "1px solid rgba(99,179,237,0.35)",
              borderRadius: "4px",
              color: "#63B3ED",
              fontSize: "0.6rem",
              letterSpacing: "1px",
              textTransform: "uppercase",
              cursor: wsBusy ? "wait" : "pointer",
              opacity: wsBusy ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >☁️ {wsBusy ? "…" : "Save to Repl"}</button>
          <button
            onClick={() => setCloudPickOpen(true)}
            disabled={wsBusy}
            title="Browse workspaces saved to this Repl and load one."
            style={{
              padding: "4px 10px",
              background: "rgba(99,179,237,0.06)",
              border: "1px solid rgba(99,179,237,0.25)",
              borderRadius: "4px",
              color: "#63B3ED",
              fontSize: "0.6rem",
              letterSpacing: "1px",
              textTransform: "uppercase",
              cursor: wsBusy ? "wait" : "pointer",
              opacity: wsBusy ? 0.6 : 1,
              fontFamily: "inherit",
            }}
          >Load from Repl</button>
        </>
      )}

      {/* Workspace sync — always available so teammates can import even on
          a fresh browser with zero events. */}
      <button
        onClick={onExportWorkspace}
        disabled={wsBusy}
        title="Download a single .cgework.zip with EVERYTHING — events, regulars, photos, exports. Share with teammates."
        style={{
          padding: "4px 10px",
          background: "rgba(192,132,252,0.10)",
          border: "1px solid rgba(192,132,252,0.3)",
          borderRadius: "4px",
          color: "#C084FC",
          fontSize: "0.6rem",
          letterSpacing: "1px",
          textTransform: "uppercase",
          cursor: wsBusy ? "wait" : "pointer",
          opacity: wsBusy ? 0.6 : 1,
          fontFamily: "inherit",
        }}
      >📦 {wsBusy ? "…" : "Export workspace"}</button>
      <button
        onClick={() => wsFileRef.current?.click()}
        disabled={wsBusy}
        title="Replace this browser's state with a teammate's .cgework.zip"
        style={{
          padding: "4px 10px",
          background: "rgba(192,132,252,0.06)",
          border: "1px solid rgba(192,132,252,0.25)",
          borderRadius: "4px",
          color: "#C084FC",
          fontSize: "0.6rem",
          letterSpacing: "1px",
          textTransform: "uppercase",
          cursor: wsBusy ? "wait" : "pointer",
          opacity: wsBusy ? 0.6 : 1,
          fontFamily: "inherit",
        }}
      >Import…</button>
      <input
        ref={wsFileRef}
        type="file"
        accept=".zip,.cgework,application/zip"
        onChange={onImportWorkspace}
        style={{ display: "none" }}
      />
      {eventCount > 0 && (
        <>
          <button
            onClick={() => exportEventsCsv(events)}
            title="Download the current events list (all tools) as CSV"
            style={{
              padding: "4px 10px",
              background: "rgba(229,188,79,0.10)",
              border: "1px solid rgba(229,188,79,0.3)",
              borderRadius: "4px",
              color: "#E5BC4F",
              fontSize: "0.6rem",
              letterSpacing: "1px",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Export CSV
          </button>
          <button
            onClick={() => { if (confirm("Clear all events from all tools?")) clear(); }}
            style={{
              padding: "4px 10px",
              background: "rgba(251,113,133,0.08)",
              border: "1px solid rgba(251,113,133,0.2)",
              borderRadius: "4px",
              color: "#FB7185",
              fontSize: "0.6rem",
              letterSpacing: "1px",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Clear all
          </button>
        </>
      )}
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
        <Route path="/regulars" element={<Regulars />} />
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
