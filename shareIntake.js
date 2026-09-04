// Classify an iOS Shortcut / intake POST so Instagram posts stay URL-shares.
//
// Instagram's share sheet often attaches a preview of the *current* slide
// (sometimes the 23-char stub `data:image/jpeg;base64` with no payload)
// PLUS the post URL. Treating that preview as the photo made Extract skip
// Apify and never read the rest of the carousel. A stub preview used to
// 422 the whole share — the post never landed in the pool at all.
//
// The live Shortcut ("Save to CGE tool") still 422s when it sends the stub
// and buries the link: nested Dictionary (`{ string: "https://…" }`), a
// schemeless `instagram.com/p/…`, form/query fields, or a text/plain body.
// We walk the whole payload and normalize those into a post URL.

import { usableImageDataUrl } from "./normalizeImage.js";

const HTTP_RE = /^https?:\/\//i;
// Optional scheme — iOS sometimes hands over instagram.com/p/… with no https.
const IG_PATH = /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:p|reel|reels|tv|share\/(?:p|reel)|stories)\/[A-Za-z0-9_-]+[^\s"'<>\\]*/i;
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

function decodeOnce(s) {
  const t = String(s || "");
  try {
    const d = decodeURIComponent(t);
    return d !== t ? d : t;
  } catch {
    return t;
  }
}

function tidyUrl(raw) {
  let s = decodeOnce(String(raw || "")).trim().replace(/^['"]+|['"]+$/g, "");
  if (!s) return null;
  if (/^(?:www\.)?(?:instagram\.com|instagr\.am)\//i.test(s)) s = `https://${s.replace(/^\/\//, "")}`;
  if (!HTTP_RE.test(s)) return null;
  return s.replace(/[),.;]+$/g, "");
}

function firstUrlIn(text, preferIg) {
  if (typeof text !== "string" || !text.trim()) return null;
  const s = decodeOnce(text.trim());
  if (s.toLowerCase().startsWith("data:")) return null;
  if (HTTP_RE.test(s)) {
    const firstToken = s.split(/\s+/)[0];
    const tidy = tidyUrl(firstToken);
    if (tidy && (!preferIg || isInstagramUrl(tidy))) return tidy;
  }
  const ig = s.match(IG_PATH);
  if (ig) return tidyUrl(ig[0]);
  if (preferIg) return null;
  const any = s.match(ANY_URL_IN_TEXT);
  return any ? tidyUrl(any[0]) : null;
}

function walkStrings(value, out, depth = 0) {
  if (depth > 8 || out.length > 80) return;
  if (typeof value === "string") {
    if (value.length && value.length < 8000 && !/^\s*data:/i.test(value)) out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) walkStrings(v, out, depth + 1);
  }
}

function urlScore(u) {
  if (!u) return 0;
  if (isInstagramUrl(u) && /\/(p|reel|reels|tv|share)\//i.test(u)) return 3;
  if (isInstagramUrl(u)) return 2;
  if (HTTP_RE.test(u) && !/cdninstagram|fbcdn\.net/i.test(u)) return 1;
  return 0;
}

function bestUrlFromStrings(strings, preferIg) {
  let best = null;
  let bestScore = preferIg ? 1 : 0;
  for (const s of strings) {
    const ig = firstUrlIn(s, true);
    const any = ig || firstUrlIn(s, false);
    const score = urlScore(any);
    if (score > bestScore) {
      best = any;
      bestScore = score;
    }
  }
  return best;
}

export function pickShareUrl(body) {
  const b = body && typeof body === "object" ? body : {};
  const named = [
    b.sourceUrl, b.source_url, b.url, b.URL, b.Url,
    b.link, b.pageUrl, b.page_url, b.input, b.href, b.website, b.webpage,
    b.u,
  ];
  if (Array.isArray(b.urls)) named.push(...b.urls);
  else if (typeof b.urls === "string") named.push(b.urls);
  for (const f of named) {
    if (typeof f === "string") {
      const u = firstUrlIn(f, false);
      if (u) return u;
    } else if (f && typeof f === "object") {
      const nested = [];
      walkStrings(f, nested);
      const u = bestUrlFromStrings(nested, true) || bestUrlFromStrings(nested, false);
      if (u) return u;
    }
  }
  const fromImage = firstUrlIn(b.imageDataUrl, false);
  if (fromImage) return fromImage;
  const walked = [];
  walkStrings(b, walked);
  return bestUrlFromStrings(walked, true) || bestUrlFromStrings(walked, false);
}

function firstUsableImage(body) {
  const b = body && typeof body === "object" ? body : {};
  const list = [];
  const push = (s) => {
    if (typeof s !== "string") return;
    if (usableImageDataUrl(s)) list.push(s);
    else if (!s.startsWith("data:") && /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s/g, "").length >= 64) {
      const wrapped = `data:image/jpeg;base64,${s.replace(/\s/g, "")}`;
      if (usableImageDataUrl(wrapped)) list.push(wrapped);
    }
  };
  push(b.imageDataUrl);
  push(b.image);
  push(b.photo);
  if (Array.isArray(b.images)) {
    for (const img of b.images) {
      if (typeof img === "string") push(img);
      else if (img && typeof img.imageDataUrl === "string") push(img.imageDataUrl);
    }
  }
  return list[0] || null;
}

export function coerceShareBody(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return {};
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed)) return { urls: parsed };
      } catch { /* fall through */ }
    }
    return { text: t };
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
}

export function classifyShare(body, query) {
  const merged = { ...coerceShareBody(query), ...coerceShareBody(body) };
  const url = pickShareUrl(merged);
  const imageDataUrl = firstUsableImage(merged);
  const ig = isInstagramUrl(url);
  const stubImage = !imageDataUrl && typeof merged.imageDataUrl === "string"
    && /^\s*data:/i.test(merged.imageDataUrl);
  return {
    url,
    imageDataUrl,
    instagram: ig,
    persistPhoto: !!(imageDataUrl && !ig),
    stubImage,
    caption: typeof merged.caption === "string" ? merged.caption
      : (typeof merged.text === "string" ? merged.text : null),
  };
}
