import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseSlideRedo, formatRedoWriterJob, repairSlideLeaks, normalizeNewsLabel, chairsNeedingAutoRepair, rescueChoppedTitle, rescueCutTitles, titleLooksChopped } from "./slideRedoJob.js";

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

test("News labels normalize to ALL CAPS; body stays mixed", () => {
  assert.equal(normalizeNewsLabel("Club Zanzibar"), "CLUB ZANZIBAR");
  assert.equal(normalizeNewsLabel("THE HALL"), "THE HALL");
  assert.equal(normalizeNewsLabel("  henry's dissertation  "), "HENRY'S DISSERTATION");
  assert.equal(normalizeNewsLabel(""), "");
  const cleaned = repairSlideLeaks({
    type: "news",
    newsKicker: "the hall",
    newsHeadline: "Club Zanzibar",
    newsBody: "Club Zanzibar trained the Jersey Sound.",
  });
  assert.equal(cleaned.newsKicker, "THE HALL");
  assert.equal(cleaned.newsHeadline, "CLUB ZANZIBAR");
  assert.match(cleaned.newsBody, /Club Zanzibar trained/);
});

test("auto-repair skips a missing plant and caps dump chairs at 4", () => {
  const slides = [
    {
      type: "cover",
      headline: "HOOK",
      subtitle: "A starting point for encountering Newark's Black house-music history with a 2026 Newark Arts Festival installation revisiting the legendary hub that shaped the sound.",
    },
    { type: "news", newsHeadline: "RUTGERS' NEWARK CLUB-MUSIC RESEARCH SHELF (UNIVERSITY — R", newsBody: "Body one." },
    { type: "news", newsHeadline: "This is a long sentence that belongs in the body not the title field of the card", newsBody: "Body two." },
    { type: "cta", ctaDate: "How does Newark inform today's music?" },
    { type: "news", newsHeadline: "KEEP THE SCOUT THESIS", newsBody: "Keep the scout thesis." },
    { type: "news", newsHeadline: "THE CLEAN CARD", newsBody: "A clean receipt with no plant of the next card." },
    { type: "news", newsHeadline: "NEXT START", newsBody: "Next." },
  ];
  const chairs = chairsNeedingAutoRepair(slides);
  assert.equal(chairs.length, 4);
  assert.equal(chairs.every((c) => !c.keys.includes("plant")), true);
  assert.equal(chairs.some((c) => c.index === 5), false);
  const plantOnly = chairsNeedingAutoRepair([
    { type: "news", newsHeadline: "THE HALL", newsBody: "A clean receipt." },
    { type: "news", newsHeadline: "TONY HUMPHRIES", newsBody: "Tony kept the Friday night." },
  ]);
  assert.equal(plantOnly.length, 0);
});

test("empty News bodies all auto-repair, on top of the dump cap", () => {
  const slides = [
    { type: "cover", headline: "HOOK", subtitle: "One line." },
    { type: "news", newsKicker: "ONE", newsHeadline: "FIRST START", newsBody: "" },
    { type: "news", newsKicker: "TWO", newsHeadline: "SECOND START", newsBody: "" },
    { type: "news", newsKicker: "THREE", newsHeadline: "THIRD START", newsBody: "" },
    { type: "news", newsKicker: "FOUR", newsHeadline: "FOURTH START", newsBody: "" },
    { type: "news", newsKicker: "FIVE", newsHeadline: "FIFTH START", newsBody: "" },
    { type: "cta", ctaDate: "How does Newark inform today's music?" },
  ];
  const chairs = chairsNeedingAutoRepair(slides);
  const empty = chairs.filter((c) => c.keys.includes("empty-news"));
  assert.equal(empty.length, 5);
  assert.equal(chairs.some((c) => c.keys.includes("question-cta")), true);
});

test("a schema-chopped headline becomes the quoted title it was naming", () => {
  const chopped = "NEWARK’S “A HOUSE CALLED ZANZIBAR” EXHIBITION PUTS A SPECIFI";
  assert.equal(titleLooksChopped(chopped), true);
  assert.equal(rescueChoppedTitle(chopped), "NEWARK’S “A HOUSE CALLED ZANZIBAR” EXHIBITION");
});

test("a chop inside an open source tag keeps the name before it", () => {
  const chopped = "RUTGERS' NEWARK CLUB-MUSIC RESEARCH SHELF (UNIVERSITY — RUTG";
  assert.equal(rescueChoppedTitle(chopped), "RUTGERS' NEWARK CLUB-MUSIC RESEARCH SHELF");
});

test("whole headlines under the cap are left alone", () => {
  const slides = [
    { type: "news", newsHeadline: "HENRY'S DISSERTATION", newsBody: "Body." },
    { type: "news", newsHeadline: "THE QUEER NEWARK ORAL HISTORY PROJECT KEEPS RECORDING", newsBody: "Body." },
    { type: "cta", ctaDate: "A LONG CLOSER LINE THAT IS NOT A TITLE FIELD AND CAN WRAP ON THE CANVAS" },
  ];
  assert.deepEqual(rescueCutTitles(slides), slides);
});

test("a chopped headline with no clean name is dropped and flagged, body kept", () => {
  const chopped = "WHY THE CLUB'S SOUND TRAVELED FURTHER THAN ANYONE IN NEWARK EXPE";
  assert.ok(chopped.length >= 57);
  const [out] = rescueCutTitles([{ type: "news", newsKicker: "THE REACH", newsHeadline: chopped, newsBody: "The body stays." }]);
  assert.equal(out.newsHeadline, "");
  assert.equal(out.newsBody, "The body stays.");
  assert.equal(out._warnings[0].type, "title_rescued");
  assert.match(out._warnings[0].message, /removed/);
});

test("a chopped cover headline keeps its whole words instead of disappearing", () => {
  const chopped = "WHY THE CLUB'S SOUND TRAVELED FURTHER THAN ANYONE IN NEWARK EXPE";
  const [out] = rescueCutTitles([{ type: "cover", headline: chopped, subtitle: "One line." }]);
  assert.equal(out.headline, "WHY THE CLUB'S SOUND TRAVELED FURTHER THAN ANYONE IN NEWARK");
  assert.equal(out._warnings[0].type, "title_rescued");
});
