import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ArticleListFilters, ArticleListItem } from "../src/api/types.ts";
import { firstUnreadReadingArticle } from "../src/lib/readingStart.ts";

const article = (id: number, isRead: boolean, canonicalUrl: string | null = `https://example.com/${id}`) =>
  ({ id, canonicalUrl, userState: { isRead } }) as ArticleListItem;

test("starts with the first readable unread article across the complete reading list", async () => {
  const requests: ArticleListFilters[] = [];
  const result = await firstUnreadReadingArticle(async (filters) => {
    requests.push(filters);
    return filters.cursor
      ? { articles: [article(3, false)], nextCursor: null }
      : { articles: [article(1, true), article(2, false, null)], nextCursor: "next" };
  });
  assert.equal(result?.id, 3);
  assert.deepEqual(requests, [
    { readingList: true, limit: 100, cursor: undefined },
    { readingList: true, limit: 100, cursor: "next" },
  ]);
});

test("does not start an already-read article when there are no unread articles", async () => {
  const result = await firstUnreadReadingArticle(async () => ({ articles: [article(1, true)], nextCursor: null }));
  assert.equal(result, undefined);
});
