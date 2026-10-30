import { strict as assert } from "node:assert";
import { test } from "node:test";
import { articleUrlKey, completedPageArticleId, currentSessionItem, saveSessionPage, sessionPageItem } from "../src/reader.ts";

const temporary = { articleId: 0, title: "Page", url: "https://example.com/page", feedTitle: "", isRead: false };
const other = { articleId: 9, title: "Other", url: "https://example.com/other", feedTitle: "", isRead: true };
const state = { session: { tabId: 1, items: [temporary, other], index: 0 }, playback: null, error: null };
const saved = { type: "savedPage", tabId: 1, pageUrl: temporary.url, articleId: 42, title: "Saved", url: temporary.url };

test("saving updates the current page without changing the session or browser URL", () => {
  const updated = saveSessionPage(state, saved);
  assert.equal(currentSessionItem(updated.session).articleId, 42);
  assert.equal(currentSessionItem(updated.session).url, temporary.url);
  assert.equal(updated.session.items[1], other);
  assert.equal(currentSessionItem(state.session).articleId, 0);
});

test("saving a different tab does not change the session", () => {
  assert.equal(saveSessionPage(state, { ...saved, tabId: 2 }), state);
});

test("saving a linked page preserves the session item and tracks that page separately", () => {
  const updated = saveSessionPage(state, { ...saved, pageUrl: "https://example.com/linked" });
  assert.equal(currentSessionItem(updated.session), temporary);
  assert.equal(sessionPageItem(updated.session, "https://example.com/linked#section").articleId, 42);
  assert.equal(sessionPageItem(updated.session, "https://example.com/unrelated"), null);
});

test("completion marks a page saved during playback but never a selection or different page", () => {
  const current = currentSessionItem(saveSessionPage(state, saved).session);
  assert.equal(completedPageArticleId("page", temporary, current), 42);
  assert.equal(completedPageArticleId("selection", temporary, current), null);
  assert.equal(completedPageArticleId("page", temporary, other), null);
  assert.equal(completedPageArticleId("page", other, other), null);
  assert.equal(completedPageArticleId("page", null, null, 42), 42);
  assert.equal(completedPageArticleId("selection", null, null, 42), null);
});

test("a redirected session page and an unrelated page have distinct identities", () => {
  const session = { ...state.session, pageUrl: "https://example.com/redirected", pageArticles: { "https://example.com/redirected": 9 }, items: [other] };
  assert.equal(sessionPageItem(session, "https://example.com/redirected#section").articleId, 9);
  assert.equal(sessionPageItem(session, "https://example.com/linked"), null);
});

test("saved article matching follows API URL normalization without discarding meaningful parameters", () => {
  assert.equal(articleUrlKey("http://EXAMPLE.com/story/?utm_source=x&view=full#top"), "https://example.com/story?view=full");
  assert.notEqual(articleUrlKey("https://example.com/story?view=full"), articleUrlKey("https://example.com/story?view=short"));
  assert.equal(articleUrlKey("not a URL"), null);
});
