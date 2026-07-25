# filo Production Operations

filo は Cloudflare Workers、Cloudflare D1、Cloudflare Queues、Workers Cron、Workers AI、Clerk を前提に本番運用する。本書は実装者と運用者が同じ判断基準で開発、デプロイ、障害対応できる状態を目的とする。

## Table of Contents

- [Environments](#environments)
- [Required Configuration](#required-configuration)
- [Operational Defaults](#operational-defaults)
- [Deployment](#deployment)
- [CI Gates](#ci-gates)
- [Observability](#observability)
- [Alerts](#alerts)
- [Security](#security)
- [Background Jobs](#background-jobs)
- [Data Retention](#data-retention)
- [Backups and Recovery](#backups-and-recovery)
- [Incident Runbooks](#incident-runbooks)
- [Release Checklist](#release-checklist)

## Environments

- `local`: ローカル開発。D1 local database、Clerk development instance、Workers AI mock または development binding を使う
- `staging`: 本番相当検証。production と同等の binding 名、別 D1、別 Queue、別 Clerk instance を使う
- `production`: 実ユーザー環境。手動承認または protected branch 経由でのみデプロイする

環境ごとに Cloudflare account、D1 database、Queue、KV/R2 を分離する。production data を local にコピーしない。調査用データが必要な場合は、個人情報と認証識別子を匿名化した dump のみ利用する。

## Required Configuration

Workers secret または環境変数として最低限以下を管理する。

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_WEBHOOK_SECRET`
- `APP_ENV`
- `APP_ORIGIN`
- `DATABASE_ID`
- `FEED_REFRESH_QUEUE`
- `CONTENT_GENERATION_QUEUE`
- `WORKERS_AI_BINDING`
- `ADMIN_ROLE_NAME`
- `LOG_LEVEL`

secret は Git にコミットしない。rotation 時は staging で検証してから production に反映する。

## Operational Defaults

- List API `limit`: default `20`, max `100`
- feed discovery redirect: max `5`
- feed discovery / feed fetch timeout: `10s`
- Workers AI request timeout: `20s`
- feed refresh interval: success `30m`, not_modified `120m`
- OPML import file size: max `5MB`
- OPML import outline count: max `2000`
- background job attempt max: `5`
- rate limit defaults:
  - user write API: `60/min/user`
  - feed discovery and subscription creation: `10/min/user`
  - OPML import: `5/hour/user`
  - admin feed refresh: `10/min/admin`
- AI input text は選択した model の安全入力サイズまで切り詰め、本文自体をログに出さずに truncation の事実だけ記録する
- MVP の Workers AI model は staging / production で固定し、環境間で別 model を混在させない
- 1 article あたりの AI 入力は `12,000` 文字を上限に切り詰める
- listing 翻訳（RSS タイトル）はユーザーの明示操作で生成し、feed refresh だけでは enqueue しない
- listing 翻訳は同一原文言語のタイトルを feed 横断で 1 回の翻訳 call に最大 `40` 件まとめ、1リクエストで対象言語すべてを翻訳する（月間リクエスト数上限が主制約のため）
- listing 翻訳の source language は入力として事前に与えず、翻訳 call ごとにモデルがタイトルから識別してレスポンスへ返す。source language は `ja/en` に限定せず、`zh`/`es`/`ko`、および `mixed`/`und` も保持する
- `extracted` / 全文 `translated` は読者が記事を開く、または明示要求した時点で on-demand 生成する。言語間の fan-out は行わない
- 要約生成は MVP 対象外とする
- 言語判定不能またはタイトル空 article では listing 翻訳を生成せず一覧は原文表示にフォールバックする。`translated` は `not_requested` として扱う
- 明示的な content retry / backfill request は通常どおり受け付ける
- `feedHealthStatus` の導出では、`paused` は `feeds.status=paused`、`stale` は `last_success_fetched_at` が `72h` を超過した active feed、`healthy` はそれ以外とする
- `feed_fetch_states` 未作成または `last_success_fetched_at IS NULL` の新規購読は、`initial_fetch_status=fetching` の間 `healthy` として扱う
- `stale` は更新異常の断定ではなく「しばらく更新がない」通知として扱い、user-facing copy もそれに合わせる
- 初期リリースは機能ごとに `iOS` `Android` `Web + Extension` を同一リリース単位で提供する
- 初期リリースのリリース判定対象は `iOS` / `Android` の mobile / tablet、`Web` の mobile / tablet / desktop、Browser Extension、および backend/API/operations とする
- iOS / Android は単独アプリ、Web は Web 本体 + Extension の合算で同等体験を満たす
- `iOS` `Android` `Web + Extension` のいずれかで未実装の機能は、当該機能のリリース完了として扱わない
- article mutation の retry queue とオフライン閲覧は対象外とし、送信失敗は画面上の再操作で回復する

## Deployment

- `main` への merge 後に staging deploy を実行する
- staging smoke test 成功後に production deploy を実行する
- D1 の破壊的 migration と対応 Worker は maintenance window 内で一括適用し、旧 Worker への rollback は行わず forward-fix を優先する
- Workers deploy 後に `/api/v1/settings`、`/api/v1/subscriptions`、`/api/v1/articles`、admin feed list の smoke test を行う

DB schema を変更しない deploy に失敗した場合は直前の Worker version へ rollback する。破壊的 DB migration 適用後は旧 schema 前提の Worker へ戻さず、対応 Worker または forward-fix migration で復旧する。

## CI Gates

Pull Request は最低限以下を通す。

- TypeScript typecheck
- lint / format check
- unit tests
- API contract tests
- D1 migration dry-run
- feed parser / feed discovery tests
- permission tests for subscription-owned and retained articles
- job idempotency tests for feed refresh and content generation
- read state と collection mutation の multi-device / retry 競合テスト
- account deletion compensation / cleanup retry tests
- deleted user tombstone による再作成防止テスト
- `deletionToken` を使った account deletion status 追跡テスト
- content status の `not_requested` が DB 永続値ではなく API 仮想状態として返る contract tests

CI は production secret を参照しない。外部サービスが必要なテストは mock または staging 専用 credential を利用する。

## Observability

すべての API request、admin operation、background job は構造化ログを出す。

共通ログフィールド:

- `requestId`
- `jobId`
- `userId` または `clerkUserId`
- `feedId`
- `articleId`
- `subscriptionId`
- `route`
- `statusCode`
- `durationMs`
- `errorCode`
- `attempt`

ログに本文、AI生成結果、Clerk secret、cookie、Authorization header を出力しない。

主要メトリクス:

- API latency p50 / p95 / p99
- API error rate by route and errorCode
- D1 query latency and error count
- feed refresh success / not_modified / error count
- feed refresh consecutive failures
- content generation pending / ready / error count
- initial feed fetch pending / failed count
- account deletion cleanup pending age / failed count
- Queue backlog and oldest message age
- Workers AI error rate and latency
- OPML import created / skipped / failed count
- OPML import job pending / running / completed / failed count
- stale feed subscription count

## Alerts

production では最低限以下にアラートを設定する。

- API 5xx rate が 5 分移動窓で `>= 2%`
- Clerk 認証失敗が 10 分で `>= 50` 件
- D1 error が 5 分で `>= 20` 件
- Queue backlog または oldest message age が 10 分以上継続して抑止しきい値超過
- feed refresh 全体の error rate が 15 分移動窓で `>= 20%`
- content generation の `error` 確定件数が 15 分で `>= 100` 件
- initial feed fetch failure が 30 分で `>= 20` 件
- account deletion cleanup job の `failed` が `>= 1` 件、または `pending/running` が `>= 30m`
- Cron が 2 周期連続で起動していない
- `feeds.status=paused` が 1 時間で `>= 20` 件増加
- listing 翻訳の `pending` pair が 30 分以上減っていない（手動要求された一覧翻訳が滞留している。`filo-translate` queue の drain が止まっている可能性）

## Security

- 全 user endpoint は Clerk session を必須とする
- admin endpoint は Clerk role または server-side metadata で認可する
- すべての path id は current user の所有・参照権限を検証する
- retained article は `article_user_collections` に `reading_list` または `bookmark` membership がある場合のみ未購読でも参照可能とする
- request body、query、multipart file は schema validation を行う
- API response はユーザーが参照できる `subscription` `tag` `article_user_state` のみ含める
- OPML import は `5MB`、`2000` outline、XML depth、処理時間に上限を設ける
- feed discovery / feed fetch は SSRF 対策として private IP、localhost、link-local、metadata endpoint を拒否する
- redirect は最大 `5` 回に制限し、redirect 後の URL にも同じ SSRF 検査を行う
- HTML 本文抽出結果と RSS HTML は表示時に sanitize する
- rate limit は IP、Clerk user、route の組み合わせで設定する

## Background Jobs

feed refresh と content generation は少なくとも1回実行される前提で冪等にする。いずれもユーザーの明示操作（status 画面・記事一覧の更新・記事詳細のボタン）で enqueue される。cron は feed refresh を起動しない（account deletion retry のみを行う）。

ユーザー起点の feed fetch は enqueue 時に `feed_jobs`（`user_id + feed_id + kind='fetch'`）へ `pending` 行を記録し、worker が `running -> completed | failed` へ確定する。status 画面はこのジョブ状態を購読行ごとに可視化する。`failed`、および `10m` 以上更新の無い `pending/running`（中断）は行の取得操作で再実行できる（中断はアクティブ扱いせず操作を塞がない）。queue message が失われてもジョブ行が中断として残るため、ユーザーが再実行で回復できる。

listing 翻訳は `feed_jobs` を使わない。`article_listing_translations` の `pending → ready | error` 状態遷移そのものが作業台帳であり、進捗・完了・失敗はすべてこの実データの集計（coverage）として表示する。queue message が失われても翻訳操作の再実行（drain 再投入）だけで回復する。

feed refresh:

- `feedId` 単位で実行する
- `http_etag` `http_last_modified` を使って条件付き fetch を行う
- 新着記事は `feed_id + dedupe_key` で upsert する
- 成功、not_modified、失敗を `feed_fetch_logs` と `feed_fetch_states` に記録する
- `feeds.status=active` は refresh 対象、`paused` は対象外とする
- `error` 時のみ `consecutive_failures += 1` とする
- `success` と `not_modified` は成功扱いとし、`consecutive_failures=0` に reset する
- `success` 時は `next_fetch_after=now+30m` とする
- `not_modified` 時は `next_fetch_after=now+120m` とする
- `1` 回目の `error` では `next_fetch_after=now+15m`、`2` 回目では `now+60m`、`3` 回目では `now+360m` とする
- `3` 回連続 `error` に達した feed は `paused` に遷移し、admin が再開するまで refresh 対象にしない
- `POST /status/refresh` の `force=true` は `next_fetch_after` を無視するが、`paused` feed は対象外とする
- 直近失敗中かどうかは `feed_fetch_states.last_result` と `consecutive_failures` で判断する
- failed subscription に対する `retry-initial-fetch` は user 主導の one-shot recovery として別経路で受け付けてよく、その成功時は `feeds.status=active` と `consecutive_failures=0` を回復させてよい

content generation:

- `article_id + content_type + language` を自然キーとする
- feed refresh は listing 翻訳を enqueue しない。listing 翻訳は status 画面などの明示操作で不足 pair を `pending` に一括投入し、グローバル drain（`jobType=translate_drain`、専用 queue `filo-translate`）を蹴る
- 翻訳先サポート言語は `ja` / `en` / `zh` / `ko` / `es`。対象は購読 feed の全記事（新しい順）× 対応5言語のうち原文言語と異なる言語。原文が対応言語なら4言語、その他の原文なら5言語が対象になる。`ready` の pair は再翻訳せず、`error` の pair は翻訳操作の再実行で `pending` に戻る。翻訳モデルは `preview/gemma-4-31B-it`（`TRANSLATION_MODEL` で変更可）
- drain は `filo-translate` queue の `max_concurrency=1` でグローバルに直列化する。プロバイダのレート制限はアカウント全体に効くため、並列実行は互いを飢えさせるだけになる
- listing 翻訳の入力は `id + title` とし、source language の事前判定値はモデルへ渡さない。モデルはタイトルごとに source language を返し、複数言語のタイトルは `mixed`、判定不能は `und` とする。返された値は可能な限り ISO 639-1 に正規化し、`mixed`/`und` はそのまま保持する
- プロバイダ（さくらのAI Engine 無償プラン）は**月間リクエスト数上限**が主制約のため、リクエスト数最小化を最優先する: 同一原文言語のタイトルを **feed 横断で**最大 `40` 件 / `4000` 文字まで1バッチに詰め、1リクエストで対象言語すべてを翻訳する。入出力は id キー付き JSON で突き合わせ、順序ズレによる誤マッチを防ぐ
- listing 翻訳の出力検証は、モデルの翻訳品質を採点するものではなく、ユーザーに表示できない結果を排除するガードレールとする。空出力、翻訳対象言語が必要なのに原文を完全に echo した結果、明らかに別言語の文章だけで構成された結果は表示不可として扱う。これらは同一 call 内で対象 pair の集中修復を試し、なお表示不可なら `attempt_count+1` で `pending` に留め、`3` 回で `error` を確定する。
- 文字種の混在、固有名詞・ブランド・URL・型番の残存、短いタイトル、言語ヒューリスティックが不確かな結果は警告レベルとする。空でなく原文完全 echo でもない結果は、修復を試して改善しなくても `ready` として保存し、警告は worker ログに記録する。警告は翻訳失敗数や `error_message` には反映しない。漢字の共有や固有名詞を理由に表示可能な翻訳を失敗扱いにしない。
- モデルが source language を `mixed` または `und` と返したタイトルでは、原文言語の翻訳行を省略せず全ターゲットを出力させ、パーサーも原文を自動復元しない。`sourceLang` の自己申告は入力として与えず、原文言語の事前情報ではなくレスポンスのメタデータとして扱う。
- ペーシングは実測トークンで計算する: リクエストごとに `usage.total_tokens / TRANSLATION_TOKENS_PER_MINUTE`（既定 `10000`）分待つ。`TRANSLATION_PACING_MS` は下限。`429` は worker 内で待たず、`Retry-After`（`30..300s` に clamp）の `delaySeconds` 付きで drain を再投入する
- 1回の drain は約 `60` 秒の時間予算で打ち切り、`pending` が残れば drain を再投入する（進捗ゼロ時は 60 秒遅延付き）。`attempt_count` の上限があるため、恒久障害でも有限回で `error` に収束する
- 進捗・完了・失敗の表示はすべて `article_listing_translations` の集計（coverage）から導出する
- `extracted` / `translated` は読者が記事を開く、または明示要求した時点で `jobType=generate_contents` で生成する
- worker は各 article に対して `extracted` を基本処理し、必要時のみ `translated` を冪等処理する。`extracted` は記事を開いた時点で lazy に enqueue し、`pending` 行で重複起動を防ぐ
- on-demand 生成ポリシーは、`translated` 要求は原文と異なる言語のみ翻訳する
- `extracted` の本文抽出は Readability.js を優先し、失敗時のみ代替抽出へフォールバックする
- source language は listing 翻訳時に判定済みであれば踏襲し、未判定のときのみ `extracted` 本文から再判定する
- input length 上限を超える場合は切り詰めて処理し、全文はログに出さない
- `POST /api/v1/articles/{articleId}/contents` 起点の単発 retry / backfill も、対象1件の batch payload として同じ worker logic に渡す
- `pending` 行が存在する場合は重複 job を作らない
- 一時失敗は exponential backoff で最大 `5` attempts まで再試行する
- attempt 上限到達時は `status='error'` と `error_message` を確定する

## Data Retention

- user-owned data: `users` `user_settings` `subscriptions` `tags` `subscription_tags` `article_read_states` `article_user_collections`
- shared data: `feeds` `articles` `article_contents` `feed_fetch_states` `feed_fetch_logs`

アカウント削除では削除対象 `clerk_user_id` の tombstone と `account_deletion_jobs` を先に記録し、受付成功時は常に `202 Accepted` と短期 `deletionToken` を返す。tombstone 作成後は Clerk account deletion の成否にかかわらず通常サインイン時の upsert から除外する。その後 Clerk account deletion を実行し、成功後に user-owned data を削除する。Clerk deletion または app data cleanup が失敗した場合は `account_deletion_jobs` を `failed` として記録し、backoff 付きで再試行する。shared data は削除しない。Clerk deletion 後も client は `deletionToken` により deletion job を `completed` まで追跡できる。
初期公開では shared data retention の自動削除は導入しないが、D1 使用量が `80GB`、または月次インフラコストが予算比 `120%` を 2 週連続で超えた場合は、feed 単位 retention の追加を次リリース優先事項として扱う。

## Backups and Recovery

- production D1 は定期 backup を有効化する
- migration 前に復旧可能な checkpoint を確保する
- 復旧手順は「影響範囲確認、書き込み停止判断、backup restore、整合性検査、再開」の順で実施する
- restore 後は `users` `subscriptions` `articles` `article_read_states` `article_user_collections` の件数と参照整合性を確認する

## Incident Runbooks

### Feed refresh failures

1. admin feed list で `lastError` `consecutiveFailures` `nextFetchAfter` を確認する。
2. 対象 feed の fetch log を確認する。
3. feed URL の到達性、HTTP status、redirect、SSRF 拒否、parser error を切り分ける。
4. 一時障害なら `next_fetch_after` を調整して再試行する。
5. `3` 回連続失敗で `paused` になった feed は、原因解消後に admin API で `active` に戻す。
6. failed subscription の user retry で復旧した場合は、同時に `feeds.status` と `consecutive_failures` の回復を確認する。

### OPML import failures

1. `opml_import_jobs` の `status` `failed_count` `failure_summary_json` を確認する。
2. XML parse error、size limit、outline limit、feed discovery failure を切り分ける。
3. partial success の場合は失敗要約をユーザーへ返し、成功分は巻き戻さない。
4. worker 障害なら同一 job を再開せず、新規 import の再実行で回復する。

### Content generation failures

1. `article_contents.status='error'`（on-demand 生成）または `article_listing_translations.status='error'`（一覧翻訳）と `error_message` を確認する。
2. Workers AI、本文抽出、言語判定、入力サイズ超過を切り分ける。
3. 一時障害なら retry endpoint または backfill job で同一自然キーを再生成する。
4. queue 滞留時は新着の listing 翻訳が遅延していないか確認し、必要なら content generation queue 全体を一時停止する。

## Release Checklist

- 初期リリース対象に `iOS` `Android` `Web` `Browser Extension` と backend/API/operations が含まれている
- 対象機能ごとに `iOS` `Android` `Web + Extension` の実装と検証がそろうまで完了扱いにしていない
- staging migration dry-run が成功している
- staging smoke test が成功している
- `iOS` / `Android` の mobile / tablet、`Web` の mobile / tablet / desktop、Browser Extension の主要導線が smoke test 済み
- Cron、Queue、Workers AI、Clerk webhook の疎通を確認している
- admin API が非 admin から拒否されることを確認している
- retained article と unsubscribe の挙動を確認している
- account deletion の `202 Accepted`、`deletionToken` 発行、および `GET /api/v1/account/deletion-status` の状態遷移を確認している
- OPML import / export の主要ケースを確認している
- OPML import job の作成、進捗確認、partial success を確認している
- 購読一覧で `feedHealthStatus` の異常表示が反映されることを確認している
- Error Codes と主要画面文言の対応を確認している
- dashboard またはログで `requestId` / `jobId` を追跡できる
- rollback または forward-fix の判断手順が明確になっている
- read state 更新と collection 専用 endpoint が競合ケースで壊れないことを確認している
- account deletion 後に user が自動再作成されないことを確認している
- account deletion cleanup retry が `account_deletion_jobs` で追跡できることを確認している
- `success/not_modified/error` ごとの `next_fetch_after` 更新を確認している
- content generation backlog 抑止時に translated が `not_requested` として表示され、明示要求後は `pending` に遷移することを確認している
- `paused` feed 上の failed subscription を user retry で復帰できることを確認している
