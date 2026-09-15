import { describe, expect, it } from "vitest";
import { initializeSubscriptionUnreadCount, unreadCountsForUser } from "../src/lib/readCursor";

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

function captureInitializationStatement(row: { unread_count: number }) {
  const captured: { sqls: string[]; bindsList: unknown[][] } = { sqls: [], bindsList: [] };
  let statement: D1PreparedStatement;
  statement = {
    bind: (...values: unknown[]) => {
      captured.bindsList.push(values);
      return statement;
    },
    first: async () => row,
    run: async () => ({}) as D1Result,
  } as unknown as D1PreparedStatement;
  const db = {
    prepare: (sql: string) => {
      captured.sqls.push(sql);
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

  it("recomputes a feed from sparse overrides and the cursor tail", async () => {
    const { captured, db } = captureInitializationStatement({ unread_count: 4 });

    await expect(initializeSubscriptionUnreadCount(db, 11, 7, 3, "2026-07-21T10:00:00Z"))
      .resolves.toBe(4);
    expect(captured.sqls[0]).toContain("ars.is_read = 0");
    expect(captured.sqls[0]).toContain("a.id > COALESCE(frc.last_read_article_id, 0)");
    expect(captured.sqls[0]).toContain("NOT EXISTS");
    expect(captured.bindsList[0]).toEqual([7, 3, 7, 3, 3, 7]);
  });
});
