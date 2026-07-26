# filo Production Operations

filo は Cloudflare Workers、Cloudflare D1、Cloudflare Queues、Durable Objects、Workers Cron、Clerk を前提に運用する。タイトル翻訳は OpenAI 互換 API（既定はローカルの LM Studio）へ委譲する。

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

- `local`: ローカル開発。D1 local database（`wrangler dev`）、Clerk development instance、ローカル LM Studio を使う
- `production`: 実ユーザー環境

現時点で staging 環境は存在しない。`wrangler.jsonc` の `database_id` は placeholder のままで、リモート D1 は未作成である。production data を local にコピーしない。

## Required Configuration

`apps/api/src/env.ts` の `Env` が唯一の正となる。

Bindings（`wrangler.jsonc`）:

- `DB`: D1 database `filo-db`
- `JOBS`: Queue `filo-jobs`（feed fetch、本文抽出、OPML import、account deletion）
- `TRANSLATE_JOBS`: Queue `filo-translate`（タイトル翻訳 drain、`max_concurrency: 1`）
- `TRANSLATION_WATCHDOG`: Durable Object。停止した翻訳 drain を再開する safety net

Vars（`wrangler.jsonc`）:

- `ADMIN_CLERK_USER_IDS`: `/api/v1/admin/*` を呼べる Clerk user id のカンマ区切り。admin 判定はこれ一本で行う

Secrets（`wrangler secret put`）:

- `CLERK_SECRET_KEY`: Clerk backend API key（token 検証と account deletion）
- `CURSOR_SECRET`: pagination cursor の HMAC 鍵
- `CRON_SECRET`: 内部 cron → API 呼び出しの Bearer token

翻訳（すべて optional。未設定ならローカル LM Studio の既定値で動く）:

- `LM_STUDIO_API_URL`: 既定 `http://localhost:1234/v1`
- `LM_STUDIO_API_KEY`: OpenAI 互換サーバが認証を要求する場合のみ
- `TRANSLATION_MODEL`: 既定 `google/gemma-4-12b-qat`
- `TRANSLATION_TOKENS_PER_MINUTE`: 既定 `0`（=ペーシング無効）
- `TRANSLATION_PACING_MS`: リクエスト間隔の下限、既定 `0`

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

タイトル翻訳:

- 翻訳対象は一覧表示用タイトルのみ。本文翻訳は提供しない（各プラットフォーム / ブラウザの翻訳機能に委ねる）
- 翻訳先は `ja` / `en` / `zh` / `ko` / `es` の 5 言語。`article_listing_translations` には記事 × 5 言語ぶんの行を投入する
- source language は入力として与えない。モデルがタイトルごとに識別して返し、その値を `articles.source_language` に保存する。`mixed` / `und` もそのまま保持する
- 1 バッチ最大 `4` 件のタイトル、同時 `2` バッチ。1 リクエストでそのバッチに pending な全言語を翻訳する
- 1 pair の試行上限は `3` 回。到達すると `error` を確定する
- 1 回の drain の時間予算は約 `60` 秒。`pending` が残れば drain を再投入する
- `429` は worker 内で待たず、`Retry-After`（`30..300s` に clamp）付きで drain を再投入する

## Deployment

初回セットアップ（リモート D1 は未作成なので必須）:

```bash
cd apps/api
wrangler d1 create filo-db          # 返ってきた database_id を wrangler.jsonc に書く
npx wrangler queues create filo-jobs
npx wrangler queues create filo-translate
npm run db:migrate:remote           # placeholder のままなら script が止める
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CURSOR_SECRET
wrangler secret put CRON_SECRET
npm run deploy
```

- migration は `migrations/0001_init.sql` の 1 本に集約されている。スキーマ変更は新しい migration ファイルを追加して行う
- D1 の破壊的 migration と対応 Worker は一括適用し、旧 Worker への rollback は行わず forward-fix を優先する
- DB schema を変更しない deploy に失敗した場合は直前の Worker version へ rollback する
- deploy 後に `/api/v1/health`、`/api/v1/settings`、`/api/v1/subscriptions`、`/api/v1/articles`、`/api/v1/status` の疎通を確認する

翻訳を有効にするには、Worker から到達できる OpenAI 互換サーバが必要になる。ローカル LM Studio のままリモート Worker を deploy しても翻訳だけが失敗する。

## Background Jobs

すべてのジョブは少なくとも1回実行される前提で冪等にする。キューの `max_retries` は `5`、リトライは `60` 秒遅延で再投入する。

cron（毎時）は失敗した account deletion job の再投入だけを行う。**feed fetch と翻訳を cron が起動することはない**。コンテンツの取得・生成はすべてユーザーの明示操作から始まる。

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

### タイトル翻訳

翻訳は `feed_jobs` を使わない。`article_listing_translations` の `pending → ready | error` という状態遷移そのものが作業台帳であり、進捗・完了・失敗はすべてこの実データの集計（coverage）として表示する。

- 明示操作で不足 `(article, language)` pair を `pending` に一括 INSERT し、既存の `error` 行を `pending`（`attempt_count=0`）に戻してから、グローバル drain を 1 メッセージ蹴る
- drain は `filo-translate`（`max_concurrency=1`）で直列化する。並列実行はプロバイダのレート制限を互いに奪い合うだけになる
- `pending` 行が唯一の状態なので、メッセージの重複・喪失があっても drain 再投入だけで自己修復する
- `processing_at` は「モデルへ送信済み・応答待ち」を表す。drain 開始時に前回の残骸を NULL に戻すので、クラッシュした drain の pair は 順番待ち へ戻る
- 出力検証は品質採点ではなく、表示できない結果を排除するガードレールとする。空出力と、正当化できない原文 echo だけが表示不可。文字種の混在や言語ヒューリスティックの不確かさは警告に留め、worker ログにのみ記録する
- 中断・失敗した pair の一括再開 API は持たない。翻訳操作の再実行で `error` 行が `pending` に戻る
- `TranslationWatchdog`（Durable Object）が safety net として drain の鎖を監視し、途切れていれば再開する。alarm は永続化されるのでプロセス再起動後も効く

### 本文抽出

リーディングパート（音読キュー）専用の on-demand 処理で、RSS リーダーの管理 UI からは起動しない。

- `POST /api/v1/articles/{articleId}/content` で起動する
- `article_contents` の行の存在自体が「抽出を要求済み」を意味する。`pending` 行があれば重複 job を作らない
- RSS 本文からの抽出を先に試し、取れなければ canonical URL を fetch して Readability で抽出する
- 抽出できなければ `status='error'` を確定する。指数バックオフによる自動再試行は行わず、`force=true` の再要求で回復する

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

`observability.enabled` を有効にした Workers logs を使う。現状のログは構造化 JSON ではなく、`[translate]` などのプレフィックス付きテキストである。

- 全 API response に `X-Request-Id` を返す。client が送ってこなければ server が生成する
- 翻訳 drain は `translated / failed / remaining / rateLimited` を 1 行で出す
- 表示可能だが疑わしい翻訳は `accepted output with validation warning` として article / language / 理由つきで残る
- ログに本文、AI 生成結果、Clerk secret、Authorization header を出力しない

運用状況の第一の窓口は dashboard ではなく `GET /api/v1/status` である。購読行ごとの fetch job 状態と翻訳 coverage（`ready` / `failed` / `queued` / `processing` / `missing`）を実データの集計として返す。

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
- shared data: `feeds` `articles` `article_contents` `article_listing_translations` `feed_fetch_states` `feed_fetch_logs`

アカウント削除は user-owned data のみを削除する。shared data は削除しない。

shared data の自動 retention 削除は導入していない。D1 使用量が `80GB`、または月次インフラコストが予算比 `120%` を 2 週連続で超えた場合は、feed 単位 retention の追加を次リリース優先事項として扱う。

## Incident Runbooks

### Feed refresh failures

1. admin feed list で `lastError` `consecutiveFailures` `nextFetchAfter` を確認する。
2. `GET /api/v1/admin/feeds/{feedId}/logs` で fetch log を確認する。
3. feed URL の到達性、HTTP status、redirect、SSRF 拒否、parser error を切り分ける。
4. 一時障害なら `next_fetch_after` を調整して再試行する。
5. `3` 回連続失敗で `paused` になった feed は、原因解消後に `PATCH /api/v1/admin/feeds/{feedId}` で `active` に戻す。
6. failed subscription の user retry で復旧した場合は、`feeds.status` と `consecutive_failures` の回復も確認する。

### 翻訳が進まない

1. `GET /api/v1/status` の `translator.pending` と、購読行ごとの `translation` coverage を見る。`queued` のまま減らないのか、`processing` で止まっているのかを切り分ける。
2. `processing` のまま止まっている場合は、モデル側の応答待ちかドレインの死亡を疑う。LM Studio が起動しているか（`lms ps`）、`TRANSLATION_MODEL` が実際にロードされているかを確認する。
3. drain が完全に止まっていても `TranslationWatchdog` が再開させる。即座に動かしたい場合は翻訳操作を再実行する。
4. `failed` が増えている場合は coverage の `lastError` を見る。`API error` 系はサーバ側、`model returned` 系は出力品質の問題。
5. 溜まった `pending` / `error` を捨てて仕切り直す場合は `POST /api/v1/status/translate/discard`。完了済みの翻訳は残る。

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
- Queue（`filo-jobs` / `filo-translate`）と Durable Object の疎通を確認している
- Cron が account deletion retry を実行できることを確認している
- admin API が非 admin から拒否されることを確認している
- retained article と unsubscribe の挙動を確認している
- account deletion の `202 Accepted`、`deletionToken` 発行、`GET /api/v1/account/deletion-status` の状態遷移を確認している
- 再ログインで削除済みユーザーが復活しないことを確認している
- OPML import / export の主要ケースと partial success を確認している
- 購読一覧で `feedHealthStatus` の異常表示が反映されることを確認している
- `success/not_modified/error` ごとの `next_fetch_after` 更新を確認している
- `paused` feed 上の failed subscription を user retry で復帰できることを確認している
- 翻訳の投入 → `pending` 減少 → 一覧の `translatedTitle` 反映まで通ることを確認している
- Error Codes と主要画面文言の対応を確認している

## Not yet implemented

以下は運用目標として合意されているが、コード上には存在しない。実装するまで「守られている」前提を置かない。

- staging 環境、および staging smoke test を挟む二段階 deploy
- CI（typecheck / lint / test / migration dry-run はローカル実行のみ）
- rate limiting。`rate_limited` error code は定義済みだが、返す経路がない
- 構造化ログ（`jobId` / `userId` / `route` / `durationMs` / `errorCode` などの共通フィールド）
- メトリクスとアラート（5xx rate、queue backlog、翻訳 pending の滞留、paused feed の増加など）
- D1 の定期 backup と復旧手順の検証
- Clerk webhook（署名検証つきの user 同期）。現在の user 作成は API 呼び出し時の upsert のみ
