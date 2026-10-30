import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { ArticleListItem } from "../src/api/types.ts";
import { restoreArticleReadStates } from "../src/lib/articleReadState.ts";

const article = (id: number, isRead = false, isBookmarked = false) =>
  ({ id, userState: { isRead, inReadingList: false, isBookmarked } }) as ArticleListItem;

test("failed bulk read restores hidden rows in order without another request", () => {
  const previous = [article(1), article(2), article(3)];
  assert.deepEqual(restoreArticleReadStates([], previous), previous);
  assert.deepEqual(restoreArticleReadStates([article(2, true)], previous), previous);
});

test("rollback preserves bookmark edits, new rows, and previous read flags", () => {
  const previous = [article(1), article(2, true)];
  const current = [article(1, true, true), article(2, true), article(3)];
  const restored = restoreArticleReadStates(current, previous);
  assert.deepEqual(restored, [article(1, false, true), article(2, true), article(3)]);
  assert.equal(current[0].userState.isRead, true);
  assert.equal(previous[0].userState.isBookmarked, false);
});

test("rollback does not restore rows removed by a separate list operation", () => {
  assert.deepEqual(restoreArticleReadStates([article(2, true)], [article(1), article(2)], false), [article(2)]);
});
