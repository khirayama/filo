import { Hono } from "hono";
import { requireArticleAccess } from "../lib/articleAccess";
import type { AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { nowIso, parseId, toIso } from "../lib/util";

interface QueueItemRow {
  article_id: number;
  sort_order: number;
  created_at: string;
  title: string;
  canonical_url: string | null;
  source_language: string | null;
  published_at: string | null;
  feed_id: number;
  feed_title: string;
  feed_favicon_url: string | null;
}

interface PlaybackStateRow {
  current_article_id: number | null;
  content_language: string | null;
  position_percent: number;
  updated_at: string;
}

interface ReadingListRow {
  article_id: number;
  is_read: number;
}

export function firstUnreadArticleId(items: ReadingListRow[]): number | null {
  return items.find((item) => item.is_read === 0)?.article_id ?? null;
}

function serializeItem(row: QueueItemRow) {
  return {
    articleId: row.article_id,
    sortOrder: row.sort_order,
    article: {
      id: row.article_id,
      title: row.title,
      sourceLanguage: row.source_language,
      canonicalUrl: row.canonical_url,
      publishedAt: toIso(row.published_at),
      feed: { id: row.feed_id, title: row.feed_title, faviconUrl: row.feed_favicon_url },
    },
    createdAt: toIso(row.created_at),
  };
}

function serializeState(state: PlaybackStateRow | null) {
  return state
    ? {
        currentArticleId: state.current_article_id,
        contentLanguage: state.content_language,
        positionPercent: state.position_percent,
        updatedAt: toIso(state.updated_at),
      }
    : null;
}

async function readQueue(db: D1Database, userId: number) {
  const [{ results: items }, state] = await Promise.all([
    db.prepare(
      `SELECT pqi.article_id, pqi.sort_order, pqi.created_at,
        a.title, a.canonical_url, a.source_language, a.published_at,
        f.id AS feed_id, f.title AS feed_title, f.favicon_url AS feed_favicon_url
       FROM playback_queue_items pqi
       JOIN articles a ON a.id = pqi.article_id
       JOIN feeds f ON f.id = a.feed_id
       WHERE pqi.user_id = ?
       ORDER BY pqi.sort_order ASC, pqi.article_id ASC`,
    ).bind(userId).all<QueueItemRow>(),
    db.prepare(
      "SELECT current_article_id, content_language, position_percent, updated_at FROM playback_states WHERE user_id = ?",
    ).bind(userId).first<PlaybackStateRow>(),
  ]);
  return { items: items.map(serializeItem), playbackState: serializeState(state) };
}

function parseArticleIds(value: unknown, allowEmpty = false): number[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw errors.validation("articleIds must be an array");
  }
  if (value.length > 100) throw errors.validation("too many articleIds (max 100)");
  const ids = value.map((raw) => {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
      throw errors.validation("each articleId must be a positive integer");
    }
    return raw;
  });
  if (new Set(ids).size !== ids.length) throw errors.validation("articleIds must be unique");
  return ids;
}

export const playbackQueueRoutes = new Hono<AppContext>()
  .get("/", async (c) => c.json({ data: await readQueue(c.env.DB, c.get("user").id) }))
  .post("/start", async (c) => {
    const user = c.get("user");
    const { results: readingList } = await c.env.DB.prepare(
      `SELECT auc.article_id,
        CASE
          WHEN ars.user_id IS NOT NULL THEN ars.is_read
          WHEN frc.last_read_article_id IS NOT NULL AND a.id <= frc.last_read_article_id THEN 1
          ELSE 0
        END AS is_read
       FROM article_user_collections auc
       JOIN articles a ON a.id = auc.article_id
       LEFT JOIN article_read_states ars ON ars.user_id = auc.user_id AND ars.article_id = auc.article_id
       LEFT JOIN feed_read_cursors frc ON frc.user_id = auc.user_id AND frc.feed_id = a.feed_id
       WHERE auc.user_id = ? AND auc.kind = 'reading_list' AND a.canonical_url IS NOT NULL
       ORDER BY auc.added_at ASC, auc.article_id ASC`,
    ).bind(user.id).all<ReadingListRow>();

    const now = nowIso();
    const currentArticleId = firstUnreadArticleId(readingList);
    const statements = [
      c.env.DB.prepare("DELETE FROM playback_queue_items WHERE user_id = ?").bind(user.id),
      c.env.DB.prepare("DELETE FROM playback_states WHERE user_id = ?").bind(user.id),
      ...readingList.map((item, index) =>
        c.env.DB.prepare(
          "INSERT INTO playback_queue_items (user_id, article_id, sort_order, created_at) VALUES (?, ?, ?, ?)",
        ).bind(user.id, item.article_id, index, now),
      ),
    ];
    if (currentArticleId !== null) {
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO playback_states (user_id, current_article_id, position_percent, updated_at) VALUES (?, ?, 0, ?)",
        ).bind(user.id, currentArticleId, now),
      );
    }
    await c.env.DB.batch(statements);
    return c.json({ data: await readQueue(c.env.DB, user.id) });
  })
  .post("/items", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ articleIds?: unknown }>().catch(() => null);
    const articleIds = parseArticleIds(body?.articleIds);
    for (const articleId of articleIds) await requireArticleAccess(c.env.DB, user.id, articleId);
    const max = await c.env.DB.prepare(
      "SELECT MAX(sort_order) AS value FROM playback_queue_items WHERE user_id = ?",
    ).bind(user.id).first<{ value: number | null }>();
    const now = nowIso();
    await c.env.DB.batch(articleIds.map((articleId, index) =>
      c.env.DB.prepare(
        `INSERT INTO playback_queue_items (user_id, article_id, sort_order, created_at)
         VALUES (?, ?, ?, ?) ON CONFLICT (user_id, article_id) DO NOTHING`,
      ).bind(user.id, articleId, (max?.value ?? -1) + index + 1, now),
    ));
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) AS value FROM playback_queue_items WHERE user_id = ?",
    ).bind(user.id).first<{ value: number }>();
    return c.json({ data: { itemCount: count?.value ?? 0 } });
  })
  .delete("/items/:articleId", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM playback_queue_items WHERE user_id = ? AND article_id = ?").bind(user.id, articleId),
      c.env.DB.prepare(
        `UPDATE playback_states SET current_article_id = NULL, content_language = NULL,
         position_percent = 0, updated_at = ? WHERE user_id = ? AND current_article_id = ?`,
      ).bind(nowIso(), user.id, articleId),
    ]);
    return c.json({ data: { success: true } });
  })
  .put("/order", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ articleIds?: unknown }>().catch(() => null);
    const articleIds = parseArticleIds(body?.articleIds, true);
    const { results } = await c.env.DB.prepare(
      "SELECT article_id FROM playback_queue_items WHERE user_id = ?",
    ).bind(user.id).all<{ article_id: number }>();
    const existing = new Set(results.map((row) => row.article_id));
    if (articleIds.length !== existing.size || articleIds.some((id) => !existing.has(id))) {
      throw errors.validation("articleIds must include every queue item exactly once");
    }
    if (articleIds.length > 0) {
      await c.env.DB.batch(articleIds.map((id, index) =>
        c.env.DB.prepare("UPDATE playback_queue_items SET sort_order = ? WHERE user_id = ? AND article_id = ?")
          .bind(index, user.id, id),
      ));
    }
    return c.json({ data: { success: true } });
  })
  .delete("/", async (c) => {
    const userId = c.get("user").id;
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM playback_queue_items WHERE user_id = ?").bind(userId),
      c.env.DB.prepare("DELETE FROM playback_states WHERE user_id = ?").bind(userId),
    ]);
    return c.json({ data: { success: true } });
  })
  .patch("/state", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{
      currentArticleId?: unknown;
      contentLanguage?: unknown;
      positionPercent?: unknown;
    }>().catch(() => null);
    if (!body) throw errors.validation();

    const sets: string[] = [];
    const binds: unknown[] = [];
    if (body.currentArticleId !== undefined) {
      if (body.currentArticleId !== null &&
          (typeof body.currentArticleId !== "number" || !Number.isInteger(body.currentArticleId))) {
        throw errors.validation("invalid currentArticleId");
      }
      if (body.currentArticleId !== null) {
        const item = await c.env.DB.prepare(
          "SELECT 1 FROM playback_queue_items WHERE user_id = ? AND article_id = ?",
        ).bind(user.id, body.currentArticleId).first();
        if (!item) throw errors.validation("article is not in the reading session");
      }
      sets.push("current_article_id = ?");
      binds.push(body.currentArticleId);
    }
    if (body.contentLanguage !== undefined) {
      if (body.contentLanguage !== null && typeof body.contentLanguage !== "string") {
        throw errors.validation("invalid contentLanguage");
      }
      sets.push("content_language = ?");
      binds.push(body.contentLanguage);
    }
    if (body.positionPercent !== undefined) {
      if (typeof body.positionPercent !== "number" || body.positionPercent < 0 || body.positionPercent > 1) {
        throw errors.validation("positionPercent must be between 0 and 1");
      }
      sets.push("position_percent = ?");
      binds.push(body.positionPercent);
    }
    if (sets.length === 0) throw errors.validation("at least one field is required");

    const now = nowIso();
    await c.env.DB.prepare(
      "INSERT INTO playback_states (user_id, updated_at) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING",
    ).bind(user.id, now).run();
    sets.push("updated_at = ?");
    binds.push(now, user.id);
    await c.env.DB.prepare(`UPDATE playback_states SET ${sets.join(", ")} WHERE user_id = ?`).bind(...binds).run();
    const state = await c.env.DB.prepare(
      "SELECT current_article_id, content_language, position_percent, updated_at FROM playback_states WHERE user_id = ?",
    ).bind(user.id).first<PlaybackStateRow>();
    return c.json({ data: serializeState(state) });
  });
