-- A new article is unread for every current subscriber: its id is above any
-- read cursor and no read override can exist for it yet. Advance the derived
-- counters in the same statement as the insert, so no fetch path can miss
-- them and a concurrent mark-all-read or subscribe is serialized with them.
--
-- Release order: deploy the API that no longer increments these counters
-- itself, then apply this migration. The rebuild below then also corrects
-- whatever happened in between.
--
-- The file is idempotent, so re-running it with `wrangler d1 execute` is the
-- repair procedure for drifted counters (SPEC/OPERATIONS.md).
CREATE TRIGGER IF NOT EXISTS trg_articles_derived_counts_insert
AFTER INSERT ON articles
BEGIN
  UPDATE feeds SET article_count = article_count + 1 WHERE id = NEW.feed_id;
  UPDATE subscription_unread_counts
  SET unread_count = unread_count + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE feed_id = NEW.feed_id;
END;

-- Rebuild every derived counter once from the source-of-truth tables, with
-- the same shape as SUBSCRIPTION_UNREAD_COUNT / READING_LIST_UNREAD_COUNT in
-- src/lib/readCursor.ts.
UPDATE feeds
SET article_count = (SELECT COUNT(*) FROM articles WHERE articles.feed_id = feeds.id);

INSERT INTO subscription_unread_counts (subscription_id, user_id, feed_id, unread_count, updated_at)
SELECT
  s.id,
  s.user_id,
  s.feed_id,
  (SELECT COUNT(*)
   FROM article_read_states ars
   JOIN articles a ON a.id = ars.article_id
   WHERE ars.user_id = s.user_id AND ars.is_read = 0 AND a.feed_id = s.feed_id)
  +
  (SELECT COUNT(*)
   FROM articles a
   WHERE a.feed_id = s.feed_id
     AND a.id > COALESCE((
       SELECT frc.last_read_article_id FROM feed_read_cursors frc
       WHERE frc.user_id = s.user_id AND frc.feed_id = s.feed_id
     ), 0)
     AND NOT EXISTS (
       SELECT 1 FROM article_read_states ars
       WHERE ars.user_id = s.user_id AND ars.article_id = a.id
     )),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM subscriptions s
WHERE true
ON CONFLICT (subscription_id) DO UPDATE SET
  unread_count = excluded.unread_count,
  updated_at = excluded.updated_at;

INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at)
SELECT
  u.id,
  (SELECT COUNT(*)
   FROM article_user_collections rli
   JOIN articles a ON a.id = rli.article_id
   LEFT JOIN article_read_states ars ON ars.user_id = rli.user_id AND ars.article_id = a.id
   LEFT JOIN feed_read_cursors frc ON frc.user_id = rli.user_id AND frc.feed_id = a.feed_id
   WHERE rli.user_id = u.id AND rli.kind = 'reading_list'
     AND CASE
           WHEN ars.user_id IS NOT NULL THEN ars.is_read
           WHEN frc.last_read_article_id >= a.id THEN 1
           ELSE 0
         END = 0),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM users u
WHERE true
ON CONFLICT (user_id) DO UPDATE SET
  reading_list_count = excluded.reading_list_count,
  updated_at = excluded.updated_at;
