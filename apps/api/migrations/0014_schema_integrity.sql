-- Keep ownership invariants in the database as well as in the API layer.
-- The application still validates these relationships for user-facing errors,
-- while these guards protect worker paths and future direct SQL writes.

-- These single-column indexes are covered by the leftmost columns of the
-- following indexes / primary keys and only add write and storage overhead.
DROP INDEX IF EXISTS idx_subscriptions_user_id;
DROP INDEX IF EXISTS idx_subscription_tags_subscription_id;

CREATE TRIGGER IF NOT EXISTS trg_subscription_tags_same_user_insert
BEFORE INSERT ON subscription_tags
WHEN NOT EXISTS (
  SELECT 1
  FROM subscriptions s
  JOIN tags t ON t.user_id = s.user_id
  WHERE s.id = NEW.subscription_id
    AND t.id = NEW.tag_id
)
BEGIN
  SELECT RAISE(ABORT, 'subscription and tag must belong to the same user');
END;

CREATE TRIGGER IF NOT EXISTS trg_subscription_tags_same_user_update
BEFORE UPDATE OF subscription_id, tag_id ON subscription_tags
WHEN NOT EXISTS (
  SELECT 1
  FROM subscriptions s
  JOIN tags t ON t.user_id = s.user_id
  WHERE s.id = NEW.subscription_id
    AND t.id = NEW.tag_id
)
BEGIN
  SELECT RAISE(ABORT, 'subscription and tag must belong to the same user');
END;

CREATE TRIGGER IF NOT EXISTS trg_subscription_unread_counts_consistent_insert
BEFORE INSERT ON subscription_unread_counts
WHEN NOT EXISTS (
  SELECT 1
  FROM subscriptions s
  WHERE s.id = NEW.subscription_id
    AND s.user_id = NEW.user_id
    AND s.feed_id = NEW.feed_id
)
BEGIN
  SELECT RAISE(ABORT, 'subscription unread count does not match subscription');
END;

CREATE TRIGGER IF NOT EXISTS trg_subscription_unread_counts_consistent_update
BEFORE UPDATE OF subscription_id, user_id, feed_id ON subscription_unread_counts
WHEN NOT EXISTS (
  SELECT 1
  FROM subscriptions s
  WHERE s.id = NEW.subscription_id
    AND s.user_id = NEW.user_id
    AND s.feed_id = NEW.feed_id
)
BEGIN
  SELECT RAISE(ABORT, 'subscription unread count does not match subscription');
END;

CREATE TRIGGER IF NOT EXISTS trg_feed_read_cursors_same_feed_insert
BEFORE INSERT ON feed_read_cursors
WHEN NOT EXISTS (
  SELECT 1
  FROM articles a
  WHERE a.id = NEW.last_read_article_id
    AND a.feed_id = NEW.feed_id
)
BEGIN
  SELECT RAISE(ABORT, 'read cursor article must belong to cursor feed');
END;

CREATE TRIGGER IF NOT EXISTS trg_feed_read_cursors_same_feed_update
BEFORE UPDATE OF feed_id, last_read_article_id ON feed_read_cursors
WHEN NOT EXISTS (
  SELECT 1
  FROM articles a
  WHERE a.id = NEW.last_read_article_id
    AND a.feed_id = NEW.feed_id
)
BEGIN
  SELECT RAISE(ABORT, 'read cursor article must belong to cursor feed');
END;
