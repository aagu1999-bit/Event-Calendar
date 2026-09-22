// Server-side storage for the review-queue events list, backed by Postgres.
//
// Before this file, events lived in the browser's localStorage (via Zustand
// persist under the `cge-events` key). That worked as long as the operator
// used exactly one browser and never cleared cache — but cost multi-device
// sync (phone/laptop divergence) and put hours of curation at risk of a
// single cache clear.
//
// Shape on disk: one row per event, `id` is the event's own string id
// (whatever the client generates), `data` is the full event JSONB blob.
// JSONB is deliberate: the matrix expansion coming next lands as
// event.data.matrix.{...} without a single schema migration.
//
// Concurrency: current callers use whole-array setEvents() often, so
// replaceAll() is provided but discouraged. Prefer upsertEvent() and
// deleteEvents() when the caller knows the id — those are safe under
// concurrent writes from multiple devices; replaceAll() is last-write-wins
// for the entire list. Cross-device racing is not a concern for a
// single-operator workflow, but the row-level API is ready when it is.

import { getPool, withTransaction } from "./db.js";

let schemaInited = false;

async function ensureSchema() {
  if (schemaInited) return;
  const pool = getPool();
  if (!pool) return; // no DB configured; caller returns empty defaults
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS events_updated_at_idx ON events(updated_at DESC)`);
  schemaInited = true;
}

// Read all events. Order by updated_at desc so the caller can display
// most-recently-touched first if desired; ReviewQueue currently sorts
// by its own rules downstream so this is just a stable default.
export async function listEvents() {
  await ensureSchema();
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM events ORDER BY updated_at DESC");
  return rows.map((r) => r.data);
}

// Upsert one event. `event.id` is required and must be a string; anything
// else falls through with a warn and no write, so a malformed client
// payload can't wedge the pool.
export async function upsertEvent(event) {
  await ensureSchema();
  const pool = getPool();
  if (!pool) return false;
  if (!event || event.id == null) {
    console.warn("[eventStoreDb] upsertEvent skipped: no id on payload");
    return false;
  }
  await pool.query(
    `INSERT INTO events(id, data, updated_at) VALUES($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [String(event.id), event],
  );
  return true;
}

// Bulk upsert inside one transaction. Used by:
//   - the localStorage → server migration on client first-boot
//   - future bulk imports (e.g. weekend calendar builder saving a batch)
// If any row fails validation the whole batch rolls back — safer than
// half-committed state that's hard to diff against the client's view.
export async function bulkUpsertEvents(events) {
  await ensureSchema();
  const pool = getPool();
  if (!pool || !Array.isArray(events) || events.length === 0) return 0;
  return withTransaction(async (client) => {
    let n = 0;
    for (const ev of events) {
      if (!ev || ev.id == null) continue;
      await client.query(
        `INSERT INTO events(id, data, updated_at) VALUES($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [String(ev.id), ev],
      );
      n++;
    }
    return n;
  });
}

// Delete by ids. Passes the array to Postgres as a text[] so we don't
// have to build a dynamic WHERE IN clause. Returns the count actually
// removed (may be less than requested if some ids no longer exist).
export async function deleteEvents(ids) {
  await ensureSchema();
  const pool = getPool();
  if (!pool || !Array.isArray(ids) || ids.length === 0) return 0;
  const { rowCount } = await pool.query(
    "DELETE FROM events WHERE id = ANY($1::text[])",
    [ids.map(String)],
  );
  return rowCount;
}

// Full-list replace. Old rows the incoming list doesn't include are
// deleted; new ones are inserted; changed ones are updated. Used by the
// legacy setEvents() action for backward compat — new callers should use
// row-level ops instead.
export async function replaceAllEvents(events) {
  await ensureSchema();
  const pool = getPool();
  if (!pool) return 0;
  const incoming = Array.isArray(events) ? events.filter((e) => e && e.id != null) : [];
  return withTransaction(async (client) => {
    if (!incoming.length) {
      await client.query("DELETE FROM events");
      return 0;
    }
    const ids = incoming.map((e) => String(e.id));
    // Remove any row NOT in the incoming set
    await client.query("DELETE FROM events WHERE id <> ALL($1::text[])", [ids]);
    // Upsert the incoming rows
    for (const ev of incoming) {
      await client.query(
        `INSERT INTO events(id, data, updated_at) VALUES($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [String(ev.id), ev],
      );
    }
    return incoming.length;
  });
}

// Count-only check used by the migration path — the client only uploads
// its localStorage backup if the server is empty. Cheap; avoids serializing
// every row over the wire just to know whether to migrate.
export async function countEvents() {
  await ensureSchema();
  const pool = getPool();
  if (!pool) return 0;
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM events");
  return rows[0]?.n || 0;
}
