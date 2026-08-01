import { describe, expect, it } from "vitest";
import { firstUnreadArticleId } from "../src/routes/playbackQueue";

describe("reading session start", () => {
  it("starts at the first unread article in added order", () => {
    expect(firstUnreadArticleId([
      { article_id: 3, is_read: 1 },
      { article_id: 8, is_read: 0 },
      { article_id: 9, is_read: 0 },
    ])).toBe(8);
  });

  it("has no current article when every item is read", () => {
    expect(firstUnreadArticleId([{ article_id: 3, is_read: 1 }])).toBeNull();
  });
});
