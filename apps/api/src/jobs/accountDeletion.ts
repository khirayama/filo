import { createClerkClient } from "@clerk/backend";
import type { Env } from "../env";
import { nowIso } from "../lib/util";

interface DeletionJobRow {
  id: number;
  user_id: number | null;
  clerk_user_id: string;
  status: string;
  attempt_count: number;
}

// Order matters: tombstone exists before this job runs; Clerk deletion happens
// before app data cleanup so a failed cleanup can be retried server-side.
export async function runAccountDeletion(env: Env, deletionJobId: number): Promise<void> {
  const job = await env.DB.prepare(
    "SELECT id, user_id, clerk_user_id, status, attempt_count FROM account_deletion_jobs WHERE id = ?"
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
  await env.DB.prepare("UPDATE deleted_user_tombstones SET cleanup_status = 'running', updated_at = ? WHERE clerk_user_id = ?")
    .bind(now, job.clerk_user_id)
    .run();

  try {
    const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
    try {
      await clerk.users.deleteUser(job.clerk_user_id);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status !== 404) throw error; // already deleted is fine
    }

    if (job.user_id !== null) {
      // FK cascades remove settings, subscriptions, tags, states, OPML jobs.
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(job.user_id).run();
    }

    const finishedAt = nowIso();
    await env.DB.prepare("UPDATE account_deletion_jobs SET status = 'completed', last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(finishedAt, deletionJobId)
      .run();
    await env.DB.prepare(
      "UPDATE deleted_user_tombstones SET cleanup_status = 'completed', updated_at = ? WHERE clerk_user_id = ?"
    )
      .bind(finishedAt, job.clerk_user_id)
      .run();
  } catch (error) {
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : "account deletion failed";
    await env.DB.prepare("UPDATE account_deletion_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
      .bind(message, failedAt, deletionJobId)
      .run();
    await env.DB.prepare(
      "UPDATE deleted_user_tombstones SET cleanup_status = 'failed', updated_at = ? WHERE clerk_user_id = ?"
    )
      .bind(failedAt, job.clerk_user_id)
      .run();
  }
}
