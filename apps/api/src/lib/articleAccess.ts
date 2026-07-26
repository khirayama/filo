import { errors } from "./errors";
import { hasArticleCollection } from "./articleState";

export interface ArticleRow {
  id: number;
  feed_id: number;
  guid: string | null;
  canonical_url: string | null;
  title: string;
  author: string | null;
  rss_summary: string | null;
  rss_content_html: string | null;
  source_language: string | null;
  published_at: string | null;
  fetched_at: string;
}

export interface ArticleAccess {
  article: ArticleRow;
  subscribed: boolean;
  retained: boolean;
}

export async function requireArticleAccess(db: D1Database, userId: number, articleId: number): Promise<ArticleAccess> {
  const article = await db.prepare("SELECT * FROM articles WHERE id = ?").bind(articleId).first<ArticleRow>();
  if (!article) throw errors.notFound("article_not_found", "Article not found");

  const subscription = await db
    .prepare("SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ? LIMIT 1")
    .bind(userId, article.feed_id)
    .first();
  if (subscription) return { article, subscribed: true, retained: false };

  if (await hasArticleCollection(db, userId, articleId)) {
    return { article, subscribed: false, retained: true };
  }

  throw errors.notFound("article_not_found", "Article not found");
}

// Batched variant of subscriptionContextFor for list responses; avoids two
// queries per row. Chunked to stay under D1's bound-parameter limit.
export async function subscriptionContextsForFeeds(
  db: D1Database,
  userId: number,
  feedIds: number[]
): Promise<Map<number, { subscriptionIds: number[]; tagIds: number[] }>> {
  const map = new Map<number, { subscriptionIds: number[]; tagIds: number[] }>();
  const unique = [...new Set(feedIds)];
  for (const feedId of unique) map.set(feedId, { subscriptionIds: [], tagIds: [] });
  if (unique.length === 0) return map;

  const CHUNK = 80;
  const subToFeed = new Map<number, number>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(`SELECT id, feed_id FROM subscriptions WHERE user_id = ? AND feed_id IN (${placeholders}) ORDER BY id ASC`)
      .bind(userId, ...chunk)
      .all<{ id: number; feed_id: number }>();
    for (const row of results) {
      map.get(row.feed_id)?.subscriptionIds.push(row.id);
      subToFeed.set(row.id, row.feed_id);
    }
  }

  const subscriptionIds = [...subToFeed.keys()];
  for (let i = 0; i < subscriptionIds.length; i += CHUNK) {
    const chunk = subscriptionIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT DISTINCT subscription_id, tag_id FROM subscription_tags WHERE subscription_id IN (${placeholders}) ORDER BY tag_id ASC`
      )
      .bind(...chunk)
      .all<{ subscription_id: number; tag_id: number }>();
    for (const row of results) {
      const feedId = subToFeed.get(row.subscription_id);
      if (feedId === undefined) continue;
      const context = map.get(feedId);
      if (context && !context.tagIds.includes(row.tag_id)) context.tagIds.push(row.tag_id);
    }
  }
  return map;
}

export async function subscriptionContextFor(
  db: D1Database,
  userId: number,
  feedId: number
): Promise<{ subscriptionIds: number[]; tagIds: number[] }> {
  const { results: subs } = await db
    .prepare("SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ? ORDER BY id ASC")
    .bind(userId, feedId)
    .all<{ id: number }>();
  const subscriptionIds = subs.map((r) => r.id);
  if (subscriptionIds.length === 0) return { subscriptionIds: [], tagIds: [] };
  const placeholders = subscriptionIds.map(() => "?").join(",");
  const { results: tags } = await db
    .prepare(`SELECT DISTINCT tag_id FROM subscription_tags WHERE subscription_id IN (${placeholders}) ORDER BY tag_id ASC`)
    .bind(...subscriptionIds)
    .all<{ tag_id: number }>();
  return { subscriptionIds, tagIds: tags.map((r) => r.tag_id) };
}
