import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, JobMessage } from "../src/env";
import { runFetchFeed } from "../src/jobs/fetchFeed";
import type { AppContext } from "../src/lib/auth";
import { statusRoutes } from "../src/routes/status";
import { createFeed, createUser, type TestUser } from "./support/app";
import { createTestD1, type TestD1 } from "./support/d1";

const FEED_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title><link>https://example.com</link>
<item><title>Post</title><link>https://example.com/post</link><guid>post-1</guid></item></channel></rss>`;

function feedStatus(t: TestD1, feedId: number): string {
  return t.rows<{ status: string }>("SELECT status FROM feeds WHERE id = ?", feedId)[0]!.status;
}

describe("recovering a paused feed", () => {
  let t: TestD1;
  let user: TestUser;
  let feedId: number;
  let sent: JobMessage[];

  function postRefresh(path: string, body?: unknown) {
    const app = new Hono<AppContext>();
    app.use("*", async (c, next) => {
      c.set("user", { id: user.id, authUserId: `auth-${user.id}`, isAdmin: false });
      await next();
    });
    app.route("/status", statusRoutes);
    const env = {
      DB: t.db,
      JOBS: { sendBatch: async (batch: Array<{ body: JobMessage }>) => { sent.push(...batch.map((m) => m.body)); } },
    } as unknown as Env;
    return app.request(path, { method: "POST", body: JSON.stringify(body ?? {}) }, env);
  }

  beforeEach(() => {
    t = createTestD1();
    user = createUser(t, "reader");
    feedId = createFeed(t, "https://example.com/feed.xml");
    sent = [];
    t.exec("INSERT INTO subscriptions (user_id, feed_id, sort_order) VALUES (?, ?, 10)", user.id, feedId);
    t.exec("UPDATE feeds SET status = 'paused' WHERE id = ?", feedId);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("asks the worker to recover when one paused feed is refreshed", async () => {
    const response = await postRefresh(`/status/refresh/${feedId}`);
    const { data } = (await response.json()) as { data: { enqueued: number; enqueuedFeedIds: number[] } };
    expect(data.enqueued).toBe(1);
    expect(data.enqueuedFeedIds).toEqual([feedId]);
    expect(sent).toEqual([{ jobType: "fetch_feed", feedId, reason: "manual_recovery", attempt: 1 }]);
  });

  it("keeps paused feeds out of the bulk refresh", async () => {
    const response = await postRefresh("/status/refresh", { force: true });
    const { data } = (await response.json()) as { data: { enqueued: number; enqueuedFeedIds: number[] } };
    expect(data.enqueued).toBe(0);
    expect(data.enqueuedFeedIds).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("reactivates the feed when the fetch succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(FEED_XML, { status: 200 })));
    await runFetchFeed({ DB: t.db } as unknown as Env, feedId, "manual_recovery");
    expect(feedStatus(t, feedId)).toBe("active");
  });

  it("reactivates the feed when the server answers not modified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 304 })));
    await runFetchFeed({ DB: t.db } as unknown as Env, feedId, "manual_recovery");
    expect(feedStatus(t, feedId)).toBe("active");
  });

  it("stays paused and reports the failure when the fetch fails", async () => {
    t.exec("INSERT INTO feed_jobs (user_id, feed_id, status, requested_at, updated_at) VALUES (?, ?, 'pending', datetime('now'), datetime('now'))", user.id, feedId);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    await runFetchFeed({ DB: t.db } as unknown as Env, feedId, "manual_recovery");
    expect(feedStatus(t, feedId)).toBe("paused");
    expect(t.rows<{ status: string }>("SELECT status FROM feed_jobs WHERE feed_id = ?", feedId)[0]!.status).toBe("failed");
  });

  it("does not fetch a paused feed for an ordinary refresh", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await runFetchFeed({ DB: t.db } as unknown as Env, feedId, "refresh");
    expect(fetch).not.toHaveBeenCalled();
    expect(feedStatus(t, feedId)).toBe("paused");
  });
});
