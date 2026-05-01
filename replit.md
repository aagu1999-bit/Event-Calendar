# CGE Calendar Builder

A React-based calendar slide builder for NJ Weekend Events (Central Group Events).

## Overview

Single-page React application that builds styled calendar graphics from uploaded event data. Users can import events via Excel/CSV, edit them manually, and export styled PNGs for social media use.

## Architecture

- **Frontend**: React 18 + Vite (pure client-side, no backend)
- **Package Manager**: npm
- **Key Libraries**: 
  - `xlsx` — Excel/spreadsheet file parsing
  - `jszip` — ZIP file creation for bulk PNG downloads

## Project Structure

```
/
├── index.html              # HTML entry point
├── vite.config.js          # Vite config (host: 0.0.0.0, port: 5000)
├── package.json
├── src/
│   ├── main.jsx            # React app entry point
│   ├── App.jsx             # Main component (CGE Calendar Builder V6)
│   └── index.css           # Global styles
```

## Features

- Upload Excel/CSV files with event data (auto-detects columns)
- Manual event entry and editing
- Multi-day support (Fri/Sat/Sun)
- Region-based sorting (North → Central → South)
- Multiple color themes (Purple, Gold, Wine, Emerald, Yellow, Black)
- Multiple aspect ratios (4:5, 1:1, 9:16)
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
