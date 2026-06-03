# Session Handoff

Snapshot to carry context across devices / Claude Code sessions.
Commit + push this file, then on the other device: clone, open in VS Code,
start Claude Code, and ask it to read this file first.

**Last updated:** 2026-05-29

---

## Repo

- GitHub: https://github.com/aagu1999-bit/Event-Calendar
- Local clone (this device): `/Users/owner/Event-Calendar`
- Branch: `main`
- Last commit at handoff: `7e4e4f6` — Auto-uppercase inputs, auto Friday date, direct-add + bulk-select across tabs

> Note: the repo `aagu1999-bit/After5` is empty and unused. The real project is `Event-Calendar`.

## What this project is

CGE Tools — a single React + Vite app bundling event-marketing tools for
NJ Weekend Events (Central Group Events). Pure client-side, no backend.

Pages (`src/pages/`):
- `CalendarBuilder.jsx` — `/calendar`, slide PNG builder
- `NewsletterBuilder.jsx` — `/newsletter`, HTML builder
- `ReelTool.jsx` — `/reel`, animated reel renderer
- `FlyerBuilder.jsx`, `MediaTool.jsx`, `RecapPicker.jsx`, `Regulars.jsx`, `ReviewQueue.jsx`

Shared state: Zustand store (`src/store.js`) persisted to localStorage —
importing events on any page populates all tools.

## Where things stand (recent direction)

Looking at the last ~20 commits, work has been clustered around:

1. **Review Queue** (v2 → v5) — friction reduction for the 96-flag curation
   step: inline edit, search, persisted collapse, sort-to-top on click,
   bulk-actions, contrast fix.
2. **Weekly Regulars** flow — master-sheet importer + detection engine,
   un-add toggle, used tracking, lastSeen sync, never-used filter,
   bulk add, manual add, edit.
3. **Cross-tab input ergonomics** (latest) — auto-uppercase, auto Friday
   date, direct-add, bulk-select across tabs.

## Pick up here (fill this in before committing)

> Edit this section to capture whatever's actually next. Examples:
> - bug seen but not fixed
> - feature half-designed in chat
> - decision needed
> - thing to test on the dev server

- [ ] _what are you actually trying to do next?_
- [ ] _any blockers or open questions?_
- [ ] _files you were touching / planned to touch:_

## How to run

```
cd /Users/owner/Event-Calendar   # or wherever you clone it on the other device
npm install
npm run dev                      # http://localhost:5000
```

## Cross-device workflow (the reason this file exists)

1. On device A: edit `Pick up here` above with your real next steps, commit, push.
2. On device B: pull, open in VS Code, start Claude Code, point it at this file.
3. When you switch back to device A: pull again before working.

Memory in `~/.claude/` does **not** sync across machines unless you sync that
folder yourself. This file in the repo is the portable context.
