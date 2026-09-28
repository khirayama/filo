import { Hono } from "hono";
import { requireArticleAccess, subscriptionContextsForFeeds } from "../lib/articleAccess";
import { enqueueArticleContent } from "../lib/articleContentJobs";
import { setArticleCollection, setArticleReadState } from "../lib/articleState";
import type { AppContext } from "../lib/auth";
import { decodeCursor, encodeCursor, type ArticleCursor } from "../lib/cursor";
import { errors } from "../lib/errors";
import { normalizeSourceLanguage } from "../lib/languages";
import { canonicalizeUrl } from "../lib/net";
import {
  EFFECTIVE_IS_READ,
  recountReadingListUnreadMutation,
  unreadCountsForUser,
  type UnreadCountScope,
} from "../lib/readCursor";
import { serializeUserState } from "../lib/serialize";
import { recordD1Meta } from "../lib/observability";
import { htmlToText, nowIso, parseId, parseLimit, previewFrom, toIso } from "../lib/util";

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

// 0 = unread, 1 = read.
type ReadGroup = 0 | 1;
type CollectionJoin = "JOIN" | "LEFT JOIN";

// What one article list request selects, independent of read state and page.
interface ArticleListScope {
  userId: number;
  sort: string;
  // Extra predicates on `a` (subscription / tag scope) and their binds.
  conditions: string[];
  binds: unknown[];
  readingListJoin: CollectionJoin;
  bookmarkJoin: CollectionJoin;
  // Regular lists only show subscribed feeds. Scoped lists are already
  // limited to subscribed feeds, and unscoped collection lists also show
  // retained articles, so both skip this filter.
  subscribedOnly: boolean;
}

function readGroupCondition(group: ReadGroup): string {
  return group === 0
    ? "(ars.is_read = 0 OR (ars.user_id IS NULL AND COALESCE(frc.last_read_article_id, 0) < a.id))"
    : "(ars.is_read = 1 OR (ars.user_id IS NULL AND frc.last_read_article_id >= a.id))";
}

function articleDateOrder(sort: string): string {
  return sort === "fetched_at_desc"
    ? "a.fetched_at DESC, a.id DESC"
    // SQLite sorts NULLs last for DESC, so this preserves the previous
    // published_at ordering while allowing idx_articles_published_id to
    // provide the order without a temporary sort.
    : "a.published_at DESC, a.id DESC";
}

function articleWithinCursor(sort: string, cursor: ArticleCursor, alias = "a"): { sql: string; binds: unknown[] } {
  if (sort === "fetched_at_desc") {
    return {
      sql: `(${alias}.fetched_at < ? OR (${alias}.fetched_at = ? AND ${alias}.id < ?))`,
      binds: [cursor.ts, cursor.ts, cursor.id],
    };
  }
  if (cursor.ts !== null) {
    return {
      sql: `(${alias}.published_at IS NULL OR ${alias}.published_at < ? OR (${alias}.published_at = ? AND ${alias}.id < ?))`,
      binds: [cursor.ts, cursor.ts, cursor.id],
    };
  }
  return { sql: `(${alias}.published_at IS NULL AND ${alias}.id < ?)`, binds: [cursor.id] };
}

const ARTICLE_LIST_COLUMNS = `
  a.id, a.title, a.canonical_url, a.rss_summary, a.rss_content_html,
  a.published_at, a.fetched_at, a.source_language,
  f.id AS feed_id, f.title AS feed_title, f.favicon_url AS feed_favicon_url,
  (${EFFECTIVE_IS_READ}) AS is_read,
  CASE WHEN rli.user_id IS NULL THEN 0 ELSE 1 END AS in_reading_list,
  CASE WHEN ab.user_id IS NULL THEN 0 ELSE 1 END AS is_bookmarked`;

// The general list query: walks the article-order index and evaluates the
// scope and read state per row until LIMIT. The subscription filter is a
// correlated EXISTS so SQLite can stop at LIMIT instead of joining every
// subscribed feed and sorting all its articles.
function articleListSelect(
  scope: ArticleListScope,
  group: ReadGroup | null,
  cursor: ArticleCursor | undefined,
  limit: number,
): { sql: string; binds: unknown[] } {
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (scope.subscribedOnly) {
    conditions.push("EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = a.feed_id AND s.user_id = ?)");
    binds.push(scope.userId);
  }
  conditions.push(...scope.conditions);
  binds.push(...scope.binds);
  if (group !== null) conditions.push(readGroupCondition(group));
  if (cursor) {
    const within = articleWithinCursor(scope.sort, cursor);
    conditions.push(within.sql);
    binds.push(...within.binds);
  }
  const sql = `
    SELECT ${ARTICLE_LIST_COLUMNS}
    FROM articles a
    JOIN feeds f ON f.id = a.feed_id
    LEFT JOIN article_read_states ars ON ars.article_id = a.id AND ars.user_id = ?
    ${scope.readingListJoin} article_user_collections rli
      ON rli.article_id = a.id AND rli.user_id = ? AND rli.kind = 'reading_list'
    ${scope.bookmarkJoin} article_user_collections ab
      ON ab.article_id = a.id AND ab.user_id = ? AND ab.kind = 'bookmark'
    LEFT JOIN feed_read_cursors frc ON frc.feed_id = a.feed_id AND frc.user_id = ?
    WHERE ${conditions.length > 0 ? conditions.join(" AND ") : "1 = 1"}
    ORDER BY ${articleDateOrder(scope.sort)}
    LIMIT ?
  `;
  const { userId } = scope;
  return { sql, binds: [userId, userId, userId, userId, ...binds, limit] };
}

// The unread group of the plain subscribed list, derived from the two sources
// that can make an article unread instead of walking the global order:
//   1. articles after the user's per-feed read cursor (or all articles of a
//      feed without a cursor), without an explicit override, and
//   2. sparse explicit unread overrides.
// The branches are disjoint, so UNION ALL cannot duplicate an article. Each
// is driven by the feed/id range index or the sparse state index.
export function unreadArticleListSelect(
  userId: number,
  sort: string,
  cursor: ArticleCursor | undefined,
  limit: number,
): { sql: string; binds: unknown[] } {
  const within = cursor ? articleWithinCursor(sort, cursor) : undefined;
  const cursorCondition = within ? `AND ${within.sql}` : "";
  const cursorBinds = within?.binds ?? [];
  const sql = `
    WITH unread_candidate_ids AS (
      SELECT a.id
      FROM subscriptions s
      JOIN feed_read_cursors frc
        ON frc.user_id = ? AND frc.feed_id = s.feed_id
      JOIN articles a
        ON a.feed_id = frc.feed_id AND a.id > frc.last_read_article_id
      WHERE s.user_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM article_read_states ars0
          WHERE ars0.user_id = ? AND ars0.article_id = a.id
        )
        ${cursorCondition}

      UNION ALL

      SELECT a.id
      FROM subscriptions s
      JOIN articles a ON a.feed_id = s.feed_id
      WHERE s.user_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM feed_read_cursors frc0
          WHERE frc0.user_id = ? AND frc0.feed_id = s.feed_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM article_read_states ars0
          WHERE ars0.user_id = ? AND ars0.article_id = a.id
        )
        ${cursorCondition}

      UNION ALL

      SELECT a.id
      FROM article_read_states ars
      JOIN articles a ON a.id = ars.article_id
      JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = ?
      WHERE ars.user_id = ?
        AND ars.is_read = 0
        ${cursorCondition}
    )
    SELECT ${ARTICLE_LIST_COLUMNS}
    FROM unread_candidate_ids c
    JOIN articles a ON a.id = c.id
    JOIN feeds f ON f.id = a.feed_id
    LEFT JOIN article_read_states ars ON ars.article_id = a.id AND ars.user_id = ?
    LEFT JOIN article_user_collections rli
      ON rli.article_id = a.id AND rli.user_id = ? AND rli.kind = 'reading_list'
    LEFT JOIN article_user_collections ab
      ON ab.article_id = a.id AND ab.user_id = ? AND ab.kind = 'bookmark'
    LEFT JOIN feed_read_cursors frc ON frc.feed_id = a.feed_id AND frc.user_id = ?
    ORDER BY ${articleDateOrder(sort)}
    LIMIT ?
  `;
  return {
    sql,
    binds: [
      userId, userId, userId, ...cursorBinds,
      userId, userId, userId, ...cursorBinds,
      userId, userId, ...cursorBinds,
      userId, userId, userId, userId,
      limit,
    ],
  };
}

export interface UnreadQueryStats {
  unreadCount: number;
  subscribedArticleCount: number;
  totalArticleCount: number;
}

export type UnreadQueryStrategy = "candidate" | "global";

// Both unread queries return the same rows; this only picks the cheaper
// shape. The candidate query is bounded by the user's unread backlog, while
// the global query walks the shared article order until it finds enough
// unread rows. Prefer the latter only when the user's subscriptions cover a
// meaningful part of the shared corpus and the unread backlog is large
// enough to make a candidate scan expensive.
export function chooseUnreadQueryStrategy(
  stats: UnreadQueryStats,
  limit: number,
): UnreadQueryStrategy {
  if (stats.unreadCount <= 0) return "candidate";
  if (stats.subscribedArticleCount <= 0) return "candidate";
  if (stats.totalArticleCount <= 0) return "candidate";

  const coverage = stats.subscribedArticleCount / stats.totalArticleCount;
  if (coverage < 0.25) return "candidate";

  const estimatedGlobalRows = Math.ceil(
    (stats.totalArticleCount * (limit + 1)) / stats.unreadCount,
  );
  return estimatedGlobalRows < stats.subscribedArticleCount ? "global" : "candidate";
}

// All three sizes are planning estimates from the derived counters; they
// never change which rows are returned. Articles are not deleted, so the
// largest id stands in for the corpus size with a single-row read.
async function unreadQueryStrategy(db: D1Database, userId: number, limit: number): Promise<UnreadQueryStrategy> {
  const row = await db.prepare(
    `SELECT
       (SELECT COALESCE(SUM(unread_count), 0)
        FROM subscription_unread_counts WHERE user_id = ?) AS unread_count,
       (SELECT COALESCE(SUM(f.article_count), 0)
        FROM feeds f
        JOIN subscriptions s ON s.feed_id = f.id
        WHERE s.user_id = ?) AS subscribed_article_count,
       (SELECT COALESCE(MAX(id), 0) FROM articles) AS total_article_count`,
  ).bind(userId, userId).first<{
    unread_count: number;
    subscribed_article_count: number;
    total_article_count: number;
  }>();
  return chooseUnreadQueryStrategy({
    unreadCount: Number(row?.unread_count ?? 0),
    subscribedArticleCount: Number(row?.subscribed_article_count ?? 0),
    totalArticleCount: Number(row?.total_article_count ?? 0),
  }, limit);
}

// Loads one read-state group (or both, for `null`) of the list. Only the
// unread group of the plain subscribed list has the specialised candidate
// query; everything else uses the general query.
async function articleGroupRows(
  db: D1Database,
  scope: ArticleListScope,
  group: ReadGroup | null,
  cursor: ArticleCursor | undefined,
  limit: number,
  strategy: () => Promise<UnreadQueryStrategy>,
): Promise<ArticleListRow[]> {
  const isPlainSubscribedList = scope.subscribedOnly
    && scope.conditions.length === 0
    && scope.readingListJoin === "LEFT JOIN"
    && scope.bookmarkJoin === "LEFT JOIN";
  const query = group === 0 && isPlainSubscribedList && await strategy() === "candidate"
    ? unreadArticleListSelect(scope.userId, scope.sort, cursor, limit)
    : articleListSelect(scope, group, cursor, limit);
  const result = await db.prepare(query.sql).bind(...query.binds).all<ArticleListRow>();
  recordD1Meta("articles.list", result.meta, { returned: result.results.length, group: group ?? "all" });
  return result.results;
}

// Pages through one group and then the other, so each page runs at most two
// group queries instead of ordering the whole list by read state.
async function splitArticleRows(
  db: D1Database,
  scope: ArticleListScope,
  readOrder: "unread_first" | "read_first",
  cursor: ArticleCursor | undefined,
  limit: number,
  strategy: () => Promise<UnreadQueryStrategy>,
): Promise<{ page: ArticleListRow[]; hasMore: boolean }> {
  const firstGroup: ReadGroup = readOrder === "read_first" ? 1 : 0;
  const secondGroup: ReadGroup = firstGroup === 0 ? 1 : 0;

  // Once a cursor is in the second group, the first group is exhausted and
  // must not be queried again.
  if (cursor && cursor.r === secondGroup) {
    const rows = await articleGroupRows(db, scope, secondGroup, cursor, limit + 1, strategy);
    return { page: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  const firstRows = await articleGroupRows(db, scope, firstGroup, cursor, limit + 1, strategy);
  if (firstRows.length > limit) return { page: firstRows.slice(0, limit), hasMore: true };

  // A full first group still needs one probe row from the second group to
  // avoid incorrectly reporting the end of pagination at the boundary.
  const remaining = limit - firstRows.length;
  const secondRows = await articleGroupRows(db, scope, secondGroup, undefined, remaining + 1, strategy);
  return {
    page: [...firstRows, ...secondRows.slice(0, remaining)],
    hasMore: secondRows.length > remaining,
  };
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

  // A saved page is a paused source rather than a subscription. This keeps it
  // in the article/content pipeline without making it appear in feed
  // subscription management or feed refresh jobs.
  await db.prepare(
    `INSERT INTO feeds (feed_url, site_url, title, status, created_at, updated_at)
     VALUES (?, ?, ?, 'paused', ?, ?)
     ON CONFLICT (feed_url) DO NOTHING`,
  ).bind(input.url, input.url, title, now, now).run();
  const feed = await db.prepare("SELECT id FROM feeds WHERE feed_url = ?").bind(input.url).first<{ id: number }>();
  if (!feed) throw errors.internal();

  // The article insert trigger counts a new article for the feed.
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
  if (membership === null) await setArticleCollection(db, userId, article.id, "reading_list", true);

  return {
    articleId: article.id,
    title: article.title,
    url: article.canonical_url ?? input.url,
    created: membership === null,
  };
}

export const articleRoutes = new Hono<AppContext>()
  .get("/unread-counts", async (c) => {
    const user = c.get("user");
    const scope = c.req.query("scope") ?? "both";
    if (scope !== "all" && scope !== "reading_list" && scope !== "both") {
      throw errors.validation("invalid unread count scope");
    }
    const counts = await unreadCountsForUser(c.env.DB, user.id, scope as UnreadCountScope);
    return c.json({
      data: {
        allArticles: counts.all_articles,
        readingList: counts.reading_list,
      },
    });
  })
  .get("/", async (c) => {
    const cursorSecret = c.env.CURSOR_SIGNING_KEY ?? c.env.CURSOR_SECRET;
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

    let sort = c.req.query("sort");
    if (sort !== undefined && sort !== "published_at_desc" && sort !== "fetched_at_desc") {
      throw errors.validation("invalid sort");
    }
    if (!sort) {
      const settings = await c.env.DB.prepare("SELECT article_sort_order FROM user_settings WHERE user_id = ?")
        .bind(user.id)
        .first<{ article_sort_order: string }>();
      sort = settings?.article_sort_order ?? "published_at_desc";
    }
    const readOrder = c.req.query("readOrder") ?? "unread_first";
    if (readOrder !== "unread_first" && readOrder !== "read_first" && readOrder !== "none") {
      throw errors.validation("invalid readOrder");
    }

    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (subscriptionIdRaw !== undefined) {
      const subscription = await c.env.DB.prepare("SELECT feed_id FROM subscriptions WHERE id = ? AND user_id = ?")
        .bind(parseId(subscriptionIdRaw), user.id)
        .first<{ feed_id: number }>();
      if (!subscription) throw errors.notFound("subscription_not_found", "Subscription not found");
      conditions.push("a.feed_id = ?");
      binds.push(subscription.feed_id);
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
    }
    const scopedToSubscription = conditions.length > 0;

    // Retained articles only appear in unscoped collection lists, and never under read=false.
    const includeRetained = (readingList === true || bookmarked === true) && !scopedToSubscription && read !== false;
    const scope: ArticleListScope = {
      userId: user.id,
      sort,
      conditions,
      binds,
      readingListJoin: readingList === true ? "JOIN" : "LEFT JOIN",
      bookmarkJoin: bookmarked === true ? "JOIN" : "LEFT JOIN",
      subscribedOnly: !includeRetained && !scopedToSubscription,
    };

    const cursorRaw = c.req.query("cursor");
    const cursor = cursorRaw === undefined
      ? undefined
      : await decodeCursor(cursorSecret, sort, cursorRaw, readOrder);

    // Decided at most once per request, and only if an unread group is read.
    let strategyPromise: Promise<UnreadQueryStrategy> | undefined;
    const strategy = () => (strategyPromise ??= unreadQueryStrategy(c.env.DB, user.id, limit));

    let page: ArticleListRow[];
    let hasMore: boolean;
    if (read === undefined && readOrder !== "none") {
      ({ page, hasMore } = await splitArticleRows(c.env.DB, scope, readOrder, cursor, limit, strategy));
    } else {
      // A read filter selects one group; readOrder=none mixes both by date.
      const group: ReadGroup | null = read === undefined ? null : read ? 1 : 0;
      const rows = await articleGroupRows(c.env.DB, scope, group, cursor, limit + 1, strategy);
      page = rows.slice(0, limit);
      hasMore = rows.length > limit;
    }

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
      nextCursor = await encodeCursor(cursorSecret, sort, {
        ts: sort === "fetched_at_desc" ? toIso(last.fetched_at) : toIso(last.published_at),
        id: last.id,
        r: last.is_read ? 1 : 0,
      }, readOrder);
    }
    return c.json({ data, meta: { nextCursor } });
  })
  .post("/import", async (c) => {
    const user = c.get("user");
    const input = parseSavedArticleInput(await c.req.json().catch(() => null));
    const saved = await saveArticleFromUrl(c.env.DB, user.id, input);

    // Content extraction is best effort. The browser/reader can still use the
    // live page when the remote server blocks this worker.
    await enqueueArticleContent(c.env.DB, c.env.JOBS, saved.articleId);
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
         SELECT
           s.user_id,
           s.feed_id,
           (SELECT a.id
            FROM articles a
            WHERE a.feed_id = s.feed_id
            ORDER BY a.id DESC
            LIMIT 1),
           ?
         FROM subscriptions s
         WHERE s.user_id = ?${tagFilter}
           AND (SELECT a.id
                FROM articles a
                WHERE a.feed_id = s.feed_id
                ORDER BY a.id DESC
                LIMIT 1) IS NOT NULL
         ON CONFLICT (user_id, feed_id) DO UPDATE SET
           last_read_article_id = excluded.last_read_article_id, updated_at = excluded.updated_at
         WHERE excluded.last_read_article_id > feed_read_cursors.last_read_article_id`
      ).bind(now, user.id, ...tagBinds),
      // Explicit rows override the cursor, so flip the unread ones too.
      c.env.DB.prepare(
        `UPDATE article_read_states AS ars SET is_read = 1, read_at = ?, updated_at = ?
         WHERE ars.user_id = ? AND ars.is_read = 0
           AND EXISTS (
             SELECT 1
             FROM articles a
             JOIN subscriptions s ON s.feed_id = a.feed_id
             WHERE a.id = ars.article_id
               AND s.user_id = ?${tagFilter}
           )`
      ).bind(now, now, user.id, user.id, ...tagBinds),
      // The cursor and explicit-state update above make every current article
      // in the selected subscriptions read. Reset the derived counters in
      // the same batch instead of rescanning each feed independently.
      c.env.DB.prepare(
        `UPDATE subscription_unread_counts
         SET unread_count = 0, updated_at = ?
         WHERE user_id = ?
           AND subscription_id IN (
             SELECT s.id FROM subscriptions s
             WHERE s.user_id = ?${tagFilter}
           )`,
      ).bind(now, user.id, user.id, ...tagBinds),
      recountReadingListUnreadMutation(c.env.DB, user.id, now),
    ]);

    return c.json({ data: { updatedFeeds: upsert?.meta.changes ?? 0 } });
  })
  .delete("/reading-list/read", async (c) => {
    const user = c.get("user");
    // Start from the user's reading list; the shared article table is only
    // probed by primary key for those entries.
    const result = await c.env.DB.prepare(
      `DELETE FROM article_user_collections
       WHERE user_id = ? AND kind = 'reading_list'
       AND article_id IN (
         SELECT rli.article_id
         FROM article_user_collections rli
         JOIN articles a ON a.id = rli.article_id
         LEFT JOIN article_read_states ars ON ars.user_id = rli.user_id AND ars.article_id = a.id
         LEFT JOIN feed_read_cursors frc ON frc.user_id = rli.user_id AND frc.feed_id = a.feed_id
         WHERE rli.user_id = ? AND rli.kind = 'reading_list'
           AND (${EFFECTIVE_IS_READ}) = 1
       )`,
    ).bind(user.id, user.id).run();
    return c.json({ data: { removedCount: result.meta.changes ?? 0 } });
  })
  .put("/:articleId/reading-list", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, "reading_list", true);
    return c.json({ data: serializeUserState(state) });
  })
  .delete("/:articleId/reading-list", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, "reading_list", false);
    return c.json({ data: serializeUserState(state) });
  })
  .put("/:articleId/bookmark", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, "bookmark", true);
    return c.json({ data: serializeUserState(state) });
  })
  .delete("/:articleId/bookmark", async (c) => {
    const user = c.get("user");
    const articleId = parseId(c.req.param("articleId"));
    await requireArticleAccess(c.env.DB, user.id, articleId);
    const state = await setArticleCollection(c.env.DB, user.id, articleId, "bookmark", false);
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
    return c.json({
      data: serializeUserState(await setArticleReadState(c.env.DB, user.id, articleId, article.feed_id, body.isRead)),
    });
  });
