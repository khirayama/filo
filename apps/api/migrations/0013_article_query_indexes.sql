-- Language backfill only needs articles whose source language is still
-- unknown. Keep this partial index ordered for the feed worker's newest-first
-- batch so it does not scan already-classified articles.
CREATE INDEX idx_articles_feed_untranslated_id
ON articles(feed_id, id DESC)
WHERE source_language IS NULL;
