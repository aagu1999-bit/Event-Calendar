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
import { fileURLToPath } from "url";
import { runScout, storyKey, focusForDay } from "./scoutServer.js";
import { createSessionStore, normalizeSession, applySessionOps } from "./reviewSessionStore.js";

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
    const merged = await sessionStore.update(name, (old) => applySessionOps(old, req.body?.ops));
    res.json({ ok: true, session: merged, backend: sessionStore.backend });
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
    await sheet.loadCells();

    // Build header→column-index map from row 0.
    const headerToCol = {};
    for (let c = 0; c < sheet.columnCount; c++) {
      const v = sheet.getCell(0, c).value;
      if (v == null || String(v).trim() === "") break;
      headerToCol[String(v)] = c;
    }
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
    await sheet.saveUpdatedCells();
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
    await sheet.loadCells();

    // Build header→col map once
    const headerToCol = {};
    for (let c = 0; c < sheet.columnCount; c++) {
      const v = sheet.getCell(0, c).value;
      if (v == null || String(v).trim() === "") break;
      headerToCol[String(v)] = c;
    }
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
    await sheet.saveUpdatedCells();
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
  res.json({ ok: true, api: "workspaces+library+reviewSessions+weekendReview", version: 6, env: NODE_ENV, sessionBackend: sessionStore.backend });
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
  initScoutCron();
});
