// A question while a carousel is being built is a TURN, not a note.
//
// Today the box only appended text and then wrote a new draft. That
// wasted the moment. A turn can:
//   RESEARCH  — look up what they asked, then keep going
//   CONTINUE  — build on the current slides, do not start over
//   CORRECT   — mark a claim / slide wrong and write over that part
//   TEACH     — reuse saved voice, exemplars, approve/reject, lessons
//
// Teach is always on when anything is saved. The others are routed
// from the words they typed and which slides they marked.

export const SAVED_TEACHING_MARKER = "SAVED TEACHING";
export const CURRENT_DRAFT_MARKER = "CURRENT DRAFT";
export const FOLLOWUP_RESEARCH_MARKER = "FOLLOW-UP RESEARCH";

const CORRECT_RE = /\b(wrong|incorrect|not true|that'?s not|don'?t say|strike|scratch that|fix slide|rewrite that|no that'?s|not right|false|mark this)\b/i;
const RESEARCH_RE = /(?:^|\n)\s*(does |is |are |who |what |why |when |where |how |look up|find |source|can |could |would |should |what about)/i;
const METHOD_RE = /\b(join|specimen|pattern|who holds|document)\b/i;

function uniq(list) {
  return [...new Set(list)];
}

export function interpretBuildTurn({ questions, hasSlides = false, markedSlides = [] } = {}) {
  const q = String(questions || "").trim();
  const marked = (Array.isArray(markedSlides) ? markedSlides : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0);
  const intents = [];

  if (marked.length || CORRECT_RE.test(q)) intents.push("correct");
  if (q && RESEARCH_RE.test(q)) intents.push("research");
  if (q && METHOD_RE.test(q)) intents.push("method");
  if (hasSlides && q && !intents.includes("correct")) intents.push("continue");
  if (hasSlides && intents.includes("correct")) intents.push("continue");
  if (!hasSlides) intents.push("write");

  const unique = uniq(intents);
  const needsResearch = unique.includes("research") || unique.includes("method");
  const rewriteMarkedOnly = hasSlides && marked.length > 0;
  const continueBuild = !!hasSlides;
  const startFresh = !hasSlides;

  let label = "Write now — no extra questions";
  if (q || marked.length) {
    if (startFresh && needsResearch) label = "Look this up, then write";
    else if (startFresh) label = "Ask these + write";
    else if (rewriteMarkedOnly && needsResearch) label = "Look this up, then write over the marked slides";
    else if (rewriteMarkedOnly) label = "Write over the marked slides";
    else if (needsResearch) label = "Look this up, then keep building";
    else if (unique.includes("correct")) label = "Write over what's wrong — keep the rest";
    else label = "Keep building on this draft";
  } else if (hasSlides) {
    label = "Ask or mark a slide wrong";
  }

  return {
    intents: unique,
    startFresh,
    continueBuild,
    needsResearch,
    needsMethod: unique.includes("method"),
    rewriteMarkedOnly,
    markedSlides: marked,
    label,
  };
}

export function formatDraftForContinue(slides, markedSlides = [], slotToText = () => "") {
  if (!Array.isArray(slides) || !slides.length) return "";
  const marked = new Set((markedSlides || []).map((n) => Number(n)));
  return slides.map((slot, i) => {
    const text = String(slotToText(slot) || "").trim() || "(empty)";
    const flag = marked.has(i) ? "  <-- WRONG — write over this" : "  — keep if it still holds";
    return `Slide ${i + 1} (${slot?.type || "unknown"})${flag}: ${text}`;
  }).join("\n");
}

export function appendSavedTeaching(context, { voice, approvedDrafts, rejectedDrafts, lessons } = {}) {
  const parts = [];
  const desc = voice && typeof voice.description === "string" ? voice.description.trim() : "";
  const exemplars = Array.isArray(voice?.exemplars)
    ? voice.exemplars.map((e) => String(e || "").trim()).filter(Boolean).slice(-3)
    : [];
  if (desc) parts.push(`VOICE: ${desc.slice(0, 400)}`);
  if (exemplars.length) {
    parts.push("HOW WE SOUND (saved slides — match the register, do not copy):");
    exemplars.forEach((e, i) => parts.push(`${i + 1}. ${e.slice(0, 220)}`));
  }
  if (Array.isArray(approvedDrafts) && approvedDrafts.length) {
    parts.push(`Approved drafts on this matrix: ${approvedDrafts.length} — match that shape, do not copy.`);
  }
  if (Array.isArray(rejectedDrafts) && rejectedDrafts.length) {
    const reasons = rejectedDrafts.map((r) => String(r?.reason || "").trim()).filter(Boolean).slice(-3);
    if (reasons.length) parts.push(`Do not repeat: ${reasons.join("; ")}`);
  }
  if (Array.isArray(lessons) && lessons.length) {
    parts.push("LESSONS THIS BUILD (the operator already corrected these — they stick):");
    lessons.forEach((l) => parts.push(`- ${String(l).trim()}`));
  }
  if (!parts.length) return String(context || "");
  const block = [`${SAVED_TEACHING_MARKER} — reuse what this page already learned. Do not start the voice or the facts from zero.`, ...parts].join("\n");
  const base = String(context || "").replace(/\s+$/, "");
  if (base.includes(SAVED_TEACHING_MARKER)) return base;
  return base ? `${base}\n\n${block}` : block;
}

export function appendFollowupResearch(context, brief) {
  const b = String(brief || "").trim();
  if (!b) return String(context || "");
  const block = `${FOLLOWUP_RESEARCH_MARKER} (for the operator's question — verify before treating as fact):\n${b}`;
  const base = String(context || "").replace(/\s+$/, "");
  return base ? `${base}\n\n${block}` : block;
}

export function appendCurrentDraft(context, draftMap) {
  const map = String(draftMap || "").trim();
  if (!map) return String(context || "");
  const block = [
    `${CURRENT_DRAFT_MARKER} — do not start from scratch.`,
    "Keep what still holds. Write over only what is marked WRONG or what the operator's question changes.",
    map,
  ].join("\n");
  const base = String(context || "").replace(/\s+$/, "");
  return base ? `${base}\n\n${block}` : block;
}

export function lessonFromTurn({ questions, markedSlides = [] } = {}) {
  const q = String(questions || "").trim();
  if (!q) return "";
  if (markedSlides.length) return `Slide ${markedSlides.map((i) => i + 1).join(", ")} marked wrong: ${q}`;
  if (CORRECT_RE.test(q)) return q;
  return "";
}
