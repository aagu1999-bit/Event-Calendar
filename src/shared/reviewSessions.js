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
