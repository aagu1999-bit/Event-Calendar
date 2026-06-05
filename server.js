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
const NODE_ENV = process.env.NODE_ENV || "development";

const app = express();

// Filename guard — Replit's filesystem doesn't care about UTF-8 weirdness,
// but we don't want anyone reading /etc/passwd via "../../../passwd".
function safeName(raw) {
  const base = path.basename(String(raw || ""));
  if (!base || base.startsWith(".") || base.includes("..") || base.length > 200) return null;
  return base;
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

// Health check — the client pings this on boot to decide whether to show
// the cloud buttons. Returns version so we can tell apart old servers if
// the API ever changes.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, api: "workspaces", version: 1, env: NODE_ENV });
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
  console.log(`  Workspaces stored at ${DATA_DIR}`);
});
