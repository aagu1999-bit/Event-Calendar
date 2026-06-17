// Live cloud sync for the Review tab — auto-saves the events list to the
// Repl filesystem on change (debounced), auto-loads on app boot, polls
// for cross-device updates. Lets the user pick up where they left off
// across phone / laptop / new browser session.
//
// Architecture:
//   - PUT /api/review-state on every events-store mutation, debounced 2s
//   - GET /api/review-state on boot — if cloud is newer than local, merge
//   - Poll every 20s for cross-device changes (low frequency keeps it
//     cheap on the Repl and avoids fighting active editing)
//
// Conflict policy: last write wins. Solo / small-team use case where
// concurrent editing is rare. For a stronger guarantee, the existing
// manual Cloud Workspace (Save to Repl / Load from Repl) still works.

import { useEventsStore } from "../store";

const API_URL = "/api/review-state";
const PUSH_DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 20_000;
const LS_LAST_SYNC_KEY = "cge-review-sync-last-ts";
const LS_ENABLED_KEY = "cge-review-sync-enabled";

// Default: enabled. User can flip the toggle in the nav.
function isEnabled() {
  try {
    const v = localStorage.getItem(LS_ENABLED_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setEnabled(v) {
  try { localStorage.setItem(LS_ENABLED_KEY, v ? "1" : "0"); } catch {}
  if (v) startPolling();
  else stopPolling();
  _statusListeners.forEach(fn => { try { fn(getStatus()); } catch {} });
}

export function getEnabled() {
  return isEnabled();
}

// In-memory status + subscribers so the nav indicator can render
// "Syncing…" / "Synced 14s ago" / "Offline".
let _status = {
  state: "idle",     // "idle" | "saving" | "saved" | "loading" | "offline"
  lastSyncTs: 0,     // server ts of last successful push or pull
  lastError: null,
};
const _statusListeners = new Set();

export function onStatusChange(fn) {
  _statusListeners.add(fn);
  fn(_status);
  return () => _statusListeners.delete(fn);
}

export function getStatus() {
  return { ..._status, enabled: isEnabled() };
}

function setStatus(patch) {
  _status = { ..._status, ...patch };
  _statusListeners.forEach(fn => { try { fn(_status); } catch {} });
}

// Push current events to the cloud. Debounced via schedulePush().
async function pushNow() {
  if (!isEnabled()) return;
  const events = useEventsStore.getState().events || [];
  setStatus({ state: "saving" });
  try {
    const res = await fetch(API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    _localTsAtLastPush = data.ts;
    try { localStorage.setItem(LS_LAST_SYNC_KEY, String(data.ts)); } catch {}
    setStatus({ state: "saved", lastSyncTs: data.ts, lastError: null });
  } catch (err) {
    console.warn("Review sync push failed:", err);
    setStatus({ state: "offline", lastError: err.message || String(err) });
  }
}

let _pushTimer = null;
let _localTsAtLastPush = 0;

export function schedulePush() {
  if (!isEnabled()) return;
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    _pushTimer = null;
    pushNow();
  }, PUSH_DEBOUNCE_MS);
}

// Pull the cloud state. Used on boot and during polling.
// Returns { events, ts } or null on failure.
async function pull() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.warn("Review sync pull failed:", err);
    setStatus({ state: "offline", lastError: err.message || String(err) });
    return null;
  }
}

// Boot-time pull: if cloud has data and (local is empty OR cloud is
// strictly newer), adopt the cloud state. Otherwise keep local and
// (if local has data) push it to seed the cloud.
export async function pullOnBoot() {
  if (!isEnabled()) return;
  setStatus({ state: "loading" });
  const cloud = await pull();
  if (!cloud) return;

  const localEvents = useEventsStore.getState().events || [];
  let localTs = 0;
  try { localTs = parseInt(localStorage.getItem(LS_LAST_SYNC_KEY) || "0", 10) || 0; } catch {}

  const cloudHasData = Array.isArray(cloud.events) && cloud.events.length > 0;
  const localHasData = localEvents.length > 0;

  if (cloudHasData && (!localHasData || cloud.ts > localTs)) {
    // Adopt cloud
    useEventsStore.getState().setEvents(cloud.events);
    _localTsAtLastPush = cloud.ts;
    try { localStorage.setItem(LS_LAST_SYNC_KEY, String(cloud.ts)); } catch {}
    setStatus({ state: "saved", lastSyncTs: cloud.ts });
    return;
  }

  if (!cloudHasData && localHasData) {
    // Seed cloud from local
    pushNow();
    return;
  }

  setStatus({ state: "saved", lastSyncTs: cloud.ts || 0 });
}

// Polling for cross-device updates. Cheap GET, only updates the store
// when the server ts has changed AND the user isn't mid-typing (we
// can't easily detect that — for now, just respect last push ts).
let _pollTimer = null;

export function startPolling() {
  if (_pollTimer || !isEnabled()) return;
  _pollTimer = setInterval(async () => {
    if (!isEnabled()) return;
    if (_pushTimer) return;  // skip while a push is queued
    const cloud = await pull();
    if (!cloud) return;
    if (cloud.ts <= _localTsAtLastPush) return;  // nothing new

    // Only adopt cloud if it differs from local — avoid churn.
    const localEvents = useEventsStore.getState().events || [];
    const cloudEvents = Array.isArray(cloud.events) ? cloud.events : [];
    if (
      cloudEvents.length === localEvents.length &&
      JSON.stringify(cloudEvents) === JSON.stringify(localEvents)
    ) {
      _localTsAtLastPush = cloud.ts;
      return;
    }

    useEventsStore.getState().setEvents(cloudEvents);
    _localTsAtLastPush = cloud.ts;
    try { localStorage.setItem(LS_LAST_SYNC_KEY, String(cloud.ts)); } catch {}
    setStatus({ state: "saved", lastSyncTs: cloud.ts });
  }, POLL_INTERVAL_MS);
}

export function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// Subscribe to events-store mutations and schedule a debounced push.
// Called once during app boot from App.jsx (or wherever sync starts).
export function startSync() {
  if (!isEnabled()) {
    setStatus({ state: "idle" });
    return;
  }
  // Boot: pull cloud state once, then enable push-on-change + polling.
  pullOnBoot();
  // Zustand store subscription
  const unsub = useEventsStore.subscribe((state, prevState) => {
    // Cheap diff — only schedule a push if the events array reference
    // changed. Zustand sets a new reference on every set().
    if (state.events !== prevState.events) schedulePush();
  });
  startPolling();
  // Window-focus refresh: if the user comes back to the tab after a
  // long away (other device active), pull immediately instead of
  // waiting for the next poll tick.
  const onFocus = () => { if (isEnabled()) pull().then(cloud => {
    if (cloud && cloud.ts > _localTsAtLastPush) {
      const localEvents = useEventsStore.getState().events || [];
      const cloudEvents = Array.isArray(cloud.events) ? cloud.events : [];
      if (JSON.stringify(cloudEvents) !== JSON.stringify(localEvents)) {
        useEventsStore.getState().setEvents(cloudEvents);
      }
      _localTsAtLastPush = cloud.ts;
      try { localStorage.setItem(LS_LAST_SYNC_KEY, String(cloud.ts)); } catch {}
      setStatus({ state: "saved", lastSyncTs: cloud.ts });
    }
  }); };
  window.addEventListener("focus", onFocus);
  return () => {
    try { unsub(); } catch {}
    stopPolling();
    window.removeEventListener("focus", onFocus);
  };
}
