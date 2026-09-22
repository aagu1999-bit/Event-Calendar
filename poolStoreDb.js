// Server-side storage for the screenshot / iOS-share pool, backed by
// Postgres. Replaces the previous pool.json file on the deployment's
// ephemeral disk, which was reset every time Autoscale redeployed —
// exactly the failure mode that wiped the operator's hundreds of pool
// entries. This store cannot be wiped by a redeploy.
//
// Shape on disk: one row per pool entry. `id` is the entry's own string
// id (e.g. "pool_<ts>_<rand>_share"); `data` is the full entry JSONB
// blob including thumbs[] for carousels. JSONB keeps schema flexible
// as new fields land (source, status, caption, thumbs, etc.).
//
// One-time seed: if this store starts empty AND a pool.json exists on
// disk from a previous deployment (e.g. dev workspace copy), we import
// its entries once so nothing is lost during migration. That import is
// controlled by seedFromJsonFileIfEmpty() which callers invoke at boot.

import fs from "fs/promises";
import path from "path";
import { getPool, withTransaction } from "./db.js";

let schemaInited = false;

async function ensureSchema() {
  if (schemaInited) return;
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pool_entries (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS pool_entries_created_at_idx ON pool_entries(created_at DESC)`);
  schemaInited = true;
}

// Read all pool entries, oldest first — same order the JSON file kept.
// The pool modal filters and re-sorts client-side; server just needs to
// return them in a stable order so bulk operations are deterministic.
export async function listPoolEntries() {
  await ensureSchema();
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM pool_entries ORDER BY created_at ASC");
  return rows.map((r) => r.data);
}

export async function countPoolEntries() {
  await ensureSchema();
  const pool = getPool();
  if (!pool) return 0;
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM pool_entries");
  return rows[0]?.n || 0;
}

// Upsert one pool entry. Used by the /share endpoint (iOS Shortcut adds
// a raw entry) and by the bulk /screenshot-pool POST for screenshot-modal
// saves. Preserves created_at on updates so age-sorting stays sensible.
export async function upsertPoolEntry(entry) {
  await ensureSchema();
  const pool = getPool();
  if (!pool) return false;
  if (!entry || entry.id == null) return false;
  await pool.query(
    `INSERT INTO pool_entries(id, data) VALUES($1, $2)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [String(entry.id), entry],
  );
  return true;
}

// Bulk upsert inside one transaction. Used by:
//   - the pool.json → Postgres one-time seed on first boot
//   - the /screenshot-pool POST bulk-add from the screenshot modal
// Cap enforcement is the caller's job (see POOL_MAX_ITEMS in server.js);
// this function will happily insert whatever it's given.
export async function bulkUpsertPoolEntries(entries) {
  await ensureSchema();
  const pool = getPool();
  if (!pool || !Array.isArray(entries) || entries.length === 0) return 0;
  return withTransaction(async (client) => {
    let n = 0;
    for (const e of entries) {
      if (!e || e.id == null) continue;
      await client.query(
        `INSERT INTO pool_entries(id, data) VALUES($1, $2)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [String(e.id), e],
      );
      n++;
    }
    return n;
  });
}

// Fetch one entry by id. Used by endpoints that need to read-modify-write
// (apify-scrape, resolve-media, update). Returns null if missing.
export async function getPoolEntry(id) {
  await ensureSchema();
  const pool = getPool();
  if (!pool || id == null) return null;
  const { rows } = await pool.query("SELECT data FROM pool_entries WHERE id = $1", [String(id)]);
  return rows[0]?.data || null;
}

// Read-modify-write inside one transaction, with SELECT ... FOR UPDATE
// so concurrent writers wait for each other instead of last-write-wins.
// `merge` is a function (currentEntry) => nextEntry — returning null
// deletes the row. Returns the resulting entry, or null if deleted /
// not found.
export async function patchPoolEntry(id, merge) {
  await ensureSchema();
  const pool = getPool();
  if (!pool || id == null || typeof merge !== "function") return null;
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT data FROM pool_entries WHERE id = $1 FOR UPDATE",
      [String(id)],
    );
    if (!rows.length) return null;
    const current = rows[0].data;
    const next = merge(current);
    if (next === null) {
      await client.query("DELETE FROM pool_entries WHERE id = $1", [String(id)]);
      return null;
    }
    await client.query(
      "UPDATE pool_entries SET data = $2, updated_at = now() WHERE id = $1",
      [String(id), next],
    );
    return next;
  });
}

// Delete by ids. Returns count actually removed.
export async function deletePoolEntries(ids) {
  await ensureSchema();
  const pool = getPool();
  if (!pool || !Array.isArray(ids) || ids.length === 0) return 0;
  const { rowCount } = await pool.query(
    "DELETE FROM pool_entries WHERE id = ANY($1::text[])",
    [ids.map(String)],
  );
  return rowCount;
}

// Enforce POOL_MAX_ITEMS on the server. Called after inserts that could
// push the total over the cap. Deletes oldest rows until we're back at
// or under the limit. Cheap because pool_entries_created_at_idx covers
// the sort.
export async function trimPoolToLimit(limit) {
  await ensureSchema();
  const pool = getPool();
  if (!pool || !Number.isFinite(limit) || limit <= 0) return 0;
  const { rowCount } = await pool.query(
    `DELETE FROM pool_entries WHERE id IN (
       SELECT id FROM pool_entries ORDER BY created_at ASC
       OFFSET $1
     )`,
    [limit],
  );
  return rowCount || 0;
}

// One-time seed from the legacy pool.json file. Runs at boot before the
// server starts accepting requests; only fires if pool_entries is empty
// AND pool.json exists AND parses cleanly. Never fails the boot — if the
// file is missing or malformed we just log and move on.
export async function seedFromJsonFileIfEmpty(jsonFilePath) {
  const pool = getPool();
  if (!pool) return { seeded: 0, reason: "no_db" };
  const existing = await countPoolEntries();
  if (existing > 0) return { seeded: 0, reason: "already_seeded" };
  let raw;
  try { raw = await fs.readFile(jsonFilePath, "utf8"); }
  catch { return { seeded: 0, reason: "no_file" }; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (err) {
    console.warn("[poolStoreDb] seed: pool.json unreadable —", err.message);
    return { seeded: 0, reason: "parse_error" };
  }
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  if (!entries.length) return { seeded: 0, reason: "empty_file" };
  const n = await bulkUpsertPoolEntries(entries);
  console.log(`[poolStoreDb] seeded ${n} entries from ${path.basename(jsonFilePath)}`);
  return { seeded: n, reason: "ok" };
}
