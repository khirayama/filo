import { describe, expect, it } from "vitest";
import { unreadArticleListSelect } from "../src/routes/articles";

describe("unread article query", () => {
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
});
