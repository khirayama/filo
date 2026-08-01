# filo Production Operations

filo は Cloudflare Workers、Cloudflare D1、Cloudflare Queues、Workers Cron、Clerk を前提に運用する。翻訳はクライアントが端末内で行うため、運用対象に含まれない。

本書は実装済みの運用挙動を正とし、未実装の運用要件は `Not yet implemented` として明示する。仕様として掲げてはいるが動いていないものを、動いているかのように書かない。

## Table of Contents

- [Environments](#environments)
- [Required Configuration](#required-configuration)
- [Operational Defaults](#operational-defaults)
- [Deployment](#deployment)
- [Background Jobs](#background-jobs)
- [Observability](#observability)
- [Security](#security)
- [Data Retention](#data-retention)
- [Incident Runbooks](#incident-runbooks)
- [Release Checklist](#release-checklist)
- [Not yet implemented](#not-yet-implemented)

## Environments

- `local`: ローカル開発。D1 local database（`wrangler dev`）と Clerk development instance を使う
- `production`: 実ユーザー環境

現時点で staging 環境は存在しない。`wrangler.jsonc` の `database_id` は placeholder のままで、リモート D1 は未作成である。production data を local にコピーしない。

## Required Configuration

`apps/api/src/env.ts` の `Env` が唯一の正となる。

Bindings（`wrangler.jsonc`）:

- `DB`: D1 database `filo-db`
- `JOBS`: Queue `filo-jobs`（feed fetch、本文抽出、OPML import、account deletion）

Vars（`wrangler.jsonc`）:

- `ADMIN_CLERK_USER_IDS`: `/api/v1/admin/*` を呼べる Clerk user id のカンマ区切り。admin 判定はこれ一本で行う

Secrets（`wrangler secret put`）:

- `CLERK_SECRET_KEY`: Clerk backend API key（token 検証と account deletion）
- `CURSOR_SECRET`: pagination cursor の HMAC 鍵
- `CRON_SECRET`: 内部 cron → API 呼び出しの Bearer token

secret は Git にコミットしない。ローカルは `.dev.vars`（`.dev.vars.example` を複製）を使う。

## Operational Defaults

HTTP / API:

- List API `limit`: default `20`, max `100`
- feed discovery / feed fetch timeout: `10s`（HTML からの feed 候補探索のみ `5s`）
- redirect: 最大 `5` hop。各 hop に SSRF 検査を再適用する
- レスポンス読み込みの上限: `5MB`（超過分は捨てる）
- 転送障害のみ `2` 回まで再試行する。validation / redirect policy エラーは再試行しない
- OPML import file size: max `5MB`、outline 件数: max `2000`、失敗要約の保存件数: max `50`
- response header は `Cache-Control: no-store` を既定とする
- CORS で許可する origin は `http://localhost:5173` と `http://127.0.0.1:5173` のみ

feed fetch:

- 1 回の fetch で取り込む記事は先頭 `200` 件まで
- `success` / `not_modified` の `next_fetch_after` は feed 自身の投稿ペースから算出し、`60m`〜`1440m` にクランプする
  - 直近 `20` 件の `published_at` の連続間隔の中央値を基準とする
  - 最新記事からの経過時間の半分を下限として併用する（更新が途絶えた feed を旧ペースで叩き続けない。朝にまとめて投稿する feed が終日 `60m` で叩かれるのも同時に防ぐ）
  - `published_at` を持つ記事が `4` 件未満でペースを判定できない場合のみ、`success` は `now+60m`、`not_modified` は `now+120m` にフォールバックする
- `error` の `next_fetch_after` backoff は `60m -> 360m -> 1440m`
- `3` 回連続 `error` で `feeds.status=paused` に遷移し、admin が戻すまで refresh 対象から外れる
- `feedHealthStatus`: `paused` は `feeds.status=paused`、`stale` は `last_success_fetched_at` が `72h` を超過した active feed、`healthy` はそれ以外
- `feed_fetch_states` 未作成または `last_success_fetched_at IS NULL` の新規購読は、`initial_fetch_status=fetching` の間 `healthy` として扱う
- `stale` は更新異常の断定ではなく「しばらく更新がない」通知として扱い、user-facing copy もそれに合わせる

## Deployment

初回セットアップ（リモート D1 は未作成なので必須）:

```bash
cd apps/api
wrangler d1 create filo-db          # 返ってきた database_id を wrangler.jsonc に書く
npx wrangler queues create filo-jobs
npm run db:migrate:remote           # placeholder のままなら script が止める
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CURSOR_SECRET
wrangler secret put CRON_SECRET
npm run deploy
```

- スキーマ変更は新しい migration ファイルを追加して行う
- D1 の破壊的 migration と対応 Worker は一括適用し、旧 Worker への rollback は行わず forward-fix を優先する
- DB schema を変更しない deploy に失敗した場合は直前の Worker version へ rollback する
- deploy 後に `/api/v1/health`、`/api/v1/settings`、`/api/v1/subscriptions`、`/api/v1/articles`、`/api/v1/status` の疎通を確認する

## Background Jobs

すべてのジョブは少なくとも1回実行される前提で冪等にする。キューの `max_retries` は `5`、リトライは `60` 秒遅延で再投入する。

cron（毎時）は失敗した account deletion job の再投入だけを行う。**feed fetch を cron が起動することはない**。コンテンツの取得・生成はすべてユーザーの明示操作から始まる。

### feed fetch

ユーザー起点の fetch は enqueue 前に `feed_jobs`（`user_id + feed_id`）へ `pending` 行を記録し、worker が `running -> completed | failed` へ確定する。status 画面はこのジョブ状態を購読行ごとに可視化する。

- 起動経路は 3 つだけ: 新規購読（`initial`）、手動更新（`refresh`）、初回失敗リトライ（`retry_initial`）
- `feedId` 単位で実行する。1 メッセージがその feed を待つ全ユーザーの行を確定させる
- `http_etag` / `http_last_modified` による条件付き fetch を行う
- 新着記事は `feed_id + dedupe_key` で upsert する
- 成功・not_modified・失敗を `feed_fetch_logs` と `feed_fetch_states` に記録する
- `error` 時のみ `consecutive_failures += 1`。`success` と `not_modified` は成功扱いで `0` に reset する
- `POST /status/refresh` の `force=true` は `next_fetch_after` を無視するが、`paused` feed は対象にしない
- `failed` 、および `10m` 以上更新の無い `pending/running`（中断）は行の取得操作で再実行できる。中断はアクティブ扱いせず操作を塞がない
- queue message が失われてもジョブ行が中断として残るため、ユーザーが再実行で回復できる

### 本文抽出

リーディングパート専用の on-demand 処理で、RSS リーダーの管理 UI からは起動しない。読み上げの第一経路はクライアント側の可視 DOM 抽出であり、このサーバー抽出は fallback として使う（`READING.md`）。

- `POST /api/v1/articles/{articleId}/content` で起動する
- `article_contents` の行の存在自体が「抽出を要求済み」を意味する。`pending` 行があれば重複 job を作らない
- RSS 本文からの抽出を先に試し、取れなければ canonical URL を fetch して Readability で抽出する
- 抽出できなければ `status='error'` を確定する。指数バックオフによる自動再試行は行わず、`force=true` の再要求で回復する

publisher 尊重ルール:

- fetch 時の User-Agent に filo であることと連絡先 URL を含める
- `noarchive` / `noindex` を指定するページはサーバー抽出の対象外とし、`status='error'` として扱う。可視 DOM 経由でのみ読み上げられる
- paywall / 認証壁を検出した場合（抽出テキストが極端に短い、既知のパターン）も同様に抽出しない
- feed が full content を配信している記事は canonical URL を fetch しない
- publisher からの停止要請を受け付ける窓口を用意し、feed 単位で抽出を無効化できるようにする

### OPML import

- 非同期 job とし、partial success を許容する
- XML external entity は無効化し、outline 件数と file size に上限を設ける
- worker 障害時は同一 job を再開せず、新規 import の再実行で回復する

### account deletion

- 受付時に tombstone と `account_deletion_jobs` を先に記録し、常に `202 Accepted` と短期 `deletionToken` を返す
- tombstone 作成後は Clerk deletion の成否にかかわらず、通常サインイン時の upsert 対象から除外する
- Clerk account deletion 成功後に user-owned data を削除する。shared data は削除しない
- 失敗時は `failed` として記録し、cron が `attempt_count < 5` の job を毎時再投入する

## Observability

`observability.enabled` を有効にした Workers logs を使う。現状のログは構造化 JSON ではなく、`[fetch]` などのプレフィックス付きテキストである。

- 全 API response に `X-Request-Id` を返す。client が送ってこなければ server が生成する
- ログに本文、Clerk secret、Authorization header を出力しない

運用状況の第一の窓口は dashboard ではなく `GET /api/v1/status` である。購読行ごとの fetch job 状態を実データの集計として返す。

## Security

- 全 user endpoint は Clerk session を必須とする
- admin endpoint は `ADMIN_CLERK_USER_IDS` に含まれる Clerk user id のみ許可する
- `/api/v1/status` は user auth または `CRON_SECRET` による system auth を受け付ける
- `/api/v1/account/deletion-status` のみ、有効な `deletionToken` で Clerk session なしに参照できる
- すべての path id は current user の所有・参照権限を検証する
- retained article は `article_user_collections` に `reading_list` または `bookmark` membership がある場合のみ、未購読でも参照可能とする
- feed discovery / feed fetch は SSRF 対策として private IP、localhost、link-local、`.internal` / `.local`、IPv6 loopback / link-local / unique-local を拒否する。redirect 後の URL にも同じ検査を行う
- HTML 本文抽出結果と RSS HTML は表示時に sanitize する
- pagination cursor は `CURSOR_SECRET` による HMAC で改ざんを検知する

## Data Retention

- user-owned data: `users` `user_settings` `subscriptions` `tags` `subscription_tags` `article_read_states` `article_user_collections` `feed_read_cursors` `feed_jobs` `playback_queue_items` `playback_states` `opml_import_jobs`
- shared data: `feeds` `articles` `article_contents` `feed_fetch_states` `feed_fetch_logs`

アカウント削除は user-owned data のみを削除する。shared data は削除しない。

shared data の自動 retention 削除は `article_contents` を除いて導入していない。D1 使用量が `80GB`、または月次インフラコストが予算比 `120%` を 2 週連続で超えた場合は、feed 単位 retention の追加を次リリース優先事項として扱う。

`article_contents` は fallback 専用の短期キャッシュとし、最終利用から 7 日を過ぎた行を削除する（`READING.md` D8）。削除の実行手段は未定（`Not yet implemented` を参照）。

## Incident Runbooks

### Feed refresh failures

1. admin feed list で `lastError` `consecutiveFailures` `nextFetchAfter` を確認する。
2. `GET /api/v1/admin/feeds/{feedId}/logs` で fetch log を確認する。
3. feed URL の到達性、HTTP status、redirect、SSRF 拒否、parser error を切り分ける。
4. 一時障害なら `next_fetch_after` を調整して再試行する。
5. `3` 回連続失敗で `paused` になった feed は、原因解消後に `PATCH /api/v1/admin/feeds/{feedId}` で `active` に戻す。
6. failed subscription の user retry で復旧した場合は、`feeds.status` と `consecutive_failures` の回復も確認する。

### OPML import failures

1. `opml_import_jobs` の `status` `failed_count` `failure_summary_json` を確認する。
2. XML parse error、size limit、outline limit、feed discovery failure を切り分ける。
3. partial success の場合は失敗要約をユーザーへ返し、成功分は巻き戻さない。
4. worker 障害なら同一 job を再開せず、新規 import の再実行で回復する。

### 本文抽出 failures

1. `article_contents.status='error'` と `error_message` を確認する。
2. canonical URL の到達性、SSRF 拒否、Readability の抽出失敗を切り分ける。
3. `POST /api/v1/articles/{articleId}/content` に `force=true` を付けて再抽出する。

## Release Checklist

- 対象機能ごとに `iOS` `Android` `Web + Extension` の実装と検証がそろうまで完了扱いにしていない
- `npm run typecheck` と `npm test` が通っている
- migration を適用し、`GET /api/v1/health` が応答する
- Queue（`filo-jobs`）の疎通を確認している
- Cron が account deletion retry を実行できることを確認している
- admin API が非 admin から拒否されることを確認している
- retained article と unsubscribe の挙動を確認している
- account deletion の `202 Accepted`、`deletionToken` 発行、`GET /api/v1/account/deletion-status` の状態遷移を確認している
- 再ログインで削除済みユーザーが復活しないことを確認している
- OPML import / export の主要ケースと partial success を確認している
- 購読一覧で `feedHealthStatus` の異常表示が反映されることを確認している
- `success/not_modified/error` ごとの `next_fetch_after` 更新を確認している
- `paused` feed 上の failed subscription を user retry で復帰できることを確認している
- Error Codes と主要画面文言の対応を確認している

## Not yet implemented

以下は運用目標として合意されているが、コード上には存在しない。実装するまで「守られている」前提を置かない。

- staging 環境、および staging smoke test を挟む二段階 deploy
- CI（typecheck / lint / test / migration dry-run はローカル実行のみ）
- rate limiting。`rate_limited` error code は定義済みだが、返す経路がない
- 構造化ログ（`jobId` / `userId` / `route` / `durationMs` / `errorCode` などの共通フィールド）
- メトリクスとアラート（5xx rate、queue backlog、paused feed の増加など）
- D1 の定期 backup と復旧手順の検証
- Clerk webhook（署名検証つきの user 同期）。現在の user 作成は API 呼び出し時の upsert のみ
- `article_contents` の 7 日 retention 削除。cron は失敗ジョブ復旧のみという方針との整合を含めて実行手段が未決（`READING.md` Q4）
- 本文抽出の publisher 尊重ルール（User-Agent、`noarchive` 判定、paywall 判定、feed 単位の抽出無効化）
