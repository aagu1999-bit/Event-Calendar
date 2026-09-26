// Slot Purpose Doctrine — v0.1
//
// The doctrine names what each slot IS FOR in the reader's journey.
// Every slot type answers four questions:
//
//   readerJob         — what the reader walks away with from this slide
//   successCriteria   — how we know the slide worked
//   inputRequirements — what the source material must provide for this
//                       slot to be pickable (arranger reads this)
//   antiPatterns      — what makes the slide feel wrong (writer + post-
//                       generation validator both read these)
//
// Three surfaces consume the doctrine:
//   1. buildTemplatePrompt (aiContent.js) quotes readerJob + antiPatterns
//      at the top of each per-slot instruction block, so the writer is
//      writing for a reader outcome, not a JSON shape.
//   2. The arranger's slot-picking logic reads inputRequirements to
//      reject slot types the source material can't support (e.g. a
//      Spotlight without any physical venue in the bullets).
//   3. detectSlotDoctrineViolations (aiContent.js) checks each returned
//      slide against its slot's antiPatterns and attaches warnings.
//
// Keep entries short. This file is the source of truth; when it grows,
// prompts grow, so brevity in the doctrine keeps prompt sizes tractable.

export const SLOT_DOCTRINE = {
  cover: {
    readerJob:
      "Stop the scroll and promise a tension worth resolving in the next 5-6 slides.",
    successCriteria:
      "Reader swipes to slide 2. The hook creates an itch that only the next slide can scratch.",
    inputRequirements: {
      // Cover always fires; there's no source-material gate.
      needs: [],
      description:
        "The POV + Cluster LENS + Emotion (drives tone). No source-material gate — cover always works.",
    },
    antiPatterns: [
      "Descriptive titles that name the topic instead of naming a tension (e.g. 'The Math Behind the Crowd' — that describes, doesn't provoke).",
      "Anchoring the cover on one specific venue or entity — makes slides 2-5 feel like non-sequiturs.",
      "Marketing tropes: 'Here's why', 'The real story', 'Everything you know is wrong', 'Let's talk about'.",
      "Filling headline with the POV verbatim instead of compressing it into a hook.",
    ],
  },

  news: {
    readerJob:
      "Zoom out. Deliver a wider frame the reader hadn't considered, so the spotlights and stats that follow land harder.",
    successCriteria:
      "Reader thinks 'huh, didn't know that mattered.' A bigger loop opens under the cover's tension.",
    inputRequirements: {
      needs: ["framingContext"],
      description:
        "A framing / context-role bullet AND a tension the argument depends on. Not a proof bullet — that belongs on a spotlight or stat.",
    },
    antiPatterns: [
      "Scaffolding kickers: 'THE BIGGER PICTURE', 'THE STORY', 'THE CONTEXT', 'THE FRAME'. These are labels, not eyebrows.",
      "Recap of the cover with no new frame added.",
      "Missing the payoff line — news slot ends on ONE asterisk-wrapped bold beat.",
      "Body that reads like an introduction to the piece instead of a beat within it.",
    ],
  },

  spotlight: {
    readerJob:
      "Give the reader ONE specific place they could actually go, or thing they could do. A card they'd add to their weekend list.",
    successCriteria:
      "Reader could screenshot this slide and open Maps or their calendar. Name + where + when/price = a real, actionable thing.",
    inputRequirements: {
      // Must have EITHER a location signal OR a time/price signal in
      // the source material. Both is ideal.
      needs: ["physicalVenue", "actionableDetail"],
      description:
        "MUST have one of {physical venue name, address, cross-street} AND one of {time/date, price, contact}. If neither the source nor the reserved PROOF bullet supplies both classes of signal, the arranger should NOT pick this slot type.",
    },
    antiPatterns: [
      "Pricing without a venue: 'VENDOR BOOTHS / $275 single-item, $450 food trucks' — that names a fee, not a place.",
      "Abstract concept as spotName: 'THE INVISIBLE ARCHITECTURE', 'THE HIDDEN MATH'.",
      "spotMeta used as description ('a full-day festival celebrating community') instead of location ('207 Main St., Whitesboro').",
      "A pattern, rule, or systemic claim substituted for a physical place.",
    ],
  },

  stat: {
    readerJob:
      "Land ONE number that makes the systemic claim memorable. The line a reader repeats to a friend later.",
    successCriteria:
      "Reader remembers the number after closing the app. Would say 'did you know...' out loud.",
    inputRequirements: {
      needs: ["specificNumber"],
      description:
        "One specific numeric fact from the source (a metric, cap, percentage, price, count). A label naming what the number measures. A sub that gives the 'so what'.",
    },
    antiPatterns: [
      "Multi-number stack ($275 AND $450 AND 9 vendors) — splits attention; pick the strongest.",
      "Generic statLabel: 'Cost', 'Amount', 'Number' — the label must name what specifically is being measured.",
      "statSub that repeats the label instead of naming the implication.",
      "A fabricated number the source didn't provide.",
    ],
  },

  text: {
    readerJob:
      "Deliver the systemic argument in one beat. Make the reader feel the pattern is real.",
    successCriteria:
      "Reader nods. Recognizes something they'd felt but hadn't put words to.",
    inputRequirements: {
      needs: ["causalChain"],
      description:
        "The causal chain (rule → response) from the spine's causalSynthesis; the specific mechanism the argument depends on.",
    },
    antiPatterns: [
      "Meta-writing: 'This is the pattern you've felt but never had a word for', 'This is how events happen', 'This piece names…', 'This is the invisible architecture of…'. Any self-reference to the piece/post/carousel/reader.",
      "POV restated verbatim.",
      "Manifesto pileup — 5+ short sentences banging the same point.",
      "LENS-vocabulary showing through in the copy: 'spreadsheet', 'math', 'logistics', 'infrastructure' belong in the model's reasoning, not the delivery.",
    ],
  },

  cta: {
    readerJob:
      "Give the reader ONE specific thing to do next. A door, not a menu.",
    successCriteria:
      "Reader knows exactly what action to take. Zero ambiguity.",
    inputRequirements: {
      // CTA is always pickable at the end; keyword trigger stitching
      // handles the fallback content when the source doesn't specify.
      needs: [],
      description:
        "A specific URL or keyword trigger; a date/venue when applicable. Fallback content is stitched deterministically from the keyword trigger, so this slot always fires.",
    },
    antiPatterns: [
      "'Link in bio' without saying what the link IS.",
      "Multiple asks stacked into one CTA.",
      "Generic kicker: 'READY?', 'JOIN US', 'DON'T MISS'.",
      "ctaVenue set to a state or region ('New Jersey') instead of an actual location.",
    ],
  },
};

// Compact one-liner used inside prompts — quotes readerJob + top
// anti-patterns without ballooning the prompt with the full doctrine.
// The writer sees this at the top of each per-slot instruction block
// so the model writes for the reader outcome, not the JSON shape.
export function formatSlotDoctrineForPrompt(slotType) {
  const entry = SLOT_DOCTRINE[slotType];
  if (!entry) return "";
  const antiTop = entry.antiPatterns.slice(0, 3).map((a) => `  - ${a}`).join("\n");
  return [
    `SLOT PURPOSE — ${slotType.toUpperCase()}`,
    `  Reader Job: ${entry.readerJob}`,
    `  Success: ${entry.successCriteria}`,
    `  Do NOT:`,
    antiTop,
  ].join("\n");
}

// Compiled anti-pattern token detectors — the post-generation
// validator reads these to flag doctrine violations in returned
// copy. Each detector is a { type, re, message } row. Kept per-slot
// so a token that's fine in one slot (e.g. "$450" is fine as a stat
// number, banned as the sole content of a spotName) isn't over-
// flagged elsewhere.
export const SLOT_ANTIPATTERN_TOKENS = {
  cover: [
    { field: "headline", re: /^(here'?s why|the real (story|reason)|everything you know)/i, message: "Marketing trope in cover headline." },
  ],
  news: [
    { field: "newsKicker", re: /^(the (bigger picture|story|context|frame))$/i, message: "Scaffolding kicker instead of an eyebrow." },
  ],
  spotlight: [
    // spotName must be a proper-noun physical entity — reject pure
    // abstract concepts. Heuristic: if the spotName is fully
    // uppercase AND contains any of these abstract words, flag.
    { field: "spotName", re: /^(THE\s+)?(INVISIBLE|HIDDEN|REAL|SECRET|UNSEEN)\s+(ARCHITECTURE|MATH|STORY|LOGIC|PATTERN|NETWORK)/i, message: "Abstract concept as spotName instead of a physical venue." },
    // spotName pure-price or pure-count with no venue token — flag.
    { field: "spotName", re: /^(VENDOR\s+BOOTHS|FOOD\s+TRUCKS|TICKET\s+PRICES?|ADMISSION|COVER\s+CHARGE)$/i, message: "spotName names a fee category, not a physical place." },
  ],
  stat: [
    { field: "statLabel", re: /^(cost|amount|number|price|value|total)$/i, message: "Generic statLabel — name what the number is measuring." },
  ],
  text: [
    // The meta-writing ban — same pattern set as the anti-meta
    // guardrail on the POV synthesizer, now extended to text bodies.
    { field: "textBody", re: /\bthis\s+(piece|post|carousel|article|thread|slide|write[-\s]?up)\b/i, message: "Meta-writing — refers to the piece itself." },
    { field: "textBody", re: /\bthis\s+is\s+(the|how|what|why)\s+(pattern|events?|community|the (invisible|hidden))/i, message: "POV meta-restatement — describes the piece instead of writing it." },
    { field: "textBody", re: /\bthe\s+(reader|audience)\s+(has|have|feels?|felt|will)/i, message: "Meta-writing — refers to the reader instead of speaking to them." },
    // LENS vocabulary bleeding into delivery copy.
    { field: "textBody", re: /\b(spreadsheet|logistics|infrastructure)\b/i, message: "LENS vocabulary in delivery copy — these words belong in the model's reasoning, not the slide." },
  ],
  cta: [
    { field: "ctaKicker", re: /^(ready\??|join us|don'?t miss|save the date)$/i, message: "Generic CTA kicker." },
    { field: "ctaVenue", re: /^(new jersey|nj|the shore)$/i, message: "ctaVenue is a region, not an actual location." },
  ],
};

// Arranger-side capability check. Returns true when the source
// material can plausibly support this slot type. The arranger calls
// this before including a slot in the sequence so we don't ask the
// writer to fill a Spotlight when there are no venues to spotlight.
//
// `capabilities` is a bag of booleans the caller computed once from
// the source bullets: { physicalVenue, actionableDetail, specificNumber,
// framingContext, causalChain }. This function stays a leaf — it
// doesn't parse anything itself.
export function slotCanBeSupported(slotType, capabilities = {}) {
  const entry = SLOT_DOCTRINE[slotType];
  if (!entry) return true; // Unknown slot type — don't block.
  const needs = entry.inputRequirements?.needs || [];
  if (!needs.length) return true; // No source gate.
  // All required capabilities must be present.
  return needs.every((cap) => capabilities[cap] === true);
}
