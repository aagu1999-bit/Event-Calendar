// Client API for /api/review-sessions — named save points for the
// Review tab's working state (events + approvals + filter).
//
// Mental model: explicit save points. The user names a session ("Friday
// triage"), clicks save, and can come back to that exact state on any
// device that hits the Repl URL. No background traffic, no conflict
// resolution beyond last-write-wins per session name.

const API = "/api/review-sessions";

async function api(path, init = {}) {
  const res = await fetch(API + path, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j?.error) msg += ` — ${j.error}`; } catch {}
    throw new Error(msg);
  }
  return res;
}

// Returns [{ name, size, mtime, savedAt, eventCount, approvalCount }, ...]
// sorted newest first.
export async function listSessions() {
  const res = await api("");
  return res.json();
}

export async function loadSession(name) {
  const res = await api(`/${encodeURIComponent(name)}`);
  return res.json();
}

export async function saveSession(name, payload) {
  const res = await api(`/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function deleteSession(name) {
  await api(`/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// Remember the last loaded session so the next boot can re-load it
// automatically. localStorage key kept namespaced so it doesn't collide
// with anything else.
const LS_LAST_KEY = "cge-last-review-session";

export function rememberLastSession(name) {
  try { localStorage.setItem(LS_LAST_KEY, String(name || "")); } catch {}
}
export function getLastSession() {
  try { return localStorage.getItem(LS_LAST_KEY) || null; } catch { return null; }
}
export function forgetLastSession() {
  try { localStorage.removeItem(LS_LAST_KEY); } catch {}
}
