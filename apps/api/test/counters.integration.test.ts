import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { collectionMutation, readStateMutation } from "../src/lib/articleState";
import { EFFECTIVE_IS_READ, readingListMembershipCounterMutation, readStateCounterMutations } from "../src/lib/readCursor";
import { createSubscription } from "../src/lib/subscriptions";
import { addArticles, createClient, createFeed, createUser, noopJobs, type TestUser } from "./support/app";
import { createTestD1, type TestD1 } from "./support/d1";

// Every derived counter must equal a brute-force count over the
// source-of-truth tables after any sequence of operations.
function expectCountersMatchSourceOfTruth(t: TestD1) {
  const subscriptions = t.rows<{ id: number; counter: number | null; truth: number }>(
    `SELECT s.id, suc.unread_count AS counter,
       (SELECT COUNT(*) FROM articles a
        LEFT JOIN article_read_states ars ON ars.user_id = s.user_id AND ars.article_id = a.id
        LEFT JOIN feed_read_cursors frc ON frc.user_id = s.user_id AND frc.feed_id = a.feed_id
        WHERE a.feed_id = s.feed_id AND (${EFFECTIVE_IS_READ}) = 0) AS truth
     FROM subscriptions s
     LEFT JOIN subscription_unread_counts suc ON suc.subscription_id = s.id
     ORDER BY s.id`,
  );
  expect(subscriptions.map((row) => [row.id, row.counter])).toEqual(subscriptions.map((row) => [row.id, row.truth]));

  const readingLists = t.rows<{ id: number; counter: number | null; truth: number }>(
    `SELECT u.id, uuc.reading_list_count AS counter,
       (SELECT COUNT(*) FROM article_user_collections rli
        JOIN articles a ON a.id = rli.article_id
        LEFT JOIN article_read_states ars ON ars.user_id = u.id AND ars.article_id = a.id
        LEFT JOIN feed_read_cursors frc ON frc.user_id = u.id AND frc.feed_id = a.feed_id
        WHERE rli.user_id = u.id AND rli.kind = 'reading_list' AND (${EFFECTIVE_IS_READ}) = 0) AS truth
     FROM users u
     LEFT JOIN user_unread_counts uuc ON uuc.user_id = u.id
     ORDER BY u.id`,
  );
  expect(readingLists.map((row) => [row.id, row.counter])).toEqual(readingLists.map((row) => [row.id, row.truth]));

  const feeds = t.rows<{ id: number; counter: number; truth: number }>(
    `SELECT f.id, f.article_count AS counter,
       (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id) AS truth
     FROM feeds f ORDER BY f.id`,
  );
  expect(feeds.map((row) => [row.id, row.counter])).toEqual(feeds.map((row) => [row.id, row.truth]));
}

function unreadCount(t: TestD1, userId: number, feedId: number): number {
  const [row] = t.rows<{ unread_count: number }>(
    "SELECT unread_count FROM subscription_unread_counts WHERE user_id = ? AND feed_id = ?",
    userId,
    feedId,
  );
  return row!.unread_count;
}

function readingListCount(t: TestD1, userId: number): number {
  const [row] = t.rows<{ reading_list_count: number }>(
    "SELECT reading_list_count FROM user_unread_counts WHERE user_id = ?",
    userId,
  );
  return row!.reading_list_count;
}

function nArticles(n: number) {
  return Array.from({ length: n }, (_, i) => ({ publishedAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
}

describe("derived unread counters", () => {
  let t: TestD1;
  let alice: TestUser;
  let bob: TestUser;
  let feedA: number;
  let feedB: number;

  beforeEach(() => {
    t = createTestD1();
    alice = createUser(t, "alice");
    bob = createUser(t, "bob");
    feedA = createFeed(t, "https://a.example/feed");
    feedB = createFeed(t, "https://b.example/feed");
  });

  it("counts existing articles on subscribe and new articles for every subscriber", async () => {
    addArticles(t, feedA, nArticles(5));
    await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    await createSubscription(t.db, noopJobs, bob.id, feedA, { customTitle: null });
    await createSubscription(t.db, noopJobs, bob.id, feedB, { customTitle: null });
    expect(unreadCount(t, alice.id, feedA)).toBe(5);
    expect(unreadCount(t, bob.id, feedB)).toBe(0);

    addArticles(t, feedA, nArticles(3));
    addArticles(t, feedB, nArticles(2));
    expect(unreadCount(t, alice.id, feedA)).toBe(8);
    expect(unreadCount(t, bob.id, feedA)).toBe(8);
    expect(unreadCount(t, bob.id, feedB)).toBe(2);
    expectCountersMatchSourceOfTruth(t);
  });

  it("does not create a second subscription when one appears concurrently", async () => {
    addArticles(t, feedA, nArticles(2));
    const first = await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    // Skip the existence pre-check, as a request that raced past it would.
    const raced = await t.db.batch([
      t.db.prepare(
        `INSERT INTO subscriptions (user_id, feed_id, sort_order)
         VALUES (?, ?, 0) ON CONFLICT (user_id, feed_id) DO NOTHING RETURNING id`,
      ).bind(alice.id, feedA),
    ]);
    expect(first).not.toBeNull();
    expect(raced[0]!.results).toEqual([]);
    expectCountersMatchSourceOfTruth(t);
  });

  it("tracks single-article read state and reading-list membership", async () => {
    const [a1, a2, a3] = addArticles(t, feedA, nArticles(3));
    await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    const client = createClient(t, alice);

    await client("PATCH", `/articles/${a1}/state`, { isRead: true });
    await client("PATCH", `/articles/${a1}/state`, { isRead: true });
    expect(unreadCount(t, alice.id, feedA)).toBe(2);

    await client("PUT", `/articles/${a2}/reading-list`);
    await client("PUT", `/articles/${a2}/reading-list`);
    expect(readingListCount(t, alice.id)).toBe(1);
    await client("PATCH", `/articles/${a2}/state`, { isRead: true });
    expect(readingListCount(t, alice.id)).toBe(0);
    await client("PATCH", `/articles/${a2}/state`, { isRead: false });
    expect(readingListCount(t, alice.id)).toBe(1);

    // A read article joining or leaving the reading list changes nothing.
    await client("PUT", `/articles/${a1}/reading-list`);
    expect(readingListCount(t, alice.id)).toBe(1);
    await client("DELETE", `/articles/${a2}/reading-list`);
    expect(readingListCount(t, alice.id)).toBe(0);

    await client("PUT", `/articles/${a3}/bookmark`);
    expectCountersMatchSourceOfTruth(t);
  });

  it("counts a change once when two requests apply it concurrently", async () => {
    const [a1] = addArticles(t, feedA, nArticles(2));
    await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    const now = "2026-09-24T00:00:00.000Z";

    // Both requests saw the article as unread and outside the reading list
    // before either wrote, so both send their full batch.
    for (let i = 0; i < 2; i += 1) {
      await t.db.batch([
        readingListMembershipCounterMutation(t.db, alice.id, a1!, true, now),
        collectionMutation(t.db, alice.id, a1!, "reading_list", true, now),
      ]);
    }
    expect(readingListCount(t, alice.id)).toBe(1);

    for (let i = 0; i < 2; i += 1) {
      await t.db.batch([
        ...readStateCounterMutations(t.db, alice.id, a1!, feedA, true, now),
        readStateMutation(t.db, alice.id, a1!, true, now),
      ]);
    }
    expect(unreadCount(t, alice.id, feedA)).toBe(1);
    expect(readingListCount(t, alice.id)).toBe(0);
    expectCountersMatchSourceOfTruth(t);
  });

  it("recounts after marking a subscription read up to an article", async () => {
    const ids = addArticles(t, feedA, nArticles(6));
    const subscriptionId = await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    const client = createClient(t, alice);
    await client("PUT", `/articles/${ids[1]}/reading-list`);
    await client("PUT", `/articles/${ids[5]}/reading-list`);
    // An explicit unread override inside the range becomes read as well.
    await client("PATCH", `/articles/${ids[0]}/state`, { isRead: true });
    await client("PATCH", `/articles/${ids[0]}/state`, { isRead: false });

    const partial = await client<{ data: { unreadCount: number; lastReadArticleId: number } }>(
      "POST",
      `/subscriptions/${subscriptionId}/mark-all-read`,
      { upToArticleId: ids[3] },
    );
    expect(partial.body.data).toMatchObject({ unreadCount: 2, lastReadArticleId: ids[3] });
    expect(readingListCount(t, alice.id)).toBe(1);
    expectCountersMatchSourceOfTruth(t);

    // A stale request never rewinds the cursor.
    await client("POST", `/subscriptions/${subscriptionId}/mark-all-read`, { upToArticleId: ids[1] });
    expect(unreadCount(t, alice.id, feedA)).toBe(2);

    await client("PATCH", `/articles/${ids[2]}/state`, { isRead: false });
    expect(unreadCount(t, alice.id, feedA)).toBe(3);

    const all = await client<{ data: { unreadCount: number } }>("POST", `/subscriptions/${subscriptionId}/mark-all-read`);
    expect(all.body.data.unreadCount).toBe(0);
    expect(readingListCount(t, alice.id)).toBe(0);
    expectCountersMatchSourceOfTruth(t);
  });

  it("resets counters on bulk mark-all-read, optionally limited to a tag", async () => {
    addArticles(t, feedA, nArticles(3));
    const [b1] = addArticles(t, feedB, nArticles(2));
    await createSubscription(t.db, noopJobs, bob.id, feedA, { customTitle: null });
    const subB = await createSubscription(t.db, noopJobs, bob.id, feedB, { customTitle: null });
    const [tag] = t.rows<{ id: number }>(
      "INSERT INTO tags (user_id, name, normalized_name) VALUES (?, 'news', 'news') RETURNING id",
      bob.id,
    );
    t.exec("INSERT INTO subscription_tags (subscription_id, tag_id) VALUES (?, ?)", subB, tag!.id);
    const client = createClient(t, bob);
    await client("PUT", `/articles/${b1}/reading-list`);

    await client("POST", "/articles/mark-all-read", { tagId: tag!.id });
    expect(unreadCount(t, bob.id, feedA)).toBe(3);
    expect(unreadCount(t, bob.id, feedB)).toBe(0);
    expect(readingListCount(t, bob.id)).toBe(0);
    expectCountersMatchSourceOfTruth(t);

    addArticles(t, feedB, nArticles(1));
    await client("POST", "/articles/mark-all-read");
    expect(unreadCount(t, bob.id, feedA)).toBe(0);
    expect(unreadCount(t, bob.id, feedB)).toBe(0);
    expectCountersMatchSourceOfTruth(t);
  });

  it("counts a saved page once and keeps retained reading-list articles after unsubscribe", async () => {
    const [a1] = addArticles(t, feedA, nArticles(2));
    const subscriptionId = await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    const client = createClient(t, alice);

    const saved = await client<{ data: { created: boolean } }>("POST", "/articles/import", { url: "https://example.com/post" });
    expect(saved.status).toBe(201);
    const again = await client<{ data: { created: boolean } }>("POST", "/articles/import", { url: "https://example.com/post" });
    expect(again.status).toBe(200);
    expect(readingListCount(t, alice.id)).toBe(1);
    // Another user saving the same page shares the article but not the count.
    await createClient(t, bob)("POST", "/articles/import", { url: "https://example.com/post" });
    expect(readingListCount(t, bob.id)).toBe(1);
    expectCountersMatchSourceOfTruth(t);

    await client("PUT", `/articles/${a1}/reading-list`);
    await client("DELETE", `/subscriptions/${subscriptionId}`);
    expect(readingListCount(t, alice.id)).toBe(2);
    await client("PATCH", `/articles/${a1}/state`, { isRead: true });
    expect(readingListCount(t, alice.id)).toBe(1);

    addArticles(t, feedA, nArticles(1));
    await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    expect(unreadCount(t, alice.id, feedA)).toBe(2);
    expectCountersMatchSourceOfTruth(t);
  });

  it("rebuilds drifted counters in migration 0019", async () => {
    const ids = addArticles(t, feedA, nArticles(4));
    await createSubscription(t.db, noopJobs, alice.id, feedA, { customTitle: null });
    await createClient(t, alice)("PUT", `/articles/${ids[0]}/reading-list`);
    t.exec("UPDATE subscription_unread_counts SET unread_count = 42");
    t.exec("UPDATE user_unread_counts SET reading_list_count = 9");
    t.exec("UPDATE feeds SET article_count = 0");

    t.sqlite.exec(readFileSync(new URL("../migrations/0019_derived_counter_triggers.sql", import.meta.url), "utf8"));
    expectCountersMatchSourceOfTruth(t);
    addArticles(t, feedA, nArticles(1));
    expect(unreadCount(t, alice.id, feedA)).toBe(5);
  });
});
