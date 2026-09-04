// Tiny Express server that does two jobs:
//   1. Hosts the Vite dev server as middleware (no separate proxy needed)
//   2. Exposes /api/workspaces — list / get / put / delete — so the team
//      can save and re-load workspace zips inside the Repl instead of
//      shuttling files through Drive.
//
// Persists to ./data/workspaces/*.cgework.zip on the Repl's filesystem.
// Replit keeps this folder across Repl restarts in the editor environment.
// Deployed (static) builds DO NOT run this server — the cloud buttons
// detect that at boot and hide themselves.
//
// No auth: anyone with the Repl URL can read/write. That's the intentional
// trade-off for "small team, private URL." Don't deploy this publicly.

import express from "express";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { runScout, storyKey, focusForDay } from "./scoutServer.js";
import { createSessionStore, normalizeSession, applySessionOps } from "./reviewSessionStore.js";
import { createPoolStore } from "./screenshotPoolStore.js";
import { normalizeImageDataUrl, usableImageDataUrl, toPreviewDataUrl, sniffImageKind } from "./normalizeImage.js";
import { classifyShare, isInstagramUrl, coerceShareBody } from "./shareIntake.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "5000", 10);
const DATA_DIR = path.resolve(__dirname, "data/workspaces");
const LIBRARY_DIRS = {
  photos:  path.resolve(__dirname, "data/library/photos"),
  exports: path.resolve(__dirname, "data/library/exports"),
};
const NODE_ENV = process.env.NODE_ENV || "development";

const app = express();

// Filename guard — Replit's filesystem doesn't care about UTF-8 weirdness,
// but we don't want anyone reading /etc/passwd via "../../../passwd".
function safeName(raw) {
  const base = path.basename(String(raw || ""));
  if (!base || base.startsWith(".") || base.includes("..") || base.length > 200) return null;
  return base;
}

// ID guard for library items — alphanumeric + dash + underscore, up to 100
// chars. Covers crypto.randomUUID() and our fallback `p_<ts>_<rand>` keys.
function safeId(raw) {
  const s = String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return s && s.length <= 100 ? s : null;
}

function getLibDir(kind) {
  return LIBRARY_DIRS[kind] || null;
}

// Decode either a `data:image/png;base64,XXXX` URL or a plain base64 string
// into a Node Buffer ready to write to disk.
function base64ToBuffer(s) {
  const idx = s.indexOf(",");
  const b64 = idx >= 0 ? s.slice(idx + 1) : s;
  return Buffer.from(b64, "base64");
}

// === API ROUTES ===

// List every workspace in the data dir, newest first.
app.get("/api/workspaces", async (_req, res) => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const files = await fs.readdir(DATA_DIR);
    const out = [];
    for (const f of files) {
      if (!/\.(zip|cgework)$/i.test(f)) continue;
      try {
        const s = await fs.stat(path.join(DATA_DIR, f));
        out.push({ name: f, size: s.size, mtime: s.mtimeMs });
      } catch { /* file vanished mid-listdir — ignore */ }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download one workspace by name.
app.get("/api/workspaces/:name", async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid filename" });
  const full = path.join(DATA_DIR, name);
  if (!existsSync(full)) return res.status(404).json({ error: "Not found" });
  res.sendFile(full);
});

// Upload (overwrites). Body is the raw zip — client sets Content-Type
// application/zip and ships the Blob from JSZip.generateAsync.
app.put("/api/workspaces/:name", express.raw({ type: "*/*", limit: "500mb" }), async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid filename" });
  if (!req.body || !req.body.length) return res.status(400).json({ error: "Empty body" });
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, name), req.body);
    res.json({ ok: true, name, size: req.body.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/workspaces/:name", async (req, res) => {
  const name = safeName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid filename" });
  try {
    await fs.unlink(path.join(DATA_DIR, name));
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Not found" });
    res.status(500).json({ error: err.message });
  }
});

// === LIBRARY (photos + exports) ===
// Same model as workspaces: per-Repl filesystem persistence, no auth,
// anyone on the URL can read/write. Goal is "single source of truth" so
// every device hitting the Repl URL sees the same photo + export library
// instead of each browser tracking its own IndexedDB.
//
// On-disk layout per item:
//   data/library/<kind>/<id>.bin    — original blob (full photo / export)
//   data/library/<kind>/<id>.thumb  — 240px JPEG preview (optional)
//   data/library/<kind>/<id>.json   — metadata record (id, name, mime,
//                                     sourceTool, sourceMode, width,
//                                     height, bytes, createdAt, kind,
//                                     snapshot, hasSnapshot…)
//
// Three files per item keeps the list endpoint fast (just glob the
// .json files, no Buffer parsing) and lets the blob/thumb fetches
// stream straight from disk via res.sendFile.

// List every item in a library, newest first. Returns metadata only —
// the blob + thumb URLs are derived client-side from the id.
app.get("/api/library/:kind", async (req, res) => {
  const dir = getLibDir(req.params.kind);
  if (!dir) return res.status(404).json({ error: "Unknown library kind" });
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const out = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
        // Strip the heavy `snapshot` (a full carousel with base64 images) from
        // the LIST. Returning all snapshots made res.json() allocate hundreds
        // of MB and OOM-crash the deployment. Clients only need to know a
        // snapshot exists; the full record is fetched by id when restoring.
        if (meta && typeof meta === "object") {
          meta.hasSnapshot = ("snapshot" in meta) ? !!meta.snapshot : !!meta.hasSnapshot;
          delete meta.snapshot;
          out.push(meta);
        }
      } catch { /* corrupt — skip */ }
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch the FULL metadata for a single item, including the heavy `snapshot`
// that the list endpoint strips out. Callers use this when they actually
// need the snapshot (restoring a draft, exporting a workspace) — one record
// at a time, so it never allocates the whole library at once.
app.get("/api/library/:kind/:id/meta", async (req, res) => {
  const dir = getLibDir(req.params.kind);
  const id = safeId(req.params.id);
  if (!dir || !id) return res.status(400).json({ error: "Bad request" });
  const metaPath = path.join(dir, `${id}.json`);
  if (!existsSync(metaPath)) return res.status(404).json({ error: "Not found" });
  try {
    res.json(JSON.parse(await fs.readFile(metaPath, "utf8")));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch the original blob. Sets Content-Type from the stored metadata
// so the browser handles image/* vs application/zip correctly.
app.get("/api/library/:kind/:id/blob", async (req, res) => {
  const dir = getLibDir(req.params.kind);
  const id = safeId(req.params.id);
  if (!dir || !id) return res.status(400).end();
  const blobPath = path.join(dir, `${id}.bin`);
  if (!existsSync(blobPath)) return res.status(404).end();
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), "utf8"));
    if (meta.mime) res.type(meta.mime);
    if (meta.name) res.setHeader("Content-Disposition", `inline; filename="${meta.name.replace(/"/g, "")}"`);
  } catch { /* default content-type is fine */ }
  res.sendFile(blobPath);
});

// Fetch the preview thumbnail. Always JPEG.
app.get("/api/library/:kind/:id/thumb", async (req, res) => {
  const dir = getLibDir(req.params.kind);
  const id = safeId(req.params.id);
  if (!dir || !id) return res.status(400).end();
  const thumbPath = path.join(dir, `${id}.thumb`);
  if (!existsSync(thumbPath)) return res.status(404).end();
  res.type("image/jpeg");
  res.sendFile(thumbPath);
});

// Upload (or overwrite) a library item. Body is JSON because we need
// to ship blob + thumb + metadata in one round trip; multipart would
// work too but JSON+base64 is simpler with no extra dependencies.
// The 50mb limit covers full-size 1080×1080 PNGs and reasonable carousel
// ZIPs; if a user uploads bigger they'll get a 413 and can resize.
app.post("/api/library/:kind", express.json({ limit: "50mb" }), async (req, res) => {
  const dir = getLibDir(req.params.kind);
  if (!dir) return res.status(404).json({ error: "Unknown library kind" });
  const { id: rawId, meta, blob, thumb } = req.body || {};
  const id = safeId(rawId);
  if (!id)   return res.status(400).json({ error: "Invalid id" });
  if (!meta || typeof meta !== "object") return res.status(400).json({ error: "Missing meta" });
  if (!blob || typeof blob !== "string") return res.status(400).json({ error: "Missing blob" });
  try {
    await fs.mkdir(dir, { recursive: true });
    // Write blob first, thumb next, metadata LAST. This way a partial
    // failure (e.g. disk full mid-write) doesn't leave orphan metadata
    // pointing at a missing file — the list endpoint would just not see
    // it because the .json hasn't been written.
    await fs.writeFile(path.join(dir, `${id}.bin`), base64ToBuffer(blob));
    if (thumb && typeof thumb === "string") {
      await fs.writeFile(path.join(dir, `${id}.thumb`), base64ToBuffer(thumb));
    }
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(meta));
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all three files for an item. Best-effort — ENOENT on any of
// them is fine (the others may still need cleanup).
app.delete("/api/library/:kind/:id", async (req, res) => {
  const dir = getLibDir(req.params.kind);
  const id = safeId(req.params.id);
  if (!dir || !id) return res.status(400).end();
  try {
    for (const ext of [".bin", ".thumb", ".json"]) {
      try { await fs.unlink(path.join(dir, `${id}${ext}`)); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === LIBRARY URL IMPORT ===
// Fetch an image (or a webpage to scrape) on the user's behalf and return
// it to the client. Bypasses CORS — many image hosts block cross-origin
// fetches from the browser — and centralizes user-agent + rate-limiting.
//
// Security: only http/https, blocks private/loopback IP ranges to prevent
// SSRF, caps payload size, hard 30s timeout. Returns base64 so the JSON
// pipeline matches the existing /api/library/* upload format.

function isPrivateOrLocalHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0") return true;
  if (h.endsWith(".localhost") || h.endsWith(".local")) return true;
  // IPv4 private ranges
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true;
  // IPv6 loopback / link-local
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

// Scrape <img src> + <meta og:image> from an HTML body. Returns absolute
// URLs (resolved against the page URL), de-duped, with the OG image
// floated to the top so the user sees the "hero" thumbnail first.
function extractImagesFromHtml(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const push = (raw, priority = false) => {
    if (!raw) return;
    const trimmed = String(raw).trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:")) return;
    try {
      const abs = new URL(trimmed, baseUrl).href;
      if (seen.has(abs)) return;
      seen.add(abs);
      if (priority) out.unshift(abs);
      else out.push(abs);
    } catch { /* invalid URL */ }
  };
  // OG image first (priority)
  const og = /<meta[^>]+property\s*=\s*["']og:image(?::secure_url)?["'][^>]+content\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = og.exec(html))) push(m[1], true);
  // Standard <img src=...>
  const img = /<img[^>]+(?:src|data-src|data-original)\s*=\s*["']([^"']+)["']/gi;
  while ((m = img.exec(html))) push(m[1]);
  // srcset (take the first URL only — usually highest quality)
  const srcset = /<img[^>]+srcset\s*=\s*["']([^"']+)["']/gi;
  while ((m = srcset.exec(html))) {
    const first = m[1].split(",")[0].trim().split(/\s+/)[0];
    push(first);
  }
  return out;
}

app.post("/api/library/import-url", express.json({ limit: "1mb" }), async (req, res) => {
  const { url, allowHtml = true } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Missing url" });
  }
  let parsed;
  try { parsed = new URL(url.trim()); }
  catch { return res.status(400).json({ error: "Invalid URL" }); }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return res.status(400).json({ error: "Only http/https URLs allowed" });
  }
  if (isPrivateOrLocalHost(parsed.hostname)) {
    return res.status(400).json({ error: "Private / local URLs are blocked" });
  }

  try {
    const upstream = await fetch(parsed.href, {
      method: "GET",
      headers: {
        // Mimic a regular browser so sites don't 403 us. CGE Tools tag at
        // the end lets server operators identify the traffic.
        "User-Agent": "Mozilla/5.0 (compatible; CGETools/1.0; +photo-library-import)",
        "Accept": "image/*,text/html,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status} ${upstream.statusText}` });
    }

    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    const contentLength = parseInt(upstream.headers.get("content-length") || "0", 10);
    const MAX = 25 * 1024 * 1024;
    if (contentLength && contentLength > MAX) {
      return res.status(413).json({ error: `Resource too large (${(contentLength/1024/1024).toFixed(1)} MB)` });
    }

    if (contentType.startsWith("image/")) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX) {
        return res.status(413).json({ error: `Resource too large (${(buf.length/1024/1024).toFixed(1)} MB)` });
      }
      // Derive a sensible filename from the URL path.
      let basename = "imported-image";
      try {
        const p = decodeURIComponent(parsed.pathname);
        basename = path.basename(p) || basename;
        if (!/\.[a-z0-9]{2,5}$/i.test(basename)) {
          // No extension — guess from mime
          const ext = contentType.split("/")[1]?.split(";")[0]?.replace(/\W/g, "") || "jpg";
          basename = `${basename}.${ext}`;
        }
      } catch { /* keep default */ }
      return res.json({
        kind: "image",
        mime: contentType.split(";")[0],
        name: basename.slice(0, 200),
        sourceUrl: parsed.href,
        data: buf.toString("base64"),
      });
    }

    if (allowHtml && contentType.includes("text/html")) {
      // Cap HTML body size for the scrape — anything past 5MB is unlikely
      // to have meaningful additional img tags worth processing.
      const reader = upstream.body.getReader();
      const chunks = [];
      let total = 0;
      const HTML_MAX = 5 * 1024 * 1024;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > HTML_MAX) break;
        chunks.push(value);
      }
      const html = Buffer.concat(chunks).toString("utf8");
      const images = extractImagesFromHtml(html, parsed.href);
      return res.json({
        kind: "html",
        sourceUrl: parsed.href,
        images,
      });
    }

    return res.status(415).json({ error: `Unsupported content-type: ${contentType || "(none)"}` });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return res.status(504).json({ error: "Upstream timeout" });
    }
    return res.status(502).json({ error: err.message || String(err) });
  }
});

// === STOCK PHOTO SEARCH (Pexels) ===
// Free-license candidate photos for a story (used by the News Scout to attach
// an atmospheric backdrop to a News slide). Needs a free PEXELS_API_KEY. Returns
// { photos:[{id,thumb,url,alt,photographer}], configured } — `url` is the full
// image the client imports through /api/library/import-url (same-origin, so the
// canvas export doesn't taint). Portrait orientation fits the News layout.
app.get("/api/photos/search", async (req, res) => {
  const key = (process.env.PEXELS_API_KEY || "").trim();
  const q = String(req.query.q || "").trim().slice(0, 120);
  const n = Math.min(Math.max(parseInt(req.query.n || "8", 10) || 8, 1), 15);
  if (!key) return res.json({ photos: [], configured: false });
  if (!q) return res.json({ photos: [], configured: true });
  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}&orientation=portrait`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) }
    );
    if (!r.ok) return res.status(502).json({ error: `Pexels ${r.status}`, photos: [], configured: true });
    const j = await r.json();
    const photos = (Array.isArray(j.photos) ? j.photos : []).map((p) => ({
      id: p.id,
      thumb: p.src?.medium || p.src?.small || p.src?.tiny || "",
      url: p.src?.large2x || p.src?.large || p.src?.original || "",
      alt: p.alt || "",
      photographer: p.photographer || "",
    })).filter((p) => p.url);
    res.json({ photos, configured: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e), photos: [], configured: true });
  }
});

// === REVIEW SESSIONS ===
// Named snapshots of the Review tab's working state (events list +
// approvals + filter). Same shape as workspaces — list / get / put /
// delete — but stored as plain JSON instead of zip files because the
// payload is small (events array + approvals map, no photos).
//
// Use case: "save my Friday triage at 4 PM, pick up Saturday morning
// from wherever I left off." Multiple parallel sessions are supported
// (e.g. one per weekend). Last write wins per session name.
const SESSIONS_DIR = path.resolve(__dirname, "data/review-sessions");

// The store picks Replit DB (truly cross-device) when REPLIT_DB_URL is set,
// else falls back to the filesystem dir above. It also runs a one-time,
// best-effort migration of any legacy on-disk sessions into the DB.
const sessionStore = createSessionStore(SESSIONS_DIR);

// Same name guard as workspaces — strip path traversal, leading dots,
// excessive length. Returns the bare base name (no extension) — the store
// owns the on-disk / key encoding.
function safeSessionName(raw) {
  const base = path.basename(String(raw || "").replace(/\.json$/i, ""));
  if (!base || base.startsWith(".") || base.includes("..") || base.length > 100) return null;
  return base;
}

// Lightweight status probe so the UI can show whether sessions are really
// in the cloud (Replit DB) or just on this instance's disk (filesystem).
app.get("/api/review-sessions-status", (_req, res) => {
  res.json({ ok: true, backend: sessionStore.backend });
});

// List every session, newest first, with name + savedAt + counts.
app.get("/api/review-sessions", async (_req, res) => {
  try {
    res.json(await sessionStore.list());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/review-sessions/:name", async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  try {
    const data = await sessionStore.get(name);
    if (data == null) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/review-sessions/:name", express.json({ limit: "10mb" }), async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  try {
    // Full overwrite (manual "Save" from the Sessions modal). Bump the
    // version counter so devices polling for changes pick it up.
    const data = await sessionStore.update(name, (old) => ({
      ...normalizeSession(req.body),
      version: (Number(old?.version) || 0) + 1,
    }));
    // Audit trail — full-overwrite saves are the riskiest write (they can
    // clobber a partner's work), so always leave a timestamped trace in the
    // deployment logs with before/after counts.
    console.log(
      `[sessions] FULL SAVE "${name}" v${data.version} — pending:${(data.pending || []).length} vetted:${(data.vetted || []).length} events:${(data.events || []).length}`
    );
    res.json({ ok: true, savedAt: data.savedAt, version: data.version, backend: sessionStore.backend });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Collaborative merge: a device sends only WHAT IT CHANGED (rows edited or
// removed, ids vetted, events added…) and the server folds those ops into
// the shared session atomically. This is what makes "two phones in one
// session" safe — neither device ever overwrites the other's work.
app.post("/api/review-sessions/:name/merge", express.json({ limit: "10mb" }), async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  try {
    const ops = req.body?.ops || {};
    const merged = await sessionStore.update(name, (old) => applySessionOps(old, ops));
    // Audit trail — one line per merge with what changed, so a "whose work
    // went where and when" timeline can be reconstructed from the
    // deployment logs after any sync mishap.
    const opSummary = [
      ops.upsertPending?.length ? `+${ops.upsertPending.length} rows` : "",
      ops.removePending?.length ? `-${ops.removePending.length} rows` : "",
      ops.addVetted?.length ? `+${ops.addVetted.length} vetted` : "",
      ops.removeVetted?.length ? `-${ops.removeVetted.length} vetted` : "",
      ops.setApprovals ? `${Object.keys(ops.setApprovals).length} approvals` : "",
      ops.upsertEvents?.length ? `+${ops.upsertEvents.length} events` : "",
    ].filter(Boolean).join(", ");
    console.log(
      `[sessions] MERGE "${name}" v${merged.version} — ${opSummary || "no-op"} → pending:${(merged.pending || []).length} vetted:${(merged.vetted || []).length}`
    );
    res.json({ ok: true, session: merged, backend: sessionStore.backend });
  } catch (err) {
    console.error(`[sessions] MERGE FAILED "${name}": ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Backup history — list automatic snapshots of a session (newest first).
// Only available on the Postgres backend; others return an empty list.
app.get("/api/review-sessions/:name/history", async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  try {
    const items = sessionStore.history ? await sessionStore.history(name) : [];
    res.json({ ok: true, snapshots: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore a session from one of its backup snapshots. The CURRENT state is
// snapshotted first (via the normal update path), so a restore is itself
// undoable. Version bumps so every synced device picks up the change.
app.post("/api/review-sessions/:name/restore/:snapshotId", async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  if (!sessionStore.historyGet) return res.status(400).json({ error: "Backups not supported on this storage backend" });
  try {
    const snap = await sessionStore.historyGet(name, Number(req.params.snapshotId));
    if (!snap) return res.status(404).json({ error: "Snapshot not found" });
    const restored = await sessionStore.update(name, (old) => ({
      ...snap,
      savedAt: Date.now(),
      version: (Number(old?.version) || 0) + 1,
    }));
    console.log(
      `[sessions] RESTORE "${name}" from snapshot ${req.params.snapshotId} → pending:${(restored.pending || []).length} vetted:${(restored.vetted || []).length}`
    );
    res.json({ ok: true, session: restored });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Presence: which devices are actively working in a session right now.
// In-memory only (single server instance) — a device "checks in" with its
// id every few seconds while it has the session open; anything not heard
// from in 30s is considered gone. Powers the "👥 2 devices" indicator.
const sessionPresence = new Map(); // name -> Map(deviceId -> lastSeenMs)
app.get("/api/review-sessions/:name/presence", (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  const device = String(req.query.device || "").slice(0, 64);
  const now = Date.now();
  let devices = sessionPresence.get(name);
  if (!devices) { devices = new Map(); sessionPresence.set(name, devices); }
  if (device) devices.set(device, now);
  for (const [id, seen] of devices) if (now - seen > 30000) devices.delete(id);
  if (!devices.size) sessionPresence.delete(name);
  res.json({ ok: true, activeDevices: devices.size });
});

app.delete("/api/review-sessions/:name", async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  try {
    const removed = await sessionStore.del(name);
    if (!removed) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === BRAND KIT — Repl-side persistence for the centralized brand
// identity (palette, typography, creator info, defaults, voice
// fingerprint, slot prompts). Previously lived ONLY in browser
// localStorage, so brand voice didn't follow the user across browsers /
// accounts / devices. With this endpoint, any browser hitting the
// same Repl URL gets the same brand kit on mount.
//
// Single file (data/brand-kit.json) — last write wins. The client-side
// brand store still keeps a localStorage copy as a write-through cache
// so empty-fetch on first load doesn't blank the UI, and offline edits
// still persist visibly until the next successful PUT.
const BRAND_KIT_FILE = path.resolve(__dirname, "data/brand-kit.json");

app.get("/api/brand-kit", async (_req, res) => {
  try {
    if (!existsSync(BRAND_KIT_FILE)) {
      // No server-side brand kit yet — client should fall back to its
      // own defaults / localStorage copy. 200 with empty body so the
      // client knows the server is reachable (vs a 404 which might
      // get interpreted as a network error).
      return res.json(null);
    }
    const data = JSON.parse(await fs.readFile(BRAND_KIT_FILE, "utf8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/brand-kit", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const body = req.body || {};
    // Validate the shape minimally — don't trust the client. Drops
    // unknown top-level keys; ensures the structure matches what the
    // brand store expects on read.
    const data = {
      palette: body.palette && typeof body.palette === "object" ? body.palette : {},
      alternateColors: !!body.alternateColors,
      alternateBgKey: typeof body.alternateBgKey === "string" ? body.alternateBgKey : "purple",
      fontPairKey: typeof body.fontPairKey === "string" ? body.fontPairKey : "default",
      creator: body.creator && typeof body.creator === "object" ? body.creator : {},
      defaults: body.defaults && typeof body.defaults === "object" ? body.defaults : {},
      voice: body.voice && typeof body.voice === "object"
        ? { description: String(body.voice.description || ""), exemplars: Array.isArray(body.voice.exemplars) ? body.voice.exemplars.filter(e => typeof e === "string") : [] }
        : { description: "", exemplars: [] },
      slotPrompts: body.slotPrompts && typeof body.slotPrompts === "object" ? body.slotPrompts : {},
      savedAt: Date.now(),
    };
    await fs.mkdir(path.dirname(BRAND_KIT_FILE), { recursive: true });
    await fs.writeFile(BRAND_KIT_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true, savedAt: data.savedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === SCREENSHOT POOL — persistent server-side stash ===
// The operator sees flyers on IG all week, drops each through the "📸 Add
// from screenshot" flow, previews/edits, and instead of dropping into the
// current queue chooses "Save to pool for later". Entries persist here and
// come back into the queue during that event's actual weekend review via a
// weekend-filter identical in behavior to the booking-import filter.
//
// Postgres (DATABASE_URL), not the deploy disk. A Replit republish wipes
// local files — that's how the pool vanished after Deploy. Same pattern
// as review sessions. Filesystem is a local-dev fallback only.
const POOL_DIR = path.resolve(__dirname, "data/screenshot-pool");
const POOL_MAX_ITEMS = 500; // hard cap so a runaway submission spree can't blow up storage
const poolStore = createPoolStore(POOL_DIR, { maxItems: POOL_MAX_ITEMS });
function newPoolId(suffix = "") {
  return `pool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${suffix ? `_${suffix}` : ""}`;
}
// List responses omit the extra carousel `thumbs` array (full JPEGs). The
// first-slide `thumb` + `slideCount` is enough for the modal; Extract gets
// every slide back from resolve-media.
function poolForClient(pool) {
  const entries = (pool?.entries || []).map((e) => {
    if (!e || typeof e !== "object") return e;
    const { thumbs, ...rest } = e;
    const n = Array.isArray(thumbs) ? thumbs.length : 0;
    if (n && !rest.slideCount) rest.slideCount = n;
    return rest;
  });
  return { entries, backend: poolStore.backend };
}

app.get("/api/screenshot-pool", async (_req, res) => {
  try { res.json(poolForClient(await poolStore.load())); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk-add entries. Body: { entries: [{event, thumb?, recurring, alsoRegular, source?}, …] }
// Server stamps id + createdAt so client doesn't have to. Cap-guarded — silently
// drops the oldest entries when we'd exceed POOL_MAX_ITEMS.
// `source` was added when the pool grew to accept iOS-share drops alongside
// screenshot-modal saves — defaults to "screenshot" for anything unspecified.
app.post("/api/screenshot-pool", express.json({ limit: "20mb" }), async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!incoming.length) return res.status(400).json({ error: "no_entries" });
    const added = [];
    const pool = await poolStore.update((cur) => {
      const next = { entries: [...(cur.entries || [])] };
      for (const e of incoming) {
        if (!e || !e.event || !e.event.name) continue;
        const entry = {
          id: newPoolId(String(added.length)),
          event: e.event,
          thumb: typeof e.thumb === "string" && e.thumb.startsWith("data:image/") ? e.thumb : null,
          recurring: !!e.recurring,
          alsoRegular: !!e.alsoRegular,
          source: typeof e.source === "string" && e.source ? e.source : "screenshot",
          status: "extracted", // extracted by the modal before save; ready to pull
          createdAt: new Date().toISOString(),
        };
        next.entries.push(entry);
        added.push(entry);
      }
      return next;
    });
    res.json({ added: added.length, total: pool.entries.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
function withTimeout(ms) {
  const c = new AbortController();
  return { signal: c.signal, done: setTimeout(() => c.abort(), ms) };
}

// Apify token stays server-side (Replit Secret). Never sent to the
// browser or the iOS Shortcut. APIFY_IG_ACTOR overrides the default
// official scraper if IG changes and we need to swap actors without a
// code push.
const APIFY_TOKEN = (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || "").trim();
const APIFY_IG_ACTOR = (process.env.APIFY_IG_ACTOR || "apify/instagram-scraper").trim();
const APIFY_IG_MEMORY = (() => {
  const n = parseInt(process.env.APIFY_IG_MEMORY || "4096", 10);
  return Number.isFinite(n) && n >= 1024 ? n : 4096;
})();

// Instagram CDN URLs from Apify are often signed to Apify's IP/ASN.
// Fetching them from the Replit deploy IP then 403s ("CDN download failed").
// Retry through Apify's proxy so the download comes from a matching network.
async function fetchMaybeProxy(url, { headers, signal, useProxy } = {}) {
  if (useProxy && APIFY_TOKEN) {
    try {
      const { ProxyAgent, fetch: ufetch } = await import("undici");
      const dispatcher = new ProxyAgent(`http://auto:${encodeURIComponent(APIFY_TOKEN)}@proxy.apify.com:8000`);
      return await ufetch(url, { redirect: "follow", headers, signal, dispatcher });
    } catch {
      /* fall through to a direct fetch */
    }
  }
  return fetch(url, { redirect: "follow", headers, signal });
}

// Download a remote image as a data URL. Used for og:image AND for the
// Apify displayUrl — Instagram CDN links are signed and expire (see
// instagramCdnExpiryIso), so we persist the bytes, never the URL.
// Trust magic bytes, not Content-Type — IG/CDN often returns octet-stream.
async function downloadImageAsDataUrl(imgUrl, { timeoutMs = 10000, referer } = {}) {
  const headers = {
    "User-Agent": BROWSER_UA,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  };
  if (referer) headers.Referer = referer;
  const tryOnce = async (useProxy) => {
    const t = withTimeout(timeoutMs);
    try {
      const imgResp = await fetchMaybeProxy(imgUrl, { headers, signal: t.signal, useProxy })
        .finally(() => clearTimeout(t.done));
      if (!imgResp.ok) return null;
      const buf = Buffer.from(await imgResp.arrayBuffer());
      if (buf.length < 32 || buf.length > 15 * 1024 * 1024) return null;
      const ct = (imgResp.headers.get("content-type") || "").split(";")[0].trim();
      const kind = sniffImageKind(buf, ct);
      if (kind === "unknown" && !ct.startsWith("image/")) return null;
      const mime = kind === "png" ? "image/png"
        : kind === "webp" ? "image/webp"
        : kind === "gif" ? "image/gif"
        : (ct.startsWith("image/") ? ct : "image/jpeg");
      return `data:${mime};base64,${buf.toString("base64")}`;
    } catch { return null; }
  };
  return (await tryOnce(false)) || (APIFY_TOKEN ? await tryOnce(true) : null);
}

function instagramShortcode(raw) {
  const m = String(raw || "").match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

// Cover-only fallback: /media/?size=l redirects to a CDN URL signed for
// THIS server's IP, so it still works when Apify's displayUrl 403s.
async function fetchInstagramCoverViaRedirect(postUrl) {
  const code = instagramShortcode(postUrl);
  if (!code) return null;
  const paths = /\/reel/i.test(postUrl)
    ? [`https://www.instagram.com/reel/${code}/media/?size=l`, `https://www.instagram.com/p/${code}/media/?size=l`]
    : [`https://www.instagram.com/p/${code}/media/?size=l`];
  for (const u of paths) {
    const d = await downloadImageAsDataUrl(u, { timeoutMs: 15000, referer: "https://www.instagram.com/" });
    if (d) return d;
  }
  return null;
}

// Fetch a page's og:image and return it as a base64 data URL, so URL-only
// shares (IG post link, event page, etc.) still have a thumbnail Gemini can
// extract from. Returns null on any failure — bad URL, blocked scrape,
// missing og:image, timeout, non-image content-type, or oversize payload —
// and the caller falls back to a URL-only entry the operator extracts by
// hand. Timeouts are strict (8s + 10s) so a stalled remote host can't hold
// the shortcut response open. Instagram usually blocks this path; Extract
// then calls Apify (see resolve-media below).
async function fetchOgImageAsDataUrl(pageUrl) {
  try {
    const t1 = withTimeout(8000);
    const pageResp = await fetch(pageUrl, {
      headers: { "User-Agent": BROWSER_UA },
      redirect: "follow",
      signal: t1.signal,
    }).finally(() => clearTimeout(t1.done));
    if (!pageResp.ok) return null;
    const html = await pageResp.text();
    const match = html.match(/<meta\s+[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image["']/i);
    if (!match) return null;
    const imgUrl = match[1].replace(/&amp;/g, "&");
    return await downloadImageAsDataUrl(imgUrl, { timeoutMs: 10000 });
  } catch { return null; }
}

// Instagram CDN URLs (scontent*.cdninstagram.com) are signed. The `oe`
// query param is a hex Unix timestamp of expiry. Live URLs measured in
// 2026 last ~108 hours / ~4.5 days from generation; older write-ups
// claimed 6–12 hours. Either way the URL is gone after `oe` — HTTP 403,
// no refresh. Parse it so we can log when the Apify URL *would* have
// died; we never rely on it because resolve-media downloads the bytes
// immediately into the pool entry.
function instagramCdnExpiryIso(mediaUrl) {
  try {
    const oe = new URL(mediaUrl).searchParams.get("oe");
    if (!oe) return null;
    const sec = parseInt(oe, 16);
    if (!Number.isFinite(sec) || sec < 1e9 || sec > 4e9) return null;
    return new Date(sec * 1000).toISOString();
  } catch { return null; }
}


function pickApifyMediaUrl(item) {
  if (!item || typeof item !== "object") return null;
  const fromList = [];
  const push = (v) => {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) fromList.push(v);
    else if (v && typeof v.url === "string" && /^https?:\/\//i.test(v.url)) fromList.push(v.url);
  };
  push(item.displayUrl);
  push(item.display_url);
  push(item.imageUrl);
  push(item.image);
  push(item.thumbnailUrl);
  push(item.thumbnail_url);
  if (Array.isArray(item.images)) item.images.forEach(push);
  if (Array.isArray(item.displayResourceUrls)) item.displayResourceUrls.forEach(push);
  const still = fromList.find((u) => !/\.mp4(\?|$)/i.test(u));
  return still || fromList[0] || null;
}

// Instagram carousels (sidecar posts) put each slide on `childPosts`.
// Taking only displayUrl is why Extract used to read slide 1 and ignore
// the rest of a weekend lineup. Cap at 10 — that's IG's carousel max.
const APIFY_SLIDE_CAP = 10;
function pickApifySlideUrls(item) {
  if (!item || typeof item !== "object") return [];
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return;
    if (/\.mp4(\?|$)/i.test(u)) return;
    const key = u.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(u);
  };
  const children = Array.isArray(item.childPosts) ? item.childPosts
    : Array.isArray(item.child_posts) ? item.child_posts
    : Array.isArray(item.sidecarChildren) ? item.sidecarChildren
    : [];
  if (children.length) {
    for (const child of children) add(pickApifyMediaUrl(child));
  }
  if (!urls.length) add(pickApifyMediaUrl(item));
  return urls.slice(0, APIFY_SLIDE_CAP);
}
function pickApifyCaption(item) {
  const c = item?.caption || item?.text || "";
  return typeof c === "string" ? c.trim() : "";
}
function pickApifyOwner(item) {
  const u = item?.ownerUsername || item?.owner?.username || item?.username || item?.user?.username || "";
  return typeof u === "string" ? u.replace(/^@+/, "").trim() : "";
}

async function fetchInstagramPostViaApify(postUrl) {
  if (!APIFY_TOKEN) {
    const err = new Error("Set APIFY_TOKEN in this app's Replit Secrets to fetch Instagram images on Extract.");
    err.code = "not_configured";
    throw err;
  }
  const actorId = APIFY_IG_ACTOR.replace("/", "~");
  const apiUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?timeout=90&memory=${APIFY_IG_MEMORY}`;
  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), 95_000);
  let r, text;
  try {
    r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${APIFY_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        directUrls: [postUrl],
        resultsType: "posts",
        resultsLimit: 1,
        addParentData: false,
      }),
      signal: ac.signal,
    });
    text = await r.text();
  } catch (e) {
    const err = new Error(e?.name === "AbortError"
      ? "Apify timed out fetching that Instagram post (90s). Retry Extract, or share the image from Photos."
      : `Couldn't reach Apify: ${String(e?.message || e)}`);
    err.code = "apify_error";
    throw err;
  } finally {
    clearTimeout(killer);
  }
  if (r.status === 401 || r.status === 403) {
    const err = new Error("Apify rejected the token. Check APIFY_TOKEN in Replit Secrets.");
    err.code = "auth";
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`Apify ${r.status}: ${text.slice(0, 240)}`);
    err.code = "apify_error";
    throw err;
  }
  let items;
  try { items = JSON.parse(text); } catch { items = []; }
  if (items && typeof items === "object" && !Array.isArray(items) && items.error) {
    const err = new Error(`Apify error: ${String(items.error.message || items.error).slice(0, 240)}`);
    err.code = "apify_error";
    throw err;
  }
  const item = Array.isArray(items) ? items[0] : null;
  if (!item) {
    const err = new Error("Apify returned no post — it may be private, deleted, or a stories/share link the scraper can't open.");
    err.code = "no_media";
    throw err;
  }
  const mediaUrls = pickApifySlideUrls(item);
  if (!mediaUrls.length) {
    const err = new Error("Apify returned the post but no image URL (video-only, or the actor changed shape). Share the image from Photos instead.");
    err.code = "no_media";
    throw err;
  }
  const downloaded = await Promise.all(
    mediaUrls.map((u) => downloadImageAsDataUrl(u, { timeoutMs: 15000, referer: "https://www.instagram.com/" })),
  );
  let thumbs = downloaded.filter((t) => usableImageDataUrl(t));
  if (!thumbs.length) {
    const cover = await fetchInstagramCoverViaRedirect(postUrl);
    if (cover) thumbs = [cover];
  }
  if (!thumbs.length) {
    const err = new Error("Got Instagram image URL(s) from Apify but the CDN download failed. Retry Extract, or share the image from Photos.");
    err.code = "cdn_download_failed";
    throw err;
  }
  const mediaUrl = mediaUrls[downloaded.findIndex((t) => t === thumbs[0])] || mediaUrls[0];
  return {
    thumb: thumbs[0],
    thumbs,
    slideCount: thumbs.length,
    caption: pickApifyCaption(item).slice(0, 2000),
    ownerUsername: pickApifyOwner(item),
    mediaUrl,
    mediaExpiresAt: instagramCdnExpiryIso(mediaUrl),
    fetchedVia: "apify",
  };
}

// Raw share intake — the iOS Shortcut hits this endpoint when the operator
// taps "CGE Intake" from their share sheet. No AI extraction yet; the item
// lands in the pool as `status: "raw"` and gets extracted on-demand from
// inside the Review pool modal. Accepts either an image (as data URL) or a
// URL (post link). Instagram share-sheet previews are NOT photos: a stub
// or cover of slide 1 plus the post URL must stay a URL-share so Extract
// can Apify every carousel slide. Camera-roll photos still persist bytes
// here. Auth is intentionally unenforced: the endpoint is public because
// the shortcut can't hold a real credential securely; the cap +
// explicit-review flow contains blast radius if it ever gets spammed.
function publicOrigin(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}
function shareCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
}

// Team intake page — same form hosted live AND as a downloadable HTML file
// they can AirDrop / iMessage. Downloaded copy bakes this origin into the
// POST URL so it still works when opened from Files. CORS on /share lets
// that file call the API. Apple will not import a hand-built .shortcut
// (unsigned), so this is the shareable artifact.
const INTAKE_FILE = path.resolve(__dirname, "intake.html");
async function renderIntakeHtml(origin) {
  const html = await fs.readFile(INTAKE_FILE, "utf8");
  return html.replaceAll("__CGE_ORIGIN__", origin || "");
}
app.get("/intake", async (req, res) => {
  try { res.type("html").send(await renderIntakeHtml("")); }
  catch (err) { res.status(500).send(String(err.message || err)); }
});
app.get("/cge-intake.html", async (req, res) => {
  try {
    res.set("Content-Disposition", 'attachment; filename="CGE-Intake.html"');
    res.type("html").send(await renderIntakeHtml(publicOrigin(req)));
  } catch (err) { res.status(500).send(String(err.message || err)); }
});

// Team Shortcut hosting. Apple will not import a .shortcut we generate
// (it has to be signed inside the Shortcuts app / iCloud). The operator
// already has a working CGE Intake — they upload that signed file (or
// paste the iCloud share link) once. We host it so the team can download
// https://…/cge-intake.shortcut and Add Shortcut on their iPhone.
// Stored in Postgres with the pool so Deploy doesn't wipe it.
function parseIcloudShortcutUrl(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^https:\/\/(?:www\.)?icloud\.com\/shortcuts\/([a-zA-Z0-9]+)\/?$/i);
  return m ? `https://www.icloud.com/shortcuts/${m[1]}` : null;
}

app.get("/api/screenshot-pool/team-shortcut", async (_req, res) => {
  try { res.json(await poolStore.teamShortcutStatus()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post("/api/screenshot-pool/team-shortcut", express.json({ limit: "4mb" }), async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body.icloudUrl === "string") {
      const url = body.icloudUrl.trim() === "" ? null : parseIcloudShortcutUrl(body.icloudUrl);
      if (body.icloudUrl.trim() && !url) {
        return res.status(400).json({ error: "bad_icloud", message: "Paste an iCloud shortcut link (icloud.com/shortcuts/…)." });
      }
      return res.json(await poolStore.saveTeamShortcutMeta({ icloudUrl: url }));
    }
    if (typeof body.shortcutBase64 === "string" && body.shortcutBase64.trim()) {
      let buf;
      try { buf = Buffer.from(body.shortcutBase64.replace(/^data:[^,]*,/, ""), "base64"); }
      catch { return res.status(400).json({ error: "bad_file", message: "Couldn't read that file." }); }
      if (buf.length < 32 || buf.length > 3 * 1024 * 1024) {
        return res.status(400).json({ error: "bad_file", message: "That doesn't look like a Shortcut file." });
      }
      return res.json(await poolStore.saveTeamShortcutBlob(buf));
    }
    return res.status(400).json({ error: "bad_body", message: "Send icloudUrl or shortcutBase64." });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function buildUrlFirstShortcut(shareUrl) {
  const script = path.join(__dirname, "scripts/build-cge-intake-shortcut.py");
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [script, "--share-url", shareUrl], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    child.stdout.on("data", (d) => chunks.push(d));
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `shortcut build exited ${code}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

app.get("/cge-intake-url.shortcut", async (req, res) => {
  try {
    const origin = publicOrigin(req) || "";
    const shareUrl = `${origin}/api/screenshot-pool/share`;
    const buf = await buildUrlFirstShortcut(shareUrl);
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Disposition", 'attachment; filename="CGE-Intake.shortcut"');
    return res.send(buf);
  } catch (err) { res.status(500).send(String(err.message || err)); }
});

app.get("/cge-intake.shortcut", async (req, res) => {
  try {
    const buf = await poolStore.getTeamShortcutBlob();
    if (buf) {
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", 'attachment; filename="CGE-Intake.shortcut"');
      return res.send(buf);
    }
    const st = await poolStore.teamShortcutStatus();
    if (st.icloudUrl) return res.redirect(302, st.icloudUrl);
    res.status(404).type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;background:#0e0e10;color:#F5F0E8;padding:2rem"><h1>No Shortcut file yet</h1><p>The operator needs to upload CGE Intake from the Shortcuts app first (Screenshot pool → Team Shortcut).</p></body>`);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/shortcut", async (req, res) => {
  try {
    const origin = publicOrigin(req) || "";
    const urlFirst = `${origin}/cge-intake-url.shortcut`;
    res.type("html").send(`<!doctype html>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Add CGE Intake</title>
<body style="margin:0;min-height:100dvh;background:#0e0e10;color:#F5F0E8;font-family:-apple-system,sans-serif;padding:32px 20px">
  <h1 style="font-size:1.5rem">Add CGE Intake</h1>
  <p style="color:rgba(245,240,232,.6);line-height:1.45">The old <b>Save to CGE tool</b> Shortcut only takes the picture on screen. Instagram carousels need the <b>post link</b>. Add this URL-first Shortcut, then share the post (or Copy link → share that).</p>
  <p><a href="${urlFirst}" style="display:block;text-align:center;padding:16px;border-radius:12px;background:#E5BC4F;color:#000;font-weight:800;text-decoration:none">Add CGE Intake</a></p>
  <p style="font-size:.8rem;color:rgba(245,240,232,.4);line-height:1.45">If iPhone asks, tap <b>Add Shortcut</b> / <b>Allow Untrusted Shortcut</b>. You can delete the old “Save to CGE tool” after this works.</p>
  <p style="font-size:.8rem;color:rgba(245,240,232,.45);line-height:1.45">Or in Review → Screenshot pool, paste the Instagram link and tap Add link.</p>
</body>`);
  } catch (err) { res.status(500).send(String(err.message || err)); }
});

app.options("/api/screenshot-pool/share", (_req, res) => { shareCors(res); res.sendStatus(204); });

async function handleScreenshotShare(req, res) {
  shareCors(res);
  try {
    const share = classifyShare(coerceShareBody(req.body), req.query || {});
    const sourceUrl = share.url;
    const hasUrl = !!sourceUrl;
    const hasImage = !!share.imageDataUrl;
    if (!hasImage && !hasUrl) {
      const keys = req.body && typeof req.body === "object" ? Object.keys(req.body) : [];
      console.warn("[share] no url/image", { keys, query: Object.keys(req.query || {}), stub: !!share.stubImage });
      if (share.stubImage) {
        const msg = "No Instagram link in that share. On the post tap ••• → Copy link, then share the link to CGE Intake (not just the photo).";
        res.status(422);
        res.type("text/plain");
        return res.send(msg);
      }
      return res.status(400).json({ error: "no_content", detail: "Send imageDataUrl OR sourceUrl" });
    }
    const id = newPoolId("share");
    let storedThumb = null;
    const persistPhoto = async (dataUrl) => {
      if (!usableImageDataUrl(dataUrl)) return;
      let jpeg = dataUrl;
      try { jpeg = await normalizeImageDataUrl(dataUrl); } catch { /* keep original bytes */ }
      await poolStore.saveEntryMedia(id, [jpeg]);
      try { storedThumb = await toPreviewDataUrl(jpeg); }
      catch { storedThumb = null; }
    };
    // Instagram URL → never write the share-sheet cover into media blobs.
    // resolve-media used to see those bytes and skip Apify (slide 1 only).
    if (share.persistPhoto) await persistPhoto(share.imageDataUrl);
    else if (share.instagram && share.imageDataUrl) {
      try { storedThumb = await toPreviewDataUrl(share.imageDataUrl); }
      catch { storedThumb = null; }
    } else if (hasUrl && !storedThumb && !share.instagram) {
      const fetchedThumb = await fetchOgImageAsDataUrl(sourceUrl);
      if (fetchedThumb && usableImageDataUrl(fetchedThumb)) {
        try { storedThumb = await toPreviewDataUrl(fetchedThumb); }
        catch { storedThumb = null; }
      }
    }
    const caption = share.caption;
    const entry = {
      id,
      event: null, // will be filled when the operator extracts inside the pool modal
      thumb: storedThumb,
      sourceUrl: hasUrl ? sourceUrl : null,
      caption: typeof caption === "string" ? caption.slice(0, 500) : null,
      recurring: false,
      alsoRegular: false,
      source: "share-ios",
      status: "raw", // needs extraction inside the pool modal
      createdAt: new Date().toISOString(),
    };
    const pool = await poolStore.update((cur) => ({
      entries: [...(cur.entries || []), entry],
    }));
    const payload = { ok: true, id: entry.id, total: pool.entries.length, thumbFetched: !!(entry.thumb) && !hasImage };
    const wantHtml = String(req.headers.accept || "").includes("text/html") && req.method === "GET";
    if (wantHtml) {
      return res.type("html").send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,sans-serif;background:#0e0e10;color:#F5F0E8;padding:2rem"><h1>Saved to the pool</h1><p>Extract it from Review → Screenshot pool.</p></body>`);
    }
    res.json(payload);
  } catch (err) { res.status(500).json({ error: err.message }); }
}

app.post(
  "/api/screenshot-pool/share",
  express.json({ limit: "20mb" }),
  express.urlencoded({ extended: true, limit: "2mb" }),
  express.text({ type: "text/plain", limit: "20mb" }),
  handleScreenshotShare,
);
app.get("/api/screenshot-pool/share", handleScreenshotShare);

// Safe to expose — boolean only, never the token. Pool modal uses this to
// warn before Extract if Instagram URL-shares need Apify and the secret
// isn't set yet.
app.get("/api/screenshot-pool/apify-status", (_req, res) => {
  res.json({ configured: !!APIFY_TOKEN });
});

// Prepare a Gemini-safe JPEG for Extract. Two entry points:
//   1. URL-only shares (Instagram) — Apify / og:image, then normalize.
//      Instagram carousels download EVERY slide (childPosts), not just
//      the cover — that's what "multi-slide extract" needs.
//   2. Photo shares (iOS camera roll) — already have a thumb, but it's often
//      HEIC or a 12MP JPEG Gemini / the browser can't use. Convert + downscale.
// Always rewrites the stored thumb to a JPEG data URL so the pool preview
// stops showing a broken-image icon.
//
// Instagram URLs always go through Apify unless we already stored slides
// from a previous Apify run. An og:image cover (or a leftover first-slide
// thumb) must NOT skip the carousel fetch — that was the multi-slide miss.
function storedSlideThumbs(entry) {
  if (Array.isArray(entry?.thumbs) && entry.thumbs.length) {
    return entry.thumbs.filter((t) => usableImageDataUrl(t));
  }
  if (usableImageDataUrl(entry?.thumb)) return [entry.thumb];
  return [];
}

app.post("/api/screenshot-pool/resolve-media", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "bad_body", message: "Send the pool entry id." });
    const loaded = await poolStore.load();
    const existing = (loaded.entries || []).find((e) => String(e.id) === String(id));
    if (!existing) return res.status(404).json({ error: "not_found", message: "That pool entry is gone — refresh and try again." });

    const sourceUrl = typeof existing.sourceUrl === "string" ? existing.sourceUrl : "";
    const ig = isInstagramUrl(sourceUrl);
    const persistSlides = async (thumbs, extra = {}) => {
      const safe = [];
      for (const t of thumbs) {
        try { safe.push(await normalizeImageDataUrl(t)); }
        catch (e) {
          if (e.code === "bad_image") {
            const err = new Error(e.message);
            err.code = "bad_image";
            throw err;
          }
          throw e;
        }
      }
      if (!safe.length) {
        const err = new Error("Couldn't convert that image into a format Gemini can read.");
        err.code = "bad_image";
        throw err;
      }
      await poolStore.saveEntryMedia(id, safe);
      let preview = null;
      try { preview = await toPreviewDataUrl(safe[0]); } catch { preview = null; }
      const { thumbs: _dropThumbs, ...restExtra } = extra || {};
      const patch = {
        thumb: preview,
        slideCount: safe.length,
        hasMedia: true,
        ...restExtra,
      };
      const updated = await poolStore.update((cur) => {
        const idx = (cur.entries || []).findIndex((e) => String(e.id) === String(id));
        if (idx === -1) return cur;
        const next = { entries: [...cur.entries] };
        next.entries[idx] = { ...next.entries[idx], ...patch };
        delete next.entries[idx].thumbs;
        return next;
      });
      const row = (updated.entries || []).find((e) => String(e.id) === String(id));
      if (!row) {
        const err = new Error("That pool entry is gone — refresh and try again.");
        err.code = "not_found";
        throw err;
      }
      return { thumbs: safe, entry: row };
    };

    const jsonOk = (thumbs, extra) => res.json({
      ok: true,
      thumb: thumbs[0],
      thumbs,
      slideCount: thumbs.length,
      caption: extra.caption || existing.caption || null,
      ownerUsername: extra.ownerUsername || null,
      mediaExpiresAt: extra.mediaExpiresAt || existing.mediaExpiresAt || null,
      fetchedVia: extra.fetchedVia || existing.fetchedVia || "normalized",
    });

    const fromBlob = await poolStore.loadEntryMedia(id);
    const fromRow = storedSlideThumbs(existing);
    const havePhotoBytes = fromBlob.length > 0 || fromRow.length > 0;

    if (!ig && havePhotoBytes) {
      try {
        const { thumbs, entry } = await persistSlides(fromBlob.length ? fromBlob : fromRow);
        return jsonOk(thumbs, { caption: entry.caption, fetchedVia: "normalized" });
      } catch (e) {
        if (e.code === "bad_image") return res.status(422).json({ error: "bad_image", message: e.message });
        if (e.code === "not_found") return res.status(404).json({ error: "not_found", message: e.message });
        throw e;
      }
    }

    if (!ig && !havePhotoBytes) {
      return res.status(422).json({
        error: "missing_image",
        message: "This photo's image bytes are gone from the pool (only a placeholder is left). Re-share it from Photos — Extract can't recover a missing picture.",
      });
    }

    // Reuse stored slides only after a real Apify run. A share-sheet
    // cover (or og:image) sitting in media:{id} used to skip the carousel
    // fetch and Extract would only ever see slide 1.
    if (ig && existing.fetchedVia === "apify" && (fromBlob.length || fromRow.length)) {
      try {
        const { thumbs, entry } = await persistSlides(fromBlob.length ? fromBlob : fromRow, { fetchedVia: "apify" });
        return jsonOk(thumbs, { caption: entry.caption, fetchedVia: "apify", mediaExpiresAt: entry.mediaExpiresAt });
      } catch (e) {
        if (e.code === "bad_image") return res.status(422).json({ error: "bad_image", message: e.message });
        if (e.code === "not_found") return res.status(404).json({ error: "not_found", message: e.message });
        throw e;
      }
    }

    if (!/^https?:\/\//i.test(sourceUrl) && !storedSlideThumbs(existing).length) {
      return res.status(400).json({
        error: "no_url",
        message: "This entry has no source URL to fetch an image from. Share the image from Photos instead.",
      });
    }

    let result;
    if (ig) {
      try {
        result = await fetchInstagramPostViaApify(sourceUrl);
      } catch (e) {
        if (e.code === "not_configured") {
          return res.status(503).json({ error: "not_configured", message: e.message });
        }
        if (e.code === "auth") {
          return res.status(401).json({ error: "apify_auth", message: e.message });
        }
        return res.status(502).json({ error: "apify_error", message: e.message });
      }
    } else if (/^https?:\/\//i.test(sourceUrl)) {
      const thumb = await fetchOgImageAsDataUrl(sourceUrl);
      if (!thumb) {
        return res.status(502).json({
          error: "og_failed",
          message: "Couldn't fetch a preview image from that URL. Open it, save the image, and re-share from Photos.",
        });
      }
      result = { thumb, thumbs: [thumb], caption: "", ownerUsername: "", mediaExpiresAt: null, fetchedVia: "og" };
    } else {
      return res.status(400).json({
        error: "no_url",
        message: "This entry has no source URL to fetch an image from. Share the image from Photos instead.",
      });
    }

    const incomingThumbs = Array.isArray(result.thumbs) && result.thumbs.length
      ? result.thumbs
      : (result.thumb ? [result.thumb] : []);
    try {
      const extra = {
        fetchedVia: result.fetchedVia || "apify",
        mediaExpiresAt: result.mediaExpiresAt || null,
      };
      if (result.caption && !existing.caption) extra.caption = result.caption.slice(0, 500);
      const { thumbs, entry } = await persistSlides(incomingThumbs, extra);
      return jsonOk(thumbs, {
        caption: entry.caption,
        ownerUsername: result.ownerUsername || null,
        mediaExpiresAt: result.mediaExpiresAt || null,
        fetchedVia: result.fetchedVia || "apify",
      });
    } catch (e) {
      if (e.code === "bad_image") return res.status(422).json({ error: "bad_image", message: e.message });
      if (e.code === "not_found") return res.status(404).json({ error: "not_found", message: e.message });
      throw e;
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update an existing pool entry — used when the operator extracts a raw
// share, edits fields inline, or flips alsoRegular. Client sends the id
// and the fields to overwrite (partial merge). `patch.siblings` (optional)
// is an array of extra extracted events from the same carousel / flyer —
// each becomes its own pool row so the operator can edit + pull them
// independently (same as the in-app screenshot modal).
app.post("/api/screenshot-pool/update", express.json({ limit: "5mb" }), async (req, res) => {
  try {
    const { id, patch } = req.body || {};
    if (!id || !patch || typeof patch !== "object") return res.status(400).json({ error: "bad_body" });
    const siblingsIn = Array.isArray(patch.siblings) ? patch.siblings : [];
    const { siblings: _drop, thumbs: _dropThumbs, ...safePatch } = patch;
    let added = [];
    let entry = null;
    const pool = await poolStore.update((cur) => {
      const idx = (cur.entries || []).findIndex((e) => String(e.id) === String(id));
      if (idx === -1) return cur;
      const next = { entries: [...cur.entries] };
      const merged = { ...next.entries[idx], ...safePatch };
      // After extract we keep the cover thumb for the card; drop the extra
      // full-size carousel JPEGs so the row doesn't stay multi-megabyte.
      if (safePatch.status === "extracted") {
        delete merged.thumbs;
      }
      next.entries[idx] = merged;
      entry = merged;
      added = [];
      if (siblingsIn.length) {
        const extras = [];
        for (const sib of siblingsIn) {
          if (!sib || !sib.event || !sib.event.name) continue;
          extras.push({
            id: newPoolId("sib"),
            event: sib.event,
            thumb: typeof sib.thumb === "string" && sib.thumb.startsWith("data:image/") ? sib.thumb : merged.thumb,
            sourceUrl: merged.sourceUrl || null,
            caption: merged.caption || null,
            recurring: !!sib.recurring,
            alsoRegular: !!sib.alsoRegular,
            source: merged.source || "share-ios",
            status: "extracted",
            aiFilledFields: Array.isArray(sib.aiFilledFields) ? sib.aiFilledFields : [],
            siblingOf: String(id),
            slideCount: merged.slideCount || null,
            createdAt: new Date().toISOString(),
          });
        }
        if (extras.length) {
          next.entries.splice(idx + 1, 0, ...extras);
          added = extras;
        }
      }
      return next;
    });
    if (!entry) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, entry: poolForClient({ entries: [entry] }).entries[0], added, total: pool.entries.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk delete. Body: { ids: [id, …] }. Used after successful "pull to queue"
// so pulled entries don't reappear in the next weekly review.
app.post("/api/screenshot-pool/delete", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String));
    if (!ids.size) return res.status(400).json({ error: "no_ids" });
    let removed = 0;
    const pool = await poolStore.update((cur) => {
      const before = (cur.entries || []).length;
      const entries = (cur.entries || []).filter((e) => !ids.has(String(e.id)));
      removed = before - entries.length;
      return { entries };
    });
    if (removed) {
      try { await poolStore.deleteEntryMedia([...ids]); } catch { /* orphan media is harmless */ }
    }
    res.json({ removed, total: pool.entries.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// === WEEKEND_REVIEW — bridge to the Insta-Scraper repo ===
// The Insta-Scraper writes a Weekend_Review tab into the user's Google
// Sheet (Instagram_Events_Master, see the scraper UI's "Stage Review"
// screen). The endpoints below let this app read those rows, render
// the review queue, and write approval/edit decisions back. The Sheet
// is the queue — both apps share it, neither needs to know about the
// other beyond that contract.
//
// Required env vars (Replit Secrets):
//   GOOGLE_SHEET_ID                — the spreadsheet ID (e.g., 1Tll...JaoA)
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   — service account client_email
//   GOOGLE_SERVICE_ACCOUNT_KEY     — service account private_key. Replit
//                                    stores this as one line with \n
//                                    escaped; we unescape below.
//
// The scraper's service account (vision-api-script@apt-mark-468506-u9.
// iam.gserviceaccount.com) already has Editor on the sheet — same JSON
// file can be split into the three env vars above and pasted into
// Replit Secrets.

import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const WEEKEND_REVIEW_TAB = "Weekend_Review";
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
// Replace literal "\n" with real newlines — Replit env vars don't
// preserve multi-line values, so the private key arrives as one long
// string with escaped newlines.
const SA_KEY   = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");
const SHEET_ID = (process.env.GOOGLE_SHEET_ID || "").trim();

// Sanity-check the parsed private key without LOGGING any secret content.
// Returns null on OK, or a user-actionable error string on detected issue.
function _diagnosePrivateKey(key) {
  if (!key || key.length === 0) return "GOOGLE_SERVICE_ACCOUNT_KEY is empty";
  if (!key.includes("-----BEGIN PRIVATE KEY-----")) {
    return "private key is missing the '-----BEGIN PRIVATE KEY-----' header. " +
           "Make sure you pasted the FULL private_key value from the JSON, " +
           "including the BEGIN/END marker lines.";
  }
  if (!key.includes("-----END PRIVATE KEY-----")) {
    return "private key is missing the '-----END PRIVATE KEY-----' footer. " +
           "Most likely cause: the paste was truncated. Re-copy the entire " +
           "private_key value from the JSON file.";
  }
  // If it's all on one line with no \n and no real newlines, OpenSSL will
  // reject it with the cryptic 1E08010C:DECODER error — what the user just saw.
  if (!key.includes("\n") && !key.includes("\\n")) {
    return "private key has no line breaks (no \\n escapes, no real newlines). " +
           "PEM format requires linebreaks every 64 chars. Re-copy the " +
           "'private_key' string from the JSON file — Replit Secrets accepts " +
           "either escaped \\n or real multi-line content.";
  }
  return null;
}

async function openWeekendReviewSheet() {
  if (!SA_EMAIL || !SA_KEY) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY must be set " +
      "in Replit Secrets (or local env) to access the Weekend_Review tab."
    );
  }
  if (!SHEET_ID) {
    throw new Error(
      "GOOGLE_SHEET_ID must be set in Replit Secrets. Find it in your Google " +
      "Sheets URL: docs.google.com/spreadsheets/d/<this part>/edit"
    );
  }
  const keyDiag = _diagnosePrivateKey(SA_KEY);
  if (keyDiag) {
    throw new Error(`Private key looks malformed — ${keyDiag}`);
  }
  const auth = new JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(SHEET_ID, auth);
  try {
    await doc.loadInfo();
  } catch (e) {
    const msg = String(e?.message || e);
    // The classic OpenSSL DECODER error means the key didn't parse —
    // give the user a clear remediation path instead of the raw cryptic code.
    if (msg.includes("DECODER") || msg.includes("1E08010C") ||
        msg.includes("ERR_OSSL") || msg.toLowerCase().includes("unsupported")) {
      throw new Error(
        "Google rejected the private key (OpenSSL DECODER error). The key in " +
        "GOOGLE_SERVICE_ACCOUNT_KEY exists but Node can't parse it. Most likely: " +
        "the \\n escapes got mangled when pasted into Replit Secrets. " +
        "Try the /api/weekend-review/key-diagnostic endpoint to see what the " +
        "server is reading (it only reveals the structure, never the secret)."
      );
    }
    if (msg.toLowerCase().includes("invalid_grant") || msg.includes("ACCESS_DENIED")) {
      throw new Error(
        `Sheets API rejected the service account (${SA_EMAIL}). Make sure that ` +
        `email is shared as Editor or Viewer on the spreadsheet ` +
        `(docs.google.com/spreadsheets/d/${SHEET_ID}/edit → Share).`
      );
    }
    throw e;
  }
  const sheet = doc.sheetsByTitle[WEEKEND_REVIEW_TAB];
  if (!sheet) {
    throw new Error(
      `'${WEEKEND_REVIEW_TAB}' tab not found in spreadsheet. Open the Insta-Scraper ` +
      `UI → Stage Review → click 'Stage for Review' to create the tab first.`
    );
  }
  return sheet;
}

// Load ONLY the columns the write paths actually need instead of the whole
// grid. `sheet.loadCells()` with no range pulls every cell (1,400+ rows ×
// every column) in one giant response — that payload is what caused
// "network error: POST …:getByDataFilter" failures on the deployed site.
// Loading the header row + a handful of named columns is ~10x smaller.
// Returns the header→column-index map. Retries transient network errors.
// Retry transient network failures against the Sheets API (up to 3 tries,
// backing off). Used for both reads (loadCells) and the final write
// (saveUpdatedCells) — either can hit a one-off network blip in production.
async function retrySheetsCall(fn) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e).toLowerCase();
      const transient = msg.includes("network") || msg.includes("timeout") ||
        msg.includes("econnreset") || msg.includes("socket") || msg.includes("fetch failed");
      if (!transient) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

async function loadSheetColumns(sheet, neededHeaders) {
  const attempt = retrySheetsCall;
  // 1. Header row only
  await attempt(() => sheet.loadCells({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: sheet.columnCount }));
  const headerToCol = {};
  for (let c = 0; c < sheet.columnCount; c++) {
    const v = sheet.getCell(0, c).value;
    if (v == null || String(v).trim() === "") break;
    headerToCol[String(v)] = c;
  }
  // 2. Just the needed columns, full height
  for (const h of neededHeaders) {
    const c = headerToCol[h];
    if (c == null) continue; // caller gracefully skips missing headers
    await attempt(() => sheet.loadCells({ startRowIndex: 0, endRowIndex: sheet.rowCount, startColumnIndex: c, endColumnIndex: c + 1 }));
  }
  return headerToCol;
}

// GET /api/weekend-review
// Returns { events: [ { _row, _all_fields, APPROVED, ... } ] }
// _row is the 1-indexed sheet row (header is row 1, first data is row 2).
// Used by the client to address rows for subsequent updates.
// IMPLEMENTATION NOTE — 2026-06-27 rewrite:
// Previously this used sheet.getRows() from google-spreadsheet v5. That
// API auto-detects the header row, and when detection fails (blank
// header cells, duplicate header names, or even a single rogue cell
// shape upstream) it SILENTLY returns []. The user reported "the tab
// is not empty but the scraper says it is" because of exactly this
// quirk — the data was there, getRows() just couldn't see it.
//
// Switched to a raw cell read via sheet.loadCells() + cell-by-cell
// access. This mirrors what the Python scraper does (ws.get_all_values())
// and gives us:
//   · explicit visibility into what's in the sheet (no library magic)
//   · no header-shape constraints
//   · a /debug endpoint that returns row/col counts for diagnosability
async function readWeekendReviewAsObjects() {
  const sheet = await openWeekendReviewSheet();
  await sheet.loadCells();
  const rowCount = sheet.rowCount;
  const colCount = sheet.columnCount;

  // Read the header row, stopping at the first blank — past that point,
  // we'd be reading the unused right-edge cells of the sheet's allocated
  // grid (gspread allocates 1000+ cols by default).
  const headers = [];
  for (let c = 0; c < colCount; c++) {
    const v = sheet.getCell(0, c).value;
    if (v == null || String(v).trim() === "") break;
    headers.push(String(v));
  }
  if (headers.length === 0) {
    return { events: [], headers: [], rowCount, colCount, reason: "header row is empty" };
  }

  const events = [];
  for (let r = 1; r < rowCount; r++) {
    // Stop at the first fully-blank row — past that we'd be reading the
    // unallocated tail of the sheet's grid.
    let firstCol = sheet.getCell(r, 0).value;
    if (firstCol == null || String(firstCol).trim() === "") {
      // Also peek at col 1 in case col 0 is genuinely empty for this row
      // (unlikely for scraper-staged rows — INSTAGRAM HANDLE is always set —
      // but defensive).
      const peek = sheet.getCell(r, 1).value;
      if (peek == null || String(peek).trim() === "") break;
    }
    const obj = { _row: r + 1 };  // 1-indexed for human reference
    for (let c = 0; c < headers.length; c++) {
      // Prefer formattedValue over value — the scraper writes dates with
      // USER_ENTERED input mode, which Sheets converts to native date types
      // (stored as serial numbers like 46207). `.value` gives back the
      // number; `.formattedValue` gives back the display text the user sees
      // in the Sheet ("7/4/2026"). Use formattedValue when present, fall
      // back to value for cells with no display formatting (numbers, IDs).
      const cell = sheet.getCell(r, c);
      const display = cell.formattedValue;
      const raw = cell.value;
      const out = display != null ? display : raw;
      obj[headers[c]] = out == null ? "" : String(out);
    }
    events.push(obj);
  }
  return { events, headers, rowCount, colCount, reason: "ok" };
}

app.get("/api/weekend-review", async (_req, res) => {
  try {
    const { events, headers, rowCount, colCount, reason } = await readWeekendReviewAsObjects();
    res.json({
      events,
      total: events.length,
      pending:  events.filter((e) => !e.APPROVED).length,
      approved: events.filter((e) => String(e.APPROVED).toUpperCase() === "TRUE").length,
      rejected: events.filter((e) => String(e.APPROVED).toUpperCase() === "FALSE").length,
      _debug: {
        sheetRowCount: rowCount,
        sheetColCount: colCount,
        headerCount: headers.length,
        readReason: reason,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// GET /api/weekend-review/key-diagnostic
// Returns SAFE metadata about the parsed private key — no secret content,
// just shape + structure indicators. Use this when the auth-time error is
// the cryptic OpenSSL DECODER one and you need to know WHICH thing about
// the env var is wrong. Returns the same diagnostic _diagnosePrivateKey
// would have flagged, plus structural checks (lengths, marker presence).
app.get("/api/weekend-review/key-diagnostic", (_req, res) => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "";
  const after = raw.replace(/\\n/g, "\n");
  // Count occurrences of the key markers as a sanity check on truncation.
  const beginCount = (after.match(/-----BEGIN PRIVATE KEY-----/g) || []).length;
  const endCount   = (after.match(/-----END PRIVATE KEY-----/g) || []).length;
  // Number of real newlines after the unescape (PEM-formatted keys have ~30).
  const newlineCount = (after.match(/\n/g) || []).length;
  // Number of escaped \n in the raw value (before unescape) — tells us
  // whether the user pasted the escaped form (high count) or the
  // multi-line form (zero count).
  const escapedNewlineCount = (raw.match(/\\n/g) || []).length;
  res.json({
    google_sheet_id:               !!SHEET_ID,
    google_service_account_email:  SA_EMAIL || null,
    private_key_present:           raw.length > 0,
    private_key_length:            raw.length,
    private_key_length_unescaped:  after.length,
    has_begin_marker:              after.includes("-----BEGIN PRIVATE KEY-----"),
    has_end_marker:                after.includes("-----END PRIVATE KEY-----"),
    begin_marker_count:            beginCount,
    end_marker_count:              endCount,
    real_newlines_after_unescape:  newlineCount,
    escaped_newlines_in_raw:       escapedNewlineCount,
    starts_with_begin:             after.startsWith("-----BEGIN PRIVATE KEY-----"),
    ends_with_end_marker:          after.trim().endsWith("-----END PRIVATE KEY-----"),
    likely_issue:                  _diagnosePrivateKey(after),
    note: "All fields above are SAFE to share — no secret content is exposed.",
  });
});

// GET /api/weekend-review/debug
// Returns just the metadata — useful when the events array is empty and
// we need to know why. Curl this from the Replit shell or open in a
// browser tab to see exactly what the server sees.
app.get("/api/weekend-review/debug", async (_req, res) => {
  try {
    const sheet = await openWeekendReviewSheet();
    await sheet.loadCells();
    const headers = [];
    for (let c = 0; c < sheet.columnCount; c++) {
      const v = sheet.getCell(0, c).value;
      if (v == null || String(v).trim() === "") break;
      headers.push(String(v));
    }
    // Sample the first 3 data rows (rows 2, 3, 4 in 1-indexed terms)
    const samples = [];
    for (let r = 1; r <= 3 && r < sheet.rowCount; r++) {
      const row = {};
      for (let c = 0; c < Math.min(headers.length, 6); c++) {
        row[headers[c] || `col${c}`] = sheet.getCell(r, c).value;
      }
      samples.push(row);
    }
    res.json({
      sheetTitle: sheet.title,
      sheetId: sheet.sheetId,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      headerCount: headers.length,
      headers: headers,
      firstThreeDataRows: samples,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// POST /api/weekend-review/update
// Body: { post_id, fields }
// Looks up the row by POST ID (matches the scraper's primary key) using
// the same raw-cell approach as the read path so we never hit the
// getRows() quirk that ate the rows in the first place.
app.post("/api/weekend-review/update", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const { post_id, fields } = req.body || {};
    if (!post_id) {
      return res.status(400).json({ error: "post_id required in body" });
    }
    if (!fields || typeof fields !== "object") {
      return res.status(400).json({ error: "fields object required in body" });
    }
    const sheet = await openWeekendReviewSheet();
    // Load only POST ID + the columns being written (plus auto-stamps).
    const neededHeaders = new Set(["POST ID", "REVIEWED_AT", ...Object.keys(fields)]);
    const headerToCol = await loadSheetColumns(sheet, neededHeaders);
    const postIdCol = headerToCol["POST ID"];
    if (postIdCol == null) {
      return res.status(500).json({ error: "Weekend_Review has no 'POST ID' header column" });
    }

    // Find the row with the matching POST ID.
    const target = String(post_id).trim();
    let targetRow = -1;
    for (let r = 1; r < sheet.rowCount; r++) {
      const cellVal = sheet.getCell(r, postIdCol).value;
      if (cellVal != null && String(cellVal).trim() === target) {
        targetRow = r;
        break;
      }
    }
    if (targetRow === -1) {
      return res.status(404).json({
        error: `No row in Weekend_Review with POST ID '${target}'. ` +
               `Either it's a stale ID or the staging tab was rebuilt.`,
      });
    }

    // Auto-stamp REVIEWED_AT when APPROVED is being touched.
    const out = { ...fields };
    if ("APPROVED" in out && !("REVIEWED_AT" in out)) {
      out.REVIEWED_AT = new Date().toISOString();
    }

    // Write each field. Some headers (REVIEWED_AT, EDITED_FIELDS,
    // PUSHED_AT) might not exist yet on legacy rows from an older
    // staging — gracefully skip those.
    const written = {};
    const skipped = {};
    for (const [k, v] of Object.entries(out)) {
      const col = headerToCol[k];
      if (col == null) {
        skipped[k] = "no such header column";
        continue;
      }
      const cell = sheet.getCell(targetRow, col);
      cell.value = v == null ? "" : String(v);
      written[k] = String(v == null ? "" : v);
    }
    await retrySheetsCall(() => sheet.saveUpdatedCells());
    res.json({ ok: true, post_id: target, row: targetRow + 1, written, skipped });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// POST /api/weekend-review/bulk-update
// Body: { updates: [{ post_id, fields }, ...] }
// Updates many rows in ONE Sheets batchUpdate call instead of one POST per row.
// Used by ScraperReview's "Send to Review" button to stamp PUSHED_AT on 200+
// events without burning 200 round-trips. saveUpdatedCells() collapses all
// in-memory cell edits into a single API request.
app.post("/api/weekend-review/bulk-update", express.json({ limit: "10mb" }), async (req, res) => {
  try {
    const { updates } = req.body || {};
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: "updates array required in body" });
    }
    const sheet = await openWeekendReviewSheet();
    // Load only POST ID + the union of columns being written (plus
    // auto-stamps) — never the whole grid.
    const neededHeaders = new Set(["POST ID", "REVIEWED_AT", "PUSHED_AT"]);
    for (const u of updates) for (const k of Object.keys(u?.fields || {})) neededHeaders.add(k);
    const headerToCol = await loadSheetColumns(sheet, neededHeaders);
    const postIdCol = headerToCol["POST ID"];
    if (postIdCol == null) {
      return res.status(500).json({ error: "Weekend_Review has no 'POST ID' header column" });
    }
    // Build POST ID → sheet row index map once for O(1) lookup
    const postIdToRow = {};
    for (let r = 1; r < sheet.rowCount; r++) {
      const v = sheet.getCell(r, postIdCol).value;
      if (v != null && String(v).trim() !== "") {
        postIdToRow[String(v).trim()] = r;
      }
    }

    const results = [];
    for (const { post_id, row: clientRow, fields } of updates) {
      const target = String(post_id || "").trim();
      // Try POST ID first, fall back to client-supplied _row. The fallback
      // matters because the GET path emits _row directly from sheet state,
      // so it's always addressable even if POST ID has whitespace/encoding
      // drift that breaks the string-equality lookup.
      let r = postIdToRow[target];
      if (r == null && Number.isInteger(clientRow) && clientRow >= 2 && clientRow <= sheet.rowCount) {
        r = clientRow - 1;  // client sends 1-indexed sheet row; internal is 0-indexed
      }
      if (r == null) {
        results.push({ post_id: target, ok: false, error: `POST ID not found in sheet${clientRow ? ` and row ${clientRow} also invalid` : ""}` });
        continue;
      }
      const out = { ...(fields || {}) };
      if ("APPROVED" in out && !("REVIEWED_AT" in out)) {
        out.REVIEWED_AT = new Date().toISOString();
      }
      if ("PUSHED_AT" in out && !out.PUSHED_AT) {
        out.PUSHED_AT = new Date().toISOString();
      }
      const written = [];
      const skipped = [];
      for (const [k, v] of Object.entries(out)) {
        const col = headerToCol[k];
        if (col == null) { skipped.push(k); continue; }
        sheet.getCell(r, col).value = v == null ? "" : String(v);
        written.push(k);
      }
      results.push({ post_id: target, ok: true, row: r + 1, written, skipped });
    }
    // ONE Sheets API call for all edits
    await retrySheetsCall(() => sheet.saveUpdatedCells());
    res.json({
      ok: true,
      total: updates.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Health check — the client pings this on boot to decide whether to show
// the cloud buttons. Returns version so we can tell apart old servers if
// the API ever changes.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, api: "workspaces+library+reviewSessions+weekendReview", version: 11, env: NODE_ENV, sessionBackend: sessionStore.backend, poolBackend: poolStore.backend });
});

// === NEWS SCOUT (autonomous) ===
// A daily cron runs the beat search server-side and accumulates a deduped
// inbox at data/scout/inbox.json; when new stories land it emails a digest.
// The app reads the inbox via /api/scout/*. This only runs when the Node
// server is alive (Reserved VM / dev) — a pure-static Replit deploy has no
// process, so nothing scouts. Config is all env vars (documented in the
// endpoints below and in the client status line).
const SCOUT_DIR = path.resolve(__dirname, "data/scout");
const SCOUT_INBOX = path.join(SCOUT_DIR, "inbox.json");
const SCOUT_MAX_ITEMS = 60;
const scoutKey      = () => (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "").trim();
const scoutEnabled  = () => (process.env.SCOUT_ENABLED ?? "1") !== "0";
const scoutArea     = () => (process.env.SCOUT_AREA || "New Jersey").trim();
const scoutHour     = () => { const h = parseInt(process.env.SCOUT_HOUR || "12", 10); return Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 12; };
const scoutEmailTo  = () => (process.env.SCOUT_EMAIL_TO || "aagu1999@gmail.com").trim();
const emailConfigured = () => !!((process.env.GMAIL_USER || "").trim() && (process.env.GMAIL_APP_PASSWORD || "").trim());

async function loadInbox() {
  try {
    const j = JSON.parse(await fs.readFile(SCOUT_INBOX, "utf8"));
    return {
      items: Array.isArray(j.items) ? j.items : [],
      seen: Array.isArray(j.seen) ? j.seen : [],
      lastRun: j.lastRun || null, lastRunDate: j.lastRunDate || null, lastError: j.lastError || null,
    };
  } catch { return { items: [], seen: [], lastRun: null, lastRunDate: null, lastError: null }; }
}
async function saveInbox(box) {
  await fs.mkdir(SCOUT_DIR, { recursive: true });
  await fs.writeFile(SCOUT_INBOX, JSON.stringify(box, null, 2));
}

function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Best-effort Gmail digest. No-ops (with a log) when creds aren't set, so the
// inbox works standalone. Requires a Gmail App Password (2FA account).
async function sendDigest(items, to) {
  if (!emailConfigured()) { console.log("[scout] email skipped — set GMAIL_USER + GMAIL_APP_PASSWORD to enable"); return; }
  if (!to || !items.length) return;
  const user = process.env.GMAIL_USER.trim();
  const pass = process.env.GMAIL_APP_PASSWORD.trim();
  let nodemailer;
  try { nodemailer = (await import("nodemailer")).default; }
  catch { console.warn("[scout] nodemailer not installed — run npm install"); return; }
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  const rows = items.map((i) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #eee;">
      <div style="font-size:11px;letter-spacing:1px;color:#9a6a13;text-transform:uppercase;font-weight:700;">${esc(i.kicker)}${i.kicker ? " · " : ""}fit ${esc(i.score)}</div>
      <div style="font-size:18px;font-weight:700;margin:4px 0;">
        ${i.sourceUrl ? `<a href="${i.sourceUrl}" target="_blank" style="color:#9a6a13;text-decoration:underline;">${esc(i.headline)}</a>` : `<span style="color:#141414;">${esc(i.headline)}</span>`}
      </div>
      <div style="font-size:14px;color:#444;line-height:1.5;">${esc(i.body)}</div>
      ${i.whenWhere ? `<div style="font-size:12px;color:#888;margin-top:5px;">📍 ${esc(i.whenWhere)}</div>` : ""}
    </td></tr>`).join("");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:8px;">
    <h2 style="font-family:Georgia,serif;color:#141414;">🗞️ CGE News Scout — ${items.length} new ${items.length === 1 ? "story" : "stories"}</h2>
    <p style="color:#666;font-size:13px;line-height:1.5;">Timely New Jersey Black-culture &amp; community happenings that fit the beat. Open the Media tool → <b>News Scout</b> to turn any of these into a post.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="color:#aaa;font-size:11px;margin-top:22px;">Sent by your CGE News Scout · ${new Date().toDateString()}</p>
  </div>`;
  await transport.sendMail({
    from: `CGE News Scout <${user}>`, to,
    subject: `🗞️ ${items.length} new NJ Black-events ${items.length === 1 ? "story" : "stories"} — ${new Date().toDateString()}`,
    html,
  });
  console.log(`[scout] digest emailed to ${to} (${items.length} items)`);
}

let scoutRunning = false;
async function runScoutCycle(reason = "cron") {
  if (scoutRunning) return { skipped: "already-running" };
  const box = await loadInbox();
  const key = scoutKey();
  if (!key) {
    box.lastError = "No server Gemini key — set GEMINI_API_KEY in the environment.";
    box.lastRun = new Date().toISOString();
    await saveInbox(box);
    return { error: box.lastError };
  }
  scoutRunning = true;
  try {
    const now = new Date();
    const focus = focusForDay(now.getDay());
    const { candidates } = await runScout({ apiKey: key, area: scoutArea(), focus });
    const seen = new Set(box.seen);
    const fresh = [];
    for (const c of candidates) {
      const k = storyKey(c);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      fresh.push({
        id: `s_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        ...c, focus, firstSeen: now.toISOString(), read: false,
      });
    }
    box.items = [...fresh, ...box.items].slice(0, SCOUT_MAX_ITEMS);
    box.seen = [...seen].slice(-400);
    box.lastRun = now.toISOString();
    box.lastRunDate = now.toISOString().slice(0, 10);
    box.lastError = null;
    await saveInbox(box);
    if (fresh.length) sendDigest(fresh, scoutEmailTo()).catch((e) => console.warn("[scout] email failed:", e.message));
    console.log(`[scout] ${reason}: +${fresh.length} new (focus="${focus || "general"}")`);
    return { added: fresh.length, total: box.items.length };
  } catch (e) {
    box.lastError = String(e?.message || e);
    box.lastRun = new Date().toISOString();
    await saveInbox(box);
    console.warn("[scout] run failed:", box.lastError);
    return { error: box.lastError };
  } finally {
    scoutRunning = false;
  }
}

// GET the inbox + status.
app.get("/api/scout/inbox", async (_req, res) => {
  const box = await loadInbox();
  res.json({
    items: box.items,
    unread: box.items.filter((i) => !i.read).length,
    lastRun: box.lastRun, lastError: box.lastError,
    enabled: scoutEnabled(), hasKey: !!scoutKey(),
    emailTo: scoutEmailTo(), emailConfigured: emailConfigured(),
    running: scoutRunning,
  });
});
// Trigger a run now (the "Run scout now" button).
app.post("/api/scout/run", async (_req, res) => {
  const r = await runScoutCycle("manual");
  const box = await loadInbox();
  res.json({ ...r, items: box.items, unread: box.items.filter((i) => !i.read).length, lastRun: box.lastRun, lastError: box.lastError });
});
// Mark all items read (clears the badge).
app.post("/api/scout/read", async (_req, res) => {
  const box = await loadInbox();
  box.items = box.items.map((i) => ({ ...i, read: true }));
  await saveInbox(box);
  res.json({ ok: true, unread: 0 });
});
// Dismiss one item.
app.post("/api/scout/dismiss/:id", async (req, res) => {
  const id = safeId(req.params.id);
  const box = await loadInbox();
  box.items = box.items.filter((i) => i.id !== id);
  await saveInbox(box);
  res.json({ ok: true, items: box.items, unread: box.items.filter((i) => !i.read).length });
});

function initScoutCron() {
  if (!scoutEnabled()) { console.log("[scout] disabled (SCOUT_ENABLED=0)"); return; }
  const check = async () => {
    try {
      const box = await loadInbox();
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      // Run once per day, on the first check at/after the scout hour (server
      // local time — usually UTC on Replit; set SCOUT_HOUR accordingly).
      if (now.getHours() >= scoutHour() && box.lastRunDate !== todayStr) {
        await runScoutCycle("cron");
      }
    } catch (e) { console.warn("[scout] cron check failed:", e.message); }
  };
  setInterval(check, 15 * 60 * 1000);   // re-check every 15 min
  setTimeout(check, 10 * 1000);         // and shortly after boot
  console.log(`[scout] cron armed — daily after ${scoutHour()}:00 (server time), area="${scoutArea()}", email→${scoutEmailTo()}${emailConfigured() ? "" : " (email OFF — set GMAIL_USER + GMAIL_APP_PASSWORD)"}${scoutKey() ? "" : " (NO GEMINI KEY — set GEMINI_API_KEY)"}`);
}

// === WEBSITE INTEGRATION (centralgroupevents.com) ===
// Server-to-server bridge to the events website so the shared token never
// reaches the browser (booking rows carry PII — email / phone). The token must
// match CGE_INTEGRATION_TOKEN in the website's Replit Secrets; CGE_WEBSITE_URL
// overrides the default production host. Pipe 1: pull promoter bookings so they
// land in the Review queue instead of being retyped.
const WEBSITE_BASE = (process.env.CGE_WEBSITE_URL || "https://centralgroupevents.com").replace(/\/+$/, "");
const INTEGRATION_TOKEN = (process.env.CGE_INTEGRATION_TOKEN || "").trim();

app.get("/api/website/bookings", async (req, res) => {
  if (!INTEGRATION_TOKEN) {
    return res.status(503).json({ error: "not_configured", message: "Set CGE_INTEGRATION_TOKEN in this app's Replit Secrets (same value as the website)." });
  }
  try {
    const since = String(req.query.since || "").trim();
    const url = new URL(`${WEBSITE_BASE}/api/integrations/bookings`);
    if (since) url.searchParams.set("since", since);
    const r = await fetch(url.href, {
      headers: { Authorization: `Bearer ${INTEGRATION_TOKEN}`, Accept: "application/json" },
    });
    const text = await r.text();
    if (!r.ok) {
      return res.status(r.status === 401 ? 401 : 502).json({ error: "website_error", status: r.status, detail: text.slice(0, 300) });
    }
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    const bookings = Array.isArray(data) ? data : (Array.isArray(data.bookings) ? data.bookings : []);
    res.json({ bookings });
  } catch (e) {
    res.status(502).json({ error: "fetch_failed", message: String(e?.message || e) });
  }
});

// Pipe 2: push the refined event list to the website's calendar (upsert).
app.post("/api/website/events", express.json({ limit: "4mb" }), async (req, res) => {
  if (!INTEGRATION_TOKEN) {
    return res.status(503).json({ error: "not_configured", message: "Set CGE_INTEGRATION_TOKEN in this app's Replit Secrets (same value as the website)." });
  }
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const r = await fetch(`${WEBSITE_BASE}/api/integrations/events/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${INTEGRATION_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ events }),
    });
    const text = await r.text();
    if (!r.ok) {
      return res.status(r.status === 401 ? 401 : 502).json({ error: "website_error", status: r.status, detail: text.slice(0, 300) });
    }
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "fetch_failed", message: String(e?.message || e) });
  }
});

// Pipe (Guides): publish a whole themed guide page (title + editorial body +
// listings) to the website in one call.
app.post("/api/website/pages", express.json({ limit: "4mb" }), async (req, res) => {
  if (!INTEGRATION_TOKEN) {
    return res.status(503).json({ error: "not_configured", message: "Set CGE_INTEGRATION_TOKEN in this app's Replit Secrets (same value as the website)." });
  }
  try {
    const r = await fetch(`${WEBSITE_BASE}/api/integrations/pages/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${INTEGRATION_TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const text = await r.text();
    if (!r.ok) {
      return res.status(r.status === 401 ? 401 : 502).json({ error: "website_error", status: r.status, detail: text.slice(0, 300) });
    }
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "fetch_failed", message: String(e?.message || e) });
  }
});

// === VITE MIDDLEWARE / STATIC ===

if (NODE_ENV === "production") {
  // Production fallback: serve the prebuilt SPA from dist/. Note: Replit
  // deploys this app as a static site by default, in which case this branch
  // never runs because there's no Node process. If you switch deployment to
  // Reserved VM / Autoscale, this path keeps the API alive in prod too.
  const distDir = path.resolve(__dirname, "dist");
  app.use(express.static(distDir));
  app.get("*", (_req, res) => res.sendFile(path.join(distDir, "index.html")));
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true, host: "0.0.0.0" },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CGE Tools server listening on http://0.0.0.0:${PORT}  (${NODE_ENV})`);
  console.log(`  Workspaces at ${DATA_DIR}`);
  console.log(`  Photos    at ${LIBRARY_DIRS.photos}`);
  console.log(`  Exports   at ${LIBRARY_DIRS.exports}`);
  console.log(`  Apify     ${APIFY_TOKEN ? "configured (extract-time IG fetch)" : "OFF — set APIFY_TOKEN to fetch IG images on Extract"}`);
  initScoutCron();
});
