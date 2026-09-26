import { describe, expect, it } from "vitest";
import { chooseUnreadQueryStrategy, unreadArticleListSelect } from "../src/routes/articles";

describe("unread article query", () => {
  it("keeps the candidate query when the maintained unread count is zero", () => {
    // The counter only picks a query shape; it never decides that a list is
    // empty, so a stale counter cannot hide an unread article.
    expect(chooseUnreadQueryStrategy({
      unreadCount: 0,
      subscribedArticleCount: 10_205,
      totalArticleCount: 11_466,
    }, 20)).toBe("candidate");
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

  it("derives unread candidates from cursor tails and explicit overrides", () => {
    const query = unreadArticleListSelect(7, "published_at_desc", undefined, 50);

    expect(query.sql).toContain("WITH unread_candidate_ids AS");
    expect(query.sql).toContain("a.id > frc.last_read_article_id");
    expect(query.sql).toContain("SELECT 1 FROM feed_read_cursors frc0");
    expect(query.sql).toContain("ars.is_read = 0");
    expect(query.sql.match(/ORDER BY a\.published_at DESC, a\.id DESC/g)).toHaveLength(1);
    expect(query.binds).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 50]);
  });

  it("applies the pagination cursor inside every candidate branch", () => {
    const ts = "2026-09-20T00:00:00.000Z";
    const query = unreadArticleListSelect(7, "published_at_desc", { ts, id: 123, r: 0 }, 50);

    expect(query.sql.match(/a\.published_at < \?/g)).toHaveLength(3);
    expect(query.binds).toEqual([
      7, 7, 7, ts, ts, 123,
      7, 7, 7, ts, ts, 123,
      7, 7, ts, ts, 123,
      7, 7, 7, 7, 50,
    ]);
  });
});
