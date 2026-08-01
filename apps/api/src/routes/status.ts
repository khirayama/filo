import { Hono, type Context } from "hono";
import type { OpsContext } from "../lib/auth";
import { errors } from "../lib/errors";
import {
  serializeFeedJob,
  upsertFeedJob,
  type FeedJobRow,
  type FeedJobStatus,
} from "../lib/feedJobs";
import { nowIso, parseId, toIso } from "../lib/util";

interface FeedAggRow {
  total: number;
  active: number;
  paused: number;
  last_fetched_at: string | null;
}

interface SubscriptionStatusRow {
  subscription_id: number;
  feed_title: string;
  feed_id: number;
  feed_status: string;
  last_result: string | null;
  last_error: string | null;
  last_fetched_at: string | null;
  consecutive_failures: number | null;
  fetch_status: string | null;
  fetch_requested_at: string | null;
  fetch_started_at: string | null;
  fetch_finished_at: string | null;
  fetch_last_error: string | null;
  fetch_updated_at: string | null;
}

function jobFromColumns(
  status: string | null,
  requestedAt: string | null,
  startedAt: string | null,
  finishedAt: string | null,
  lastError: string | null,
  updatedAt: string | null,
) {
  if (!status) return null;
  const row: FeedJobRow = {
    status: status as FeedJobStatus,
    requested_at: requestedAt ?? updatedAt ?? nowIso(),
    started_at: startedAt,
    finished_at: finishedAt,
    last_error: lastError,
    updated_at: updatedAt ?? nowIso(),
  };
  return serializeFeedJob(row);
}

// Resolve a :feedId path param, rejecting any feed the current user does not
// subscribe to. Every per-feed operation below is scoped this way.
async function subscribedFeedId(c: Context<OpsContext>): Promise<{ userId: number; feedId: number }> {
  const user = c.get("user");
  if (!user) throw errors.unauthorized();
  const feedId = parseId(c.req.param("feedId") ?? "");
  const subscribed = await c.env.DB
    .prepare("SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?")
    .bind(user.id, feedId)
    .first();
  if (!subscribed) throw errors.notFound("feed_not_found", "Feed not found in your subscriptions");
  return { userId: user.id, feedId };
}

export const statusRoutes = new Hono<OpsContext>()
  .get("/", async (c) => {
    const user = c.get("user");
    if (!user) throw errors.unauthorized();
    const userId = user.id;
    const now = nowIso();

    const feedAgg = await c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN f.status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN f.status = 'paused' THEN 1 ELSE 0 END) AS paused,
         MAX(fs.last_fetched_at) AS last_fetched_at
       FROM feeds f
       JOIN subscriptions s ON s.feed_id = f.id AND s.user_id = ?
       LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id`
    )
      .bind(userId)
      .first<FeedAggRow>();

    const articleAgg = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n
       FROM articles a
       JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = ?`
    )
      .bind(userId)
      .first<{ n: number }>();

    const { results: subStatusRows } = await c.env.DB.prepare(
      `SELECT s.id AS subscription_id, COALESCE(s.custom_title, f.title) AS feed_title,
              f.id AS feed_id, f.status AS feed_status,
              fs.last_result, fs.last_error, fs.last_fetched_at,
              fs.consecutive_failures,
              fj.status AS fetch_status, fj.requested_at AS fetch_requested_at,
              fj.started_at AS fetch_started_at, fj.finished_at AS fetch_finished_at,
              fj.last_error AS fetch_last_error, fj.updated_at AS fetch_updated_at
       FROM subscriptions s
       JOIN feeds f ON f.id = s.feed_id
       LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id
       LEFT JOIN feed_jobs fj ON fj.feed_id = f.id AND fj.user_id = s.user_id
       WHERE s.user_id = ?
       ORDER BY
         CASE WHEN COALESCE(fs.consecutive_failures, 0) > 0 THEN 0 ELSE 1 END,
         fs.last_fetched_at DESC NULLS LAST`
    )
      .bind(userId)
      .all<SubscriptionStatusRow>();

    return c.json({
      data: {
        generatedAt: now,
        feeds: {
          total: feedAgg?.total ?? 0,
          active: feedAgg?.active ?? 0,
          paused: feedAgg?.paused ?? 0,
          lastFetchedAt: toIso(feedAgg?.last_fetched_at ?? null),
        },
        articles: { total: articleAgg?.n ?? 0 },
        subscriptionStatuses: subStatusRows.map((row) => ({
          subscriptionId: row.subscription_id,
          feedTitle: row.feed_title,
          feedId: row.feed_id,
          feedStatus: row.feed_status,
          lastResult: row.last_result,
          lastError: row.last_error,
          lastFetchedAt: toIso(row.last_fetched_at),
          consecutiveFailures: row.consecutive_failures ?? 0,
          fetchJob: jobFromColumns(
            row.fetch_status,
            row.fetch_requested_at,
            row.fetch_started_at,
            row.fetch_finished_at,
            row.fetch_last_error,
            row.fetch_updated_at,
          ),
        })),
      },
    });
  })
  .post("/refresh", async (c) => {
    const body = await c.req
      .json<{ force?: unknown }>()
      .catch(() => ({}) as { force?: unknown });
    const force = body.force === true;
    const user = c.get("user");
    const now = nowIso();

    // Two independent axes: a user request is scoped to that user's
    // subscriptions (system/cron auth covers every feed), and a non-forced
    // request additionally honours the per-feed cooldown.
    const joins: string[] = [];
    const conditions = ["f.status = 'active'"];
    const binds: unknown[] = [];
    if (user) {
      joins.push("JOIN subscriptions s ON s.feed_id = f.id AND s.user_id = ?");
      binds.push(user.id);
    }
    if (!force) {
      joins.push("LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id");
      conditions.push("(fs.next_fetch_after IS NULL OR fs.next_fetch_after <= ?)");
      binds.push(now);
    }

    const { results } = await c.env.DB
      .prepare(`SELECT f.id FROM feeds f ${joins.join(" ")} WHERE ${conditions.join(" AND ")} LIMIT 200`)
      .bind(...binds)
      .all<{ id: number }>();

    for (const row of results) {
      if (user) {
        await upsertFeedJob(c.env.DB, user.id, row.id, "pending");
      }
      await c.env.JOBS.send({ jobType: "fetch_feed", feedId: row.id, reason: "refresh", attempt: 1 });
    }

    // surface how many active feeds were skipped by the fetch cooldown so
    // clients can explain a no-op refresh instead of failing silently
    let skipped = 0;
    if (!force) {
      const scope = user ? "JOIN subscriptions s ON s.feed_id = f.id AND s.user_id = ?" : "";
      const active = await c.env.DB
        .prepare(`SELECT COUNT(*) AS n FROM feeds f ${scope} WHERE f.status = 'active'`)
        .bind(...(user ? [user.id] : []))
        .first<{ n: number }>();
      skipped = Math.max((active?.n ?? 0) - results.length, 0);
    }

    return c.json({ data: { accepted: true, enqueued: results.length, skipped, queuedAt: now } }, 202);
  })
  .post("/refresh/:feedId", async (c) => {
    const { userId, feedId } = await subscribedFeedId(c);
    await upsertFeedJob(c.env.DB, userId, feedId, "pending");
    await c.env.JOBS.send({ jobType: "fetch_feed", feedId, reason: "refresh", attempt: 1 });
    return c.json({ data: { accepted: true, enqueued: 1, skipped: 0, queuedAt: nowIso() } }, 202);
  });
