import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseSlideRedo, formatRedoWriterJob, repairSlideLeaks } from "./slideRedoJob.js";

test("cover wall + grant voice is a named job, not a mystery rewrite", () => {
  const diag = diagnoseSlideRedo({
    type: "cover",
    headline: "NEWARK'S CLUB ZANZIBAR ECHOES",
    subtitle: "A 2026 Newark Arts Festival installation revisits the legendary hub that shaped house music's global sound. From Rutgers research to oral histories, the legacy lives on, presenting the exhibition as a starting point for encountering Newark's Black house-music history.",
  }, { index: 0, slides: [{ type: "cover" }, { type: "news" }] });
  assert.equal(diag.leaks.some((l) => l.key === "cover-wall"), true);
  assert.equal(diag.leaks.some((l) => l.key === "grant"), true);
  assert.match(diag.see, /subtitle is a paragraph/i);
  assert.match(diag.redo, /one connecting line/i);
});

test("news bibliography dump names URL, source tag, markdown, and cut title", () => {
  const slides = [
    { type: "cover" },
    {
      type: "news",
      newsKicker: "QUEER SPACES",
      newsHeadline: "RUTGERS' NEWARK CLUB-MUSIC RESEARCH SHELF (UNIVERSITY — RUTG",
      newsBody: "Rutgers' Newark club-music research shelf (UNIVERSITY — Rutgers Libraries): Start with Jasmine A. Henry's 2022 dissertation, *Jersey Club: Race, Place and Black Independent Music-making*. https://libguides.rutgers.edu/c.php?g=336802",
    },
    {
      type: "news",
      newsHeadline: "THE NEWARK SOUND ORAL HISTORY",
    },
  ];
  const diag = diagnoseSlideRedo(slides[1], { index: 1, slides });
  const keys = diag.leaks.map((l) => l.key);
  assert.equal(keys.includes("url"), true);
  assert.equal(keys.includes("source-tag"), true);
  assert.equal(keys.includes("markdown"), true);
  assert.equal(keys.includes("truncated"), true);
  assert.equal(keys.includes("plant"), false);
  assert.match(diag.redo, /Drop the URL/);
  assert.equal(/make the new one clearly DIFFERENT/i.test(diag.redo), false);
});

test("KEEP THE SCOUT THESIS is scaffolding, not a source card", () => {
  const diag = diagnoseSlideRedo({
    type: "news",
    newsKicker: "RECORD SHOPS",
    newsHeadline: "KEEP THE SCOUT THESIS",
    newsBody: "Keep the scout thesis. The supplied leads retain a New Jersey-centered route.",
  }, { index: 2, slides: [{}, {}, {}, { newsHeadline: "Tony Humphries" }] });
  assert.equal(diag.leaks.some((l) => l.key === "scaffold"), true);
  assert.match(diag.see, /Homework or outline/);
  assert.match(diag.redo, /finished copy/);
});

test("brochure closer is named so Redo does not 'explore' again", () => {
  const diag = diagnoseSlideRedo({
    type: "cta",
    ctaKicker: "THE LEGACY CONTINUES",
    ctaDate: "Explore the new film and photography installation.",
  }, { index: 8 });
  assert.equal(diag.leaks.some((l) => l.key === "brochure-cta"), true);
  assert.match(diag.redo, /next step already on the desk/i);
});

test("a clean News chair tells you Redo will rewrite, not hunt a new leak", () => {
  const slides = [
    { type: "cover" },
    {
      type: "news",
      newsKicker: "THE HALL",
      newsHeadline: "Club Zanzibar",
      newsBody: "Club Zanzibar was the Newark room that trained the Jersey Sound. Last Saturday the 2026 Arts Festival put a film and photo installation on that floor.",
    },
    { type: "cta", ctaKicker: "THE NIGHT", ctaDate: "Comment EVENTS" },
  ];
  const diag = diagnoseSlideRedo(slides[1], { index: 1, slides });
  assert.equal(diag.leaks.some((l) => l.key === "url"), false);
  assert.equal(diag.leaks.some((l) => l.key === "scaffold"), false);
  assert.match(diag.redo, /Rewrite this chair only|Last sentence names the next START/);
});

test("writer job quotes the diagnosis instead of 'clearly DIFFERENT'", () => {
  const diag = diagnoseSlideRedo({
    type: "news",
    newsHeadline: "KEEP THE SCOUT THESIS",
    newsBody: "Keep the scout thesis.",
  }, { index: 5 });
  const job = formatRedoWriterJob(diag, { index: 5, slotType: "news" });
  assert.match(job, /WHAT IS WRONG/);
  assert.match(job, /WHAT REDO MUST DO/);
  assert.match(job, /Homework or outline/);
  assert.equal(/clearly DIFFERENT/i.test(job), false);
});

test("a closing payoff is not markdown; a missing plant is named", () => {
  const slides = [
    { type: "cover", headline: "NEWARK'S CLUB ZANZIBAR ECHOES ON." },
    {
      type: "news",
      newsKicker: "THE HALL",
      newsHeadline: "Club Zanzibar",
      newsBody: "Club Zanzibar was the Newark room that trained the Jersey Sound. *The 2026 installation put film back on that floor.*",
    },
    { type: "news", newsHeadline: "Henry's dissertation", newsBody: "Henry's 2022 Rutgers dissertation tracks the room." },
  ];
  const diag = diagnoseSlideRedo(slides[1], { index: 1, slides });
  assert.equal(diag.leaks.some((l) => l.key === "markdown"), false);
  assert.equal(diag.leaks.some((l) => l.key === "plant"), true);
  assert.match(diag.redo, /Henry/);
});

test("News after Cover that ignores the hook is a landing miss", () => {
  const slides = [
    { type: "cover", headline: "NEWARK'S CLUB ZANZIBAR ECHOES ON." },
    {
      type: "news",
      newsHeadline: "The exhibition",
      newsBody: "Going over the historical significance of the club in today's time.",
    },
  ];
  const diag = diagnoseSlideRedo(slides[1], { index: 1, slides });
  assert.equal(diag.leaks.some((l) => l.key === "landing"), true);
  assert.match(diag.redo, /lands/i);
});

test("question closer is named; relatedness omit blocks a plant", () => {
  const q = diagnoseSlideRedo({
    type: "cta",
    ctaKicker: "THE NEXT QUESTION",
    ctaDate: "How does Newark's club legacy inform today's music?",
  }, { index: 5 });
  assert.equal(q.leaks.some((l) => l.key === "question-cta"), true);

  const slides = [
    { type: "news", newsHeadline: "Equal Space", newsBody: "Equal Space hosts Tech Week. Henry's dissertation is next." },
    { type: "news", newsHeadline: "Henry's dissertation" },
  ];
  const blocked = diagnoseSlideRedo(slides[0], {
    index: 0,
    slides,
    context: "GAP — Fuel #1 × #2 · RELATED AS none. USE AS omit. Henry's dissertation.",
  });
  assert.equal(blocked.leaks.some((l) => l.key === "plant-blocked"), true);
  assert.equal(blocked.leaks.some((l) => l.key === "plant"), false);
});

test("last line that tells the next story is mash, not a plant", () => {
  const slides = [
    {
      type: "news",
      newsHeadline: "Club Zanzibar",
      newsBody: "Club Zanzibar trained the Jersey Sound. Jasmine A. Henry's 2022 Rutgers dissertation uses oral history and ethnography, includes a Zanzibar case study, and tracks contemporary Newark Jersey Club makers across public-space performances.",
    },
    { type: "news", newsHeadline: "Henry's dissertation" },
  ];
  const diag = diagnoseSlideRedo(slides[0], { index: 0, slides });
  assert.equal(diag.leaks.some((l) => l.key === "plant-mash"), true);
});

test("first-pass repair drops URLs and mid-body stars, keeps a payoff", () => {
  const cleaned = repairSlideLeaks({
    type: "news",
    newsHeadline: "**JASMINE A (UNIVERSITY — RUcore)**",
    newsBody: "Read *Jersey Club* at https://rucore.libraries.rutgers.edu/x *The dissertation is the local shelf.*",
  });
  assert.equal(/https?:/i.test(cleaned.newsBody), false);
  assert.equal(/\*/.test(cleaned.newsHeadline), false);
  assert.equal(/UNIVERSITY/.test(cleaned.newsHeadline), false);
  assert.match(cleaned.newsBody, /\*The dissertation is the local shelf\.\*/);
});

