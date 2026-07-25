# filo API

Cloudflare Workers + D1 + Queues + Workers AI implementation of `SPEC/API.md`.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # fill CLERK_SECRET_KEY
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

Expected local web origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

## Deploy

```bash
wrangler d1 create filo-db       # copy the returned database_id into wrangler.jsonc
# or: wrangler d1 list           # if the DB already exists
npx wrangler queues create filo-jobs       # initial feed fetches, refreshes, imports
npx wrangler queues create filo-translate  # title translation drain
npm run db:migrate:remote
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CURSOR_SECRET
npm run deploy
```

## Verify

```bash
npm run typecheck
npm test
curl -i -X OPTIONS 'http://localhost:8787/api/v1/status' \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

Restart `wrangler dev` after changing CORS behavior so the local worker reloads with the new policy.

## Translation

Title translation uses LM Studio's OpenAI-compatible API and precomputes the supported app languages (`ja`, `en`, `zh`, `ko`, `es`) for shared reuse. Body translation is not provided (delegated to platform/browser translation).

Work is driven by `article_listing_translations` rows (`pending → ready | error`) drained by a single global job on the dedicated `filo-translate` queue (`max_concurrency: 1`). Both queues are provisioned in the deploy steps above.

Required vars:

```bash
LM_STUDIO_API_URL=http://localhost:1234/v1
LM_STUDIO_API_KEY=
TRANSLATION_MODEL=google/gemma-4-12b-qat
```

- `LM_STUDIO_API_URL`: optional, defaults to `http://localhost:1234/v1`; for a deployed Worker this must be a Worker-reachable LM Studio server URL
- `LM_STUDIO_API_KEY`: optional; only needed when the OpenAI-compatible server requires authentication
- `TRANSLATION_MODEL`: optional, defaults to `google/gemma-4-12b-qat`; must be loaded in LM Studio (`lms ps`)

The title translation request runs with `reasoning_effort: "none"` and no `response_format`: the output shape is prompted and recovered by the response parser. Strict `json_schema` decoding was dropped because it is slower on the local Gemma engine and intermittently aborts the request with a `peg-gemma4 format` engine error.

Generation is the entire cost of a request on a local model, so the answer is a line format rather than JSON — the id is written once per title and the title's own language is omitted instead of echoed back, which is ~25% fewer completion tokens for the same translations. The drain sends two batches at a time; start LM Studio with a matching slot count or the second request just queues:

```bash
lms load google/gemma-4-12b-qat --parallel 2
```

- `TRANSLATION_TOKENS_PER_MINUTE`: optional, sustained token budget for pacing. Unset (the default) means no pacing — correct for a local LM Studio, which has no provider quota. Set it only for a remote or capacity-limited server
- `TRANSLATION_PACING_MS`: optional, minimum wait between requests (default `0`)

After configuring them, trigger title translation from the status screen or per-subscription actions.
