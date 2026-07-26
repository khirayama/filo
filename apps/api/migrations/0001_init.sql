PRAGMA foreign_keys = ON;

-- Users & auth

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clerk_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A deletion request is recorded here before Clerk is called, and keeps normal
-- sign-in from re-creating the user while cleanup is still running.
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

-- Settings

-- `language` is the app's display language; `readable_languages` are the
-- languages the user reads without help, so a title already in one of them is
-- shown untranslated.
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

-- Feeds & subscriptions

-- A feed is a shared source; everything per-user lives in `subscriptions`.
CREATE TABLE feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url TEXT NOT NULL UNIQUE,
  site_url TEXT,
  title TEXT NOT NULL,
  description TEXT,
  favicon_url TEXT,
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

-- Articles

-- `source_language` is what the translation model reported about the title, so
-- it stays NULL until the article has been through a translation drain. No
-- local language inference writes it.
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

-- Body extraction exists for the reading part (speech queue) only. A row here
-- always means an extraction was requested, so `pending` means a job is in
-- flight and nothing else may create the row.
CREATE TABLE article_contents (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  text TEXT,
  html TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'error')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per (article, target language). These rows are the translation work
-- ledger: `pending` is queued, `processing_at` marks a pair in flight to the
-- model, `ready`/`error` are terminal. There is no separate translation job.
CREATE TABLE article_listing_translations (
  article_id INTEGER NOT NULL,
  language TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'error')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  processing_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, language),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- Explicit read overrides. A missing row does not mean unread: the feed read
-- cursor below decides that case.
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

-- Sparse memberships. A membership here is also what keeps an article
-- reachable after unsubscribe (a "retained article").
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

-- "Everything up to this article id is read", per user and feed. Mark-all-read
-- advances the cursor instead of writing one row per article.
CREATE TABLE feed_read_cursors (
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  last_read_article_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

-- Feed fetch tracking

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

-- A user-requested feed fetch. The row is written before the queue message, so
-- a lost message still leaves a row the status screen shows as interrupted and
-- the user can re-run. Title translation has no job row; its ledger is
-- article_listing_translations.
CREATE TABLE feed_jobs (
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

-- Playback queue

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

-- Indexes

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_user_sort_order ON subscriptions(user_id, sort_order);
CREATE INDEX idx_subscriptions_feed_id ON subscriptions(feed_id);
CREATE INDEX idx_tags_user_sort_order ON tags(user_id, sort_order);
CREATE INDEX idx_subscription_tags_tag_id ON subscription_tags(tag_id);
CREATE INDEX idx_subscription_tags_subscription_id ON subscription_tags(subscription_id);
CREATE INDEX idx_articles_feed_published_at ON articles(feed_id, published_at DESC);
CREATE INDEX idx_articles_feed_fetched_at ON articles(feed_id, fetched_at DESC);
CREATE INDEX idx_articles_published_id ON articles(published_at DESC, id DESC);
CREATE INDEX idx_articles_fetched_id ON articles(fetched_at DESC, id DESC);
-- Unread counts scan a feed's articles as an id range against the read cursor.
CREATE INDEX idx_articles_feed_id_id ON articles(feed_id, id);
CREATE INDEX idx_article_read_states_user_read ON article_read_states(user_id, is_read, article_id);
CREATE INDEX idx_article_read_states_article_id ON article_read_states(article_id);
CREATE INDEX idx_article_user_collections_user_kind_article
  ON article_user_collections(user_id, kind, article_id);
CREATE INDEX idx_article_user_collections_article_id ON article_user_collections(article_id);
-- The drain selects pending pairs across every article.
CREATE INDEX idx_article_listing_translations_status
  ON article_listing_translations(status, article_id);
CREATE INDEX idx_feed_fetch_states_next_fetch_after ON feed_fetch_states(next_fetch_after);
CREATE INDEX idx_feed_jobs_user_status ON feed_jobs(user_id, status, updated_at);
CREATE INDEX idx_feed_jobs_feed_status ON feed_jobs(feed_id, status);
CREATE INDEX idx_account_deletion_jobs_status_updated_at ON account_deletion_jobs(status, updated_at);
CREATE INDEX idx_account_deletion_jobs_clerk_user_id ON account_deletion_jobs(clerk_user_id);
CREATE INDEX idx_opml_import_jobs_user_created_at ON opml_import_jobs(user_id, created_at DESC);
CREATE INDEX idx_playback_queue_items_user_sort ON playback_queue_items(user_id, sort_order);
