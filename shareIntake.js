// Classify an iOS Shortcut / intake POST so Instagram posts stay URL-shares.
//
// Instagram's share sheet often attaches a preview of the *current* slide
// (sometimes the 23-char stub `data:image/jpeg;base64` with no payload)
// PLUS the post URL. Treating that preview as the photo made Extract skip
// Apify and never read the rest of the carousel. A stub preview used to
// 422 the whole share — the post never landed in the pool at all.

import { usableImageDataUrl } from "./normalizeImage.js";

const HTTP_RE = /^https?:\/\//i;
const IG_URL_IN_TEXT = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/[^\s"'<>\\]+/i;
const ANY_URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/i;

export function isHttpUrl(raw) {
  return typeof raw === "string" && HTTP_RE.test(raw.trim());
}

export function isInstagramUrl(raw) {
  try {
    const h = new URL(String(raw || "")).hostname.replace(/^www\./, "").toLowerCase();
    return h === "instagram.com" || h === "instagr.am" || h.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

function tidyUrl(raw) {
  const s = String(raw || "").trim();
  if (!HTTP_RE.test(s)) return null;
  return s.replace(/[),.;]+$/g, "");
}

function firstUrlIn(text, preferIg) {
  if (typeof text !== "string" || !text.trim()) return null;
  const s = text.trim();
  if (HTTP_RE.test(s) && !s.toLowerCase().startsWith("data:")) {
    const firstToken = s.split(/\s+/)[0];
    const tidy = tidyUrl(firstToken);
    if (tidy && (!preferIg || isInstagramUrl(tidy))) return tidy;
  }
  const ig = s.match(IG_URL_IN_TEXT);
  if (ig) return tidyUrl(ig[0]);
  if (preferIg) return null;
  const any = s.match(ANY_URL_IN_TEXT);
  return any ? tidyUrl(any[0]) : null;
}

export function pickShareUrl(body) {
  const b = body && typeof body === "object" ? body : {};
  const fields = [b.sourceUrl, b.url, b.link, b.pageUrl, b.input];
  if (Array.isArray(b.urls)) fields.push(...b.urls);
  for (const f of fields) {
    const u = firstUrlIn(f, false);
    if (u) return u;
  }
  // Shortcut sometimes puts the post URL in the image field, or only in
  // the caption / share text (Instagram's "Copy link" lands here).
  const fromImage = firstUrlIn(b.imageDataUrl, false);
  if (fromImage) return fromImage;
  const fromText = firstUrlIn(b.caption, true) || firstUrlIn(b.text, true)
    || firstUrlIn(b.caption, false) || firstUrlIn(b.text, false);
  return fromText;
}

function firstUsableImage(body) {
  const b = body && typeof body === "object" ? body : {};
  const list = [];
  if (typeof b.imageDataUrl === "string") list.push(b.imageDataUrl);
  if (Array.isArray(b.images)) {
    for (const img of b.images) {
      if (typeof img === "string") list.push(img);
      else if (img && typeof img.imageDataUrl === "string") list.push(img.imageDataUrl);
    }
  }
  return list.find((s) => usableImageDataUrl(s)) || null;
}

export function classifyShare(body) {
  const url = pickShareUrl(body);
  const imageDataUrl = firstUsableImage(body);
  const ig = isInstagramUrl(url);
  const stubImage = !imageDataUrl && typeof body?.imageDataUrl === "string"
    && /^\s*data:/i.test(body.imageDataUrl);
  return {
    url,
    imageDataUrl,
    instagram: ig,
    // Never persist a share-sheet cover for an IG URL — Extract must
    // Apify every slide. A leftover slide-1 blob used to skip that fetch.
    persistPhoto: !!(imageDataUrl && !ig),
    stubImage,
    caption: typeof body?.caption === "string" ? body.caption
      : (typeof body?.text === "string" ? body.text : null),
  };
}
