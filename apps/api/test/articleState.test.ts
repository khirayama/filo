import { describe, expect, it } from "vitest";
import { collectionMutation, readStateMutation } from "../src/lib/articleState";
import { serializeUserState } from "../src/lib/serialize";

function captureStatement() {
  const captured: { sql?: string; binds?: unknown[] } = {};
  let statement: D1PreparedStatement;
  statement = {
    bind: (...values: unknown[]) => {
      captured.binds = values;
      return statement;
    },
  } as unknown as D1PreparedStatement;
  const db = {
    prepare: (sql: string) => {
      captured.sql = sql;
      return statement;
    },
  } as unknown as D1Database;
  return { captured, db };
}

describe("article user state", () => {
  it("serializes the article state", () => {
    const state = serializeUserState({
      is_read: 1,
      is_bookmarked: 0,
    });

    expect(state).toEqual({
      isRead: true,
      isBookmarked: false,
    });
  });

  it("returns false collection membership when no rows exist", () => {
    expect(serializeUserState(null)).toEqual({
      isRead: false,
      isBookmarked: false,
    });
  });

  it("writes read overrides only to article_read_states", () => {
    const { captured, db } = captureStatement();
    readStateMutation(db, 4, 9, true, "2026-07-21T10:00:00Z");

    expect(captured.sql).toContain("INSERT INTO article_read_states");
    expect(captured.sql).not.toContain("article_user_states");
    expect(captured.binds).toEqual([4, 9, 1, "2026-07-21T10:00:00Z", "2026-07-21T10:00:00Z"]);
  });

  it("writes one canonical collection membership", () => {
    const { captured, db } = captureStatement();
    collectionMutation(db, 4, 9, "bookmark", true, "2026-07-21T10:00:00Z");

    expect(captured.sql).toContain("INSERT INTO article_user_collections");
    expect(captured.sql).not.toContain("article_user_states");
    expect(captured.binds).toEqual([4, 9, "bookmark", "2026-07-21T10:00:00Z", "2026-07-21T10:00:00Z"]);
  });

  it("deletes bookmark membership", () => {
    const { captured, db } = captureStatement();
    collectionMutation(db, 4, 9, "bookmark", false, "2026-07-21T10:00:00Z");

    expect(captured.sql).toContain("DELETE FROM article_user_collections");
    expect(captured.binds).toEqual([4, 9, "bookmark"]);
  });
});
