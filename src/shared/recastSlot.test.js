import test from "node:test";
import assert from "node:assert/strict";
import { recastSlot, PREVIEW_RECAST_TYPES } from "./recastSlot.js";

test("essay types only — no flyer catalog", () => {
  assert.deepEqual(PREVIEW_RECAST_TYPES, ["cover", "news", "text", "cta"]);
  const news = { type: "news", newsHeadline: "The vote", newsBody: "Tuesday." };
  assert.equal(recastSlot(news, "stat"), news);
  assert.equal(recastSlot(news, "poster"), news);
});

test("same type is a no-op", () => {
  const news = { type: "news", newsHeadline: "The vote", newsBody: "Tuesday." };
  assert.equal(recastSlot(news, "news"), news);
});

test("News ↔ Text keeps the sentences; kicker drops on Text", () => {
  const news = {
    type: "news",
    newsKicker: "THE VOTE",
    newsHeadline: "Council voted Tuesday",
    newsBody: "Doors start at 7.",
  };
  const text = recastSlot(news, "text");
  assert.deepEqual(text, {
    type: "text",
    textTitle: "Council voted Tuesday",
    textBody: "Doors start at 7.",
  });
  const back = recastSlot(text, "news");
  assert.equal(back.newsHeadline, "Council voted Tuesday");
  assert.equal(back.newsBody, "Doors start at 7.");
  assert.equal(back.newsKicker, "");
});

test("Cover ↔ News maps headline/subtitle to newsHeadline/newsBody", () => {
  const cover = { type: "cover", headline: "THE CAP HELD", subtitle: "The restaurant cannot pour." };
  const news = recastSlot(cover, "news");
  assert.deepEqual(news, {
    type: "news",
    newsKicker: "",
    newsHeadline: "THE CAP HELD",
    newsBody: "The restaurant cannot pour.",
  });
  const back = recastSlot(news, "cover");
  assert.deepEqual(back, {
    type: "cover",
    headline: "THE CAP HELD",
    subtitle: "The restaurant cannot pour.",
  });
});

test("CTA keeps date / venue / url when recast into it", () => {
  const news = {
    type: "news",
    newsKicker: "THE ROOM",
    newsHeadline: "Comment EVENTS",
    newsBody: "The map is in the DM.",
  };
  const cta = recastSlot(news, "cta");
  assert.equal(cta.type, "cta");
  assert.equal(cta.ctaDate, "Comment EVENTS");
  assert.equal(cta.ctaVenue, "The map is in the DM.");
  assert.equal(cta.ctaKicker, "THE ROOM");
  const withUrl = recastSlot({ type: "cta", ctaDate: "GO", ctaVenue: "Cranford", ctaUrl: "centralgroupevents.com" }, "news");
  const back = recastSlot(withUrl, "cta");
  assert.equal(back.ctaUrl, "centralgroupevents.com");
  assert.equal(back.ctaDate, "GO");
  assert.equal(back.ctaVenue, "Cranford");
});

test("Text ↔ Cover maps title/body to headline/subtitle", () => {
  const text = { type: "text", textTitle: "Who this is for", textBody: "Operators already on the desk." };
  const cover = recastSlot(text, "cover");
  assert.deepEqual(cover, {
    type: "cover",
    headline: "Who this is for",
    subtitle: "Operators already on the desk.",
  });
});
