// Review-session storage abstraction — the thing that makes "save my
// triage on my laptop, finish it on my phone" actually work.
//
// The old implementation wrote data/review-sessions/*.json to the Repl's
// local filesystem. That looks cloud-y but isn't: the dev preview
// (*.replit.dev) and the deployment (*.replit.app) have SEPARATE disks,
// and a plain (non–Reserved-VM) deploy can be reclaimed and start with an
// empty disk. So a session saved from one device / URL was invisible from
// another. That's the cross-device bug.
//
// Fix: prefer Replit DB — a real key/value store that's shared across
// every instance hitting the same Repl and survives redeploys. Fall back
// to the filesystem only when REPLIT_DB_URL is absent (local dev, or a
// non-Replit host), so nothing breaks off-platform.
//
// Key shape in Replit DB:  "rsession:<name>"  ->  JSON string of the session.

import fs from "fs/promises";
import path from "path";

const KEY_PREFIX = "rsession:";

// ---- Replit DB REST helpers ---------------------------------------------
// The DB speaks a tiny REST dialect:
//   SET    POST <url>            body: key=value   (form-encoded)
//   GET    GET  <url>/<key>      -> raw value, 404 when missing
//   LIST   GET  <url>?prefix=X&encode=true  -> URL-encoded keys, newline-sep
//   DELETE DELETE <url>/<key>
async function dbSet(url, key, value) {
  const body = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Replit DB set failed: ${r.status}`);
}

async function dbGet(url, key) {
  const r = await fetch(`${url}/${encodeURIComponent(key)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Replit DB get failed: ${r.status}`);
  return await r.text();
}

async function dbList(url, prefix) {
  const r = await fetch(`${url}?prefix=${encodeURIComponent(prefix)}&encode=true`);
  if (!r.ok) throw new Error(`Replit DB list failed: ${r.status}`);
  const text = await r.text();
  if (!text) return [];
  return text
    .split("\n")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => decodeURIComponent(k));
}

async function dbDelete(url, key) {
  const r = await fetch(`${url}/${encodeURIComponent(key)}`, { method: "DELETE" });
  // 404 means "already gone" — treat as success for idempotent delete.
  if (!r.ok && r.status !== 404) throw new Error(`Replit DB delete failed: ${r.status}`);
  return r.status !== 404;
}

// Peek the summary fields the list view shows, from a parsed session.
function summarize(name, data, fallbackSavedAt = 0) {
  const d = data || {};
  return {
    name,
    savedAt: d.savedAt || fallbackSavedAt,
    eventCount: Array.isArray(d.events) ? d.events.length : 0,
    approvalCount: d.approvals ? Object.values(d.approvals).filter(Boolean).length : 0,
    vettedCount: Array.isArray(d.vetted) ? d.vetted.length : 0,
    pendingCount: Array.isArray(d.pending) ? d.pending.length : 0,
  };
}

// Normalize an incoming request body into the persisted shape. Kept here so
// both backends store identical JSON.
export function normalizeSession(body) {
  const b = body || {};
  return {
    events: Array.isArray(b.events) ? b.events : [],
    approvals: b.approvals && typeof b.approvals === "object" ? b.approvals : {},
    vetted: Array.isArray(b.vetted) ? b.vetted : [],
    // The in-progress triage queue (flagged/clean/conflicting rows). Persisted
    // so a session saved mid-sweep resumes the whole queue on another device.
    pending: Array.isArray(b.pending) ? b.pending : [],
    filter: typeof b.filter === "string" ? b.filter : "",
    sortByTag: typeof b.sortByTag === "string" ? b.sortByTag : null,
    savedAt: Date.now(),
  };
}

// ---- Store factory -------------------------------------------------------
// Returns { backend, list, get, put, del } where backend is
// "replit-db" | "filesystem". `fsDir` is the on-disk fallback directory and
// also the source for the one-time migration into the DB.
export function createSessionStore(fsDir) {
  const dbUrl = process.env.REPLIT_DB_URL;
  const useDb = !!dbUrl;

  // ---- Filesystem backend ----
  const fsBackend = {
    backend: "filesystem",
    async list() {
      await fs.mkdir(fsDir, { recursive: true });
      const files = await fs.readdir(fsDir);
      const out = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const name = f.replace(/\.json$/, "");
        try {
          const st = await fs.stat(path.join(fsDir, f));
          let data = null;
          try {
            data = JSON.parse(await fs.readFile(path.join(fsDir, f), "utf8"));
          } catch { /* corrupt — surface as 0 counts */ }
          out.push(summarize(name, data, st.mtimeMs));
        } catch { /* vanished mid-list */ }
      }
      out.sort((a, b) => b.savedAt - a.savedAt);
      return out;
    },
    async get(name) {
      const full = path.join(fsDir, name + ".json");
      try {
        return JSON.parse(await fs.readFile(full, "utf8"));
      } catch (e) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async put(name, data) {
      await fs.mkdir(fsDir, { recursive: true });
      await fs.writeFile(path.join(fsDir, name + ".json"), JSON.stringify(data));
    },
    async del(name) {
      try {
        await fs.unlink(path.join(fsDir, name + ".json"));
        return true;
      } catch (e) {
        if (e.code === "ENOENT") return false;
        throw e;
      }
    },
  };

  if (!useDb) return fsBackend;

  // ---- Replit DB backend ----
  const dbBackend = {
    backend: "replit-db",
    async list() {
      const keys = await dbList(dbUrl, KEY_PREFIX);
      const out = [];
      for (const key of keys) {
        const name = key.slice(KEY_PREFIX.length);
        let data = null;
        try {
          const raw = await dbGet(dbUrl, key);
          if (raw != null) data = JSON.parse(raw);
        } catch { /* corrupt value — surface as 0 counts */ }
        out.push(summarize(name, data));
      }
      out.sort((a, b) => b.savedAt - a.savedAt);
      return out;
    },
    async get(name) {
      const raw = await dbGet(dbUrl, KEY_PREFIX + name);
      if (raw == null) return null;
      return JSON.parse(raw);
    },
    async put(name, data) {
      await dbSet(dbUrl, KEY_PREFIX + name, JSON.stringify(data));
    },
    async del(name) {
      return await dbDelete(dbUrl, KEY_PREFIX + name);
    },
  };

  // One-time, best-effort migration: copy any legacy filesystem sessions
  // into the DB WITHOUT clobbering keys that already exist there (the DB is
  // the source of truth once populated). Runs in the background; failures
  // are logged and ignored so a bad disk never blocks startup.
  (async () => {
    try {
      await fs.mkdir(fsDir, { recursive: true });
      const files = await fs.readdir(fsDir);
      const jsons = files.filter((f) => f.endsWith(".json"));
      if (!jsons.length) return;
      const existing = new Set(await dbList(dbUrl, KEY_PREFIX));
      let moved = 0;
      for (const f of jsons) {
        const name = f.replace(/\.json$/, "");
        if (existing.has(KEY_PREFIX + name)) continue;
        try {
          const data = JSON.parse(await fs.readFile(path.join(fsDir, f), "utf8"));
          await dbSet(dbUrl, KEY_PREFIX + name, JSON.stringify(data));
          moved++;
        } catch { /* skip corrupt file */ }
      }
      if (moved) console.log(`[review-sessions] migrated ${moved} legacy session(s) into Replit DB`);
    } catch (e) {
      console.warn("[review-sessions] filesystem→DB migration skipped:", e?.message || e);
    }
  })();

  return dbBackend;
}
