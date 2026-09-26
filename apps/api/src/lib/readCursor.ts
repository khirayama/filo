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

// Current effective read state (0/1) of one article for one user, as a scalar
// subquery. Binds: userId, userId, articleId.
const ARTICLE_IS_READ = `(SELECT ${EFFECTIVE_IS_READ}
  FROM articles a
  LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
  LEFT JOIN feed_read_cursors frc ON frc.user_id = ? AND frc.feed_id = a.feed_id
  WHERE a.id = ?)`;

// Unread articles of the subscription row `s`: explicit unread overrides plus
// the cursor tail without an override. The two branches are disjoint and use
// the sparse state index and the feed/id range index respectively.
const SUBSCRIPTION_UNREAD_COUNT = `(
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
     ))
)`;

// Unread reading-list articles of user ?. The reading list can hold retained
// articles outside any subscription, so it is not a sum of subscription counts.
const READING_LIST_UNREAD_COUNT = `(
  SELECT COUNT(*)
  FROM article_user_collections rli
  JOIN articles a ON a.id = rli.article_id
  LEFT JOIN article_read_states ars ON ars.user_id = rli.user_id AND ars.article_id = a.id
  LEFT JOIN feed_read_cursors frc ON frc.user_id = rli.user_id AND frc.feed_id = a.feed_id
  WHERE rli.user_id = ? AND rli.kind = 'reading_list' AND (${EFFECTIVE_IS_READ}) = 0
)`;

export interface UnreadCounts {
  all_articles: number;
  reading_list: number;
}

export type UnreadCountScope = "all" | "reading_list" | "both";

export async function unreadCountsForUser(
  db: D1Database,
  userId: number,
  scope: UnreadCountScope = "both",
): Promise<UnreadCounts> {
  const allArticles = scope === "reading_list"
    ? "0"
    : "(SELECT COALESCE(SUM(unread_count), 0) FROM subscription_unread_counts WHERE user_id = ?)";
  const readingList = scope === "all"
    ? "0"
    : "(SELECT reading_list_count FROM user_unread_counts WHERE user_id = ?)";
  const binds: number[] = [];
  if (scope !== "reading_list") binds.push(userId);
  if (scope !== "all") binds.push(userId);

  const row = await db
    .prepare(
      `SELECT
         ${allArticles} AS all_articles,
         ${readingList} AS reading_list`
    )
    .bind(...binds)
    .first<UnreadCounts>();

  return {
    all_articles: Number(row?.all_articles ?? 0),
    reading_list: Number(row?.reading_list ?? 0),
  };
}

// The counters are maintained by these statements and by the article insert
// trigger (migration 0019). Every statement decides its delta from the state
// it sees inside the same D1 batch, so concurrent requests cannot count one
// change twice. Put them before the write they account for.

// Creates the counter row for the user's subscription to a feed, counted from
// the source-of-truth rows. Batch it right after the subscription insert.
export function createSubscriptionUnreadCountMutation(
  db: D1Database,
  userId: number,
  feedId: number,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO subscription_unread_counts (subscription_id, user_id, feed_id, unread_count, updated_at)
     SELECT s.id, s.user_id, s.feed_id, ${SUBSCRIPTION_UNREAD_COUNT}, ?
     FROM subscriptions s
     WHERE s.user_id = ? AND s.feed_id = ?
     ON CONFLICT (subscription_id) DO NOTHING`,
  ).bind(now, userId, feedId);
}

// Recounts a subscription from the source-of-truth rows. Batch it after the
// bulk read-state change it accounts for.
export function recountSubscriptionUnreadMutation(
  db: D1Database,
  subscriptionId: number,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE subscription_unread_counts
     SET unread_count = (
           SELECT ${SUBSCRIPTION_UNREAD_COUNT}
           FROM subscriptions s WHERE s.id = subscription_unread_counts.subscription_id
         ),
         updated_at = ?
     WHERE subscription_id = ?`,
  ).bind(now, subscriptionId);
}

// Recounts the user's reading list from the source-of-truth rows. Batch it
// after the bulk read-state change it accounts for.
export function recountReadingListUnreadMutation(
  db: D1Database,
  userId: number,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at)
     VALUES (?, ${READING_LIST_UNREAD_COUNT}, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       reading_list_count = excluded.reading_list_count,
       updated_at = excluded.updated_at`,
  ).bind(userId, userId, now);
}

// Counter updates for setting one article's read state. Each applies only
// when the article is currently in the opposite state.
export function readStateCounterMutations(
  db: D1Database,
  userId: number,
  articleId: number,
  feedId: number,
  isRead: boolean,
  now: string,
): D1PreparedStatement[] {
  const delta = isRead ? -1 : 1;
  const wasRead = isRead ? 0 : 1;
  return [
    db.prepare(
      `UPDATE subscription_unread_counts
       SET unread_count = MAX(0, unread_count + ?), updated_at = ?
       WHERE user_id = ? AND feed_id = ? AND ${ARTICLE_IS_READ} = ?`,
    ).bind(delta, now, userId, feedId, userId, userId, articleId, wasRead),
    db.prepare(
      `UPDATE user_unread_counts
       SET reading_list_count = MAX(0, reading_list_count + ?), updated_at = ?
       WHERE user_id = ? AND ${ARTICLE_IS_READ} = ?
         AND EXISTS (
           SELECT 1 FROM article_user_collections
           WHERE user_id = ? AND article_id = ? AND kind = 'reading_list'
         )`,
    ).bind(delta, now, userId, userId, userId, articleId, wasRead, userId, articleId),
  ];
}

// Counter update for adding or removing an article in the reading list. It
// applies only when the article is unread and the membership actually changes.
export function readingListMembershipCounterMutation(
  db: D1Database,
  userId: number,
  articleId: number,
  active: boolean,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE user_unread_counts
     SET reading_list_count = MAX(0, reading_list_count + ?), updated_at = ?
     WHERE user_id = ? AND ${ARTICLE_IS_READ} = 0
       AND ${active ? "NOT EXISTS" : "EXISTS"} (
         SELECT 1 FROM article_user_collections
         WHERE user_id = ? AND article_id = ? AND kind = 'reading_list'
       )`,
  ).bind(active ? 1 : -1, now, userId, userId, userId, articleId, userId, articleId);
}
