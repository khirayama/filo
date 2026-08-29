# filo API

Cloudflare Workers + D1 + Queues implementation of `SPEC/API.md`. Translation is not part of the API: clients translate titles on-device.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # Better Auth / Resend を設定
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

`npm run dev` は常に `development` 環境で起動し、`.dev.vars` のBetter Auth / Resend
設定を使う。本番はproduction用Secretを登録してからdeployする。メールアドレスの
確認は行わず、Resendはパスワードリセットメールにのみ使用する。

本番SecretはGitへ書かない。ローカルの `.dev.vars` もGit管理対象外である。
Better Auth の `BETTER_AUTH_SECRET`、メール配送の `RESEND_API_KEY`、および
`CURSOR_SIGNING_KEY` / `CRON_SECRET` などの本番固有の値はダッシュボードで管理する。
`npm run deploy:production` は既存の本番設定を保持する。

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

## Better Auth cutover

This release uses a destructive clean cutover. Existing Clerk identities and
their application rows are intentionally not migrated or preserved. Migration
`0009_destructive_auth_cutover.sql` clears the old identities and user-owned
rows, removes the temporary bridge, and leaves shared feeds/articles in place.
Apply the schema and start the API:

```bash
npm run db:migrate:remote
npm run deploy:production
```

All users must register again with Better Auth. Do not run legacy Clerk
backfill scripts or expect old sessions, credentials, subscriptions, tags, or
settings to remain available.

## Translation

The server neither generates nor stores translations. Clients translate listing
titles on-device (iOS: Translation framework, Android: ML Kit, Web: the
browser's built-in Translator API or a browser-local WASM model), so there is no translation queue, drain,
model configuration, or coverage to operate.

The only language signal the server keeps is `feeds.language`, taken from the
feed's declared `<language>` / `xml:lang` at fetch time. New articles inherit it
as `source_language`, which read-aloud uses to pick a voice.
