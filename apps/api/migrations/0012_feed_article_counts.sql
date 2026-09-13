-- The status endpoint needs the article total for the user's subscriptions.
-- Keeping it on the shared feed avoids scanning every article on each status
-- poll. The initial value is rebuilt once from the source-of-truth table.
ALTER TABLE feeds ADD COLUMN article_count INTEGER NOT NULL DEFAULT 0;

UPDATE feeds
SET article_count = (
  SELECT COUNT(*) FROM articles WHERE articles.feed_id = feeds.id
);
