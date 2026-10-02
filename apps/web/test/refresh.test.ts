import assert from "node:assert/strict";
import { test } from "node:test";
import { enqueueFeedRefresh } from "../src/lib/refresh.ts";

function client(statuses: Array<Array<{ feedId: number; status: string; stalled?: boolean }>>, enqueued = 1, skipped = 0) {
  let reads = 0;
  let invalidations = 0;
  let refreshedFeed: number | undefined;
  return {
    get reads() { return reads; },
    get invalidations() { return invalidations; },
    get refreshedFeed() { return refreshedFeed; },
    refreshFeeds: async () => ({ accepted: true, enqueued, skipped, queuedAt: "2026-10-02T00:00:00Z" }),
    refreshFeed: async (feedId: number) => {
      refreshedFeed = feedId;
      return { accepted: true, enqueued, skipped, queuedAt: "2026-10-02T00:00:00Z" };
    },
    getStatus: async (fresh?: boolean) => {
      assert.equal(fresh, true, "polling must bypass pre-refresh cached status");
      const jobs = statuses[Math.min(reads++, statuses.length - 1)] ?? [];
      return {
        subscriptionStatuses: jobs.map(({ feedId, status, stalled = false }) => ({
          feedId, fetchJob: { status, stalled },
        })),
      };
    },
    invalidateFeedData: () => { invalidations++; },
  };
}

// The fake only supplies the fields the polling contract consumes.
type RefreshClient = Parameters<typeof enqueueFeedRefresh>[0];
const asClient = (value: ReturnType<typeof client>) => value as unknown as RefreshClient;

test("waits through pending and running before allowing the caller to reload", async () => {
  const api = client([
    [{ feedId: 1, status: "pending" }],
    [{ feedId: 1, status: "running" }],
    [{ feedId: 1, status: "completed" }],
  ]);
  const result = await enqueueFeedRefresh(asClient(api), {}, { intervalMs: 0 });
  assert.equal(result.timedOut, false);
  assert.equal(api.reads, 3);
  assert.equal(api.invalidations, 1);
});

test("a per-feed refresh does not wait for unrelated feeds", async () => {
  const api = client([[{ feedId: 1, status: "completed" }, { feedId: 2, status: "running" }]]);
  const result = await enqueueFeedRefresh(asClient(api), { feedId: 1 });
  assert.equal(api.refreshedFeed, 1);
  assert.equal(result.timedOut, false);
  assert.equal(api.reads, 1);
});

test("a repeated refresh waits for an already-running job even when nothing was enqueued", async () => {
  const api = client([[{ feedId: 1, status: "running" }], [{ feedId: 1, status: "completed" }]], 0, 1);
  const result = await enqueueFeedRefresh(asClient(api), {}, { intervalMs: 0 });
  assert.equal(api.reads, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.timedOut, false);
});

test("failed and stalled jobs settle without hanging the list", async () => {
  const api = client([[{ feedId: 1, status: "failed" }, { feedId: 2, status: "pending", stalled: true }]]);
  assert.equal((await enqueueFeedRefresh(asClient(api))).timedOut, false);
});

test("a long-running job reports a timeout and invalidates data for the final reload", async () => {
  const api = client([[{ feedId: 1, status: "running" }]]);
  assert.equal((await enqueueFeedRefresh(asClient(api), {}, { timeoutMs: 0 })).timedOut, true);
  assert.equal(api.invalidations, 1);
});

test("polling failures still invalidate pre-refresh data", async () => {
  const api = client([]);
  const error = new Error("offline");
  api.getStatus = async () => { throw error; };
  await assert.rejects(enqueueFeedRefresh(asClient(api)), error);
  assert.equal(api.invalidations, 1);
});
