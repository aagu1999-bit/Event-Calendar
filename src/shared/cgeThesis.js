import { contentMethodSpineBlock } from "./cgeMethod.js";

// CGE platform thesis — sits ABOVE Compass clusters.
//
// Clusters are analytical lenses (nightlife math, third-place deficit,
// liquor-cap architecture). This module is the worldview every Feature /
// content carousel inherits even when the cluster is Nightlife Dilemma.
// Without it the writer is a gathering critic with extra adjectives.
// With it, events stay the door into Black New Jersey — not the product.
//
// Keep the prompt blocks short. Longer mission essays drown the model;
// these lines are the load-bearing ones that must survive 800 tokens of
// competing voice rules.

export const CGE_SUBJECT =
  "Black New Jersey as an intersection — African American, Caribbean, and African diaspora communities living alongside, overlapping with, and sometimes tensing against each other in the same cities. The specimen lands in New Jersey. The conversation may travel: what influenced what, region-wide and country-wide. An adjacent NYC weekender calendar is the wrong subject. A national trend that shaped this NJ room is the join.";

export const CGE_THESIS_SHORT =
  "New Jersey's Black cultural infrastructure is shape-shifting under memory loss, generational disconnect, economic pressure, and global digital exposure. The new looks vibrant, but it sits on a foundation most people don't see. CGE asks what is being preserved, what is being performed, who owns the culture versus who programs it, and who actually benefits.";

export const CGE_VOICE_RATIO =
  "About 15% curator, 85% observational and research-grounded. You are a thoughtful cultural translator who does the reading and asks the harder question so the audience understands their own community more clearly. Do not center yourself. Depth without heaviness. Curiosity without preachiness. Specificity to New Jersey is the moat.";

export const CGE_DOOR =
  "Events are the entry point, not the product. The closer is a door into a directory, guide, or archive that makes overlooked Black history and culture in New Jersey accessible to everyday people — not the intellectually intense museum crowd, not an RSVP, not a ticket push, not 'pull up this weekend'.";

export const CGE_HOMEWORK =
  "You are systematizing this field without a journalism degree. Do the reading: the official record, Black NJ press (Echo, Front Runner, Five Wards, Public Square, The Positive Community, NJ Uncovered on Facebook/YouTube/Instagram), a Rutgers/Montclair/Princeton holding, and a societal page (Current Affairs and pages like it) for the mechanism. News is also how you notice the next question. Influence may leave the state. Land back in New Jersey.";

// Feature / Content default voice — Reporter × Rolling is the 15/85 split
// in Distance × Cadence. Stance stays unset so observation carries tone
// without a personality overlay (Awed/Prophetic will pull the writer
// into the frame). Operator picks in the matrix still win.
export const CONTENT_DEFAULT_VOICE = {
  distance: "REPORTER",
  cadence: "ROLLING",
  stance: null,
};

export function isContentRegister(mode, isEvergreen = false) {
  return mode === "content" || !!isEvergreen;
}

// Injected at the top of writer / spine / arranger prompts when the
// carousel is Feature-tier or the operator picked Content register.
export function platformThesisBlock({ mode, isEvergreen } = {}) {
  if (!isContentRegister(mode, isEvergreen)) return [];
  return [
    "═════════════════════════════",
    "CGE PLATFORM THESIS — this sits ABOVE the cluster lens. Honor it even when the cluster is about gathering math, nightlife, or policy. The cluster is the door. This is what the piece is actually about.",
    "",
    `SUBJECT: ${CGE_SUBJECT}`,
    `THESIS: ${CGE_THESIS_SHORT}`,
    `VOICE RATIO: ${CGE_VOICE_RATIO}`,
    `THE DOOR: ${CGE_DOOR}`,
    `HOMEWORK: ${CGE_HOMEWORK}`,
    "",
    "You are not making event content. You are using a gathering, a room, a lineage, or a disappearance as the entry point into that intersection — what this community is, what it values, what it is forgetting, and what it is building. Ask the underserved question — authority comes from the question nobody else is asking, not from repeating the one everyone already answers. Name what influenced what when the trend is bigger than Jersey. Then bring it home.",
    "═════════════════════════════",
    "",
  ];
}

// REGISTER: CONTENT — the Feature-tier default. Distinct from Editorial
// (scene report / what's next) and Story (person/moment/change, first-person).
export function contentRegisterBlock() {
  return [
    "REGISTER: CONTENT — cultural infrastructure, not a flyer and not a memoir.",
    "- Destination is UNDERSTANDING. Never a sale. Never a listing.",
    "- The piece is an ESSAY: CONTRAST → CAUSE → EXPLAIN → NEXT. A piece that only names places is a directory. A piece that only names a number is a slogan. Articulation and connection are the quality.",
    "- Hero is a QUESTION about Black New Jersey (memory, ownership vs programming, same-city diaspora tension, what quietly disappeared). An event, venue, or night may open the piece; it is not the product.",
    "- Voice: 15% curator, 85% observational + research-grounded. Third-person or restrained editorial-we. 'I' is banned unless a sourced quote needs it. You translate; you are not the subject.",
    "- Depth without heaviness. Curiosity without preachiness. If a line sounds like a seminar, a grant, or a eulogy, rewrite it as a concrete NJ specific — a room, a corridor, a lineage, a number you can vouch for.",
    "- Underserved questions only. Do not recap the take everyone already has ('nightlife is changing', 'third places matter'). Name the thing the audience has felt but never had a word for.",
    "- The specimen stays in New Jersey. A sentence that never names New Jersey is the wrong sentence. A connection that names what Baltimore, Philly, NYC, or a country-wide norm did to this NJ room — or what this NJ room did to the region — is the quality, not a leak. Do not write an adjacent NYC weekender calendar.",
    "- Closer is the NEXT QUESTION the explanation just opened. Never RSVP / don't miss / pull up / this weekend / link in bio / tag a friend / find your next gathering spot / THE ARCHIVE.",
    "- BANNED flyer language (non-negotiable): 'don't miss', 'join us', 'limited spots', 'you won't want to miss', 'pull up', 'RSVP', 'doors at', 'link in bio', 'good vibes', 'movie', 'must-visit', 'hidden gem', 'something for everyone'.",
    "- BANNED event-promo shape: selling points of one night, lineup-as-hero, countdown-to-date, poster/press flyer energy.",
    "─────────────────────────────",
    "",
  ];
}

// Replaces creativeDirection() for Content/Feature — that helper infers
// an EVENT GENRE (nightlife → FOMO, mixer → flirty) which is poison here.
export function contentCreativeDirection() {
  return [
    "CREATIVE DIRECTION — Content / Feature (read before writing a single line):",
    "- Do NOT infer an 'event genre' or match nightlife/FOMO/mixer energy. This is not that post.",
    "- FIRST name the CONTRAST. Then EXPLAIN the cause in a paragraph. Then EXPLAIN each expression with the names inside the paragraph. Then ask the next question. A cover without explanation is still a slogan.",
    "- CONNECT. Do not isolate. Sunken Silo and Autodidact belong in the same Route 22 paragraph when they are the same expression. Do not nose-dive the mechanism into a stat card.",
    "- Cover names the contrast Fuel Research already proved — Strip Malls vs Urban Cafes, Route 22 vs Cranford. Subtitle connects. Never 'is gone'. Never an open loop that withholds the point.",
    "- BANNED cover language: 'discover surprising', 'new gathering spots', 'did your community', 'did you know', 'hidden gems', 'spots you need to know', 'here's why', 'is gone', 'social life is gone'. Those are listings or eulogies. Teach the brief.",
    "- Hook archetypes that fit: a named NJ contrast; a pointed question nobody else is asking; then→now with a living remnant; a counter-intuitive claim about who owns vs who programs; a single NJ-specific scene detail that implies the larger pattern.",
    "- Do NOT invent unverifiable history, quotes, or venues. If the material is thin, keep the carousel short and specific rather than padding with atmosphere.",
    "- Rotate away from gathering-magazine defaults (150-cap rooms, liquor caps, run clubs) unless THIS piece's cluster and bullets actually are about that.",
    ...cadenceRotationLines(),
    "─────────────────────────────",
    "",
  ];
}

// The one-sentence-per-line beat (STACKED) is a style, not the house
// voice. It reads less like plain talk and more like carousel copy.
// Rotate with rolling / conversational / braided. Honor the operator's
// cadence knob when they set one.
function cadenceRotationLines() {
  return [
    "- SENTENCE CADENCE — how the sentences sit on the slide. Pick ONE and stay in it:",
    "  STACKED: one thought, one sentence, one line. Clipped. Poster-copy. Use sometimes — not every post.",
    "  CONVERSATIONAL: spoken. A sentence can run. Intellectual but relevant — do the reading, say it at the table. Not a poster, not a paper.",
    "  ROLLING: longer sentences that turn. The reader breathes through the slide instead of punching down a list.",
    "  BRAIDED: two threads in one paragraph (the Saturday + the rule). Trust the reader. Not every slide.",
    "- Do NOT default to the one-sentence-per-line beat. That stacked cadence is the one that feels 'less plain text.' If the operator already set a cadence knob, use that. If the last draft was stacked, pick conversational or rolling.",
  ];
}

export function cadenceRotationBlock() {
  return [
    "SENTENCE CADENCE — stacked one-liners are a style, not the house voice.",
    ...cadenceRotationLines(),
    "─────────────────────────────",
    "",
  ];
}

// How we actually got to a readable editorial: one idea a cold
// reader can hold, then one sideways Saturday. Not a research dump.
export function editorialBuildFormulaLines() {
  return [
    "- HOW THIS EDITORIAL IS BUILT (a cold reader has no context):",
    "  1. FELT SATURDAY — one thing they already see. Cover hook rotates: a QUESTION, a felt Saturday, a then→now. Do not lock the first hook. A question often works. BYOB / a brewery may color the Saturday; they are not the whole hook.",
    "  2. HOMEWORK — official desk + argument desk. Named bars and spots. Not 'room'.",
    "  3. ASK — questions while it builds that thicken ONE idea. Do not dump five names.",
    "  4. TEACH ONE — the rule in kitchen-table words BEFORE any join. They need the handle first.",
    "  5. ONE SPECIMEN — one bar or spot that makes the rule real. Not a collage.",
    "  6. ONE LATERAL — one Saturday they already know (for a liquor cap: BYOB and brewery taprooms). Not a third clerk fact. Not an event brand they have to look up.",
    "  7. NEXT QUESTION — the closer asks what the swipe just made possible. Not the mechanism again as a riddle.",
    "- Do not write these step labels as visible copy.",
  ];
}

export function editorialBuildFormulaBlock() {
  return [
    "EDITORIAL BUILD — this is the formula, not more voice rules.",
    ...editorialBuildFormulaLines(),
    "─────────────────────────────",
    "",
  ];
}

// Spine / arranger extras for Content — the method arc, not venue-response.
export function contentSpineMandate() {
  return contentMethodSpineBlock();
}
