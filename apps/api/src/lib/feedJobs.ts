import { nowIso, toIso } from "./util";

// Translation no longer uses feed_jobs: its state is derived from
// article_listing_translations rows (see lib/translationCoverage.ts).
export type FeedJobKind = "fetch";
export type FeedJobStatus = "pending" | "running" | "completed" | "failed";

// A pending/running job whose row has not been touched for this long is
// treated as interrupted (worker died, queue message lost) and can be resumed.
export const FEED_JOB_STALL_MS = 10 * 60 * 1000;

export interface FeedJobRow {
  status: FeedJobStatus;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export function isStalledFeedJob(status: string, updatedAt: string | null, now = Date.now()): boolean {
  if (status !== "pending" && status !== "running") return false;
  const updated = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (Number.isNaN(updated)) return true;
  return now - updated > FEED_JOB_STALL_MS;
}

export function serializeFeedJob(row: FeedJobRow | null | undefined) {
  if (!row) return null;
  return {
    status: row.status,
    requestedAt: toIso(row.requested_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    lastError: row.last_error,
    updatedAt: toIso(row.updated_at),
    stalled: isStalledFeedJob(row.status, row.updated_at),
  };
}

export async function upsertFeedJob(
  db: D1Database,
  userId: number,
  feedId: number,
  kind: FeedJobKind,
  status: FeedJobStatus,
  fields: { startedAt?: string | null; finishedAt?: string | null; lastError?: string | null } = {},
): Promise<void> {
  const now = nowIso();
  await db.prepare(
    `INSERT INTO feed_jobs
       (user_id, feed_id, kind, status, requested_at, started_at, finished_at, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, feed_id, kind) DO UPDATE SET
       status = excluded.status,
       requested_at = CASE WHEN excluded.status = 'pending' THEN excluded.requested_at ELSE feed_jobs.requested_at END,
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  )
    .bind(
      userId,
      feedId,
      kind,
      status,
      now,
      fields.startedAt ?? null,
      fields.finishedAt ?? null,
      fields.lastError ?? null,
      now,
    )
    .run();
}

// Fetch jobs are feed-scoped on the worker side: one queue message serves every
// user who requested that feed, so completion updates all active rows at once.
export async function settleFetchJobs(
  db: D1Database,
  feedId: number,
  status: "running" | "completed" | "failed",
  fields: { startedAt?: string | null; finishedAt?: string | null; lastError?: string | null } = {},
): Promise<void> {
  const now = nowIso();
  await db.prepare(
    `UPDATE feed_jobs
     SET status = ?, started_at = ?, finished_at = ?, last_error = ?, updated_at = ?
     WHERE feed_id = ? AND kind = 'fetch' AND status IN ('pending', 'running')`,
  )
    .bind(
      status,
      fields.startedAt ?? null,
      fields.finishedAt ?? null,
      fields.lastError ?? null,
      now,
      feedId,
    )
    .run();
}
