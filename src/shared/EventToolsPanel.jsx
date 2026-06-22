import { useState, useMemo } from "react";
import { loadPhotoAsImage } from "./photoLibrary.js";
import { PhotoLibraryModal } from "./PhotoLibraryModal.jsx";

// Event Tools panel — collapsible block at the top of the Media tab with
// two modes:
//
//   1. SINGLE EVENT — fill out the event once, "Apply to current
//      template" copies relevant fields into whatever template is
//      currently active. Saves you from re-typing the same name/date/
//      venue into every template's form.
//
//   2. ROUNDUP — for "what's happening this weekend" carousels. Pick
//      events from the Review queue, set a theme headline + body + URL,
//      hit Generate, and a Cover + Text + N Spotlights + CTA carousel
//      lands in the composer pre-filled. Per-event photos are picked
//      from the photo library.
//
// All callbacks are owned by MediaTool (the only place that has access to
// every template's setters + the carousel composer state).

const L = { display: "block", fontSize: "0.5rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.5)", marginBottom: "3px" };
const I = { width: "100%", padding: "6px 8px", background: "#111", border: "1px solid rgba(245,240,232,0.05)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif", fontSize: "0.7rem", outline: "none" };
const B = { padding: "5px 8px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.04)", borderRadius: "4px", color: "rgba(245,240,232,0.55)", fontSize: "0.65rem", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" };

export function EventToolsPanel({
  // The current Media-tool mode (cover/text/spotlight/etc) — used to
  // label the "Apply to" button.
  currentMode,
  // List of available events to pick from (from useEventsStore).
  events,
  // Called when user hits "Apply to current template" in Single Event
  // mode. Receives the full eventData object.
  onApplyToTemplate,
  // Called when user hits "Generate Carousel" in Roundup mode.
  // Receives { theme, picks: [{ event, photo }] } where photo may be
  // a loaded HTMLImageElement or null if the user skipped that one.
  onGenerateRoundup,
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("single"); // "single" | "roundup"

  return (
    <div style={{ marginBottom: "0.8rem", border: "1px solid rgba(229,188,79,0.25)", borderRadius: 6, background: "rgba(229,188,79,0.04)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", textAlign: "left",
          padding: "8px 12px",
          background: "transparent", border: "none",
          color: "#E5BC4F", fontSize: "0.65rem",
          letterSpacing: "1.5px", textTransform: "uppercase", fontWeight: 700,
          cursor: "pointer", fontFamily: "'Syne',sans-serif",
          display: "flex", alignItems: "center", gap: "8px",
        }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>📋 Event Tools</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px" }}>
          {open ? "" : "fill once · push to templates · generate roundup carousels"}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px", borderTop: "1px solid rgba(229,188,79,0.15)" }}>
          {/* Tab switcher */}
          <div style={{ display: "flex", gap: "4px", padding: "10px 0 12px" }}>
            {[
              { key: "single",  label: "Single Event", hint: "fill once → push to current template" },
              { key: "roundup", label: "Roundup Generator", hint: "pick events from Review → auto-build carousel" },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                title={t.hint}
                style={{
                  padding: "6px 12px", borderRadius: 4,
                  background: tab === t.key ? "rgba(229,188,79,0.18)" : "rgba(245,240,232,0.04)",
                  border: `1px solid ${tab === t.key ? "#E5BC4F" : "rgba(245,240,232,0.08)"}`,
                  color: tab === t.key ? "#E5BC4F" : "rgba(245,240,232,0.6)",
                  fontSize: "0.6rem", fontWeight: 700, letterSpacing: "1px",
                  textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
                }}
              >{t.label}</button>
            ))}
          </div>

          {tab === "single" && <SingleEventForm currentMode={currentMode} onApplyToTemplate={onApplyToTemplate} />}
          {tab === "roundup" && <RoundupGenerator events={events} onGenerateRoundup={onGenerateRoundup} />}
        </div>
      )}
    </div>
  );
}

// === SINGLE EVENT FORM ===
// Holds the structured event data. "Apply" pushes it into the current
// template's fields via the parent's onApplyToTemplate callback.
function SingleEventForm({ currentMode, onApplyToTemplate }) {
  const [data, setData] = useState({
    name: "",
    date: "",
    time: "",
    venue: "",
    area: "",
    city: "",
    hosts: "",
    tagline: "",
    description: "",
    lineup: "",
    genres: "",
    url: "centralgroupevents.com",
  });
  const [photo, setPhoto] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const set = (k) => (e) => setData(prev => ({ ...prev, [k]: e.target.value }));

  const apply = () => {
    if (!data.name.trim()) { alert("Add an event name first."); return; }
    onApplyToTemplate({ ...data, photo });
  };

  return (
    <>
      <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5, marginBottom: "8px" }}>
        Fill once. Click <strong style={{ color: "#E5BC4F" }}>Apply to {currentMode}</strong> below to push these into the template's fields. Only fields with matching mappings get used; the rest stay where they are.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
        <div><label style={L}>Event Name</label><input value={data.name} onChange={set("name")} style={I} placeholder="Soulja Boy 2000's Party"/></div>
        <div><label style={L}>Tagline · short hook</label><input value={data.tagline} onChange={set("tagline")} style={I} placeholder="THE BIGGEST 2000'S PARTY IN NJ"/></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "6px" }}>
        <div><label style={L}>Date</label><input value={data.date} onChange={set("date")} style={I} placeholder="JULY 11"/></div>
        <div><label style={L}>Time</label><input value={data.time} onChange={set("time")} style={I} placeholder="9 PM"/></div>
        <div><label style={L}>Venue</label><input value={data.venue} onChange={set("venue")} style={I} placeholder="Lotus Rooftop"/></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "6px" }}>
        <div><label style={L}>Area</label><input value={data.area} onChange={set("area")} style={I} placeholder="Passaic"/></div>
        <div><label style={L}>City / Region</label><input value={data.city} onChange={set("city")} style={I} placeholder="NJ"/></div>
        <div><label style={L}>URL</label><input value={data.url} onChange={set("url")} style={I} placeholder="centralgroupevents.com"/></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
        <div><label style={L}>Hosts</label><input value={data.hosts} onChange={set("hosts")} style={I} placeholder="CGE · DJ Carvell"/></div>
        <div><label style={L}>Lineup · names</label><input value={data.lineup} onChange={set("lineup")} style={I} placeholder="Soulja Boy · DJ Carvell"/></div>
      </div>

      <div style={{ marginBottom: "6px" }}>
        <label style={L}>Genres · comma-separated</label>
        <input value={data.genres} onChange={set("genres")} style={I} placeholder="HIP-HOP, R&B, 2000'S"/>
      </div>

      <div style={{ marginBottom: "8px" }}>
        <label style={L}>Description · for Text body / Cover body</label>
        <textarea value={data.description} onChange={set("description")} style={{ ...I, height: 60, resize: "vertical" }} placeholder="We're throwing it back to the 2000s on a rooftop with star guest Soulja Boy..."/>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <div style={{ flex: 1 }}>
          <label style={L}>Event photo</label>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <button onClick={() => setLibraryOpen(true)} style={{ ...B, flex: 1 }}>{photo ? "✓ Photo set — change" : "📚 Pick from Library"}</button>
            {photo && <button onClick={() => setPhoto(null)} style={{ ...B, color: "rgba(251,113,133,0.6)" }}>×</button>}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          onClick={apply}
          disabled={!data.name.trim()}
          style={{
            flex: 1,
            padding: "10px 14px",
            background: data.name.trim() ? "#E5BC4F" : "rgba(229,188,79,0.3)",
            color: "#000", border: "none", borderRadius: 4,
            fontSize: "0.7rem", fontWeight: 700, letterSpacing: "1.5px",
            textTransform: "uppercase",
            cursor: data.name.trim() ? "pointer" : "not-allowed",
            fontFamily: "'Syne', sans-serif",
          }}
        >→ Apply to {currentMode}</button>
      </div>

      <PhotoLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(img) => setPhoto(img)}
        outputAs="image"
      />
    </>
  );
}

// === ROUNDUP GENERATOR ===
// Multi-select from events store + theme headline/body + per-event photo.
// Generates: Cover + Text + N Spotlights + CTA into the carousel composer.
function RoundupGenerator({ events, onGenerateRoundup }) {
  const [theme, setTheme] = useState({
    categoryTag: "WEEKEND GUIDE",
    headline: "HERE'S WHAT'S HAPPENING IN NJ THIS WEEKEND",
    tagline: "North, Central, South Jersey",
    bodyTitle: "",
    bodyText: "",
    ctaText: "FIND FULL LIST AT",
    url: "centralgroupevents.com",
  });
  const [coverPhoto, setCoverPhoto] = useState(null);
  const [coverLibraryOpen, setCoverLibraryOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState({}); // { [eventId]: { photo, photoBusy } }
  const [perEventLibOpen, setPerEventLibOpen] = useState(null); // eventId | null

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return events;
    return events.filter(ev => {
      const hay = [ev.name, ev.venue, ev.area, ev.region, ev.day].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [events, filter]);

  const set = (k) => (e) => setTheme(prev => ({ ...prev, [k]: e.target.value }));

  const togglePick = (ev) => {
    setPicked(prev => {
      const next = { ...prev };
      if (next[ev.id]) delete next[ev.id];
      else next[ev.id] = { photo: null };
      return next;
    });
  };

  const setPickedPhoto = (eventId, photo) => {
    setPicked(prev => ({ ...prev, [eventId]: { ...(prev[eventId] || {}), photo } }));
  };

  const pickedCount = Object.keys(picked).length;

  const generate = () => {
    if (!theme.headline.trim()) { alert("Add a Cover headline first."); return; }
    if (pickedCount === 0) { alert("Pick at least one event to spotlight."); return; }
    const picks = Object.keys(picked).map(eventId => {
      const event = events.find(e => String(e.id) === String(eventId));
      const photo = picked[eventId]?.photo || null;
      return { event, photo };
    }).filter(p => p.event);
    onGenerateRoundup({ theme: { ...theme, coverPhoto }, picks });
  };

  return (
    <>
      <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5, marginBottom: "8px" }}>
        Pick events from your Review queue, set the theme + URL, hit <strong style={{ color: "#34D399" }}>Generate Carousel</strong>. Output: <strong>Cover</strong> (headline) → <strong>Text</strong> (body) → <strong>{pickedCount || "N"} × Spotlight</strong> (one per pick) → <strong>CTA</strong>.
      </div>

      {/* === Theme fields === */}
      <div style={{ fontSize: "0.5rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.4)", fontWeight: 700, marginBottom: "6px" }}>1 · Theme</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
        <div><label style={L}>Category tag (Cover top)</label><input value={theme.categoryTag} onChange={set("categoryTag")} style={I} placeholder="WEEKEND GUIDE · JUNETEENTH 2026"/></div>
        <div><label style={L}>Tagline / where line (Cover)</label><input value={theme.tagline} onChange={set("tagline")} style={I} placeholder="North, Central, South Jersey"/></div>
      </div>

      <div style={{ marginBottom: "6px" }}>
        <label style={L}>Cover headline</label>
        <input value={theme.headline} onChange={set("headline")} style={I} placeholder="HERE'S WHAT'S HAPPENING IN NJ THIS WEEKEND"/>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <div style={{ flex: 1 }}>
          <label style={L}>Cover photo · used on Cover + Text background</label>
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <button onClick={() => setCoverLibraryOpen(true)} style={{ ...B, flex: 1 }}>{coverPhoto ? "✓ Cover photo set — change" : "📚 Pick from Library"}</button>
            {coverPhoto && <button onClick={() => setCoverPhoto(null)} style={{ ...B, color: "rgba(251,113,133,0.6)" }}>×</button>}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "6px" }}>
        <div><label style={L}>Text-slide title (e.g. JUNETEENTH 2026)</label><input value={theme.bodyTitle} onChange={set("bodyTitle")} style={I} placeholder="JUNETEENTH 2026"/></div>
        <div><label style={L}>CTA URL</label><input value={theme.url} onChange={set("url")} style={I} placeholder="centralgroupevents.com"/></div>
      </div>

      <div style={{ marginBottom: "10px" }}>
        <label style={L}>Text-slide body · the long-form context paragraph</label>
        <textarea value={theme.bodyText} onChange={set("bodyText")} style={{ ...I, height: 70, resize: "vertical" }} placeholder="Juneteenth belongs entirely to the endurance, spirit, and triumph of Black Americans..."/>
      </div>

      {/* === Event picker === */}
      <div style={{ fontSize: "0.5rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.4)", fontWeight: 700, marginBottom: "6px" }}>2 · Pick events from your Review queue</div>

      {events.length === 0 ? (
        <div style={{ padding: "1.5rem 0.5rem", textAlign: "center", color: "rgba(245,240,232,0.4)", fontSize: "0.65rem", border: "1px dashed rgba(245,240,232,0.1)", borderRadius: 4, marginBottom: "10px" }}>
          No events in your Review queue. Upload a sheet or scrape some first, then come back here.
        </div>
      ) : (
        <>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={`Filter ${events.length} events by name / venue / area / day...`}
            style={{ ...I, marginBottom: "6px" }}
          />
          <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid rgba(245,240,232,0.06)", borderRadius: 4, marginBottom: "10px" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "1rem", textAlign: "center", color: "rgba(245,240,232,0.3)", fontSize: "0.6rem" }}>No events match that filter.</div>
            ) : (
              filtered.map(ev => {
                const isPicked = !!picked[ev.id];
                const pickedData = picked[ev.id];
                return (
                  <div key={ev.id} style={{
                    display: "grid", gridTemplateColumns: "20px 1fr auto",
                    gap: "8px", alignItems: "center",
                    padding: "6px 10px",
                    background: isPicked ? "rgba(52,211,153,0.06)" : "transparent",
                    borderBottom: "1px solid rgba(245,240,232,0.04)",
                    cursor: "pointer",
                  }} onClick={() => togglePick(ev)}>
                    <span style={{ color: isPicked ? "#34D399" : "rgba(245,240,232,0.3)", fontSize: "0.8rem", fontWeight: 800 }}>{isPicked ? "✓" : "○"}</span>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name || "(no name)"}</div>
                      <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[ev.day, ev.time, ev.venue, ev.area, ev.region].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {isPicked && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPerEventLibOpen(ev.id); }}
                        style={{
                          padding: "3px 8px",
                          background: pickedData?.photo ? "rgba(52,211,153,0.15)" : "rgba(99,179,237,0.1)",
                          border: `1px solid ${pickedData?.photo ? "#34D399" : "rgba(99,179,237,0.3)"}`,
                          borderRadius: 3,
                          color: pickedData?.photo ? "#34D399" : "#63B3ED",
                          fontSize: "0.5rem", fontWeight: 700, letterSpacing: "0.5px",
                          textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
                        }}
                      >{pickedData?.photo ? "✓ photo" : "📚 photo"}</button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)" }}>
          {pickedCount === 0 ? "Pick at least one event" : `${pickedCount} event${pickedCount === 1 ? "" : "s"} picked → ${pickedCount + 3} slides total (Cover + Text + ${pickedCount} × Spotlight + CTA)`}
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={generate}
          disabled={pickedCount === 0 || !theme.headline.trim()}
          style={{
            padding: "10px 14px",
            background: pickedCount > 0 && theme.headline.trim() ? "#34D399" : "rgba(52,211,153,0.3)",
            color: "#000", border: "none", borderRadius: 4,
            fontSize: "0.7rem", fontWeight: 700, letterSpacing: "1.5px",
            textTransform: "uppercase",
            cursor: pickedCount > 0 && theme.headline.trim() ? "pointer" : "not-allowed",
            fontFamily: "'Syne', sans-serif",
          }}
        >→ Generate Carousel</button>
      </div>

      <PhotoLibraryModal
        open={coverLibraryOpen}
        onClose={() => setCoverLibraryOpen(false)}
        onPick={(img) => setCoverPhoto(img)}
        outputAs="image"
      />
      <PhotoLibraryModal
        open={!!perEventLibOpen}
        onClose={() => setPerEventLibOpen(null)}
        onPick={(img) => { if (perEventLibOpen) setPickedPhoto(perEventLibOpen, img); }}
        outputAs="image"
      />
    </>
  );
}
