// Instagram accounts that must never be sent to the CGE website, neither as
// a handle nor as a link. (Instagram tagging has its own blocklist in
// igPublish.js, which also blocks CGE's own handle.)
export const WEBSITE_BLOCKED_IG_HANDLES = ["kinnectnj"];

const ALT = WEBSITE_BLOCKED_IG_HANDLES.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

// An Instagram URL pointing at a blocked account, with or without scheme,
// www/m, a trailing path or a query string. The lookahead keeps
// "kinnectnjevents" from matching.
const BLOCKED_URL =
  `(?:https?:\\/\\/)?(?:www\\.|m\\.)?(?:instagram\\.com|instagr\\.am)\\/(?:${ALT})(?![A-Za-z0-9_.])(?:[/?#][^\\s)"'<>]*)?`;

// "@KinnectNJ", " kinnectnj " → blocked. A URL or a different handle → not.
export function isBlockedIgHandle(raw) {
  const h = String(raw ?? "").trim().replace(/^@+/, "").toLowerCase();
  return !!h && WEBSITE_BLOCKED_IG_HANDLES.includes(h);
}

// Removes links to blocked accounts from free text. A markdown link or an
// <a> tag keeps its visible text; a bare URL is dropped.
export function stripBlockedIgLinks(text) {
  const t = String(text ?? "");
  if (!t) return t;
  return t
    .replace(new RegExp(`\\[([^\\]]*)\\]\\(\\s*${BLOCKED_URL}\\s*\\)`, "gi"), "$1")
    .replace(new RegExp(`<a\\s[^>]*href=["']${BLOCKED_URL}["'][^>]*>([\\s\\S]*?)<\\/a>`, "gi"), "$1")
    .replace(new RegExp(BLOCKED_URL, "gi"), "");
}

// Deep copy of an outgoing website payload with blocked handles and links
// removed from every string. A field that is exactly a blocked handle
// becomes "", a field that is exactly a blocked link becomes "".
export function scrubForWebsite(value) {
  if (typeof value === "string") {
    if (isBlockedIgHandle(value)) return "";
    return stripBlockedIgLinks(value);
  }
  if (Array.isArray(value)) return value.map(scrubForWebsite);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubForWebsite(v);
    return out;
  }
  return value;
}
