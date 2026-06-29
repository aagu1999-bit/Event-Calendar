// Brand Kit ↔ server sync. The brand store (palette, voice, slot
// prompts, etc.) used to live ONLY in browser localStorage — different
// browsers / accounts / devices each had their own copy. Now mirrored
// to a server JSON file (data/brand-kit.json on the Repl) so any
// browser hitting the same Repl URL gets the same brand kit on mount.
//
// Strategy:
//   1. On mount → GET /api/brand-kit. If server returns non-null,
//      hydrate the local store with server state. Server wins.
//   2. Subscribe to store changes → debounced PUT to server (800ms).
//      Skipped during hydration so the initial fetch doesn't trigger
//      a save-back loop.
//   3. localStorage still backs the store (Zustand persist middleware)
//      so the UI doesn't flash on cold start while the fetch resolves,
//      and offline edits remain visible until the next successful PUT.
//   4. All failures are silent — if the server is unreachable (static
//      build, network blip), localStorage carries on as before.

import { useEffect } from "react";
import { useBrandStore } from "../store";

// Single shared flag — subscribe()'s closure reads this. Set true
// during the initial fetch + hydration so saves don't fire as a
// reaction to our own hydration setState.
let isHydrating = true;

// Pull the persisted slice out of the full store state. Setters
// (functions on the store) are excluded — server doesn't want them.
function persistedSlice(state) {
  return {
    palette: state.palette,
    alternateColors: state.alternateColors,
    alternateBgKey: state.alternateBgKey,
    fontPairKey: state.fontPairKey,
    creator: state.creator,
    defaults: state.defaults,
    voice: state.voice,
    slotPrompts: state.slotPrompts,
  };
}

export function useBrandSync() {
  useEffect(() => {
    let live = true;
    let saveTimer = null;

    // Step 1 — fetch from server, hydrate if there's anything there.
    isHydrating = true;
    fetch("/api/brand-kit")
      .then((r) => (r.ok ? r.json() : null))
      .then((serverState) => {
        if (!live) return;
        if (serverState && typeof serverState === "object") {
          // Merge into existing store state so we don't blow away
          // store-only fields (setters) that aren't in the JSON.
          useBrandStore.setState((prev) => ({ ...prev, ...serverState }));
        }
        // Slight delay before flipping the flag — gives React a tick
        // to fan the setState through subscribers before we'd react
        // to it ourselves.
        setTimeout(() => { isHydrating = false; }, 50);
      })
      .catch(() => {
        isHydrating = false;
      });

    // Step 2 — debounced save on changes.
    const unsub = useBrandStore.subscribe((state) => {
      if (isHydrating) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const slice = persistedSlice(state);
        fetch("/api/brand-kit", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(slice),
        }).catch(() => { /* silent — localStorage still holds it */ });
      }, 800);
    });

    return () => {
      live = false;
      if (saveTimer) clearTimeout(saveTimer);
      unsub();
    };
  }, []);
}
