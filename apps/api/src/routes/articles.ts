import { Hono } from "hono";
import { requireArticleAccess, subscriptionContextsForFeeds } from "../lib/articleAccess";
import { effectiveArticleState, readStateMutation, setArticleCollection } from "../lib/articleState";
import type { AppContext } from "../lib/auth";
import { decodeCursor, encodeCursor } from "../lib/cursor";
import { errors } from "../lib/errors";
import { normalizeSourceLanguage } from "../lib/languages";
import { canonicalizeUrl } from "../lib/net";
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
}

function fallbackSavedArticleTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function parseSavedArticleInput(body: unknown): { url: string; title?: string; summary?: string } {
  if (!body || typeof body !== "object") throw errors.validation();
  const input = body as { url?: unknown; title?: unknown; summary?: unknown };
  if (typeof input.url !== "string" || input.url.trim().length === 0) {
    throw errors.validation("url is required");
  }
  let url: string;
  try {
    const parsed = new URL(input.url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
    url = canonicalizeUrl(input.url.trim());
  } catch {
    throw errors.validation("url must be a valid http(s) URL");
  }
  if (typeof input.title !== "undefined" && typeof input.title !== "string") {
    throw errors.validation("title must be a string");
  }
  if (typeof input.summary !== "undefined" && typeof input.summary !== "string") {
    throw errors.validation("summary must be a string");
  }
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 500) : undefined;
  const summary = typeof input.summary === "string" ? input.summary.trim().slice(0, 10_000) : undefined;
  return { url, title: title || undefined, summary: summary || undefined };
}

async function saveArticleFromUrl(
  db: D1Database,
  userId: number,
  input: { url: string; title?: string; summary?: string },
): Promise<{ articleId: number; title: string; url: string; created: boolean }> {
  const now = nowIso();
  const title = input.title ?? fallbackSavedArticleTitle(input.url);

  // A saved page is a paused source rather than a subscription. This keeps
  // the existing article/list/playback schema usable without making it appear
  // in feed subscription management or feed refresh jobs.
  await db.prepare(
    `INSERT INTO feeds (feed_url, site_url, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'paused', ?, ?)
     ON CONFLICT (feed_url) DO NOTHING`,
  ).bind(input.url, input.url, title, now, now).run();
  const feed = await db.prepare("SELECT id FROM feeds WHERE feed_url = ?").bind(input.url).first<{ id: number }>();
  if (!feed) throw errors.internal();

  await db.prepare(
    `INSERT INTO articles (feed_id, guid, canonical_url, dedupe_key, title, rss_summary, fetched_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (feed_id, dedupe_key) DO NOTHING`,
  ).bind(feed.id, input.url, input.url, input.url, title, input.summary ?? null, now, now, now).run();
  const article = await db.prepare(
    "SELECT id, title, canonical_url FROM articles WHERE feed_id = ? AND dedupe_key = ?",
  ).bind(feed.id, input.url).first<{ id: number; title: string; canonical_url: string | null }>();
  if (!article) throw errors.internal();

  const membership = await db.prepare(
    `SELECT 1 FROM article_user_collections
     WHERE user_id = ? AND article_id = ? AND kind = 'reading_list'`,
  ).bind(userId, article.id).first();
  await db.prepare(
    `INSERT INTO article_user_collections (user_id, article_id, kind, added_at, updated_at)
     VALUES (?, ?, 'reading_list', ?, ?)
     ON CONFLICT (user_id, article_id, kind) DO UPDATE SET updated_at = excluded.updated_at`,
  ).bind(userId, article.id, now, now).run();

  const content = await db.prepare("SELECT status FROM article_contents WHERE article_id = ?").bind(article.id).first<{ status: string }>();
  if (!content || content.status === "error") {
    await db.prepare(
      `INSERT INTO article_contents (article_id, status, created_at, updated_at)
       VALUES (?, 'pending', ?, ?)
       ON CONFLICT (article_id) DO UPDATE SET status = 'pending', error_message = NULL, updated_at = excluded.updated_at`,
    ).bind(article.id, now, now).run();
  }

  return {
    articleId: article.id,
    title: article.title,
    url: article.canonical_url ?? input.url,
    created: membership === null,
  };
}

export const articleRoutes = new Hono<AppContext>()
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

    const settings = await c.env.DB.prepare("SELECT article_sort_order FROM user_settings WHERE user_id = ?")
      .bind(user.id)
      .first<{ article_sort_order: string }>();

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
        a.published_at, a.fetched_at, a.source_language,
        f.id AS feed_id, f.title AS feed_title, f.favicon_url AS feed_favicon_url,
        (${EFFECTIVE_IS_READ}) AS is_read,
        CASE WHEN rli.user_id IS NULL THEN 0 ELSE 1 END AS in_reading_list,
        CASE WHEN ab.user_id IS NULL THEN 0 ELSE 1 END AS is_bookmarked
      FROM articles a
      JOIN feeds f ON f.id = a.feed_id
      LEFT JOIN article_read_states ars ON ars.article_id = a.id AND ars.user_id = ?
      ${readingListJoin} article_user_collections rli
        ON rli.article_id = a.id AND rli.user_id = ? AND rli.kind = 'reading_list'
      ${bookmarkJoin} article_user_collections ab
        ON ab.article_id = a.id AND ab.user_id = ? AND ab.kind = 'bookmark'
      LEFT JOIN feed_read_cursors frc ON frc.feed_id = a.feed_id AND frc.user_id = ?
      WHERE ${conditions.length > 0 ? conditions.join(" AND ") : "1 = 1"}
      ORDER BY ${orderBy}
      LIMIT ?
    `;
    const { results } = await c.env.DB.prepare(sql)
      .bind(user.id, user.id, user.id, user.id, ...binds, limit + 1)
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
      data.push({
        id: row.id,
        title: row.title,
        sourceLanguage: normalizeSourceLanguage(row.source_language),
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
  .post("/import", async (c) => {
    const user = c.get("user");
    const input = parseSavedArticleInput(await c.req.json().catch(() => null));
    const saved = await saveArticleFromUrl(c.env.DB, user.id, input);

    // Content extraction is best effort. The browser/reader can still use the
    // live page when the remote server blocks this worker.
    const articleContent = await c.env.DB.prepare(
      "SELECT status FROM article_contents WHERE article_id = ?",
    ).bind(saved.articleId).first<{ status: string }>();
    if (articleContent?.status === "pending") {
      await c.env.JOBS.send({ jobType: "extract_content", articleId: saved.articleId });
    }
    return c.json({ data: saved }, saved.created ? 201 : 200);
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
