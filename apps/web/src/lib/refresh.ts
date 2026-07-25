import type { ApiClient } from "../api/client";

const POLL_MS = 2500;
const TIMEOUT_MS = 45_000;

export interface RefreshOutcome {
  enqueued: number;
  skipped: number;
  timedOut: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Feed refresh is fire-and-forget on the server (202 + queue). The server
// records a pending fetch job per feed before responding, so "manual refresh"
// waits by polling /status until the requested fetch jobs have settled.
// Falls back to timedOut=true so callers can still reload the list.
export async function refreshFeedsAndWait(
  api: ApiClient,
  opts: { feedId?: number; force?: boolean } = {},
): Promise<RefreshOutcome> {
  const result =
    opts.feedId !== undefined
      ? await api.refreshFeed(opts.feedId)
      : await api.refreshFeeds(opts.force ?? false);
  if (result.enqueued === 0) {
    return { enqueued: 0, skipped: result.skipped, timedOut: false };
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    try {
      const status = await api.getStatus();
      if (opts.feedId !== undefined) {
        const sub = status.subscriptionStatuses.find((s) => s.feedId === opts.feedId);
        if (!sub) break;
        const job = sub.fetchJob;
        if (!job || job.status === "completed" || job.status === "failed") {
          return { enqueued: result.enqueued, skipped: result.skipped, timedOut: false };
        }
      } else if (
        status.subscriptionStatuses.every(
          (s) =>
            !s.fetchJob ||
            s.fetchJob.stalled ||
            (s.fetchJob.status !== "pending" && s.fetchJob.status !== "running"),
        )
      ) {
        return { enqueued: result.enqueued, skipped: result.skipped, timedOut: false };
      }
    } catch {
      // transient poll failure: keep waiting until the deadline
    }
  }
  return { enqueued: result.enqueued, skipped: result.skipped, timedOut: true };
}
