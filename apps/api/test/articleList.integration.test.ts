import { beforeEach, describe, expect, it } from "vitest";
import { EFFECTIVE_IS_READ } from "../src/lib/readCursor";
import { createSubscription } from "../src/lib/subscriptions";
import { chooseUnreadQueryStrategy, type UnreadQueryStrategy } from "../src/routes/articles";
import { addArticles, createClient, createFeed, createUser, noopJobs, type TestUser } from "./support/app";
import { createTestD1, type TestD1 } from "./support/d1";

interface ExpectedRow {
  id: number;
  published_at: string | null;
  fetched_at: string;
  is_read: number;
  feed_id: number;
  in_reading_list: number;
}

type Sort = "published_at_desc" | "fetched_at_desc";
type ReadOrder = "unread_first" | "read_first" | "none";

// Brute-force reference: every candidate row with its effective state,
// ordered in JavaScript exactly as the API documents it.
function expectedIds(
  t: TestD1,
  userId: number,
  options: { sort: Sort; readOrder: ReadOrder; read?: boolean; where: string; params: unknown[] },
): number[] {
  const rows = t.rows<ExpectedRow>(
    `SELECT a.id, a.published_at, a.fetched_at, a.feed_id, (${EFFECTIVE_IS_READ}) AS is_read,
       CASE WHEN rli.user_id IS NULL THEN 0 ELSE 1 END AS in_reading_list
     FROM articles a
     LEFT JOIN article_read_states ars ON ars.user_id = ? AND ars.article_id = a.id
     LEFT JOIN feed_read_cursors frc ON frc.user_id = ? AND frc.feed_id = a.feed_id
     LEFT JOIN article_user_collections rli
       ON rli.user_id = ? AND rli.article_id = a.id AND rli.kind = 'reading_list'
     WHERE ${options.where}`,
    userId,
    userId,
    userId,
    ...options.params,
  );
  const dateKey = (row: ExpectedRow) => (options.sort === "fetched_at_desc" ? row.fetched_at : row.published_at);
  const compareDate = (x: ExpectedRow, y: ExpectedRow) => {
    const a = dateKey(x);
    const b = dateKey(y);
    if (a !== b) {
      if (a === null) return 1;
      if (b === null) return -1;
      return a < b ? 1 : -1;
    }
    return y.id - x.id;
  };
  return rows
    .filter((row) => options.read === undefined || row.is_read === (options.read ? 1 : 0))
    .sort((x, y) => {
      if (options.read === undefined && options.readOrder !== "none" && x.is_read !== y.is_read) {
        return options.readOrder === "unread_first" ? x.is_read - y.is_read : y.is_read - x.is_read;
      }
      return compareDate(x, y);
    })
    .map((row) => row.id);
}

async function listAllPages(client: ReturnType<typeof createClient>, query: string): Promise<number[]> {
  const ids: number[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const path: string = `/articles?${query}&limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await client<{ data: Array<{ id: number }>; meta: { nextCursor: string | null } }>("GET", path);
    expect(response.status).toBe(200);
    ids.push(...response.body.data.map((row) => row.id));
    cursor = response.body.meta.nextCursor;
    if (!cursor) return ids;
  }
  throw new Error("pagination did not end");
}

function strategyFor(t: TestD1, userId: number): UnreadQueryStrategy {
  const [stats] = t.rows<{ unread: number; subscribed: number; total: number }>(
    `SELECT
       (SELECT SUM(unread_count) FROM subscription_unread_counts WHERE user_id = ?) AS unread,
       (SELECT SUM(f.article_count) FROM feeds f JOIN subscriptions s ON s.feed_id = f.id WHERE s.user_id = ?) AS subscribed,
       (SELECT MAX(id) FROM articles) AS total`,
    userId,
    userId,
  );
  return chooseUnreadQueryStrategy({
    unreadCount: stats!.unread,
    subscribedArticleCount: stats!.subscribed,
    totalArticleCount: stats!.total,
  }, 3);
}

const SORTS: Sort[] = ["published_at_desc", "fetched_at_desc"];
const READ_ORDERS: ReadOrder[] = ["unread_first", "read_first", "none"];
const READ_FILTERS: Array<boolean | undefined> = [undefined, true, false];

describe("article list", () => {
  let t: TestD1;
  let user: TestUser;
  let feeds: number[];
  let subscriptionIds: number[];

  beforeEach(async () => {
    t = createTestD1();
    user = createUser(t, "reader");
    feeds = [createFeed(t, "https://one.example/feed"), createFeed(t, "https://two.example/feed"), createFeed(t, "https://three.example/feed")];
    subscriptionIds = [];

    // Shared timestamps and missing dates exercise the id tie-break and the
    // null tail of published_at ordering across page boundaries.
    for (const [index, feedId] of feeds.entries()) {
      addArticles(t, feedId, Array.from({ length: 9 }, (_, i) => ({
        publishedAt: i % 4 === 3 ? null : `2026-09-${String(10 + (i % 3)).padStart(2, "0")}T0${index}:00:00.000Z`,
        fetchedAt: `2026-09-2${i % 2}T00:00:00.000Z`,
      })));
      subscriptionIds.push((await createSubscription(t.db, noopJobs, user.id, feedId, { customTitle: null }))!);
    }

    const client = createClient(t, user);
    const [feedOneIds] = [t.rows<{ id: number }>("SELECT id FROM articles WHERE feed_id = ? ORDER BY id", feeds[0]).map((r) => r.id)];
    // Cursor-read prefix with an explicit unread override inside it, an
    // explicit read outside it, and reading-list / bookmark memberships.
    await client("POST", `/subscriptions/${subscriptionIds[0]}/mark-all-read`, { upToArticleId: feedOneIds[4] });
    await client("PATCH", `/articles/${feedOneIds[1]}/state`, { isRead: false });
    await client("PATCH", `/articles/${feedOneIds[7]}/state`, { isRead: true });
    const [feedTwoFirst] = t.rows<{ id: number }>("SELECT MIN(id) AS id FROM articles WHERE feed_id = ?", feeds[1]);
    await client("PATCH", `/articles/${feedTwoFirst!.id}/state`, { isRead: true });
    await client("PUT", `/articles/${feedOneIds[2]}/reading-list`);
    await client("PUT", `/articles/${feedOneIds[6]}/reading-list`);
    await client("PUT", `/articles/${feedOneIds[3]}/bookmark`);
  });

  async function expectEveryOrderingMatches(where: string, params: unknown[], extraQuery = "") {
    const client = createClient(t, user);
    for (const sort of SORTS) {
      for (const readOrder of READ_ORDERS) {
        for (const read of READ_FILTERS) {
          const query = `sort=${sort}&readOrder=${readOrder}${read === undefined ? "" : `&read=${read}`}${extraQuery}`;
          const expected = expectedIds(t, user.id, { sort, readOrder, read, where, params });
          expect(await listAllPages(client, query), query).toEqual(expected);
        }
      }
    }
  }

  const SUBSCRIBED = "EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id = a.feed_id AND s.user_id = ?)";

  it("pages the subscribed list correctly with the global unread query", async () => {
    expect(strategyFor(t, user.id)).toBe("global");
    await expectEveryOrderingMatches(SUBSCRIBED, [user.id]);
  });

  it("pages the subscribed list correctly with the candidate unread query", async () => {
    // A large unsubscribed corpus makes the user's subscriptions sparse.
    const other = createFeed(t, "https://other.example/feed");
    addArticles(t, other, Array.from({ length: 200 }, () => ({ publishedAt: "2026-09-15T00:00:00.000Z" })));
    expect(strategyFor(t, user.id)).toBe("candidate");
    await expectEveryOrderingMatches(SUBSCRIBED, [user.id]);
  });

  it("returns an empty unread page once everything is read", async () => {
    await createClient(t, user)("POST", "/articles/mark-all-read");
    await expectEveryOrderingMatches(SUBSCRIBED, [user.id]);
  });

  it("pages a single subscription and the reading list including retained articles", async () => {
    await expectEveryOrderingMatches("a.feed_id = ?", [feeds[1]], `&subscriptionId=${subscriptionIds[1]}`);

    await createClient(t, user)("DELETE", `/subscriptions/${subscriptionIds[0]}`);
    const client = createClient(t, user);
    const readingList = await listAllPages(client, "readingList=true&readOrder=none&sort=published_at_desc");
    expect(readingList).toEqual(expectedIds(t, user.id, {
      sort: "published_at_desc",
      readOrder: "none",
      where: "EXISTS (SELECT 1 FROM article_user_collections c WHERE c.user_id = ? AND c.article_id = a.id AND c.kind = 'reading_list')",
      params: [user.id],
    }));
    expect(readingList).toHaveLength(2);
  });
});
