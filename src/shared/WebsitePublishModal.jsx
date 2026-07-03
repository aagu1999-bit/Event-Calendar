import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  loadPublishConfig,
  savePublishConfig,
  buildWebsitePayload,
  publishToGitHub,
} from "./websitePublish.js";

// "Send to Website" modal — pushes the reviewed events to the Central Group
// Events site repo as a single events.json commit. Config (repo + token) is
// stored locally; the token is a fine-grained PAT with Contents: write on the
// one repo. Shows a live preview of the exact JSON before publishing.
//
// Props:
//   open      — boolean
//   events    — the reviewed events to publish (array)
//   onClose()
export function WebsitePublishModal({ open, events, onClose }) {
  const [cfg, setCfg] = useState(loadPublishConfig());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { htmlUrl } on success
  const [error, setError] = useState("");
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (open) {
      setCfg(loadPublishConfig());
      setResult(null);
      setError("");
      setBusy(false);
    }
  }, [open]);

  // Preview the exact payload that will be written (minus the timestamp, which
  // is stamped at publish time). Recomputed as events change.
  const payloadPreview = useMemo(
    () => buildWebsitePayload(events, "(stamped at publish time)"),
    [events]
  );
  const publishCount = useMemo(
    () => (Array.isArray(events) ? events.filter(e => e && (e.name || "").trim()).length : 0),
    [events]
  );

  if (!open) return null;

  const setField = (k, v) => setCfg(prev => ({ ...prev, [k]: v }));

  const handlePublish = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    // Persist config (incl. token) so the next publish is one click.
    savePublishConfig(cfg);
    try {
      const stamp = (() => { try { return new Date().toISOString(); } catch { return null; } })();
      const contentString = buildWebsitePayload(events, stamp);
      const res = await publishToGitHub({
        token: cfg.token,
        owner: cfg.owner,
        repo: cfg.repo,
        path: cfg.path,
        branch: cfg.branch,
        contentString,
        message: `Update events from CGE Tools (${publishCount} events)`,
      });
      setResult(res);
    } catch (err) {
      console.error(err);
      setError(err.message || "Publish failed");
    } finally {
      setBusy(false);
    }
  };

  const label = { fontSize: "0.6rem", letterSpacing: 1, textTransform: "uppercase", color: "rgba(245,240,232,0.5)", display: "block", marginBottom: 3, fontFamily: "'Syne',sans-serif" };
  const input = { width: "100%", padding: "7px 9px", background: "#111", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4, color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif", fontSize: "0.72rem", outline: "none", boxSizing: "border-box" };

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f0f0f", border: "1px solid rgba(99,179,237,0.35)", borderRadius: 8, padding: 22, maxWidth: 640, width: "100%", maxHeight: "90vh", overflowY: "auto", color: "#F5F0E8", fontFamily: "'DM Sans',sans-serif" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.1rem", fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 0.5, margin: 0 }}>
            🌐 Send to Website
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "rgba(245,240,232,0.55)", fontSize: "1.4rem", cursor: "pointer", lineHeight: 1 }} title="Close">×</button>
        </div>

        <div style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)", marginBottom: 14, lineHeight: 1.5 }}>
          Publishes <strong>{publishCount}</strong> reviewed event{publishCount === 1 ? "" : "s"} to your site repo as <code style={{ color: "#63B3ED" }}>{cfg.path}</code>. Uses a GitHub token stored only on this device.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={label}>Repo owner</label>
            <input value={cfg.owner} onChange={e => setField("owner", e.target.value)} style={input} placeholder="centralgroupevents" />
          </div>
          <div>
            <label style={label}>Repo name</label>
            <input value={cfg.repo} onChange={e => setField("repo", e.target.value)} style={input} placeholder="Central-Group-Events" />
          </div>
          <div>
            <label style={label}>File path</label>
            <input value={cfg.path} onChange={e => setField("path", e.target.value)} style={input} placeholder="data/events.json" />
          </div>
          <div>
            <label style={label}>Branch</label>
            <input value={cfg.branch} onChange={e => setField("branch", e.target.value)} style={input} placeholder="main" />
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={label}>
            GitHub token (fine-grained · Contents: Read and write · this repo only)
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type={showToken ? "text" : "password"}
              value={cfg.token}
              onChange={e => setField("token", e.target.value)}
              style={{ ...input, fontFamily: "ui-monospace,Menlo,monospace" }}
              placeholder="github_pat_…"
              autoComplete="off"
            />
            <button
              onClick={() => setShowToken(s => !s)}
              style={{ padding: "5px 10px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)", borderRadius: 4, color: "rgba(245,240,232,0.6)", fontSize: "0.62rem", cursor: "pointer", whiteSpace: "nowrap" }}
            >{showToken ? "Hide" : "Show"}</button>
          </div>
          <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.35)", marginTop: 4, lineHeight: 1.4 }}>
            Create at github.com → Settings → Developer settings → Fine-grained tokens. Kept in this browser's localStorage only — never sent to CGE Tools servers.
          </div>
        </div>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ fontSize: "0.62rem", color: "rgba(99,179,237,0.85)", cursor: "pointer", letterSpacing: 0.5, fontFamily: "'Syne',sans-serif", textTransform: "uppercase" }}>
            Preview payload ({publishCount} events)
          </summary>
          <pre style={{ marginTop: 8, padding: 10, background: "#0a0a0a", border: "1px solid rgba(245,240,232,0.08)", borderRadius: 4, fontSize: "0.6rem", color: "rgba(245,240,232,0.7)", overflowX: "auto", maxHeight: 200, lineHeight: 1.45 }}>
            {payloadPreview}
          </pre>
        </details>

        {error && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(251,113,133,0.08)", border: "1px solid rgba(251,113,133,0.3)", borderRadius: 4, fontSize: "0.7rem", color: "rgba(251,113,133,0.95)" }}>
            <strong>Error:</strong> {error}
          </div>
        )}
        {result && (
          <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 4, fontSize: "0.72rem", color: "rgba(52,211,153,0.95)" }}>
            ✓ Published {publishCount} events.{" "}
            {result.htmlUrl && (
              <a href={result.htmlUrl} target="_blank" rel="noreferrer" style={{ color: "#63B3ED" }}>View the commit →</a>
            )}
          </div>
        )}

        <button
          onClick={handlePublish}
          disabled={busy || !cfg.token || publishCount === 0}
          style={{
            width: "100%", padding: "12px 18px",
            background: busy ? "rgba(99,179,237,0.4)" : ((cfg.token && publishCount) ? "#63B3ED" : "rgba(99,179,237,0.25)"),
            color: "#000", border: "none", borderRadius: 4,
            fontSize: "0.78rem", fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase",
            cursor: busy ? "wait" : ((cfg.token && publishCount) ? "pointer" : "not-allowed"),
            fontFamily: "'Syne',sans-serif",
          }}
        >{busy ? "Publishing…" : `→ Publish ${publishCount} events to the site`}</button>
      </div>
    </div>,
    document.body
  );
}
