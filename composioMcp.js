// Composio "consumer" keys (ck_…) authenticate Composio's hosted MCP endpoint
// through the x-consumer-api-key header. They are not accepted by the REST
// API (that wants a project key and an x-api-key header), so for these keys
// we run tools through the MCP meta-tool COMPOSIO_MULTI_EXECUTE_TOOL.
//
// Transport is MCP streamable HTTP: initialize → notifications/initialized →
// tools/call, with replies arriving as plain JSON or as an SSE stream.

const DEFAULT_MCP_URL = "https://connect.composio.dev/mcp";
const SESSION_TTL_MS = 10 * 60 * 1000;
const sessions = new Map(); // `${url}|${apiKey}` -> { id, at }

export function isConsumerKey(key) {
  return /^ck_/i.test(String(key || ""));
}

function mcpUrl(url) {
  return (url || process.env.COMPOSIO_MCP_URL || DEFAULT_MCP_URL).trim();
}

// A reply is either one JSON object or an SSE stream whose `data:` lines
// carry JSON-RPC messages. Return the last message that is a response.
export function parseRpcBody(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try { return JSON.parse(t); } catch { return null; }
  }
  let found = null;
  for (const block of t.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg && (msg.result !== undefined || msg.error !== undefined)) found = msg;
    } catch { /* not JSON, skip */ }
  }
  return found;
}

async function rpc({ url, apiKey, sessionId, body }) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "x-consumer-api-key": apiKey,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { res, text, msg: parseRpcBody(text) };
}

function detailFrom(msg, text) {
  const d = msg?.error?.message || msg?.error || text;
  return (typeof d === "string" ? d : JSON.stringify(d)).slice(0, 400);
}

async function ensureSession({ url, apiKey, force }) {
  const cacheKey = `${url}|${apiKey}`;
  const cached = sessions.get(cacheKey);
  if (cached && !force && Date.now() - cached.at < SESSION_TTL_MS) return cached.id;
  const init = await rpc({
    url, apiKey, sessionId: null,
    body: {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cge-tools", version: "1.0.0" } },
    },
  });
  if (!init.res.ok || init.msg?.error) {
    const err = new Error(`composio MCP initialize failed (HTTP ${init.res.status}): ${detailFrom(init.msg, init.text)}`);
    err.status = init.res.status;
    throw err;
  }
  const id = init.res.headers.get("mcp-session-id") || "";
  await rpc({ url, apiKey, sessionId: id, body: { jsonrpc: "2.0", method: "notifications/initialized" } }).catch(() => {});
  sessions.set(cacheKey, { id, at: Date.now() });
  return id;
}

export async function mcpCallTool({ apiKey, name, args, url }) {
  const endpoint = mcpUrl(url);
  for (let attempt = 0; attempt < 2; attempt++) {
    const sessionId = await ensureSession({ url: endpoint, apiKey, force: attempt > 0 });
    const { res, text, msg } = await rpc({
      url: endpoint, apiKey, sessionId,
      body: { jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } },
    });
    const sessionGone = res.status === 404 || (res.status === 400 && /session/i.test(text));
    if (sessionGone && attempt === 0) { sessions.delete(`${endpoint}|${apiKey}`); continue; }
    if (!res.ok || msg?.error) {
      const err = new Error(`composio MCP ${name} failed (HTTP ${res.status}): ${detailFrom(msg, text)}`);
      err.status = res.status;
      throw err;
    }
    if (!msg) throw new Error(`composio MCP ${name} returned an unreadable reply: ${text.slice(0, 300)}`);
    return msg.result;
  }
  throw new Error(`composio MCP ${name} failed: session could not be re-established`);
}

// Composio wraps tool output as JSON text inside MCP content blocks.
export function toolResultPayload(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const block = (result?.content || []).find((c) => c?.type === "text");
  if (!block) return null;
  try { return JSON.parse(block.text); } catch { return { raw: String(block.text).slice(0, 1000) }; }
}

function errorText(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") return c;
    if (typeof c?.message === "string") return c.message;
    return JSON.stringify(c);
  }
  return "";
}

// Runs one toolkit tool (e.g. INSTAGRAM_POST_IG_USER_MEDIA) on a connected
// account and returns the tool's own data, shaped like the REST path's
// result so callers can read `.response_data?.id || .data?.id || .id`.
export async function executeTool({ apiKey, toolSlug, account, args, url }) {
  const result = await mcpCallTool({
    apiKey, url, name: "COMPOSIO_MULTI_EXECUTE_TOOL",
    args: {
      tools: [{ tool_slug: toolSlug, arguments: args, account }],
      sync_response_to_workbench: false,
      thought: `CGE Tools: ${toolSlug}`,
      current_step: "CGE_TOOLS_PUBLISH",
    },
  });
  const payload = toolResultPayload(result);
  const results = payload?.data?.results ?? payload?.results;
  const first = Array.isArray(results) ? results[0] : null;
  const resp = first?.response ?? first ?? null;
  const failed = result?.isError || payload?.successful === false || resp?.successful === false || !!resp?.error || !!first?.error;
  if (failed) {
    const detail = errorText(resp?.error, first?.error, payload?.error, resp?.message, payload?.message)
      || JSON.stringify(payload ?? result).slice(0, 500);
    const err = new Error(`composio ${toolSlug} failed: ${detail}`);
    err.raw = payload;
    throw err;
  }
  if (!first) console.warn(`[composio mcp] ${toolSlug}: unexpected reply shape:`, JSON.stringify(payload).slice(0, 500));
  return resp?.data ?? resp ?? payload?.data ?? payload;
}

// Lists the connected accounts for a toolkit as { id, alias, status, ... }.
export async function listConnections({ apiKey, toolkit, url }) {
  const result = await mcpCallTool({
    apiKey, url, name: "COMPOSIO_MANAGE_CONNECTIONS",
    args: { toolkits: [{ name: toolkit, action: "list" }] },
  });
  const payload = toolResultPayload(result);
  if (result?.isError || payload?.successful === false) {
    throw new Error(`composio list connections failed: ${errorText(payload?.error, payload?.message) || JSON.stringify(payload).slice(0, 400)}`);
  }
  const accounts = payload?.data?.results?.[toolkit]?.accounts;
  return (Array.isArray(accounts) ? accounts : []).map((a) => ({
    id: a.id ?? null,
    alias: a.alias ?? null,
    status: a.status ?? null,
    is_default: a.is_default ?? null,
    username: a.user_info?.username ?? null,
  }));
}
