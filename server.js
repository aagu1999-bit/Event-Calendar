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

// Same filename guard as workspaces — strip path traversal, leading
// dots, excessive length.
function safeSessionName(raw) {
  const base = path.basename(String(raw || "").replace(/\.json$/i, ""));
  if (!base || base.startsWith(".") || base.includes("..") || base.length > 100) return null;
  return base + ".json";
}

// List every session in the dir, newest first, with name + size + mtime
// + event count peeked from the JSON. The peek is cheap because review
// sessions are small JSON.
app.get("/api/review-sessions", async (_req, res) => {
  try {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const files = await fs.readdir(SESSIONS_DIR);
    const out = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const st = await fs.stat(path.join(SESSIONS_DIR, f));
        let eventCount = 0, approvalCount = 0, vettedCount = 0, savedAt = st.mtimeMs;
        try {
          const data = JSON.parse(await fs.readFile(path.join(SESSIONS_DIR, f), "utf8"));
          eventCount = Array.isArray(data.events) ? data.events.length : 0;
          approvalCount = data.approvals ? Object.values(data.approvals).filter(Boolean).length : 0;
          vettedCount = Array.isArray(data.vetted) ? data.vetted.length : 0;
          if (data.savedAt) savedAt = data.savedAt;
        } catch { /* corrupt — surface as 0 counts */ }
        out.push({
          name: f.replace(/\.json$/, ""),
          size: st.size,
          mtime: st.mtimeMs,
          savedAt,
          eventCount,
          approvalCount,
          vettedCount,
        });
      } catch { /* vanished mid-list */ }
    }
    out.sort((a, b) => b.savedAt - a.savedAt);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/review-sessions/:name", async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  const full = path.join(SESSIONS_DIR, name);
  if (!existsSync(full)) return res.status(404).json({ error: "Not found" });
  try {
    const data = JSON.parse(await fs.readFile(full, "utf8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/review-sessions/:name", express.json({ limit: "10mb" }), async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  try {
    const body = req.body || {};
    const data = {
      events: Array.isArray(body.events) ? body.events : [],
      approvals: body.approvals && typeof body.approvals === "object" ? body.approvals : {},
      vetted: Array.isArray(body.vetted) ? body.vetted : [],
      filter: typeof body.filter === "string" ? body.filter : "",
      sortByTag: typeof body.sortByTag === "string" ? body.sortByTag : null,
      savedAt: Date.now(),
    };
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    await fs.writeFile(path.join(SESSIONS_DIR, name), JSON.stringify(data));
    res.json({ ok: true, savedAt: data.savedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/review-sessions/:name", async (req, res) => {
  const name = safeSessionName(req.params.name);
  if (!name) return res.status(400).json({ error: "Invalid name" });
  try {
    await fs.unlink(path.join(SESSIONS_DIR, name));
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") return res.status(404).json({ error: "Not found" });
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
  const auth = new JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const doc = new GoogleSpreadsheet(SHEET_ID, auth);
  await doc.loadInfo();
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
      const cellVal = sheet.getCell(r, c).value;
      obj[headers[c]] = cellVal == null ? "" : String(cellVal);
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

// Health check — the client pings this on boot to decide whether to show
// the cloud buttons. Returns version so we can tell apart old servers if
// the API ever changes.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, api: "workspaces+library+reviewSessions+weekendReview", version: 5, env: NODE_ENV });
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
