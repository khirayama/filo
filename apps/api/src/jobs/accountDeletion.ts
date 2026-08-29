import type { Env } from "../env";
import { nowIso } from "../lib/util";

interface DeletionJobRow {
  id: number;
  user_id: number | null;
  auth_user_id: string;
  status: string;
  attempt_count: number;
}

// The Better Auth identity and application data are removed in one retryable job.
export async function runAccountDeletion(env: Env, deletionJobId: number): Promise<void> {
  const job = await env.DB.prepare(
    "SELECT id, user_id, auth_user_id, status, attempt_count FROM account_deletion_jobs WHERE id = ?"
  )
    .bind(deletionJobId)
    .first<DeletionJobRow>();
  if (!job || job.status === "completed") return;

  const now = nowIso();
  await env.DB.prepare(
    "UPDATE account_deletion_jobs SET status = 'running', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?"
  )
    .bind(now, deletionJobId)
    .run();
  await env.DB.prepare("UPDATE deleted_user_tombstones SET cleanup_status = 'running', updated_at = ? WHERE auth_user_id = ?")
    .bind(now, job.auth_user_id)
    .run();

  try {
    await env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(job.auth_user_id).run();
    await env.DB.prepare("DELETE FROM account WHERE user_id = ?").bind(job.auth_user_id).run();
    await env.DB.prepare("DELETE FROM user WHERE id = ?").bind(job.auth_user_id).run();
    if (job.user_id !== null) {
      // FK cascades remove settings, subscriptions, tags, states, OPML jobs.
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(job.user_id).run();
    }

    const finishedAt = nowIso();
    await env.DB.prepare("UPDATE account_deletion_jobs SET status = 'completed', last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(finishedAt, deletionJobId)
      .run();
    await env.DB.prepare(
      "UPDATE deleted_user_tombstones SET cleanup_status = 'completed', updated_at = ? WHERE auth_user_id = ?"
    )
      .bind(finishedAt, job.auth_user_id)
      .run();
  } catch (error) {
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : "account deletion failed";
    await env.DB.prepare("UPDATE account_deletion_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
      .bind(message, failedAt, deletionJobId)
      .run();
    await env.DB.prepare(
      "UPDATE deleted_user_tombstones SET cleanup_status = 'failed', updated_at = ? WHERE auth_user_id = ?"
    )
      .bind(failedAt, job.auth_user_id)
      .run();
  }
}
