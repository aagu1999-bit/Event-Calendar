// Last-line plant between consecutive News (or Text) chairs.
//
// Isolation still holds: this card owns ONE START receipt. The exception
// is the last sentence, which may NAME the next In START as a pointer —
// with a short definition (what it is, a title, a place, the commonality)
// so the reader is not left decoding a label. The next card lands that
// START. Mash (two receipts on one card), invented same-night joins, and
// directory "next phase" remain banned.

import { isRelatednessGap } from "./matrixCompass.js";

export function splitSentences(text) {
  return String(text || "")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function plantZone(text) {
  const parts = splitSentences(text);
  if (!parts.length) return { before: "", last: "" };
  if (parts.length === 1) return { before: "", last: parts[0] };
  const last = parts[parts.length - 1];
  // News often bolds a payoff in *asterisks*. Treat that payoff plus the
  // sentence before it as the plant zone so a join can sit next to the
  // bold line without looking like a leak.
  if (/^\*[\s\S]+\*$/.test(last) && parts.length >= 3) {
    return {
      before: parts.slice(0, -2).join(" "),
      last: parts.slice(-2).join(" "),
    };
  }
  return { before: parts.slice(0, -1).join(" "), last };
}

export function nextAdjacentProofKey(proofAssignments, slideNum) {
  const want = Number(slideNum) + 1;
  if (!Number.isInteger(want) || want < 2) return null;
  const hit = Object.entries(proofAssignments || {}).find(([, slot]) => Number(slot) === want);
  return hit ? hit[0] : null;
}

export function previousAdjacentProofKey(proofAssignments, slideNum) {
  const want = Number(slideNum) - 1;
  if (!Number.isInteger(want) || want < 2) return null;
  const hit = Object.entries(proofAssignments || {}).find(([, slot]) => Number(slot) === want);
  return hit ? hit[0] : null;
}

export function fuelNumberForProofKey(proofKey, context) {
  const key = String(proofKey || "").trim().toLowerCase();
  if (key.length < 8) return 0;
  for (const raw of String(context || "").split(/\n/)) {
    const m = String(raw || "").match(/^\s*(\d+)[.)]\s+(.+?)\s*$/);
    if (!m) continue;
    const body = m[2].toLowerCase();
    if (body.startsWith(key) || key.startsWith(body.slice(0, Math.min(key.length, body.length)))) {
      return Number(m[1]);
    }
  }
  return 0;
}

function pairMatches(line, a, b) {
  const nums = [...String(line).matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
  const uniq = [...new Set(nums)];
  return uniq.includes(a) && uniq.includes(b);
}

function isOpenRelatednessAsk(line) {
  return /are these related\?/i.test(line) || (
    isRelatednessGap(line) && !/\bRELATED AS\s+(?!what a page)/i.test(line)
  );
}

// allow | afterthought | continue | block | none
export function relatednessPlantMode(currentKey, nextKey, context) {
  if (!currentKey || !nextKey) return "none";
  const a = fuelNumberForProofKey(currentKey, context);
  const b = fuelNumberForProofKey(nextKey, context);
  if (!a || !b) return "allow";
  const lines = String(context || "").split(/\n/).filter((l) =>
    /#\d+/.test(l) && (/\bRELATED AS\b|\bNOT RELATED AS\b|\bUSE AS\b|are these related\?/i.test(l) || isRelatednessGap(l))
  );
  for (const line of lines) {
    if (!pairMatches(line, a, b)) continue;
    if (isOpenRelatednessAsk(line)) return "allow";
    const useAs = line.match(/\bUSE AS\s+([^.\n]+)/i);
    const relatedAs = line.match(/\bRELATED AS\s+([^.\n]+)/i);
    const useText = useAs ? useAs[1] : "";
    const relatedText = relatedAs ? relatedAs[1] : "";
    if (/\bomit\b|\bnone\b/i.test(useText)) return "block";
    if (/\bnone\b|\bn\/a\b|\bunrelated\b/i.test(relatedText) && !/what a page/i.test(relatedText)) {
      return "block";
    }
    if (/afterthought|climate|momentum|weather/i.test(`${useText} ${relatedText}`)) {
      return "afterthought";
    }
    if (/program|same night|same host|session/i.test(relatedText) && !/not related/i.test(relatedText)) {
      return "continue";
    }
    if (/\bNOT RELATED AS\b/i.test(line) && !relatedAs) return "block";
  }
  return "allow";
}

const DEFINE_RULE =
  "A name or kicker is not enough. Say what the thing is — a space, an event, a person's title, a location, or the commonality that strings these two cards — so the reader is not left decoding a label.";

export function formatNextPlantClause({ nextProof, mode } = {}) {
  if (!nextProof || mode === "none") {
    return "NEXT PLANT: none. No In START is reserved on the following chair. End on this receipt.";
  }
  if (mode === "block") {
    return "NEXT PLANT: none. Relatedness said not related / omit. End on this receipt. Do not name the next START here — that would mash two unjoined facts onto one swipe.";
  }
  const excerpt = String(nextProof).replace(/\s+/g, " ").trim().slice(0, 120);
  const weather = mode === "afterthought"
    ? " Plant it as weather around this specimen (same city / same week / investor interest already on the desk), not as a session of this event."
    : mode === "continue"
      ? " Plant it as the next beat of the same thread."
      : " Only plant if you can name a sourced commonality already on Fuel (same city, same week, same host). If you would have to invent same-program / same-host, end on this receipt.";
  return `NEXT PLANT — last sentence of the body (the *asterisk* payoff may be this line) may NAME the next In START as a pointer, not a second receipt. Next START: "${excerpt}...". ${DEFINE_RULE} Do not dump that card's dates, dollars, or story here. This card's receipt stays in the sentences before that last line.${weather}`;
}

export function formatLandingClause({ prevProof, mode } = {}) {
  if (!prevProof || mode === "none" || mode === "block") return "";
  const excerpt = String(prevProof).replace(/\s+/g, " ").trim().slice(0, 120);
  return `LANDING — the previous card planted this START ("${excerpt}..."). Open by naming it and what it is (a space, an event, a title, a location, the commonality), then tell THIS receipt. Do not restart as a new poster whose kicker is a label the reader has to decode.`;
}

export function formatReservedProofLine({
  reservedProof,
  timelyClause = "",
  showcase = false,
  allowPlant = false,
} = {}) {
  if (!reservedProof) {
    if (showcase) {
      return "NO proof entity is reserved for this slide — do NOT reach for an entity already assigned to another peer slot; carry this entry with a specific from context marked 'context' or leave it lighter than the sibling entries.";
    }
    if (allowPlant) {
      return "NO proof bullet is reserved for this slide — do NOT reach for a proof already assigned to another slide; carry the beat from context marked 'context' (not 'proof').";
    }
    return "NO proof bullet is reserved for this slide — do NOT reach for a proof already assigned to another slide; carry the beat with tension, framing, or a specific from context marked 'context' (not 'proof').";
  }
  if (showcase) {
    return `Reserved PROOF (entity) for this slide: "${reservedProof}..." — this entity lands HERE and NOWHERE ELSE in the carousel.${timelyClause}`;
  }
  if (allowPlant) {
    return `Reserved PROOF for this slide: "${reservedProof}..." — this receipt's details land HERE. Last sentence may plant the next In START (see NEXT PLANT). Do not tell that next receipt on this card.${timelyClause}`;
  }
  return `Reserved PROOF for this slide: "${reservedProof}..." — this bullet lands HERE and NOWHERE ELSE in the carousel.${timelyClause}`;
}

export function canPlantOnSlot(slotType, { showcase = false, letterMode = false } = {}) {
  if (letterMode || showcase) return false;
  const t = String(slotType || "").toLowerCase();
  return t === "news" || t === "text";
}

export function isAllowedPlantMention(body, noun) {
  const n = String(noun || "").trim().toLowerCase();
  if (n.length < 4) return false;
  const { before, last } = plantZone(body);
  if (!before) return false;
  if (!last.toLowerCase().includes(n)) return false;
  if (before.toLowerCase().includes(n)) return false;
  return true;
}

export function landingZone(text) {
  const parts = splitSentences(text);
  if (!parts.length) return { first: "", rest: "" };
  if (parts.length === 1) return { first: parts[0], rest: "" };
  return { first: parts[0], rest: parts.slice(1).join(" ") };
}

export function isAllowedLandingMention(body, noun) {
  const n = String(noun || "").trim().toLowerCase();
  if (n.length < 4) return false;
  const { first, rest } = landingZone(body);
  if (!rest) return false;
  if (!first.toLowerCase().includes(n)) return false;
  if (rest.toLowerCase().includes(n)) return false;
  return true;
}

export function contaminationScanText(slide) {
  if (!slide || typeof slide !== "object") return "";
  return ["newsBody", "textBody", "spotMeta", "subtitle"]
    .map((f) => (typeof slide[f] === "string" ? slide[f] : ""))
    .filter(Boolean)
    .join("\n");
}

export function plantBodyOf(slide) {
  if (!slide || typeof slide !== "object") return "";
  const news = String(slide.newsBody || "").trim();
  if (news) return news;
  return String(slide.textBody || "").trim();
}
