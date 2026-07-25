# filo App Specification

`SPEC` 配下の入口文書。プロダクト方針はリポジトリ直下の `CONCEPT.md` を優先し、本書はアプリケーション全体にまたがる共通仕様と参照導線を定義する。

## Table of Contents

- [Documents](#documents)
- [Architecture Overview](#architecture-overview)
- [Application Rules](#application-rules)
- [Authentication and Authorization](#authentication-and-authorization)
- [Decision Gates](#decision-gates)

## Documents

- [API.md](./API.md): HTTP API 契約、認可、エラー、ページング、各エンドポイント
- [DATABASE.md](./DATABASE.md): Cloudflare D1 のスキーマ、データ整合性、クエリ期待値
- [SCREENS.md](./SCREENS.md): 画面、ナビゲーション、クライアント表示ルール
- [OPERATIONS.md](./OPERATIONS.md): 環境、デプロイ、監視、ジョブ運用、セキュリティ、障害対応、リリース基準

推奨参照順は `CONCEPT.md -> APP.md -> API.md / DATABASE.md / SCREENS.md -> OPERATIONS.md` とする。

## Architecture Overview

- Auth は Clerk を利用する
- API は Cloudflare Workers を利用する
- Database は Cloudflare D1 を利用する
- Feed refresh と title translation は Cloudflare Queues を利用した非同期ジョブとして扱う。実行トリガーはすべてユーザーの明示操作（手動前提）であり、cron による自動巡回は行わない。Cron は account deletion retry などの復旧処理のみに使う
- 初期リリースでは `apps/ios` `apps/android` `apps/web` と Browser Extension を提供する。iOS / Android は単独アプリ、Web は Web + Extension の組み合わせで各機能を同一リリース単位にそろえる
- 本番運用の環境、デプロイ、監視、障害対応、セキュリティは `OPERATIONS.md` に従う

## Application Rules

- 画面上でユーザーが管理する対象は `feed` ではなく `subscription` とする
- `feed` は共有ソース、`subscription` はユーザー固有の購読設定を持つ中間エンティティとする
- RSS リーダーパートは `見つける / 整理する`、リーディングパートは `読む / 聴く` に責務を分ける
- フィード更新とタイトル翻訳はユーザーの明示操作でのみ開始する。記事一覧の「更新」操作は feed fetch の enqueue と `GET /status` ポーリングによる完了待ちを伴い、単なる一覧再読込とは区別する
- RSS リーダーパートでは本文抽出・本文翻訳の公開機能を持たない
- リーディングパートでは、元記事を開くこと、音読を始めること、キューで連続再生することを主機能とする
- Extension および iOS / Android のリーディングは実際の Web ページを開いて行い、publisher への送客を損なわないことを前提にする
- リーディング時にブラウザや OS の翻訳機能で表示が変わっている場合、その可視コンテンツを読む対象として扱ってよい
- `iOS` `Android` `Web + Extension` は状態遷移と API 契約を共通化し、UI 差分のみ各アプリで吸収する
- iOS / Android は単独アプリとして主要体験を完結させる。Web は購読管理と記事一覧を担い、記事リーディングは Web 本体と Extension の合算で同等体験を提供する
- Web は記事詳細画面を持たず、記事一覧から元記事を開く、または Extension に引き継ぐ
- iOS / Android は記事詳細画面ではなく記事リーディング画面を持ち、読む / 聴くための最小限の操作に絞る
- 画面ごとの主目的は 1 つに絞り、不要なボタン、重複導線、過剰なモード切り替えを避ける
- タイトル表示は `translatedTitle` があれば翻訳を優先してよいが、原文タイトルへの切り替えを許可する
- `iOS` `Android` `Web + Extension` のいずれかで未実装の機能は、その機能全体を未完了として扱う
- API client は `X-Request-Id` を受け取り、問い合わせや障害調査で追跡できるようにする
- client は `X-Request-Id` を任意で送信してよく、server は未指定時に必ず生成して response header に返す
- クライアントは `subscription` summary の `feedHealthStatus: healthy | stale | paused` を明示的に扱う
- 記事一覧 API の `sort` 未指定時は server が current user の `articleSortOrder` を適用し、client はその順序を正として扱う
- offline / flaky network 対応は MVP では read/save/star に限定し、最終状態は `PATCH /articles/{id}/state` の部分更新結果と一致させる
- offline / multi-device 競合時の article state は server received order による last-write-wins で収束させる
- 上記競合方針では、遅延した古い retry が新しい操作結果を上書きしうる。MVP では許容するが、client は成功済み操作を無制限に再送せず、retry queue を短時間で収束させる
- MVP の retry queue は短期ローカル再送に限定し、再起動後も保持される永続キューやオフライン閲覧機能は導入しない
- retained article の可視性は `API.md` と `DATABASE.md` の定義に従う
- feed 同一性は MVP では canonical feed URL を基準とし、publisher 単位の自動統合は行わない

## Authentication and Authorization

- Clerk 認証後、アプリケーションは通常サインイン時に限り `clerk_user_id` を唯一キーとして `users` を upsert する
- user endpoint は Clerk session を必須とする
- admin endpoint の認可は Clerk role または同等の server-side metadata で一元判定する
- Clerk webhook は署名検証を必須とし、重複配送されても冪等に処理する
- アカウント削除フロー中または削除済みユーザーを、自動 upsert で再生成してはならない
- 削除要求受付後の `clerk_user_id` は tombstone または active deletion job を source of truth として自動 upsert 対象から除外する
- アカウント削除、監査ログ、secret 管理などの運用ルールは `OPERATIONS.md` に従う

## Decision Gates

### Implementation Start

実装開始は Go とする。理由は、MVP の主語、データ所有境界、主要 API、DB schema、画面導線、運用・リリース基準が実装者に渡せる粒度で定義済みだからである。

実装開始後に発見した詳細差分は、以下を満たす限り仕様更新を伴う通常の実装課題として扱い、開始判断の差し戻し理由にしない。

- `subscription` 主語、shared `feed/article/content`、user-owned state の境界を壊さない
- 初期リリース対象を `iOS` `Android` `Web` `Browser Extension` と backend/API/operations とする
- API contract、DB migration、画面表示状態、運用 checklist のいずれかに追記して吸収できる

### Release

リリースは `OPERATIONS.md` の Release Checklist を全項目満たし、各機能が `iOS` `Android` `Web + Extension` で同一リリース単位にそろった時点で Go とする。
