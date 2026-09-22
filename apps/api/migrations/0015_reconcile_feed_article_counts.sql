-- Repair the derived feed article totals once before the API trusts them for
-- query planning. This is idempotent and only touches feeds whose counter is
-- already known to be stale.
UPDATE feeds
SET article_count = (
  SELECT COUNT(*) FROM articles WHERE articles.feed_id = feeds.id
),
updated_at = CURRENT_TIMESTAMP
WHERE article_count <> (
  SELECT COUNT(*) FROM articles WHERE articles.feed_id = feeds.id
);
