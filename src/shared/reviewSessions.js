// Client API for /api/review-sessions — named save points for the
// Review tab's working state (events + approvals + filter).
//
// Mental model: explicit save points. The user names a session ("Friday
// triage"), clicks save, and can come back to that exact state on any
// device that hits the Repl URL. No background traffic, no conflict
// resolution beyond last-write-wins per session name.

import { retryFetch } from "./retryFetch.js";

const API = "/api/review-sessions";

// Session names travel in the URL path (…/review-sessions/<name>). A "/" in
// the name encodes to %2F, which Replit's proxy rejects with a 404 before
// the request ever reaches the server — so a name like "7/3 triage" fails to
// save. Collapse path-hostile characters to a dash up front. The server
// applies its own basename guard too; sanitizing here keeps the name the
// user sees matching the file that actually gets written.
function safeName(raw) {
  return String(raw || "").replace(/[/\\]+/g, "-").trim();
}

async function api(path, init = {}) {
  const res = await retryFetch(API + path, init);
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

// Which backend is storing sessions right now: "replit-db" (truly
// cross-device — survives redeploys, shared across every instance) or
// "filesystem" (this instance's local disk only — NOT reliable across
// devices/URLs). Returns null when the server/endpoint isn't reachable
// (e.g. static deploy with no Node process). Used to show the "☁️ Cloud
// sessions" indicator so the user knows whether hand-offs will work.
export async function sessionBackend() {
  try {
    const res = await retryFetch(`${API}-status`);
    if (!res.ok) return null;
    const j = await res.json();
    return j?.backend || null;
  } catch {
    return null;
  }
}

export async function loadSession(name) {
  const res = await api(`/${encodeURIComponent(safeName(name))}`);
  return res.json();
}

export async function saveSession(name, payload) {
  const res = await api(`/${encodeURIComponent(safeName(name))}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Collaborative merge: send only the granular changes this device made
// (ops = { upsertPending, removePending, addVetted, removeVetted,
// setApprovals, upsertEvents, removeEvents }). The server folds them into
// the shared session atomically and returns the merged copy, so two devices
// can safely work in the SAME session at once.
export async function mergeSession(name, ops) {
  const res = await api(`/${encodeURIComponent(safeName(name))}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops }),
  });
  const j = await res.json();
  return j.session;
}

export async function deleteSession(name) {
  await api(`/${encodeURIComponent(safeName(name))}`, { method: "DELETE" });
}

// Presence: check in as an active device on a session and learn how many
// other devices are currently working in it. Each browser gets a stable
// random device id kept in localStorage.
const LS_DEVICE_KEY = "cge-review-device-id";
export function getDeviceId() {
  try {
    let id = localStorage.getItem(LS_DEVICE_KEY);
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem(LS_DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "dev-anon";
  }
}

export async function pingPresence(name) {
  const res = await api(
    `/${encodeURIComponent(safeName(name))}/presence?device=${encodeURIComponent(getDeviceId())}`
  );
  const j = await res.json();
  return j.activeDevices || 0;
}

// Tombstone support for the diff sync: remember the set of pending-row ids
// this device last saw ON THE SERVER, per session. Without this, a row the
// PARTNER deleted is indistinguishable from a row this device added locally
// — and the auto-load merge would "helpfully" keep it and push it back up,
// resurrecting the partner's deletions. With the remembered base: a local
// row missing from the server that WAS in our last server copy = partner
// deleted it → drop it; a row we never saw on the server = genuinely new
// local work → keep it.
const LS_BASE_IDS_KEY = "cge-review-base-ids";
export function rememberServerPendingIds(name, ids) {
  try {
    localStorage.setItem(`${LS_BASE_IDS_KEY}:${safeName(name)}`, JSON.stringify(ids));
  } catch {}
}
export function getServerPendingIds(name) {
  try {
    const raw = localStorage.getItem(`${LS_BASE_IDS_KEY}:${safeName(name)}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map(String)) : null;
  } catch {
    return null;
  }
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
