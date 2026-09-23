import { nowIso } from "./util";
import type { JobMessage } from "../env";

export interface ContentRequestResult {
  status: "pending" | "ready";
  enqueued: boolean;
}

// Atomically claim an extraction request before enqueueing. The unique
// article_id row ensures concurrent API callers can only enqueue once.
export async function enqueueArticleContent(
  db: D1Database,
  jobs: Queue<JobMessage>,
  articleId: number,
  force = false,
): Promise<ContentRequestResult> {
  const now = nowIso();
  const claimed = await db.prepare(
    `INSERT INTO article_contents (article_id, status, created_at, updated_at)
     VALUES (?, 'pending', ?, ?)
     ON CONFLICT (article_id) DO UPDATE SET status = 'pending', text = NULL, html = NULL,
       error_message = NULL, updated_at = excluded.updated_at
     WHERE article_contents.status != 'pending' AND (? = 1 OR article_contents.status != 'ready')
     RETURNING status`,
  ).bind(articleId, now, now, force ? 1 : 0).first<{ status: string }>();

  if (!claimed) {
    const current = await db.prepare(
      "SELECT status FROM article_contents WHERE article_id = ?",
    ).bind(articleId).first<{ status: string }>();
    return { status: current?.status === "ready" ? "ready" : "pending", enqueued: false };
  }

  try {
    await jobs.send({ jobType: "extract_content", articleId });
  } catch (error) {
    await db.prepare(
      `UPDATE article_contents
       SET status = 'error', text = NULL, html = NULL, error_message = 'job enqueue failed', updated_at = ?
       WHERE article_id = ? AND status = 'pending' AND updated_at = ?`,
    ).bind(nowIso(), articleId, now).run();
    throw error;
  }
  return { status: "pending", enqueued: true };
}
