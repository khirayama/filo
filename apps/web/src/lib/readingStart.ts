import type { ArticleListFilters, ArticleListItem } from "../api/types";

export async function firstUnreadReadingArticle(
  listArticles: (filters: ArticleListFilters) => Promise<{ articles: ArticleListItem[]; nextCursor: string | null }>,
): Promise<ArticleListItem | undefined> {
  let cursor: string | undefined;
  do {
    const page = await listArticles({ readingList: true, limit: 100, cursor });
    const article = page.articles.find((item) => !item.userState.isRead && !!item.canonicalUrl);
    if (article) return article;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return undefined;
}
