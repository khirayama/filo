import { Hono } from "hono";
import { verifyAuthUserId, type AppContext } from "../lib/auth";
import { errors } from "../lib/errors";
import { nowIso, randomToken, toIso } from "../lib/util";

interface DeletionJobRow {
  id: number;
  status: string;
  deletion_token: string | null;
  last_error: string | null;
  attempt_count: number;
  created_at: string;
}

// DELETE /api/v1/account requires an authenticated user; deletion-status also
// accepts a deletionToken so progress can be tracked after logout.
export const accountRoutes = new Hono<AppContext>()
  .delete("/", async (c) => {
    const authUserId = await verifyAuthUserId(c.env, c.req.raw.headers);

    const now = nowIso();

    // Idempotent: an active job for this user is reused.
    const active = await c.env.DB.prepare(
      "SELECT id, status, deletion_token, last_error, attempt_count, created_at FROM account_deletion_jobs WHERE auth_user_id = ? AND status IN ('pending', 'running') ORDER BY id DESC LIMIT 1"
    )
      .bind(authUserId)
      .first<DeletionJobRow>();
    if (active) {
      return c.json(
        { data: { status: active.status, deletionToken: active.deletion_token, queuedAt: toIso(active.created_at) } },
        202
      );
    }

    const user = await c.env.DB.prepare("SELECT id FROM users WHERE auth_user_id = ?")
      .bind(authUserId)
      .first<{ id: number }>();

    // Record tombstone + cleanup job before removing the auth identity.
    await c.env.DB.prepare(
      "INSERT INTO deleted_user_tombstones (auth_user_id, deleted_at, cleanup_status, updated_at) VALUES (?, ?, 'pending', ?) ON CONFLICT (auth_user_id) DO UPDATE SET cleanup_status = 'pending', updated_at = excluded.updated_at"
    )
      .bind(authUserId, now, now)
      .run();

    const token = randomToken("del");
    const job = await c.env.DB.prepare(
      "INSERT INTO account_deletion_jobs (user_id, auth_user_id, deletion_token, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?) RETURNING id, created_at"
    )
      .bind(user?.id ?? null, authUserId, token, now, now)
      .first<{ id: number; created_at: string }>();
    if (!job) throw errors.internal();

    await c.env.JOBS.send({ jobType: "account_deletion", deletionJobId: job.id, attempt: 1 });
    return c.json({ data: { status: "pending", deletionToken: token, queuedAt: toIso(job.created_at) } }, 202);
  })
  .get("/deletion-status", async (c) => {
    const token = c.req.query("deletionToken");
    let job: DeletionJobRow | null = null;

    if (token) {
      job = await c.env.DB.prepare(
        "SELECT id, status, deletion_token, last_error, attempt_count, created_at FROM account_deletion_jobs WHERE deletion_token = ?"
      )
        .bind(token)
        .first<DeletionJobRow>();
      if (!job) throw errors.notFound();
    } else {
      const authUserId = await verifyAuthUserId(c.env, c.req.raw.headers);
      job = await c.env.DB.prepare(
        "SELECT id, status, deletion_token, last_error, attempt_count, created_at FROM account_deletion_jobs WHERE auth_user_id = ? ORDER BY id DESC LIMIT 1"
      )
        .bind(authUserId)
        .first<DeletionJobRow>();
      if (!job) return c.json({ data: { status: "none" } });
    }

    const response: Record<string, unknown> = { status: job.status };
    if (job.status === "failed") {
      response.retryable = true;
      response.errorCode = "account_deletion_failed";
    }
    return c.json({ data: response });
  });
