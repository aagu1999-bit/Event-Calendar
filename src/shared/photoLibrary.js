// Server-backed photo + export library.
//
// The library lives on the Repl filesystem via /api/library/* — same
// pattern as Cloud Workspaces. One source of truth: every browser /
// account that hits the Repl URL sees the same library, instead of each
// tracking its own per-browser IndexedDB.
//
// The external API is identical to the legacy IndexedDB module (so every
// consumer — PhotoLibraryModal, ExportLibraryModal, RecapPicker, MediaTool,
// FlyerBuilder, workspaceSync — keeps working with zero callsite changes).
// Internally everything goes through fetch().
//
// On the disk side (server.js writes these):
//   data/library/<kind>/<id>.bin    — full blob
//   data/library/<kind>/<id>.thumb  — 240px JPEG preview (optional)
//   data/library/<kind>/<id>.json   — metadata
//
// Cross-device notifications: a single setInterval poll on the metadata
// list refreshes every 10s. Photo libraries don't change that fast and
// 10s of staleness is acceptable; the alternative (Server-Sent Events) is
// more code for marginal benefit. Manual saves and deletes still fire the
// in-memory event immediately for instant local feedback.

// Legacy IndexedDB module — imported here so the one-time migration tool
// (countLegacyLibrary + migrateLegacyToCloud at the bottom of this file)
// can read existing per-browser data and upload it to the cloud.
import {
  getAllPhotosRawLocal,
  getAllExportsRawLocal,
  clearAllPhotosLocal,
  clearAllExportsLocal,
} from "./legacyLocalLibrary.js";
import { retryFetch } from "./retryFetch.js";

const LIBRARY_API = "/api/library";
const POLL_MS = 10_000;

// Resize an image blob to a max edge of `maxEdge` px and return a JPEG blob.
// Used as the thumbnail so the gallery loads fast.
async function makeThumb(blob, maxEdge = 240) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(img, 0, 0, w, h);
    const thumb = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.78));
    return { thumb, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Read a Blob as a base64 data URL (used to ship it inside JSON).
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Generate a UUID for new records — same scheme the legacy DB used so we
// can migrate ids cleanly without collisions.
function makeId(prefix) {
  const ts = Date.now();
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}_${ts}_${Math.random().toString(36).slice(2, 10)}`;
}

// Fetch wrapper that surfaces server errors as Error objects with a usable
// message (instead of res.ok = false returning silently).
async function api(path, init = {}) {
  const res = await retryFetch(LIBRARY_API + path, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.error) msg += ` — ${j.error}`;
    } catch { /* not json */ }
    throw new Error(msg);
  }
  return res;
}

// Internal: POST a record (blob + thumb + meta) to the server.
async function uploadRecord(kind, id, blob, thumb, meta) {
  const blobB64 = await blobToDataUrl(blob);
  const thumbB64 = thumb ? await blobToDataUrl(thumb) : null;
  await api(`/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, meta, blob: blobB64, thumb: thumbB64 }),
  });
}

// Cache the listings briefly so PhotoLibraryModal + ExportLibraryModal
// opening in quick succession don't hammer the server. Invalidated on any
// save or delete.
let _photosCache = null, _photosCacheAt = 0;
let _exportsCache = null, _exportsCacheAt = 0;
const CACHE_MS = 2000;

async function getPhotosList() {
  const now = Date.now();
  if (_photosCache && now - _photosCacheAt < CACHE_MS) return _photosCache;
  const res = await api("/photos");
  _photosCache = await res.json();
  _photosCacheAt = now;
  return _photosCache;
}

async function getExportsList() {
  const now = Date.now();
  if (_exportsCache && now - _exportsCacheAt < CACHE_MS) return _exportsCache;
  const res = await api("/exports");
  _exportsCache = await res.json();
  _exportsCacheAt = now;
  return _exportsCache;
}

function invalidatePhotos() { _photosCache = null; }
function invalidateExports() { _exportsCache = null; }

// === PHOTOS ===

// Save a File/Blob into the library. nowMs comes from the caller so this
// stays deterministic for tests.
export async function savePhoto(file, opts = {}) {
  const { sourceTool = "unknown", sourceMode = "", nowMs = Date.now() } = opts;
  if (!file || !(file instanceof Blob)) throw new Error("savePhoto requires a Blob/File");
  const { thumb, width, height } = await makeThumb(file);
  const id = makeId("p");
  const meta = {
    id,
    mime: file.type || "image/jpeg",
    name: (file.name || `photo-${nowMs}`).slice(0, 200),
    sourceTool,
    sourceMode,
    width,
    height,
    bytes: file.size || 0,
    createdAt: nowMs,
  };
  await uploadRecord("photos", id, file, thumb, meta);
  invalidatePhotos();
  return id;
}

// List all photos, newest first. thumbUrl is a real URL pointing at the
// server's thumb endpoint — caller drops it straight into <img src>.
export async function listPhotos(filter = {}) {
  const all = await getPhotosList();
  return all
    .filter(r => !filter.sourceTool || r.sourceTool === filter.sourceTool)
    .map(r => ({
      id: r.id,
      thumbUrl: `${LIBRARY_API}/photos/${r.id}/thumb`,
      name: r.name,
      sourceTool: r.sourceTool,
      sourceMode: r.sourceMode,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      createdAt: r.createdAt,
    }));
}

// Pull the full-size Blob back out by id — used when the user picks a
// library photo to drop into a tool.
export async function loadPhotoBlob(id) {
  const res = await api(`/photos/${id}/blob`);
  return res.blob();
}

export async function loadPhotoAsImage(id) {
  const blob = await loadPhotoBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Revoke as soon as the bitmap has decoded. The decoded HTMLImageElement
    // stays fully usable for repeated drawImage() after the object URL is
    // gone — only the redundant full-size Blob backing gets freed. Skipping
    // this pinned one full-resolution blob in memory PER library pick for the
    // life of the page; a long carousel/calendar session picking dozens of
    // photos leaked steadily until the tab OOM-crashed.
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function loadPhotoAsDataUrl(id) {
  const blob = await loadPhotoBlob(id);
  if (!blob) return null;
  return blobToDataUrl(blob);
}

export async function deletePhoto(id) {
  await api(`/photos/${id}`, { method: "DELETE" });
  invalidatePhotos();
}

export async function usageBytes() {
  const all = await getPhotosList();
  return all.reduce((sum, r) => sum + (r.bytes || 0), 0);
}

// Lets pages refresh after a save without re-querying on every tool action.
// Pages subscribe; savePhoto/deletePhoto fire after the write commits, and
// the polling timer also fires so cross-device changes propagate.
const _listeners = new Set();
export function onLibraryChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function notify() { _listeners.forEach(fn => { try { fn(); } catch {} }); }

const _saveBare = savePhoto;
const _deleteBare = deletePhoto;
export const savePhotoAndNotify = async (...args) => {
  const id = await _saveBare(...args);
  notify();
  return id;
};
export const deletePhotoAndNotify = async (...args) => {
  await _deleteBare(...args);
  notify();
};

// === EXPORTS ===

const _exportListeners = new Set();
export function onExportsChange(fn) {
  _exportListeners.add(fn);
  return () => _exportListeners.delete(fn);
}
function notifyExports() { _exportListeners.forEach(fn => { try { fn(); } catch {} }); }

export async function saveExport(blob, opts = {}) {
  const {
    sourceTool = "unknown",
    sourceMode = "",
    name = "export",
    kind: kindOverride,
    snapshot = null,
    nowMs = Date.now(),
    // Optional pre-generated id. Used by Media/Flyer/Calendar so the PNG
    // tEXt tag and the cloud record share the same id and the file can
    // be looked up later via the embedded tag.
    id: providedId,
  } = opts;
  if (!blob || !(blob instanceof Blob)) throw new Error("saveExport requires a Blob");
  const mime = blob.type || "application/octet-stream";
  const kind = kindOverride || (mime.startsWith("image/") ? "image" : "archive");
  let thumb = null, width = 0, height = 0;
  if (kind === "image" || kind === "draft") {
    try {
      const t = await makeThumb(blob);
      thumb = t.thumb; width = t.width; height = t.height;
    } catch (e) {
      console.warn("Export thumb failed:", e);
    }
  }
  const id = providedId || makeId("e");
  const meta = {
    id,
    mime,
    name: String(name).slice(0, 240),
    sourceTool,
    sourceMode,
    width,
    height,
    bytes: blob.size || 0,
    kind,
    snapshot,
    hasSnapshot: !!snapshot,
    createdAt: nowMs,
  };
  await uploadRecord("exports", id, blob, thumb, meta);
  invalidateExports();
  notifyExports();
  return id;
}

// Fetch the FULL export record for one id, including the heavy `snapshot`
// used to restore a draft. The list endpoint strips snapshots out (returning
// all of them OOM-crashed the deployment), so we hit the per-id meta endpoint
// here — one record at a time is cheap. Callers want the snapshot; the blob
// is fetched separately when needed.
export async function loadExportRecord(id) {
  try {
    const res = await api(`/exports/${id}/meta`);
    return await res.json();
  } catch {
    // Fall back to the (snapshot-less) list entry so callers that only need
    // the lightweight metadata still get something rather than null.
    const all = await getExportsList();
    return all.find(r => r.id === id) || null;
  }
}

export async function listExports(filter = {}) {
  const all = await getExportsList();
  return all
    .filter(r => !filter.sourceTool || r.sourceTool === filter.sourceTool)
    .filter(r => !filter.kind || r.kind === filter.kind)
    .map(r => ({
      id: r.id,
      thumbUrl: r.kind === "image" || r.kind === "draft" ? `${LIBRARY_API}/exports/${r.id}/thumb` : null,
      name: r.name,
      sourceTool: r.sourceTool,
      sourceMode: r.sourceMode,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      kind: r.kind,
      mime: r.mime,
      // The list endpoint no longer ships the snapshot itself — it sends a
      // `hasSnapshot` flag instead. Fall back to the old `!!r.snapshot` shape
      // for any cached/legacy record that still carries the full snapshot.
      hasSnapshot: r.hasSnapshot ?? !!r.snapshot,
      createdAt: r.createdAt,
    }));
}

export async function loadExportBlob(id) {
  const res = await api(`/exports/${id}/blob`);
  return res.blob();
}

export async function deleteExport(id) {
  await api(`/exports/${id}`, { method: "DELETE" });
  invalidateExports();
  notifyExports();
}

export async function exportsUsageBytes() {
  const all = await getExportsList();
  return all.reduce((sum, r) => sum + (r.bytes || 0), 0);
}

// === BULK helpers for workspace export/import ===
// Surface raw records (with their Blob fields populated) so workspaceSync
// can serialize the whole library into a single shareable file. These do
// N+1 fetches (list, then blob per item) — slower than the old direct
// IndexedDB getAll, but workspace export is a manual button click anyway.

async function attachBlob(kind, meta) {
  try {
    const res = await api(`/${kind}/${meta.id}/blob`);
    const blob = await res.blob();
    return { ...meta, blob };
  } catch {
    return null;
  }
}

export async function getAllPhotosRaw() {
  const all = await getPhotosList();
  const withBlobs = await Promise.all(all.map(m => attachBlob("photos", m)));
  return withBlobs.filter(Boolean);
}

export async function getAllExportsRaw() {
  const all = await getExportsList();
  // The list no longer includes the heavy `snapshot` (it OOM-crashed the
  // server). Workspace export needs the full record so drafts survive the
  // round trip, so fetch each id's full meta before attaching its blob.
  const withBlobs = await Promise.all(all.map(async (m) => {
    let full = m;
    try {
      const res = await api(`/exports/${m.id}/meta`);
      full = await res.json();
    } catch { /* fall back to the lightweight list entry */ }
    return attachBlob("exports", full);
  }));
  return withBlobs.filter(Boolean);
}

export async function clearAllPhotos() {
  const all = await getPhotosList();
  await Promise.all(all.map(r => api(`/photos/${r.id}`, { method: "DELETE" }).catch(() => {})));
  invalidatePhotos();
  notify();
}

export async function clearAllExports() {
  const all = await getExportsList();
  await Promise.all(all.map(r => api(`/exports/${r.id}`, { method: "DELETE" }).catch(() => {})));
  invalidateExports();
  notifyExports();
}

// Re-import a workspace's library records. Used by workspaceSync.importWorkspace().
export async function putPhotoRaw(record) {
  if (!record || !record.id || !record.blob) return;
  const thumb = record.thumb || null;
  const meta = {
    id: record.id,
    mime: record.mime,
    name: record.name,
    sourceTool: record.sourceTool,
    sourceMode: record.sourceMode,
    width: record.width,
    height: record.height,
    bytes: record.bytes,
    createdAt: record.createdAt,
  };
  await uploadRecord("photos", record.id, record.blob, thumb, meta);
  invalidatePhotos();
}

export async function putExportRaw(record) {
  if (!record || !record.id || !record.blob) return;
  const thumb = record.thumb || null;
  const meta = {
    id: record.id,
    mime: record.mime,
    name: record.name,
    sourceTool: record.sourceTool,
    sourceMode: record.sourceMode,
    width: record.width,
    height: record.height,
    bytes: record.bytes,
    kind: record.kind,
    snapshot: record.snapshot || null,
    hasSnapshot: !!record.snapshot,
    createdAt: record.createdAt,
  };
  await uploadRecord("exports", record.id, record.blob, thumb, meta);
  invalidateExports();
}

// === DOWNLOAD HELPER ===
// Same shape as the legacy module — save the blob to the cloud library
// AND trigger a browser download in one call.
export async function downloadAndArchive(blob, filename, opts) {
  const savePromise = saveExport(blob, { ...opts, name: filename })
    .catch(err => console.warn("Export archive failed:", err));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return savePromise;
}

// === CROSS-DEVICE POLLING ===
// Boot a single poll loop that detects changes from OTHER devices and
// fires the in-memory notify callbacks. Subscribers to onLibraryChange /
// onExportsChange react the same way they would to a local save.
//
// Detection is hash-cheap: stringify the list of (id, createdAt) tuples
// and compare to the previous run. Changes (additions, deletions, new
// uploads) all change the hash; metadata-only edits to existing records
// don't trigger, which is fine for now.
let _pollTimer = null;
let _photosHash = "", _exportsHash = "";

function hashList(arr) {
  if (!Array.isArray(arr)) return "";
  return arr.map(r => `${r.id}:${r.createdAt}:${r.bytes || 0}`).join("|");
}

async function pollOnce() {
  try {
    const [p, e] = await Promise.all([
      fetch(LIBRARY_API + "/photos").then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(LIBRARY_API + "/exports").then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    const ph = hashList(p);
    const eh = hashList(e);
    if (ph !== _photosHash) {
      _photosHash = ph;
      _photosCache = p; _photosCacheAt = Date.now();
      notify();
    }
    if (eh !== _exportsHash) {
      _exportsHash = eh;
      _exportsCache = e; _exportsCacheAt = Date.now();
      notifyExports();
    }
  } catch { /* offline — keep last known state */ }
}

if (typeof window !== "undefined") {
  // Prime the hashes on boot without firing notifications (nothing to react
  // to yet — UIs do their own initial load).
  (async () => {
    try {
      const [p, e] = await Promise.all([
        fetch(LIBRARY_API + "/photos").then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(LIBRARY_API + "/exports").then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      _photosHash = hashList(p);
      _exportsHash = hashList(e);
    } catch { /* ignore */ }
  })();
  _pollTimer = setInterval(pollOnce, POLL_MS);
}

// === ONE-TIME MIGRATION FROM LEGACY INDEXEDDB ===
// For users coming from the previous (per-browser) IndexedDB library.
// Counts local-only records and offers to upload them to the cloud.
// After successful upload, optionally wipes the local DB so the migrate
// button doesn't keep surfacing. (Imports for these helpers live at the
// top of this file — ESM requires top-level import declarations.)

// How many records sit in the legacy per-browser IndexedDB right now.
// Used to decide whether to show the migrate banner. Returns {photos, exports}.
// Either field will be 0 if IndexedDB is unavailable (e.g. private browsing).
export async function countLegacyLibrary() {
  try {
    const [photos, exports] = await Promise.all([
      getAllPhotosRawLocal().catch(() => []),
      getAllExportsRawLocal().catch(() => []),
    ]);
    return { photos: photos.length, exports: exports.length };
  } catch {
    return { photos: 0, exports: 0 };
  }
}

// Upload every legacy record to the cloud. onProgress fires after each
// item so the UI can render a percentage. Survives per-item failures
// (counts them in `errors`) so one bad blob doesn't abort the whole run.
//
// If clearAfter is true, wipes the local IndexedDB after upload so the
// migrate banner stops appearing on this browser. Safe because the cloud
// is now authoritative; legacy local data was only being read for this
// migration anyway.
export async function migrateLegacyToCloud({ onProgress, clearAfter = false } = {}) {
  const [photos, exportsArr] = await Promise.all([
    getAllPhotosRawLocal().catch(() => []),
    getAllExportsRawLocal().catch(() => []),
  ]);
  const total = photos.length + exportsArr.length;
  let done = 0, errors = 0;
  const reportErr = (kind, id, err) => {
    errors++;
    console.warn(`Migrate ${kind} ${id} failed:`, err);
  };

  for (const p of photos) {
    try { await putPhotoRaw(p); }
    catch (e) { reportErr("photo", p.id, e); }
    done++;
    onProgress?.({ done, total, kind: "photos" });
  }
  for (const ex of exportsArr) {
    try { await putExportRaw(ex); }
    catch (e) { reportErr("export", ex.id, e); }
    done++;
    onProgress?.({ done, total, kind: "exports" });
  }

  if (clearAfter && errors === 0) {
    await Promise.all([
      clearAllPhotosLocal().catch(() => {}),
      clearAllExportsLocal().catch(() => {}),
    ]);
  }

  invalidatePhotos();
  invalidateExports();
  notify();
  notifyExports();

  return { migrated: total - errors, errors, total };
}
