---
name: cge-pipe
description: Use when adding, modifying, or debugging a data pipe between the CGE Tools app and centralgroupevents.com. Trigger on requests like "add a pipe", "sync X from the website", "send X to the website", "pipe 4", "new integration between the apps", "why did the website send back 4XX", or any work on `/api/website/*` server routes or `/api/integrations/*` website endpoints. Also trigger for adjacent work — batching a request that's hitting 413, deduping cross-app data, or handling website-side changes that need to be relayed to the other Replit agent. Codifies the server-proxy auth pattern (token stays server-side), client dedup + batching + pre/post checks, and the message-to-website-agent handoff for changes CGE Tools can't reach directly.
---

# CGE Pipe Convention

CGE Tools ↔ centralgroupevents.com pipes all follow the same shape. Every new
pipe reuses the pieces below so the operator gets one mental model instead of a
new UX per pipe, and so nothing slips past the safeguards that already caught
real bugs (413s, silent count mismatches, off-weekend imports).

## The two-app picture

- **This repo** (`aagu1999-bit/Event-Calendar`) is CGE Tools — the operator
  dashboard. React SPA + Node/Express `server.js` on Replit.
- **The website** (`centralgroupevents/Central-Group-Events`, out of scope for
  Claude) is the public site at centralgroupevents.com. React/TS + Express +
  Postgres on Replit Autoscale.
- Data pipes are the only integration point between them. Everything else lives
  in its own app.

## Why the server-proxy pattern

Both apps hold the same shared secret (`CGE_INTEGRATION_TOKEN`) as a Replit
Secret. `server.js` reads it as `INTEGRATION_TOKEN` and attaches it to every
outbound request. The browser never sees it — that's the whole point of the
proxy layer. A leaked token in a bundle would let anyone POST events or edit
guides on the live site.

If a pipe ever needs to skip the proxy ("just fetch directly, it's simpler"),
that's the moment to stop and add the server route. Simpler isn't worth
shipping the token to every user's devtools.

## Server route template (`server.js`)

Add near the other `/api/website/*` routes. Keep the parts in this order —
`INTEGRATION_TOKEN` guard first so a missing secret returns a helpful 503 with
a hint instead of surprising the operator with a 401 from the website.

```js
app.<method>("/api/website/<resource>", express.json({ limit: "4mb" }), async (req, res) => {
  if (!INTEGRATION_TOKEN) {
    return res.status(503).json({
      error: "not_configured",
      message: "Set CGE_INTEGRATION_TOKEN in this app's Replit Secrets (same value as the website).",
    });
  }
  try {
    const url = new URL(`${WEBSITE_BASE}/api/integrations/<resource>`);
    // For GET: forward whitelisted query params
    // for (const k of ["a", "b"]) if (req.query[k]) url.searchParams.set(k, req.query[k]);
    const r = await fetch(url, {
      method: "<METHOD>",
      headers: {
        Authorization: `Bearer ${INTEGRATION_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // For write methods:
      // body: JSON.stringify(req.body || {}),
    });
    const text = await r.text();
    if (!r.ok) {
      // 401 passes through so the client can tell the operator the tokens don't match.
      // Everything else collapses to 502 so a website blip doesn't look like a CGE bug.
      return res.status(r.status === 401 ? 401 : 502).json({
        error: "website_error",
        status: r.status,
        detail: text.slice(0, 300),
      });
    }
    let data; try { data = JSON.parse(text); } catch { data = {}; }
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "fetch_failed", message: String(e?.message || e) });
  }
});
```

Why 4mb: the website's Express default is ~100KB. We raised our proxy to 4mb to
handle photo uploads and batches of events without turning into the bottleneck.
The website side needs a matching bump when the payload is large.

## Client fetcher template

Fetches on the client stay tight — the server does the auth work, so the client
just needs a good error message and the pre/post-check surfaces the operator
now expects.

```jsx
const [busy, setBusy] = useState(false);
const [msg, setMsg] = useState(null); // { ok, text }

const doIt = async () => {
  if (busy) return;
  setBusy(true); setMsg(null);
  try {
    const r = await fetch("/api/website/<resource>", { /* method, body */ });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const hint = r.status === 503 ? "Add CGE_INTEGRATION_TOKEN in this app's Replit Secrets (same value as the website)."
        : r.status === 401 ? "Token mismatch — the website rejected it. Make sure both secrets are identical."
        : r.status === 413 ? "The website rejected the payload as too large — batch smaller or raise its express.json limit."
        : (j.message || j.detail || `Server responded ${r.status}`);
      throw new Error(hint);
    }
    // …use j…
  } catch (e) {
    setMsg({ ok: false, text: String(e?.message || e) });
  } finally { setBusy(false); }
};
```

Those specific hints exist because each of them has cost real debugging time.
Keep them — a helpful error message is cheaper than a support round-trip when
the operator's mid-weekend and everything's on fire.

## Dedup — pull pipes

Bookings and any other "pull from the website" pipe need a persistent seen-set
so already-imported rows don't march back in every time the operator clicks
Import. The pattern:

```js
const IMPORTED_KEY = "cge_imported_<resource>";
let seen;
try { seen = new Set(JSON.parse(localStorage.getItem(IMPORTED_KEY) || "[]")); }
catch { seen = new Set(); }

const fresh = [];
for (const row of incoming) {
  const ref = String(row.reference_id || row.id || "");
  if (!ref || seen.has(ref)) continue;
  // …optional filter (see below)…
  seen.add(ref);
  fresh.push(map(row));
}
try { localStorage.setItem(IMPORTED_KEY, JSON.stringify([...seen])); } catch {}
```

Use the STABLE server ID (`reference_id`, DB primary key) as the dedup key —
not the display name, not a hash of fields, since either can change between
pulls and cause re-imports.

## Filter-before-mark pattern

If a pull pipe has an optional filter (like the weekend filter on bookings) —
skip filtered rows WITHOUT adding them to `seen`. That way, toggling the
filter off later still pulls them in. The moment you mark them seen while
filtering, they're gone forever from that operator's device.

## Dedup — push pipes

Push pipes (calendar → website, guides → website) hand deduplication to the
website by upserting with a stable `source_id`. The website is authoritative;
re-sending updates rows instead of duplicating them. This is what makes
batching safe and lets the operator re-run a send if the first pass failed
partway through.

## Batching (writes)

Any list of more than ~20 items needs batching or it'll hit the website's body
limit. 25 events at ~12KB/batch is the tested-safe number.

```js
const BATCH = 25;
let done = 0;
let countReported = true;
for (let i = 0; i < payload.length; i += BATCH) {
  const chunk = payload.slice(i, i + BATCH);
  const r = await fetch("/api/website/<resource>", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: chunk }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(/* …with count-so-far in the message… */);
  if (typeof j.upserted === "number") done += j.upserted;
  else { done += chunk.length; countReported = false; }
  if (payload.length > BATCH) setMsg({ ok: true, text: `Sending… ${Math.min(i + BATCH, payload.length)}/${payload.length}` });
}
```

Show progress mid-batch — the operator's watching a bar and needs to know the
run is alive, especially on a 100+ event send.

## Pre-flight summary

Right before a destructive or bulk send, replace the one-line confirm with a
summary confirm. The purpose is to make invisible skips visible BEFORE the
send. Include:

- How many will send
- How many will be skipped and why (undated, missing region, etc.)
- Distribution of a key dimension (region, day, etc.)
- Any special flags (featured, published-live)

The rule of thumb: if the operator could get a surprise afterwards ("why did
only 1 go?"), that surprise belongs in the pre-flight so they can cancel and
fix instead of send-and-regret.

## Post-send read-back

Compare the website's confirmed upsert count against what was sent. Any gap
becomes a warning banner, not a silent success:

```js
if (countReported && done !== payload.length) {
  setMsg({ ok: false, text: `⚠ Sent ${payload.length} but website confirmed only ${done} — re-send to retry (upsert won't duplicate).` });
} else {
  setMsg({ ok: true, text: `✓ Sent ${payload.length}${countReported ? ` — all confirmed` : ` — delivered`}.` });
}
```

The `countReported` flag matters: if the website returns no count, don't
claim confirmation. Say "delivered" instead of "all confirmed saved" —
otherwise the operator loses trust in the check the first time it wrongly
turns green.

## Date handling — the weekend anchor

Weekend events in CGE Tools carry only a `day` (Fri/Sat/Sun) — the concrete
date is derived from the `friDate` anchor in the Review/Calendar toolbars via
`calcDates(friDate)`. Any pipe that sends to the website MUST derive the ISO
date before sending, or 90%+ of weekend events get dropped as "undated" (this
was a real bug — PR #88).

For push pipes: pass `weekendDates` into the mapper.
```js
const rawDate = String(ev.date || "").trim() || (weekendDates && weekendDates[ev.day]) || "";
const date = toISODate(rawDate); // YYYY-MM-DD
```

For pull pipes with a weekend filter: match on **month/day**, not full ISO.
The website may return ISO with a timezone offset that shifts the day; matching
on month/day is tolerant of that drift while still being specific enough.
```js
const mdOf = (raw) => {
  const s = String(raw || "").trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${parseInt(iso[2])}/${parseInt(iso[3])}`;
  const md = s.match(/^(\d{1,2})[/-](\d{1,2})/);
  if (md) return `${parseInt(md[1])}/${parseInt(md[2])}`;
  return null;
};
```

## When a change needs the website side

CGE Tools' Claude sessions can't touch the website repo, run its DB, or hit
its endpoints from the egress proxy. The moment a pipe needs a new column, a
new endpoint, or a schema tweak on the website, the answer is not to try
harder — it's to hand the operator a short, precise, copy-pasteable message to
relay to the website's Replit agent.

A good relay message names the endpoint, states the exact change (new field,
mapping, table, boolean), and describes what the operator should see afterwards
to know it's working. Keep it under a screen's worth of text — the operator is
mid-weekend, not reading a spec.

Example shape:
> The `/api/integrations/<resource>` endpoint should now accept a new field
> `foo` (boolean). Please map it onto `<table>.<column>`. After wiring, when I
> re-run the pipe from CGE Tools with `foo` on, the website should <observable
> behavior>.

## Ship flow

Every pipe change goes through the same ship loop:
1. Work on the designated branch (`claude/app-performance-crashes-jwqbon`)
2. `vite build` locally — there's no test suite; a clean build is the signal
3. Commit → push → open a PR → squash-merge to main
4. Reset local branch to `origin/main` for the next change
5. Operator redeploys Replit (or the site's Autoscale kicks over) — new pipes
   don't work until BOTH apps have deployed the matching code

If the pipe touches the website side too, mention in the PR body what the
website agent needs to do — the operator is the go-between.

## Naming conventions

- Server route: `/api/website/<resource>` (client-facing) → forwards to
  `/api/integrations/<resource>` (website)
- Client button: pull pipes read like intake ("⬇ Import bookings from
  website"), push pipes read like publish ("⬆ Send to website", "📄 Publish
  to Guide")
- localStorage dedup key: `cge_imported_<resource>` (pull side only)
- State: `<verb>Busy` / `<verb>Msg` (e.g. `importBusy`/`importMsg`,
  `sendBusy`/`sendMsg`, `pubBusy`/`msg`) — the operator recognizes the pattern
  across tabs

## The mistakes worth naming

- **413 request entity too large** — batch the send. The website's body limit
  is small.
- **401** — the two apps' `CGE_INTEGRATION_TOKEN` values don't match. Restart
  both after setting the secret; Replit doesn't hot-reload env vars.
- **Undated skips** — the mapper forgot to derive the date from `friDate`.
- **Silent success but nothing landed** — the post-send read-back is missing
  or is using the local count instead of the website's confirmed count.
- **Off-weekend rows never re-appear after toggling filter** — the filter
  marked them seen. Don't add to `seen` when you filter them out.
- **Blog post instead of Page (or wrong table)** — that's a website-endpoint
  bug, not a CGE bug. Confirm the CGE side is targeting the right endpoint,
  then relay to the website agent.
