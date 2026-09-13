-- Keep the frequently displayed unread counts as small derived values. The
-- source-of-truth rows remain article_read_states, feed_read_cursors, and
-- article_user_collections; these counters are repaired on the rare bulk-read
-- paths and can be rebuilt from those tables if needed.
CREATE TABLE subscription_unread_counts (
  subscription_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX idx_subscription_unread_counts_user
  ON subscription_unread_counts(user_id, subscription_id);
CREATE INDEX idx_subscription_unread_counts_feed
  ON subscription_unread_counts(feed_id);

CREATE TABLE user_unread_counts (
  user_id INTEGER PRIMARY KEY,
  reading_list_count INTEGER NOT NULL DEFAULT 0 CHECK (reading_list_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO subscription_unread_counts (subscription_id, user_id, feed_id, unread_count, updated_at)
SELECT
  s.id,
  s.user_id,
  s.feed_id,
  COUNT(a.id),
  CURRENT_TIMESTAMP
FROM subscriptions s
LEFT JOIN articles a ON a.feed_id = s.feed_id
LEFT JOIN article_read_states ars
  ON ars.user_id = s.user_id AND ars.article_id = a.id
LEFT JOIN feed_read_cursors frc
  ON frc.user_id = s.user_id AND frc.feed_id = s.feed_id
WHERE (
  (ars.user_id IS NOT NULL AND ars.is_read = 0)
  OR (ars.user_id IS NULL AND (frc.last_read_article_id IS NULL OR frc.last_read_article_id < a.id))
)
GROUP BY s.id, s.user_id, s.feed_id;

-- Subscriptions with no unread articles still need a zero row so subsequent
-- increments are cheap and deterministic.
INSERT INTO subscription_unread_counts (subscription_id, user_id, feed_id, unread_count, updated_at)
SELECT s.id, s.user_id, s.feed_id, 0, CURRENT_TIMESTAMP
FROM subscriptions s
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_unread_counts c WHERE c.subscription_id = s.id
);

INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at)
SELECT
  u.id,
  COUNT(a.id),
  CURRENT_TIMESTAMP
FROM users u
LEFT JOIN article_user_collections rli
  ON rli.user_id = u.id AND rli.kind = 'reading_list'
LEFT JOIN articles a ON a.id = rli.article_id
LEFT JOIN article_read_states ars
  ON ars.user_id = u.id AND ars.article_id = a.id
LEFT JOIN feed_read_cursors frc
  ON frc.user_id = u.id AND frc.feed_id = a.feed_id
WHERE (
  (ars.user_id IS NOT NULL AND ars.is_read = 0)
  OR (ars.user_id IS NULL AND (frc.last_read_article_id IS NULL OR frc.last_read_article_id < a.id))
)
GROUP BY u.id;

INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at)
SELECT u.id, 0, CURRENT_TIMESTAMP
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_unread_counts c WHERE c.user_id = u.id
);
