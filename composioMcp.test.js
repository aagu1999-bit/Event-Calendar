import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { isConsumerKey, parseRpcBody, executeTool, listConnections } from "./composioMcp.js";

const KEY = "ck_test_key";
let server, url, calls, expireNextSession, toolReply, sseMode;

function readBody(req) {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s ? JSON.parse(s) : null));
  });
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    calls.push({ method: body?.method, headers: req.headers, body });
    if (req.headers["x-consumer-api-key"] !== KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "Invalid API key" } }));
    }
    if (body.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json", "mcp-session-id": "sess-" + calls.length });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }));
    }
    if (body.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (body.method === "tools/call") {
      if (expireNextSession) { expireNextSession = false; res.writeHead(404); return res.end("session not found"); }
      const msg = { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(toolReply(body.params)) }] } };
      if (sseMode) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        return res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(msg));
    }
    res.writeHead(400); res.end();
  });
  await new Promise((r) => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}/mcp`;
});
after(() => server.close());

const reset = () => { calls = []; expireNextSession = false; sseMode = false; };
const okReply = (data) => () => ({ successful: true, data: { results: [{ tool_slug: "X", response: { successful: true, data } }] } });

describe("isConsumerKey / parseRpcBody", () => {
  it("recognises ck_ keys only", () => {
    assert.equal(isConsumerKey("ck_abc"), true);
    assert.equal(isConsumerKey("ak_abc"), false);
    assert.equal(isConsumerKey(""), false);
  });
  it("parses plain JSON and SSE bodies", () => {
    assert.equal(parseRpcBody('{"id":1,"result":{}}').id, 1);
    assert.equal(parseRpcBody('event: message\ndata: {"id":2,"result":{"a":1}}\n\n').result.a, 1);
    assert.equal(parseRpcBody(""), null);
  });
});

describe("executeTool", () => {
  it("runs a tool, sends the account and key, and unwraps the data", async () => {
    reset();
    toolReply = okReply({ response_data: { id: "999" } });
    const out = await executeTool({ apiKey: KEY, url, toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA", account: "instagram_armado-incite", args: { ig_user_id: "1" } });
    assert.equal(out.response_data.id, "999");
    const call = calls.find((c) => c.method === "tools/call");
    assert.equal(call.body.params.name, "COMPOSIO_MULTI_EXECUTE_TOOL");
    assert.deepEqual(call.body.params.arguments.tools[0], { tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA", arguments: { ig_user_id: "1" }, account: "instagram_armado-incite" });
    assert.equal(call.body.params.arguments.sync_response_to_workbench, false);
    assert.ok(call.headers["mcp-session-id"]);
  });

  it("reads SSE replies and reuses the session across calls", async () => {
    reset(); sseMode = true;
    toolReply = okReply({ id: "7" });
    await executeTool({ apiKey: KEY, url, toolSlug: "A", account: "a", args: {} });
    await executeTool({ apiKey: KEY, url, toolSlug: "B", account: "a", args: {} });
    assert.equal(calls.filter((c) => c.method === "initialize").length, 0, "session cached from earlier test");
    assert.equal(calls.filter((c) => c.method === "tools/call").length, 2);
  });

  it("re-initialises once when the session has expired", async () => {
    reset(); expireNextSession = true;
    toolReply = okReply({ id: "8" });
    const out = await executeTool({ apiKey: KEY, url, toolSlug: "A", account: "a", args: {} });
    assert.equal(out.id, "8");
    assert.equal(calls.filter((c) => c.method === "initialize").length, 1);
    assert.equal(calls.filter((c) => c.method === "tools/call").length, 2);
  });

  it("surfaces the tool's own error message", async () => {
    reset();
    toolReply = () => ({ successful: true, data: { results: [{ tool_slug: "X", response: { successful: false, error: "Media could not be fetched" } }] } });
    await assert.rejects(
      executeTool({ apiKey: KEY, url, toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA", account: "a", args: {} }),
      /INSTAGRAM_POST_IG_USER_MEDIA failed: Media could not be fetched/
    );
  });

  it("reports a rejected key with the HTTP status", async () => {
    reset();
    await assert.rejects(
      executeTool({ apiKey: "ck_wrong", url, toolSlug: "A", account: "a", args: {} }),
      /initialize failed \(HTTP 401\): Invalid API key/
    );
  });
});

describe("listConnections", () => {
  it("returns id, alias, status and username for each account", async () => {
    reset();
    toolReply = () => ({ successful: true, data: { results: { instagram: { accounts: [
      { id: "instagram_armado-incite", alias: "cge", status: "active", is_default: true, user_info: { username: "centralgroupevents" } },
    ] } } } });
    const list = await listConnections({ apiKey: KEY, url, toolkit: "instagram" });
    assert.deepEqual(list, [{ id: "instagram_armado-incite", alias: "cge", status: "active", is_default: true, username: "centralgroupevents" }]);
  });
});
