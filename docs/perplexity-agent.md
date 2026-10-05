# Perplexity Agent research

The existing Curatorial Matrix **Fuel Research** button uses the official
`@perplexity-ai/perplexity_ai` SDK's `responses.create` method (Agent API;
`/v1/responses` is the documented compatibility alias for `/v1/agent`).
It uses the `low` preset and two filtered `web_search` desks (official
`.gov` / library / university, then a growable argument bank of Black
NJ press — Echo, Front Runner, Five Wards, Public Square, The Positive
Community, NJ Uncovered (Facebook / YouTube / Instagram) — plus Rutgers /
Montclair / Princeton pages and Current Affairs as pop-culture / societal
altitude, not the specimen; not halls, Essence, or an adjacent NYC week).
A look-through pass then opens leftover local press that missed the
20-domain cap (More Jersey, South Jersey Journal, We Are Jersey Ent,
Ark Republic, Shelterforce, Trenton Journal, plus independent hosts)
and halls/national magazines only when the topic would actually show
up there. Those halls can confirm a door. They still cannot authorize.
Desk B now asks for a magazine brief (friction, named mechanism, one
NJ specimen, next question) instead of a pile of venue facts. Open
web search is allowed only after the desks, to name the specimen.
It requests a JSON schema and reads
the SDK's `output_text`. Search results and text annotations supply
source URLs; the UI classifies them OFFICIAL / CULTURAL / PRESS / UNRANKED.

Set `PERPLEXITY_API_KEY` as a server-side secret. Never use a `VITE_` key
or put it in a browser request. The former Sonar `PERPLEXITY_MODEL` override
is no longer used. Research uses the low preset rather than a fixed model.

## Example

With the application running, call the same endpoint used by the UI:

```sh
curl -X POST "https://YOUR_APP_HOST/api/matrix/research" \
  -H 'Content-Type: application/json' \
  -d '{"topic":"Newark Penn Station","cluster":"New Jersey transit","existingBullets":[]}'
```

Success returns `{ok, bullets, citations, model}`. Sources are supplied for
editorial verification; this does not guarantee that every claim is accurate.
Requests may incur Perplexity token and tool charges.

The SDK has a 60-second attempt timeout and one transient retry, with
Retry-After handling. Exhausted rate limits return HTTP 429 and Retry-After.
Authentication failures return 401; upstream/network errors 502; timeouts
504; insufficient evidence 422. Provider error bodies are not exposed.

## Checks

```sh
node --test perplexityResearch.test.js
node --check perplexityResearch.js
node --check server.js
npm run build
```

References: https://docs.perplexity.ai/llms.txt and the Agent API quickstart,
presets, tools, output-control, API reference, SDK overview, and pricing pages.