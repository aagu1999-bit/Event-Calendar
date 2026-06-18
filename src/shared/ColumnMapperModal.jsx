import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { matchColumns, TARGET_FIELDS } from "./parseEvents.js";

// Column mapper — pops up after the user uploads a CSV/XLSX. Shows the
// detected columns with sample data, lets the user assign each source
// column to one of the event fields (or Skip), then runs parseRows
// with the chosen mapping. Last-used mapping per header signature is
// persisted in localStorage so a recurring sheet shape only needs to
// be mapped once.

const LS_PREFIX = "cge-import-map-";

// Stable hash of the header row so we can remember the user's mapping
// for "this exact sheet shape" without storing the full headers.
function signHeaders(headers) {
  const norm = headers.map(h => String(h || "").trim().toLowerCase()).join("|");
  // Tiny FNV-1a hash, no crypto needed — collisions are fine, we're not
  // in a security context, just keying a localStorage entry.
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function loadSavedMapping(sig) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + sig);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* corrupt — ignore */ }
  return null;
}

function saveMapping(sig, columnMap) {
  try {
    localStorage.setItem(LS_PREFIX + sig, JSON.stringify(columnMap));
  } catch { /* quota or private mode — silently drop */ }
}

// Build the initial mapping. Priority:
//   1. User's last saved mapping for this header signature
//   2. Auto-detection from matchColumns()
//   3. Empty (every column → Skip)
function buildInitialMapping(headers) {
  const sig = signHeaders(headers);
  const saved = loadSavedMapping(sig);
  if (saved) return { mapping: saved, source: "saved", sig };
  const auto = matchColumns(headers);
  return { mapping: auto, source: "auto", sig };
}

export function ColumnMapperModal({ open, rows, fileName, onCancel, onConfirm }) {
  // Rows = full 2D sheet (row 0 = headers, rows 1+ = data). Empty rows OK.
  const headers = useMemo(() => {
    if (!rows || !rows.length) return [];
    return rows[0].map(c => String(c ?? "").trim());
  }, [rows]);

  const sampleRows = useMemo(() => {
    if (!rows) return [];
    return rows.slice(1, 4).filter(r => r && r.some(c => c != null && String(c).trim() !== ""));
  }, [rows]);

  // mapping shape: { [fieldKey]: columnIndex } — inverse of "column → field"
  // because parseRows wants it that way. The UI shows column → field via
  // a derived lookup.
  const [mapping, setMapping] = useState({});
  const [mapSource, setMapSource] = useState("auto");
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [sig, setSig] = useState("");

  useEffect(() => {
    if (!open || !headers.length) return;
    const { mapping: m, source, sig: s } = buildInitialMapping(headers);
    setMapping(m);
    setMapSource(source);
    setSig(s);
    setHasHeaderRow(true);
  }, [open, headers]);

  if (!open) return null;

  // Reverse lookup — for any column index, what field is it assigned to?
  const colToField = {};
  for (const [field, idx] of Object.entries(mapping)) colToField[idx] = field;

  // Drop a column's assignment ("Skip") OR set it to a new field.
  // Assigning a column to a field that's already mapped to another
  // column unassigns the old column (each field can only point at one
  // column).
  const onPick = (colIdx, fieldKey) => {
    setMapping(prev => {
      const next = { ...prev };
      // Unassign whatever this column was mapped to.
      for (const k of Object.keys(next)) if (next[k] === colIdx) delete next[k];
      // If user picked a real field (not Skip), and another column had
      // it, drop that column's mapping too.
      if (fieldKey) {
        delete next[fieldKey]; // belt-and-suspenders — assignment overrides
        next[fieldKey] = colIdx;
      }
      return next;
    });
  };

  const nameMapped = "name" in mapping;
  const dateMapped = "date" in mapping;
  const dayMapped = "day" in mapping;
  const hasDayOrDate = dateMapped || dayMapped;

  const confirm = () => {
    if (!nameMapped) {
      alert("You need to map at least one column to 'Event Name' before importing.");
      return;
    }
    saveMapping(sig, mapping);
    onConfirm({ columnMap: mapping, hasHeaderRow });
  };

  return createPortal(
    <div
      onClick={onCancel}
      className="cge-modal-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="cge-modal"
        style={{
          background: "#0d0d0d",
          border: "1px solid rgba(245,240,232,0.12)",
          borderRadius: "8px",
          width: "min(880px, 100%)",
          maxHeight: "88vh",
          display: "flex", flexDirection: "column",
          color: "#F5F0E8",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div className="cge-modal-header" style={{
          padding: "14px 18px",
          borderBottom: "1px solid rgba(245,240,232,0.08)",
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", color: "#E5BC4F" }}>
            📊 Map Columns
          </div>
          <div className="cge-modal-subtitle" style={{ fontSize: "0.55rem", color: "rgba(245,240,232,0.5)", letterSpacing: "1px", textTransform: "uppercase" }}>
            {fileName || "Spreadsheet"} · {rows ? rows.length - 1 : 0} data rows · {headers.length} columns
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            fontSize: "0.5rem",
            letterSpacing: "1px",
            textTransform: "uppercase",
            color: mapSource === "saved" ? "#34D399" : "rgba(245,240,232,0.5)",
            background: mapSource === "saved" ? "rgba(52,211,153,0.1)" : "transparent",
            padding: "2px 8px",
            borderRadius: 3,
            border: `1px solid ${mapSource === "saved" ? "rgba(52,211,153,0.4)" : "rgba(245,240,232,0.1)"}`,
          }}>
            {mapSource === "saved" ? "↻ Restored last mapping" : "Auto-detected"}
          </div>
          <button
            onClick={onCancel}
            className="cge-modal-close"
            style={{
              padding: "4px 10px", borderRadius: 4,
              background: "rgba(245,240,232,0.04)", color: "#F5F0E8",
              border: "1px solid rgba(245,240,232,0.1)",
              fontSize: "0.7rem", cursor: "pointer", fontFamily: "inherit",
            }}
          >Cancel</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          <div style={{
            fontSize: "0.65rem",
            color: "rgba(245,240,232,0.7)",
            lineHeight: 1.5,
            marginBottom: "1rem",
            padding: "10px 12px",
            background: "rgba(229,188,79,0.06)",
            border: "1px solid rgba(229,188,79,0.18)",
            borderRadius: 5,
          }}>
            Tell us which column in your sheet maps to each event field.
            Auto-detect runs on header names — adjust anything that looks
            wrong. <strong>Event Name is required.</strong> Map either
            Date or Day (or both). The rest are optional. We'll remember
            this mapping for the next sheet with the same headers.
          </div>

          {!headers.length && (
            <div style={{ padding: "2rem", textAlign: "center", color: "rgba(251,113,133,0.7)" }}>
              No columns detected in the sheet.
            </div>
          )}

          {headers.map((h, colIdx) => {
            const assignedField = colToField[colIdx];
            const samples = sampleRows.map(r => String(r[colIdx] ?? "").trim()).filter(Boolean);
            return (
              <div key={colIdx} style={{
                display: "grid",
                gridTemplateColumns: "minmax(140px, 1fr) minmax(200px, 2fr) 220px",
                gap: "12px",
                alignItems: "center",
                padding: "10px 12px",
                marginBottom: "6px",
                background: assignedField ? "rgba(52,211,153,0.04)" : "rgba(245,240,232,0.03)",
                border: `1px solid ${assignedField ? "rgba(52,211,153,0.18)" : "rgba(245,240,232,0.06)"}`,
                borderRadius: 5,
              }}>
                <div>
                  <div style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.4)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "2px" }}>
                    Column {colIdx + 1}
                  </div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#F5F0E8", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {h || <em style={{ color: "rgba(245,240,232,0.4)" }}>(unnamed)</em>}
                  </div>
                </div>
                <div style={{ fontSize: "0.6rem", color: "rgba(245,240,232,0.55)", lineHeight: 1.4 }}>
                  <div style={{ fontSize: "0.5rem", color: "rgba(245,240,232,0.3)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: "2px" }}>
                    Sample data
                  </div>
                  {samples.length === 0 ? (
                    <em style={{ color: "rgba(245,240,232,0.3)" }}>(empty)</em>
                  ) : (
                    samples.slice(0, 3).map((s, i) => (
                      <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        · {s.length > 60 ? s.slice(0, 60) + "…" : s}
                      </div>
                    ))
                  )}
                </div>
                <select
                  value={assignedField || ""}
                  onChange={e => onPick(colIdx, e.target.value || null)}
                  style={{
                    padding: "8px 10px",
                    background: assignedField ? "rgba(52,211,153,0.1)" : "rgba(245,240,232,0.04)",
                    border: `1px solid ${assignedField ? "rgba(52,211,153,0.4)" : "rgba(245,240,232,0.12)"}`,
                    borderRadius: 4,
                    color: assignedField ? "#34D399" : "rgba(245,240,232,0.7)",
                    fontSize: "0.7rem",
                    fontFamily: "inherit",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  <option value="" style={{ color: "#000" }}>— Skip this column —</option>
                  {TARGET_FIELDS.map(f => (
                    <option key={f.key} value={f.key} style={{ color: "#000" }}>
                      {f.label}{f.required ? " *" : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div style={{
          padding: "12px 18px",
          borderTop: "1px solid rgba(245,240,232,0.08)",
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
        }}>
          <label style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.7)", display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={hasHeaderRow}
              onChange={e => setHasHeaderRow(e.target.checked)}
              style={{ accentColor: "#E5BC4F" }}
            />
            First row is a header (skip on import)
          </label>
          <div style={{ flex: 1 }} />
          <div style={{
            fontSize: "0.55rem",
            color: nameMapped && hasDayOrDate ? "#34D399" : "rgba(251,113,133,0.7)",
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}>
            {!nameMapped ? "⚠ Event Name not mapped" :
             !hasDayOrDate ? "⚠ No Date or Day mapped (defaults to Friday)" :
             "✓ Ready to import"}
          </div>
          <button
            onClick={confirm}
            disabled={!nameMapped}
            style={{
              padding: "8px 16px",
              background: nameMapped ? "#34D399" : "rgba(52,211,153,0.3)",
              color: "#000", border: "none", borderRadius: 4,
              fontSize: "0.7rem", fontWeight: 700, letterSpacing: "1.5px",
              textTransform: "uppercase",
              cursor: nameMapped ? "pointer" : "not-allowed",
              fontFamily: "'Syne', sans-serif",
            }}
          >Import →</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
