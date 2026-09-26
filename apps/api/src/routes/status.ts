import { Hono, type Context } from "hono";
import type { AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import {
  serializeFeedJob,
  shouldEnqueueFeedJob,
  upsertFeedJobs,
  type FeedJobRow,
  type FeedJobStatus,
} from "../lib/feedJobs";
import type { JobMessage } from "../env";
import { recordD1Meta } from "../lib/observability";
import { nowIso, parseId, toIso } from "../lib/util";

interface SubscriptionStatusRow {
  subscription_id: number;
  feed_title: string;
  feed_id: number;
  feed_status: string;
  article_count: number;
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
async function subscribedFeedId(c: Context<AppContext>): Promise<{ userId: number; feedId: number }> {
  const user = c.get("user");
  const feedId = parseId(c.req.param("feedId") ?? "");
  const subscribed = await c.env.DB
    .prepare("SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?")
    .bind(user.id, feedId)
    .first();
  if (!subscribed) throw errors.notFound("feed_not_found", "Feed not found in your subscriptions");
  return { userId: user.id, feedId };
}

export const statusRoutes = new Hono<AppContext>()
  .get("/", async (c) => {
    const userId = c.get("user").id;
    const now = nowIso();

    // One pass over the user's subscriptions; the summary counts are derived
    // from the same rows instead of separate aggregate queries.
    const subStatusResult = await c.env.DB.prepare(
      `SELECT s.id AS subscription_id, COALESCE(s.custom_title, f.title) AS feed_title,
              f.id AS feed_id, f.status AS feed_status, f.article_count,
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
    recordD1Meta("status.subscription_statuses", subStatusResult.meta, { returned: subStatusResult.results.length });
    const { results: subStatusRows } = subStatusResult;

    let lastFetchedAt: string | null = null;
    for (const row of subStatusRows) {
      const fetchedAt = toIso(row.last_fetched_at);
      if (fetchedAt && (!lastFetchedAt || fetchedAt > lastFetchedAt)) lastFetchedAt = fetchedAt;
    }

    return c.json({
      data: {
        generatedAt: now,
        feeds: {
          total: subStatusRows.length,
          active: subStatusRows.filter((row) => row.feed_status === "active").length,
          paused: subStatusRows.filter((row) => row.feed_status === "paused").length,
          lastFetchedAt,
        },
        articles: { total: subStatusRows.reduce((sum, row) => sum + row.article_count, 0) },
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
    const userId = c.get("user").id;
    const now = nowIso();

    // Read the user's active feeds once: the same rows decide what to enqueue
    // and how many were skipped by the per-feed cooldown (ignored by force)
    // or by a fetch that is already in flight.
    const { results } = await c.env.DB.prepare(
      `SELECT f.id,
              (fs.next_fetch_after IS NULL OR fs.next_fetch_after <= ?) AS due,
              fj.status AS fetch_status, fj.updated_at AS fetch_updated_at
       FROM subscriptions s
       JOIN feeds f ON f.id = s.feed_id
       LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id
       LEFT JOIN feed_jobs fj ON fj.feed_id = f.id AND fj.user_id = s.user_id
       WHERE s.user_id = ? AND f.status = 'active'`,
    )
      .bind(now, userId)
      .all<{ id: number; due: number; fetch_status: string | null; fetch_updated_at: string | null }>();

    const queueRows = results
      .filter((row) => (force || row.due === 1) && shouldEnqueueFeedJob(row.fetch_status, row.fetch_updated_at))
      .slice(0, 200);
    await upsertFeedJobs(c.env.DB, userId, queueRows.map((row) => row.id));
    const messages: Array<{ body: JobMessage }> = queueRows.map((row) => ({
      body: { jobType: "fetch_feed", feedId: row.id, reason: "refresh", attempt: 1 },
    }));
    for (let i = 0; i < messages.length; i += 100) {
      await c.env.JOBS.sendBatch(messages.slice(i, i + 100));
    }

    // Surface how many active feeds were not enqueued so clients can explain
    // a no-op refresh instead of failing silently.
    const skipped = results.length - queueRows.length;
    return c.json({ data: { accepted: true, enqueued: queueRows.length, skipped, queuedAt: now } }, 202);
  })
  .post("/refresh/:feedId", async (c) => {
    const { userId, feedId } = await subscribedFeedId(c);
    const existing = await c.env.DB.prepare(
      "SELECT status, updated_at FROM feed_jobs WHERE user_id = ? AND feed_id = ?",
    ).bind(userId, feedId).first<{ status: string; updated_at: string | null }>();
    if (!shouldEnqueueFeedJob(existing?.status, existing?.updated_at)) {
      return c.json({ data: { accepted: true, enqueued: 0, skipped: 1, queuedAt: nowIso() } }, 202);
    }
    await upsertFeedJobs(c.env.DB, userId, [feedId]);
    await c.env.JOBS.sendBatch([{ body: { jobType: "fetch_feed", feedId, reason: "refresh", attempt: 1 } }]);
    return c.json({ data: { accepted: true, enqueued: 1, skipped: 0, queuedAt: nowIso() } }, 202);
  });
