import { useSearchParams } from "react-router-dom";
import type { ArticleReadOrder, ArticleSortOrder } from "../api/types";

// Article list view parameters live in the URL so that reload / back / share
// keep the same view on every list screen.
export function useArticleFilterParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tagIdParam = searchParams.get("tagId");
  const tagId = tagIdParam && /^\d+$/.test(tagIdParam) ? Number(tagIdParam) : undefined;
  const bookmarkedOnly = searchParams.get("bookmarked") === "1";
  const readingListOnly = searchParams.get("readingList") === "1";
  const readParam = searchParams.get("read");
  const read = readParam === "1" ? true : readParam === "0" ? false : undefined;
  const sortParam = searchParams.get("sort");
  const sort: ArticleSortOrder | undefined =
    sortParam === "published_at_desc" || sortParam === "fetched_at_desc" ? sortParam : undefined;
  const readOrderParam = searchParams.get("readOrder");
  const readOrder: ArticleReadOrder | undefined =
    readOrderParam === "unread_first" || readOrderParam === "read_first" || readOrderParam === "none" ? readOrderParam : undefined;

  const setSort = (value: ArticleSortOrder | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined) next.delete("sort");
    else next.set("sort", value);
    setSearchParams(next);
  };

  const setReadOrder = (value: ArticleReadOrder | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined) next.delete("readOrder");
    else next.set("readOrder", value);
    setSearchParams(next);
  };

  const setRead = (value: boolean | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined) next.delete("read");
    else next.set("read", value ? "1" : "0");
    setSearchParams(next);
  };

  const clearTag = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("tagId");
    setSearchParams(next);
  };

  return { tagId, bookmarkedOnly, readingListOnly, read, sort, readOrder, setRead, setSort, setReadOrder, clearTag };
}
