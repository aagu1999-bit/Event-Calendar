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
import pg from "pg";

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

// ---- Collaborative merge -------------------------------------------------
// Applies a batch of granular ops from one device onto the current server
// copy of a session. This is what lets two phones work in the SAME session:
// each device sends only what IT changed (rows edited/removed, ids vetted,
// events added), and the server folds those into the shared copy instead of
// overwriting the whole thing.
const eventKey = (e) =>
  e && e.id != null ? String(e.id) : JSON.stringify([e?.name || "", e?.date || "", e?.venue || ""]);

export function applySessionOps(existing, ops) {
  const base = existing || {
    events: [], approvals: {}, vetted: [], pending: [], filter: "", sortByTag: null,
  };
  const o = ops || {};

  // Pending rows: upsert by id (edits replace the row, new rows append in
  // order), removals delete by id.
  let pending = Array.isArray(base.pending) ? [...base.pending] : [];
  if (Array.isArray(o.upsertPending) && o.upsertPending.length) {
    const idx = new Map(pending.map((e, i) => [String(e.id), i]));
    for (const row of o.upsertPending) {
      if (!row || row.id == null) continue;
      const i = idx.get(String(row.id));
      if (i != null) pending[i] = row;
      else { idx.set(String(row.id), pending.length); pending.push(row); }
    }
  }
  if (Array.isArray(o.removePending) && o.removePending.length) {
    const gone = new Set(o.removePending.map(String));
    pending = pending.filter((e) => !gone.has(String(e.id)));
  }

  // Vetted: set semantics.
  const vetted = new Set(Array.isArray(base.vetted) ? base.vetted : []);
  if (Array.isArray(o.addVetted)) for (const id of o.addVetted) vetted.add(id);
  if (Array.isArray(o.removeVetted)) for (const id of o.removeVetted) vetted.delete(id);

  // Approvals: per-key assignment; null/undefined deletes the key.
  const approvals = { ...(base.approvals || {}) };
  if (o.setApprovals && typeof o.setApprovals === "object") {
    for (const [k, v] of Object.entries(o.setApprovals)) {
      if (v == null) delete approvals[k];
      else approvals[k] = v;
    }
  }

  // Calendar events: upsert/remove by id (or name|date|venue when id-less).
  let events = Array.isArray(base.events) ? [...base.events] : [];
  if (Array.isArray(o.upsertEvents) && o.upsertEvents.length) {
    const idx = new Map(events.map((e, i) => [eventKey(e), i]));
    for (const ev of o.upsertEvents) {
      if (!ev) continue;
      const k = eventKey(ev);
      const i = idx.get(k);
      if (i != null) events[i] = ev;
      else { idx.set(k, events.length); events.push(ev); }
    }
  }
  if (Array.isArray(o.removeEvents) && o.removeEvents.length) {
    const gone = new Set(o.removeEvents.map(String));
    events = events.filter((e) => !gone.has(eventKey(e)));
  }

  return {
    events,
    approvals,
    vetted: Array.from(vetted),
    pending,
    filter: typeof o.filter === "string" ? o.filter : (base.filter || ""),
    sortByTag: o.sortByTag !== undefined ? o.sortByTag : (base.sortByTag ?? null),
    version: (Number(base.version) || 0) + 1,
    savedAt: Date.now(),
  };
}

// ---- Store factory -------------------------------------------------------
// Returns { backend, list, get, put, del } where backend is
// "replit-db" | "filesystem". `fsDir` is the on-disk fallback directory and
// also the source for the one-time migration into the DB.
export function createSessionStore(fsDir) {
  const pgUrl = process.env.DATABASE_URL;
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
    // Read-modify-write (no real locking on this backend — dev fallback only).
    async update(name, fn) {
      const current = await this.get(name);
      const next = fn(current);
      await this.put(name, next);
      return next;
    },
  };

  // ---- PostgreSQL backend (preferred) ----
  // DATABASE_URL is present in BOTH the dev workspace and deployments, and the
  // data survives republishes — unlike the deployment's local disk, which is
  // reset on every publish (that wipe is exactly the bug this fixes).
  if (pgUrl) {
    const pool = new pg.Pool({ connectionString: pgUrl, max: 3 });
    let ready = null;
    const ensureReady = () => {
      if (!ready) {
        ready = (async () => {
          try {
            await initOnce();
          } catch (e) {
            // Don't let a transient DB hiccup permanently poison the store —
            // clear the memo so the next request retries initialization.
            ready = null;
            throw e;
          }
        })();
      }
      return ready;
    };
    const initOnce = async () => {
          await pool.query(`CREATE TABLE IF NOT EXISTS review_sessions (
            name TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            saved_at BIGINT NOT NULL DEFAULT 0
          )`);
          // Backup history: automatic snapshots of session state over time,
          // so a bad save/sync mishap can be recovered ("what did the
          // session look like at 6:45?"). Snapshots are throttled (one per
          // SNAPSHOT_MIN_GAP_MS max) and pruned to the newest
          // SNAPSHOT_KEEP per session.
          await pool.query(`CREATE TABLE IF NOT EXISTS review_session_history (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            data JSONB NOT NULL,
            snapped_at BIGINT NOT NULL
          )`);
          await pool.query(`CREATE INDEX IF NOT EXISTS review_session_history_name_idx
            ON review_session_history (name, snapped_at DESC)`);
          // One-time, best-effort migration of any legacy sessions (old
          // filesystem files and/or Replit DB keys) into Postgres, without
          // clobbering rows that already exist there.
          try {
            const { rows } = await pool.query("SELECT name FROM review_sessions");
            const existing = new Set(rows.map((r) => r.name));
            const migrate = async (name, data) => {
              if (!name || existing.has(name) || !data) return;
              await pool.query(
                "INSERT INTO review_sessions (name, data, saved_at) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING",
                [name, JSON.stringify(data), data.savedAt || 0],
              );
              existing.add(name);
            };
            try {
              const files = await fs.readdir(fsDir);
              for (const f of files) {
                if (!f.endsWith(".json")) continue;
                try {
                  await migrate(f.replace(/\.json$/, ""), JSON.parse(await fs.readFile(path.join(fsDir, f), "utf8")));
                } catch { /* skip corrupt file */ }
              }
            } catch { /* no legacy dir */ }
            if (dbUrl) {
              try {
                for (const key of await dbList(dbUrl, KEY_PREFIX)) {
                  try {
                    const raw = await dbGet(dbUrl, key);
                    if (raw != null) await migrate(key.slice(KEY_PREFIX.length), JSON.parse(raw));
                  } catch { /* skip corrupt value */ }
                }
              } catch { /* Replit DB unreachable */ }
            }
          } catch (e) {
            console.warn("[review-sessions] legacy→Postgres migration skipped:", e?.message || e);
          }
    };

    // Snapshot the OLD copy of a session into history before it gets
    // replaced, at most once per SNAPSHOT_MIN_GAP_MS (merges arrive every
    // ~1.2s while someone sweeps — snapshotting each one would bloat the
    // table with near-identical 400KB copies). Prune to SNAPSHOT_KEEP.
    // Best-effort: a history failure must never block the actual save.
    const SNAPSHOT_MIN_GAP_MS = 5 * 60 * 1000; // one snapshot per 5 minutes max
    const SNAPSHOT_KEEP = 50;                  // per session (~2 days of active work)
    // `inTx` = client is inside an open transaction. Postgres aborts the
    // WHOLE transaction when any statement errors — catching the JS error
    // isn't enough, the tx stays poisoned and the real save would then
    // fail. A savepoint lets us roll back just the snapshot work.
    const maybeSnapshot = async (client, name, oldData, inTx = false) => {
      if (!oldData) return;
      try {
        if (inTx) await client.query("SAVEPOINT snap");
        try {
          const now = Date.now();
          const { rows } = await client.query(
            "SELECT MAX(snapped_at) AS latest FROM review_session_history WHERE name = $1",
            [name],
          );
          const latest = Number(rows[0]?.latest) || 0;
          if (now - latest >= SNAPSHOT_MIN_GAP_MS) {
            await client.query(
              "INSERT INTO review_session_history (name, data, snapped_at) VALUES ($1, $2, $3)",
              [name, JSON.stringify(oldData), now],
            );
            await client.query(
              `DELETE FROM review_session_history WHERE name = $1 AND id NOT IN (
                 SELECT id FROM review_session_history WHERE name = $1 ORDER BY snapped_at DESC LIMIT $2
               )`,
              [name, SNAPSHOT_KEEP],
            );
          }
          if (inTx) await client.query("RELEASE SAVEPOINT snap");
        } catch (e) {
          if (inTx) await client.query("ROLLBACK TO SAVEPOINT snap");
          throw e;
        }
      } catch (e) {
        console.warn("[review-sessions] snapshot skipped:", e?.message || e);
      }
    };

    return {
      backend: "postgres",
      // List backup snapshots for a session, newest first (metadata only).
      async history(name) {
        await ensureReady();
        const { rows } = await pool.query(
          `SELECT id, snapped_at,
                  jsonb_array_length(COALESCE(data->'pending','[]'::jsonb)) AS pending,
                  jsonb_array_length(COALESCE(data->'vetted','[]'::jsonb)) AS vetted,
                  jsonb_array_length(COALESCE(data->'events','[]'::jsonb)) AS events
           FROM review_session_history WHERE name = $1 ORDER BY snapped_at DESC`,
          [name],
        );
        return rows.map((r) => ({
          id: Number(r.id),
          snappedAt: Number(r.snapped_at),
          pendingCount: Number(r.pending) || 0,
          vettedCount: Number(r.vetted) || 0,
          eventCount: Number(r.events) || 0,
        }));
      },
      // Fetch one snapshot's full payload by id.
      async historyGet(name, id) {
        await ensureReady();
        const { rows } = await pool.query(
          "SELECT data FROM review_session_history WHERE name = $1 AND id = $2",
          [name, id],
        );
        return rows.length ? rows[0].data : null;
      },
      async list() {
        await ensureReady();
        const { rows } = await pool.query("SELECT name, data FROM review_sessions");
        const out = rows.map((r) => summarize(r.name, r.data));
        out.sort((a, b) => b.savedAt - a.savedAt);
        return out;
      },
      async get(name) {
        await ensureReady();
        const { rows } = await pool.query("SELECT data FROM review_sessions WHERE name = $1", [name]);
        return rows.length ? rows[0].data : null;
      },
      async put(name, data) {
        await ensureReady();
        try {
          const { rows } = await pool.query("SELECT data FROM review_sessions WHERE name = $1", [name]);
          if (rows.length) await maybeSnapshot(pool, name, rows[0].data);
        } catch { /* best-effort */ }
        await pool.query(
          `INSERT INTO review_sessions (name, data, saved_at) VALUES ($1, $2, $3)
           ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, saved_at = EXCLUDED.saved_at`,
          [name, JSON.stringify(data), data?.savedAt || Date.now()],
        );
      },
      async del(name) {
        await ensureReady();
        const res = await pool.query("DELETE FROM review_sessions WHERE name = $1", [name]);
        return res.rowCount > 0;
      },
      // Atomic read-modify-write under a row lock, so two phones merging into
      // the same session at once can't clobber each other's changes.
      async update(name, fn) {
        await ensureReady();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Advisory lock on the session NAME — unlike FOR UPDATE, this also
          // serializes two devices creating the same session at once (when
          // there's no row to lock yet).
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 42))", [name]);
          const { rows } = await client.query(
            "SELECT data FROM review_sessions WHERE name = $1 FOR UPDATE",
            [name],
          );
          const current = rows.length ? rows[0].data : null;
          await maybeSnapshot(client, name, current, true);
          const next = fn(current);
          await client.query(
            `INSERT INTO review_sessions (name, data, saved_at) VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data, saved_at = EXCLUDED.saved_at`,
            [name, JSON.stringify(next), next?.savedAt || Date.now()],
          );
          await client.query("COMMIT");
          return next;
        } catch (e) {
          try { await client.query("ROLLBACK"); } catch { /* already dead */ }
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }

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
    // Read-modify-write (no real locking on this backend).
    async update(name, fn) {
      const current = await this.get(name);
      const next = fn(current);
      await this.put(name, next);
      return next;
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
