import { Hono } from "hono";
import type { AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { nowIso, parseId, parseLimit, toIso } from "../lib/util";

interface AdminFeedRow {
  id: number;
  feed_url: string;
  site_url: string | null;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  consecutive_failures: number | null;
  next_fetch_after: string | null;
  last_result: string | null;
  last_error: string | null;
  last_success_fetched_at: string | null;
  http_etag: string | null;
  http_last_modified: string | null;
}

const ADMIN_FEED_SELECT = `
  SELECT f.id, f.feed_url, f.site_url, f.title, f.status, f.created_at, f.updated_at,
         fs.consecutive_failures, fs.next_fetch_after, fs.last_result, fs.last_error,
         fs.last_success_fetched_at, fs.http_etag, fs.http_last_modified
  FROM feeds f
  LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id
`;

function serializeFeed(row: AdminFeedRow, detailed = false) {
  const base = {
    id: row.id,
    feedUrl: row.feed_url,
    siteUrl: row.site_url,
    title: row.title,
    status: row.status,
    consecutiveFailures: row.consecutive_failures ?? 0,
    nextFetchAfter: toIso(row.next_fetch_after),
    lastResult: row.last_result,
    lastError: row.last_error,
    lastSuccessFetchedAt: toIso(row.last_success_fetched_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  if (!detailed) return base;
  return { ...base, httpEtag: row.http_etag, httpLastModified: row.http_last_modified };
}

export const adminRoutes = new Hono<AppContext>()
  .get("/feeds", async (c) => {
    let limit: number;
    try {
      limit = parseLimit(c.req.query("limit"));
    } catch (e) {
      throw errors.validation((e as Error).message);
    }
    const status = c.req.query("status");
    const result = c.req.query("result");
    const offsetRaw = c.req.query("cursor");
    const offset = offsetRaw ? (/^\d+$/.test(offsetRaw) ? Number(offsetRaw) : null) : 0;
    if (offset === null) throw errors.invalidCursor();

    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (status !== undefined) {
      if (!["active", "paused"].includes(status)) throw errors.validation("invalid status");
      conditions.push("f.status = ?");
      binds.push(status);
    }
    if (result !== undefined) {
      if (!["success", "not_modified", "error"].includes(result)) throw errors.validation("invalid result");
      conditions.push("fs.last_result = ?");
      binds.push(result);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { results } = await c.env.DB.prepare(
      `${ADMIN_FEED_SELECT} ${where} ORDER BY f.id ASC LIMIT ? OFFSET ?`
    )
      .bind(...binds, limit + 1, offset)
      .all<AdminFeedRow>();
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    return c.json({
      data: page.map((row) => serializeFeed(row)),
      meta: { nextCursor: hasMore ? String(offset + limit) : null },
    });
  })
  .get("/feeds/:feedId", async (c) => {
    const row = await c.env.DB.prepare(`${ADMIN_FEED_SELECT} WHERE f.id = ?`)
      .bind(parseId(c.req.param("feedId")))
      .first<AdminFeedRow>();
    if (!row) throw errors.notFound("feed_not_found", "Feed not found");
    return c.json({ data: serializeFeed(row, true) });
  })
  .patch("/feeds/:feedId", async (c) => {
    const feedId = parseId(c.req.param("feedId"));
    const existing = await c.env.DB.prepare("SELECT id, status FROM feeds WHERE id = ?")
      .bind(feedId)
      .first<{ id: number; status: string }>();
    if (!existing) throw errors.notFound("feed_not_found", "Feed not found");

    const body = await c.req.json<{ status?: unknown }>().catch(() => null);
    if (!body || (body.status !== "active" && body.status !== "paused")) throw errors.validation("invalid status");

    const now = nowIso();
    await c.env.DB.prepare("UPDATE feeds SET status = ?, updated_at = ? WHERE id = ?").bind(body.status, now, feedId).run();
    if (existing.status === "paused" && body.status === "active") {
      await c.env.DB.prepare(
        `INSERT INTO feed_fetch_states (feed_id, consecutive_failures, next_fetch_after, updated_at)
         VALUES (?, 0, ?, ?)
         ON CONFLICT (feed_id) DO UPDATE SET consecutive_failures = 0, next_fetch_after = excluded.next_fetch_after, updated_at = excluded.updated_at`
      )
        .bind(feedId, now, now)
        .run();
    }
    const row = await c.env.DB.prepare(`${ADMIN_FEED_SELECT} WHERE f.id = ?`).bind(feedId).first<AdminFeedRow>();
    return c.json({ data: serializeFeed(row!, true) });
  })
  .get("/feeds/:feedId/logs", async (c) => {
    const feedId = parseId(c.req.param("feedId"));
    const feed = await c.env.DB.prepare("SELECT id FROM feeds WHERE id = ?").bind(feedId).first();
    if (!feed) throw errors.notFound("feed_not_found", "Feed not found");
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM feed_fetch_logs WHERE feed_id = ? ORDER BY id DESC LIMIT 100"
    )
      .bind(feedId)
      .all<{ id: number; started_at: string; finished_at: string | null; result: string; fetched_article_count: number; error_message: string | null }>();
    return c.json({
      data: results.map((row) => ({
        id: row.id,
        startedAt: toIso(row.started_at),
        finishedAt: toIso(row.finished_at),
        result: row.result,
        fetchedArticleCount: row.fetched_article_count,
        errorMessage: row.error_message,
      })),
    });
  });
