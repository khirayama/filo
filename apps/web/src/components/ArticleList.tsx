import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../api/client";
import type { ArticleListFilters, ArticleListItem } from "../api/types";
import { errorMessage } from "../lib/messages";
import { articleItem, trackEvent } from "../lib/analytics";
import { useIsDesktop } from "./AppShell";
import { useAppData } from "./AppDataContext";
import { useTitleTranslation } from "./TitleTranslationContext";
import { ErrorBox, Icon, IconButton, Spinner, formatTimeCompact, palette } from "./ui";

type ArticleStateMutation =
  | { isRead: boolean }
  | { inReadingList: boolean }
  | { isBookmarked: boolean };

export function useArticleList(api: ApiClient, filters: ArticleListFilters) {
  const { language, adjustUnreadCounts } = useAppData();
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtersKey = JSON.stringify(filters);
  const generation = useRef(0);
  const viewIdentity = useRef({ api, filtersKey });
  viewIdentity.current = { api, filtersKey };

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    try {
      const parsed = JSON.parse(filtersKey) as ArticleListFilters;
      const result = await api.listArticles(parsed);
      if (generation.current !== gen) return;
      setArticles(result.articles);
      setNextCursor(result.nextCursor);
    } catch (e) {
      if (generation.current !== gen) return;
      setError(errorMessage(e, language));
    } finally {
      if (generation.current === gen) setLoading(false);
    }
  }, [api, filtersKey, language]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    try {
      const parsed = JSON.parse(filtersKey) as ArticleListFilters;
      const result = await api.listArticles({ ...parsed, cursor: nextCursor });
      if (generation.current !== gen) return;
      setArticles((prev) => [...prev, ...result.articles]);
      setNextCursor(result.nextCursor);
    } catch (e) {
      if (generation.current !== gen) return;
      setError(errorMessage(e, language));
    } finally {
      if (generation.current === gen) setLoadingMore(false);
    }
  }, [api, filtersKey, language, nextCursor, loadingMore]);

  const updateState = useCallback(
    async (articleId: number, patch: ArticleStateMutation) => {
      try {
        const article = articles.find((candidate) => candidate.id === articleId);
        const state = "isRead" in patch
          ? await api.setArticleRead(articleId, patch.isRead)
        : "inReadingList" in patch
          ? await api.setReadingListMembership(articleId, patch.inReadingList)
          : await api.setBookmarkMembership(articleId, patch.isBookmarked);
        if (article) {
          const item = articleItem(article);
          if ("isRead" in patch) {
            trackEvent(patch.isRead ? "mark_article_read" : "mark_article_unread", { article_id: String(article.id) });
          } else if ("inReadingList" in patch) {
            trackEvent(patch.inReadingList ? "add_to_reading_list" : "remove_from_reading_list", { article_id: String(article.id) });
          } else {
            trackEvent(patch.isBookmarked ? "add_to_wishlist" : "remove_from_wishlist", { items: [item] });
          }
        }
        if (article) {
          const wasUnread = !article.userState.isRead;
          const isUnread = !state.isRead;
          const wasUnreadInReadingList = wasUnread && article.userState.inReadingList;
          const isUnreadInReadingList = isUnread && state.inReadingList;
          const isSubscribed = article.subscriptionContext.subscriptionIds.length > 0;
          adjustUnreadCounts({
            allArticles: isSubscribed ? Number(isUnread) - Number(wasUnread) : 0,
            readingList: Number(isUnreadInReadingList) - Number(wasUnreadInReadingList),
          });
        }
        // Same-filter reloads may race with this write and read the old server
        // state, so still apply the mutation response after those reloads.
        // Only discard it when the API/user or visible filters have changed.
        if (viewIdentity.current.api !== api || viewIdentity.current.filtersKey !== filtersKey) return;
        const currentFilters = JSON.parse(filtersKey) as ArticleListFilters;
        setArticles((prev) =>
          prev.flatMap((a) => {
            if (a.id !== articleId) return [a];
            const remainsInList =
              (currentFilters.bookmarked === undefined || state.isBookmarked === currentFilters.bookmarked) &&
              (currentFilters.readingList === undefined || state.inReadingList === currentFilters.readingList) &&
              (currentFilters.read === undefined || state.isRead === currentFilters.read);
            return remainsInList ? [{ ...a, userState: state }] : [];
          }),
        );
      } catch (e) {
        if (viewIdentity.current.api === api && viewIdentity.current.filtersKey === filtersKey) {
          setError(errorMessage(e, language));
        }
      }
    },
    [api, articles, filtersKey, language, adjustUnreadCounts],
  );

  return { articles, nextCursor, loading, loadingMore, error, reload: load, loadMore, updateState };
}

export function ArticleRows({
  articles,
  loading,
  loadingMore,
  error,
  nextCursor,
  onRetry,
  onLoadMore,
  onUpdateState,
  activeArticleId,
  emptyContent,
  showFeed = true,
}: {
  articles: ArticleListItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  onUpdateState?: (articleId: number, patch: ArticleStateMutation) => void;
  activeArticleId?: number;
  emptyContent: React.ReactNode;
  // Off inside a single subscription, where every row has the same feed.
  showFeed?: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const viewedArticleIds = useRef("");
  const { t } = useAppData();
  const { enabled: translationEnabled, request: requestTranslations } = useTitleTranslation();

  useEffect(() => {
    if (loading || articles.length === 0) return;
    const articleIds = articles.map((article) => article.id).join(",");
    if (viewedArticleIds.current === articleIds) return;
    viewedArticleIds.current = articleIds;
    trackEvent("view_item_list", {
      item_list_name: "articles",
      items: articles.slice(0, 100).map(articleItem),
    });
  }, [articles, loading]);

  // 翻訳トグルが ON の間は、表示された記事(スクロールで増えた分も含む)を翻訳対象にする
  useEffect(() => {
    if (!translationEnabled || articles.length === 0) return;
    requestTranslations(
      articles.map((article) => ({
        id: article.id,
        title: article.title,
        sourceLanguage: article.sourceLanguage,
      })),
    );
  }, [articles, translationEnabled, requestTranslations]);

  // Feedly-style infinite scroll: load the next page as the end of the list nears.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [nextCursor, onLoadMore]);

  if (loading) return <Spinner />;
  if (error) return <div style={{ padding: "16px var(--fl-page-gutter)" }}><ErrorBox message={error} onRetry={onRetry} /></div>;
  if (articles.length === 0) return <>{emptyContent}</>;
  return (
    <>
      <ul aria-label={t("記事一覧")} className="fl-article-list">
        {articles.map((article) => (
          <ArticleRow key={article.id} article={article} onUpdateState={onUpdateState} active={article.id === activeArticleId} showFeed={showFeed} />
        ))}
      </ul>
      <div ref={sentinelRef} aria-hidden="true" />
      {loadingMore ? <Spinner /> : null}
    </>
  );
}

function ArticleRow({
  article,
  onUpdateState,
  active = false,
  showFeed,
}: {
  article: ArticleListItem;
  onUpdateState?: (articleId: number, patch: ArticleStateMutation) => void;
  active?: boolean;
  showFeed: boolean;
}) {
  const isDesktop = useIsDesktop();
  const { t, language } = useAppData();
  const [showOriginal, setShowOriginal] = useState(false);
  const { isRead, inReadingList, isBookmarked } = article.userState;
  const translatedTitle = useTitleTranslation().titleFor(article.id);
  const isTranslated = translatedTitle != null;
  const displayTitle = showOriginal || !isTranslated ? article.title : translatedTitle;
  const subscriptionId = article.subscriptionContext.subscriptionIds[0];

  const titleEl = article.canonicalUrl ? (
    <a
      href={article.canonicalUrl}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent("select_item", { items: [articleItem(article)] })}
      className="fl-article-title"
    >
      {displayTitle}
    </a>
  ) : (
    <span className="fl-article-title">{displayTitle}</span>
  );

  const feedContent = <span>{article.feed.title}</span>;
  const feedEl = subscriptionId != null ? (
    <Link to={`/subscriptions/${subscriptionId}`} className="fl-article-feed">{feedContent}</Link>
  ) : (
    <span className="fl-article-feed">{feedContent}</span>
  );

  const translationToggle = isTranslated ? (
    <button
      type="button"
      aria-pressed={showOriginal}
      aria-label={showOriginal ? t("翻訳") : t("原文")}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setShowOriginal((v) => !v);
      }}
      className="fl-translation-toggle"
    >
      {showOriginal ? t("翻訳") : t("原文")}
    </button>
  ) : null;

  const articleDate = article.publishedAt ?? article.fetchedAt;
  const dateEl = (
    <time dateTime={articleDate ?? undefined} className="fl-article-date">
      {formatTimeCompact(articleDate, language)}
    </time>
  );

  // Saved states stay visible as small marks; the full toggle set appears on
  // hover (desktop) or is always present (touch).
  const marks = isDesktop && (inReadingList || isBookmarked) ? (
    <span className="fl-article-marks">
      {inReadingList ? <span title={t("リーディングリスト")} style={{ color: palette.accent }}><Icon name="playlist" size={14} /></span> : null}
      {isBookmarked ? <span title={t("ブックマーク")} style={{ color: palette.star }}><Icon name="bookmark" size={14} filled /></span> : null}
    </span>
  ) : null;

  const actions = onUpdateState ? (
    <div className="fl-article-actions">
      <IconButton
        icon="checkCircle"
        label={isRead ? t("未読にする") : t("既読にする")}
        color={isRead ? palette.accent : undefined}
        filled={false}
        onClick={() => onUpdateState(article.id, { isRead: !isRead })}
      />
      <IconButton
        icon="queueAdd"
        label={inReadingList ? t("リーディングリストから削除") : t("リーディングリストに追加")}
        active={inReadingList}
        color={inReadingList ? palette.accent : undefined}
        onClick={() => onUpdateState(article.id, { inReadingList: !inReadingList })}
      />
      <IconButton
        icon="bookmark"
        label={isBookmarked ? t("ブックマークを解除") : t("ブックマーク")}
        active={isBookmarked}
        color={isBookmarked ? palette.star : undefined}
        onClick={() => onUpdateState(article.id, { isBookmarked: !isBookmarked })}
      />
    </div>
  ) : null;

  if (isDesktop) {
    return (
      <li
        id={`filo-article-${article.id}`}
        className="fl-article-row fl-article-row--desktop"
        data-read={isRead}
        data-active={active}
      >
        {showFeed ? feedEl : null}
        <div className="fl-article-main">
          {translationToggle}
          {titleEl}
          {article.previewText ? <span className="fl-article-preview">{article.previewText}</span> : null}
        </div>
        <div className="fl-article-meta">
          {marks}
          {dateEl}
        </div>
        {actions}
      </li>
    );
  }

  return (
    <li
      id={`filo-article-${article.id}`}
      className="fl-article-row fl-article-row--mobile"
      data-read={isRead}
      data-active={active}
    >
      <div className="fl-article-head">
        {showFeed ? feedEl : null}
        {translationToggle}
        <span style={{ flex: 1 }} />
        {dateEl}
        {actions}
      </div>
      {titleEl}
    </li>
  );
}
