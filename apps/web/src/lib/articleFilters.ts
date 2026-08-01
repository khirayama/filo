import { useSearchParams } from "react-router-dom";
import type { ArticleSortOrder } from "../api/types";

// Article list view parameters live in the URL so that reload / back / share
// keep the same view on every list screen.
export function useArticleFilterParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tagIdParam = searchParams.get("tagId");
  const tagId = tagIdParam && /^\d+$/.test(tagIdParam) ? Number(tagIdParam) : undefined;
  const bookmarkedOnly = searchParams.get("bookmarked") === "1";
  const readingListOnly = searchParams.get("readingList") === "1";
  const sortParam = searchParams.get("sort");
  const sort: ArticleSortOrder | undefined =
    sortParam === "published_at_desc" || sortParam === "fetched_at_desc" ? sortParam : undefined;

  const setSort = (value: ArticleSortOrder | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined) next.delete("sort");
    else next.set("sort", value);
    setSearchParams(next);
  };

  const clearTag = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("tagId");
    setSearchParams(next);
  };

  return { tagId, bookmarkedOnly, readingListOnly, sort, setSort, clearTag };
}
