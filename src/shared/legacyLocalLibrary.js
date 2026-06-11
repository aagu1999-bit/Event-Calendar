// LEGACY: Per-browser IndexedDB photo + export library.
//
// As of v2 (Cloud Library), the live library lives on the Repl filesystem
// via the /api/library/* endpoints and is shared across every browser /
// account that hits the URL. This file is kept ONLY so the one-time
// migration tool can read older clients' local data and upload it to
// the cloud. No production code path should import from here — use the
// new photoLibrary.js (server-backed) instead.
//
// The exports are namespaced with `Local` suffixes so a file can import
// both this module and the new server-backed one side by side without
// name collisions during the migration window.

const DB_NAME = "cge-photo-library";
const DB_VERSION = 2;
const STORE = "photos";
const STORE_EXPORTS = "exports";

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable (private browsing?)"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("createdAt", "createdAt");
        os.createIndex("sourceTool", "sourceTool");
      }
      if (!db.objectStoreNames.contains(STORE_EXPORTS)) {
        const os = db.createObjectStore(STORE_EXPORTS, { keyPath: "id" });
        os.createIndex("createdAt", "createdAt");
        os.createIndex("sourceTool", "sourceTool");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDB().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

function txExports(mode) {
  return openDB().then(db => db.transaction(STORE_EXPORTS, mode).objectStore(STORE_EXPORTS));
}

function awaitRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

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

// Save a File/Blob into the library. nowMs comes from the caller so this
// stays deterministic for tests and avoids new Date() inside the module.
export async function savePhotoLocal(file, opts = {}) {
  const { sourceTool = "unknown", sourceMode = "", nowMs = Date.now() } = opts;
  if (!file || !(file instanceof Blob)) throw new Error("savePhoto requires a Blob/File");
  const { thumb, width, height } = await makeThumb(file);
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `p_${nowMs}_${Math.random().toString(36).slice(2, 10)}`;
  const record = {
    id,
    blob: file,
    thumb,
    mime: file.type || "image/jpeg",
    name: (file.name || `photo-${nowMs}`).slice(0, 200),
    sourceTool,
    sourceMode,
    width,
    height,
    bytes: file.size || 0,
    createdAt: nowMs,
  };
  const store = await tx("readwrite");
  await awaitRequest(store.put(record));
  return id;
}

// List all photos, newest first. Returns lightweight metadata + a thumb
// object URL. The caller is responsible for revoking the URLs when the UI
// unmounts (or just lets them live for the page lifetime).
export async function listPhotosLocal(filter = {}) {
  const store = await tx("readonly");
  const all = await awaitRequest(store.getAll());
  all.sort((a, b) => b.createdAt - a.createdAt);
  return all
    .filter(r => !filter.sourceTool || r.sourceTool === filter.sourceTool)
    .map(r => ({
      id: r.id,
      thumbUrl: URL.createObjectURL(r.thumb),
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
export async function loadPhotoBlobLocal(id) {
  const store = await tx("readonly");
  const rec = await awaitRequest(store.get(id));
  return rec ? rec.blob : null;
}

// Convenience for tools that consume HTMLImageElement instead of Blob.
export async function loadPhotoAsImageLocal(id) {
  const blob = await loadPhotoBlobLocal(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
    // Don't revoke — the consumer holds the img and may re-draw it later.
    // Browsers GC the blob when the img is dropped.
  });
}

// Same as above but yields a data URL — used by tools that store the photo
// as a data: src (FlyerBuilder).
export async function loadPhotoAsDataUrlLocal(id) {
  const blob = await loadPhotoBlobLocal(id);
  if (!blob) return null;
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function deletePhotoLocal(id) {
  const store = await tx("readwrite");
  await awaitRequest(store.delete(id));
}

export async function usageBytesLocal() {
  const store = await tx("readonly");
  const all = await awaitRequest(store.getAll());
  return all.reduce((sum, r) => sum + (r.bytes || 0) + (r.thumb?.size || 0), 0);
}

// Lets pages refresh after a save without re-querying on every tool action.
// Pages subscribe; savePhoto/deletePhoto fire after the write commits.
const _listeners = new Set();
export function onLibraryChangeLocal(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function notify() { _listeners.forEach(fn => { try { fn(); } catch {} }); }

// Public re-exports of save/delete that also fire the change event.
const _saveBare = savePhotoLocal;
const _deleteBare = deletePhotoLocal;
export const savePhotoAndNotifyLocal = async (...args) => {
  const id = await _saveBare(...args);
  notify();
  return id;
};
export const deletePhotoAndNotifyLocal = async (...args) => {
  await _deleteBare(...args);
  notify();
};

// ===== Exports store =====
// Every rendered PNG or ZIP the user downloads from any tool also lands
// here, keyed by source tool / mode / filename. Lets them re-download
// anything they've made before without keeping it on disk.
//
// Record shape:
//   { id, blob, thumb?, mime, name, sourceTool, sourceMode, width?, height?,
//     bytes, kind, createdAt }
// `kind` is "image" or "archive" — drives whether the gallery shows a
// thumbnail or a generic file tile.

const _exportListeners = new Set();
export function onExportsChangeLocal(fn) {
  _exportListeners.add(fn);
  return () => _exportListeners.delete(fn);
}
function notifyExports() { _exportListeners.forEach(fn => { try { fn(); } catch {} }); }

export async function saveExportLocal(blob, opts = {}) {
  const {
    sourceTool = "unknown",
    sourceMode = "",
    name = "export",
    kind: kindOverride,
    snapshot = null,   // tool-specific state captured at export time (phase 3)
    nowMs = Date.now(),
  } = opts;
  if (!blob || !(blob instanceof Blob)) throw new Error("saveExport requires a Blob");
  const mime = blob.type || "application/octet-stream";
  const kind = kindOverride || (mime.startsWith("image/") ? "image" : "archive");
  let thumb = null, width = 0, height = 0;
  if (kind === "image") {
    try {
      const t = await makeThumb(blob);
      thumb = t.thumb; width = t.width; height = t.height;
    } catch (e) {
      console.warn("Export thumb failed:", e);
    }
  }
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `e_${nowMs}_${Math.random().toString(36).slice(2, 10)}`;
  const record = {
    id,
    blob,
    thumb,
    mime,
    name: String(name).slice(0, 240),
    sourceTool,
    sourceMode,
    width,
    height,
    bytes: blob.size || 0,
    kind,
    snapshot,
    createdAt: nowMs,
  };
  const store = await txExports("readwrite");
  await awaitRequest(store.put(record));
  notifyExports();
  return id;
}

// Pulls the full record (incl. snapshot) for "Edit in [tool]". Blobs come
// along too in case the caller wants a thumb fallback, but this is mainly
// about the snapshot object.
export async function loadExportRecordLocal(id) {
  const store = await txExports("readonly");
  return awaitRequest(store.get(id));
}

export async function listExportsLocal(filter = {}) {
  const store = await txExports("readonly");
  const all = await awaitRequest(store.getAll());
  all.sort((a, b) => b.createdAt - a.createdAt);
  return all
    .filter(r => !filter.sourceTool || r.sourceTool === filter.sourceTool)
    .filter(r => !filter.kind || r.kind === filter.kind)
    .map(r => ({
      id: r.id,
      thumbUrl: r.thumb ? URL.createObjectURL(r.thumb) : null,
      name: r.name,
      sourceTool: r.sourceTool,
      sourceMode: r.sourceMode,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      kind: r.kind,
      mime: r.mime,
      hasSnapshot: !!r.snapshot,
      createdAt: r.createdAt,
    }));
}

export async function loadExportBlobLocal(id) {
  const store = await txExports("readonly");
  const rec = await awaitRequest(store.get(id));
  return rec ? rec.blob : null;
}

export async function deleteExportLocal(id) {
  const store = await txExports("readwrite");
  await awaitRequest(store.delete(id));
  notifyExports();
}

export async function exportsUsageBytesLocal() {
  const store = await txExports("readonly");
  const all = await awaitRequest(store.getAll());
  return all.reduce((sum, r) => sum + (r.bytes || 0) + (r.thumb?.size || 0), 0);
}

// ===== Bulk helpers for workspace export/import =====
// Surface the raw IndexedDB records (with their Blob fields intact) so the
// workspace sync layer can serialize them to a single shareable file.

export async function getAllPhotosRawLocal() {
  const store = await tx("readonly");
  return awaitRequest(store.getAll());
}
export async function getAllExportsRawLocal() {
  const store = await txExports("readonly");
  return awaitRequest(store.getAll());
}

// Wipe-and-replace primitives used by importWorkspace(). The caller has
// already confirmed clobber with the user.
export async function clearAllPhotosLocal() {
  const store = await tx("readwrite");
  await awaitRequest(store.clear());
  notify();
}
export async function clearAllExportsLocal() {
  const store = await txExports("readwrite");
  await awaitRequest(store.clear());
  notifyExports();
}
export async function putPhotoRawLocal(record) {
  const store = await tx("readwrite");
  await awaitRequest(store.put(record));
}
export async function putExportRawLocal(record) {
  const store = await txExports("readwrite");
  await awaitRequest(store.put(record));
}

// Wrap a save + browser-download pipeline: the host's existing download
// code calls this helper instead of new Blob/createObjectURL by hand, so
// the file goes to the user AND gets archived in the library in one call.
export async function downloadAndArchiveLocal(blob, filename, opts) {
  // Fire the save in parallel with the download — failures don't block.
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
