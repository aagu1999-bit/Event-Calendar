import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyShare, isInstagramUrl, pickShareUrl } from "./shareIntake.js";

const STUB = "data:image/jpeg;base64";
const REAL = "data:image/jpeg;base64," + Buffer.alloc(64, 0xff).toString("base64");
const IG = "https://www.instagram.com/p/DAbc123xyz/";

describe("pickShareUrl", () => {
  it("reads sourceUrl", () => {
    assert.equal(pickShareUrl({ sourceUrl: IG }), IG);
  });
  it("reads url / link aliases the Shortcut might send", () => {
    assert.equal(pickShareUrl({ url: IG }), IG);
    assert.equal(pickShareUrl({ link: IG }), IG);
    assert.equal(pickShareUrl({ urls: [IG] }), IG);
  });
  it("pulls an Instagram URL out of caption text", () => {
    assert.equal(pickShareUrl({ caption: `makejerseyhouseagain ${IG} come vibe` }), IG);
  });
  it("treats a URL stuffed into imageDataUrl as the post link", () => {
    assert.equal(pickShareUrl({ imageDataUrl: IG }), IG);
  });
  it("ignores data: stubs", () => {
    assert.equal(pickShareUrl({ imageDataUrl: STUB }), null);
  });
  it("reads a URL nested the way Shortcuts serializes magic variables", () => {
    assert.equal(pickShareUrl({
      imageDataUrl: STUB,
      sourceUrl: { string: IG, WFSerializationType: "WFTextTokenAttachment" },
    }), IG);
  });
  it("reads a schemeless instagram.com/p/… link", () => {
    assert.equal(pickShareUrl({ text: "instagram.com/p/DAbc123xyz/" }), "https://instagram.com/p/DAbc123xyz/");
  });
  it("reads urls as a string, not only an array", () => {
    assert.equal(pickShareUrl({ urls: IG }), IG);
  });
});

describe("classifyShare", () => {
  it("drops a stub preview when the Instagram URL is present", () => {
    const c = classifyShare({ imageDataUrl: STUB, sourceUrl: IG });
    assert.equal(c.url, IG);
    assert.equal(c.instagram, true);
    assert.equal(c.imageDataUrl, null);
    assert.equal(c.persistPhoto, false);
    assert.equal(c.stubImage, true);
  });
  it("does not persist a real cover photo for an Instagram URL", () => {
    const c = classifyShare({ imageDataUrl: REAL, sourceUrl: IG });
    assert.equal(c.instagram, true);
    assert.equal(c.imageDataUrl, REAL);
    assert.equal(c.persistPhoto, false);
  });
  it("persists a real camera-roll photo with no URL", () => {
    const c = classifyShare({ imageDataUrl: REAL });
    assert.equal(c.url, null);
    assert.equal(c.persistPhoto, true);
  });
  it("keeps a non-IG URL share as a link", () => {
    const c = classifyShare({ sourceUrl: "https://beachhaus.com/events" });
    assert.equal(c.instagram, false);
    assert.equal(c.persistPhoto, false);
  });
  it("picks a query-string URL when the JSON body is only a stub image", () => {
    const c = classifyShare({ imageDataUrl: STUB }, { url: IG });
    assert.equal(c.url, IG);
    assert.equal(c.instagram, true);
    assert.equal(c.persistPhoto, false);
  });
});

describe("isInstagramUrl", () => {
  it("matches p / reel hosts", () => {
    assert.equal(isInstagramUrl(IG), true);
    assert.equal(isInstagramUrl("https://www.instagram.com/reel/xyz/"), true);
    assert.equal(isInstagramUrl("https://beachhaus.com"), false);
  });
});
