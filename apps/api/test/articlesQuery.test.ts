import { describe, expect, it } from "vitest";
import { chooseUnreadQueryStrategy, unreadArticleListSelect } from "../src/routes/articles";

describe("unread article query", () => {
  it("skips the article scan when the maintained unread count is zero", () => {
    expect(chooseUnreadQueryStrategy({
      unreadCount: 0,
      subscribedArticleCount: 10_205,
      totalArticleCount: 11_466,
    }, 20)).toBe("empty");
  });

  it("uses the global article order for a large backlog with broad coverage", () => {
    expect(chooseUnreadQueryStrategy({
      unreadCount: 10_000,
      subscribedArticleCount: 10_205,
      totalArticleCount: 11_466,
    }, 20)).toBe("global");
  });

  it("keeps the feed candidate scan for sparse subscriptions", () => {
    expect(chooseUnreadQueryStrategy({
      unreadCount: 1_000,
      subscribedArticleCount: 1_000,
      totalArticleCount: 100_000,
    }, 20)).toBe("candidate");
  });

  it("derives unread candidates without scanning the global article order", () => {
    const query = unreadArticleListSelect(7, "published_at_desc", undefined, 50);

    expect(query.sql).toContain("WITH unread_candidate_ids AS");
    expect(query.sql).toContain("FROM subscriptions s");
    expect(query.sql).toContain("a.id > COALESCE(frc.last_read_article_id, 0)");
    expect(query.sql).toContain("NOT EXISTS");
    expect(query.sql).toContain("FROM article_read_states ars");
    expect(query.sql).toContain("ars.is_read = 0");
    expect(query.sql.match(/ORDER BY a\.published_at DESC, a\.id DESC/g)).toHaveLength(1);
    expect(query.binds).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 7, 50]);
  });

  it("applies the pagination cursor inside both candidate branches", () => {
    const query = unreadArticleListSelect(
      7,
      "published_at_desc",
      { ts: "2026-09-20T00:00:00.000Z", id: 123, r: 0 },
      50,
    );

    expect(query.sql.match(/a\.published_at < \?/g)).toHaveLength(2);
    expect(query.sql.match(/a\.published_at = \?/g)).toHaveLength(2);
    expect(query.sql.match(/a\.id < \?/g)).toHaveLength(2);
    expect(query.binds).toEqual([
      7, 7, 7, "2026-09-20T00:00:00.000Z", "2026-09-20T00:00:00.000Z", 123,
      7, 7, "2026-09-20T00:00:00.000Z", "2026-09-20T00:00:00.000Z", 123,
      7, 7, 7, 7, 50,
    ]);
  });

  it("uses the feed/id range index for subscribed feeds that have a cursor", () => {
    const query = unreadArticleListSelect(
      7,
      "published_at_desc",
      undefined,
      50,
      [
        { feed_id: 11, last_read_article_id: 100 },
        { feed_id: 12, last_read_article_id: 200 },
      ],
    );

    expect(query.sql).toContain("JOIN feed_read_cursors frc");
    expect(query.sql).toContain("a.id > frc.last_read_article_id");
    expect(query.sql).not.toContain("a.id > COALESCE(frc.last_read_article_id, 0)");
  });

  it("isolates subscriptions without a cursor to the fallback branch", () => {
    const query = unreadArticleListSelect(
      7,
      "published_at_desc",
      undefined,
      50,
      [
        { feed_id: 11, last_read_article_id: 100 },
        { feed_id: 12, last_read_article_id: null },
      ],
    );

    expect(query.sql).toContain("a.id > frc.last_read_article_id");
    expect(query.sql).toContain("frc.feed_id IS NULL");
    expect(query.sql).not.toContain("a.id > COALESCE(frc.last_read_article_id, 0)");
    expect(query.binds).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 50]);
  });
});
