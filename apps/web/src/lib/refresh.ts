import type { ApiClient } from "../api/client";

export interface RefreshOutcome {
  enqueued: number;
  skipped: number;
  timedOut: boolean;
}

// Feed refresh is fire-and-forget on the server (202 + queue). Do not poll
// /status here; callers reload the visible data once and can manually reload
// the status screen when they need the latest job state.
export async function enqueueFeedRefresh(
  api: ApiClient,
  opts: { feedId?: number; force?: boolean } = {},
): Promise<RefreshOutcome> {
  const result =
    opts.feedId !== undefined
      ? await api.refreshFeed(opts.feedId)
      : await api.refreshFeeds(opts.force ?? false);
  return { enqueued: result.enqueued, skipped: result.skipped, timedOut: false };
}
