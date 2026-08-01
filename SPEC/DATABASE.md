# filo Database Design

Cloudflare D1 を利用する。ORM は使用せず、SQL を直接書く。

スキーマの正は `apps/api/migrations/0001_init.sql` の 1 本だけとする。本書は DDL を再掲せず、DDL では表現できない意図・不変条件・クエリ期待値だけを書く。列や制約を知りたい場合は migration を読む。

## Table of Contents

- [Schema Rules](#schema-rules)
- [Tables](#tables)
- [Data Rules](#data-rules)
- [Query Expectations](#query-expectations)

## Schema Rules

- DB 上の timestamp は SQLite / D1 の `TEXT` で保存する
- API ではすべて ISO 8601 UTC string に正規化して返す
- schema 変更は D1 migration として管理する
- 破壊的 migration は対応 Worker／全 client と同一リリース単位で適用し、旧 schema 互換は維持しない
- application は `PRAGMA foreign_keys = ON` を有効化してから write query を実行する
- `updated_at` は application 層で更新する。D1 trigger を使う場合は migration に明示する

## Tables

所有境界ごとの一覧。詳細は migration を参照する。

user-owned（アカウント削除で消える）:

| テーブル | 役割 |
| --- | --- |
| `users` | Clerk user と内部 id の対応 |
| `user_settings` | テーマ、表示言語、原文のまま読む言語、並び順 |
| `subscriptions` | ユーザーの購読。カスタムタイトル、並び順、初回取得状態 |
| `tags` / `subscription_tags` | 購読の分類 |
| `article_read_states` | 記事単位の明示的な既読上書き |
| `article_user_collections` | リーディングリスト / ブックマーク membership |
| `feed_read_cursors` | user × feed の既読カーソル |
| `feed_jobs` | ユーザーが要求した feed 取得ジョブの現在状態 |
| `playback_queue_items` / `playback_states` | 端末間で共有する読み上げキューと再生位置 |
| `opml_import_jobs` | OPML import の非同期処理状態 |

shared（ユーザー間で共有。アカウント削除でも消さない）:

| テーブル | 役割 |
| --- | --- |
| `feeds` | RSS/Atom の取得元。宣言言語 `language` を含む |
| `articles` | feed 配下の記事実体。`source_language` を含む |
| `article_contents` | 本文抽出結果（リーディングパート専用） |
| `feed_fetch_states` / `feed_fetch_logs` | 取得の現在状態と履歴 |

account deletion 専用:

| テーブル | 役割 |
| --- | --- |
| `deleted_user_tombstones` | 削除受付済み `clerk_user_id` の再作成防止 |
| `account_deletion_jobs` | cleanup の再試行管理 |

## Data Rules

### 所有境界

- `subscriptions` がユーザー操作の主語であり、`feeds` は共有リソースとして扱う
- `articles` は feed 単位で共有し、ユーザーごとの既読上書きは `article_read_states`、リーディングリスト／ブックマーク所属は `article_user_collections` に保持する
- `tags` は feed ではなく `subscriptions` に紐づく
- `subscription_tags` は DB の FK だけでは同一 user 制約を表現できないため、application 層で `subscription.user_id == tag.user_id` を必須検証する
- `article_user_collections` は `subscription` から独立して保持し、unsubscribe 後も `reading_list` または `bookmark` membership がある記事の参照権を維持する（retained article）
- unsubscribe 済み記事は最後の collection membership が削除された時点で参照不可に戻る
- `feed_read_cursors` は subscription ではなく user × feed に紐づき、購読解除・再購読後も維持される

### 記事

- `canonical_url` は RSS 実データ欠損を考慮して nullable とする
- `dedupe_key` は `guid` を優先し、利用できない場合は正規化 `canonical_url`、さらに取れない場合は `title + published_at + author` を入力にした安定ハッシュから生成する
- article 再fetch で metadata が変化した場合は `articles` の該当列と `updated_at` を更新してよい

### 言語と翻訳

- 翻訳はすべて端末内で行うため、**サーバーは翻訳を生成も保存もしない**。翻訳テーブルは持たない
- **原文言語はサーバーが fetch 時に決める。** クライアントは自前の言語判定を持たない（判定器が端末ごとにあると挙動が揃わないため）
- `feeds.language` は feed の言語。`feeds.language_source` が `declared` なら発行者の申告（RSS `<language>` / Atom `xml:lang`）、`detected` なら全 item を連結した長文からの判定。申告済みのフィードを判定結果で上書きしない
- `articles.source_language` は記事の言語。フィード言語を事前確率とし、**明確に違うときだけ**上書きする。読み上げ時の音声選択とクライアントの翻訳元にも使うため、`ja/en/zh/ko/es` に限定しない
  - 仮名・ハングルがあれば文字体系で確定する
  - 文字体系がフィードと違う場合だけ、タイトル＋説明文（140 字以上）から判定して上書きする
  - どちらでもなければフィード言語を使う。判定できなければ `NULL`（翻訳しない）
- 判定精度は文字数でほぼ決まる。タイトル単独では英語の 10 件中 2 件を誤判定するため、**記事単位で言語を当て直そうとしない**（`apps/api/src/lib/languageDetect.ts` に実測値を記載）
- `user_settings.readable_languages` はユーザーが原文のまま読む言語の JSON 配列（default `'["ja"]'`）であり、クライアントが翻訳対象を絞り込むためだけに使う
- 本文翻訳もアプリでは生成しない（各プラットフォーム / ブラウザの翻訳機能に委ねる）ため、本文翻訳テーブルも持たない

### 本文抽出

- `article_contents` は記事ごとに 1:1 で抽出された本文を保持する（`article_id` が PK）。失敗時もレコードを保持して再試行可能にする
- **行の存在それ自体が「抽出を要求済み」を意味する。** `pending` はジョブが実行中であることを表すので、抽出以外の目的でこの行を作ってはならない（作ると重複起動抑止が誤作動し、抽出が永久に始まらない）
- `article_contents.status` は `pending -> ready | error` を基本とし、retry 時のみ `error -> pending` を許可する
- `article_contents` はリーディングパートのための本文抽出結果であり、ユーザーの明示操作を起点に on-demand で生成する
- `article_contents` は可視ページからの抽出が失敗したときの fallback 専用であり、読み上げの第一経路ではない（`READING.md`）。最終利用から 7 日を過ぎた行は削除してよい
- article metadata 更新だけでは既存 `article_contents` を自動 invalidation しない。`article_contents` は stale 許容の shared cache とする

### 既読

- 閲覧履歴は独立テーブルを持たず、`article_read_states.is_read` と `read_at` で表現する
- `feed_read_cursors` は user × feed の既読カーソルを保持し、`last_read_article_id` 以下の article id を既読とみなす。フィード単位の全既読操作で作成・前進する
- 既読の実効判定は `article_read_states` row が存在すればその `is_read` を正とし、row がない場合のみカーソルに従う（カーソル既読の記事も記事単位で未読へ戻せる）
- カーソルは前進のみとし、より小さい `last_read_article_id` での更新要求は無視する
- 全既読操作はカーソル前進に加え、対象範囲内の既存 `article_read_states` の `is_read=0` row を `is_read=1` に更新する（row 未作成の記事はカーソルで賄い、記事数に比例した row 作成は行わない）
- リーディングリスト／ブックマーク操作は `article_read_states` を作成・更新せず、実効既読状態と独立させる

### 購読と取得

- `subscriptions.initial_fetch_status` は購読作成時の初回記事取得だけを表す購読単位の状態とし、定常 feed refresh の成功・失敗では更新しない
- 既存 feed に `last_success_fetched_at` がある、または article が1件以上ある場合は購読作成直後に `ready` としてよい
- 上記条件を満たさない購読では、作成時または user retry 時に `fetching`、初回記事取得成功時に `ready`、初回記事取得失敗確定時に `failed` へ遷移する
- 初回記事取得成功は、対象 feed の fetch と article upsert が完了した時点で確定し、記事件数 `0` でも `ready` とする
- 同一 feed を待機中の current user の subscription は、同一 initial fetch 結果を共有してまとめて `ready` または `failed` へ遷移してよい
- `subscriptions.initial_fetch_error_code` は `initial_fetch_status='failed'` の場合のみ保持し、user retry 開始時に clear する
- `feedHealthStatus` の導出では、`feeds.status='paused'` を最優先し、active feed で `last_success_fetched_at` が `72h` を超えて古い場合のみ `stale` とする
- `feed_fetch_states` 未作成または `last_success_fetched_at IS NULL` の間は、`initial_fetch_status=fetching` なら異常扱いせず `healthy` 相当で返す
- site URL 入力時は feed discovery を先に行い、確定した実 feed URL を `feeds.feed_url` に保存する
- OPML import worker が作成する subscription でも、`initial_fetch_status` の判定規則は通常の subscription 作成と同一とする

### ジョブ

- `feed_jobs` はユーザーが明示要求した feed 取得ジョブの最新状態を保持する。`user_id + feed_id` で1行に上書きし、履歴は保持しない
- `feed_jobs.status` は `pending -> running -> completed | failed` を基本とし、再要求・再開時は `pending` に戻す
- fetch job は worker 側では feed 単位で処理されるため、完了時は同一 `feed_id` の全ユーザーの `pending/running` 行をまとめて確定する
- `pending/running` のまま `updated_at` が `10m` を超えて更新されない `feed_jobs` 行は中断（stalled）扱いとし、購読行ごとの取得操作で再実行できる。中断はアクティブ扱いせず操作を塞がない
- `deleted_user_tombstones` は削除受付直後から再作成防止の source of truth として扱い、削除進行中の状態追跡は `account_deletion_jobs` を正とする
- `opml_import_jobs.failure_summary_json` は失敗明細の要約保持に限定し、全件監査ログの永続化は MVP 対象外とする

### 読み上げキュー

- `playback_queue_items` はリーディング開始時点のリーディングリストを固定する内部セッションで、`sort_order` で再生順序を管理する
- キューは端末間で共有され、iOS / Android / Web + Extension で同一キューを参照する
- 同一記事は1ユーザーのキューに1回のみ存在する（`user_id + article_id` で一意）
- `playback_states` はユーザーごとに1行保持し、現在の再生位置を管理する
- `playback_states.content_language` は再生中のコンテンツ言語を記録し、端末切替時に同一テキストから再開可能にする
- `playback_states.position_percent` は `0.0` 〜 `1.0` の範囲で再生進捗を記録する。TTS 速度は端末により異なるため、時間ではなくテキスト全体に対する割合で保持する
- キュー内の記事を削除した際、その記事が `playback_states.current_article_id` と一致する場合は再生位置をリセットする

## Query Expectations

- 通常の記事一覧は `subscriptions -> feeds -> articles` の可視性判定で絞り込む
- 記事一覧の `sort` 未指定時は current user の `user_settings.article_sort_order` を適用する
- 記事一覧の複合 filter は strict AND で評価する
- `read=true` は実効既読（`article_read_states.is_read = 1`、または row がなく `feed_read_cursors` がその article id を覆う）を意味する
- `read=false` は実効未読（`is_read = 0` の row が存在する、または row がなくカーソルにも覆われない）を意味する
- subscription 一覧の `unreadCount` は実効未読と同じ条件で feed 配下の article を数える
- `readingList=true` または `bookmarked=true` の一覧では retained article を返してよい
- `readingList=true AND bookmarked=true` は両方を満たす retained/current article のみ返す
- `subscriptionId` 指定の一覧では retained article を返さず、対象 subscription 配下の記事だけを返す
- `tagId` フィルタは `subscription_tags` 経由で適用する
- retained article は `subscriptionContext` を持たないため、`readingList/bookmarked` と `tagId` の複合条件では返さない
- `readingList` / `bookmarked` は対応する `article_user_collections.kind` membership がなければ `false` とみなす
- 記事詳細取得時は current user の `subscriptions` 存在確認を行い、未購読でも retained article なら参照を許可する
- `read=false` の一覧は retained article を含めない
- `published_at` が `NULL` の記事は `published_at_desc` で末尾に寄せ、同順位では `id DESC` を使う
- タグ一覧と購読一覧は `sort_order ASC, id ASC` で返す
- 前後移動時は移動元、読み上げ完了時は完了記事の `article_read_states.is_read=1` と `read_at` を更新する。開始・一時停止だけでは更新しない
- retained article の `subscriptionContext` は空配列として返す
- `DELETE /articles/{id}/reading-list` または `DELETE /articles/{id}/bookmark` により unsubscribe 済み記事の最後の membership が削除された場合、以後その記事は不可視になる
- `PATCH /articles/{id}/state` の競合は server received order による last-write-wins で収束させる
- この競合方針では、遅延した古い retry が新しい操作結果を上書きしうる
- 読み上げキューは `playback_queue_items` を `sort_order ASC, article_id ASC` で返す
- 読み上げキューへの追加は既存アイテムの最大 `sort_order` の次に挿入する。重複は `ON CONFLICT DO NOTHING` で吸収する
- 読み上げキューの並び替えは全件の `sort_order` を一括更新する
- `playback_states` の更新は部分更新とし、未指定フィールドは変更しない
