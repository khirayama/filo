import type { ApiClient } from "../api/client";

export interface RefreshOutcome {
  enqueued: number;
  skipped: number;
  timedOut: boolean;
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
      return { enqueued: 0, skipped: 0, timedOut: false };
    }
    while (true) {
      const status = await api.getStatus(true);
      const active = status.subscriptionStatuses.some((subscription) =>
        (opts.feedId === undefined || subscription.feedId === opts.feedId)
        && subscription.fetchJob != null
        && !subscription.fetchJob.stalled
        && (subscription.fetchJob.status === "pending" || subscription.fetchJob.status === "running"),
      );
      if (!active) return { enqueued: result.enqueued, skipped: result.skipped, timedOut: false };
      if (Date.now() >= deadline) return { enqueued: result.enqueued, skipped: result.skipped, timedOut: true };
      await new Promise((resolve) => setTimeout(resolve, polling.intervalMs ?? 3000));
    }
  } finally {
    // A list or bootstrap read made while the worker was running must not be
    // reused as the result of this refresh.
    api.invalidateFeedData();
  }
}
