import { Hono } from "hono";
import type { OpsContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { enqueuePendingTranslations } from "../lib/translate";
import { armTranslationWatchdog } from "../jobs/translationWatchdogPolicy";
import { emptyCoverage, feedTranslationCoverage } from "../lib/translationCoverage";
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

// Reset error rows and enqueue every missing (article, language) pair of the
// given feeds, then kick the global drain. Duplicate drain messages are
// harmless — a drain without pending work exits after one query.
async function enqueueTranslations(c: { env: OpsContext["Bindings"] }, feedIds: number[]): Promise<number> {
  if (feedIds.length === 0) return 0;
  const enqueued = await enqueuePendingTranslations(c.env, feedIds);
  await c.env.TRANSLATE_JOBS.send({ jobType: "translate_drain" });
  // Arm the safety net: if this drain (or its continuation) later dies, the
  // watchdog's persisted alarm restarts the backlog without user action.
  await armTranslationWatchdog(c.env);
  return enqueued;
}

// Discard queued / in-flight / failed translation rows for the given feeds so
// the queue empties. Completed (ready) rows are kept. The drain and watchdog
// wind down on their own once nothing is pending.
async function discardTranslations(env: OpsContext["Bindings"], feedIds: number[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < feedIds.length; i += 60) {
    const chunk = feedIds.slice(i, i + 60);
    const placeholders = chunk.map(() => "?").join(", ");
    const res = await env.DB.prepare(
      `DELETE FROM article_listing_translations
       WHERE status IN ('pending', 'error')
         AND article_id IN (SELECT id FROM articles WHERE feed_id IN (${placeholders}))`,
    )
      .bind(...chunk)
      .run();
    removed += res.meta.changes ?? 0;
  }
  return removed;
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

    const coverageByFeed = await feedTranslationCoverage(c.env.DB, userId);

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
       LEFT JOIN feed_jobs fj ON fj.feed_id = f.id AND fj.user_id = s.user_id AND fj.kind = 'fetch'
       WHERE s.user_id = ?
       ORDER BY
         CASE WHEN COALESCE(fs.consecutive_failures, 0) > 0 THEN 0 ELSE 1 END,
         fs.last_fetched_at DESC NULLS LAST`
    )
      .bind(userId)
      .all<SubscriptionStatusRow>();

    let pendingTotal = 0;
    for (const entry of coverageByFeed.values()) pendingTotal += entry.pending;

    // Titles currently in flight to the model (順番待ち → 翻訳中), scoped to the
    // user's own feeds. The drain runs one small batch at a time, so this is a
    // short live list ("今翻訳中: …").
    const { results: currentRows } = await c.env.DB.prepare(
      `SELECT a.title AS title, GROUP_CONCAT(t.language) AS languages
       FROM article_listing_translations t
       JOIN articles a ON a.id = t.article_id
       JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = ?
       WHERE t.status = 'pending' AND t.processing_at IS NOT NULL
       GROUP BY a.id
       ORDER BY MAX(t.processing_at) DESC
       LIMIT 5`,
    )
      .bind(userId)
      .all<{ title: string | null; languages: string | null }>();
    const current = currentRows
      .filter((row) => row.title)
      .map((row) => ({
        title: row.title as string,
        languages: (row.languages ?? "").split(",").filter(Boolean),
      }));

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
        translator: { pending: pendingTotal, current },
        subscriptionStatuses: subStatusRows.map((row) => ({
          subscriptionId: row.subscription_id,
          feedTitle: row.feed_title,
          feedId: row.feed_id,
          feedStatus: row.feed_status,
          lastResult: row.last_result,
          lastError: row.last_error,
          lastFetchedAt: toIso(row.last_fetched_at),
          consecutiveFailures: row.consecutive_failures ?? 0,
          translation: coverageByFeed.get(row.feed_id) ?? emptyCoverage(),
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

    let sql: string;
    let binds: unknown[];

    if (user) {
      sql = force
        ? `SELECT f.id FROM feeds f
           JOIN subscriptions s ON s.feed_id = f.id AND s.user_id = ?
           WHERE f.status = 'active' LIMIT 200`
        : `SELECT f.id FROM feeds f
           JOIN subscriptions s ON s.feed_id = f.id AND s.user_id = ?
           LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id
           WHERE f.status = 'active' AND (fs.next_fetch_after IS NULL OR fs.next_fetch_after <= ?)
           LIMIT 200`;
      binds = force ? [user.id] : [user.id, now];
    } else {
      sql = force
        ? `SELECT f.id FROM feeds f WHERE f.status = 'active' LIMIT 200`
        : `SELECT f.id FROM feeds f
           LEFT JOIN feed_fetch_states fs ON fs.feed_id = f.id
           WHERE f.status = 'active' AND (fs.next_fetch_after IS NULL OR fs.next_fetch_after <= ?)
           LIMIT 200`;
      binds = force ? [] : [now];
    }

    const { results } = await c.env.DB.prepare(sql).bind(...binds).all<{ id: number }>();

    for (const row of results) {
      if (user) {
        await upsertFeedJob(c.env.DB, user.id, row.id, "fetch", "pending");
      }
      await c.env.JOBS.send({ jobType: "fetch_feed", feedId: row.id, reason: "refresh", attempt: 1 });
    }

    // surface how many active feeds were skipped by the fetch cooldown so
    // clients can explain a no-op refresh instead of failing silently
    let skipped = 0;
    if (!force) {
      const activeSql = user
        ? `SELECT COUNT(*) AS n FROM feeds f
           JOIN subscriptions s ON s.feed_id = f.id AND s.user_id = ?
           WHERE f.status = 'active'`
        : "SELECT COUNT(*) AS n FROM feeds f WHERE f.status = 'active'";
      const active = user
        ? await c.env.DB.prepare(activeSql).bind(user.id).first<{ n: number }>()
        : await c.env.DB.prepare(activeSql).first<{ n: number }>();
      skipped = Math.max((active?.n ?? 0) - results.length, 0);
    }

    return c.json({ data: { accepted: true, enqueued: results.length, skipped, queuedAt: now } }, 202);
  })
  .post("/refresh/:feedId", async (c) => {
    const user = c.get("user");
    if (!user) throw errors.unauthorized();
    const feedId = parseId(c.req.param("feedId"));
    const sub = await c.env.DB.prepare(
      "SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?",
    )
      .bind(user.id, feedId)
      .first();
    if (!sub) throw errors.notFound("feed_not_found", "Feed not found in your subscriptions");
    await upsertFeedJob(c.env.DB, user.id, feedId, "fetch", "pending");
    await c.env.JOBS.send({ jobType: "fetch_feed", feedId, reason: "refresh", attempt: 1 });
    return c.json({ data: { accepted: true, enqueued: 1, skipped: 0, queuedAt: nowIso() } }, 202);
  })
  .post("/translate", async (c) => {
    const user = c.get("user");
    if (!user) throw errors.unauthorized();
    const { results } = await c.env.DB.prepare(
      "SELECT feed_id FROM subscriptions WHERE user_id = ?",
    )
      .bind(user.id)
      .all<{ feed_id: number }>();
    const enqueued = await enqueueTranslations(c, results.map((row) => row.feed_id));
    return c.json({ data: { accepted: true, enqueued, queuedAt: nowIso() } }, 202);
  })
  // Registered before "/translate/:feedId" so the static path is unambiguous.
  .post("/translate/discard", async (c) => {
    const user = c.get("user");
    if (!user) throw errors.unauthorized();
    const { results } = await c.env.DB.prepare(
      "SELECT feed_id FROM subscriptions WHERE user_id = ?",
    )
      .bind(user.id)
      .all<{ feed_id: number }>();
    const removed = await discardTranslations(c.env, results.map((row) => row.feed_id));
    return c.json({ data: { accepted: true, removed, discardedAt: nowIso() } }, 200);
  })
  .post("/translate/:feedId/discard", async (c) => {
    const user = c.get("user");
    if (!user) throw errors.unauthorized();
    const feedId = parseId(c.req.param("feedId"));
    const sub = await c.env.DB.prepare(
      "SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?",
    )
      .bind(user.id, feedId)
      .first();
    if (!sub) throw errors.notFound("feed_not_found", "Feed not found in your subscriptions");
    const removed = await discardTranslations(c.env, [feedId]);
    return c.json({ data: { accepted: true, removed, discardedAt: nowIso() } }, 200);
  })
  .post("/translate/:feedId", async (c) => {
    const user = c.get("user");
    if (!user) throw errors.unauthorized();
    const feedId = parseId(c.req.param("feedId"));
    const sub = await c.env.DB.prepare(
      "SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?",
    )
      .bind(user.id, feedId)
      .first();
    if (!sub) throw errors.notFound("feed_not_found", "Feed not found in your subscriptions");
    const enqueued = await enqueueTranslations(c, [feedId]);
    return c.json({ data: { accepted: true, enqueued, queuedAt: nowIso() } }, 202);
  });
