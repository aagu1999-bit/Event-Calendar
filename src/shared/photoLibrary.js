// IndexedDB-backed photo library — keeps every uploaded photo around so the
// user can pick from a built-in gallery instead of re-hunting through their
// computer. Used by Media, Flyer, and Calendar upload paths.
//
// Each record stores:
//   { id, blob, thumb, mime, name, sourceTool, sourceMode, width, height,
//     bytes, createdAt }
// `thumb` is a max-240px JPEG used in the grid so listPhotos() doesn't have
// to load full-size blobs.

const DB_NAME = "cge-photo-library";
const DB_VERSION = 1;
const STORE = "photos";

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDB().then(db => db.transaction(STORE, mode).objectStore(STORE));
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
export async function savePhoto(file, opts = {}) {
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
export async function listPhotos(filter = {}) {
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
export async function loadPhotoBlob(id) {
  const store = await tx("readonly");
  const rec = await awaitRequest(store.get(id));
  return rec ? rec.blob : null;
}

// Convenience for tools that consume HTMLImageElement instead of Blob.
export async function loadPhotoAsImage(id) {
  const blob = await loadPhotoBlob(id);
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
export async function loadPhotoAsDataUrl(id) {
  const blob = await loadPhotoBlob(id);
  if (!blob) return null;
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function deletePhoto(id) {
  const store = await tx("readwrite");
  await awaitRequest(store.delete(id));
}

export async function usageBytes() {
  const store = await tx("readonly");
  const all = await awaitRequest(store.getAll());
  return all.reduce((sum, r) => sum + (r.bytes || 0) + (r.thumb?.size || 0), 0);
}

// Lets pages refresh after a save without re-querying on every tool action.
// Pages subscribe; savePhoto/deletePhoto fire after the write commits.
const _listeners = new Set();
export function onLibraryChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function notify() { _listeners.forEach(fn => { try { fn(); } catch {} }); }

// Public re-exports of save/delete that also fire the change event.
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
