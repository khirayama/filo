# filo API

Cloudflare Workers + D1 + Queues implementation of `SPEC/API.md`. Translation is not part of the API: clients translate titles on-device.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # development Clerk の sk_test_ を設定
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

Expected local web origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

## Deploy

```bash
wrangler d1 create filo-db       # copy the returned database_id into env.production.d1_databases
# or: wrangler d1 list           # if the DB already exists
npx wrangler queues create filo-jobs       # initial feed fetches, refreshes, imports
npm run db:migrate:remote
npm run deploy:production
```

`npm run dev` は常に `development` 環境で起動し、`.dev.vars` の development Clerk
（`sk_test_`）を使う。本番は `production` 環境へ Clerk 本番インスタンスの
`sk_live_` と JWKS の PEM 公開鍵を登録してから deploy する。

本番SecretはGitへ書かない。JWT検証用の公開鍵は `wrangler.jsonc` の
`CLERK_JWT_PUBLIC_KEY`（公開情報）で管理し、`CURSOR_SIGNING_KEY` など
`CLERK_SECRET_KEY` / `CRON_SECRET` を含むダッシュボードで管理する本番固有の変数は
`npm run deploy:production` の
`--keep-vars` で保持する。

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

The server neither generates nor stores translations. Clients translate listing
titles on-device (iOS: Translation framework, Android: ML Kit, Web: the
browser's built-in Translator API or a browser-local WASM model), so there is no translation queue, drain,
model configuration, or coverage to operate.

The only language signal the server keeps is `feeds.language`, taken from the
feed's declared `<language>` / `xml:lang` at fetch time. New articles inherit it
as `source_language`, which read-aloud uses to pick a voice.
