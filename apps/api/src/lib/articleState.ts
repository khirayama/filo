import { readingListMembershipCounterMutation, readStateCounterMutations } from "./readCursor";
import type { ArticleStateRow } from "./serialize";
import { nowIso } from "./util";

export type ArticleCollectionKind = "reading_list" | "bookmark";

export function collectionMutation(
  db: D1Database,
  userId: number,
  articleId: number,
  kind: ArticleCollectionKind,
  active: boolean,
  now: string,
): D1PreparedStatement {
  if (!active) {
    return db
      .prepare("DELETE FROM article_user_collections WHERE user_id = ? AND article_id = ? AND kind = ?")
      .bind(userId, articleId, kind);
  }
  return db
    .prepare(
      `INSERT INTO article_user_collections (user_id, article_id, kind, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, article_id, kind) DO NOTHING`,
    )
    .bind(userId, articleId, kind, now, now);
}

export function readStateMutation(
  db: D1Database,
  userId: number,
  articleId: number,
  isRead: boolean,
  now: string,
): D1PreparedStatement {
  const readAt = isRead ? now : null;
  return db.prepare(
    `INSERT INTO article_read_states (user_id, article_id, is_read, read_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, article_id) DO UPDATE SET
       is_read = excluded.is_read, read_at = excluded.read_at, updated_at = excluded.updated_at`,
  ).bind(userId, articleId, isRead ? 1 : 0, readAt, now);
}

export async function hasArticleCollection(db: D1Database, userId: number, articleId: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM article_user_collections
       WHERE user_id = ? AND article_id = ?
       LIMIT 1`,
    )
    .bind(userId, articleId)
    .first();
  return row !== null;
}

// Resolves explicit read overrides, cursor-derived read state, and bookmark
// membership into the transport-neutral state projection.
export async function effectiveArticleState(
  db: D1Database,
  userId: number,
  articleId: number,
): Promise<ArticleStateRow | null> {
  const state = await db
    .prepare(
      `SELECT CASE
                WHEN ars.user_id IS NOT NULL THEN ars.is_read
                WHEN frc.last_read_article_id >= a.id THEN 1
                ELSE 0
              END AS is_read,
              CASE WHEN rli.user_id IS NULL THEN 0 ELSE 1 END AS in_reading_list,
              CASE WHEN ab.user_id IS NULL THEN 0 ELSE 1 END AS is_bookmarked
       FROM articles a
       LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
       LEFT JOIN article_user_collections rli
         ON rli.user_id = ? AND rli.article_id = a.id AND rli.kind = 'reading_list'
       LEFT JOIN article_user_collections ab
         ON ab.user_id = ? AND ab.article_id = a.id AND ab.kind = 'bookmark'
       LEFT JOIN feed_read_cursors frc
         ON frc.user_id = ? AND frc.feed_id = a.feed_id
       WHERE a.id = ?`,
    )
    .bind(userId, userId, userId, userId, articleId)
    .first<ArticleStateRow>();
  return state;
}

export async function setArticleCollection(
  db: D1Database,
  userId: number,
  articleId: number,
  kind: ArticleCollectionKind,
  active: boolean,
): Promise<ArticleStateRow | null> {
  const now = nowIso();
  const before = await effectiveArticleState(db, userId, articleId);
  if (!before) return null;

  const currentMembership = kind === "reading_list" ? before.in_reading_list : before.is_bookmarked;
  if (currentMembership === (active ? 1 : 0)) return before;

  // The counter statement runs first so it sees the membership before the change.
  const mutations = kind === "reading_list"
    ? [readingListMembershipCounterMutation(db, userId, articleId, active, now)]
    : [];
  mutations.push(collectionMutation(db, userId, articleId, kind, active, now));
  await db.batch(mutations);
  return {
    ...before,
    in_reading_list: kind === "reading_list" ? (active ? 1 : 0) : before.in_reading_list,
    is_bookmarked: kind === "bookmark" ? (active ? 1 : 0) : before.is_bookmarked,
  };
}

export async function setArticleReadState(
  db: D1Database,
  userId: number,
  articleId: number,
  feedId: number,
  isRead: boolean,
): Promise<ArticleStateRow | null> {
  const before = await effectiveArticleState(db, userId, articleId);
  if (!before) return null;

  const nextRead = isRead ? 1 : 0;
  if (nextRead === before.is_read) return before;

  const now = nowIso();
  // The counter statements run first so they see the state before the change.
  await db.batch([
    ...readStateCounterMutations(db, userId, articleId, feedId, isRead, now),
    readStateMutation(db, userId, articleId, isRead, now),
  ]);
  return { ...before, is_read: nextRead };
}
