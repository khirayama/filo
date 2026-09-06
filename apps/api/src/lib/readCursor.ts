// Per-feed read cursors: a feed_read_cursors row marks every article with
// id <= last_read_article_id as read for that user, unless an explicit
// article_read_states row exists — an existing row's is_read always wins.

// Effective read state for article `a` with joins `ars` (article_read_states)
// and `frc` (feed_read_cursors). Evaluates to 0/1.
export const EFFECTIVE_IS_READ = `CASE
  WHEN ars.user_id IS NOT NULL THEN ars.is_read
  WHEN frc.last_read_article_id >= a.id THEN 1
  ELSE 0
END`;

export interface ReadCursorRow {
  last_read_article_id: number;
  updated_at: string;
}

export async function readCursorFor(db: D1Database, userId: number, feedId: number): Promise<ReadCursorRow | null> {
  return await db
    .prepare("SELECT last_read_article_id, updated_at FROM feed_read_cursors WHERE user_id = ? AND feed_id = ?")
    .bind(userId, feedId)
    .first<ReadCursorRow>();
}

// Unread article counts per subscription; ids missing from the map have 0
// unread. Matches the read=false semantics of the article list.
export async function unreadCountsForSubscriptions(
  db: D1Database,
  subscriptionIds: number[]
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (subscriptionIds.length === 0) return map;

  const CHUNK = 80;
  for (let i = 0; i < subscriptionIds.length; i += CHUNK) {
    const chunk = subscriptionIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT s.id AS subscription_id, COUNT(a.id) AS unread_count
         FROM subscriptions s
         JOIN articles a ON a.feed_id = s.feed_id
         LEFT JOIN article_read_states ars ON ars.user_id = s.user_id AND ars.article_id = a.id
         LEFT JOIN feed_read_cursors frc ON frc.user_id = s.user_id AND frc.feed_id = s.feed_id
         WHERE s.id IN (${placeholders}) AND (${EFFECTIVE_IS_READ}) = 0
         GROUP BY s.id`
      )
      .bind(...chunk)
      .all<{ subscription_id: number; unread_count: number }>();
    for (const row of results) map.set(row.subscription_id, row.unread_count);
  }
  return map;
}

export interface UnreadCounts {
  all_articles: number;
  reading_list: number;
}

// The reading list can contain retained articles that are no longer under a
// subscription, so its count cannot be derived from subscription counts.
export async function unreadCountsForUser(db: D1Database, userId: number): Promise<UnreadCounts> {
  const row = await db
    .prepare(
      `SELECT
         (
           SELECT COUNT(a.id)
           FROM articles a
           LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
           LEFT JOIN feed_read_cursors frc ON frc.user_id = ? AND frc.feed_id = a.feed_id
           WHERE EXISTS (
             SELECT 1 FROM subscriptions s WHERE s.user_id = ? AND s.feed_id = a.feed_id
           )
           AND (${EFFECTIVE_IS_READ}) = 0
         ) AS all_articles,
         (
           SELECT COUNT(a.id)
           FROM articles a
           JOIN article_user_collections rli
             ON rli.article_id = a.id AND rli.user_id = ? AND rli.kind = 'reading_list'
           LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
           LEFT JOIN feed_read_cursors frc ON frc.user_id = ? AND frc.feed_id = a.feed_id
           WHERE (${EFFECTIVE_IS_READ}) = 0
         ) AS reading_list`
    )
    .bind(userId, userId, userId, userId, userId, userId)
    .first<UnreadCounts>();

  return {
    all_articles: Number(row?.all_articles ?? 0),
    reading_list: Number(row?.reading_list ?? 0),
  };
}
