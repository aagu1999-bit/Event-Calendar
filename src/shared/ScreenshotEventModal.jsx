import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { screenshotToEvent } from "./aiContent.js";
import { getEmoji, normalizeHandle } from "./parseEvents.js";

// Drop-in "📸 Add from screenshot" flow for the Review queue.
// Upload/paste an image → Gemini Vision extracts an event → operator edits →
// "Add to queue" pushes it into `pending` via onAdd(event). Preview-and-edit
// step is deliberate: never silently trust an AI guess for a queue that already
// exists to catch missing/wrong fields. ✨ markers show which fields the AI
// filled (vs. which the operator edited/added) so the operator sees what to
// verify at a glance.
//
// Props: { open, apiKey, weekendDates, onAdd(event), onClose }

const L = { fontSize: "0.58rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, display: "block", marginBottom: 4 };
const I = { width: "100%", padding: "7px 9px", background: "#111", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 5, color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.82rem", outline: "none", boxSizing: "border-box" };
const SPARK = <span title="AI-filled — verify before adding" style={{ color: "#A78BFA", marginLeft: 4 }}>✨</span>;

// Read the file as a data URL. Downscale to a max 1600px edge (JPEG q0.9) so
// large phone screenshots (12MP+) don't push a 15MB base64 blob at Gemini —
// the model doesn't need that resolution to read a poster, and the network
// round-trip savings are big.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || "")) { reject(new Error("Drop an image file (JPG/PNG/WebP/HEIC).")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a readable image."));
      img.onload = () => {
        const maxEdge = 1600;
        const w0 = img.width || maxEdge, h0 = img.height || maxEdge;
        const scale = Math.min(1, maxEdge / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL("image/jpeg", 0.9)); }
        catch { reject(new Error("Couldn't process that image.")); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function ScreenshotEventModal({ open, apiKey, weekendDates = null, onAdd, onClose }) {
  const [imgDataUrl, setImgDataUrl] = useState("");
  const [imgBusy, setImgBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [event, setEvent] = useState(null);   // extracted + editable event
  const [aiFilled, setAiFilled] = useState(new Set()); // fields the AI populated
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState(null);       // { ok, text }
  const fileRef = useRef(null);

  // Reset the whole modal each time it opens so a re-open doesn't leak the
  // previous screenshot / extracted event.
  useEffect(() => {
    if (!open) return;
    setImgDataUrl(""); setEvent(null); setAiFilled(new Set()); setMsg(null);
  }, [open]);

  // Paste (Ctrl/Cmd-V) an image directly from the clipboard while the modal
  // is open — the operator screenshots stuff on their phone and pastes it in
  // one motion. Only active while the modal is open so we don't hijack paste
  // globally.
  useEffect(() => {
    if (!open) return;
    const onPaste = async (e) => {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) { await handleFile(file); break; }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFile = async (file) => {
    if (!file) return;
    setImgBusy(true); setMsg(null);
    try {
      const url = await fileToDataUrl(file);
      setImgDataUrl(url);
      setEvent(null); setAiFilled(new Set());
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally { setImgBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const extract = async () => {
    if (aiBusy || !imgDataUrl) return;
    if (!apiKey) { setMsg({ ok: false, text: "Add your Gemini API key on the Media tab first." }); return; }
    setAiBusy(true); setMsg(null);
    try {
      const { event: ev, aiFilled: filled } = await screenshotToEvent({ apiKey, image: imgDataUrl, weekendDates });
      setEvent(ev);
      setAiFilled(new Set(filled));
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally { setAiBusy(false); }
  };

  const updateField = (k, v) => {
    setEvent(e => ({ ...(e || {}), [k]: v }));
    // Editing a field drops its ✨ marker — the AI's guess no longer stands,
    // the operator now owns the value.
    setAiFilled(s => { const next = new Set(s); next.delete(k); return next; });
  };

  const addToQueue = () => {
    if (!event || !event.name.trim()) { setMsg({ ok: false, text: "Give the event a name before adding it." }); return; }
    const clean = {
      id: `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: event.name.trim(),
      day: event.day || "Fri",
      date: event.date || (weekendDates && weekendDates[event.day || "Fri"]) || "",
      time: event.time || "",
      venue: event.venue || "",
      area: event.area || "",
      region: event.region || "",
      type: (event.type || "").toUpperCase(),
      emoji: getEmoji((event.type || "").toUpperCase()),
      igHandle: normalizeHandle(event.igHandle || ""),
      link: event.link || "",
      featured: false,
      _source: "screenshot",
    };
    onAdd(clean);
    onClose();
  };

  if (!open) return null;

  const fieldMarker = (k) => aiFilled.has(k) ? SPARK : null;
  const filledCount = event ? Object.entries(event).filter(([, v]) => v && String(v).trim()).length : 0;
  const aiCount = aiFilled.size;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, background: "#141416", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 14, padding: "20px 20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "1.15rem", flex: 1 }}>📸 Add event from screenshot</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.5)", fontSize: "1.1rem", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: "0.78rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
          Drop a flyer or an Instagram screenshot, or paste one with <kbd style={{ padding: "1px 5px", background: "rgba(245,240,232,0.08)", borderRadius: 3, fontFamily: "inherit", fontSize: "0.7rem" }}>⌘V</kbd>. AI extracts the event fields for you to check before it lands in the queue.
        </p>

        {/* Drop zone + preview */}
        {!imgDataUrl ? (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) handleFile(f);
            }}
            style={{
              padding: "40px 20px", marginBottom: 14, borderRadius: 10, textAlign: "center",
              border: `2px dashed ${dragOver ? "#A78BFA" : "rgba(245,240,232,0.2)"}`,
              background: dragOver ? "rgba(139,92,246,0.08)" : "rgba(245,240,232,0.02)",
              cursor: imgBusy ? "wait" : "pointer", transition: "all 150ms",
            }}
          >
            <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>{imgBusy ? "⏳" : "📸"}</div>
            <div style={{ fontSize: "0.85rem", color: "#F5F0E8", marginBottom: 4 }}>{imgBusy ? "Reading image…" : "Drop, click, or paste an image"}</div>
            <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.45)" }}>Flyer, IG post, story screenshot — JPG / PNG / WebP</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0])} style={{ display: "none" }} />
          </div>
        ) : (
          <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <img src={imgDataUrl} alt="screenshot preview" style={{ width: 120, maxHeight: 180, objectFit: "contain", borderRadius: 6, border: "1px solid rgba(245,240,232,0.15)", background: "#000" }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <button onClick={extract} disabled={aiBusy} style={{ padding: "10px 12px", borderRadius: 6, border: "none", cursor: aiBusy ? "wait" : "pointer", background: "#A78BFA", color: "#1a0e3a", fontWeight: 800, fontSize: "0.85rem", letterSpacing: "0.3px" }}>
                {aiBusy ? "✨ Reading…" : event ? "✨ Re-extract" : "✨ Extract with AI"}
              </button>
              <button onClick={() => { setImgDataUrl(""); setEvent(null); setAiFilled(new Set()); setMsg(null); }} style={{ padding: "6px 10px", borderRadius: 5, cursor: "pointer", background: "transparent", color: "rgba(245,240,232,0.7)", border: "1px solid rgba(245,240,232,0.2)", fontSize: "0.72rem" }}>
                Change image
              </button>
              {event && (
                <div style={{ marginTop: 4, fontSize: "0.7rem", color: "rgba(245,240,232,0.5)" }}>
                  <span style={{ color: "#A78BFA" }}>✨ {aiCount}</span> AI-filled · <b>{filledCount}</b> total field{filledCount === 1 ? "" : "s"}
                </div>
              )}
            </div>
          </div>
        )}

        {msg && (
          <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 8, fontSize: "0.8rem",
            background: msg.ok ? "rgba(52,211,153,0.1)" : "rgba(251,113,133,0.1)",
            border: `1px solid ${msg.ok ? "rgba(52,211,153,0.4)" : "rgba(251,113,133,0.4)"}`,
            color: msg.ok ? "#34D399" : "#FB7185" }}>
            {msg.ok ? "✓ " : "⚠ "}{msg.text}
          </div>
        )}

        {event && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={L}>Event name{fieldMarker("name")}</label>
                <input value={event.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Sunday Afrobeats Brunch" style={I} />
              </div>
              <div>
                <label style={L}>Day{fieldMarker("day")}</label>
                <select value={event.day} onChange={(e) => updateField("day", e.target.value)} style={I}>
                  <option value="">—</option>
                  <option value="Fri">Fri</option>
                  <option value="Sat">Sat</option>
                  <option value="Sun">Sun</option>
                </select>
              </div>
              <div>
                <label style={L}>Date (M/D){fieldMarker("date")}</label>
                <input value={event.date} onChange={(e) => updateField("date", e.target.value)} placeholder={weekendDates && event.day ? weekendDates[event.day] || "" : "7/31"} style={I} />
              </div>
              <div>
                <label style={L}>Time{fieldMarker("time")}</label>
                <input value={event.time} onChange={(e) => updateField("time", e.target.value)} placeholder="9 PM" style={I} />
              </div>
              <div>
                <label style={L}>Type{fieldMarker("type")}</label>
                <input value={event.type} onChange={(e) => updateField("type", e.target.value.toUpperCase())} placeholder="DAY PARTY" style={I} />
              </div>
              <div>
                <label style={L}>Venue{fieldMarker("venue")}</label>
                <input value={event.venue} onChange={(e) => updateField("venue", e.target.value)} placeholder="Cafe Bello" style={I} />
              </div>
              <div>
                <label style={L}>City{fieldMarker("area")}</label>
                <input value={event.area} onChange={(e) => updateField("area", e.target.value)} placeholder="Newark" style={I} />
              </div>
              <div>
                <label style={L}>Region{fieldMarker("region")}</label>
                <select value={event.region} onChange={(e) => updateField("region", e.target.value)} style={I}>
                  <option value="">—</option>
                  <option value="North">North</option>
                  <option value="Central">Central</option>
                  <option value="South">South</option>
                </select>
              </div>
              <div>
                <label style={L}>IG handle{fieldMarker("igHandle")}</label>
                <input value={event.igHandle} onChange={(e) => updateField("igHandle", e.target.value)} placeholder="@djfoo" style={I} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={L}>Ticket / RSVP link{fieldMarker("link")}</label>
                <input value={event.link} onChange={(e) => updateField("link", e.target.value)} placeholder="https://…" style={I} />
              </div>
            </div>

            <button onClick={addToQueue} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", cursor: "pointer", background: "#E5BC4F", color: "#000", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "0.3px" }}>
              + Add to review queue
            </button>
            <p style={{ margin: "8px 0 0", fontSize: "0.7rem", color: "rgba(245,240,232,0.4)", textAlign: "center" }}>
              Missing fields (e.g. NO REGION) will flag in the queue — resolve there like any other event.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
