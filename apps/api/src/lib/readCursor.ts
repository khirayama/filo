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

export interface UnreadCounts {
  all_articles: number;
  reading_list: number;
}

export type UnreadCountScope = "all" | "reading_list" | "both";

// The reading list can contain retained articles that are no longer under a
// subscription, so its count cannot be derived from subscription counts.
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

export function subscriptionUnreadCountMutation(
  db: D1Database,
  subscriptionId: number,
  userId: number,
  feedId: number,
  unreadCount: number,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO subscription_unread_counts
       (subscription_id, user_id, feed_id, unread_count, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (subscription_id) DO UPDATE SET
       user_id = excluded.user_id,
       feed_id = excluded.feed_id,
       unread_count = excluded.unread_count,
       updated_at = excluded.updated_at`,
  ).bind(subscriptionId, userId, feedId, Math.max(unreadCount, 0), now);
}

export function incrementUnreadForFeedMutation(
  db: D1Database,
  feedId: number,
  amount: number,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `UPDATE subscription_unread_counts
     SET unread_count = unread_count + ?, updated_at = ?
     WHERE feed_id = ?`,
  ).bind(amount, now, feedId);
}

export function adjustArticleUnreadMutations(
  db: D1Database,
  userId: number,
  feedId: number,
  inReadingList: boolean,
  delta: number,
  now: string,
): D1PreparedStatement[] {
  if (delta === 0) return [];
  const mutations: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE subscription_unread_counts
       SET unread_count = MAX(0, unread_count + ?), updated_at = ?
       WHERE user_id = ? AND feed_id = ?`,
    ).bind(delta, now, userId, feedId),
  ];
  if (inReadingList) {
    mutations.push(
      db.prepare(
        `INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at)
         VALUES (?, MAX(0, ?), ?)
         ON CONFLICT (user_id) DO UPDATE SET
           reading_list_count = MAX(0, user_unread_counts.reading_list_count + ?),
           updated_at = excluded.updated_at`,
      ).bind(userId, delta, now, delta),
    );
  }
  return mutations;
}

export function adjustReadingListUnreadMutation(
  db: D1Database,
  userId: number,
  delta: number,
  now: string,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at)
     VALUES (?, MAX(0, ?), ?)
     ON CONFLICT (user_id) DO UPDATE SET
       reading_list_count = MAX(0, user_unread_counts.reading_list_count + ?),
       updated_at = excluded.updated_at`,
  ).bind(userId, delta, now, delta);
}

export async function initializeSubscriptionUnreadCount(
  db: D1Database,
  subscriptionId: number,
  userId: number,
  feedId: number,
  now: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(a.id) AS unread_count
     FROM articles a
     LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
     LEFT JOIN feed_read_cursors frc ON frc.user_id = ? AND frc.feed_id = a.feed_id
     WHERE a.feed_id = ? AND (${EFFECTIVE_IS_READ}) = 0`,
  ).bind(userId, userId, feedId).first<{ unread_count: number }>();
  const count = Number(row?.unread_count ?? 0);
  await subscriptionUnreadCountMutation(db, subscriptionId, userId, feedId, count, now).run();
  return count;
}

export async function recomputeReadingListUnreadCount(db: D1Database, userId: number, now: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(a.id) AS unread_count
     FROM articles a
     JOIN article_user_collections rli
       ON rli.article_id = a.id AND rli.user_id = ? AND rli.kind = 'reading_list'
     LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
     LEFT JOIN feed_read_cursors frc ON frc.user_id = ? AND frc.feed_id = a.feed_id
     WHERE (${EFFECTIVE_IS_READ}) = 0`,
  ).bind(userId, userId, userId).first<{ unread_count: number }>();
  const count = Number(row?.unread_count ?? 0);
  await db.prepare(
    `INSERT INTO user_unread_counts (user_id, reading_list_count, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       reading_list_count = excluded.reading_list_count,
       updated_at = excluded.updated_at`,
  ).bind(userId, count, now).run();
  return count;
}
