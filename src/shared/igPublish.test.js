import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRejectedTagUsernames, createWithTagFallback, looksLikeTagError, parseHandleInput, splitIntoCarousels } from "./igPublish.js";

// Fake container call: rejects any body whose tags include a handle in `bad`.
// `named` controls whether the error names the offending users.
function fakeCreate(bad, { named }) {
  const calls = [];
  const create = async (body) => {
    calls.push(body);
    const hit = (body.user_tags || []).filter((t) => bad.includes(t.username)).map((t) => t.username);
    if (hit.length) {
      throw new Error(named
        ? `Instagram API error (status 400): Invalid user id - The following user(s) cannot be accessed: ${hit.join(", ")}`
        : "Instagram API error (status 400): Invalid parameter user_tags");
    }
    return { id: "container-1" };
  };
  return { create, calls };
}
const mk = (...names) => names.map((username) => ({ username, x: 0.5, y: 0.85 }));

const tags = [{ username: "cryoutcave" }, { username: "heythere" }, { username: "Other.Handle" }];

describe("parseRejectedTagUsernames", () => {
  it("reads the username from Instagram's invalid-user error", () => {
    const msg = "composio INSTAGRAM_POST_IG_USER_MEDIA failed: Instagram API error (status 400): Invalid user id - The following user(s) cannot be accessed: heythere";
    assert.deepEqual(parseRejectedTagUsernames(msg, tags), ["heythere"]);
  });

  it("handles several usernames, @ signs and trailing punctuation", () => {
    const msg = "Invalid user id - The following user(s) cannot be accessed: @heythere, other.handle.";
    assert.deepEqual(parseRejectedTagUsernames(msg, tags), ["heythere", "other.handle"]);
  });

  it("ignores usernames that were not actually sent", () => {
    const msg = "The following user(s) cannot be accessed: someoneelse";
    assert.deepEqual(parseRejectedTagUsernames(msg, tags), []);
  });

  it("returns nothing for unrelated errors", () => {
    assert.deepEqual(parseRejectedTagUsernames("Media could not be fetched", tags), []);
    assert.deepEqual(parseRejectedTagUsernames("", tags), []);
  });
});

describe("createWithTagFallback", () => {
  it("drops every handle Instagram names, across several rounds", async () => {
    const { create, calls } = fakeCreate(["heythere", "ghostacct"], { named: true });
    const dropped = new Set();
    const out = await createWithTagFallback({ create, payload: { image_url: "u", user_tags: mk("a", "heythere", "b", "ghostacct") }, dropped });
    assert.equal(out.id, "container-1");
    assert.deepEqual([...dropped].sort(), ["ghostacct", "heythere"]);
    assert.deepEqual(calls.at(-1).user_tags.map((t) => t.username), ["a", "b"]);
  });

  it("keeps valid tags when the error doesn't name anyone", async () => {
    const { create, calls } = fakeCreate(["bad1", "bad2"], { named: false });
    const dropped = new Set();
    const out = await createWithTagFallback({ create, payload: { image_url: "u", user_tags: mk("a", "bad1", "b", "bad2", "c") }, dropped });
    assert.equal(out.id, "container-1");
    assert.deepEqual([...dropped].sort(), ["bad1", "bad2"]);
    assert.deepEqual(calls.at(-1).user_tags.map((t) => t.username), ["a", "b", "c"]);
  });

  it("posts the slide untagged when every tag is bad", async () => {
    const { create, calls } = fakeCreate(["x", "y"], { named: false });
    const dropped = new Set();
    const out = await createWithTagFallback({ create, payload: { image_url: "u", user_tags: mk("x", "y") }, dropped });
    assert.equal(out.id, "container-1");
    assert.deepEqual([...dropped].sort(), ["x", "y"]);
    assert.equal("user_tags" in calls.at(-1), false);
  });

  it("passes through a clean slide with one call and nothing dropped", async () => {
    const { create, calls } = fakeCreate([], { named: true });
    const dropped = new Set();
    await createWithTagFallback({ create, payload: { image_url: "u", user_tags: mk("a", "b") }, dropped });
    assert.equal(calls.length, 1);
    assert.equal(dropped.size, 0);
  });

  it("rethrows errors that aren't about tags without retrying", async () => {
    let n = 0;
    const create = async () => { n++; throw new Error("The media could not be fetched from this URI"); };
    await assert.rejects(createWithTagFallback({ create, payload: { image_url: "u", user_tags: mk("a") }, dropped: new Set() }), /could not be fetched/);
    assert.equal(n, 1);
  });

  it("rethrows when there were no tags to blame", async () => {
    const create = async () => { throw new Error("Invalid user id"); };
    await assert.rejects(createWithTagFallback({ create, payload: { image_url: "u" }, dropped: new Set() }), /Invalid user id/);
  });
});

describe("looksLikeTagError", () => {
  it("separates tag errors from others", () => {
    assert.equal(looksLikeTagError("Invalid parameter user_tags"), true);
    assert.equal(looksLikeTagError("Invalid user id - cannot be accessed: x"), true);
    assert.equal(looksLikeTagError("The media could not be fetched"), false);
  });
});

describe("parseHandleInput", () => {
  it("splits on spaces, commas and semicolons and strips @", () => {
    assert.deepEqual(parseHandleInput("@a, b  @@c;d"), ["a", "b", "c", "d"]);
  });
  it("returns an empty list for blank input", () => {
    assert.deepEqual(parseHandleInput("  "), []);
    assert.deepEqual(parseHandleInput(undefined), []);
  });
});

describe("splitIntoCarousels", () => {
  const nums = (n) => Array.from({ length: n }, (_, i) => i + 1);
  it("leaves 10 or fewer as one carousel", () => {
    assert.deepEqual(splitIntoCarousels(nums(10)).map((g) => g.length), [10]);
    assert.deepEqual(splitIntoCarousels(nums(2)).map((g) => g.length), [2]);
  });
  it("splits evenly, never leaving a 1-slide tail", () => {
    assert.deepEqual(splitIntoCarousels(nums(13)).map((g) => g.length), [7, 6]);
    assert.deepEqual(splitIntoCarousels(nums(11)).map((g) => g.length), [6, 5]);
    assert.deepEqual(splitIntoCarousels(nums(21)).map((g) => g.length), [7, 7, 7]);
  });
  it("keeps every item, in order", () => {
    assert.deepEqual(splitIntoCarousels(nums(13)).flat(), nums(13));
  });
  it("returns nothing for an empty list", () => {
    assert.deepEqual(splitIntoCarousels([]), []);
  });
});
