// Thin client for the /api/workspaces endpoints exposed by server.js.
// Lets the team save / load workspace zips into the Repl's filesystem
// instead of shipping them through Drive. Pairs with workspaceSync.js
// (which builds / consumes the zips themselves).
//
// All functions throw on non-2xx; callers should try/catch and surface
// the message in the UI.

// One-time availability probe: when the app's served by `npm run dev`
// (Node + Vite middleware), /api/health responds. When it's served as a
// pure-static build (Replit static deployment), /api/health returns the
// SPA fallback HTML instead — we detect that and treat it as "no cloud."
// Cached so every Cloud button doesn't fire a request on every render.
let _availabilityCheck = null;
export function checkCloudAvailable() {
  if (_availabilityCheck) return _availabilityCheck;
  _availabilityCheck = (async () => {
    try {
      const res = await fetch("/api/health", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return false;
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) return false;
      const body = await res.json();
      return Boolean(body && body.ok);
    } catch {
      return false;
    }
  })();
  return _availabilityCheck;
}

export async function cloudList() {
  const res = await fetch("/api/workspaces", { cache: "no-store" });
  if (!res.ok) throw new Error(`list failed (${res.status})`);
  return res.json();
}

export async function cloudSave(name, blob) {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/zip" },
    body: blob,
  });
  if (!res.ok) {
    let msg = `save failed (${res.status})`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function cloudLoad(name) {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(name)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`load failed (${res.status})`);
  return res.blob();
}

export async function cloudDelete(name) {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) {
    let msg = `delete failed (${res.status})`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}
