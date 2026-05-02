# CGE Tools

A React app bundling three event-marketing tools (Calendar, Newsletter, Reel)
for NJ Weekend Events (Central Group Events). All three tools share a single
event list — paste or upload once on any tool, render on all three.

## Architecture

- **Frontend**: React 18 + Vite (pure client-side, no backend)
- **Routing**: react-router-dom (`/calendar`, `/newsletter`, `/reel`)
- **Shared state**: Zustand store with localStorage persistence
  (events survive refreshes/crashes)
- **Package Manager**: npm
- **Key Libraries**:
  - `xlsx` — Excel/spreadsheet file parsing
  - `jszip` — ZIP file creation for bulk PNG downloads
  - `zustand` — shared events store
  - `react-router-dom` — routing

## Project Structure

```
/
├── index.html              # HTML entry point
├── vite.config.js          # Vite config (host: 0.0.0.0, port: 5000)
├── package.json
├── src/
│   ├── main.jsx            # React app entry point
│   ├── App.jsx             # Router + top nav + shared event-count badge
│   ├── store.js            # Zustand events store (persisted)
│   ├── index.css           # Global styles
│   └── pages/
│       ├── CalendarBuilder.jsx    # /calendar — slide PNG builder (V6)
│       ├── NewsletterBuilder.jsx  # /newsletter — newsletter HTML builder
│       └── ReelTool.jsx           # /reel — animated reel renderer
```

Each page reads `events` from the store and writes back via `setEvents`.
Importing on any page populates the others automatically. The "Clear all"
button in the top nav wipes events across every tool.

## Features

- Upload Excel/CSV files with event data (auto-detects columns)
- Manual event entry and editing
- Multi-day support (Fri/Sat/Sun)
- Region-based sorting (North → Central → South), flexible parsing of
  "North NJ", "Central Jersey", abbreviations, etc.
- Multiple color themes (Purple, Gold, Wine, Emerald, Yellow, Black)
- Multiple aspect ratios (4:5, 1:1, 9:16) on the Calendar tool
- Canvas-based PNG rendering at 1080px width
- Download individual slides as PNG or all as ZIP
- Week Preview mode with two-column layout

## Development

- Dev server: `npm run dev` → http://localhost:5000
- Build: `npm run build` → `dist/`

## Deployment

- Type: Static site
- Build command: `npm run build`
- Public directory: `dist`
