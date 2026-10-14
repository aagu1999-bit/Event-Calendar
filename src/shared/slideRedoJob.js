// What Redo will actually do on THIS chair — named before the click.
//
// Default Redo used to say "make it clearly DIFFERENT" and nothing else,
// so the operator could not tell whether it would fix the cut-off title,
// drop a URL, or just reshuffle the same Fuel line. Diagnose the leaks
// on the card, show them, and send that job into the rewrite.

import { plantZone } from "./slideBridge.js";

const URL_RE = /https?:\/\/\S+/i;
const MD_STAR_RE = /\*[^*\n]{2,}\*/;
const SOURCE_TAG_RE = /\((?:UNIVERSITY|CULTURAL|SPECIALIST|COMMUNITY\s+HIST)[^)]*\)/i;
const SCAFFOLD_RE = /\b(?:KEEP THE SCOUT THESIS|SCOUT THESIS|\bTHESIS\b|\bBEAT:|\bTHE LOG\b|\bTHE BIGGER PICTURE\b|\bTHE STORY\b|\bTHE FRAME\b|\bTHE CONTEXT\b)\b/i;
const BROCHURE_RE = /\b(?:explore the|legacy continues|learn more|find out more|link in bio|the journey|must-visit)\b/i;
const GRANT_RE = /\b(?:starting point for encountering|burgeoning|highlights the|future potential|vibrant community)\b/i;

function words(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

function headlineLooksCut(text) {
  const h = String(text || "").trim();
  if (!h) return false;
  // newsHeadline maxLength is 60 — hitting the rail is a chop, not a style.
  if (h.length >= 55) return true;
  if (/\([^)]*$/.test(h) && !h.endsWith(")")) return true;
  return false;
}

function headlineIsASentence(text) {
  const h = String(text || "").trim();
  if (words(h).length > 12) return true;
  return /[.!?].+/.test(h);
}

function bodyRepeatsHeadline(headline, body) {
  const h = String(headline || "").trim().toLowerCase().replace(/[.!?]$/, "");
  const b = String(body || "").trim().toLowerCase();
  if (h.length < 22 || !b) return false;
  return b.startsWith(h.slice(0, Math.min(40, h.length)));
}

function blobOf(slide) {
  if (!slide || typeof slide !== "object") return "";
  return [
    slide.headline, slide.subtitle,
    slide.newsKicker, slide.newsHeadline, slide.newsBody,
    slide.textTitle, slide.textBody,
    slide.ctaKicker, slide.ctaDate, slide.ctaVenue,
  ].map((s) => String(s || "")).join("\n");
}

function nextName(slides, idx) {
  const next = Array.isArray(slides) ? slides[idx + 1] : null;
  const t = String(next?.type || "").toLowerCase();
  if (t !== "news" && t !== "text") return "";
  return String(
    next.newsHeadline || next.textTitle || next.newsKicker || "",
  ).replace(/\s+/g, " ").trim().slice(0, 80);
}

export function diagnoseSlideRedo(slide, { index = 0, slides = [] } = {}) {
  const leaks = [];
  const type = String(slide?.type || "").toLowerCase();
  const blob = blobOf(slide);
  const headline = String(
    type === "cover" ? slide?.headline
      : type === "news" ? slide?.newsHeadline
        : type === "text" ? slide?.textTitle
          : type === "cta" ? slide?.ctaDate
            : "",
  ).trim();
  const body = String(
    type === "cover" ? slide?.subtitle
      : type === "news" ? slide?.newsBody
        : type === "text" ? slide?.textBody
          : type === "cta" ? slide?.ctaVenue
            : "",
  ).trim();

  if (SCAFFOLD_RE.test(blob)) {
    leaks.push({
      key: "scaffold",
      see: "Homework or outline copy is on the card (THESIS / scout / THE LOG).",
      fix: "Write finished copy. Do not print THESIS, BEAT, scout notes, or THE LOG.",
    });
  }
  if (URL_RE.test(blob)) {
    leaks.push({
      key: "url",
      see: "A URL is on the image — nobody can tap it, and it is probably cut off.",
      fix: "Drop the URL. Name the source (the dissertation, the oral history, the radio show) in the body.",
    });
  }
  if (MD_STAR_RE.test(blob)) {
    leaks.push({
      key: "markdown",
      see: "Markdown stars are showing as stars.",
      fix: "Drop the *asterisks*. Use the name in plain words. One *payoff* line at the end is enough if the desk already has that payoff.",
    });
  }
  if (SOURCE_TAG_RE.test(blob)) {
    leaks.push({
      key: "source-tag",
      see: "A catalog tag is in the title — (UNIVERSITY — …), (CULTURAL / SPECIALIST).",
      fix: "Title names the work. Body says what it is (a library guide, an oral history, a radio account). No parenthetical source-type stamp.",
    });
  }
  if (headlineLooksCut(headline)) {
    leaks.push({
      key: "truncated",
      see: "The headline is cut off mid-word.",
      fix: "Shorten the headline to a name that fits. Move the rest into the body.",
    });
  } else if (headlineIsASentence(headline)) {
    leaks.push({
      key: "title-as-body",
      see: "The headline is a sentence, not a label.",
      fix: "Headline is 2–7 words naming the thing. Body carries the sentence.",
    });
  }
  if (bodyRepeatsHeadline(headline, body)) {
    leaks.push({
      key: "repeat",
      see: "The body repeats the headline.",
      fix: "Body adds the receipt. Do not open by restating the title.",
    });
  }
  if (type === "cover" && words(body).length > 22) {
    leaks.push({
      key: "cover-wall",
      see: "Cover subtitle is a paragraph. On export it stacks above the title and buries the hook.",
      fix: "Headline is the hook. Subtitle is one connecting line — who / where / when — not the essay.",
    });
  }
  if (GRANT_RE.test(blob)) {
    leaks.push({
      key: "grant",
      see: "Grantwriter / brochure phrasing is on the card.",
      fix: "Name the installation, the club, the year. No 'encountering' / 'burgeoning' / 'highlights the'.",
    });
  }
  if (type === "cta" && BROCHURE_RE.test(blob)) {
    leaks.push({
      key: "brochure-cta",
      see: "The closer is a brochure door.",
      fix: "A next step already on the desk (the named installation, a night, comment EVENTS). Not 'explore' / 'legacy continues'.",
    });
  }
  if (type === "news" && !String(slide?.newsBody || "").trim()) {
    leaks.push({
      key: "empty-news",
      see: "News body is empty.",
      fix: "Write this START into the body. Kicker is only the eyebrow.",
    });
  }

  const next = nextName(slides, index);
  const canPlant = (type === "news" || type === "text") && next && !leaks.some((l) => l.key === "scaffold");
  if (canPlant) {
    const last = plantZone(body).last.toLowerCase();
    const needle = next.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim().split(/\s+/).slice(0, 3).join(" ");
    const planted = needle.length >= 8 && last.includes(needle.slice(0, Math.min(18, needle.length)));
    if (!planted) {
      leaks.push({
        key: "plant",
        see: "Last line does not hand the next card to the reader.",
        fix: `Last sentence names the next START and what it is ("${next}"), not a second receipt.`,
      });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const leak of leaks) {
    if (seen.has(leak.key)) continue;
    seen.add(leak.key);
    unique.push(leak);
  }

  if (!unique.length) {
    return {
      leaks: [],
      see: "No named leak on this chair.",
      redo: next && (type === "news" || type === "text")
        ? `Rewrite this chair only. Keep the same Fuel receipt. Different wording, not a rephrase. Last sentence plants "${next}" and says what it is.`
        : "Rewrite this chair only. Keep the same Fuel receipt. Different wording, not a rephrase.",
    };
  }

  return {
    leaks: unique,
    see: unique.map((l) => l.see).join(" "),
    redo: unique.map((l) => l.fix).join(" "),
  };
}

export function formatRedoWriterJob(diag, { index = 0, slotType = "news" } = {}) {
  const d = diag && typeof diag === "object" ? diag : { see: "", redo: "" };
  return [
    `YOUR JOB: rewrite ONLY slide ${index + 1} as a ${slotType} card.`,
    `WHAT IS WRONG ON THIS CARD: ${d.see || "no named leak."}`,
    `WHAT REDO MUST DO: ${d.redo}`,
    "Keep every other slide's facts off this body except a last-line plant of the next In START.",
    "Do not invent a second receipt. Do not print URLs. Do not print THESIS / scout / UNIVERSITY tags.",
  ].join(" ");
}
