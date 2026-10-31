import type { ApiClient } from "../api/client";

export interface RefreshOutcome {
  enqueued: number;
  skipped: number;
  // Of the feeds this refresh asked for, how many ended in a failed job.
  failed: number;
  timedOut: boolean;
}

// The sentence that closes a refresh; null when there is nothing to report.
export function refreshNoticeMessage(
  outcome: RefreshOutcome,
  t: (source: string, values?: Record<string, string | number>) => string,
): string | null {
  if (outcome.timedOut) return t("取得に時間がかかっています。あとで再度更新してください。");
  if (outcome.failed > 0) return t("{count}件のフィードを取得できませんでした。処理ステータスで確認できます。", { count: outcome.failed });
  if (outcome.enqueued > 0) return `${outcome.enqueued}${t("件のフィードを更新しました。")}`;
  if (outcome.skipped > 0) return t("最近取得済みのため、今回の取得対象はありませんでした。");
  return t("取得対象のフィードがありません。");
}

// A 202 only accepts the job. Reload articles after the jobs settle, including
// jobs already running when a repeated refresh was skipped.
export async function enqueueFeedRefresh(
  api: Pick<ApiClient, "refreshFeed" | "refreshFeeds" | "getStatus" | "invalidateFeedData">,
  opts: { feedId?: number; force?: boolean } = {},
  polling: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<RefreshOutcome> {
  const result =
    opts.feedId !== undefined
      ? await api.refreshFeed(opts.feedId)
      : await api.refreshFeeds(opts.force ?? false);
  const deadline = Date.now() + (polling.timeoutMs ?? 30_000);
  try {
    if (result.enqueued === 0 && result.skipped === 0) {
      return { enqueued: 0, skipped: 0, failed: 0, timedOut: false };
    }
    const enqueuedFeedIds = new Set(result.enqueuedFeedIds);
    while (true) {
      const status = await api.getStatus(true);
      const active = status.subscriptionStatuses.some((subscription) =>
        (opts.feedId === undefined || subscription.feedId === opts.feedId)
        && subscription.fetchJob != null
        && !subscription.fetchJob.stalled
        && (subscription.fetchJob.status === "pending" || subscription.fetchJob.status === "running"),
      );
      if (!active) {
        const failed = status.subscriptionStatuses.filter((subscription) =>
          enqueuedFeedIds.has(subscription.feedId) && subscription.fetchJob?.status === "failed",
        ).length;
        return { enqueued: result.enqueued, skipped: result.skipped, failed, timedOut: false };
      }
      if (Date.now() >= deadline) return { enqueued: result.enqueued, skipped: result.skipped, failed: 0, timedOut: true };
      await new Promise((resolve) => setTimeout(resolve, polling.intervalMs ?? 3000));
    }
  } finally {
    // A list or bootstrap read made while the worker was running must not be
    // reused as the result of this refresh.
    api.invalidateFeedData();
  }
}
