import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { listPhotos, deletePhotoAndNotify, onLibraryChange, usageBytes, loadPhotoBlob, listExports, loadExportBlob, deleteExport, onExportsChange, exportsUsageBytes, loadExportRecord } from "../shared/photoLibrary.js";
import { useRestoreStore } from "../store";

const TOOL_ROUTE = { calendar: "/calendar", media: "/media", flyer: "/flyer", reel: "/reel" };

// face-api.js (vladmandic fork — better maintained than the original).
// Loaded from CDN on mount so the bundle stays small and the library only
// downloads when the user actually opens this page.
const FACE_API_CDN = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js";
const MODEL_URL    = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

// Score weights — tuned for "would this work as a recap-reel slide?"
// Smile is the biggest signal, then face count (social/energy), then face
// area (closer = more emotionally legible).
const WEIGHT_SMILE  = 0.45;
const WEIGHT_FACES  = 0.35;
const WEIGHT_AREA   = 0.20;
const DEFAULT_TOP_N = 8;

const L  = { display: "block", fontSize: "0.6rem", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(245,240,232,0.55)", marginBottom: "6px" };
const B  = { padding: "8px 14px", background: "rgba(245,240,232,0.04)", border: "1px solid rgba(245,240,232,0.1)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.7rem", cursor: "pointer", letterSpacing: "1px", textTransform: "uppercase" };
const Bgold = { ...B, background: "#E5BC4F", color: "#000", border: "none", fontWeight: 700 };

function scorePhoto(faces, imgW, imgH) {
  if (faces.length === 0) return 0;
  const faceCount   = faces.length;
  const avgSmile    = faces.reduce((s, f) => s + (f.expressions?.happy || 0), 0) / faceCount;
  const totalArea   = faces.reduce((s, f) => s + f.detection.box.width * f.detection.box.height, 0);
  const areaFrac    = totalArea / (imgW * imgH);
  // Normalize each component to ~[0,1]
  const facesScore  = Math.min(faceCount / 5, 1);             // 5+ faces = max
  const smileScore  = avgSmile;
  const areaScore   = Math.min(areaFrac * 4, 1);              // 25% of frame = max
  return (smileScore * WEIGHT_SMILE) + (facesScore * WEIGHT_FACES) + (areaScore * WEIGHT_AREA);
}

export default function RecapPicker() {
  // The Recap tab now defaults to the photo library — the same gallery the
  // tools save into automatically. Switch to "picker" for the face-aware
  // recap-reel ranker (the original use of this tab).
  const [view, setView] = useState(() => {
    try { return localStorage.getItem("recap_view") || "library"; } catch { return "library"; }
  });
  useEffect(() => { try { localStorage.setItem("recap_view", view); } catch {} }, [view]);

  if (view === "library") return <LibraryPage onSwitch={() => setView("picker")} />;
  return <FacePicker onSwitch={() => setView("library")} />;
}

function FacePicker({ onSwitch }) {
  const [photos, setPhotos]         = useState([]); // {id, url, file, faces, score, w, h, selected}
  const [modelStatus, setModelStatus] = useState("loading"); // loading | ready | error
  const [analyzing, setAnalyzing]   = useState(false);
  const [progress, setProgress]     = useState({ done: 0, total: 0 });
  const [topN, setTopN]             = useState(DEFAULT_TOP_N);
  const fileRef = useRef(null);

  // Load face-api.js + tiny detector + expression net on mount
  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        await window.faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
        if (!cancelled) setModelStatus("ready");
      } catch (err) {
        console.error("face-api models failed to load:", err);
        if (!cancelled) setModelStatus("error");
      }
    };

    if (window.faceapi) {
      loadModels();
    } else {
      const existing = document.querySelector(`script[src="${FACE_API_CDN}"]`);
      if (existing) {
        existing.addEventListener("load", loadModels, { once: true });
      } else {
        const script = document.createElement("script");
        script.src = FACE_API_CDN;
        script.async = true;
        script.onload = loadModels;
        script.onerror = () => { if (!cancelled) setModelStatus("error"); };
        document.body.appendChild(script);
      }
    }

    return () => { cancelled = true; };
  }, []);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || modelStatus !== "ready") return;
    setAnalyzing(true);
    setProgress({ done: 0, total: files.length });

    const opts = new window.faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });
    const startId = Date.now();
    const fresh = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = rej;
          im.src = url;
        });
        const detections = await window.faceapi
          .detectAllFaces(img, opts)
          .withFaceExpressions();
        const score = scorePhoto(detections, img.width, img.height);
        fresh.push({
          id: startId + i,
          url,
          file,
          faces: detections,
          score,
          w: img.width,
          h: img.height,
          selected: false,
        });
      } catch (err) {
        console.warn("scoring failed for", file.name, err);
        fresh.push({ id: startId + i, url, file, faces: [], score: 0, w: 0, h: 0, selected: false });
      }
      setProgress({ done: i + 1, total: files.length });
    }
    // Append (so user can drop multiple batches without losing prior work)
    setPhotos(prev => [...prev, ...fresh].sort((a, b) => b.score - a.score));
    setAnalyzing(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const toggleSelect = (id) => setPhotos(p => p.map(x => x.id === id ? { ...x, selected: !x.selected } : x));

  const autoSelectTop = () => {
    const sorted = [...photos].sort((a, b) => b.score - a.score);
    const topIds = new Set(sorted.slice(0, topN).map(p => p.id));
    setPhotos(p => p.map(x => ({ ...x, selected: topIds.has(x.id) })));
  };

  const clearAll = () => {
    photos.forEach(p => URL.revokeObjectURL(p.url));
    setPhotos([]);
  };

  const clearSelection = () => setPhotos(p => p.map(x => ({ ...x, selected: false })));

  const downloadSelected = async () => {
    const sel = photos.filter(p => p.selected);
    if (sel.length === 0) return;
    const zip = new JSZip();
    for (let i = 0; i < sel.length; i++) {
      const p = sel[i];
      const idx = String(i + 1).padStart(2, "0");
      // Preserve original file (no re-encoding) — keeps full quality
      zip.file(`recap_${idx}_${p.file.name}`, p.file);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CGE_recap_picks_${Date.now()}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const selectedCount = photos.filter(p => p.selected).length;
  const maxScore = photos.length > 0 ? Math.max(...photos.map(p => p.score)) : 0;

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.25rem" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "2px" }}>
            Recap Picker
          </h1>
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Face-aware photo ranker · for recap reels & carousels
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onSwitch} style={B} title="Browse photos saved by any tool">📚 Library</button>
        </div>

        {/* Status bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: "1rem",
          padding: "10px 14px", marginBottom: "1rem",
          background: "rgba(229,188,79,0.06)",
          border: "1px solid rgba(229,188,79,0.18)",
          borderRadius: "6px",
          fontSize: "0.7rem",
        }}>
          <div style={{ flex: 1 }}>
            {modelStatus === "loading" && <span style={{ color: "#E5BC4F" }}>● Loading face detection model from CDN…</span>}
            {modelStatus === "ready"   && <span style={{ color: "#34D399" }}>● Model ready. Upload event photos to begin.</span>}
            {modelStatus === "error"   && <span style={{ color: "#FB7185" }}>● Model failed to load. Check connection / blocker.</span>}
            {analyzing && <span style={{ color: "#E5BC4F", marginLeft: "1rem" }}>Analyzing {progress.done}/{progress.total}…</span>}
            {!analyzing && photos.length > 0 && (
              <span style={{ marginLeft: "1rem", color: "rgba(245,240,232,0.6)" }}>
                {photos.length} photo{photos.length === 1 ? "" : "s"} analyzed · {selectedCount} selected
              </span>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={modelStatus !== "ready" || analyzing}
            style={modelStatus === "ready" && !analyzing ? Bgold : { ...B, opacity: 0.4, cursor: "not-allowed" }}
          >
            {photos.length === 0 ? "Upload photos" : "Add more photos"}
          </button>
        </div>

        {photos.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
            <label style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Top</label>
            <input
              type="number" min="1" max={photos.length} value={topN}
              onChange={e => setTopN(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ width: 60, padding: "6px 8px", background: "#111", border: "1px solid rgba(245,240,232,0.1)", borderRadius: "4px", color: "#F5F0E8", fontFamily: "inherit", fontSize: "0.75rem", textAlign: "center", fontWeight: 700 }}
            />
            <button onClick={autoSelectTop} style={B}>Auto-select top {topN}</button>
            <button onClick={clearSelection} style={B}>Clear selection</button>
            <div style={{ flex: 1 }} />
            <button onClick={clearAll} style={{ ...B, color: "rgba(251,113,133,0.7)" }}>Clear all photos</button>
            <button
              onClick={downloadSelected}
              disabled={selectedCount === 0}
              style={selectedCount > 0 ? Bgold : { ...B, opacity: 0.4, cursor: "not-allowed" }}
            >
              Download {selectedCount} as ZIP
            </button>
          </div>
        )}

        {/* Photo grid */}
        {photos.length > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "0.75rem",
          }}>
            {photos.map(p => {
              const isTop = maxScore > 0 && p.score === maxScore;
              const scoreLabel = p.score === 0 ? "—" : p.score.toFixed(2);
              return (
                <div
                  key={p.id}
                  onClick={() => toggleSelect(p.id)}
                  style={{
                    position: "relative",
                    aspectRatio: "1",
                    background: "#111",
                    borderRadius: "6px",
                    overflow: "hidden",
                    cursor: "pointer",
                    border: p.selected ? "3px solid #E5BC4F" : "3px solid transparent",
                    transition: "border-color 120ms ease",
                  }}
                >
                  <img src={p.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {/* Score badge */}
                  <div style={{
                    position: "absolute", top: 8, left: 8,
                    padding: "3px 8px",
                    background: isTop ? "#E5BC4F" : "rgba(0,0,0,0.7)",
                    color: isTop ? "#000" : "#F5F0E8",
                    fontFamily: "'Syne', sans-serif",
                    fontSize: "0.65rem",
                    fontWeight: 800,
                    letterSpacing: "1px",
                    borderRadius: "4px",
                  }}>
                    {isTop ? "TOP" : scoreLabel}
                  </div>
                  {/* Face count chip */}
                  {p.faces.length > 0 && (
                    <div style={{
                      position: "absolute", top: 8, right: 8,
                      padding: "3px 8px",
                      background: "rgba(0,0,0,0.7)",
                      color: "#F5F0E8",
                      fontSize: "0.6rem",
                      letterSpacing: "1px",
                      borderRadius: "4px",
                    }}>
                      {p.faces.length} face{p.faces.length === 1 ? "" : "s"}
                    </div>
                  )}
                  {/* Selected indicator */}
                  {p.selected && (
                    <div style={{
                      position: "absolute", bottom: 8, right: 8,
                      width: 28, height: 28,
                      background: "#E5BC4F",
                      color: "#000",
                      borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "0.9rem",
                    }}>
                      ✓
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {photos.length === 0 && modelStatus === "ready" && (
          <div style={{
            padding: "3rem 2rem", textAlign: "center",
            border: "1px dashed rgba(245,240,232,0.15)",
            borderRadius: "8px",
            color: "rgba(245,240,232,0.45)",
            fontSize: "0.8rem",
          }}>
            Drop a folder of event photos via the Upload button. Each photo gets a score based on face count, smile probability, and how prominent the faces are in the frame. Highest-scoring photos float to the top.
          </div>
        )}

        <p style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.3)", marginTop: "2rem", lineHeight: 1.5 }}>
          Scoring weights · {Math.round(WEIGHT_SMILE * 100)}% smile, {Math.round(WEIGHT_FACES * 100)}% face count, {Math.round(WEIGHT_AREA * 100)}% face area. Detection: TinyFaceDetector + FaceExpressionNet via face-api.js (vladmandic fork). Photos never leave the browser.
        </p>
      </div>
    </div>
  );
}

// ===== Library page =====
// Lists every photo saved by any tool (auto-saved on upload). The user can
// preview, copy, download, or delete entries here, and pop into the face
// picker (the original Recap function) via the toggle.
const TOOL_FILTERS = [
  { key: "",         label: "All" },
  { key: "media",    label: "Media" },
  { key: "calendar", label: "Calendar" },
  { key: "flyer",    label: "Flyer" },
];

function formatBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function formatWhen(ts) {
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 1) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function LibraryPage({ onSwitch }) {
  // Two sub-views: uploads ("photos") and rendered outputs ("exports").
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("library_tab") || "photos"; } catch { return "photos"; }
  });
  useEffect(() => { try { localStorage.setItem("library_tab", tab); } catch {} }, [tab]);

  if (tab === "exports") return <ExportsView onSwitch={onSwitch} onTab={setTab} />;
  return <PhotosView onSwitch={onSwitch} onTab={setTab} />;
}

function LibraryTabs({ tab, onTab }) {
  return (
    <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
      {[["photos", "📷 Photos"], ["exports", "🗂 Exports"]].map(([k, lbl]) => (
        <button
          key={k}
          onClick={() => onTab(k)}
          style={tab === k
            ? { ...B, background: "rgba(229,188,79,0.18)", borderColor: "#E5BC4F", color: "#E5BC4F", fontWeight: 700 }
            : B}
        >{lbl}</button>
      ))}
    </div>
  );
}

function PhotosView({ onSwitch, onTab }) {
  const [photos, setPhotos] = useState([]);
  const [filter, setFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [previewId, setPreviewId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    let live = true;
    let urls = [];
    const reload = async () => {
      try {
        const list = await listPhotos(filter ? { sourceTool: filter } : {});
        if (!live) { list.forEach(p => URL.revokeObjectURL(p.thumbUrl)); return; }
        const prev = urls;
        urls = list.map(p => p.thumbUrl);
        setPhotos(list);
        prev.forEach(u => URL.revokeObjectURL(u));
        setTotal(await usageBytes());
      } catch (e) {
        console.error("Library load failed:", e);
      }
    };
    reload();
    const off = onLibraryChange(reload);
    return () => { live = false; off(); urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [filter]);

  // Preview pane — fetches the full blob on click and renders it large.
  useEffect(() => {
    if (!previewId) { setPreviewUrl(null); return; }
    let url = null;
    let cancelled = false;
    loadPhotoBlob(previewId).then(blob => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [previewId]);

  const remove = async (id, e) => {
    if (e) e.stopPropagation();
    if (!confirm("Delete this photo from the library?")) return;
    await deletePhotoAndNotify(id);
    if (previewId === id) setPreviewId(null);
  };

  const download = async (p) => {
    const blob = await loadPhotoBlob(p.id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = p.name || `photo-${p.id}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "2px" }}>
            Library
          </h1>
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Every photo you upload + every PNG/ZIP you export, kept here automatically
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onSwitch} style={B} title="Open the face-aware recap photo ranker">Face Picker →</button>
        </div>

        <LibraryTabs tab="photos" onTab={onTab} />

        {/* Filter chips + storage usage */}
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
          <span style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Source</span>
          {TOOL_FILTERS.map(t => (
            <button
              key={t.key || "all"}
              onClick={() => setFilter(t.key)}
              style={filter === t.key
                ? { ...B, background: "rgba(229,188,79,0.15)", borderColor: "#E5BC4F", color: "#E5BC4F" }
                : B}
            >{t.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {photos.length} photo{photos.length === 1 ? "" : "s"} · {formatBytes(total)} used
          </span>
        </div>

        {photos.length === 0 ? (
          <div style={{ padding: "3rem", borderRadius: "8px", border: "1px dashed rgba(245,240,232,0.12)", color: "rgba(245,240,232,0.5)", fontSize: "0.75rem", textAlign: "center", lineHeight: 1.6 }}>
            No photos in the library yet.<br/>
            Upload a photo in the Media, Calendar, or Flyer tool — it'll appear here automatically.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: previewId ? "1fr 380px" : "1fr", gap: "1rem", alignItems: "start" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "10px",
            }}>
              {photos.map(p => (
                <div
                  key={p.id}
                  onClick={() => setPreviewId(p.id)}
                  title={`${p.name} · ${p.width}×${p.height} · ${formatBytes(p.bytes)}`}
                  style={{
                    position: "relative",
                    background: "#000",
                    border: `1px solid ${previewId === p.id ? "#E5BC4F" : "rgba(245,240,232,0.1)"}`,
                    borderRadius: "5px",
                    overflow: "hidden",
                    cursor: "pointer",
                    aspectRatio: "1 / 1",
                  }}
                >
                  <img src={p.thumbUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <button
                    onClick={(e) => remove(p.id, e)}
                    title="Delete from library"
                    style={{
                      position: "absolute", top: 4, right: 4,
                      width: 22, height: 22, borderRadius: 4,
                      background: "rgba(0,0,0,0.75)", color: "#FB7185",
                      border: "1px solid rgba(251,113,133,0.4)",
                      fontSize: "0.7rem", cursor: "pointer", padding: 0,
                      fontFamily: "inherit", lineHeight: 1,
                    }}
                  >×</button>
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    padding: "4px 6px",
                    background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
                    fontSize: "0.5rem", color: "#F5F0E8",
                    letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700,
                    display: "flex", justifyContent: "space-between",
                  }}>
                    <span>{p.sourceTool || "—"}{p.sourceMode ? ` · ${p.sourceMode}` : ""}</span>
                    <span style={{ color: "rgba(245,240,232,0.5)" }}>{formatWhen(p.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Preview pane */}
            {previewId && (() => {
              const p = photos.find(x => x.id === previewId);
              if (!p) return null;
              return (
                <div style={{
                  position: "sticky", top: "1rem",
                  background: "rgba(245,240,232,0.03)",
                  border: "1px solid rgba(245,240,232,0.08)",
                  borderRadius: "8px",
                  padding: "14px",
                  display: "flex", flexDirection: "column", gap: "10px",
                }}>
                  <div style={{ background: "#000", borderRadius: "5px", overflow: "hidden", aspectRatio: `${p.width} / ${p.height}` }}>
                    {previewUrl && <img src={previewUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#F5F0E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase" }}>
                    {p.sourceTool || "unknown"}{p.sourceMode ? ` · ${p.sourceMode}` : ""} · {p.width}×{p.height} · {formatBytes(p.bytes)} · {formatWhen(p.createdAt)}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button onClick={() => download(p)} style={Bgold}>Download</button>
                    <button onClick={() => setPreviewId(null)} style={B}>Close</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => remove(p.id)} style={{ ...B, color: "#FB7185", borderColor: "rgba(251,113,133,0.3)" }}>Delete</button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Exports view =====
function ExportsView({ onSwitch, onTab }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [previewId, setPreviewId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const navigate = useNavigate();
  const setPending = useRestoreStore(s => s.setPending);

  // Click "Edit in [tool]" → fetch the snapshot from IndexedDB, drop it
  // into the restore store, navigate. The tool consumes the snapshot on
  // mount via useRestoreStore.consumeRestore("calendar"/"media"/"flyer").
  const editInTool = async (p) => {
    const route = TOOL_ROUTE[p.sourceTool];
    if (!route) return;
    const rec = await loadExportRecord(p.id);
    if (!rec || !rec.snapshot) {
      alert("This export wasn't saved with edit data. Re-export from the tool to capture it.");
      return;
    }
    setPending({ tool: p.sourceTool, snapshot: rec.snapshot });
    navigate(route);
  };

  useEffect(() => {
    let live = true;
    let urls = [];
    const reload = async () => {
      try {
        const list = await listExports(filter ? { sourceTool: filter } : {});
        if (!live) { list.forEach(p => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl)); return; }
        const prev = urls;
        urls = list.map(p => p.thumbUrl).filter(Boolean);
        setItems(list);
        prev.forEach(u => URL.revokeObjectURL(u));
        setTotal(await exportsUsageBytes());
      } catch (e) {
        console.error("Exports load failed:", e);
      }
    };
    reload();
    const off = onExportsChange(reload);
    return () => { live = false; off(); urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [filter]);

  useEffect(() => {
    if (!previewId) { setPreviewUrl(null); return; }
    const cur = items.find(x => x.id === previewId);
    if (!cur || cur.kind !== "image") { setPreviewUrl(null); return; }
    let url = null, cancelled = false;
    loadExportBlob(previewId).then(blob => {
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [previewId, items]);

  const download = async (p) => {
    const blob = await loadExportBlob(p.id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = p.name || `export-${p.id}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const remove = async (id, e) => {
    if (e) e.stopPropagation();
    if (!confirm("Delete this export from the library?")) return;
    await deleteExport(id);
    if (previewId === id) setPreviewId(null);
  };

  return (
    <div style={{ minHeight: "calc(100vh - 60px)", background: "#080808", color: "#F5F0E8", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "1.2rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "2px" }}>
            Library
          </h1>
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
            Every PNG/ZIP/WebM you've exported, ready to re-download
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onSwitch} style={B} title="Open the face-aware recap photo ranker">Face Picker →</button>
        </div>

        <LibraryTabs tab="exports" onTab={onTab} />

        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
          <span style={{ ...L, marginBottom: 0, marginRight: "4px" }}>Source</span>
          {[
            { key: "",         label: "All" },
            { key: "calendar", label: "Calendar" },
            { key: "media",    label: "Media" },
            { key: "flyer",    label: "Flyer" },
            { key: "reel",     label: "Reel" },
          ].map(t => (
            <button
              key={t.key || "all"}
              onClick={() => setFilter(t.key)}
              style={filter === t.key
                ? { ...B, background: "rgba(229,188,79,0.15)", borderColor: "#E5BC4F", color: "#E5BC4F" }
                : B}
            >{t.label}</button>
          ))}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {items.length} export{items.length === 1 ? "" : "s"} · {formatBytes(total)} used
          </span>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: "3rem", borderRadius: "8px", border: "1px dashed rgba(245,240,232,0.12)", color: "rgba(245,240,232,0.5)", fontSize: "0.75rem", textAlign: "center", lineHeight: 1.6 }}>
            No exports archived yet.<br/>
            Download a slide/PNG/ZIP from any tool and a copy will land here.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: previewId ? "1fr 380px" : "1fr", gap: "1rem", alignItems: "start" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              gap: "10px",
            }}>
              {items.map(p => (
                <div
                  key={p.id}
                  onClick={() => setPreviewId(p.id)}
                  title={`${p.name} · ${formatBytes(p.bytes)}`}
                  style={{
                    position: "relative",
                    background: "#000",
                    border: `1px solid ${previewId === p.id ? "#E5BC4F" : "rgba(245,240,232,0.1)"}`,
                    borderRadius: "5px",
                    overflow: "hidden",
                    cursor: "pointer",
                    aspectRatio: "1 / 1",
                  }}
                >
                  {p.thumbUrl ? (
                    <img src={p.thumbUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{
                      width: "100%", height: "100%",
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      background: "linear-gradient(135deg, #1a1a1a, #0d0d0d)",
                      color: "rgba(245,240,232,0.5)", fontFamily: "'Syne',sans-serif",
                      padding: "10px", textAlign: "center",
                    }}>
                      <div style={{ fontSize: "2rem" }}>{p.mime?.includes("zip") ? "🗜" : p.mime?.includes("webm") ? "🎬" : "📄"}</div>
                      <div style={{ fontSize: "0.5rem", letterSpacing: "1px", textTransform: "uppercase", marginTop: "6px" }}>
                        {p.kind === "archive" ? "Archive" : "File"}
                      </div>
                    </div>
                  )}
                  <button
                    onClick={(e) => remove(p.id, e)}
                    title="Delete from library"
                    style={{
                      position: "absolute", top: 4, right: 4,
                      width: 22, height: 22, borderRadius: 4,
                      background: "rgba(0,0,0,0.75)", color: "#FB7185",
                      border: "1px solid rgba(251,113,133,0.4)",
                      fontSize: "0.7rem", cursor: "pointer", padding: 0,
                      fontFamily: "inherit", lineHeight: 1,
                    }}
                  >×</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); download(p); }}
                    title="Re-download"
                    style={{
                      position: "absolute", top: 4, left: 4,
                      width: 22, height: 22, borderRadius: 4,
                      background: "rgba(0,0,0,0.75)", color: "#34D399",
                      border: "1px solid rgba(52,211,153,0.4)",
                      fontSize: "0.6rem", cursor: "pointer", padding: 0,
                      fontFamily: "inherit", lineHeight: 1,
                    }}
                  >↓</button>
                  {p.hasSnapshot && TOOL_ROUTE[p.sourceTool] && (
                    <button
                      onClick={(e) => { e.stopPropagation(); editInTool(p); }}
                      title={`Edit in ${p.sourceTool}`}
                      style={{
                        position: "absolute", top: 4, left: 30,
                        width: 22, height: 22, borderRadius: 4,
                        background: "rgba(0,0,0,0.75)", color: "#E5BC4F",
                        border: "1px solid rgba(229,188,79,0.4)",
                        fontSize: "0.6rem", cursor: "pointer", padding: 0,
                        fontFamily: "inherit", lineHeight: 1,
                      }}
                    >✎</button>
                  )}
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    padding: "4px 6px",
                    background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
                    fontSize: "0.5rem", color: "#F5F0E8",
                    letterSpacing: "0.5px", textTransform: "uppercase", fontWeight: 700,
                    display: "flex", justifyContent: "space-between",
                  }}>
                    <span>{p.sourceTool}{p.sourceMode ? ` · ${p.sourceMode}` : ""}</span>
                    <span style={{ color: "rgba(245,240,232,0.5)" }}>{formatWhen(p.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>

            {previewId && (() => {
              const p = items.find(x => x.id === previewId);
              if (!p) return null;
              return (
                <div style={{
                  position: "sticky", top: "1rem",
                  background: "rgba(245,240,232,0.03)",
                  border: "1px solid rgba(245,240,232,0.08)",
                  borderRadius: "8px",
                  padding: "14px",
                  display: "flex", flexDirection: "column", gap: "10px",
                }}>
                  {p.kind === "image" ? (
                    <div style={{ background: "#000", borderRadius: "5px", overflow: "hidden", aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : "1 / 1" }}>
                      {previewUrl && <img src={previewUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />}
                    </div>
                  ) : (
                    <div style={{
                      background: "linear-gradient(135deg, #1a1a1a, #0d0d0d)",
                      borderRadius: "5px", padding: "2rem",
                      textAlign: "center", color: "rgba(245,240,232,0.6)",
                      fontFamily: "'Syne',sans-serif",
                    }}>
                      <div style={{ fontSize: "3rem", marginBottom: "8px" }}>{p.mime?.includes("zip") ? "🗜" : p.mime?.includes("webm") ? "🎬" : "📄"}</div>
                      <div style={{ fontSize: "0.65rem", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                        {p.kind === "archive" ? "Archive" : "Binary file"}
                      </div>
                      <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.4)", marginTop: "6px" }}>
                        Download to view
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: "0.7rem", color: "#F5F0E8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase" }}>
                    {p.sourceTool}{p.sourceMode ? ` · ${p.sourceMode}` : ""}
                    {p.width && p.height ? ` · ${p.width}×${p.height}` : ""}
                    {" · "}{formatBytes(p.bytes)} · {formatWhen(p.createdAt)}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button onClick={() => download(p)} style={Bgold}>Download</button>
                    {p.hasSnapshot && TOOL_ROUTE[p.sourceTool] && (
                      <button onClick={() => editInTool(p)} style={{ ...B, background: "rgba(229,188,79,0.12)", borderColor: "rgba(229,188,79,0.4)", color: "#E5BC4F", fontWeight: 700 }}>
                        ✎ Edit in {p.sourceTool}
                      </button>
                    )}
                    <button onClick={() => setPreviewId(null)} style={B}>Close</button>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => remove(p.id)} style={{ ...B, color: "#FB7185", borderColor: "rgba(251,113,133,0.3)" }}>Delete</button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
