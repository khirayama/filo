import { describe, expect, it } from "vitest";
import { unreadCountsForUser } from "../src/lib/readCursor";

function captureUnreadStatement(row: { all_articles: number; reading_list: number }) {
  const captured: { sql?: string; binds?: unknown[] } = {};
  let statement: D1PreparedStatement;
  statement = {
    bind: (...values: unknown[]) => {
      captured.binds = values;
      return statement;
    },
    first: async () => row,
  } as unknown as D1PreparedStatement;
  const db = {
    prepare: (sql: string) => {
      captured.sql = sql;
      return statement;
    },
  } as unknown as D1Database;
  return { captured, db };
}

describe("unread count scopes", () => {
  it("skips the all-articles scan for a reading-list-only request", async () => {
    const { captured, db } = captureUnreadStatement({ all_articles: 0, reading_list: 3 });

    await expect(unreadCountsForUser(db, 7, "reading_list")).resolves.toEqual({
      all_articles: 0,
      reading_list: 3,
    });
    expect(captured.sql).toContain("0 AS all_articles");
    expect(captured.sql).toContain("FROM user_unread_counts");
    expect(captured.sql).not.toContain("FROM articles");
    expect(captured.binds).toEqual([7]);
  });

  it("keeps the legacy both-count query as the default", async () => {
    const { captured, db } = captureUnreadStatement({ all_articles: 12, reading_list: 3 });

    await expect(unreadCountsForUser(db, 7)).resolves.toEqual({
      all_articles: 12,
      reading_list: 3,
    });
    expect(captured.sql).toContain("FROM subscription_unread_counts");
    expect(captured.sql).toContain("FROM user_unread_counts");
    expect(captured.sql).not.toContain("FROM articles");
    expect(captured.binds).toEqual([7, 7]);
  });
});
