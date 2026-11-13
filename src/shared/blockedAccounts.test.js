import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBlockedIgHandle, stripBlockedIgLinks, scrubForWebsite, stripBlockedIgMentions, hasBlockedIgMention } from "./blockedAccounts.js";

describe("isBlockedIgHandle", () => {
  it("matches the handle however it is typed", () => {
    for (const h of ["kinnectnj", "@kinnectnj", "@@KinnectNJ", "  KINNECTNJ  "]) assert.equal(isBlockedIgHandle(h), true, h);
  });
  it("does not match other handles, links or blanks", () => {
    for (const h of ["kinnectnjevents", "kinnect_nj", "centralgroupevents", "https://instagram.com/kinnectnj", "", null, undefined]) {
      assert.equal(isBlockedIgHandle(h), false, String(h));
    }
  });
});

describe("stripBlockedIgLinks", () => {
  it("clears a field that is only a link to the account", () => {
    for (const u of [
      "https://www.instagram.com/kinnectnj/",
      "http://instagram.com/KinnectNJ",
      "instagram.com/kinnectnj?igsh=abc123",
      "https://m.instagram.com/kinnectnj/p/Cxyz/",
      "instagr.am/kinnectnj",
    ]) assert.equal(stripBlockedIgLinks(u), "", u);
  });
  it("leaves other links alone", () => {
    for (const u of [
      "https://instagram.com/kinnectnjevents",
      "https://instagram.com/centralgroupevents",
      "https://kinnectnj.com/tickets",
      "https://eventbrite.com/e/123",
    ]) assert.equal(stripBlockedIgLinks(u), u, u);
  });
  it("keeps the visible text of markdown and html links", () => {
    assert.equal(stripBlockedIgLinks("Follow [KinnectNJ](https://instagram.com/kinnectnj) now"), "Follow KinnectNJ now");
    assert.equal(stripBlockedIgLinks('See <a href="https://instagram.com/kinnectnj/">their page</a>.'), "See their page.");
  });
  it("drops a bare link inside a sentence and keeps the rest", () => {
    assert.equal(stripBlockedIgLinks("Tickets at https://eventbrite.com/e/1 or https://instagram.com/kinnectnj today").replace(/\s+/g, " "), "Tickets at https://eventbrite.com/e/1 or today");
  });
});

describe("scrubForWebsite", () => {
  it("cleans handles and links anywhere in a payload without touching the rest", () => {
    const payload = {
      events: [
        { title: "A", instagram_handle: "@kinnectnj", ticket_link: "https://instagram.com/kinnectnj/", venue: "Hall" },
        { title: "B", instagram_handle: "cryoutcave", ticket_link: "https://eventbrite.com/e/9" },
      ],
      body_content: "Hi [us](https://instagram.com/kinnectnj)",
      published: true,
      n: 3,
    };
    const out = scrubForWebsite(payload);
    assert.deepEqual(out.events[0], { title: "A", instagram_handle: "", ticket_link: "", venue: "Hall" });
    assert.deepEqual(out.events[1], payload.events[1]);
    assert.equal(out.body_content, "Hi us");
    assert.equal(out.published, true);
    assert.equal(out.n, 3);
    assert.equal(payload.events[0].instagram_handle, "@kinnectnj", "input is not mutated");
  });
});

describe("stripBlockedIgMentions", () => {
  it("turns the mention into plain text, keeping case and the sentence", () => {
    assert.equal(stripBlockedIgMentions("Thanks @kinnectnj!"), "Thanks kinnectnj!");
    assert.equal(stripBlockedIgMentions("@KinnectNJ and @cryoutcave"), "KinnectNJ and @cryoutcave");
    assert.equal(stripBlockedIgMentions("hosted by (@kinnectnj)"), "hosted by (kinnectnj)");
    assert.equal(stripBlockedIgMentions("line one\n@kinnectnj"), "line one\nkinnectnj");
  });
  it("handles a sentence-ending period and repeated mentions", () => {
    assert.equal(stripBlockedIgMentions("Big thanks to @kinnectnj."), "Big thanks to kinnectnj.");
    assert.equal(stripBlockedIgMentions("@kinnectnj @kinnectnj"), "kinnectnj kinnectnj");
  });
  it("leaves other accounts, emails, hashtags and look-alikes alone", () => {
    for (const t of ["@kinnectnjevents", "@kinnectnj.official", "@kinnectnj_nj", "mail a@kinnectnj.com", "#kinnectnj", "@centralgroupevents", ""]) {
      assert.equal(stripBlockedIgMentions(t), t, t);
    }
  });
  it("hasBlockedIgMention agrees", () => {
    assert.equal(hasBlockedIgMention("Thanks @KinnectNJ!"), true);
    assert.equal(hasBlockedIgMention("Thanks @cryoutcave!"), false);
    assert.equal(hasBlockedIgMention("@kinnectnjevents"), false);
  });
});
