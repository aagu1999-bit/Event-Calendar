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
      "Give the reader ONE specific place they could actually go, or thing they could do. A card they'd add to their weekend list because they know what they'd DO there, not just where it is.",
    successCriteria:
      "Reader could screenshot this slide and open Maps or their calendar. Name + where + when/price + a reason to stay = a real, actionable thing.",
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
      // Phone-book / directory mode — the failure the operator flagged
      // on the Bleu Coffee + bwè kafe slides. Address + directions
      // with no atmospheric or behavioral texture. A Spotlight has to
      // tell the reader why to STAY, not just where to GO.
      "Location-only Spotlight: address + directions with no atmospheric or behavioral texture. If the slide answers WHERE and nothing else — no reason to stay, no scene detail, no editorial hook — the reader has no reason to add it to their list. Add ONE concrete texture: the crowd at 4pm, the bar staff's habit, the sound at that hour, a specific reason a regular keeps coming back. Never a fabricated fact; anchor it in what the source supports.",
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
      "Deliver the systemic argument in one beat. Make the reader feel the pattern is real — AND give the pattern a name if it doesn't already have one. Cultural criticism names patterns; that's the writer's job, not scaffolding.",
    successCriteria:
      "Reader nods. Recognizes something they'd felt but hadn't put words to, and now has a word for it.",
    inputRequirements: {
      needs: ["causalChain"],
      description:
        "The causal chain (rule → response) from the spine's causalSynthesis; the specific mechanism the argument depends on.",
    },
    antiPatterns: [
      // The distinction that took me too long to draw: banned meta-
      // writing is SELF-REFERENCE TO THE ARTICLE (the piece, the post,
      // the carousel, the write-up). Pattern-naming — claims ABOUT
      // THE WORLD — is what cultural criticism DOES and must survive.
      "SELF-REFERENCE to the article: 'This piece names…', 'This post shows…', 'This carousel argues…', 'The reader will find…'. Any sentence that treats the article as an object being written about is meta-writing. BANNED.",
      // But pattern-naming — 'The suburban third-place void is what happens
      // when your only weekend option is a strip mall' — is NOT meta-writing.
      // It's a claim about the world. Encouraged, not banned.
      "The specific overused phrase 'you've felt but never had a word for' — this is the tired social-media-carousel tell that got called out. Coin your OWN naming of the pattern instead.",
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
export function formatSlotDoctrineForPrompt(slotType, { content = false } = {}) {
  const entry = SLOT_DOCTRINE[slotType];
  if (!entry) return "";
  const override = content ? CONTENT_SLOT_OVERRIDES[slotType] : null;
  const readerJob = override?.readerJob || entry.readerJob;
  const success = override?.successCriteria || entry.successCriteria;
  const antis = override?.antiPatterns || entry.antiPatterns;
  const antiTop = antis.slice(0, 3).map((a) => `  - ${a}`).join("\n");
  return [
    `SLOT PURPOSE — ${slotType.toUpperCase()}`,
    `  Reader Job: ${readerJob}`,
    `  Success: ${success}`,
    `  Do NOT:`,
    antiTop,
  ].join("\n");
}

// Content / Feature overrides — the default doctrine is an Instagram
// carousel (stop the scroll, one place you could go, one number to
// repeat, one thing to do next). That doctrine cannot write a brief.
export const CONTENT_SLOT_OVERRIDES = {
  cover: {
    readerJob:
      "Name the contrast the brief already proved. The reader should be able to retitle the piece.",
    successCriteria:
      "The two expressions are on the cover. The subtitle connects them. Not an itch. Not 'is gone'.",
    antiPatterns: [
      "Loss covers: 'is gone', 'the last one', 'ghost town', 'social life is gone'.",
      "Open-loop tease that withholds the point so they swipe.",
      "Discover surprising / gathering spots / here's why.",
    ],
  },
  text: {
    readerJob:
      "Explain one section of the argument in a connecting paragraph. Names and numbers live inside the explanation.",
    successCriteria:
      "The reader understands WHY, not just WHERE. They could retell the section.",
    antiPatterns: [
      "Manifesto pileup — 5+ short stacked sentences banging the same point.",
      "Peeling a venue out to be the whole slide.",
      "A 2-word label with no explanation.",
    ],
  },
  news: {
    readerJob:
      "Continue the explanation as a reported section, not a stacked card.",
    successCriteria:
      "The section adds a connection the cover did not already make.",
    antiPatterns: [
      "Scaffolding kickers: 'THE BIGGER PICTURE', 'THE STORY', 'THE CONTEXT', 'THE FRAME', 'THE FIX IS IN'.",
      "Stacked one-liners instead of a paragraph.",
      "Recap of the cover with no new connection.",
    ],
  },
  cta: {
    readerJob:
      "Ask the next question the explanation just made possible.",
    successCriteria:
      "The question is about the argument — Black-owned hospitality, the liquor barrier, who the retrofit is for — not a place to go.",
    antiPatterns: [
      "'Find your next gathering spot' / 'explore NJ's emergent social infrastructure'.",
      "THE ARCHIVE / THE MAP / START HERE as the whole kicker.",
      "A directory door instead of the next question.",
    ],
  },
};

// Compiled anti-pattern token detectors — the post-generation
// validator reads these to flag doctrine violations in returned
// copy. Each detector is a { type, re, message } row. Kept per-slot
// so a token that's fine in one slot (e.g. "$450" is fine as a stat
// number, banned as the sole content of a spotName) isn't over-
// flagged elsewhere.
export const SLOT_ANTIPATTERN_TOKENS = {
  cover: [
    { field: "headline", re: /^(here'?s why|the real (story|reason)|everything you know)/i, message: "Marketing trope in cover headline." },
    { field: "headline", re: /\b(social life is gone|ghost town)\b/i, message: "Loss cover — name the contrast instead of a eulogy." },
  ],
  news: [
    { field: "newsKicker", re: /^(the (bigger picture|story|context|frame|fix is in))$/i, message: "Scaffolding kicker instead of an eyebrow." },
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
    // Self-reference to the article — the actual meta-writing ban.
    // Catches "this piece", "this post", "this carousel", etc. Does
    // NOT catch "this is the pattern of…" because pattern-naming
    // (claims about the world) is what cultural criticism DOES and
    // must survive.
    { field: "textBody", re: /\bthis\s+(piece|post|carousel|article|thread|slide|write[-\s]?up)\b/i, message: "Meta-writing — refers to the piece itself." },
    // The specific overused phrase the operator flagged as tired
    // social-media-carousel scaffolding. Narrow catch, not a broad
    // "any pattern-naming" ban.
    { field: "textBody", re: /\byou'?ve\s+felt\s+(it\s+)?but\s+never\s+had\s+a\s+word\s+for\b/i, message: "Overused 'name the pattern' cliché — coin your own." },
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
