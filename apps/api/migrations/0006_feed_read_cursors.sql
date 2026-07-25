-- Per-feed read cursor: "everything up to this article id is read" per user.
-- Mark-all-read advances the cursor instead of writing one row per article;
-- explicit article_user_states rows override the cursor.
CREATE TABLE feed_read_cursors (
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  last_read_article_id INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

-- Unread counts scan articles per feed with an id range against the cursor.
CREATE INDEX idx_articles_feed_id_id ON articles(feed_id, id);
