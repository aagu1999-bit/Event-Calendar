import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { scoutNews } from "./aiContent.js";

// News Scout (the "news agent"). Two halves:
//   • INBOX — the autonomous server cron accumulates ranked, deduped stories
//     at /api/scout/*; this modal shows them and lets you act on each. (Only
//     present when the Node server is running; a static deploy has no inbox.)
//   • SCAN NOW — an on-demand browser scout for a specific area/focus.
// Both hunt timely, event-based Black-culture / community happenings in NJ
// that fit the CGE beat and rank them best-first. Each story can be dropped
// into a single News slide or sent to AI Fill to become a whole carousel.
//
// Props:
//   open, apiKey, onClose()
//   onUse(candidate)           — map into the News slot, switch to News mode
//   onBuildCarousel(candidate) — hand to AI Fill Template for a full carousel

const AREA_CHIPS = ["New Jersey", "Newark", "Jersey City", "Essex County", "East Orange", "Montclair", "Trenton", "Atlantic City"];

export function NewsScoutModal({ open, apiKey, onClose, onUse, onBuildCarousel }) {
  const [area, setArea] = useState("New Jersey");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);   // on-demand scan: { candidates, sources, brief }

  const [inbox, setInbox] = useState(null);      // server inbox: { items, unread, lastRun, ... }
  const [inboxBusy, setInboxBusy] = useState(false);

  // Load the server inbox each time the modal opens; clear its unread badge.
  // Fails silently when there's no server (static deploy) — inbox stays hidden.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/scout/inbox", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (!alive) return;
        setInbox(j);
        if (j.unread > 0) fetch("/api/scout/read", { method: "POST" }).catch(() => {});
      } catch { /* server absent — inbox section hidden */ }
    })();
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const scoreColor = (s) => (s >= 80 ? "#4ADE80" : s >= 60 ? "#E5BC4F" : "rgba(245,240,232,0.5)");

  const runScan = async () => {
    if (busy) return;
    if (!apiKey) { setError("Add your Gemini API key in the Media tool first."); return; }
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await scoutNews({ apiKey, area, focus });
      setResult(r);
      if (!r.candidates.length) setError("Nothing fit the beat this run. Try a broader area, or a different focus (e.g. a city, 'Juneteenth', 'day parties').");
    } catch (e) {
      setError(e?.message || "Scout failed — check the key and try again.");
    } finally { setBusy(false); }
  };

  const runServerScout = async () => {
    if (inboxBusy) return;
    setInboxBusy(true);
    try {
      const r = await fetch("/api/scout/run", { method: "POST" });
      const j = await r.json();
      setInbox((prev) => ({ ...(prev || {}), ...j }));
    } catch { /* ignore */ } finally { setInboxBusy(false); }
  };

  const dismiss = async (id) => {
    try {
      const r = await fetch(`/api/scout/dismiss/${encodeURIComponent(id)}`, { method: "POST" });
      const j = await r.json();
      setInbox((prev) => ({ ...(prev || {}), items: j.items, unread: j.unread }));
    } catch { /* ignore */ }
  };

  // One story card, shared by the inbox and the on-demand scan.
  const Card = (c, key, onDismiss) => (
    <div key={key} style={{ padding: "12px 14px", background: "rgba(245,240,232,0.03)", border: "1px solid rgba(245,240,232,0.08)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
        {c.kicker && <span style={{ fontSize: "0.55rem", letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 800, color: "#E5BC4F" }}>{c.kicker}</span>}
        <span style={{ marginLeft: "auto", fontSize: "0.6rem", fontWeight: 800, color: scoreColor(c.score), fontFamily: "'Syne',sans-serif" }}>{c.score}<span style={{ color: "rgba(245,240,232,0.3)", fontWeight: 400 }}> fit</span></span>
      </div>
      <div style={{ fontSize: "0.92rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, lineHeight: 1.2, marginBottom: 5 }}>{c.headline}</div>
      {c.body && <div style={{ fontSize: "0.72rem", color: "rgba(245,240,232,0.75)", lineHeight: 1.5, marginBottom: 6 }}>{c.body}</div>}
      {c.whenWhere && <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.45)", marginBottom: 8 }}>📍 {c.whenWhere}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => { onUse?.(c); onClose?.(); }} title="Drop this story into a single News slide, ready to edit"
          style={{ padding: "6px 12px", background: "rgba(229,188,79,0.16)", color: "#E5BC4F", border: "1px solid rgba(229,188,79,0.4)", borderRadius: 4, fontSize: "0.64rem", fontWeight: 700, letterSpacing: 0.5, fontFamily: "'Syne',sans-serif", cursor: "pointer", textTransform: "uppercase" }}>Use in News slot →</button>
        <button onClick={() => { onBuildCarousel?.(c); onClose?.(); }} title="Send this story to AI Fill Template to generate a whole news carousel"
          style={{ padding: "6px 12px", background: "transparent", color: "#63B3ED", border: "1px solid rgba(99,179,237,0.45)", borderRadius: 4, fontSize: "0.64rem", fontWeight: 700, letterSpacing: 0.5, fontFamily: "'Syne',sans-serif", cursor: "pointer", textTransform: "uppercase" }}>✨ Build carousel →</button>
        {onDismiss && <button onClick={onDismiss} title="Dismiss from inbox" style={{ marginLeft: "auto", padding: "6px 9px", background: "transparent", color: "rgba(251,113,133,0.6)", border: "1px solid rgba(251,113,133,0.25)", borderRadius: 4, fontSize: "0.64rem", fontWeight: 700, cursor: "pointer" }}>✕</button>}
      </div>
    </div>
  );

  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.78)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0f0f0f", border: "1px solid rgba(229,188,79,0.35)", borderRadius: 8, padding: 24, maxWidth: 760, width: "100%", maxHeight: "90vh", overflowY: "auto", color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.15rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 1, margin: 0 }}>🗞️ News Scout</h2>
          <button onClick={onClose} title="Close" style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.55)", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)", marginBottom: 16, lineHeight: 1.5 }}>
          Timely, event-based <strong>Black culture &amp; community happenings in New Jersey</strong> that fit what CGE covers. The scout runs on its own each morning (below) — or scan on demand. <strong>Use in News slot</strong> for one slide, <strong>Build carousel</strong> for a whole post.
        </div>

        {/* ===== INBOX (server cron) ===== */}
        {inbox && (
          <div style={{ marginBottom: 20, padding: "12px 14px", background: "rgba(99,179,237,0.05)", border: "1px solid rgba(99,179,237,0.2)", borderRadius: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.62rem", letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 800, color: "#63B3ED", fontFamily: "'Syne',sans-serif" }}>📥 Inbox · {inbox.items?.length || 0}</span>
              <button onClick={runServerScout} disabled={inboxBusy} title="Run the scout now instead of waiting for the morning cron"
                style={{ marginLeft: "auto", padding: "5px 11px", background: inboxBusy ? "rgba(99,179,237,0.25)" : "rgba(99,179,237,0.14)", color: "#63B3ED", border: "1px solid rgba(99,179,237,0.4)", borderRadius: 4, fontSize: "0.6rem", fontWeight: 700, letterSpacing: 0.5, fontFamily: "'Syne',sans-serif", cursor: inboxBusy ? "wait" : "pointer", textTransform: "uppercase" }}>
                {inboxBusy ? "Running…" : "🔄 Run now"}
              </button>
            </div>
            <div style={{ fontSize: "0.58rem", color: "rgba(245,240,232,0.4)", lineHeight: 1.5, marginBottom: inbox.items?.length ? 10 : 0 }}>
              {inbox.lastRun ? `Last run ${fmtWhen(inbox.lastRun)}` : "Not run yet"}
              {" · "}{inbox.enabled ? "auto-scan on" : "auto-scan off"}
              {" · "}{inbox.emailConfigured ? `emailing ${inbox.emailTo}` : "email off"}
              {!inbox.hasKey && <span style={{ color: "#FB7185" }}> · ⚠ set GEMINI_API_KEY on the server</span>}
              {inbox.lastError && <span style={{ color: "#FB7185" }}> · {inbox.lastError}</span>}
            </div>
            {inbox.items?.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {inbox.items.map((c) => Card(c, c.id, () => dismiss(c.id)))}
              </div>
            )}
          </div>
        )}

        {/* ===== ON-DEMAND SCAN ===== */}
        <div style={{ fontSize: "0.55rem", letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, color: "rgba(245,240,232,0.4)", marginBottom: 8 }}>Scan now · on demand</div>

        <div style={{ fontSize: "0.55rem", letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, color: "rgba(245,240,232,0.4)", marginBottom: 6 }}>Area</div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
          {AREA_CHIPS.map((a) => (
            <button key={a} onClick={() => setArea(a)} style={{ padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: "0.62rem", fontWeight: 700, fontFamily: "'Syne',sans-serif", background: area === a ? "rgba(229,188,79,0.18)" : "rgba(245,240,232,0.04)", color: area === a ? "#E5BC4F" : "rgba(245,240,232,0.5)", border: area === a ? "1px solid rgba(229,188,79,0.5)" : "1px solid transparent" }}>{a}</button>
          ))}
        </div>
        <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="…or type any NJ area"
          style={{ width: "100%", padding: "8px 10px", background: "#141414", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4, color: "#F5F0E8", fontSize: "0.75rem", marginBottom: 12, fontFamily: "'DM Sans',sans-serif", outline: "none" }} />

        <div style={{ fontSize: "0.55rem", letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, color: "rgba(245,240,232,0.4)", marginBottom: 6 }}>Focus this run · optional</div>
        <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. Juneteenth · day parties · new restaurant openings · HBCU"
          style={{ width: "100%", padding: "8px 10px", background: "#141414", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4, color: "#F5F0E8", fontSize: "0.75rem", marginBottom: 14, fontFamily: "'DM Sans',sans-serif", outline: "none" }} />

        <button onClick={runScan} disabled={busy}
          style={{ width: "100%", padding: "11px", background: busy ? "rgba(229,188,79,0.4)" : "#E5BC4F", color: "#141414", border: "none", borderRadius: 5, fontSize: "0.8rem", fontWeight: 800, letterSpacing: 0.5, fontFamily: "'Syne',sans-serif", cursor: busy ? "wait" : "pointer", textTransform: "uppercase" }}>
          {busy ? "🔎 Scanning the web…" : "🔎 Scan for stories"}
        </button>
        {busy && <div style={{ fontSize: "0.62rem", color: "rgba(245,240,232,0.45)", marginTop: 8, textAlign: "center", lineHeight: 1.5 }}>Running several grounded searches, then ranking by beat-fit. Takes ~10-20s.</div>}

        {error && <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(251,113,133,0.08)", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 4, fontSize: "0.68rem", color: "#FB7185", lineHeight: 1.5 }}>{error}</div>}

        {result?.candidates?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: "0.55rem", letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, color: "rgba(245,240,232,0.4)", marginBottom: 10 }}>{result.candidates.length} stories · best fit first</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {result.candidates.map((c, i) => Card(c, `scan-${i}`, null))}
            </div>
          </div>
        )}

        {result?.sources?.length > 0 && (
          <details style={{ marginTop: 16, background: "rgba(99,179,237,0.05)", border: "1px solid rgba(99,179,237,0.2)", borderRadius: 6 }}>
            <summary style={{ padding: "9px 12px", cursor: "pointer", fontSize: "0.62rem", color: "#63B3ED", letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, fontFamily: "'Syne',sans-serif", listStyle: "none" }}>🔗 {result.sources.length} source{result.sources.length === 1 ? "" : "s"} the scan pulled from</summary>
            <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
              {result.sources.map((s, i) => (
                <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.66rem", color: "rgba(99,179,237,0.85)", textDecoration: "none", lineHeight: 1.4, wordBreak: "break-word" }}>{i + 1}. {s.title}</a>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>,
    document.body
  );
}
