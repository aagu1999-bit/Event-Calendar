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

// Scraper → Review handoff. ScraperReview stages a batch of events here
// before navigating to /review. ReviewQueue's mount effect calls
// consumeIntake() — reads + clears — so a refresh on /review won't
// re-import the same events twice. NOT persisted across page reloads
// (same one-shot semantics as useRestoreStore above). Per-event mapping
// from the Weekend_Review row shape to Event-Calendar's internal event
// shape happens in ScraperReview; this store just shuttles the already-
// mapped events between pages.
export const useScraperIntakeStore = create((set, get) => ({
  events: [],
  setEvents: (events) => set({ events: Array.isArray(events) ? events : [] }),
  consumeIntake: () => {
    const e = get().events;
    if (!e || e.length === 0) return [];
    set({ events: [] });
    return e;
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
      // When alternateColors is on, every odd-indexed carousel slide
      // overrides its bgKey to this value. Default purple — gives a
      // strong coral-vs-purple rhythm against the typical black primary.
      // User can pick from MediaTool's BG_COLORS palette in Brand Kit.
      alternateBgKey: "purple",

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

      // Slide Content Rules — per-slot prompts the AI Slide Generator uses
      // to fill Cover and CTA slides. Editable in Brand Kit. Defaults are
      // strong CGE editorial starting points; the user can tighten any of
      // them as they learn what works.
      slotPrompts: {
        cover: `Generate an eye-catching EDITORIAL headline for a CGE social media carousel Cover slide.

Requirements:
- Use a historical/contextual hook when possible. Pick whichever fits the topic:
    1. ANNIVERSARY ("Five years since...", "On this weekend in 2019...")
    2. SEASONAL ("First weekend of summer in NJ", "Last chance before...")
    3. SCENE-HISTORY ("The Newark warehouse scene resurfaces...")
- 4-8 words MAX on the main headline.
- News-headline framing — NOT event-flyer language.
- Garden State / NJ named or implied up front when relevant.
- Optional X/Y contrast structure ("Tired of X. Try Y.").
- Subtitle: 1 short line (8-15 words) that grounds the headline.
- Pick ONE accentWord — the most editorially-charged word from the headline (the one Gemini judges as the strongest verb/noun). This word will render in the brand accent color.

Return JSON ONLY in this exact shape (3 different variations):
{"options":[{"headline":"...","subtitle":"...","accentWord":"..."},{...},{...}]}`,

        text: `Generate a TEXT-slide manifesto paragraph for a CGE editorial carousel.

Requirements:
- 2-4 short paragraphs, NOT one long block.
- Editorial register — like a news column lede, NOT an event flyer.
- Three-beat sentences are a signature ("Dates, times, venues." / "Pickleball. Bachata. Speed dating.").
- X/Y contrast structure welcome ("Knowing about an event and feeling an event are two different things.").
- Garden State / NJ named or implied up front when relevant.
- Match the brand voice precisely.
- The textTitle is a short kicker (3-7 words) that names what the paragraph is about; can echo the Cover.

Return JSON ONLY in this exact shape:
{"textTitle":"...","textBody":"...paragraph 1...\\n\\n...paragraph 2..."}`,

        spotlight: `Generate ONE Spotlight-slide card for a CGE carousel.

The Spotlight is a single venue, idea, or selling-point. In a Feature Drop carousel (listicle), N Spotlights stack as numbered ideas (Music, Dance, Game, Prizes...). In an Editorial Roundup, Spotlights are scene-report style venue listings.

Requirements:
- spotName: 2-5 word headline naming this idea/venue (e.g. "Epic Music", "Game On", "Rooftop Night at the Standard").
- spotMeta: 1 short line of detail (address, by-line, or one-sentence explanation). 8-15 words max.
- spotTime: day + time line (or season). Optional — leave blank if not applicable.
- spotPrice: price or empty.
- spotCta: short call ("tix in bio", "free", "RSVP") or empty.
- Match the brand voice — editorial framing, NOT promo hype.

Return JSON ONLY in this exact shape:
{"spotName":"...","spotMeta":"...","spotTime":"...","spotPrice":"...","spotCta":"..."}`,

        photo: `Generate ONE caption + sub-caption pair for a CGE recap Photo slide.

The photo itself shows the vibe — your caption NAMES the specific moment so the slide reads as documentation, not generic hype.

Requirements:
- caption: 4-10 word phrase naming ONE concrete moment. NOT a feeling word. ("The 9PM crowd before the rain" — not "amazing vibes")
- captionSecondary: short uppercase location + time tag, or empty.
- Past tense. The event already happened.
- Match brand voice (specific, editorial, three-beat sentences welcome).

Return JSON ONLY in this exact shape:
{"caption":"...","captionSecondary":"..."}`,

        stat: `Generate ONE quantitative bragging beat for a CGE recap Stat slide.

Requirements:
- statNumber: short — a number, count, or short string ("200+", "4", "$1.2K"). NO sentence.
- statLabel: 2-4 word uppercase headline naming what the number measures. ("ROOFTOP HEADS", "COUNTIES REPPED")
- statSub: ONE short sentence (8-15 words) grounding the number — geography, duration, context. Never sales.

Return JSON ONLY in this exact shape:
{"statNumber":"...","statLabel":"...","statSub":"..."}`,

        cta: `Generate editorial CTA copy for a CGE carousel CLOSER slide.

Requirements:
- Soft invitation, NEVER "RSVP NOW!!!" or hype.
- Reference the link directly or imply "link in bio" naturally.
- Community/curatorial framing — "stand with the scene", "pull up", "honor the day".
- Match the brand voice (editorial, NJ-first, three-beat sentences welcome).
- Structure:
    · kicker: 1-3 word pill (e.g. "LINK IN BIO", "FULL LIST", "STAY TUNED")
    · mainLine: 3-7 word bold statement
    · subLine: 1 short sentence (8-15 words)

Return JSON ONLY in this exact shape (3 different variations):
{"options":[{"kicker":"...","mainLine":"...","subLine":"..."},{...},{...}]}`,
      },

      // Setters — accept either a value or a function (parity with React setState)
      setPalette: (p) => set((s) => ({
        palette: typeof p === "function" ? p(s.palette) : { ...s.palette, ...p },
      })),
      setAlternateColors: (v) => set({ alternateColors: !!v }),
      setAlternateBgKey: (k) => set({ alternateBgKey: String(k || "purple") }),
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
      setSlotPrompt: (slot, text) => set((s) => ({
        slotPrompts: { ...s.slotPrompts, [slot]: String(text || "") },
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
        alternateBgKey: "purple",
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
// Per-slot reference metadata — augments the user-editable slotPrompts
// strings with concrete examples + anti-patterns Gemini uses to model
// good output. These are NOT user-editable (rules are); they're the
// "this is what good looks like" reference layer.
//
// Shape:
//   audience    — who reads THIS slot specifically (cover scrollers vs
//                 CTA-clickers — different mindset, different copy)
//   examples    — 2-3 sample outputs in the exact JSON shape, modeling
//                 quality + voice. Drives output style harder than any
//                 amount of "be editorial" prose.
//   antiPatterns — explicit "never do this" beats. Each entry is a
//                 short sentence Gemini can pattern-match against.
export const SLOT_META = {
  cover: {
    audience: "Someone scrolling Instagram who sees the cover for 1.5 seconds. The headline either earns the tap or doesn't. Treat like a magazine cover line, not a flyer.",
    examples: [
      `{"headline":"GARDEN STATE, JUNETEENTH WEEKEND","subtitle":"Five ways to mark it across NJ — Newark to AC.","accentWord":"JUNETEENTH"}`,
      `{"headline":"THE NEWARK ROOFTOP IS BACK","subtitle":"Standard Hotel opens Friday. Bachata 8, social 9, no cover.","accentWord":"ROOFTOP"}`,
      `{"headline":"FIVE YEARS SINCE THIS SCENE EXISTED","subtitle":"Warehouse parties resurface in Newark, on the right side of the law.","accentWord":"WAREHOUSE"}`,
    ],
    antiPatterns: [
      "Never write 'Join us!', 'Don't miss out!', 'You won't want to miss this' — flyer language, not editorial.",
      "Don't open with the venue name — open with the news beat. Venue can land in the subtitle.",
      "Avoid emojis in the headline. The accent color does the visual lift.",
      "If the headline doesn't say something true even without the accent color, it's too weak.",
    ],
  },
  text: {
    audience: "The reader who tapped past the cover and now wants the thesis. They'll read 30 seconds max — make every line a beat.",
    examples: [
      `{"textTitle":"FIVE WAYS TO MARK IT","textBody":"Juneteenth doesn't need a flyer. It needs a frame.\\n\\nDates, times, venues. Pickleball. Bachata. A cookout in Branch Brook. Knowing about an event and feeling an event are two different things. This list is the second kind."}`,
      `{"textTitle":"THE SCENE, RANKED","textBody":"Not every weekend gets a ranking. This one does.\\n\\nFive parties. Four counties. One reason to leave the apartment. The Garden State did the work; we wrote it down."}`,
    ],
    antiPatterns: [
      "Don't summarize the carousel — set the thesis. Lists go in the CTAs/Spotlights.",
      "Avoid 'In this carousel we will…' meta-talk. Write as if no carousel exists.",
      "Single huge paragraphs are wrong — break into 2-4 short paragraphs.",
    ],
  },
  spotlight: {
    audience: "Someone weighing whether THIS specific feature/venue is worth caring about. Show, don't sell.",
    examples: [
      `{"spotName":"ROOFTOP NIGHT AT THE STANDARD","spotMeta":"9 Clinton St, Newark · cocktails + bachata under sky","spotTime":"Friday · 8 PM","spotPrice":"$30","spotCta":"tix in bio"}`,
      `{"spotName":"LIVE 5-PIECE BAND","spotMeta":"No backing tracks. Real horns, real percussion, real heat.","spotTime":"","spotPrice":"","spotCta":""}`,
      `{"spotName":"BACHATA DANCING","spotMeta":"Beginner-friendly. Lessons 8-9, social 9-late.","spotTime":"","spotPrice":"","spotCta":""}`,
    ],
    antiPatterns: [
      "Don't repeat across Spotlights in the same carousel — each must cover a DIFFERENT angle.",
      "Avoid empty hype words: 'amazing', 'incredible', 'unforgettable'. Name the concrete thing instead.",
      "If spotTime/spotPrice/spotCta don't apply to this feature, leave them blank — don't pad with 'TBA'.",
    ],
  },
  photo: {
    audience: "Reader scrolling through a recap or photo-led carousel. The image shows the vibe; your caption NAMES the moment.",
    examples: [
      `{"caption":"The 9PM crowd, before the rain.","captionSecondary":"NEWARK · JUNE 14"}`,
      `{"caption":"The bachata lesson, all four counts.","captionSecondary":"ROOFTOP · 8 PM"}`,
      `{"caption":"Right when the horn section came in.","captionSecondary":""}`,
    ],
    antiPatterns: [
      "Never write 'great night', 'amazing vibes', 'so much fun' — those are reactions, not moments.",
      "Don't describe what's in the photo; name what the photo was OF (a moment, not a frame).",
      "Sub-caption: location + time or context tag, never sales copy.",
    ],
  },
  stat: {
    audience: "Reader near the end of a recap — give them the bragging beat. ONE number, one short label, one grounding line.",
    examples: [
      `{"statNumber":"200+","statLabel":"ROOFTOP HEADS","statSub":"Newark · 6 hours · 0 spills."}`,
      `{"statNumber":"4","statLabel":"COUNTIES REPPED","statSub":"Hudson, Essex, Union, Passaic — one rooftop."}`,
      `{"statNumber":"$1.2K","statLabel":"RAISED FOR THE FUND","statSub":"Every door dollar went straight in."}`,
    ],
    antiPatterns: [
      "Don't pick a generic stat — 'over 100 people' is not a beat, '127' is.",
      "Label must be 2-4 words MAX, all caps, no filler.",
      "Sub line is one sentence — grounding context, never marketing.",
    ],
  },
  cta: {
    audience: "Someone at the end of the carousel deciding whether to tap the link. Don't beg, just open the door.",
    examples: [
      `{"kicker":"LINK IN BIO","mainLine":"Full list, dates, RSVPs","subLine":"Pull up to the one that fits your weekend. We did the curating."}`,
      `{"kicker":"FULL DIRECTORY","mainLine":"All five events, mapped","subLine":"Tap through, save the ones you want, share with the friend who needs it."}`,
      `{"kicker":"","ctaDate":"AFROBEATS ROOFTOP","ctaVenue":"The Standard · Fri · 9PM","ctaUrl":"@thestandardnewark"}`,
    ],
    antiPatterns: [
      "Never write 'RSVP NOW', 'DON'T MISS', 'LIMITED SPOTS' — that's flyer panic, not editorial closer.",
      "Avoid generic 'see you there' — be specific about WHAT the reader does next.",
      "When CTA is a directory listing (multi-CTA template), kicker must be empty — event name carries the slot.",
    ],
  },
};

export const BUILTIN_CAROUSEL_TEMPLATES = [
  {
    id: "editorial-roundup",
    name: "Editorial Roundup",
    intent: "Holiday coverage, weekend guides, scene reports. Cover + manifesto Text, then 5× CTA cards (one per event in the roundup — kicker/date/venue/URL).",
    audience: "NJ locals scrolling for what to do this weekend — they want a curated directory, not a single pitch.",
    tone: "Newsy editor voice. Garden State up front. 3-beat sentences, X/Y contrasts. The cover frames the weekend, the manifesto sets a thesis, the CTAs are the directory listings.",
    bestFor: "Multi-event roundups (3+ distinct events), themed weekends, holiday coverage, 'what's on' guides.",
    notFor: "Single events (use Feature Drop), post-event recaps (use Recap), abstract topic posts with no events.",
    keyMove: "Cover frames the weekend → Text manifestos the thesis → each CTA is ONE event as a directory card (event name = big-bold ctaDate slot, venue/day/time = ctaVenue, url = ctaUrl, kicker stays blank).",
    example: "Cover: 'Garden State, Juneteenth Weekend.' Text title: 'Five Ways To Mark It.' CTA 1: kicker='', ctaDate='AFROBEATS ROOFTOP', ctaVenue='The Standard · Fri · 9PM', ctaUrl='@thestandardnewark'.",
    sequence: ["cover", "text", "cta", "cta", "cta", "cta", "cta"],
  },
  {
    id: "feature-drop",
    name: "Feature Drop",
    intent: "Single event with multiple selling points. Numbered Spotlights work well here.",
    audience: "People already half-sold on the topic, deciding whether to tap RSVP — show them six reasons.",
    tone: "Confident, specific, slightly hype. Each Spotlight names one concrete feature; no fluff.",
    bestFor: "ONE event with 4-6 distinct selling points (DJ + drinks + dress code + giveaway + activity + venue charm). Pickleball Nights / Roof Party / Series launches.",
    notFor: "Multiple events (use Editorial Roundup), simple announcements with one beat (use Single Beat).",
    keyMove: "Cover sets the event, every Spotlight is a DIFFERENT selling-point angle (DON'T repeat), final CTA seals with date/venue/link. Spotlights are NOT mini-listings — they're feature highlights of the SAME event.",
    example: "Cover: 'BACHATA × ROOFTOP. JUNE 28.' Spotlight 1: 'LIVE 5-PIECE BAND' / 'No backing tracks. Real horns, real percussion.' Spotlight 2: 'BACHATA DANCING' / 'Beginner-friendly. Lessons 8-9, social 9-late.' …",
    sequence: ["cover", "spotlight", "spotlight", "spotlight", "spotlight", "spotlight", "spotlight", "cta"],
  },
  {
    id: "list-tour",
    name: "List Tour",
    intent: "Themed lists — watch parties, openings, weekly drops. Curator register.",
    audience: "Locals + visitors who trust CGE to do the curating — they want '5 places to', not 'one place'.",
    tone: "Curatorial, opinionated, place-confident. Each Spotlight names a venue + says what makes IT specifically the call.",
    bestFor: "Curated venue/place lists (5 rooftops, 4 watch parties, 6 weekend openings). Each Spotlight = one PLACE, not one feature of the same place.",
    notFor: "Single events (Feature Drop), multi-event weekend directories (Editorial Roundup — has more CTA scaffolding).",
    keyMove: "Poster sets the visual thesis, each Spotlight is ONE venue + one detail that makes that venue THE pick. Treat like a critic's shortlist, not a marketing list.",
    example: "Poster: 'WORLD CUP IN NJ. 5 PLACES TO WATCH.' Spotlight 1: 'THE STANDARD' / 'Big screen, no cover, packed but bearable.' Spotlight 2: 'BAR LOFT' / 'Smaller crowd, full menu running through the game.' …",
    sequence: ["poster", "spotlight", "spotlight", "spotlight", "spotlight", "spotlight", "cta"],
  },
  {
    id: "single-beat",
    name: "Single Beat",
    intent: "Partner spotlight, one-image scene report. Cover + optional Text.",
    audience: "Followers scrolling fast — one striking image + one strong line. No carousel commitment.",
    tone: "Distilled, punchy. One headline doing all the work. Treat the cover like a magazine cover line.",
    bestFor: "Partner spotlights, scene reports, single-image announcements, news shares. When you have ONE strong photo + one strong line.",
    notFor: "Anything that needs sequencing, multiple events, multiple selling points, or a story arc.",
    keyMove: "Headline must work as a standalone — 8 words or fewer, ideally a noun-verb-place beat. The image carries half the weight.",
    example: "Cover only — headline: 'THE NEWARK ROOFTOP IS BACK.' subtitle: 'Standard Hotel · opens Friday'.",
    sequence: ["cover"],
  },
  {
    id: "recap",
    name: "Recap",
    intent: "Post-event content. Photos + captions + headline stat.",
    audience: "People who DID NOT come, plus people who did and want to relive it — bias toward the FOMO frame.",
    tone: "Slightly retrospective, image-led, warm. Captions name what happened in 1 line. Stat is the bragging beat.",
    bestFor: "Post-event coverage (the night after, the weekend after). When you have 3+ great photos and one quotable stat.",
    notFor: "Pre-event hype (use Feature Drop / Editorial Roundup), abstract topic posts.",
    keyMove: "Cover sets the event identity past-tense, Photo slides each NAME one moment (not 'fun night' — 'the bachata lesson at 9'), Stat lands the bragging beat ('200+ people / 6 hours / 0 spills'), CTA points to the next one.",
    example: "Cover: 'JUNETEENTH ROOFTOP. ONE NIGHT.' Photo 1 caption: 'The 9PM crowd before the rain.' Stat: number='200+' label='ROOFTOP HEADS' sub='Newark · 6 hours'. CTA: 'Next one — July 4 weekend.'",
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
