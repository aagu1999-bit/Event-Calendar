import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APIFY_SLIDE_CAP,
  actorInputForDirectUrls,
  canonicalIgKey,
  indexApifyItems,
  instagramShortcode,
  lookupApifyItem,
  pickApifyCaption,
  pickApifyOwner,
  pickApifySlideUrls,
  uniqueDirectUrls,
} from "./apifyInstagram.js";

const A = "https://www.instagram.com/p/DAbc123xyz/";
const A_REEL = "https://www.instagram.com/reel/DAbc123xyz/?igsh=abc";
const B = "https://instagram.com/p/OtherPost99/";

describe("canonicalIgKey", () => {
  it("treats /p/ and /reel/ of the same shortcode as one post", () => {
    assert.equal(canonicalIgKey(A), "dabc123xyz");
    assert.equal(canonicalIgKey(A_REEL), canonicalIgKey(A));
  });
  it("reads share/p/ links", () => {
    assert.equal(instagramShortcode("https://www.instagram.com/share/p/DAbc123xyz/"), "DAbc123xyz");
    assert.equal(canonicalIgKey("https://www.instagram.com/share/p/DAbc123xyz/"), "dabc123xyz");
  });
});

describe("uniqueDirectUrls", () => {
  it("keeps one URL per shortcode and drops junk", () => {
    assert.deepEqual(uniqueDirectUrls([A, A_REEL, "not-a-url", B]), [A, B]);
  });
});

describe("actorInputForDirectUrls", () => {
  it("sends every post URL in one run with resultsLimit 1 (not a profile scrape)", () => {
    const input = actorInputForDirectUrls([A, B, A_REEL]);
    assert.deepEqual(input.directUrls, [A, B]);
    assert.equal(input.resultsType, "posts");
    assert.equal(input.resultsLimit, 1);
    assert.equal(input.addParentData, false);
  });
  it("keeps a 200-link weekend as one input list", () => {
    const urls = Array.from({ length: 200 }, (_, i) => `https://www.instagram.com/p/Post${String(i).padStart(3, "0")}xx/`);
    const input = actorInputForDirectUrls(urls);
    assert.equal(input.directUrls.length, 200);
    assert.equal(input.resultsLimit, 1);
  });
});

describe("indexApifyItems / lookupApifyItem", () => {
  it("maps a dataset row back to every pool share of that post", () => {
    const items = [{
      url: "https://www.instagram.com/p/DAbc123xyz/",
      shortCode: "DAbc123xyz",
      displayUrl: "https://cdn.example/cover.jpg",
      caption: "Friday at Newark",
      ownerUsername: "cge",
    }];
    const idx = indexApifyItems(items);
    assert.equal(lookupApifyItem(idx, A)?.caption, "Friday at Newark");
    assert.equal(lookupApifyItem(idx, A_REEL)?.ownerUsername, "cge");
    assert.equal(lookupApifyItem(idx, B), null);
  });
  it("skips error rows so a private post does not poison the map", () => {
    const idx = indexApifyItems([{ error: "private" }, { url: B, caption: "ok" }]);
    assert.equal(lookupApifyItem(idx, A), null);
    assert.equal(lookupApifyItem(idx, B)?.caption, "ok");
  });
});

describe("pickApifySlideUrls", () => {
  it("reads childPosts up to the carousel cap, skipping video", () => {
    const children = [];
    for (let i = 0; i < 12; i++) {
      children.push({ displayUrl: `https://cdn.example/s${i}.jpg` });
    }
    children[1] = { displayUrl: "https://cdn.example/clip.mp4" };
    const urls = pickApifySlideUrls({ childPosts: children, displayUrl: "https://cdn.example/cover.jpg" });
    assert.equal(urls.length, APIFY_SLIDE_CAP);
    assert.equal(urls[0], "https://cdn.example/s0.jpg");
    assert.ok(!urls.some((u) => u.endsWith(".mp4")));
  });
  it("falls back to the cover when there are no children", () => {
    assert.deepEqual(
      pickApifySlideUrls({ displayUrl: "https://cdn.example/cover.jpg" }),
      ["https://cdn.example/cover.jpg"],
    );
  });
});

describe("caption / owner", () => {
  it("trims caption and strips @ from the handle", () => {
    assert.equal(pickApifyCaption({ caption: "  hello  " }), "hello");
    assert.equal(pickApifyOwner({ ownerUsername: "@CentralGroup" }), "CentralGroup");
  });
});
