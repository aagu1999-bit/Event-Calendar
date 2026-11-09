import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRejectedTagUsernames } from "./igPublish.js";

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
