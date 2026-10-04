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
    "",
    "You are not making event content. You are using a gathering, a room, a lineage, or a disappearance as the entry point into that intersection — what this community is, what it values, what it is forgetting, and what it is building. Ask the underserved question — authority comes from the question nobody else is asking, not from repeating the one everyone already answers.",
    "═════════════════════════════",
    "",
  ];
}

// REGISTER: CONTENT — the Feature-tier default. Distinct from Editorial
// (scene report / what's next) and Story (person/moment/change, first-person).
export function contentRegisterBlock() {
  return [
    "REGISTER: CONTENT — cultural infrastructure, not a flyer and not a memoir.",
    "- Destination is UNDERSTANDING plus a door into the archive/directory. Never a sale.",
    "- Method is SPECIMEN → PATTERN → MECHANISM → JOIN → DOOR. A piece that only describes the specimen is a recap. The JOIN (document, parallel room, disappearance, or the regional/national trend that shaped this room / that this room shaped) is the quality.",
    "- Hero is a QUESTION about Black New Jersey (memory, ownership vs programming, same-city diaspora tension, what quietly disappeared). An event, venue, or night may open the piece; it is not the product.",
    "- Voice: 15% curator, 85% observational + research-grounded. Third-person or restrained editorial-we. 'I' is banned unless a sourced quote needs it. You translate; you are not the subject.",
    "- Depth without heaviness. Curiosity without preachiness. If a line sounds like a seminar, a grant, or a eulogy, rewrite it as a concrete NJ specific — a room, a corridor, a lineage, a number you can vouch for.",
    "- Underserved questions only. Do not recap the take everyone already has ('nightlife is changing', 'third places matter'). Name the thing the audience has felt but never had a word for.",
    "- The specimen and the door stay in New Jersey. A sentence that never names New Jersey is the wrong sentence. A JOIN that names what Baltimore, Philly, NYC, or a country-wide norm did to this NJ room — or what this NJ room did to the region — is the quality, not a leak. Do not write an adjacent NYC weekender calendar.",
    "- Closer is the DOOR: who holds this, where it lives, how an everyday person finds more. Never RSVP / don't miss / pull up / this weekend / link in bio / tag a friend.",
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
    "- FIRST name the QUESTION the swipe answers. Then name the JOIN (specimen ↔ a document, parallel room, disappearance, or the regional/national trend that shaped it). Then pick the proof that makes both undeniable. A question without a join is still a recap.",
    "- Hook archetypes that fit: a pointed question nobody else is asking; then→now with a living remnant; a counter-intuitive claim about who owns vs who programs; a single NJ-specific scene detail that implies the larger pattern.",
    "- Do NOT invent unverifiable history, quotes, or venues. If the material is thin, keep the carousel short and specific rather than padding with atmosphere.",
    "- Rotate away from gathering-magazine defaults (150-cap rooms, liquor caps, run clubs) unless THIS piece's cluster and bullets actually are about that.",
    "─────────────────────────────",
    "",
  ];
}

// Spine / arranger extras for Content — the method arc, not venue-response.
export function contentSpineMandate() {
  return contentMethodSpineBlock();
}
