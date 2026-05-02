import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import CalendarBuilder from "./pages/CalendarBuilder.jsx";
import NewsletterBuilder from "./pages/NewsletterBuilder.jsx";
import ReelTool from "./pages/ReelTool.jsx";
import { useEventsStore } from "./store";

function Nav() {
  const eventCount = useEventsStore(s => s.events.length);
  const clear = useEventsStore(s => s.clearEvents);

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
      <div style={{ flex: 1 }} />
      <div style={{
        fontSize: "0.6rem",
        color: "rgba(245,240,232,0.35)",
        letterSpacing: "1px",
        textTransform: "uppercase",
      }}>
        {eventCount} event{eventCount === 1 ? "" : "s"} loaded
      </div>
      {eventCount > 0 && (
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
        <Route path="*" element={<Navigate to="/calendar" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
