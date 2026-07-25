# filo Database Design

Cloudflare D1 を利用する。ORM は一旦使用しない予定とする。

## Table of Contents

- [Schema Rules](#schema-rules)
- [Schema](#schema)
- [Data Rules](#data-rules)
- [Query Expectations](#query-expectations)
- [Recommended Indexes](#recommended-indexes)

## Schema Rules

- DB 上の timestamp は SQLite / D1 の `TEXT` で保存する
- API ではすべて ISO 8601 UTC string に正規化して返す
- schema 変更は D1 migration として管理する
- production の破壊的 migration は対応 Worker／全 client と同一リリース単位で適用し、旧 schema 互換は維持しない
- application は `PRAGMA foreign_keys = ON` を有効化してから write query を実行する

## Schema

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE deleted_user_tombstones (
  clerk_user_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleanup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (cleanup_status IN ('pending', 'running', 'completed', 'failed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_deletion_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  clerk_user_id TEXT NOT NULL,
  deletion_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE opml_import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  source_xml TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  failure_summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'system'
    CHECK (theme IN ('light', 'dark', 'system')),
  language TEXT NOT NULL DEFAULT 'ja'
    CHECK (language IN ('ja', 'en', 'zh', 'ko', 'es')),
  readable_languages TEXT NOT NULL DEFAULT '["ja"]',
  article_sort_order TEXT NOT NULL DEFAULT 'published_at_desc'
    CHECK (article_sort_order IN ('published_at_desc', 'fetched_at_desc')),
  open_in_browser_by_default INTEGER NOT NULL DEFAULT 0
    CHECK (open_in_browser_by_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url TEXT NOT NULL UNIQUE,
  site_url TEXT,
  title TEXT NOT NULL,
  description TEXT,
  favicon_url TEXT,
  language TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  custom_title TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  initial_fetch_status TEXT NOT NULL DEFAULT 'fetching'
    CHECK (initial_fetch_status IN ('fetching', 'ready', 'failed')),
  initial_fetch_error_code TEXT,
  initial_fetch_requested_at TEXT,
  initial_fetch_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE RESTRICT
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, normalized_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE subscription_tags (
  subscription_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subscription_id, tag_id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL,
  guid TEXT,
  canonical_url TEXT,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  rss_summary TEXT,
  rss_content_html TEXT,
  source_language TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (feed_id, dedupe_key),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE RESTRICT
);

CREATE TABLE article_contents (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  text TEXT,
  html TEXT,
  source_language TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE article_listing_translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (article_id, language),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE article_read_states (
  user_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0
    CHECK (is_read IN (0, 1)),
  read_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE article_user_collections (
  user_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('reading_list', 'bookmark')),
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, article_id, kind),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE feed_read_cursors (
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  last_read_article_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE feed_fetch_states (
  feed_id INTEGER PRIMARY KEY,
  last_fetched_at TEXT,
  last_success_fetched_at TEXT,
  next_fetch_after TEXT,
  http_etag TEXT,
  http_last_modified TEXT,
  last_result TEXT
    CHECK (last_result IN ('success', 'not_modified', 'error')),
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE feed_fetch_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT NOT NULL
    CHECK (result IN ('success', 'not_modified', 'error')),
  fetched_article_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE feed_jobs (
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('fetch', 'translate')),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feed_id, kind),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE TABLE playback_queue_items (
  user_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE playback_states (
  user_id INTEGER PRIMARY KEY,
  current_article_id INTEGER,
  content_language TEXT,
  position_percent REAL NOT NULL DEFAULT 0
    CHECK (position_percent >= 0 AND position_percent <= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (current_article_id) REFERENCES articles(id) ON DELETE SET NULL
);
```

## Data Rules

- `subscriptions` がユーザー操作の主語であり、`feeds` は共有リソースとして扱う
- `articles` は feed 単位で共有し、ユーザーごとの既読上書きは `article_read_states`、リーディングリスト／ブックマーク所属は `article_user_collections` に保持する
- `canonical_url` は RSS 実データ欠損を考慮して nullable とする
- `dedupe_key` は `guid` を優先し、利用できない場合は正規化 `canonical_url`、さらに取れない場合は `title + published_at + author` を入力にした安定ハッシュから生成する
- article 再fetch で metadata が変化した場合は `articles` の該当列と `updated_at` を更新してよい
- `feeds.language` / `articles.source_language` / `article_contents.source_language` は原文言語コードを保持し、`ja/en` に限定しない。翻訳先・UI設定としてサポートする言語は `ja/en/zh/ko/es`
- `article_listing_translations` は一覧表示用に RSS タイトルを言語ごとに翻訳して保持する。ステータスページや購読管理から手動トリガーで生成する
- 記事一覧の翻訳タイトルは、表示言語の `article_listing_translations`（`status='ready'`）があり、かつ `source_language` がユーザーの `readable_languages` に含まれない場合に表示する
- `article_contents` は記事ごとに1:1で抽出された本文を保持する（`article_id` が PK）。失敗時もレコードを保持して再試行可能にする
- `article_contents.status` は `pending -> ready | error` を基本とし、retry 時のみ `error -> pending` を許可する
- `article_contents` はリーディングパート(音読キュー)のための本文抽出結果であり、音読キュー追加などユーザーの明示操作を起点に on-demand で生成する
- 本文翻訳はアプリでは提供しない(各プラットフォーム / ブラウザの翻訳機能に委ねる)ため、本文翻訳テーブルは持たない
- `user_settings.readable_languages` はユーザーが原文のまま読む言語のJSON配列（default `'["ja"]'`）であり、表示時のタイトルの原文・翻訳の出し分けにのみ使い、生成パイプラインには影響しない
- article metadata 更新だけでは既存 `article_contents` を自動 invalidation しない。`article_contents` は stale 許容の shared cache とする
- `tags` は feed ではなく `subscriptions` に紐づく
- `subscription_tags` は DB の FK だけでは同一 user 制約を表現できないため、application 層で `subscription.user_id == tag.user_id` を必須検証する
- 閲覧履歴は独立テーブルを持たず、`article_read_states.is_read` と `read_at` で表現する
- `feed_read_cursors` は user × feed の既読カーソルを保持し、`last_read_article_id` 以下の article id を既読とみなす。フィード単位の全既読操作で作成・前進する
- 既読の実効判定は `article_read_states` row が存在すればその `is_read` を正とし、row がない場合のみカーソルに従う（カーソル既読の記事も記事単位で未読へ戻せる）
- カーソルは前進のみとし、より小さい `last_read_article_id` での更新要求は無視する
- 全既読操作はカーソル前進に加え、対象範囲内の既存 `article_read_states` の `is_read=0` row を `is_read=1` に更新する（row 未作成の記事はカーソルで賄い、記事数に比例した row 作成は行わない）
- リーディングリスト／ブックマーク操作は `article_read_states` を作成・更新せず、実効既読状態と独立させる
- `feed_read_cursors` は subscription ではなく user × feed に紐づき、購読解除・再購読後も維持される
- `article_user_collections` は `subscription` から独立して保持し、unsubscribe 後も `reading_list` または `bookmark` membership がある記事の参照権を維持する
- unsubscribe 済み記事は最後の collection membership が削除された時点で参照不可に戻る
- `deleted_user_tombstones` は削除受付済み `clerk_user_id` の再作成防止を担当し、`account_deletion_jobs` は cleanup 再試行管理を担当する
- `opml_import_jobs` は user ごとの import 非同期処理状態を保持する。外部公開の `jobId` は `opml_{id}` 形式に変換して返してよい
- `opml_import_jobs.failure_summary_json` は失敗明細の要約保持に限定し、全件監査ログの永続化は MVP 対象外とする
- `subscriptions.sort_order` と `tags.sort_order` でユーザー定義順を保持する
- `subscriptions.initial_fetch_status` は購読作成時の初回記事取得だけを表す購読単位の状態とし、定常 feed refresh の成功・失敗では更新しない
- `subscriptions.initial_fetch_status` は、既存 feed に `last_success_fetched_at` がある、または article が1件以上ある場合は購読作成直後に `ready` としてよい
- 上記条件を満たさない購読では、作成時または user retry 時に `fetching`、初回記事取得成功時に `ready`、初回記事取得失敗確定時に `failed` へ遷移する
- 初回記事取得成功は、対象 feed の fetch と article upsert が完了した時点で確定し、記事件数 `0` でも `ready` とする
- 同一 feed を待機中の current user の subscription は、同一 initial fetch 結果を共有してまとめて `ready` または `failed` へ遷移してよい
- `subscriptions.initial_fetch_error_code` は `initial_fetch_status='failed'` の場合のみ保持し、user retry 開始時に clear する
- `feedHealthStatus` の導出では、`feeds.status='paused'` を最優先し、active feed で `last_success_fetched_at` が `72h` を超えて古い場合のみ `stale` とする
- `feed_fetch_states` 未作成または `last_success_fetched_at IS NULL` の間は、`initial_fetch_status=fetching` なら異常扱いせず `healthy` 相当で返す
- site URL 入力時は feed discovery を先に行い、確定した実 feed URL を `feeds.feed_url` に保存する
- OPML import worker が作成する subscription でも、`initial_fetch_status` の判定規則は通常の subscription 作成と同一とする
- `deleted_user_tombstones` は削除受付直後から再作成防止の source of truth として扱い、削除開始中の状態追跡は `account_deletion_jobs` を正とする
- `playback_queue_items` はユーザーごとの読み上げキューを保持し、`sort_order` で再生順序を管理する
- `playback_queue_items` は端末間で共有され、iOS / Android / Web + Extension で同一キューを参照する
- 同一記事は1ユーザーのキューに1回のみ存在する（`user_id + article_id` で一意）
- `playback_states` はユーザーごとに1行保持し、現在の再生位置を管理する
- `playback_states.content_language` は再生中のコンテンツ言語を記録し、端末切替時に同一テキストから再開可能にする
- `playback_states.position_percent` は `0.0` 〜 `1.0` の範囲で再生進捗を記録する。TTS 速度は端末により異なるため、時間ではなくテキスト全体に対する割合で保持する
- キュー内の記事を削除した際、その記事が `playback_states.current_article_id` と一致する場合は再生位置をリセットする
- `feed_jobs` はユーザーが明示要求した feed 単位ジョブ（`kind='fetch'` の取得、`kind='translate'` の一覧タイトル翻訳）の最新状態を保持する。`user_id + feed_id + kind` で1行に上書きし、履歴は保持しない
- `feed_jobs.status` は `pending -> running -> completed | failed` を基本とし、再要求・再開時は `pending` に戻す
- fetch job は worker 側では feed 単位で処理されるため、完了時は同一 `feed_id` の全ユーザーの `pending/running` 行をまとめて確定する
- `pending/running` のまま `updated_at` が閾値（`10m`）を超えて更新されない `feed_jobs` 行は中断（stalled）扱いとし、`POST /status/resume` の再enqueue対象とする
- `updated_at` は application 層で更新する。D1 trigger を使う場合は migration に明示する

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
- 読み上げ開始時に `article_read_states.is_read=1` と `read_at` を更新する
- retained article の `subscriptionContext` は空配列として返す
- `DELETE /articles/{id}/reading-list` または `DELETE /articles/{id}/bookmark` により unsubscribe 済み記事の最後の membership が削除された場合、以後その記事は不可視になる
- `PATCH /articles/{id}/state` の競合は server received order による last-write-wins で収束させる
- この競合方針では、遅延した古い retry が新しい操作結果を上書きしうる
- 読み上げキューは `playback_queue_items` を `sort_order ASC, article_id ASC` で返す
- 読み上げキューへの追加は既存アイテムの最大 `sort_order` の次に挿入する。重複は `ON CONFLICT DO NOTHING` で吸収する
- 読み上げキューの並び替えは全件の `sort_order` を一括更新する
- `playback_states` の更新は部分更新とし、未指定フィールドは変更しない

## Recommended Indexes

```sql
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_user_sort_order ON subscriptions(user_id, sort_order);
CREATE INDEX idx_subscriptions_feed_id ON subscriptions(feed_id);
CREATE INDEX idx_tags_user_sort_order ON tags(user_id, sort_order);
CREATE INDEX idx_subscription_tags_tag_id ON subscription_tags(tag_id);
CREATE INDEX idx_subscription_tags_subscription_id ON subscription_tags(subscription_id);
CREATE INDEX idx_articles_feed_published_at ON articles(feed_id, published_at DESC);
CREATE INDEX idx_articles_feed_fetched_at ON articles(feed_id, fetched_at DESC);
CREATE INDEX idx_articles_feed_id_id ON articles(feed_id, id);
CREATE INDEX idx_articles_published_id ON articles(published_at DESC, id DESC);
CREATE INDEX idx_articles_fetched_id ON articles(fetched_at DESC, id DESC);
CREATE INDEX idx_article_read_states_user_read ON article_read_states(user_id, is_read, article_id);
CREATE INDEX idx_article_read_states_article_id ON article_read_states(article_id);
CREATE INDEX idx_article_user_collections_user_kind_article ON article_user_collections(user_id, kind, article_id);
CREATE INDEX idx_article_user_collections_article_id ON article_user_collections(article_id);
CREATE INDEX idx_article_listing_translations_article_lang ON article_listing_translations(article_id, language);
CREATE INDEX idx_feed_fetch_states_next_fetch_after ON feed_fetch_states(next_fetch_after);
CREATE INDEX idx_feed_jobs_user_status ON feed_jobs(user_id, status, updated_at);
CREATE INDEX idx_feed_jobs_feed_kind ON feed_jobs(feed_id, kind, status);
CREATE INDEX idx_account_deletion_jobs_status_updated_at ON account_deletion_jobs(status, updated_at);
CREATE INDEX idx_account_deletion_jobs_clerk_user_id ON account_deletion_jobs(clerk_user_id);
CREATE INDEX idx_opml_import_jobs_user_created_at ON opml_import_jobs(user_id, created_at DESC);
CREATE INDEX idx_playback_queue_items_user_sort ON playback_queue_items(user_id, sort_order);
```
