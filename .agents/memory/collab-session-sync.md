---
name: Collaborative session sync semantics
description: Design rules for the two-device review-session merge sync
---
Rule: review sessions merge via granular ops (server-side, advisory-locked per name); the client sends diffs against a last-known-server base and polls for partner changes.

**Why:** Whole-session PUT auto-save was last-write-wins — one phone silently clobbered the other. The user explicitly needs two people working in ONE session.

**How to apply:**
- Pending rows / vetted ids / approvals: full two-way merge by id.
- Calendar events: ADDITIONS sync both ways; edits and deletions of events never propagate (prevents Clear-All resurrection and stale-overwrite loops). Don't "fix" this by syncing event edits without also fixing reconcile — architect flagged that combo as a divergence loop.
- Postgres update() needs pg_advisory_xact_lock on the name; FOR UPDATE alone doesn't serialize concurrent creation of a missing row.
- Manual full-save (PUT) still overwrites; base must be cleared synchronously before switching sessions to avoid stale-base ops. Overwrite path now shows a strong warning confirm; if clobbering recurs, convert manual save to merge semantics.
- Backup history (added 2026-07-24): Postgres backend auto-snapshots the OLD session copy before overwrite (throttled 1/5min, newest 50 kept, `review_session_history`). Snapshot runs inside update()'s locked tx — MUST be wrapped in a SAVEPOINT, or any snapshot error poisons the tx and blocks the real save. Restore endpoint replays a snapshot through update() (so the current state gets snapshotted first). Reconcile's dirty branch must also append server-only additions (not in local/prevBase/snapAtFlush) or a restore gets diffed back out as removePending.
- Tombstones (added 2026-07-24): diff sync can't tell "partner deleted" from "locally added" without them. Client persists last-known server pending ids per session in localStorage (`cge-review-base-ids:<name>`); auto-load drops local-only rows that were in that set, and reconcile's dirty branch applies server removals to local pending/approvals. Deletion wins over concurrent local edits by design. Skipping this resurrects a partner's sweep deletions.
