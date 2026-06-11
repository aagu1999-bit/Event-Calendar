// Read + write PNG text metadata (tEXt chunks).
//
// PNG files are a stream of chunks: 4-byte length, 4-byte type ("IHDR",
// "IDAT", "tEXt", "IEND", etc.), data, then a 4-byte CRC. The tEXt
// chunk has been part of the spec since 1996 and stores a UTF-8 keyword
// + null byte + Latin-1 text. Every PNG-reading tool that doesn't care
// about a key just skips the chunk — so embedding "cgeExport: <id>"
// in our exports is invisible to Photos.app, Instagram, Slack, etc.
// but recoverable when the user imports the file back into CGE Tools.
//
// On import, the importer extracts the cgeExport id, looks it up in the
// cloud exports library (via photoLibrary.loadExportRecord), and routes
// the snapshot through the existing useRestoreStore → consumeRestore
// pipeline. No new editor state path needed.

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

// Standard PNG CRC-32 (RFC 1952 polynomial 0xEDB88320).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isPngSignature(buf) {
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) return false;
  return true;
}

// Build a tEXt chunk: [length (4)] [type "tEXt" (4)] [keyword] [0x00]
// [text] [crc (4)]. Spec says keyword is 1-79 chars Latin-1; we keep
// it ASCII (cgeExport / cgeTool / etc.) so no edge cases.
function buildTextChunk(keyword, text) {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(keyword);
  const textBytes = enc.encode(text);
  if (keyBytes.length < 1 || keyBytes.length > 79) {
    throw new Error("Keyword must be 1-79 chars");
  }
  const dataLen = keyBytes.length + 1 + textBytes.length;
  const chunk = new Uint8Array(12 + dataLen);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLen);
  chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74; // "tEXt"
  chunk.set(keyBytes, 8);
  chunk[8 + keyBytes.length] = 0;
  chunk.set(textBytes, 8 + keyBytes.length + 1);
  // CRC is computed over type+data (not length, not the trailing CRC).
  const crc = crc32(chunk.subarray(4, 8 + dataLen));
  view.setUint32(8 + dataLen, crc);
  return chunk;
}

// Insert one or more tEXt chunks into a PNG blob, between IHDR and IDAT
// (any position before IDAT is valid; that's where text metadata
// conventionally lives). Returns a new Blob.
export async function writePngTextChunks(blob, entries) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (!isPngSignature(buf)) throw new Error("Not a PNG file");

  // Find the offset of the first IDAT chunk (where we'll insert before).
  let offset = 8;
  let insertAt = -1;
  while (offset < buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset);
    const len = view.getUint32(0);
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
    if (type === "IDAT" || type === "IEND") { insertAt = offset; break; }
    offset += 4 + 4 + len + 4;
  }
  if (insertAt < 0) throw new Error("Malformed PNG (no IDAT/IEND)");

  // Build all chunks back-to-back.
  const chunks = entries.map(({ keyword, text }) => buildTextChunk(keyword, text));
  const chunksTotal = chunks.reduce((s, c) => s + c.length, 0);

  // Assemble: [signature + chunks before IDAT] + [new chunks] + [IDAT onward].
  const out = new Uint8Array(buf.length + chunksTotal);
  out.set(buf.subarray(0, insertAt), 0);
  let cursor = insertAt;
  for (const c of chunks) { out.set(c, cursor); cursor += c.length; }
  out.set(buf.subarray(insertAt), cursor);
  return new Blob([out], { type: "image/png" });
}

// Read all tEXt chunks. Returns { [keyword]: text } or null if not a PNG.
export async function readPngTextChunks(blob) {
  let buf;
  try { buf = new Uint8Array(await blob.arrayBuffer()); }
  catch { return null; }
  if (!isPngSignature(buf)) return null;

  const out = {};
  const dec = new TextDecoder("utf-8");
  let offset = 8;
  while (offset < buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset);
    const len = view.getUint32(0);
    const type = String.fromCharCode(buf[offset + 4], buf[offset + 5], buf[offset + 6], buf[offset + 7]);
    if (type === "tEXt") {
      const data = buf.subarray(offset + 8, offset + 8 + len);
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        try {
          const keyword = dec.decode(data.subarray(0, nullIdx));
          const text = dec.decode(data.subarray(nullIdx + 1));
          out[keyword] = text;
        } catch { /* skip malformed */ }
      }
    }
    if (type === "IEND") break;
    offset += 4 + 4 + len + 4;
  }
  return out;
}

// Convenience for the common case — one tEXt chunk with a CGE export ID.
// Also embeds the tool name + mode so we can show a helpful preview even
// when the cloud library record is gone.
export async function tagPngWithCgeExport(blob, { id, tool, mode }) {
  const entries = [
    { keyword: "cgeExport", text: String(id || "") },
    { keyword: "cgeTool", text: String(tool || "") },
    { keyword: "cgeMode", text: String(mode || "") },
  ];
  return writePngTextChunks(blob, entries);
}

// Extract the CGE export tag if present. Returns null if the PNG has no
// cgeExport keyword (third-party file, or pre-tagging export).
export async function readCgeExportTag(blob) {
  const chunks = await readPngTextChunks(blob);
  if (!chunks || !chunks.cgeExport) return null;
  return {
    id: chunks.cgeExport,
    tool: chunks.cgeTool || null,
    mode: chunks.cgeMode || null,
  };
}
