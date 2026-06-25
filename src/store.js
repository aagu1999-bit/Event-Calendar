import { create } from "zustand";
import { persist } from "zustand/middleware";

// Restore handoff — Library page stuffs a snapshot here before navigating
// to a tool route. Tools call consumeRestore() once on mount to apply +
// clear, so a refresh won't re-apply the same snapshot. NOT persisted
// across reloads (deliberate — clicking Edit is a one-shot action).
export const useRestoreStore = create((set, get) => ({
  pending: null,        // { tool: "calendar" | "media" | "flyer", snapshot: {...} }
  setPending: (p) => set({ pending: p }),
  consumeRestore: (tool) => {
    const p = get().pending;
    if (!p || p.tool !== tool) return null;
    set({ pending: null });
    return p.snapshot;
  },
}));

const dedupeKey = (e) =>
  [
    e.day || "",
    String(e.name || "").trim().toLowerCase(),
    String(e.venue || "").trim().toLowerCase(),
    String(e.time || "").trim().toLowerCase(),
  ].join("|");

// Weekly Regulars store — pre-aggregated recurring events derived from the
// master sheet. Kept separate from the events store: different lifecycle
// (imported once, reviewed over time) and isolates them from "Clear all".
export const useRegularsStore = create(
  persist(
    (set, get) => ({
      regulars: [],
      lastImport: null, // ISO timestamp of last master-sheet import
      stats: null,      // last detection stats { parsed, skipped, qualified, byFlag }
      replaceAll: (regulars, stats) => set({
        regulars,
        stats,
        lastImport: new Date().toISOString(),
      }),
      addManual: (reg) => set(state => ({ regulars: [...state.regulars, { ...reg, source: "manual" }] })),
      updateRegular: (id, patch) => set(state => ({
        regulars: state.regulars.map(r => r.id === id ? { ...r, ...patch } : r),
      })),
      removeRegular: (id) => set(state => ({ regulars: state.regulars.filter(r => r.id !== id) })),
      reject: (id) => set(state => ({
        regulars: state.regulars.map(r => r.id === id ? { ...r, rejected: true } : r),
      })),
      restore: (id) => set(state => ({
        regulars: state.regulars.map(r => r.id === id ? { ...r, rejected: false } : r),
      })),
      clearAll: () => set({ regulars: [], lastImport: null, stats: null }),
    }),
    {
      name: "cge-regulars",
      version: 1,
    }
  )
);

// Brand Kit — centralized brand identity that every tool reads from.
// This is the "Reactive Core State Object" pattern: instead of each
// template hardcoding "#E5BC4F" / "CGE" / "centralgroupevents.com",
// they read from here. Changing a value here ripples to every tool.
//
// Categories:
//   palette        — brand colors (background, text, accent)
//   alternateColors — whether to swap bg/accent every other slide
//   fontPairKey    — default Syne+DM Sans, etc. (matches MediaTool's FONT_PAIRS)
//   creator        — the brand's identity: name, handle, watermark text, URL
//   defaults       — category tag presets, region (for Cover/News templates)
//   voice          — Phase 2: voice description + exemplar captions (Gemini)
export const useBrandStore = create(
  persist(
    (set, get) => ({
      // Visual identity
      palette: {
        background: "#0a0a0a",   // legacy default
        text: "#F5F0E8",          // legacy ivory
        accent: "#E5BC4F",        // legacy gold
      },
      alternateColors: false,

      // Typography — matches FONT_PAIRS keys in MediaTool
      fontPairKey: "default",     // "default" | "bold" | "serif" | "modern"

      // Creator / brand identity — watermarks read from here
      creator: {
        brandName: "Central Group Events",
        handle: "@centralgroupevents",
        logoText: "CGE",          // the letters in the circle
        url: "centralgroupevents.com",
        showWatermark: true,
      },

      // Defaults that templates seed from
      defaults: {
        categoryTagPresets: ["WEEKEND GUIDE", "EVENT DROP", "TONIGHT", "SCENE REPORT"],
        defaultCategoryTag: "EVENT DROP",
        region: "NJ",
      },

      // Voice fingerprint — Phase 2 (textareas exist but no Gemini wiring yet)
      voice: {
        description: "",          // e.g. "Editorial, NJ-first, news-headline framing"
        exemplars: [],            // array of past captions for Gemini priming
      },

      // Setters — accept either a value or a function (parity with React setState)
      setPalette: (p) => set((s) => ({
        palette: typeof p === "function" ? p(s.palette) : { ...s.palette, ...p },
      })),
      setAlternateColors: (v) => set({ alternateColors: !!v }),
      setFontPairKey: (k) => set({ fontPairKey: k }),
      setCreator: (c) => set((s) => ({
        creator: typeof c === "function" ? c(s.creator) : { ...s.creator, ...c },
      })),
      setDefaults: (d) => set((s) => ({
        defaults: typeof d === "function" ? d(s.defaults) : { ...s.defaults, ...d },
      })),
      setVoice: (v) => set((s) => ({
        voice: typeof v === "function" ? v(s.voice) : { ...s.voice, ...v },
      })),
      addExemplar: (caption) => set((s) => ({
        voice: { ...s.voice, exemplars: [...s.voice.exemplars, String(caption || "").trim()].filter(Boolean) },
      })),
      removeExemplar: (idx) => set((s) => ({
        voice: { ...s.voice, exemplars: s.voice.exemplars.filter((_, i) => i !== idx) },
      })),
      resetToDefaults: () => set({
        palette: { background: "#0a0a0a", text: "#F5F0E8", accent: "#E5BC4F" },
        alternateColors: false,
        fontPairKey: "default",
        creator: {
          brandName: "Central Group Events",
          handle: "@centralgroupevents",
          logoText: "CGE",
          url: "centralgroupevents.com",
          showWatermark: true,
        },
        defaults: {
          categoryTagPresets: ["WEEKEND GUIDE", "EVENT DROP", "TONIGHT", "SCENE REPORT"],
          defaultCategoryTag: "EVENT DROP",
          region: "NJ",
        },
        voice: { description: "", exemplars: [] },
      }),
    }),
    {
      name: "cge-brand-kit",
      version: 1,
    }
  )
);

// Built-in carousel template archetypes — sequences of slide types that
// match patterns the user has already proven work. NOT user data — these
// are reference patterns. User custom templates live in useCarouselTemplatesStore.
//
// Each archetype maps to one of CGE's established post structures:
//   editorial-roundup — Juneteenth pattern (manifesto + numbered scene reports)
//   feature-drop      — Pickleball Nights pattern (event with multiple selling points)
//   list-tour         — World Cup watch parties pattern (themed list of locations)
//   single-beat       — Running club pattern (one-image partner spotlight)
//   recap             — post-event recap (cover + photo captions + stat)
export const BUILTIN_CAROUSEL_TEMPLATES = [
  {
    id: "editorial-roundup",
    name: "Editorial Roundup",
    intent: "Holiday coverage, weekend guides, scene reports. Literary register.",
    sequence: ["cover", "text", "spotlight", "spotlight", "spotlight", "spotlight", "spotlight", "cta"],
  },
  {
    id: "feature-drop",
    name: "Feature Drop",
    intent: "Single event with multiple selling points. Numbered Spotlights work well here.",
    sequence: ["cover", "spotlight", "spotlight", "spotlight", "spotlight", "spotlight", "spotlight", "cta"],
  },
  {
    id: "list-tour",
    name: "List Tour",
    intent: "Themed lists — watch parties, openings, weekly drops. Curator register.",
    sequence: ["poster", "spotlight", "spotlight", "spotlight", "spotlight", "spotlight", "cta"],
  },
  {
    id: "single-beat",
    name: "Single Beat",
    intent: "Partner spotlight, one-image scene report. Cover + optional Text.",
    sequence: ["cover"],
  },
  {
    id: "recap",
    name: "Recap",
    intent: "Post-event content. Photos + captions + headline stat.",
    sequence: ["cover", "photo", "photo", "photo", "stat", "cta"],
  },
];

// Carousel templates store — only user customs persist; built-ins are
// merged in at read-time from BUILTIN_CAROUSEL_TEMPLATES.
export const useCarouselTemplatesStore = create(
  persist(
    (set, get) => ({
      customs: [],
      addTemplate: (name, sequence) => {
        const trimmed = String(name || "").trim();
        if (!trimmed) return null;
        if (!Array.isArray(sequence) || !sequence.length) return null;
        const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const tpl = { id, name: trimmed, sequence: [...sequence], custom: true };
        set((state) => ({ customs: [...state.customs, tpl] }));
        return tpl;
      },
      removeTemplate: (id) => set((state) => ({
        customs: state.customs.filter((t) => t.id !== id),
      })),
      renameTemplate: (id, name) => set((state) => ({
        customs: state.customs.map((t) => t.id === id ? { ...t, name: String(name || "").trim() || t.name } : t),
      })),
    }),
    {
      name: "cge-carousel-templates",
      version: 1,
    }
  )
);

export const useEventsStore = create(
  persist(
    (set, get) => ({
      events: [],
      // Per-event "selected for inclusion" map { [eventId]: true }. Lifted
      // out of ReviewQueue's local useState so Review Sessions can save
      // and restore the user's checkbox state alongside the events.
      // Replaces the prior live-sync architecture (deleted) with explicit
      // save points.
      approvals: {},
      // Per-event "✓ vetted" stamp — distinct from `approvals` (which is
      // the checkbox SELECTION state for bulk actions). Stored as an
      // array because Sets don't survive Zustand's persist middleware
      // and the JSON sent to /api/review-sessions. ReviewQueue derives a
      // memoized Set from this on read; writes go through setVetted().
      vetted: [],
      setEvents: (events) =>
        set({ events: typeof events === "function" ? events([]) : events }),
      updateEvents: (updater) =>
        set((state) => ({
          events: typeof updater === "function" ? updater(state.events) : updater,
        })),
      // Append new events to the existing list, skipping duplicates of rows
      // already in the store (matched on day+name+venue+time).
      // Returns { added, skipped } so callers can show a toast.
      addEvents: (incoming) => {
        const list = Array.isArray(incoming) ? incoming : [];
        const existing = get().events;
        const seen = new Set(existing.map(dedupeKey));
        const toAdd = [];
        let skipped = 0;
        for (const ev of list) {
          if (!ev || !ev.name) continue;
          const k = dedupeKey(ev);
          if (seen.has(k)) { skipped++; continue; }
          seen.add(k);
          toAdd.push(ev);
        }
        if (toAdd.length) set({ events: [...existing, ...toAdd] });
        return { added: toAdd.length, skipped };
      },
      clearEvents: () => set({ events: [], approvals: {}, vetted: [] }),
      // Vetted actions — array-backed for serialization. Accept either
      // a new array or an updater function for parity with React's
      // setState pattern.
      setVetted: (vettedOrUpdater) =>
        set((state) => {
          const next = typeof vettedOrUpdater === "function"
            ? vettedOrUpdater(state.vetted)
            : vettedOrUpdater;
          return { vetted: Array.isArray(next) ? next : [] };
        }),
      // Approval actions — used by ReviewQueue's checkbox column.
      // Accepts either a new map or an updater function for parity with
      // the React setState pattern existing callers already use.
      setApprovals: (approvalsOrUpdater) =>
        set((state) => {
          const next = typeof approvalsOrUpdater === "function"
            ? approvalsOrUpdater(state.approvals)
            : approvalsOrUpdater;
          return { approvals: next && typeof next === "object" ? next : {} };
        }),
      toggleApproval: (id) =>
        set((state) => {
          const next = { ...state.approvals };
          if (next[id]) delete next[id];
          else next[id] = true;
          return { approvals: next };
        }),
      setApproval: (id, on) =>
        set((state) => {
          const next = { ...state.approvals };
          if (on) next[id] = true;
          else delete next[id];
          return { approvals: next };
        }),
      clearApprovals: () => set({ approvals: {} }),
      approveMany: (ids) =>
        set((state) => {
          const next = { ...state.approvals };
          for (const id of ids) next[id] = true;
          return { approvals: next };
        }),
    }),
    {
      name: "cge-events",
      version: 3,
      // Migration: ensure approvals + vetted keys exist on older state.
      migrate: (persistedState, version) => {
        if (!persistedState) return { events: [], approvals: {}, vetted: [] };
        const out = { ...persistedState };
        if (version < 2 && !out.approvals) out.approvals = {};
        if (version < 3 && !Array.isArray(out.vetted)) out.vetted = [];
        return out;
      },
    }
  )
);
