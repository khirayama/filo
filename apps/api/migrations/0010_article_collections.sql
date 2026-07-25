PRAGMA foreign_keys = ON;

-- Reading progress, the reading list, and bookmarks have different lifecycles.
-- Split the former catch-all state row into explicit read overrides and sparse
-- collection memberships while preserving every existing value and timestamp.

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

INSERT INTO article_read_states (user_id, article_id, is_read, read_at, updated_at)
SELECT user_id, article_id, is_read, read_at, updated_at
FROM article_user_states;

INSERT INTO article_user_collections (user_id, article_id, kind, added_at, updated_at)
SELECT user_id, article_id, 'reading_list', COALESCE(saved_at, updated_at), updated_at
FROM article_user_states
WHERE is_saved = 1;

INSERT INTO article_user_collections (user_id, article_id, kind, added_at, updated_at)
SELECT user_id, article_id, 'bookmark', COALESCE(starred_at, updated_at), updated_at
FROM article_user_states
WHERE is_starred = 1;

DROP TABLE article_user_states;

CREATE INDEX idx_article_read_states_user_read
  ON article_read_states(user_id, is_read, article_id);
CREATE INDEX idx_article_read_states_article_id
  ON article_read_states(article_id);
CREATE INDEX idx_article_user_collections_user_kind_article
  ON article_user_collections(user_id, kind, article_id);
CREATE INDEX idx_article_user_collections_article_id
  ON article_user_collections(article_id);
