// Publish reviewed events to the Central Group Events website repo.
//
// The deployed app runs in the user's browser, so this talks to the GitHub
// REST API directly (CORS-enabled for authenticated requests) — no server
// round-trip and nothing about the CGE Tools backend is involved. The user
// supplies a fine-grained personal-access-token scoped to "Contents:
// Read and write" on the ONE target repo; it's stored in localStorage on
// their machine only.
//
// Flow: GET the target file to read its current sha (if it exists), then
// PUT the new JSON with that sha (update) or without it (create).

const LS_KEY = "cge-website-publish-config";

// Sensible defaults for the CGE site. Every field is editable in the UI so
// the same button can target a different repo/path/branch without a rebuild.
export const DEFAULT_PUBLISH_CONFIG = {
  owner: "centralgroupevents",
  repo: "Central-Group-Events",
  path: "data/events.json",
  branch: "main",
  token: "",
};

export function loadPublishConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_PUBLISH_CONFIG };
    return { ...DEFAULT_PUBLISH_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PUBLISH_CONFIG };
  }
}

export function savePublishConfig(cfg) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...DEFAULT_PUBLISH_CONFIG, ...cfg }));
  } catch { /* storage full / disabled — non-fatal */ }
}

// Map an internal event to the clean, documented shape the website consumes.
// Only the fields the site needs, renamed to friendly keys (type → category).
// Empty fields are dropped so the payload stays tidy.
function toWebsiteEvent(e) {
  const out = {};
  const put = (k, v) => { const s = (v == null ? "" : String(v)).trim(); if (s) out[k] = s; };
  put("name", e.name);
  put("day", e.day);
  put("date", e.date);
  put("time", e.time);
  put("venue", e.venue);
  put("area", e.area);
  put("region", e.region);
  put("category", e.type || e.category);
  put("link", e.link || e.url);
  return out;
}

// Build the full JSON payload (as a pretty-printed string) that gets written
// to the repo. `generatedAt` is passed in so the module stays deterministic /
// testable — the caller stamps the time.
export function buildWebsitePayload(events, generatedAt) {
  const list = (Array.isArray(events) ? events : []).map(toWebsiteEvent).filter(e => e.name);
  const payload = {
    source: "CGE Tools — Review tab",
    generatedAt: generatedAt || null,
    count: list.length,
    events: list,
  };
  return JSON.stringify(payload, null, 2);
}

// UTF-8-safe base64 (btoa alone throws on non-Latin1 chars — event names can
// carry accents/emoji). Encode to UTF-8 bytes first, then base64 them.
function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const GH = "https://api.github.com";

async function ghJson(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
  return res;
}

// Push `contentString` to owner/repo/path on the given branch. Handles both
// create (file doesn't exist yet) and update (needs the current blob sha).
// Throws an Error with a readable message on any failure so the UI can show it.
export async function publishToGitHub({ token, owner, repo, path, branch, contentString, message }) {
  if (!token) throw new Error("Add a GitHub token first.");
  if (!owner || !repo || !path) throw new Error("Repo owner, name, and file path are all required.");
  const base = `${GH}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const auth = { Authorization: `Bearer ${token}` };
  const ref = branch || "main";

  // 1) Look up the existing file's sha (needed to UPDATE it). A 404 just
  //    means the file doesn't exist yet — we'll create it.
  let sha;
  try {
    const getRes = await ghJson(`${base}?ref=${encodeURIComponent(ref)}`, { headers: auth });
    if (getRes.status === 200) {
      const body = await getRes.json();
      sha = body.sha;
    } else if (getRes.status === 401) {
      throw new Error("GitHub rejected the token (401). Check it hasn't expired and has Contents: write on this repo.");
    } else if (getRes.status === 403) {
      throw new Error("GitHub denied access (403). The token needs Contents: Read and write on this repo.");
    } else if (getRes.status !== 404) {
      const t = await getRes.text().catch(() => "");
      throw new Error(`Couldn't read the target file (${getRes.status}). ${t.slice(0, 160)}`);
    }
  } catch (e) {
    if (e instanceof TypeError) throw new Error("Network/CORS error reaching GitHub. Check your connection.");
    throw e;
  }

  // 2) Create or update.
  const putRes = await ghJson(base, {
    method: "PUT",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: message || "Update events from CGE Tools",
      content: toBase64Utf8(contentString),
      branch: ref,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    let msg = `Publish failed (${putRes.status})`;
    try { const j = await putRes.json(); if (j?.message) msg += ` — ${j.message}`; } catch {}
    if (putRes.status === 409) msg += " (the file changed on GitHub since we read it — try again).";
    throw new Error(msg);
  }
  const out = await putRes.json();
  return {
    commitSha: out?.commit?.sha || null,
    htmlUrl: out?.content?.html_url || null,
  };
}
