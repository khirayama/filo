import { readCursorFor } from "./readCursor";
import type { ArticleStateRow } from "./serialize";
import { nowIso } from "./util";

export type ArticleCollectionKind = "bookmark";

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
       ON CONFLICT (user_id, article_id, kind) DO UPDATE SET updated_at = excluded.updated_at`,
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
       WHERE user_id = ? AND article_id = ? AND kind = 'bookmark'
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
  feedId: number,
): Promise<ArticleStateRow | null> {
  const state = await db
    .prepare(
      `SELECT ars.is_read,
              CASE WHEN ab.user_id IS NULL THEN 0 ELSE 1 END AS is_bookmarked
       FROM articles a
       LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
       LEFT JOIN article_user_collections ab
         ON ab.user_id = ? AND ab.article_id = a.id AND ab.kind = 'bookmark'
       WHERE a.id = ?`,
    )
    .bind(userId, userId, articleId)
    .first<ArticleStateRow>();
  if (!state || state.is_read !== null) return state;

  const cursor = await readCursorFor(db, userId, feedId);
  if (cursor && cursor.last_read_article_id >= articleId) {
    return {
      ...state,
      is_read: 1,
    };
  }
  return { ...state, is_read: 0 };
}

export async function setArticleCollection(
  db: D1Database,
  userId: number,
  articleId: number,
  feedId: number,
  kind: ArticleCollectionKind,
  active: boolean,
): Promise<ArticleStateRow | null> {
  const now = nowIso();
  await collectionMutation(db, userId, articleId, kind, active, now).run();
  return effectiveArticleState(db, userId, articleId, feedId);
}
