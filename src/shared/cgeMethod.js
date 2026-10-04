import { lensDiscoveryQueries, sourceDoctrineForPrompt } from "./cgeSources.js";

// CGE content METHOD — the generation ritual, not more voice rules.
//
// The platform thesis (cgeThesis.js) says what the page is about.
// This module says how a piece is *built*. Pop Culture Detective and
// GST are the quality bar: research that produces a reusable pattern,
// plus one sideways join that makes the specimen mean more. Their
// topics (masculinity, Nigerian civic life) are not ours. The steps are.
//
//   SPECIMEN → PATTERN → MECHANISM → JOIN → DOOR
//
// Without a JOIN the pipeline is still writing a recap. The writer is
// not allowed to invent the join; research has to find it or the
// carousel stays short.

export const METHOD_MARKER = "CGE METHOD BRIEF";

export const CGE_METHOD_ARC = "SPECIMEN → PATTERN → MECHANISM → JOIN → DOOR";

const JOIN_NONE = /^(?:none|n\/a|unfound|not found|could not|can't find|cannot find|no join)\b/i;

export function contextHasMethodBrief(context) {
  return typeof context === "string" && context.includes(METHOD_MARKER);
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
    `${METHOD_MARKER} — required architecture. Do not write this carousel without these joins.`,
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

export function contentMethodResearchPrompt({ topic, context, clusterDirective = "", clusterLabel = "" } = {}) {
  const subject = [topic, context].map((s) => String(s || "").trim()).filter(Boolean).join("\n\n");
  return [
    "You are a researcher for a Black New Jersey cultural publication (Central Group Events).",
    "You are NOT gathering event background, vibe, lineup, or 'why this weekend matters.'",
    "That is flyer research. This call is the homework that makes a piece a publication.",
    "",
    "The page already has a SPECIMEN — the room, gathering, lineage, or disappearance in the topic.",
    "Your job is to find the PATTERN, a DOCUMENT, and one SIDEWAYS JOIN.",
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
    "2. Other New Jersey instances of the SAME pattern (not more facts about the same venue).",
    "3. A DOCUMENT: ordinance, year founded/closed, ownership, census, budget line, archive holding, liquor cap, demolition, press that names a number.",
    "4. A SIDEWAYS JOIN: a parallel room, a same-city other-diaspora site, a then→now remnant, a policy that explains the felt week, a disappearance next door. This is the quality. Without it the piece is a recap.",
    "5. Who holds this now — the living remnant or archive an everyday person can actually find.",
    "6. AN ARGUMENT: a Black-NJ opinion piece, news column, university page (Rutgers / Montclair / Princeton oral history, AAS, Institute of Jazz Studies), or independent page already asking this pattern. A Current Affairs (or similar) piece may teach the societal / pop-culture MECHANISM — do not move the specimen onto their subject. Search the COLUMN, the PERSON, the PAGE, and the university holding. Not NJPAC, not Essence, not a museum, not a Brooklyn weekender. If you cannot name one, say so in REMNANT.",
    ...lensDiscoveryQueries({ cluster: clusterLabel, topic }).flatMap((q) => [`   - ${q}`]),
    "",
    "Return plain text in EXACTLY this shape (no markdown headers, no preamble):",
    "SPECIMEN: (one sentence — the room/lineage already in someone's week)",
    "PATTERN: (the reusable Black-NJ pressure this is an instance of — memory loss, ownership vs programming, same-city diaspora tension, economic squeeze, digital flattening, a quiet disappearance)",
    "MECHANISM: (a short reusable NAME for the trick/pressure — a word the reader can keep and use on the next thing they see)",
    "DOCUMENT: (one sourced number, year, ordinance, ownership, closure, or archive — note the source in parentheses)",
    "JOIN: (one sideways tie that is NOT more facts about the specimen. specimen ↔ document/room/disappearance. If you cannot find one, write JOIN: NONE — do not fake it.)",
    "REMNANT: (who holds this / where an everyday person finds more)",
    "UNCONFIRMED: (anything you could not verify — or NONE)",
    "",
    sourceDoctrineForPrompt(),
    "",
    "RULES:",
    "- Prefer specific, verifiable facts. Note the source site and class in parentheses — (OFFICIAL — nj.gov), (CULTURAL — blackinjersey.com).",
    "- Never invent a venue, year, quote, or ordinance.",
    "- New Jersey specificity is required. A join that could sit in Brooklyn or 'the diaspora' is the wrong join.",
    "- The JOIN cannot be another selling point of the same night.",
  ].join("\n");
}

// Writer-facing: required architecture, short enough to survive token pressure.
export function contentMethodBlock() {
  return [
    "═════════════════════════════",
    `CGE METHOD — ${CGE_METHOD_ARC}`,
    "═════════════════════════════",
    "This is HOW the piece is built. Voice rules cannot substitute for it.",
    "- SPECIMEN: the room, gathering, lineage, or disappearance already in the audience's week. The door. Not the product.",
    "- PATTERN: the reusable pressure this specimen is an instance of. After this piece the reader should be able to see the next room without you.",
    "- MECHANISM: name the trick (a keepable word). Do not stop at mood.",
    "- JOIN: one sideways tie — this specimen ↔ a document, a parallel room, a same-city other-diaspora site, a disappearance, a then→now remnant. THIS IS THE QUALITY. A carousel that only describes the specimen is a recap, even if the voice is perfect.",
    "- DOOR: who holds this, where it lives, how an everyday person finds more. Not an RSVP.",
    "",
    "HARD RULES:",
    "- If the context contains a CGE METHOD BRIEF, execute that architecture. Do not replace it with a nightlife-math or selling-points arc.",
    "- If JOIN is NONE or missing, do NOT invent a join. Keep the carousel short. Honesty over a fake sideways tie.",
    "- The JOIN slide is the ONE slide allowed to connect two places, decades, or a room to a document. Every other slide stays on one time, one place, one specific.",
    "- Cover states the PATTERN as a question or claim — never the specimen's flyer.",
    "- Do not write the method labels (SPECIMEN, PATTERN, MECHANISM, JOIN, DOOR) as visible copy.",
    "═════════════════════════════",
    "",
  ];
}

// Spine-facing: replaces Paradox → Friction → Mechanism → Gate for Content.
export function contentMethodSpineBlock() {
  return [
    "CONTENT METHOD SPINE — Feature / content piece. This OVERRIDES the default Paradox → Friction → Mechanism → Gate venue-response arc.",
    `Outline as ${CGE_METHOD_ARC}. Keep four beats. Spread them across the slide count.`,
    "- SPECIMEN — name the room / lineage / disappearance. No conclusion yet. No flyer details as the hero.",
    "- PATTERN — the reusable Black-NJ pressure. No document dump. The reader should be able to reuse this lens.",
    "- JOIN — the sideways tie (document, parallel room, same-city other diaspora, disappearance). This beat is the quality. If JOIN is NONE in the method brief, do not fake it; collapse JOIN into PATTERN and recommend fewer slides.",
    "- DOOR — who holds this, where it lives, how an everyday person finds more. Never a ticket, RSVP, or keyword shout.",
    "",
    "causalSynthesis: EXACTLY 2 sentences. Sentence 1 names the PATTERN (the reusable pressure). Sentence 2 names the JOIN (specimen ↔ the document/room/disappearance that makes the pattern undeniable). NOT 'venue responds to liquor cap' unless the bullets actually are that story.",
    "Prefer ORIGIN → BREAK → LEGACY → NOW only when the material is sonic/historical AND you can still name a JOIN in sentence 2.",
    "Do not outline a promo arc (hook → selling points → RSVP).",
    "",
  ];
}
