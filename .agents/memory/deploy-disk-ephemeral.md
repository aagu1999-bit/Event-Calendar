---
name: Deploy disk is ephemeral
description: Why user data must never live on the deployment filesystem for this app
---
Rule: any server-side user data (review sessions, saved state) must be stored in PostgreSQL, not on disk.

**Why:** On July 24, 2026, a republish wiped the production deployment's filesystem, destroying the user's saved review sessions (including a 175-event reviewed batch that could not be recovered). Replit DB (REPLIT_DB_URL) is also not available in GCE deployments — the store's Replit DB path silently fell back to filesystem in prod.

**How to apply:** Session storage now prefers DATABASE_URL (Postgres `review_sessions` table, JSONB) over Replit DB/filesystem, with best-effort legacy migration. Any new server-side persistence should follow the same pattern. Health endpoint reports `sessionBackend` — in prod it must say "postgres" after a publish.
