import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";

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
