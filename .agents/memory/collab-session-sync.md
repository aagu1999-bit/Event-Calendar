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
- Manual full-save (PUT) still overwrites; base must be cleared synchronously before switching sessions to avoid stale-base ops.
