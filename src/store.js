import { create } from "zustand";
import { persist } from "zustand/middleware";

export const useEventsStore = create(
  persist(
    (set) => ({
      events: [],
      setEvents: (events) =>
        set({ events: typeof events === "function" ? events([]) : events }),
      updateEvents: (updater) =>
        set((state) => ({
          events: typeof updater === "function" ? updater(state.events) : updater,
        })),
      clearEvents: () => set({ events: [] }),
    }),
    {
      name: "cge-events",
      version: 1,
    }
  )
);
