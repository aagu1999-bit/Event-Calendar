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

export const useEventsStore = create(
  persist(
    (set, get) => ({
      events: [],
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
      clearEvents: () => set({ events: [] }),
    }),
    {
      name: "cge-events",
      version: 1,
    }
  )
);
