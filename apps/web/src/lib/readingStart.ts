import type { ArticleListFilters, ArticleListItem } from "../api/types";
import { safeHttpUrl } from "./url.ts";

export async function firstUnreadReadingArticle(
  listArticles: (filters: ArticleListFilters) => Promise<{ articles: ArticleListItem[]; nextCursor: string | null }>,
): Promise<ArticleListItem | undefined> {
  let cursor: string | undefined;
  do {
    const page = await listArticles({ readingList: true, limit: 100, cursor });
    const article = page.articles.find((item) => !item.userState.isRead && safeHttpUrl(item.canonicalUrl) != null);
    if (article) return article;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return undefined;
}
