import { lensDiscoveryQueries, sourceDoctrineForPrompt } from "./cgeSources.js";

// CGE content METHOD — the generation ritual, not more voice rules.
//
// The platform thesis (cgeThesis.js) says what the page is about.
// This module says how a piece is *built*. Pop Culture Detective and
// GST are the quality bar when THIS desk already named a reusable
// trick. Their topics (masculinity, Nigerian civic life) are not
// ours. Locate the specimen first. Pattern and join are homework,
// not a kit that must be filled.
//
//   SPECIMEN → PATTERN → MECHANISM → JOIN → DOOR
//
// PATTERN / MECHANISM / JOIN / DOCUMENT are homework labels, not a
// kit that must be filled. Locate the specimen first. A recap of this
// desk is more honest than a fake sideways join.

export const METHOD_MARKER = "CGE METHOD BRIEF";

export const CGE_METHOD_ARC = "SPECIMEN → PATTERN → MECHANISM → JOIN → DOOR";

// Research locates the specimen. Pattern / join only if they are
// already on it. Generation was mapping those labels onto Instagram
// slots (cover loop, venue card, liquor-cap stat, archive CTA). That
// cannot write a brief. Slides follow this essay when the desk earned
// a contrast; otherwise Cover + News locates.
export const CONTENT_ESSAY_ARC = "CONTRAST → CAUSE → EXPLAIN → NEXT";

export const CONTENT_FLYER_SLOTS = [
  "spotlight",
  "stat",
  "features",
  "countdown",
  "poster",
  "press",
  "photo",
];

export const CONTENT_ESSAY_SLOTS = ["cover", "text", "news", "cta"];

export function contentArrangerLines() {
  return [
    "THIS IS AN ESSAY IN SLIDES. The Instagram formula is banned.",
    `Arc: ${CONTENT_ESSAY_ARC} when the desk earned a contrast. If the desk only locates, Cover + News locates. Do not invent paradox / friction / pattern / join / mechanism to complete the kit.`,
    "Do NOT use OPEN A LOOP → CREATE TENSION → DELIVER THE PAYOFF. That spine writes 'THE COMMUTER TOWN'S SOCIAL LIFE IS GONE', then a manifesto dump, then a brewery hours card, then a 1:3000 stat.",
    "Do NOT pick spotlight, stat, features, countdown, poster, press, or photo. A venue name and a number live INSIDE an explained paragraph — they are not their own slides.",
    "Honor the slide count the desk earned (Auto 3–10). Cover → news → cta is honest when there is no contrast. Do not pad to complete CAUSE / EXPLAIN. News is allowed when it continues the explanation as prose, not a stacked card or scaffolding kicker.",
    "Slide jobs:",
    "  LOCATE or CONTRAST (cover) — locate who / what / where / when. Title two expressions (Strip Malls vs Urban Cafes) ONLY if Fuel already proved them. Subtitle connects. Never 'is gone'. Never 'discover surprising gathering spots'.",
    "  NEWS or CAUSE (text/news) — the proving paragraph for what is already on this desk. A cause paragraph (sprawl + the cap → deficit) ONLY if the brief named that pressure. Do not invent a 1:3000.",
    "  EXPLAIN (text) — only if there is an expression to explain. Title names the section ('Route 22's Parking Lot Breweries'). Body explains WHY, and names Sunken Silo and Autodidact inside that paragraph when they are on the brief.",
    "  NEXT (cta) — the question already on the desk. Never invent a liquor-barrier closer. Never 'find your next gathering spot'. Never THE ARCHIVE.",
  ];
}

const JOIN_NONE = /^(?:none|n\/a|unfound|not found|could not|can't find|cannot find|no join)\b/i;

export function contextHasMethodBrief(context) {
  return typeof context === "string" && context.includes(METHOD_MARKER);
}

// Fuel Research already wrote the brief (thesis + starting points / gaps).
// A second Gemini Google pass at generation invents a different architecture
// and the writer serves that instead of the desk. Skip it.
const FUEL_BRIEF_PREFIX = /(?:^|\n)\s*(?:[-•*]\s+)?(?:THESIS|START|GAP|FRICTION|MECHANISM|SPECIMEN|NEXT|DOCUMENT|ARGUMENT|JOIN)\s*—/;

export function contextHasFuelBrief(context) {
  const ctx = String(context || "");
  if (contextHasMethodBrief(ctx)) return true;
  return FUEL_BRIEF_PREFIX.test(ctx);
}

export function parseMethodBrief(text) {
  const raw = String(text || "");
  const grab = (label) => {
    const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, "im");
    const m = raw.match(re);
    return m ? String(m[1] || "").trim() : "";
  };
  return {
    specimen: grab("SPECIMEN"),
    pattern: grab("PATTERN"),
    mechanism: grab("MECHANISM"),
    document: grab("DOCUMENT"),
    join: grab("JOIN"),
    remnant: grab("REMNANT"),
    unconfirmed: grab("UNCONFIRMED"),
  };
}

export function methodHasJoin(parsed) {
  const join = String(parsed?.join || "").trim();
  if (!join) return false;
  return !JOIN_NONE.test(join);
}

// Extra dashed bullets so parseContextBullets / THIN_INPUT / the spine
// see the document, join, and remnant as atomic facts — not just prose
// sitting above the list.
export function methodBriefToBullets(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  const out = [];
  if (parsed.document) out.push(parsed.document);
  if (methodHasJoin(parsed)) out.push(parsed.join);
  if (parsed.remnant) out.push(parsed.remnant);
  return out;
}

export function formatMethodBriefForContext(researched) {
  if (!researched) return "";
  const parsed = researched.parsed || parseMethodBrief(researched.brief || "");
  const lines = [
    `${METHOD_MARKER} — homework from this desk. PATTERN / MECHANISM / JOIN / DOCUMENT only if the LENS, POV, or a numbered operator anchor already named them.`,
    parsed.specimen ? `SPECIMEN: ${parsed.specimen}` : "",
    parsed.pattern ? `PATTERN: ${parsed.pattern}` : "",
    parsed.mechanism ? `MECHANISM: ${parsed.mechanism}` : "",
    parsed.document ? `DOCUMENT: ${parsed.document}` : "",
    parsed.join ? `JOIN: ${parsed.join}` : "JOIN: NONE",
    parsed.remnant ? `REMNANT: ${parsed.remnant}` : "",
    parsed.unconfirmed ? `UNCONFIRMED: ${parsed.unconfirmed}` : "",
    "",
    methodHasJoin(parsed)
      ? "The JOIN is the quality. The writer must land it on the JOIN beat — one slide that ties the specimen to something that is not more facts about the same venue."
      : "JOIN is NONE — do not invent one. Keep the carousel short and specific. A recap is more honest than a fake sideways tie.",
  ].filter((line, i, arr) => line !== "" || (i > 0 && arr[i - 1] !== ""));

  const bullets = methodBriefToBullets(parsed);
  if (bullets.length) {
    lines.push("");
    for (const b of bullets) lines.push(`- ${b}`);
  }
  return lines.join("\n");
}

export function appendMethodBriefToContext(context, researched) {
  const block = formatMethodBriefForContext(researched);
  if (!block) return context || "";
  const base = String(context || "").replace(/\s+$/, "");
  return base ? `${base}\n\n${block}` : block;
}

// Operator questions typed while a carousel is being built — after
// research, before slides write. Same append pattern as the method brief
// so generateArrangedCarousel / generateTemplateFill just see more context.
export const OPERATOR_QUESTIONS_MARKER = "OPERATOR QUESTIONS WHILE BUILDING";

export function appendOperatorQuestions(context, questions) {
  const q = String(questions || "").trim();
  if (!q) return String(context || "");
  const block = [
    `${OPERATOR_QUESTIONS_MARKER} — answer these in the piece.`,
    "Use the same everyday wording as the rest of the copy. No statute numbers, no seminar talk, no kitchen-table idea dressed as a legal brief.",
    q,
  ].join("\n");
  const base = String(context || "").replace(/\s+$/, "");
  return base ? `${base}\n\n${block}` : block;
}

export function contentMethodResearchPrompt({ topic, context, clusterDirective = "", clusterLabel = "" } = {}) {
  const subject = [topic, context].map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
  return [
    "You are a researcher for a Black New Jersey cultural publication (Central Group Events).",
    "Locate THIS specimen first (who / what / where / when). Dates, venue, who holds it ARE the brief when that is what the desk named.",
    "Flyer recap is banned (highlights, innovations, vibe, 'why this weekend matters'). Pattern, document, and join are optional homework — not a kit you must complete.",
    "",
    "The page already has a SPECIMEN — the room, gathering, lineage, event, or disappearance in the topic.",
    "Your job is to verify that specimen. PATTERN, DOCUMENT, and JOIN only if they are already on the specimen — write NONE rather than invent them.",
    "",
    subject ? `SPECIMEN / MATERIAL:\n${subject}` : "SPECIMEN / MATERIAL: (none typed — infer carefully from New Jersey cultural infrastructure; do not invent a named venue.)",
    "",
    ...(clusterLabel || clusterDirective ? [
      `Editorial cluster: ${clusterLabel || "(unlabeled)"}${clusterDirective ? ` — ${clusterDirective}` : ""}`,
      "The cluster is a door, not the product. Do not only return more gathering-math about the cluster.",
      "",
    ] : []),
    "Do SEVERAL focused web searches (not one):",
    "1. The specimen by name + New Jersey — verify what it is, where, who holds it. Do not invent.",
    "2. Other instances of the SAME pattern ONLY if this specimen already shows a reusable pressure. Do not hunt a CGE default pattern (third place, liquor cap, 150-cap, access illusion) to fill the line.",
    "3. A DOCUMENT only if this specimen has an official page, a year, an ownership, a closure, or a number. Do not hunt liquor cap / census / Transit Village to make the piece feel ready.",
    "4. A SIDEWAYS JOIN only if a parallel room, remnant, or influence-chain is already visible on this specimen. JOIN: NONE is honest. A recap is more honest than a fake join. Do not hunt a same-city other-diaspora site unless the specimen already is that story.",
    "5. Who holds this now — the living remnant or archive an everyday person can actually find.",
    "6. AN ARGUMENT: a Black-NJ opinion piece, news column, university page (Rutgers / Montclair / Princeton oral history, AAS, Institute of Jazz Studies), or independent page already asking this pattern — including NJ Uncovered on Facebook / YouTube / Instagram. A Current Affairs (or similar) piece may teach a societal / pop-culture trick ONLY if SPECIMEN / MATERIAL already named that trick — do not hunt a MECHANISM or an access illusion to fill the line. Search the COLUMN, the PERSON, the PAGE, and the university holding. Not NJPAC, not Essence, not a museum, not a Brooklyn weekender. If you cannot name one, say so in REMNANT.",
    ...lensDiscoveryQueries({ cluster: clusterLabel, topic }).flatMap((q) => [`   - ${q}`]),
    "",
    "Return plain text in EXACTLY this shape (no markdown headers, no preamble):",
    "SPECIMEN: (one sentence — the room/lineage already in someone's week)",
    "PATTERN: (NONE unless this specimen already shows a reusable pressure — not a CGE default. Do not reach for ownership vs programming, same-city diaspora tension, or access illusion unless the specimen already is that story.)",
    "MECHANISM: (NONE unless this specimen already shows a reusable trick — a word the reader can keep. Do not invent access-illusion, a statute name, or a CGE default to fill this line.)",
    "DOCUMENT: (NONE unless this specimen has a sourced number, year, ordinance, ownership, closure, or archive — note the source in parentheses. Do not hunt a statute to fill this line.)",
    "JOIN: (NONE unless a sideways tie is already on this specimen. Do not fake a join so the carousel can feel like a magazine.)",
    "REMNANT: (who holds this / where an everyday person finds more)",
    "UNCONFIRMED: (anything you could not verify — or NONE)",
    "",
    sourceDoctrineForPrompt(),
    "",
    "RULES:",
    "- Prefer specific, verifiable facts. Note the source site and class in parentheses — (OFFICIAL — nj.gov), (CULTURAL — blackinjersey.com).",
    "- Never invent a venue, year, quote, or ordinance.",
    "- HOUSE FIGHT IS OPTIONAL. MECHANISM, PATTERN, JOIN, DOCUMENT, and FRICTION are OPTIONAL. Do not search diaspora tension, who owns vs who programs, who actually benefits, access illusions, a named statute, or a sideways join to make the homework feel like CGE. Stay on the specimen in SPECIMEN / MATERIAL.",
    "- The specimen lands in New Jersey. A join that never touches New Jersey is the wrong join. A join that names what a regional city or a national trend did to this NJ room is the quality.",
    "- The JOIN cannot be another selling point of the same night.",
  ].join("\n");
}

// Writer-facing: homework from this desk, short enough to survive token pressure.
export function contentMethodBlock() {
  return [
    "═════════════════════════════",
    `CGE ESSAY — ${CONTENT_ESSAY_ARC}`,
    "═════════════════════════════",
    "This is HOW the piece is written. The Instagram carousel formula cannot do this job. Voice rules cannot substitute for it.",
    "- CONTRAST: the cover names the two expressions the brief already proved (strip-mall vs urban cafe, Route 22 vs Cranford). If the brief has no contrast, locate who / what / where / when. Connecting subtitle. Not a withheld loop. Not 'is gone'.",
    "- CAUSE: only if the brief already named a trick — one paragraph that articulates how A + B produced C. A number from the brief lives here, inside the sentence, not on a stat card. Do not invent a cause to complete the essay.",
    "- EXPLAIN: each middle slide is a SECTION. Title names the section. Body is 2-5 connecting sentences that explain WHY that expression works. Place-names live inside that paragraph (Sunken Silo and Autodidact in the Route 22 section; Black Swan in the urban-core section). Two names in one explained section is the quality, not a violation.",
    "- NEXT: the closer asks the question the explanation just made possible. Not a door into a directory. Not 'find your next gathering spot'. Not THE ARCHIVE.",
    "",
    "HARD RULES:",
    "- If the context contains THESIS / START / GAP lines or a CGE METHOD BRIEF, teach THAT brief. Do not replace it with a nightlife-math or selling-points arc.",
    "- Do NOT peel a venue onto a spotlight or a number onto a stat. Those slots are flyer instruments. They kill explanation.",
    "- Do NOT isolate entities. Connection is the job. A slide that names two places in one argument is correct when they are the same expression.",
    "- Manifesto pileup (five short stacked sentences banging the same point) is a failed text slide. Write a paragraph.",
    "- Cover locates. States a CONTRAST from THESIS / START only if those lines already named two expressions. Never 'discover surprising gathering spots'. Never 'THE SOCIAL LIFE IS GONE'.",
    "- Do not write the essay labels (CONTRAST, CAUSE, EXPLAIN, NEXT, SPECIMEN, PATTERN, JOIN, DOOR) as visible copy.",
    "═════════════════════════════",
    "",
  ];
}

// Spine-facing: replaces Paradox → Friction → Mechanism → Gate for Content.
export function contentMethodSpineBlock() {
  return [
    "CONTENT ESSAY SPINE — Feature / content piece. This OVERRIDES Paradox → Friction → Mechanism → Gate AND the Instagram open-loop spine.",
    `Outline as ${CONTENT_ESSAY_ARC} when the desk earned a contrast. If it only locates, outline Cover + News. Do not invent paradox / friction / pattern / join / mechanism beats to fill four slots.`,
    "- CONTRAST — name the two expressions the brief already proved. If none, locate. No withheld loop. No 'is gone'.",
    "- CAUSE — only if the brief named a pressure. Articulate how it produced those expressions. Numbers live in this sentence.",
    "- EXPLAIN — the section that makes one expression undeniable. Place-names live inside the paragraph. If there are two expressions, a second EXPLAIN beat is correct.",
    "- NEXT — the question the explanation opened. Never a ticket, RSVP, archive kicker, or 'find your next gathering spot'.",
    "",
    "causalSynthesis: EXACTLY 2 sentences. If the brief named a contrast: sentence 1 is the CONTRAST, sentence 2 is the CAUSE. If the brief only located: two sentences that locate THIS specimen. Do not invent a pressure, liquor cap, or access illusion.",
    "Do not outline a promo arc (hook → selling points → RSVP). Do not outline a directory (cover → venue card → stat → find a spot).",
    "",
  ];
}
