import { useRef, useState } from "react";
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

// Wrap a CSV cell — quote if it contains a comma, quote, or newline.
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportEventsCsv(events) {
  if (!events.length) return;
  const cols = ["day", "time", "name", "venue", "area", "region", "type", "link", "igHandle", "featured", "emoji"];
  const lines = [cols.join(",")];
  for (const ev of events) {
    lines.push(cols.map(c => csvCell(ev[c])).join(","));
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

  return (
    <nav style={{
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
      <div style={{
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: "2px",
        color: "#E5BC4F",
        marginRight: "1rem",
      }}>
        CGE TOOLS
      </div>
      <NavLink to="/calendar" style={({ isActive }) => isActive ? linkActive : linkBase}>Calendar</NavLink>
      <NavLink to="/newsletter" style={({ isActive }) => isActive ? linkActive : linkBase}>Newsletter</NavLink>
      <NavLink to="/reel" style={({ isActive }) => isActive ? linkActive : linkBase}>Reel</NavLink>
      <NavLink to="/flyer" style={({ isActive }) => isActive ? linkActive : linkBase}>Flyer</NavLink>
      <NavLink to="/media" style={({ isActive }) => isActive ? linkActive : linkBase}>Media</NavLink>
      <NavLink to="/recap" style={({ isActive }) => isActive ? linkActive : linkBase}>Recap</NavLink>
      <NavLink to="/review" style={({ isActive }) => isActive ? linkActive : linkBase}>Review</NavLink>
      <NavLink to="/regulars" style={({ isActive }) => isActive ? linkActive : linkBase}>Regulars</NavLink>
      <div style={{ flex: 1 }} />
      <div style={{
        fontSize: "0.6rem",
        color: "rgba(245,240,232,0.35)",
        letterSpacing: "1px",
        textTransform: "uppercase",
      }}>
        {eventCount} event{eventCount === 1 ? "" : "s"} loaded
      </div>
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
