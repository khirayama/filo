-- Translation work is now driven directly by article_listing_translations rows
-- (pending → ready | error) drained by a single global job, instead of per-feed
-- per-user feed_jobs rows.

ALTER TABLE article_listing_translations ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_article_listing_translations_status
  ON article_listing_translations(status, article_id);

-- feed_jobs no longer tracks translation; fetch jobs remain.
DELETE FROM feed_jobs WHERE kind = 'translate';
