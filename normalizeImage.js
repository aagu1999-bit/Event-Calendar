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
  const m = s.match(/^data:([^;,]+)?(;charset=[^;,]+)?(;base64)?,(.*)$/is);
  if (!m) return null;
  const mime = (m[1] || "application/octet-stream").trim().toLowerCase();
  const isB64 = !!m[3];
  let bytes;
  try {
    const payload = String(m[4] || "").replace(/\s/g, "");
    bytes = Buffer.from(payload, isB64 ? "base64" : "utf8");
  } catch { return null; }
  if (!bytes.length) return null;
  return { mime, bytes };
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
