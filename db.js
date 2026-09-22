// Shared Postgres pool for the app's persistent stores (events, pool_entries).
//
// `reviewSessionStore.js` already spins up its own pool for review-session
// data; keeping this separate is deliberate — one pool per subsystem is
// negligible at Replit's scale, and it means this file can't break session
// storage even under refactor. If future work consolidates them, this is
// the file to keep and reviewSessionStore.js is the one to migrate.
//
// DATABASE_URL is set in both the Replit dev workspace and deployments,
// and any node processes started outside that env will just get null back
// from getPool() — callers handle that by returning empty defaults so
// the rest of the app keeps working without persistence.

import pg from "pg";

let poolInstance = null;
let disabled = false;

export function getPool() {
  if (poolInstance) return poolInstance;
  if (disabled) return null;
  const url = process.env.DATABASE_URL;
  if (!url) { disabled = true; return null; }
  poolInstance = new pg.Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  poolInstance.on("error", (err) => {
    console.warn("[db] idle client error:", err.message);
  });
  return poolInstance;
}

// Run a callback inside a checked-out client. Auto-releases; caller's
// errors propagate. Prefer this over pool.query() when doing multiple
// dependent statements (transactions, SELECT-FOR-UPDATE patterns).
export async function withClient(fn) {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL not set — Postgres unavailable");
  const client = await pool.connect();
  try { return await fn(client); }
  finally { client.release(); }
}

// Convenience wrapper for a transactional block. Auto-BEGIN, auto-COMMIT
// on success, auto-ROLLBACK on any throw. Returns whatever fn returns.
export async function withTransaction(fn) {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* already dead */ }
      throw err;
    }
  });
}
