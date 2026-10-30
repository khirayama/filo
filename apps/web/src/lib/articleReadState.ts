import type { ArticleListItem } from "../api/types";

// Restore read flags and hidden rows without reverting other row edits.
export function restoreArticleReadStates(current: ArticleListItem[], previous: ArticleListItem[], restoreHidden = true): ArticleListItem[] {
  const states = new Map(previous.map((article) => [article.id, article.userState.isRead]));
  const restored = current.map((article) => states.has(article.id)
    ? { ...article, userState: { ...article.userState, isRead: states.get(article.id)! } }
    : article);
  if (!restoreHidden) return restored;
  const ids = new Set(restored.map((article) => article.id));
  previous.forEach((article, index) => {
    if (!ids.has(article.id)) {
      restored.splice(Math.min(index, restored.length), 0, article);
      ids.add(article.id);
    }
  });
  return restored;
}
