import { Hono } from "hono";
import type { AppContext } from "../lib/auth";
import { discoverFeed } from "../lib/discovery";
import { ApiError, errors } from "../lib/errors";
import {
  SUBSCRIPTION_SELECT,
  serializeSubscription,
  type SubscriptionRow,
} from "../lib/serialize";
import { recountReadingListUnreadMutation, recountSubscriptionUnreadMutation } from "../lib/readCursor";
import { createSubscription, findOrCreateFeed } from "../lib/subscriptions";
import { attachTagsStatement, ownedTagIds, tagIdsForSubscriptions } from "../lib/tagops";
import { nowIso, parseId, parseLimit, toIso } from "../lib/util";

async function loadSubscription(db: D1Database, userId: number, subscriptionId: number): Promise<SubscriptionRow> {
  const row = await db
    .prepare(`${SUBSCRIPTION_SELECT} WHERE s.id = ? AND s.user_id = ?`)
    .bind(subscriptionId, userId)
    .first<SubscriptionRow>();
  if (!row) throw errors.notFound("subscription_not_found", "Subscription not found");
  return row;
}

async function serializeOne(db: D1Database, row: SubscriptionRow) {
  const tagMap = await tagIdsForSubscriptions(db, [row.id]);
  return serializeSubscription(row, tagMap.get(row.id) ?? [], row.unread_count);
}

export const subscriptionRoutes = new Hono<AppContext>()
  .get("/", async (c) => {
    const user = c.get("user");
    let limit: number;
    try {
      limit = parseLimit(c.req.query("limit"));
    } catch (e) {
      throw errors.validation((e as Error).message);
    }
    const tagIdRaw = c.req.query("tagId");
    const offsetRaw = c.req.query("cursor");
    const offset = offsetRaw ? (/^\d+$/.test(offsetRaw) ? Number(offsetRaw) : null) : 0;
    if (offset === null) throw errors.invalidCursor();

    let sql = `${SUBSCRIPTION_SELECT} WHERE s.user_id = ?`;
    const binds: unknown[] = [user.id];
    if (tagIdRaw !== undefined) {
      sql += " AND s.id IN (SELECT subscription_id FROM subscription_tags WHERE tag_id = ?)";
      binds.push(parseId(tagIdRaw));
    }
    sql += " ORDER BY s.sort_order ASC, s.id ASC LIMIT ? OFFSET ?";
    binds.push(limit + 1, offset);

    const { results } = await c.env.DB.prepare(sql).bind(...binds).all<SubscriptionRow>();
    const hasMore = results.length > limit;
    const page = hasMore ? results.slice(0, limit) : results;
    const tagMap = await tagIdsForSubscriptions(c.env.DB, page.map((r) => r.id));
    return c.json({
      data: page.map((row) => serializeSubscription(row, tagMap.get(row.id) ?? [], row.unread_count)),
      meta: { nextCursor: hasMore ? String(offset + limit) : null },
    });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const body = await c.req
      .json<{ feedUrl?: unknown; customTitle?: unknown; tagIds?: unknown; tagNames?: unknown }>()
      .catch(() => null);
    if (!body || typeof body.feedUrl !== "string" || !body.feedUrl.trim()) {
      throw errors.validation("feedUrl is required");
    }
    if (body.customTitle !== undefined && body.customTitle !== null && typeof body.customTitle !== "string") {
      throw errors.validation("invalid customTitle");
    }
    const tagIds = body.tagIds === undefined ? [] : body.tagIds;
    const tagNames = body.tagNames === undefined ? [] : body.tagNames;
    if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== "number")) throw errors.validation("invalid tagIds");
    if (!Array.isArray(tagNames) || tagNames.some((n) => typeof n !== "string")) throw errors.validation("invalid tagNames");

    const requestedTagIds = [...new Set(tagIds as number[])];
    const owned = await ownedTagIds(c.env.DB, user.id, requestedTagIds);
    for (const tagId of requestedTagIds) {
      if (!owned.has(tagId)) throw errors.validation(`tag ${tagId} not found`);
    }

    const discovered = await discoverFeed(body.feedUrl.trim());
    const feedId = await findOrCreateFeed(c.env.DB, discovered);
    const subscriptionId = await createSubscription(c.env.DB, c.env.JOBS, user.id, feedId, {
      customTitle: (body.customTitle as string | null | undefined)?.trim() || null,
      tagIds: requestedTagIds,
      tagNames: tagNames as string[],
    });
    if (subscriptionId === null) throw errors.conflict("subscription_already_exists", "Already subscribed to this feed");

    const row = await loadSubscription(c.env.DB, user.id, subscriptionId);
    return c.json({ data: await serializeOne(c.env.DB, row) }, 201);
  })
  .put("/order", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ subscriptionIds?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.subscriptionIds) || body.subscriptionIds.some((id) => typeof id !== "number")) {
      throw errors.validation("subscriptionIds is required");
    }
    const ids = body.subscriptionIds as number[];
    const { results } = await c.env.DB.prepare("SELECT id FROM subscriptions WHERE user_id = ?")
      .bind(user.id)
      .all<{ id: number }>();
    const owned = new Set(results.map((r) => r.id));
    if (ids.length !== owned.size || ids.some((id) => !owned.has(id)) || new Set(ids).size !== ids.length) {
      throw errors.validation("subscriptionIds must contain all of the user's subscriptions exactly once");
    }
    const now = nowIso();
    const statements = ids.map((id, index) =>
      // Rows already in place are skipped, so a reorder only writes what moved.
      c.env.DB.prepare(
        "UPDATE subscriptions SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ? AND sort_order != ?",
      ).bind((index + 1) * 10, now, id, user.id, (index + 1) * 10)
    );
    if (statements.length > 0) await c.env.DB.batch(statements);
    return c.json({ data: { updated: ids.length } });
  })
  .get("/:subscriptionId", async (c) => {
    const row = await loadSubscription(c.env.DB, c.get("user").id, parseId(c.req.param("subscriptionId")));
    return c.json({ data: await serializeOne(c.env.DB, row) });
  })
  .patch("/:subscriptionId", async (c) => {
    const user = c.get("user");
    const subscriptionId = parseId(c.req.param("subscriptionId"));
    const subscription = await loadSubscription(c.env.DB, user.id, subscriptionId);
    const body = await c.req.json<{ customTitle?: unknown }>().catch(() => null);
    if (!body || body.customTitle === undefined) {
      throw errors.validation("at least one field is required");
    }
    if (body.customTitle !== undefined && body.customTitle !== null && typeof body.customTitle !== "string") {
      throw errors.validation("invalid customTitle");
    }
    const now = nowIso();
    if (body.customTitle !== undefined) {
      await c.env.DB.prepare("UPDATE subscriptions SET custom_title = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind((body.customTitle as string | null)?.trim() || null, now, subscriptionId, user.id)
        .run();
    }
    const row = await loadSubscription(c.env.DB, user.id, subscriptionId);
    return c.json({ data: await serializeOne(c.env.DB, row) });
  })
  .delete("/:subscriptionId", async (c) => {
    const user = c.get("user");
    const subscriptionId = parseId(c.req.param("subscriptionId"));
    await loadSubscription(c.env.DB, user.id, subscriptionId);
    // Bookmarked articles remain retained after unsubscribe.
    await c.env.DB.prepare("DELETE FROM subscriptions WHERE id = ? AND user_id = ?")
      .bind(subscriptionId, user.id)
      .run();
    return c.json({ data: { deleted: true } });
  })
  .post("/:subscriptionId/retry-initial-fetch", async (c) => {
    const user = c.get("user");
    const subscriptionId = parseId(c.req.param("subscriptionId"));
    const row = await loadSubscription(c.env.DB, user.id, subscriptionId);
    if (row.initial_fetch_status !== "failed") {
      throw new ApiError(409, "initial_fetch_retry_not_allowed", "Subscription is not in a failed state");
    }
    const now = nowIso();
    await c.env.DB.prepare(
      `UPDATE subscriptions
       SET initial_fetch_status = 'fetching', initial_fetch_error_code = NULL,
           initial_fetch_requested_at = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(now, now, subscriptionId)
      .run();
    await c.env.JOBS.send({ jobType: "fetch_feed", feedId: row.feed_id, reason: "retry_initial", attempt: 1 });
    const updated = await loadSubscription(c.env.DB, user.id, subscriptionId);
    return c.json({ data: await serializeOne(c.env.DB, updated) }, 202);
  })
  .post("/:subscriptionId/mark-all-read", async (c) => {
    const user = c.get("user");
    const subscriptionId = parseId(c.req.param("subscriptionId"));
    const row = await loadSubscription(c.env.DB, user.id, subscriptionId);

    // Body is optional; upToArticleId lets the client mark only what it has
    // displayed, avoiding races with articles fetched after render.
    const body = await c.req.json<{ upToArticleId?: unknown }>().catch(() => ({}) as { upToArticleId?: unknown });
    let target: number | null;
    if (body.upToArticleId !== undefined) {
      if (typeof body.upToArticleId !== "number" || !Number.isInteger(body.upToArticleId) || body.upToArticleId <= 0) {
        throw errors.validation("invalid upToArticleId");
      }
      const article = await c.env.DB.prepare("SELECT id FROM articles WHERE id = ? AND feed_id = ?")
        .bind(body.upToArticleId, row.feed_id)
        .first<{ id: number }>();
      if (!article) throw errors.validation("upToArticleId must be an article of this feed");
      target = article.id;
    } else {
      const max = await c.env.DB.prepare("SELECT MAX(id) AS max_id FROM articles WHERE feed_id = ?")
        .bind(row.feed_id)
        .first<{ max_id: number | null }>();
      target = max?.max_id ?? null;
    }

    if (target !== null) {
      const now = nowIso();
      await c.env.DB.batch([
        // The cursor only advances; a stale request never rewinds it.
        c.env.DB.prepare(
          `INSERT INTO feed_read_cursors (user_id, feed_id, last_read_article_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, feed_id) DO UPDATE SET
             last_read_article_id = excluded.last_read_article_id, updated_at = excluded.updated_at
           WHERE excluded.last_read_article_id > feed_read_cursors.last_read_article_id`
        ).bind(user.id, row.feed_id, target, now),
        // Explicit rows override the cursor, so flip the unread ones too.
        c.env.DB.prepare(
          `UPDATE article_read_states AS ars SET is_read = 1, read_at = ?, updated_at = ?
           WHERE ars.user_id = ? AND ars.is_read = 0
           AND EXISTS (
             SELECT 1 FROM articles a
             WHERE a.id = ars.article_id AND a.feed_id = ? AND a.id <= ?
           )`
        ).bind(now, now, user.id, row.feed_id, target),
        // upToArticleId can leave newer articles unread, so recount instead
        // of resetting to zero.
        recountSubscriptionUnreadMutation(c.env.DB, subscriptionId, now),
        recountReadingListUnreadMutation(c.env.DB, user.id, now),
      ]);
    }

    const result = await c.env.DB.prepare(
      `SELECT frc.last_read_article_id, frc.updated_at, suc.unread_count
       FROM subscription_unread_counts suc
       LEFT JOIN feed_read_cursors frc ON frc.user_id = suc.user_id AND frc.feed_id = suc.feed_id
       WHERE suc.subscription_id = ?`,
    ).bind(subscriptionId).first<{
      last_read_article_id: number | null;
      updated_at: string | null;
      unread_count: number;
    }>();
    return c.json({
      data: {
        lastReadArticleId: result?.last_read_article_id ?? null,
        unreadCount: result?.unread_count ?? 0,
        updatedAt: result?.updated_at ? toIso(result.updated_at) : null,
      },
    });
  })
  .put("/:subscriptionId/tags", async (c) => {
    const user = c.get("user");
    const subscriptionId = parseId(c.req.param("subscriptionId"));
    await loadSubscription(c.env.DB, user.id, subscriptionId);
    const body = await c.req.json<{ tagIds?: unknown }>().catch(() => null);
    if (!body || !Array.isArray(body.tagIds) || body.tagIds.some((id) => typeof id !== "number")) {
      throw errors.validation("tagIds is required");
    }
    const requestedTagIds = [...new Set(body.tagIds as number[])];
    const owned = await ownedTagIds(c.env.DB, user.id, requestedTagIds);
    for (const tagId of requestedTagIds) {
      if (!owned.has(tagId)) throw errors.validation(`tag ${tagId} not found`);
    }
    await c.env.DB.batch([
      // Only removed links are deleted; kept tags cost no writes.
      c.env.DB.prepare(
        "DELETE FROM subscription_tags WHERE subscription_id = ? AND tag_id NOT IN (SELECT value FROM json_each(?))",
      ).bind(subscriptionId, JSON.stringify(requestedTagIds)),
      attachTagsStatement(c.env.DB, subscriptionId, requestedTagIds, nowIso()),
    ]);
    const row = await loadSubscription(c.env.DB, user.id, subscriptionId);
    return c.json({ data: await serializeOne(c.env.DB, row) });
  });
