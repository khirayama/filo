-- OPML import and a failed tag validation on subscribe used to leave
-- subscriptions without a counter row. Such a subscription always showed
-- zero unread and was ignored by the new-article increment. Rebuild only
-- the missing rows from the source-of-truth tables, with the same shape as
-- countFeedUnread: explicit unread overrides plus the cursor tail.
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
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_unread_counts c WHERE c.subscription_id = s.id
);
