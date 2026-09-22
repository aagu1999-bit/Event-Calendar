// Turn whatever iOS / the share sheet sent into a Gemini-safe JPEG data URL.
//
// iPhone Photos default to HEIC. The browser can't draw that (broken
// thumbnail), and Gemini 1.5/2.x often 400s with "Unable to process input
// image" even when the docs list image/heic. Instagram CDN stills from
// Apify are already JPEG, which is why URL-shares extract and photo-shares
// don't. We also downscale to 1600px (same cap as the in-app screenshot
// modal) so a 48MP camera roll dump doesn't blow the Gemini payload.

import convertHeic from "heic-convert";
import sharp from "sharp";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 85;

const HEIC_BRANDS = new Set([
  "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs",
  "mif1", "msf1", "heif",
]);

export function parseDataUrl(raw) {
  const s = String(raw || "").trim();
  if (!s.toLowerCase().startsWith("data:")) return null;
  const comma = s.indexOf(",");
  if (comma < 5) return null;
  const header = s.slice(5, comma);
  const payload = s.slice(comma + 1).replace(/\s/g, "");
  if (!payload) return null;
  const isB64 = /(?:^|;)base64$/i.test(header.replace(/\s/g, "")) || /;base64;/i.test(header);
  const mime = (header.split(";")[0] || "application/octet-stream").trim().toLowerCase();
  let bytes;
  try {
    bytes = Buffer.from(payload, isB64 ? "base64" : "utf8");
  } catch { return null; }
  if (!bytes.length) return null;
  return { mime, bytes };
}

// True only when the data URL actually contains image bytes. The live pool
// had 74 "photos" stored as the 23-char stub `data:image/jpeg;base64`
// (header, no comma, no payload) — Extract 422'd on every one of them.
export function usableImageDataUrl(raw) {
  const parsed = parseDataUrl(raw);
  return !!(parsed && parsed.bytes && parsed.bytes.length >= 32);
}

export async function toPreviewDataUrl(dataUrl, edge = 240) {
  const normalized = await normalizeImageDataUrl(dataUrl);
  const parsed = parseDataUrl(normalized);
  if (!parsed) return normalized;
  const small = await sharp(parsed.bytes, { failOn: "none" })
    .rotate()
    .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${small.toString("base64")}`;
}

export function sniffImageKind(buf, mimeHint = "") {
  if (!buf || buf.length < 12) return "unknown";
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  const ftyp = buf.slice(4, 8).toString("ascii");
  const brand = buf.slice(8, 12).toString("ascii").replace(/\0/g, "").toLowerCase();
  if (ftyp === "ftyp" && HEIC_BRANDS.has(brand)) return "heic";
  const hint = String(mimeHint || "").toLowerCase();
  if (hint.includes("heic") || hint.includes("heif")) return "heic";
  if (hint.includes("jpeg") || hint === "image/jpg") return "jpeg";
  if (hint.includes("png")) return "png";
  if (hint.includes("webp")) return "webp";
  return "unknown";
}

async function heicToJpeg(buf) {
  try {
    const out = await convertHeic({ buffer: buf, format: "JPEG", quality: JPEG_QUALITY / 100 });
    return Buffer.from(out);
  } catch (firstErr) {
    // Live Photos / bursts are HEIC sequences — convert() throws, .all() returns frames.
    if (typeof convertHeic.all !== "function") throw firstErr;
    const frames = await convertHeic.all({ buffer: buf, format: "JPEG", quality: JPEG_QUALITY / 100 });
    const first = Array.isArray(frames) ? frames[0] : null;
    let bytes = null;
    if (first && typeof first.convertToByteArray === "function") {
      bytes = Buffer.from(await first.convertToByteArray());
    } else if (first?.data) {
      bytes = Buffer.from(first.data);
    } else if (first) {
      bytes = Buffer.from(first);
    }
    if (!bytes?.length) throw firstErr;
    return bytes;
  }
}

async function toGeminiJpeg(buf) {
  // rotate() honors EXIF orientation — iPhone photos are almost always
  // stored with a tag instead of baked-in pixels.
  return sharp(buf, { failOn: "none" })
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

export async function normalizeImageDataUrl(dataUrl) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    const err = new Error("That photo didn't arrive as a usable image. Re-share it from Photos as an image (not a file).");
    err.code = "bad_image";
    throw err;
  }
  let { bytes, mime } = parsed;
  const kind = sniffImageKind(bytes, mime);
  try {
    if (kind === "heic") {
      bytes = await heicToJpeg(bytes);
    }
    const jpeg = await toGeminiJpeg(bytes);
    if (!jpeg.length) throw new Error("empty jpeg");
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (e) {
    const err = new Error(
      kind === "heic"
        ? "Couldn't convert that iPhone photo (HEIC) to JPEG. In Photos, share the image itself — or in iOS Settings → Camera → Formats, pick Most Compatible and re-share."
        : "Couldn't read that photo. Re-share it from Photos as a JPEG/PNG, or screenshot it and share the screenshot."
    );
    err.code = "bad_image";
    err.cause = e;
    throw err;
  }
}
