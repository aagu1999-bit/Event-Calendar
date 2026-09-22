# Perplexity Agent research

The existing Curatorial Matrix **Fuel Research** button uses the official
`@perplexity-ai/perplexity_ai` SDK's `responses.create` method (Agent API;
`/v1/responses` is the documented compatibility alias for `/v1/agent`).
It uses the `low` preset, explicitly enables `web_search`, requests a JSON
schema, and reads the SDK's `output_text`. Search results and text annotations
supply source URLs for the existing UI.

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