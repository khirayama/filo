import { Hono } from "hono";
import { requireArticleAccess, subscriptionContextFor, subscriptionContextsForFeeds } from "../lib/articleAccess";
import { effectiveArticleState, readStateMutation, setArticleCollection } from "../lib/articleState";
import type { AppContext } from "../lib/auth";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { errors } from "../lib/errors";
import { isSupportedLanguage, normalizeSourceLanguage, parseReadableLanguages } from "../lib/languages";
import { EFFECTIVE_IS_READ } from "../lib/readCursor";
import { serializeUserState } from "../lib/serialize";
import { htmlToText, nowIso, parseId, parseLimit, previewFrom, sanitizeHtml, toIso } from "../lib/util";

function parseBoolQuery(raw: string | undefined, name: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw errors.validation(`${name} must be true or false`);
}

function parseCollectionQuery(raw: string | undefined, name: string): true | undefined {
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  throw errors.validation(`${name} must be true`);
}

interface ArticleListRow {
  id: number;
  title: string;
  translated_title: string | null;
  canonical_url: string | null;
  rss_summary: string | null;
  rss_content_html: string | null;
  published_at: string | null;
  fetched_at: string;
  source_language: string | null;
  feed_id: number;
  feed_title: string;
  feed_favicon_url: string | null;
  is_read: number | null;
  in_reading_list: number | null;
  is_bookmarked: number | null;
  title_translation_status: string | null;
}

export const articleRoutes = new Hono<AppContext>()
  .get("/lookup", async (c) => {
    const user = c.get("user");
    const url = c.req.query("url");
    if (!url) throw errors.validation("url is required");

    const article = await c.env.DB.prepare(
      `SELECT a.id, a.title, a.canonical_url, ac.source_language
       FROM articles a
       LEFT JOIN article_contents ac ON ac.article_id = a.id
       WHERE a.canonical_url = ?
       AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = ? AND s.feed_id = a.feed_id)
       LIMIT 1`
    ).bind(url, user.id).first<{ id: number; title: string; canonical_url: string; source_language: string | null }>();

    if (!article) throw errors.notFound("article_not_found", "Article not found");

    const inQueue = await c.env.DB.prepare(
      "SELECT 1 FROM playback_queue_items WHERE user_id = ? AND article_id = ?"
    ).bind(user.id, article.id).first();

    return c.json({
      data: {
        id: article.id,
        title: article.title,
        canonicalUrl: article.canonical_url,
        sourceLanguage: normalizeSourceLanguage(article.source_language),
        inQueue: !!inQueue,
      },
    });
  })
  .get("/", async (c) => {
    const user = c.get("user");
    let limit: number;
    try {
      limit = parseLimit(c.req.query("limit"));
    } catch (e) {
      throw errors.validation((e as Error).message);
    }

    const read = parseBoolQuery(c.req.query("read"), "read");
    const readingList = parseCollectionQuery(c.req.query("readingList"), "readingList");
    const bookmarked = parseCollectionQuery(c.req.query("bookmarked"), "bookmarked");
    const subscriptionIdRaw = c.req.query("subscriptionId");
    const tagIdRaw = c.req.query("tagId");

    const settings = await c.env.DB.prepare("SELECT article_sort_order, language, readable_languages FROM user_settings WHERE user_id = ?")
      .bind(user.id)
      .first<{ article_sort_order: string; language: string | null; readable_languages: string | null }>();
    const userLang = settings?.language ?? "ja";
    const readableLanguages = parseReadableLanguages(settings?.readable_languages);

    let sort = c.req.query("sort");
    if (sort !== undefined && sort !== "published_at_desc" && sort !== "fetched_at_desc") {
      throw errors.validation("invalid sort");
    }
    if (!sort) {
      sort = settings?.article_sort_order ?? "published_at_desc";
    }

    const conditions: string[] = [];
    const binds: unknown[] = [];

    let scopedToSubscription = false;
    if (subscriptionIdRaw !== undefined) {
      const subscription = await c.env.DB.prepare("SELECT feed_id FROM subscriptions WHERE id = ? AND user_id = ?")
        .bind(parseId(subscriptionIdRaw), user.id)
        .first<{ feed_id: number }>();
      if (!subscription) throw errors.notFound("subscription_not_found", "Subscription not found");
      conditions.push("a.feed_id = ?");
      binds.push(subscription.feed_id);
      scopedToSubscription = true;
    }
    if (tagIdRaw !== undefined) {
      conditions.push(
        `a.feed_id IN (
          SELECT s.feed_id FROM subscriptions s
          JOIN subscription_tags st ON st.subscription_id = s.id
          WHERE s.user_id = ? AND st.tag_id = ?
        )`
      );
      binds.push(user.id, parseId(tagIdRaw));
      scopedToSubscription = true;
    }

    // Retained articles only appear in unscoped collection lists, and never under read=false.
    const includeRetained = (readingList === true || bookmarked === true) && !scopedToSubscription && read !== false;
    if (!includeRetained) {
      conditions.push("EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = ? AND s.feed_id = a.feed_id)");
      binds.push(user.id);
    }

    // Read state combines explicit rows with the per-feed read cursor.
    if (read === true) conditions.push(`(${EFFECTIVE_IS_READ}) = 1`);
    if (read === false) conditions.push(`(${EFFECTIVE_IS_READ}) = 0`);

    const cursorRaw = c.req.query("cursor");
    if (cursorRaw !== undefined) {
      const cursor = await decodeCursor(c.env.CURSOR_SECRET, sort, cursorRaw);
      let within: string;
      const withinBinds: unknown[] = [];
      if (sort === "fetched_at_desc") {
        within = "(a.fetched_at < ? OR (a.fetched_at = ? AND a.id < ?))";
        withinBinds.push(cursor.ts, cursor.ts, cursor.id);
      } else if (cursor.ts !== null) {
        within = "(a.published_at IS NULL OR a.published_at < ? OR (a.published_at = ? AND a.id < ?))";
        withinBinds.push(cursor.ts, cursor.ts, cursor.id);
      } else {
        within = "(a.published_at IS NULL AND a.id < ?)";
        withinBinds.push(cursor.id);
      }
      // Unread (0) sorts before read (1): later pages are same-state-and-older
      // or in a later read-state group.
      conditions.push(`((${EFFECTIVE_IS_READ}) > ? OR ((${EFFECTIVE_IS_READ}) = ? AND ${within}))`);
      binds.push(cursor.r, cursor.r, ...withinBinds);
    }

    const orderBy =
      sort === "fetched_at_desc"
        ? `(${EFFECTIVE_IS_READ}) ASC, a.fetched_at DESC, a.id DESC`
        : `(${EFFECTIVE_IS_READ}) ASC, (a.published_at IS NULL) ASC, a.published_at DESC, a.id DESC`;
    const readingListJoin = readingList === true ? "JOIN" : "LEFT JOIN";
    const bookmarkJoin = bookmarked === true ? "JOIN" : "LEFT JOIN";

    const sql = `
      SELECT
        a.id, a.title, a.canonical_url, a.rss_summary, a.rss_content_html,
        a.published_at, a.fetched_at,
        ac.source_language,
        f.id AS feed_id, f.title AS feed_title, f.favicon_url AS feed_favicon_url,
        (${EFFECTIVE_IS_READ}) AS is_read,
        CASE WHEN rli.user_id IS NULL THEN 0 ELSE 1 END AS in_reading_list,
        CASE WHEN ab.user_id IS NULL THEN 0 ELSE 1 END AS is_bookmarked,
        alt.title AS translated_title,
        altp.status AS title_translation_status
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      LEFT JOIN article_contents ac ON ac.article_id = a.id
      LEFT JOIN article_read_states ars ON ars.article_id = a.id AND ars.user_id = ?
      ${readingListJoin} article_user_collections rli
        ON rli.article_id = a.id AND rli.user_id = ? AND rli.kind = 'reading_list'
      ${bookmarkJoin} article_user_collections ab
        ON ab.article_id = a.id AND ab.user_id = ? AND ab.kind = 'bookmark'
      LEFT JOIN feed_read_cursors frc ON frc.feed_id = a.feed_id AND frc.user_id = ?
      LEFT JOIN article_listing_translations alt ON alt.article_id = a.id AND alt.language = ? AND alt.status = 'ready'
      LEFT JOIN article_listing_translations altp ON altp.article_id = a.id AND altp.language = ? AND altp.status = 'pending'
      WHERE ${conditions.length > 0 ? conditions.join(" AND ") : "1 = 1"}
      ORDER BY ${orderBy}
      LIMIT ?
    `;
    const { results } = await c.env.DB.prepare(sql)
      .bind(user.id, user.id, user.id, user.id, userLang, userLang, ...binds, limit + 1)
      .all<ArticleListRow>();

    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;

    const contexts = await subscriptionContextsForFeeds(c.env.DB, user.id, page.map((row) => row.feed_id));
    const data = [];
    for (const row of page) {
      const context = contexts.get(row.feed_id) ?? { subscriptionIds: [], tagIds: [] };
      const summaryText = row.rss_summary ? htmlToText(row.rss_summary) : null;
      const contentText = row.rss_content_html ? htmlToText(row.rss_content_html) : null;
      const bestText = (summaryText && contentText)
        ? (contentText.length > summaryText.length ? contentText : summaryText)
        : (summaryText ?? contentText);
      const preview = previewFrom(bestText);
      const sourceLanguage = normalizeSourceLanguage(row.source_language);
      const needsTranslation = sourceLanguage != null
        && (!isSupportedLanguage(sourceLanguage) || !readableLanguages.includes(sourceLanguage));
      data.push({
        id: row.id,
        title: row.title,
        translatedTitle: needsTranslation ? row.translated_title : null,
        titleTranslationPending: needsTranslation && row.title_translation_status === "pending",
        sourceLanguage,
        canonicalUrl: row.canonical_url,
        rssSummary: row.rss_summary ? sanitizeHtml(row.rss_summary) : null,
        previewText: preview,
        publishedAt: toIso(row.published_at),
        fetchedAt: toIso(row.fetched_at),
        feed: { id: row.feed_id, title: row.feed_title, faviconUrl: row.feed_favicon_url },
        subscriptionContext: context,
        userState: serializeUserState(row),
      });
    }

    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]!;
      nextCursor = await encodeCursor(c.env.CURSOR_SECRET, sort, {
        ts: sort === "fetched_at_desc" ? toIso(last.fetched_at) : toIso(last.published_at),
        id: last.id,
        r: last.is_read ? 1 : 0,
      });
    }
    return c.json({ data, meta: { nextCursor } });
  })
  .post("/mark-all-read", async (c) => {
    const user = c.get("user");

    // Bulk variant of POST /subscriptions/{id}/mark-all-read: advances the
    // per-feed read cursor of every subscribed feed (or the feeds under a
    // tag) to its latest article.
    const body = await c.req.json<{ tagId?: unknown }>().catch(() => ({}) as { tagId?: unknown });
    let tagFilter = "";
    const tagBinds: unknown[] = [];
    if (body.tagId !== undefined) {
      if (typeof body.tagId !== "number" || !Number.isInteger(body.tagId) || body.tagId <= 0) {
        throw errors.validation("invalid tagId");
      }
      const tag = await c.env.DB.prepare("SELECT id FROM tags WHERE id = ? AND user_id = ?")
        .bind(body.tagId, user.id)
        .first();
      if (!tag) throw errors.notFound("tag_not_found", "Tag not found");
      tagFilter = " AND s.id IN (SELECT subscription_id FROM subscription_tags WHERE tag_id = ?)";
      tagBinds.push(body.tagId);
    }

    const now = nowIso();
    const [upsert] = await c.env.DB.batch([
      // The cursor only advances; a stale request never rewinds it.
      c.env.DB.prepare(
        `INSERT INTO feed_read_cursors (user_id, feed_id, last_read_article_id, updated_at)
         SELECT s.user_id, s.feed_id, MAX(a.id), ?
         FROM subscriptions s
         JOIN articles a ON a.feed_id = s.feed_id
         WHERE s.user_id = ?${tagFilter}
         GROUP BY s.feed_id
         ON CONFLICT (user_id, feed_id) DO UPDATE SET
           last_read_article_id = excluded.last_read_article_id, updated_at = excluded.updated_at
         WHERE excluded.last_read_article_id > feed_read_cursors.last_read_article_id`
      ).bind(now, user.id, ...tagBinds),
      // Explicit rows override the cursor, so flip the unread ones too.
      c.env.DB.prepare(
        `UPDATE article_read_states SET is_read = 1, read_at = ?, updated_at = ?
         WHERE user_id = ? AND is_read = 0
         AND article_id IN (
           SELECT a.id FROM articles a
           JOIN subscriptions s ON s.feed_id = a.feed_id
           WHERE s.user_id = ?${tagFilter}
         )`
      ).bind(now, now, user.id, user.id, ...tagBinds),
    ]);

    return c.json({ data: { updatedFeeds: upsert?.meta.changes ?? 0 } });
  })
  .get("/:articleId", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    const { article } = await requireArticleAccess(c.env.DB, user.id, articleId);

    const feed = await c.env.DB.prepare("SELECT id, title, site_url, favicon_url FROM feeds WHERE id = ?")
      .bind(article.feed_id)
      .first<{ id: number; title: string; site_url: string | null; favicon_url: string | null }>();
    const content = await c.env.DB.prepare(
      "SELECT source_language FROM article_contents WHERE article_id = ?",
    )
      .bind(articleId)
      .first<{ source_language: string | null }>();
    const context = await subscriptionContextFor(c.env.DB, user.id, article.feed_id);
    const state = await effectiveArticleState(c.env.DB, user.id, articleId, article.feed_id);

    const settings = await c.env.DB.prepare(
      "SELECT language, readable_languages FROM user_settings WHERE user_id = ?",
    )
      .bind(user.id)
      .first<{ language: string | null; readable_languages: string | null }>();
    const userLang = settings?.language ?? "ja";
    const readableLanguages = parseReadableLanguages(settings?.readable_languages);
    const sourceLanguage = normalizeSourceLanguage(content?.source_language);
    const needsTranslation = sourceLanguage != null
      && (!isSupportedLanguage(sourceLanguage) || !readableLanguages.includes(sourceLanguage));
    const listingTranslation = needsTranslation
      ? await c.env.DB.prepare(
          "SELECT title, status FROM article_listing_translations WHERE article_id = ? AND language = ?",
        )
          .bind(articleId, userLang)
          .first<{ title: string | null; status: string }>()
      : null;

    return c.json({
      data: {
        id: article.id,
        title: article.title,
        originalTitle: article.title,
        translatedTitle: listingTranslation?.status === "ready" ? listingTranslation.title : null,
        titleTranslationPending: needsTranslation && listingTranslation?.status === "pending",
        sourceLanguage,
        canonicalUrl: article.canonical_url,
        author: article.author,
        rssSummary: article.rss_summary ? sanitizeHtml(article.rss_summary) : null,
        rssContentHtml: article.rss_content_html ? sanitizeHtml(article.rss_content_html) : null,
        publishedAt: toIso(article.published_at),
        fetchedAt: toIso(article.fetched_at),
        feed: feed
          ? { id: feed.id, title: feed.title, siteUrl: feed.site_url, faviconUrl: feed.favicon_url }
          : null,
        subscriptionContext: context,
        userState: serializeUserState(state),
      },
    });
  })
  .put("/:articleId/reading-list", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    const { article } = await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, article.feed_id, "reading_list", true);
    return c.json({ data: serializeUserState(state) });
  })
  .delete("/:articleId/reading-list", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    const { article } = await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, article.feed_id, "reading_list", false);
    return c.json({ data: serializeUserState(state) });
  })
  .put("/:articleId/bookmark", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    const { article } = await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, article.feed_id, "bookmark", true);
    return c.json({ data: serializeUserState(state) });
  })
  .delete("/:articleId/bookmark", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    const { article } = await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, article.feed_id, "bookmark", false);
    return c.json({ data: serializeUserState(state) });
  })
  .patch("/:articleId/state", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    const { article } = await requireArticleAccess(c.env.DB, user.id, articleId);

    const body = await c.req
      .json<{ isRead?: unknown }>()
      .catch(() => null);
    if (!body) throw errors.validation();
    if (body.isRead === undefined) {
      throw errors.validation("isRead is required");
    }
    if (typeof body.isRead !== "boolean") throw errors.validation("invalid isRead");
    await readStateMutation(c.env.DB, user.id, articleId, body.isRead, nowIso()).run();
    return c.json({ data: serializeUserState(await effectiveArticleState(c.env.DB, user.id, articleId, article.feed_id)) });
  });
