// Instagram ↔ Apify helpers for pool Extract.
//
// One Apify actor run can take many `directUrls`. We still persist slides
// and run Gemini per pool row — this file only canonicalizes URLs, builds
// the actor input, and maps dataset items back to those URLs. `resultsLimit`
// stays 1: these are post/reel links, not profile feeds.

export const APIFY_SLIDE_CAP = 10;

export function instagramShortcode(raw) {
  const m = String(raw || "").match(
    /(?:instagram\.com|instagr\.am)\/(?:share\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i,
  );
  return m ? m[1] : null;
}

export function canonicalIgKey(raw) {
  const code = instagramShortcode(raw);
  if (code) return code.toLowerCase();
  try {
    const u = new URL(String(raw || ""));
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`.toLowerCase();
  } catch {
    return String(raw || "").trim().toLowerCase();
  }
}

export function uniqueDirectUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const s = String(raw || "").trim();
    if (!/^https?:\/\//i.test(s)) continue;
    const key = canonicalIgKey(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function actorInputForDirectUrls(urls) {
  return {
    directUrls: uniqueDirectUrls(urls),
    resultsType: "posts",
    resultsLimit: 1,
    addParentData: false,
  };
}

function pickApifyMediaUrl(item) {
  if (!item || typeof item !== "object") return null;
  const fromList = [];
  const push = (v) => {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) fromList.push(v);
    else if (v && typeof v.url === "string" && /^https?:\/\//i.test(v.url)) fromList.push(v.url);
  };
  push(item.displayUrl);
  push(item.display_url);
  push(item.imageUrl);
  push(item.image);
  push(item.thumbnailUrl);
  push(item.thumbnail_url);
  if (Array.isArray(item.images)) item.images.forEach(push);
  if (Array.isArray(item.displayResourceUrls)) item.displayResourceUrls.forEach(push);
  const still = fromList.find((u) => !/\.mp4(\?|$)/i.test(u));
  return still || fromList[0] || null;
}

export function pickApifySlideUrls(item) {
  if (!item || typeof item !== "object") return [];
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    if (typeof u !== "string" || !/^https?:\/\//i.test(u)) return;
    if (/\.mp4(\?|$)/i.test(u)) return;
    const key = u.split("?")[0];
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(u);
  };
  const children = Array.isArray(item.childPosts) ? item.childPosts
    : Array.isArray(item.child_posts) ? item.child_posts
    : Array.isArray(item.sidecarChildren) ? item.sidecarChildren
    : [];
  if (children.length) {
    for (const child of children) add(pickApifyMediaUrl(child));
  }
  if (!urls.length) add(pickApifyMediaUrl(item));
  return urls.slice(0, APIFY_SLIDE_CAP);
}

export function pickApifyCaption(item) {
  const c = item?.caption || item?.text || "";
  return typeof c === "string" ? c.trim() : "";
}

export function pickApifyOwner(item) {
  const u = item?.ownerUsername || item?.owner?.username || item?.username || item?.user?.username || "";
  return typeof u === "string" ? u.replace(/^@+/, "").trim() : "";
}

export function pickApifyItemUrl(item) {
  if (!item || typeof item !== "object") return "";
  const candidates = [
    item.url,
    item.inputUrl,
    item.inputURL,
    item.postUrl,
    item.displayUrl && String(item.displayUrl).includes("instagram.com/") ? item.displayUrl : null,
    item.input?.url,
    Array.isArray(item.input?.directUrls) ? item.input.directUrls[0] : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && /instagram\.com|instagr\.am/i.test(c)) return c;
  }
  return typeof item.url === "string" ? item.url : "";
}

export function indexApifyItems(items) {
  const map = new Map();
  const list = Array.isArray(items) ? items : [];
  for (const item of list) {
    if (!item || typeof item !== "object" || item.error) continue;
    const keys = [
      canonicalIgKey(pickApifyItemUrl(item)),
      item.shortCode && String(item.shortCode).toLowerCase(),
      item.shortcode && String(item.shortcode).toLowerCase(),
    ].filter(Boolean);
    for (const k of keys) {
      if (!map.has(k)) map.set(k, item);
    }
  }
  return map;
}

export function lookupApifyItem(index, sourceUrl) {
  if (!index || typeof index.get !== "function") return null;
  const key = canonicalIgKey(sourceUrl);
  if (key && index.has(key)) return index.get(key);
  const code = instagramShortcode(sourceUrl);
  if (code && index.has(code.toLowerCase())) return index.get(code.toLowerCase());
  return null;
}
