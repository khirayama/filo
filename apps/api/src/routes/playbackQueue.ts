import { Hono } from "hono";
import { requireArticleAccess } from "../lib/articleAccess";
import type { AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { isSupportedLanguage, normalizeSourceLanguage, parseReadableLanguages } from "../lib/languages";
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
  translated_title: string | null;
}

export const playbackQueueRoutes = new Hono<AppContext>()
  .get("/", async (c) => {
    const user = c.get("user");

    const settings = await c.env.DB.prepare("SELECT language, readable_languages FROM user_settings WHERE user_id = ?")
      .bind(user.id)
      .first<{ language: string; readable_languages: string | null }>();
    const readableLanguages = parseReadableLanguages(settings?.readable_languages);
    const targetLang = settings?.language ?? "ja";

    const { results: items } = await c.env.DB.prepare(
      `SELECT
        pqi.article_id, pqi.sort_order, pqi.created_at,
        a.title, a.canonical_url, ac.source_language, a.published_at,
        f.id AS feed_id, f.title AS feed_title, f.favicon_url AS feed_favicon_url,
        alt.title AS translated_title
      FROM playback_queue_items pqi
      JOIN articles a ON a.id = pqi.article_id
      JOIN feeds f ON f.id = a.feed_id
      LEFT JOIN article_contents ac ON ac.article_id = a.id
      LEFT JOIN article_listing_translations alt ON alt.article_id = a.id AND alt.language = ? AND alt.status = 'ready'
      WHERE pqi.user_id = ?
      ORDER BY pqi.sort_order ASC, pqi.article_id ASC`
    )
      .bind(targetLang, user.id)
      .all<QueueItemRow>();

    const state = await c.env.DB.prepare(
      "SELECT current_article_id, content_language, position_percent, updated_at FROM playback_states WHERE user_id = ?"
    )
      .bind(user.id)
      .first<{ current_article_id: number | null; content_language: string | null; position_percent: number; updated_at: string }>();

    return c.json({
      data: {
        items: items.map((row) => {
          const sourceLanguage = normalizeSourceLanguage(row.source_language);
          const needsTranslation = sourceLanguage != null
            && (!isSupportedLanguage(sourceLanguage) || !readableLanguages.includes(sourceLanguage));
          return {
            articleId: row.article_id,
            sortOrder: row.sort_order,
            article: {
              id: row.article_id,
              title: (needsTranslation && row.translated_title) ? row.translated_title : row.title,
              originalTitle: row.title,
              sourceLanguage,
              canonicalUrl: row.canonical_url,
              publishedAt: toIso(row.published_at),
              feed: { id: row.feed_id, title: row.feed_title, faviconUrl: row.feed_favicon_url },
            },
            createdAt: toIso(row.created_at),
          };
        }),
        playbackState: state
          ? {
              currentArticleId: state.current_article_id,
              contentLanguage: state.content_language,
              positionPercent: state.position_percent,
              updatedAt: toIso(state.updated_at),
            }
          : null,
      },
    });
  })
  .post("/items", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ articleIds?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.articleIds) || body.articleIds.length === 0) {
      throw errors.validation("articleIds must be a non-empty array");
    }
    if (body.articleIds.length > 100) throw errors.validation("too many articleIds (max 100)");
    const articleIds: number[] = [];
    for (const raw of body.articleIds) {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
        throw errors.validation("each articleId must be a positive integer");
      }
      articleIds.push(raw);
    }

    // Only articles the user can read (subscribed or retained) may be queued.
    for (const articleId of articleIds) {
      await requireArticleAccess(c.env.DB, user.id, articleId);
    }

    const maxRow = await c.env.DB.prepare(
      "SELECT MAX(sort_order) AS max_sort FROM playback_queue_items WHERE user_id = ?"
    )
      .bind(user.id)
      .first<{ max_sort: number | null }>();
    let nextSort = (maxRow?.max_sort ?? -1) + 1;

    const now = nowIso();
    for (const articleId of articleIds) {
      await c.env.DB.prepare(
        `INSERT INTO playback_queue_items (user_id, article_id, sort_order, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, article_id) DO NOTHING`
      )
        .bind(user.id, articleId, nextSort, now)
        .run();
      nextSort++;
    }

    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM playback_queue_items WHERE user_id = ?"
    ).bind(user.id).first<{ cnt: number }>();

    return c.json({ data: { itemCount: count?.cnt ?? 0 } }, 200);
  })
  .delete("/items/:articleId", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));

    await c.env.DB.prepare(
      "DELETE FROM playback_queue_items WHERE user_id = ? AND article_id = ?"
    ).bind(user.id, articleId).run();

    const state = await c.env.DB.prepare(
      "SELECT current_article_id FROM playback_states WHERE user_id = ?"
    ).bind(user.id).first<{ current_article_id: number | null }>();
    if (state?.current_article_id === articleId) {
      await c.env.DB.prepare(
        "UPDATE playback_states SET current_article_id = NULL, position_percent = 0, content_language = NULL, updated_at = ? WHERE user_id = ?"
      ).bind(nowIso(), user.id).run();
    }

    return c.json({ data: { success: true } });
  })
  .put("/order", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ articleIds?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.articleIds)) {
      throw errors.validation("articleIds must be an array");
    }
    const articleIds: number[] = [];
    for (const raw of body.articleIds) {
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
        throw errors.validation("each articleId must be a positive integer");
      }
      articleIds.push(raw);
    }

    const { results: existing } = await c.env.DB.prepare(
      "SELECT article_id FROM playback_queue_items WHERE user_id = ?"
    ).bind(user.id).all<{ article_id: number }>();
    const existingIds = new Set(existing.map((r) => r.article_id));
    for (const id of articleIds) {
      if (!existingIds.has(id)) throw errors.validation(`articleId ${id} is not in queue`);
    }
    if (articleIds.length !== existingIds.size) {
      throw errors.validation("articleIds must include all items in the queue");
    }

    for (let i = 0; i < articleIds.length; i++) {
      await c.env.DB.prepare(
        "UPDATE playback_queue_items SET sort_order = ? WHERE user_id = ? AND article_id = ?"
      ).bind(i, user.id, articleIds[i]).run();
    }

    return c.json({ data: { success: true } });
  })
  .delete("/", async (c) => {
    const user = c.get("user");
    await c.env.DB.prepare("DELETE FROM playback_queue_items WHERE user_id = ?").bind(user.id).run();
    await c.env.DB.prepare("DELETE FROM playback_states WHERE user_id = ?").bind(user.id).run();
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

    const now = nowIso();
    const sets: string[] = [];
    const binds: unknown[] = [];

    if (body.currentArticleId !== undefined) {
      if (body.currentArticleId !== null && (typeof body.currentArticleId !== "number" || !Number.isInteger(body.currentArticleId))) {
        throw errors.validation("invalid currentArticleId");
      }
      if (body.currentArticleId !== null) {
        const inQueue = await c.env.DB.prepare(
          "SELECT 1 FROM playback_queue_items WHERE user_id = ? AND article_id = ?"
        ).bind(user.id, body.currentArticleId).first();
        if (!inQueue) throw errors.validation("article is not in queue");
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

    sets.push("updated_at = ?");
    binds.push(now);

    await c.env.DB.prepare(
      `INSERT INTO playback_states (user_id, updated_at) VALUES (?, ?)
       ON CONFLICT (user_id) DO NOTHING`
    ).bind(user.id, now).run();

    binds.push(user.id);
    await c.env.DB.prepare(
      `UPDATE playback_states SET ${sets.join(", ")} WHERE user_id = ?`
    ).bind(...binds).run();

    const state = await c.env.DB.prepare(
      "SELECT current_article_id, content_language, position_percent, updated_at FROM playback_states WHERE user_id = ?"
    ).bind(user.id).first<{ current_article_id: number | null; content_language: string | null; position_percent: number; updated_at: string }>();

    return c.json({
      data: {
        currentArticleId: state?.current_article_id ?? null,
        contentLanguage: state?.content_language ?? null,
        positionPercent: state?.position_percent ?? 0,
        updatedAt: toIso(state?.updated_at ?? null),
      },
    });
  });
