// Workspace export / import — bundles every piece of locally-stored state
// (events, regulars, photo library, export library, snapshots) into a
// single ZIP file the user can share with teammates via Drive / Slack /
// email. Lossless: photo and export blobs travel as raw files inside the
// archive, JSON holds metadata + snapshots + events / regulars.
//
// File layout inside the .cgework zip:
//   workspace.json          → everything except binary blobs
//   photos/<id>.<ext>       → original photo files
//   photos/<id>.thumb.jpg   → 240px thumbnails
//   exports/<id>.<ext>      → original export blobs (PNG / ZIP / WebM)
//   exports/<id>.thumb.jpg  → thumbnails (image exports only)
//
// Versioned via WORKSPACE_VERSION so future changes can stay backwards-
// compatible without forcing every collaborator to upgrade simultaneously.

import JSZip from "jszip";
import {
  useEventsStore,
  useRegularsStore,
} from "../store.js";
import {
  getAllPhotosRaw,
  getAllExportsRaw,
  clearAllPhotos,
  clearAllExports,
  putPhotoRaw,
  putExportRaw,
} from "./photoLibrary.js";

const WORKSPACE_VERSION = 1;

// Filename hint based on MIME — fallback to ".bin" for things we don't
// recognize so the zip entry name doesn't lie about its contents.
function extForMime(mime) {
  if (!mime) return "bin";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "application/zip") return "zip";
  if (mime === "video/webm") return "webm";
  if (mime === "video/mp4") return "mp4";
  const m = String(mime).match(/^[a-z]+\/([a-z0-9+\-.]+)/i);
  return m ? m[1].replace(/[^a-z0-9]/gi, "") : "bin";
}

// Build a downloadable .cgework Blob containing the entire workspace.
// nowMs comes from the caller (top nav passes Date.now()) so this stays
// pure for tests / sandboxes.
export async function exportWorkspace({ nowMs = Date.now() } = {}) {
  const zip = new JSZip();

  const events    = useEventsStore.getState().events     || [];
  const regulars  = useRegularsStore.getState().regulars || [];
  const stats     = useRegularsStore.getState().stats    || null;
  const lastImp   = useRegularsStore.getState().lastImport || null;

  const photoRecs  = await getAllPhotosRaw();
  const exportRecs = await getAllExportsRaw();

  // Photos
  const photos = [];
  for (const p of photoRecs) {
    const ext      = extForMime(p.mime);
    const blobName = `photos/${p.id}.${ext}`;
    const thumbName = `photos/${p.id}.thumb.jpg`;
    if (p.blob)  zip.file(blobName, p.blob);
    if (p.thumb) zip.file(thumbName, p.thumb);
    photos.push({
      id: p.id, name: p.name, mime: p.mime,
      sourceTool: p.sourceTool, sourceMode: p.sourceMode,
      width: p.width, height: p.height, bytes: p.bytes,
      createdAt: p.createdAt,
      blobFile: p.blob ? blobName : null,
      thumbFile: p.thumb ? thumbName : null,
    });
  }

  // Exports
  const exports_ = [];
  for (const e of exportRecs) {
    const ext = extForMime(e.mime);
    const blobName = `exports/${e.id}.${ext}`;
    const thumbName = `exports/${e.id}.thumb.jpg`;
    if (e.blob)  zip.file(blobName, e.blob);
    if (e.thumb) zip.file(thumbName, e.thumb);
    exports_.push({
      id: e.id, name: e.name, mime: e.mime,
      sourceTool: e.sourceTool, sourceMode: e.sourceMode,
      width: e.width, height: e.height, bytes: e.bytes,
      kind: e.kind, snapshot: e.snapshot || null,
      createdAt: e.createdAt,
      blobFile: e.blob ? blobName : null,
      thumbFile: e.thumb ? thumbName : null,
    });
  }

  const manifest = {
    version: WORKSPACE_VERSION,
    exportedAt: nowMs,
    app: "cge-tools",
    events,
    regulars,
    regularsStats: stats,
    lastRegularsImport: lastImp,
    photos,
    exports: exports_,
  };
  zip.file("workspace.json", JSON.stringify(manifest));

  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// Parse a .cgework / zip and return a preview of what's inside without
// touching local state. Lets the UI show "23 events, 14 regulars, 42
// photos, 8 exports — replace your current workspace?" before clobbering.
export async function previewWorkspace(blobOrFile) {
  const zip = await JSZip.loadAsync(blobOrFile);
  const manifestFile = zip.file("workspace.json");
  if (!manifestFile) throw new Error("Not a CGE workspace file (missing workspace.json)");
  const manifest = JSON.parse(await manifestFile.async("string"));
  if (!manifest.version || manifest.version > WORKSPACE_VERSION) {
    throw new Error(`This workspace was made by a newer version (${manifest.version}) than this app supports (${WORKSPACE_VERSION}).`);
  }
  return {
    manifest, zip,
    summary: {
      events:    (manifest.events    || []).length,
      regulars:  (manifest.regulars  || []).length,
      photos:    (manifest.photos    || []).length,
      exports:   (manifest.exports   || []).length,
      exportedAt: manifest.exportedAt,
    },
  };
}

// Replace everything in local state with the workspace's contents. Caller
// should have shown the previewWorkspace summary and gotten explicit user
// confirmation before invoking this.
export async function importWorkspace({ manifest, zip }) {
  // 1. Events + regulars are quick — straight store overwrites.
  useEventsStore.setState({ events: (manifest.events || []).map(e => ({ ...e })) });
  useRegularsStore.setState({
    regulars: (manifest.regulars || []).map(r => ({ ...r })),
    stats: manifest.regularsStats || null,
    lastImport: manifest.lastRegularsImport || null,
  });

  // 2. Wipe and refill IndexedDB stores. We clear FIRST so partial failures
  // can't leave duplicate-id collisions behind.
  await clearAllPhotos();
  for (const p of (manifest.photos || [])) {
    const blob  = p.blobFile  ? await zip.file(p.blobFile).async("blob")  : null;
    const thumb = p.thumbFile ? await zip.file(p.thumbFile).async("blob") : null;
    if (!blob) continue; // skip orphan metadata
    await putPhotoRaw({
      id: p.id, blob, thumb,
      mime: p.mime, name: p.name,
      sourceTool: p.sourceTool, sourceMode: p.sourceMode,
      width: p.width, height: p.height, bytes: p.bytes,
      createdAt: p.createdAt,
    });
  }

  await clearAllExports();
  for (const e of (manifest.exports || [])) {
    const blob  = e.blobFile  ? await zip.file(e.blobFile).async("blob")  : null;
    const thumb = e.thumbFile ? await zip.file(e.thumbFile).async("blob") : null;
    if (!blob) continue;
    await putExportRaw({
      id: e.id, blob, thumb,
      mime: e.mime, name: e.name,
      sourceTool: e.sourceTool, sourceMode: e.sourceMode,
      width: e.width, height: e.height, bytes: e.bytes,
      kind: e.kind, snapshot: e.snapshot || null,
      createdAt: e.createdAt,
    });
  }
}

// Filename used by the top-nav Export button. nowMs from the caller.
export function workspaceFilename(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `CGE_workspace_${stamp}.cgework.zip`;
}
