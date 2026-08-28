// Screenshot-pool + team-shortcut storage.
//
// The old implementation wrote data/screenshot-pool/pool.json (and the
// signed .shortcut blob) to the Repl's local disk. That survives the *dev*
// workspace, but a GCE / Replit Deploy republish wipes the deployment
// filesystem — the same incident that ate review sessions on July 24 2026.
// See .agents/memory/deploy-disk-ephemeral.md.
//
// Prefer Postgres (DATABASE_URL is in both the workspace and the
// deployment). Fall back to the filesystem only when DATABASE_URL is
// absent (local off-Replit). One-time migration copies any leftover
// disk files into Postgres without clobbering rows that already exist.

import fs from "fs/promises";
import path from "path";
import pg from "pg";

const POOL_ROW_ID = "default";
const SHORTCUT_KEY = "team-shortcut";
const LOCK_KEY = "screenshot-pool";

function emptyPool() {
  return { entries: [] };
}

function normalizePool(data) {
  return { entries: Array.isArray(data?.entries) ? data.entries : [] };
}

function capPool(pool, maxItems) {
  const entries = Array.isArray(pool?.entries) ? pool.entries : [];
  if (entries.length > maxItems) return { entries: entries.slice(-maxItems) };
  return { entries };
}

async function readJsonFile(full) {
  try {
    return JSON.parse(await fs.readFile(full, "utf8"));
  } catch {
    return null;
  }
}

export function createPoolStore(fsDir, { maxItems = 500 } = {}) {
  const poolFile = path.join(fsDir, "pool.json");
  const shortcutBin = path.join(fsDir, "CGE-Intake.shortcut");
  const shortcutMeta = path.join(fsDir, "team-shortcut.json");
  const pgUrl = process.env.DATABASE_URL;

  const fsBackend = {
    backend: "filesystem",
    async load() {
      const j = await readJsonFile(poolFile);
      return normalizePool(j);
    },
    async save(pool) {
      await fs.mkdir(fsDir, { recursive: true });
      await fs.writeFile(poolFile, JSON.stringify(capPool(pool, maxItems), null, 2));
    },
    async update(fn) {
      const current = await this.load();
      const next = capPool(fn(current) || current, maxItems);
      await this.save(next);
      return next;
    },
    async teamShortcutStatus() {
      let icloudUrl = null;
      const meta = await readJsonFile(shortcutMeta);
      if (meta && typeof meta.icloudUrl === "string") icloudUrl = meta.icloudUrl;
      let hasFile = false, bytes = 0;
      try {
        const st = await fs.stat(shortcutBin);
        hasFile = st.isFile() && st.size > 32;
        bytes = hasFile ? st.size : 0;
      } catch { /* none yet */ }
      return { hasFile, bytes, icloudUrl };
    },
    async getTeamShortcutBlob() {
      try {
        const buf = await fs.readFile(shortcutBin);
        return buf && buf.length > 32 ? buf : null;
      } catch {
        return null;
      }
    },
    async saveTeamShortcutMeta(patch) {
      const cur = await this.teamShortcutStatus();
      const next = { icloudUrl: cur.icloudUrl, ...patch, savedAt: new Date().toISOString() };
      await fs.mkdir(fsDir, { recursive: true });
      await fs.writeFile(shortcutMeta, JSON.stringify(next, null, 2));
      return this.teamShortcutStatus();
    },
    async saveTeamShortcutBlob(buf) {
      await fs.mkdir(fsDir, { recursive: true });
      await fs.writeFile(shortcutBin, buf);
      return this.teamShortcutStatus();
    },
  };

  if (!pgUrl) return fsBackend;

  const pool = new pg.Pool({ connectionString: pgUrl, max: 3 });
  let ready = null;
  const ensureReady = () => {
    if (!ready) {
      ready = (async () => {
        try {
          await initOnce();
        } catch (e) {
          ready = null;
          throw e;
        }
      })();
    }
    return ready;
  };

  const initOnce = async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS screenshot_pool (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      saved_at BIGINT NOT NULL DEFAULT 0
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS screenshot_pool_files (
      key TEXT PRIMARY KEY,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      blob BYTEA,
      saved_at BIGINT NOT NULL DEFAULT 0
    )`);
    // Best-effort one-time copy of leftover disk files. Never overwrite a
    // Postgres row — the DB is the source of truth once populated.
    try {
      const { rows } = await pool.query("SELECT id FROM screenshot_pool WHERE id = $1", [POOL_ROW_ID]);
      if (!rows.length) {
        const disk = await readJsonFile(poolFile);
        if (disk && Array.isArray(disk.entries) && disk.entries.length) {
          await pool.query(
            `INSERT INTO screenshot_pool (id, data, saved_at) VALUES ($1, $2, $3)
             ON CONFLICT (id) DO NOTHING`,
            [POOL_ROW_ID, JSON.stringify(normalizePool(disk)), Date.now()],
          );
          console.log(`[screenshot-pool] migrated ${disk.entries.length} disk entries into Postgres`);
        }
      }
    } catch (e) {
      console.warn("[screenshot-pool] disk→Postgres pool migration skipped:", e?.message || e);
    }
    try {
      const { rows } = await pool.query("SELECT key FROM screenshot_pool_files WHERE key = $1", [SHORTCUT_KEY]);
      if (!rows.length) {
        const meta = (await readJsonFile(shortcutMeta)) || {};
        let blob = null;
        try {
          const buf = await fs.readFile(shortcutBin);
          if (buf && buf.length > 32) blob = buf;
        } catch { /* no file */ }
        if (blob || meta.icloudUrl) {
          await pool.query(
            `INSERT INTO screenshot_pool_files (key, meta, blob, saved_at) VALUES ($1, $2, $3, $4)
             ON CONFLICT (key) DO NOTHING`,
            [SHORTCUT_KEY, JSON.stringify(meta), blob, Date.now()],
          );
          console.log("[screenshot-pool] migrated team shortcut into Postgres");
        }
      }
    } catch (e) {
      console.warn("[screenshot-pool] disk→Postgres shortcut migration skipped:", e?.message || e);
    }
  };

  return {
    backend: "postgres",
    async load() {
      await ensureReady();
      const { rows } = await pool.query("SELECT data FROM screenshot_pool WHERE id = $1", [POOL_ROW_ID]);
      return rows.length ? normalizePool(rows[0].data) : emptyPool();
    },
    async save(nextPool) {
      await ensureReady();
      const data = capPool(nextPool, maxItems);
      await pool.query(
        `INSERT INTO screenshot_pool (id, data, saved_at) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, saved_at = EXCLUDED.saved_at`,
        [POOL_ROW_ID, JSON.stringify(data), Date.now()],
      );
    },
    async update(fn) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 42))", [LOCK_KEY]);
        const { rows } = await client.query(
          "SELECT data FROM screenshot_pool WHERE id = $1 FOR UPDATE",
          [POOL_ROW_ID],
        );
        const current = rows.length ? normalizePool(rows[0].data) : emptyPool();
        const next = capPool(fn(current) || current, maxItems);
        await client.query(
          `INSERT INTO screenshot_pool (id, data, saved_at) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, saved_at = EXCLUDED.saved_at`,
          [POOL_ROW_ID, JSON.stringify(next), Date.now()],
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
    async teamShortcutStatus() {
      await ensureReady();
      const { rows } = await pool.query(
        "SELECT meta, octet_length(blob) AS bytes FROM screenshot_pool_files WHERE key = $1",
        [SHORTCUT_KEY],
      );
      if (!rows.length) return { hasFile: false, bytes: 0, icloudUrl: null };
      const meta = rows[0].meta && typeof rows[0].meta === "object" ? rows[0].meta : {};
      const bytes = Number(rows[0].bytes) || 0;
      return {
        hasFile: bytes > 32,
        bytes: bytes > 32 ? bytes : 0,
        icloudUrl: typeof meta.icloudUrl === "string" ? meta.icloudUrl : null,
      };
    },
    async getTeamShortcutBlob() {
      await ensureReady();
      const { rows } = await pool.query("SELECT blob FROM screenshot_pool_files WHERE key = $1", [SHORTCUT_KEY]);
      const blob = rows[0]?.blob;
      if (!blob) return null;
      const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
      return buf.length > 32 ? buf : null;
    },
    async saveTeamShortcutMeta(patch) {
      await ensureReady();
      const cur = await this.teamShortcutStatus();
      const next = { icloudUrl: cur.icloudUrl, ...patch, savedAt: new Date().toISOString() };
      await pool.query(
        `INSERT INTO screenshot_pool_files (key, meta, blob, saved_at) VALUES ($1, $2, NULL, $3)
         ON CONFLICT (key) DO UPDATE SET meta = EXCLUDED.meta, saved_at = EXCLUDED.saved_at`,
        [SHORTCUT_KEY, JSON.stringify(next), Date.now()],
      );
      return this.teamShortcutStatus();
    },
    async saveTeamShortcutBlob(buf) {
      await ensureReady();
      const cur = await this.teamShortcutStatus();
      const meta = { icloudUrl: cur.icloudUrl, savedAt: new Date().toISOString() };
      await pool.query(
        `INSERT INTO screenshot_pool_files (key, meta, blob, saved_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET blob = EXCLUDED.blob, saved_at = EXCLUDED.saved_at,
           meta = COALESCE(screenshot_pool_files.meta, EXCLUDED.meta)`,
        [SHORTCUT_KEY, JSON.stringify(meta), buf, Date.now()],
      );
      return this.teamShortcutStatus();
    },
  };
}
