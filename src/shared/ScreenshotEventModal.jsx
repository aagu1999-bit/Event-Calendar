import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { screenshotToEvents } from "./aiContent.js";
import { getEmoji, normalizeHandle } from "./parseEvents.js";
import { useRegularsStore } from "../store.js";

// "📸 Add from screenshot" flow for the Review queue.
// Drop / click / paste (⌘V) one OR many event flyers / IG screenshots → Gemini
// Vision extracts each into an event → operator ticks include, edits, adds
// them all to the queue in one shot. When the poster reads "Every Saturday" /
// "Sundays" / etc., recurring is auto-detected and the "Also add as weekly
// regular" toggle is pre-ticked so the event lands in BOTH the queue and the
// Regulars store (source: "manual"). Preview-and-edit is deliberate — never
// silently trust an AI guess for a queue that already exists to catch bad
// data.
//
// Props: { open, apiKey, weekendDates, onAdd(event), onClose }

const L = { fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, display: "block", marginBottom: 3 };
const I = { width: "100%", padding: "6px 8px", background: "#111", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4, color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.78rem", outline: "none", boxSizing: "border-box" };
const SPARK = <span title="AI-filled — verify" style={{ color: "#A78BFA", marginLeft: 3 }}>✨</span>;

// Downscale to max 1600px edge (JPEG q0.9) so a 12MP phone screenshot doesn't
// push a huge base64 blob at Gemini — the model doesn't need that resolution
// to read a poster.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || "")) { reject(new Error("Drop an image file.")); return; }
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

// Shape a queue event and its optional weekly regular from a card's live state.
// Kept in one place so single- and multi-drop behave identically.
function cardToQueueEvent(card, weekendDates) {
  const ev = card.event;
  const type = (ev.type || "").toUpperCase();
  return {
    id: `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${card.key}`,
    name: (ev.name || "").trim(),
    day: ev.day || "Fri",
    date: ev.date || (weekendDates && weekendDates[ev.day || "Fri"]) || "",
    time: ev.time || "",
    venue: ev.venue || "",
    area: ev.area || "",
    region: ev.region || "",
    type,
    emoji: getEmoji(type),
    igHandle: normalizeHandle(ev.igHandle || ""),
    link: ev.link || "",
    featured: false,
    _source: "screenshot",
  };
}
function cardToRegular(card) {
  const ev = card.event;
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${card.key}`,
    name: (ev.name || "").trim(),
    venue: (ev.venue || "").trim(),
    area: (ev.area || "").trim(),
    region: ev.region || "North",
    day: ev.day || "Fri",
    time: (ev.time || "").trim(),
    type: (ev.type || "").trim(),
    postUrl: (ev.link || "").trim(),
    igHandle: normalizeHandle(ev.igHandle || ""),
    occurrenceCount: 0, firstSeen: today, lastSeen: today,
    timeSpreadMin: 0, explicitPattern: true, flags: [],
    rejected: false, flagged: false, confidence: 0.6,
  };
}

// Small provenance thumb for pool entries — the AI image is 1600px / heavy;
// the pool card only needs a scannable ~200px preview. ~15-30KB per entry.
function dataUrlToSmallThumb(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) { resolve(null); return; }
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const maxEdge = 220;
      const scale = Math.min(1, maxEdge / Math.max(img.width || maxEdge, img.height || maxEdge));
      const w = Math.max(1, Math.round((img.width || maxEdge) * scale));
      const h = Math.max(1, Math.round((img.height || maxEdge) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL("image/jpeg", 0.7)); }
      catch { resolve(null); }
    };
    img.src = dataUrl;
  });
}

export function ScreenshotEventModal({ open, apiKey, weekendDates = null, onAdd, onClose, onPoolAdded }) {
  // Each card is ONE event's editing state — a single screenshot can yield
  // several sibling cards (weekly-schedule flyers, series posters). Cards
  // share a `sourceKey` when they came from the same image so the UI can
  // show "1 of 3 from this poster" and let the operator visually group them.
  //
  // Placeholder cards (extracting: true, event: null) are seeded per uploaded
  // file BEFORE the AI returns; on completion the placeholder is replaced by
  // 1-or-more real cards inheriting the same sourceKey.
  //
  // { key, sourceKey, imgUrl, event, aiFilled:Set, recurring:bool, include:bool, alsoRegular:bool, extracting:bool, error:string|null }
  const [cards, setCards] = useState([]);
  const [addingBusy, setAddingBusy] = useState(false);
  const [poolBusy, setPoolBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  const addManualRegular = useRegularsStore((s) => s.addManual);

  // Reset on open so a re-open doesn't leak the previous batch.
  useEffect(() => {
    if (!open) return;
    setCards([]); setMsg(null);
  }, [open]);

  // ⌘V an image directly from the clipboard while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onPaste = async (e) => {
      const items = e.clipboardData?.items || [];
      const files = [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) await ingestFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Ingest 1-or-many files → each seeds a placeholder card (extracting) that
  // gets REPLACED by 1-or-more real cards when the AI returns. Extractions
  // fire concurrently; a schedule flyer that yields 4 events fans out to 4
  // sibling cards sharing the same sourceKey.
  const ingestFiles = async (files) => {
    if (!apiKey) { setMsg({ ok: false, text: "Add your Gemini API key on the Media tab first." }); return; }
    setMsg(null);
    const fresh = [];
    for (const file of files) {
      try {
        const imgUrl = await fileToDataUrl(file);
        const sourceKey = `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        fresh.push({
          key: `${sourceKey}_placeholder`,
          sourceKey, imgUrl,
          event: null,
          aiFilled: new Set(),
          recurring: false,
          include: true,
          alsoRegular: false,
          extracting: true,
          error: null,
        });
      } catch (err) {
        setMsg({ ok: false, text: String(err?.message || err) });
      }
    }
    if (!fresh.length) return;
    setCards((prev) => [...prev, ...fresh]);
    // Fire extractions concurrently; each result REPLACES the placeholder with
    // one card per extracted event (usually 1, sometimes more).
    fresh.forEach((placeholder) => {
      screenshotToEvents({ apiKey, image: placeholder.imgUrl, weekendDates })
        .then((results) => {
          const newCards = results.map((r, i) => ({
            key: `${placeholder.sourceKey}_${i}`,
            sourceKey: placeholder.sourceKey,
            imgUrl: placeholder.imgUrl,
            event: r.event,
            aiFilled: new Set(r.aiFilled),
            recurring: r.recurring,
            include: true,
            alsoRegular: r.recurring, // pre-tick when AI detected recurring
            extracting: false,
            error: null,
          }));
          setCards((prev) => {
            const idx = prev.findIndex((x) => x.key === placeholder.key);
            if (idx === -1) return prev; // placeholder was removed while extracting
            return [...prev.slice(0, idx), ...newCards, ...prev.slice(idx + 1)];
          });
        })
        .catch((err) => {
          setCards((prev) => prev.map((x) => x.key === placeholder.key
            ? { ...x, extracting: false, error: String(err?.message || err) }
            : x));
        });
    });
  };

  const onFileInput = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) ingestFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  };

  const updateCard = (key, patch) => {
    setCards((prev) => prev.map((c) => c.key === key ? { ...c, ...patch } : c));
  };
  const updateEvent = (key, field, value) => {
    // Enforce case + format on entry so what the operator types matches what
    // the AI-populated values look like — no mixed-case rows in the queue.
    // Time strips ranges the operator typed too (paste "10 PM - 2 AM" → keeps
    // "10 PM"); igHandle / link / region / day / date stay as-typed.
    let v = value;
    if (["name", "venue", "area", "type"].includes(field)) v = String(v || "").toUpperCase();
    else if (field === "time") {
      // Same shape as the AI-side safety net so both entry paths agree.
      const s = String(v || "").trim();
      if (s) {
        const parts = s.split(/\s*(?:[-–—]|\bto\b)\s*/i);
        let start = parts[0].trim();
        if (parts.length > 1) {
          const hasMer = /\b(am|pm|a\.m\.|p\.m\.)\b/i.test(start);
          if (!hasMer) {
            const t = s.slice(start.length).match(/\b(am|pm|a\.m\.|p\.m\.)\b/i);
            if (t) start = `${start} ${t[1].toUpperCase()}`;
          }
          v = start;
        }
      }
    }
    setCards((prev) => prev.map((c) => {
      if (c.key !== key) return c;
      // Editing a field drops its ✨ marker — operator now owns the value.
      const nextFilled = new Set(c.aiFilled); nextFilled.delete(field);
      return { ...c, event: { ...c.event, [field]: v }, aiFilled: nextFilled };
    }));
  };
  const removeCard = (key) => setCards((prev) => prev.filter((c) => c.key !== key));

  const addAll = async () => {
    if (addingBusy) return;
    const ready = cards.filter((c) => c.include && c.event && c.event.name && c.event.name.trim() && !c.extracting);
    if (ready.length === 0) { setMsg({ ok: false, text: "No cards ready to add — extract, tick include, and give each event a name." }); return; }
    setAddingBusy(true); setMsg(null);
    try {
      let queued = 0, registered = 0;
      for (const c of ready) {
        onAdd(cardToQueueEvent(c, weekendDates));
        queued++;
        if (c.alsoRegular) {
          addManualRegular(cardToRegular(c));
          registered++;
        }
      }
      setMsg({
        ok: true,
        text: `Added ${queued} to the queue${registered ? ` · ${registered} also saved as weekly regular${registered === 1 ? "" : "s"}` : ""}.`,
      });
      // Close after a short beat so the operator sees the confirmation.
      setTimeout(() => { onClose(); }, 700);
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally { setAddingBusy(false); }
  };

  // Save-to-pool: stash the current cards on the server for a later weekly
  // review. Same "ready" filter as addAll — only cards with a name, extracted,
  // and included come along. Thumbs get downscaled hard (~200px) so 100 pool
  // entries is still trivial disk.
  const saveToPool = async () => {
    if (poolBusy) return;
    const ready = cards.filter((c) => c.include && c.event && c.event.name && c.event.name.trim() && !c.extracting);
    if (ready.length === 0) { setMsg({ ok: false, text: "No cards ready to save — extract, tick include, and give each event a name." }); return; }
    setPoolBusy(true); setMsg(null);
    try {
      const entries = await Promise.all(ready.map(async (c) => ({
        event: cardToQueueEvent(c, weekendDates),
        thumb: await dataUrlToSmallThumb(c.imgUrl),
        recurring: !!c.recurring,
        alsoRegular: !!c.alsoRegular,
      })));
      const r = await fetch("/api/screenshot-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || j.error || `Server responded ${r.status}`);
      setMsg({
        ok: true,
        text: `Saved ${j.added || entries.length} to the pool — pull them into your queue during that event's weekend.`,
      });
      // Tell the parent so the toolbar pool count refreshes.
      if (onPoolAdded) onPoolAdded(j.total);
      setTimeout(() => { onClose(); }, 900);
    } catch (err) {
      setMsg({ ok: false, text: String(err?.message || err) });
    } finally { setPoolBusy(false); }
  };

  if (!open) return null;

  const anyExtracting = cards.some((c) => c.extracting);
  const readyCount = cards.filter((c) => c.include && c.event && !c.extracting).length;
  const extractedCount = cards.filter((c) => c.event && !c.extracting).length;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 680, background: "#141416", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 14, padding: "20px 20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "1.15rem", flex: 1 }}>
            📸 Add events from screenshots
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.5)", fontSize: "1.1rem", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: "0.78rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
          Drop one or many flyers / IG screenshots, or paste with <kbd style={{ padding: "1px 5px", background: "rgba(245,240,232,0.08)", borderRadius: 3, fontFamily: "inherit", fontSize: "0.7rem" }}>⌘V</kbd>. Each becomes an editable card — recurring events ("Every Saturday") can also register as a weekly regular.
        </p>

        {/* Drop zone — always visible so you can add more mid-flow. */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragOver(false);
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length) ingestFiles(files);
          }}
          style={{
            padding: cards.length ? "14px 20px" : "36px 20px", marginBottom: 12, borderRadius: 10, textAlign: "center",
            border: `2px dashed ${dragOver ? "#A78BFA" : "rgba(245,240,232,0.2)"}`,
            background: dragOver ? "rgba(139,92,246,0.08)" : "rgba(245,240,232,0.02)",
            cursor: "pointer", transition: "all 150ms",
          }}
        >
          <div style={{ fontSize: cards.length ? "1rem" : "1.8rem", marginBottom: 4 }}>📸</div>
          <div style={{ fontSize: cards.length ? "0.75rem" : "0.85rem", color: "#F5F0E8" }}>
            {cards.length ? "Drop, click, or paste more" : "Drop, click, or paste image(s)"}
          </div>
          {!cards.length && <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.45)", marginTop: 4 }}>Flyer, IG post, story screenshot — one or many</div>}
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={onFileInput} style={{ display: "none" }} />
        </div>

        {msg && (
          <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 8, fontSize: "0.8rem",
            background: msg.ok ? "rgba(52,211,153,0.1)" : "rgba(251,113,133,0.1)",
            border: `1px solid ${msg.ok ? "rgba(52,211,153,0.4)" : "rgba(251,113,133,0.4)"}`,
            color: msg.ok ? "#34D399" : "#FB7185" }}>
            {msg.ok ? "✓ " : "⚠ "}{msg.text}
          </div>
        )}

        {/* Extracted cards */}
        {cards.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.7)", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>
                {anyExtracting ? `Reading ${extractedCount}/${cards.length}…` : `Extracted ${extractedCount}`}
              </div>
              <div style={{ flex: 1 }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: "50vh", overflowY: "auto", paddingRight: 4 }}>
              {cards.map((c) => {
                // Sibling info: count + this card's position among cards sharing
                // the same sourceKey. When >1 the badge shows "1 of 3 from this
                // poster" so the operator sees which cards came together.
                const siblings = cards.filter((x) => x.sourceKey === c.sourceKey);
                const siblingCount = siblings.length;
                const siblingIndex = siblings.findIndex((x) => x.key === c.key) + 1;
                return (
                  <CardRow
                    key={c.key}
                    card={c}
                    siblingCount={siblingCount}
                    siblingIndex={siblingIndex}
                    weekendDates={weekendDates}
                    onUpdateEvent={(field, value) => updateEvent(c.key, field, value)}
                    onSetInclude={(v) => updateCard(c.key, { include: v })}
                    onSetRegular={(v) => updateCard(c.key, { alsoRegular: v })}
                    onRemove={() => removeCard(c.key)}
                  />
                );
              })}
            </div>

            {/* Two destinations, operator picks:
                • Add to review queue = current-weekend triage (this session).
                • Save to pool = stash for later, pull during that event's actual weekend. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={addAll}
                disabled={addingBusy || poolBusy || anyExtracting || readyCount === 0}
                style={{
                  width: "100%", padding: "12px", borderRadius: 8, border: "none",
                  cursor: (addingBusy || poolBusy || anyExtracting || readyCount === 0) ? "not-allowed" : "pointer",
                  background: (addingBusy || poolBusy || anyExtracting || readyCount === 0) ? "rgba(229,188,79,0.3)" : "#E5BC4F",
                  color: "#000", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "0.3px",
                }}
              >
                {addingBusy ? "Adding…" : anyExtracting ? "Waiting for extraction…" : `+ Add ${readyCount} event${readyCount === 1 ? "" : "s"} to review queue`}
              </button>
              <button
                onClick={saveToPool}
                disabled={addingBusy || poolBusy || anyExtracting || readyCount === 0}
                title="Stash these for later — they'll show up in the Review pool ready to pull during the event's actual weekend."
                style={{
                  width: "100%", padding: "10px", borderRadius: 8,
                  cursor: (addingBusy || poolBusy || anyExtracting || readyCount === 0) ? "not-allowed" : "pointer",
                  background: "transparent",
                  color: (addingBusy || poolBusy || anyExtracting || readyCount === 0) ? "rgba(139,92,246,0.4)" : "#A78BFA",
                  border: `1px solid ${(addingBusy || poolBusy || anyExtracting || readyCount === 0) ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.5)"}`,
                  fontWeight: 700, fontSize: "0.82rem", letterSpacing: "0.3px",
                }}
              >
                {poolBusy ? "Saving…" : `🗓️ Save ${readyCount} to pool for later`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// One card in the extracted list: thumb + editable fields grid + include /
// regular toggles + remove. Compact enough that 5-8 fit on screen at once.
function CardRow({ card, siblingCount = 1, siblingIndex = 1, weekendDates, onUpdateEvent, onSetInclude, onSetRegular, onRemove }) {
  const { imgUrl, event, aiFilled, recurring, include, alsoRegular, extracting, error } = card;
  const hasSiblings = siblingCount > 1;
  const mark = (k) => aiFilled.has(k) ? SPARK : null;
  const filledCount = event ? Object.entries(event).filter(([, v]) => v && String(v).trim()).length : 0;
  const aiCount = aiFilled.size;

  return (
    <div style={{
      display: "flex", gap: 10,
      padding: 10, borderRadius: 8,
      background: include ? "rgba(139,92,246,0.05)" : "rgba(245,240,232,0.02)",
      border: `1px solid ${include ? "rgba(139,92,246,0.3)" : "rgba(245,240,232,0.08)"}`,
      opacity: include ? 1 : 0.5,
    }}>
      <img src={imgUrl} alt="" style={{ width: 60, height: 80, objectFit: "cover", borderRadius: 5, border: "1px solid rgba(245,240,232,0.15)", background: "#000", flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        {extracting && (
          <div style={{ padding: "18px 0", fontSize: "0.8rem", color: "#A78BFA", textAlign: "center" }}>✨ Reading…</div>
        )}
        {error && (
          <div style={{ padding: "10px 0", fontSize: "0.78rem", color: "#FB7185" }}>⚠ {error}</div>
        )}
        {event && !extracting && (
          <>
            {/* Header row: name + status badges + remove */}
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.7rem", color: "rgba(245,240,232,0.7)", flexShrink: 0 }}>
                <input type="checkbox" checked={include} onChange={(e) => onSetInclude(e.target.checked)} style={{ accentColor: "#A78BFA" }} />
                Include
              </label>
              {recurring && (
                <span title="AI detected recurring language (every X / Sundays / weekly)" style={{ fontSize: "0.6rem", padding: "1px 6px", borderRadius: 3, background: "rgba(229,188,79,0.15)", color: "#E5BC4F", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>
                  🔁 Weekly
                </span>
              )}
              {hasSiblings && (
                <span title={`This card is 1 of ${siblingCount} extracted from the same poster`} style={{ fontSize: "0.6rem", padding: "1px 6px", borderRadius: 3, background: "rgba(139,92,246,0.15)", color: "#A78BFA", letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700 }}>
                  {siblingIndex} of {siblingCount} from this poster
                </span>
              )}
              <span style={{ fontSize: "0.66rem", color: "rgba(245,240,232,0.4)" }}>
                <span style={{ color: "#A78BFA" }}>✨ {aiCount}</span> · {filledCount} filled
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={onRemove} title="Remove this card" style={{ background: "transparent", border: "1px solid rgba(251,113,133,0.3)", color: "#FB7185", borderRadius: 3, padding: "2px 7px", fontSize: "0.66rem", cursor: "pointer" }}>×</button>
            </div>

            {/* Editable grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6, marginBottom: 6 }}>
              <div>
                <label style={L}>Name{mark("name")}</label>
                <input value={event.name} onChange={(e) => onUpdateEvent("name", e.target.value)} placeholder="Event name" style={I} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "70px 90px 1fr 1fr", gap: 6, marginBottom: 6 }}>
              <div>
                <label style={L}>Day{mark("day")}</label>
                <select value={event.day} onChange={(e) => onUpdateEvent("day", e.target.value)} style={I}>
                  <option value="">—</option><option value="Fri">Fri</option><option value="Sat">Sat</option><option value="Sun">Sun</option>
                </select>
              </div>
              <div>
                <label style={L}>Date{mark("date")}</label>
                <input value={event.date} onChange={(e) => onUpdateEvent("date", e.target.value)} placeholder={weekendDates && event.day ? weekendDates[event.day] || "" : "M/D"} style={I} />
              </div>
              <div>
                <label style={L}>Time{mark("time")}</label>
                <input value={event.time} onChange={(e) => onUpdateEvent("time", e.target.value)} placeholder="9 PM" style={I} />
              </div>
              <div>
                <label style={L}>Type{mark("type")}</label>
                <input value={event.type} onChange={(e) => onUpdateEvent("type", e.target.value)} placeholder="DAY PARTY" style={I} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 6, marginBottom: 6 }}>
              <div>
                <label style={L}>Venue{mark("venue")}</label>
                <input value={event.venue} onChange={(e) => onUpdateEvent("venue", e.target.value)} placeholder="Cafe Bello" style={I} />
              </div>
              <div>
                <label style={L}>City{mark("area")}</label>
                <input value={event.area} onChange={(e) => onUpdateEvent("area", e.target.value)} placeholder="Newark" style={I} />
              </div>
              <div>
                <label style={L}>Region{mark("region")}</label>
                <select value={event.region} onChange={(e) => onUpdateEvent("region", e.target.value)} style={I}>
                  <option value="">—</option><option value="North">N</option><option value="Central">C</option><option value="South">S</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 6, marginBottom: 8 }}>
              <div>
                <label style={L}>IG handle{mark("igHandle")}</label>
                <input value={event.igHandle} onChange={(e) => onUpdateEvent("igHandle", e.target.value)} placeholder="@djfoo" style={I} />
              </div>
              <div>
                <label style={L}>Link{mark("link")}</label>
                <input value={event.link} onChange={(e) => onUpdateEvent("link", e.target.value)} placeholder="https://…" style={I} />
              </div>
            </div>

            {/* Regular toggle — pre-ticked when AI detected recurring language */}
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.72rem", color: "rgba(245,240,232,0.85)", padding: "6px 8px", borderRadius: 5, background: alsoRegular ? "rgba(229,188,79,0.1)" : "transparent", border: `1px solid ${alsoRegular ? "rgba(229,188,79,0.35)" : "rgba(245,240,232,0.1)"}` }}>
              <input type="checkbox" checked={alsoRegular} onChange={(e) => onSetRegular(e.target.checked)} style={{ accentColor: "#E5BC4F" }} />
              🔁 Also save as weekly regular
              {recurring && <span style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.5)", marginLeft: "auto" }}>AI detected recurring</span>}
            </label>
          </>
        )}
      </div>
    </div>
  );
}
