import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { generateGuideCommentary } from "./aiContent.js";

// Publish a themed GUIDE page to centralgroupevents.com — the editorial write-up
// (AI-voiced from the Brand Kit) plus the event listings — via the server proxy
// POST /api/website/pages (→ site's /api/integrations/pages/upsert). The website
// only replaces listings whose source is "cge-tools", so re-publishing never
// wipes public-form or admin-CSV rows on the same page.
//
// Props: open, apiKey, events (Event[] to feature), voice (Brand Kit voice), onClose.

function slugify(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// CGE "M/D" (or ISO) → "YYYY-MM-DD" (the site requires ISO). Nearest upcoming year.
function toISO(d) {
  const raw = String(d || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(+iso[2]).padStart(2, "0")}-${String(+iso[3]).padStart(2, "0")}`;
  const md = raw.match(/(\d{1,2})\D+(\d{1,2})/);
  if (!md) return "";
  const mm = +md[1], dd = +md[2];
  const now = new Date();
  let yr = now.getFullYear();
  const cand = new Date(yr, mm - 1, dd);
  if (cand.getTime() < now.getTime() - 60 * 86400000) yr += 1;
  return `${yr}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function toListing(ev, weekendDates) {
  // Weekend events only carry a day (Fri/Sat/Sun) — fill the real date from the
  // weekend anchor so they aren't dropped as "undated".
  const rawDate = String(ev.date || "").trim() || (weekendDates && weekendDates[ev.day]) || "";
  return {
    name: ev.name || "",
    event_type: ev.type || "",
    city: ev.area || "",
    region: ev.region ? `${ev.region} NJ`.replace(/ NJ NJ$/, " NJ") : "",
    date: toISO(rawDate),
    instagram_handle: ev.igHandle || "",
    learn_more_url: ev.link || "",
  };
}

// Read an uploaded image, downscale it (max 1600px wide, JPEG q0.85) and return
// a data URL. Downscaling keeps the hero from blowing past the payload limit —
// the website stores whatever string lands in hero_image_url, and a data URI
// renders as an <img src> the same as a hosted link.
function fileToHeroDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type || "")) { reject(new Error("Pick an image file (JPG/PNG/WebP).")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a readable image."));
      img.onload = () => {
        const maxW = 1600;
        const scale = Math.min(1, maxW / (img.width || maxW));
        const w = Math.max(1, Math.round((img.width || maxW) * scale));
        const h = Math.max(1, Math.round((img.height || maxW) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL("image/jpeg", 0.85)); }
        catch (e) { reject(new Error("Couldn't process that image.")); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const L = { fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase", fontWeight: 700, display: "block", marginBottom: 4 };
const I = { width: "100%", padding: "8px 10px", background: "#111", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 5, color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.82rem", outline: "none", boxSizing: "border-box" };

export function PublishGuideModal({ open, apiKey, events = [], weekendDates = null, voice = null, onClose }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [theme, setTheme] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [heroDataUrl, setHeroDataUrl] = useState(""); // uploaded photo (downscaled data URL)
  const [heroBusy, setHeroBusy] = useState(false);
  const [published, setPublished] = useState(false);
  // Accepting submissions turns ON the event list / submission intake on the
  // published page — a guide is meant to show its listings, so default it on.
  const [acceptingSubmissions, setAcceptingSubmissions] = useState(true);
  // Email gate stays on for guide pages by default (capture visitors before the
  // list). Toggle is here in case a page should be open.
  const [emailGate, setEmailGate] = useState(true);
  const [body, setBody] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [pubBusy, setPubBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  // Effective hero: an uploaded photo wins over a pasted URL.
  const heroImage = heroDataUrl || heroUrl.trim();

  const onHeroFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHeroBusy(true); setMsg(null);
    try { setHeroDataUrl(await fileToHeroDataUrl(file)); }
    catch (err) { setMsg({ ok: false, text: String(err?.message || err) }); }
    finally { setHeroBusy(false); if (e.target) e.target.value = ""; }
  };

  useEffect(() => {
    if (open) { setMsg(null); }
  }, [open]);

  // Auto-derive the slug from the title until the user edits the slug directly.
  useEffect(() => { if (!slugTouched) setSlug(slugify(title)); }, [title, slugTouched]);

  const listings = useMemo(() => events.map(e => toListing(e, weekendDates)), [events, weekendDates]);
  const valid = listings.filter(l => l.name && l.date);
  const skipped = listings.length - valid.length;

  if (!open) return null;

  const generate = async () => {
    if (genBusy) return;
    if (!apiKey) { setMsg({ ok: false, text: "Add your Gemini API key on the Media tab first." }); return; }
    if (!title.trim()) { setMsg({ ok: false, text: "Give the guide a title first — it steers the write-up." }); return; }
    setGenBusy(true); setMsg(null);
    try {
      const html = await generateGuideCommentary({ apiKey, title, theme, events, voice });
      setBody(html);
    } catch (e) {
      setMsg({ ok: false, text: String(e?.message || e) });
    } finally { setGenBusy(false); }
  };

  const publish = async () => {
    if (pubBusy) return;
    if (!title.trim() || !slug.trim()) { setMsg({ ok: false, text: "Title and slug are required." }); return; }
    if (valid.length === 0) { setMsg({ ok: false, text: "No dateable events to publish — the site needs a date on each listing." }); return; }
    if (!window.confirm(`Publish "${title}" to centralgroupevents.com/${slug}?\n\n${valid.length} listing${valid.length === 1 ? "" : "s"}${skipped ? ` (${skipped} skipped — no date)` : ""}${published ? "\nPublished live." : "\nSaved as a draft (not public)."}`)) return;
    setPubBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/website/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, title,
          body_content: body,
          hero_image_url: heroImage || undefined,
          published,
          accepting_submissions: acceptingSubmissions,
          email_gate: emailGate,
          listings: valid,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const hint = r.status === 503 ? "Add CGE_INTEGRATION_TOKEN in this app's Replit Secrets (same value as the website)."
          : r.status === 401 ? "Token mismatch — the website rejected it. Make sure both secrets are identical."
          : (j.message || j.detail || `Server responded ${r.status}`);
        throw new Error(hint);
      }
      const n = (typeof j.listings === "number") ? j.listings : valid.length;
      const errN = Array.isArray(j.errors) ? j.errors.length : 0;
      setMsg({
        ok: true,
        text: `${published ? "Published" : "Saved as draft"}: ${n} listing${n === 1 ? "" : "s"} on /${j.slug || slug}.${errN ? ` (${errN} row${errN === 1 ? "" : "s"} had errors.)` : ""}${skipped ? ` ${skipped} undated skipped.` : ""}`,
      });
    } catch (e) {
      setMsg({ ok: false, text: String(e?.message || e) });
    } finally { setPubBusy(false); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, background: "#141416", border: "1px solid rgba(245,240,232,0.12)", borderRadius: 14, padding: "20px 20px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "1.15rem", flex: 1 }}>📄 Publish to Guide</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.5)", fontSize: "1.1rem", cursor: "pointer" }}>×</button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: "0.8rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.5 }}>
          Publishes a themed guide page to centralgroupevents.com — an AI-written intro in your brand voice + these events as listings. Re-publishing only replaces listings this tool created.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={L}>Guide title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="2026 Juneteenth in New Jersey" style={I} />
          </div>
          <div>
            <label style={L}>URL slug</label>
            <input value={slug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} placeholder="juneteenth-in-nj" style={I} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={L}>Theme / occasion <span style={{ textTransform: "none", color: "rgba(245,240,232,0.3)" }}>(optional — steers the write-up)</span></label>
            <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Juneteenth" style={I} />
          </div>
          <div>
            <label style={L}>Hero image <span style={{ textTransform: "none", color: "rgba(245,240,232,0.3)" }}>(optional — link or upload)</span></label>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={heroDataUrl ? "" : heroUrl} onChange={(e) => setHeroUrl(e.target.value)} disabled={!!heroDataUrl} placeholder={heroDataUrl ? "Using uploaded photo" : "https://…"} style={{ ...I, opacity: heroDataUrl ? 0.5 : 1 }} />
              <label title="Upload a photo" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", padding: "0 10px", background: "rgba(139,92,246,0.14)", color: "#A78BFA", border: "1px solid rgba(139,92,246,0.4)", borderRadius: 5, cursor: heroBusy ? "wait" : "pointer", fontSize: "0.7rem", fontWeight: 700 }}>
                {heroBusy ? "…" : "📷"}
                <input type="file" accept="image/*" onChange={onHeroFile} style={{ display: "none" }} />
              </label>
            </div>
            {heroDataUrl && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                <img src={heroDataUrl} alt="hero preview" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4, border: "1px solid rgba(245,240,232,0.15)" }} />
                <button onClick={() => setHeroDataUrl("")} style={{ background: "transparent", border: "1px solid rgba(251,113,133,0.4)", color: "#FB7185", borderRadius: 4, padding: "3px 8px", fontSize: "0.66rem", cursor: "pointer" }}>Remove photo</button>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
            <label style={{ ...L, marginBottom: 0 }}>Editorial write-up <span style={{ textTransform: "none", color: "rgba(245,240,232,0.3)" }}>(HTML — shows above the listings)</span></label>
            <div style={{ flex: 1 }} />
            <button onClick={generate} disabled={genBusy} style={{ padding: "4px 10px", borderRadius: 5, cursor: genBusy ? "wait" : "pointer", background: "rgba(139,92,246,0.14)", color: "#A78BFA", border: "1px solid rgba(139,92,246,0.4)", fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.5px", textTransform: "uppercase" }}>
              {genBusy ? "✨ Writing…" : "✨ Generate in brand voice"}
            </button>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} placeholder="Write, or hit ✨ Generate — an intro in your CGE voice grounded in NJ + Black culture. Editable before you publish." style={{ ...I, resize: "vertical", lineHeight: 1.5 }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.8rem", color: "#F5F0E8", cursor: "pointer" }}>
            <input type="checkbox" checked={acceptingSubmissions} onChange={(e) => setAcceptingSubmissions(e.target.checked)} style={{ accentColor: "#63B3ED" }} />
            Accepting submissions <span style={{ color: "rgba(245,240,232,0.4)", fontSize: "0.72rem" }}>(turns on the event list)</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.8rem", color: "#F5F0E8", cursor: "pointer" }}>
            <input type="checkbox" checked={emailGate} onChange={(e) => setEmailGate(e.target.checked)} style={{ accentColor: "#E5BC4F" }} />
            Email gate <span style={{ color: "rgba(245,240,232,0.4)", fontSize: "0.72rem" }}>(capture email before the list)</span>
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.8rem", color: "#F5F0E8", cursor: "pointer" }}>
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} style={{ accentColor: "#34D399" }} />
            Publish live now <span style={{ color: "rgba(245,240,232,0.4)", fontSize: "0.72rem" }}>(off = save as draft)</span>
          </label>
          <span style={{ marginLeft: "auto", fontSize: "0.74rem", color: "rgba(245,240,232,0.5)" }}>
            <b style={{ color: "#34D399" }}>{valid.length}</b> listing{valid.length === 1 ? "" : "s"}{skipped ? <span style={{ color: "#FBbf47" }}> · {skipped} undated skipped</span> : null}
          </span>
        </div>

        {msg && (
          <div style={{ marginBottom: 14, padding: "9px 12px", borderRadius: 8, fontSize: "0.8rem",
            background: msg.ok ? "rgba(52,211,153,0.1)" : "rgba(251,113,133,0.1)",
            border: `1px solid ${msg.ok ? "rgba(52,211,153,0.4)" : "rgba(251,113,133,0.4)"}`,
            color: msg.ok ? "#34D399" : "#FB7185" }}>
            {msg.ok ? "✓ " : "⚠ "}{msg.text}
          </div>
        )}

        <button onClick={publish} disabled={pubBusy} style={{ width: "100%", padding: "12px", borderRadius: 8, border: "none", cursor: pubBusy ? "wait" : "pointer", background: "#34D399", color: "#06281d", fontWeight: 800, fontSize: "0.9rem", letterSpacing: "0.3px" }}>
          {pubBusy ? "Publishing…" : `📄 Publish ${valid.length} listing${valid.length === 1 ? "" : "s"} to the guide`}
        </button>
      </div>
    </div>,
    document.body
  );
}
