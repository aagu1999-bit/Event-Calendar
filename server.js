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
        out.push(meta);
      } catch { /* corrupt — skip */ }
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json(out);
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

// Health check — the client pings this on boot to decide whether to show
// the cloud buttons. Returns version so we can tell apart old servers if
// the API ever changes.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, api: "workspaces+library", version: 2, env: NODE_ENV });
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
});
