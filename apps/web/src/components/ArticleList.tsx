import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ApiClient } from "../api/client";
import type { ArticleListFilters, ArticleListItem } from "../api/types";
import { errorMessage } from "../lib/messages";
import { articleItem, trackEvent } from "../lib/analytics";
import { useIsDesktop } from "./AppShell";
import { useAppData } from "./AppDataContext";
import { useTitleTranslation } from "./TitleTranslationContext";

type ArticleStateMutation =
  | { isRead: boolean }
  | { inReadingList: boolean }
  | { isBookmarked: boolean };
import { ErrorBox, IconButton, Spinner, formatTimeCompact, palette } from "./ui";

export function useArticleList(api: ApiClient, filters: ArticleListFilters) {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtersKey = JSON.stringify(filters);
  const generation = useRef(0);

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
      setError(errorMessage(e));
    } finally {
      if (generation.current === gen) setLoading(false);
    }
  }, [api, filtersKey]);

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
      setError(errorMessage(e));
    } finally {
      if (generation.current === gen) setLoadingMore(false);
    }
  }, [api, filtersKey, nextCursor, loadingMore]);

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
        setError(errorMessage(e));
      }
    },
    [api, articles, filtersKey],
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
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const viewedArticleIds = useRef("");
  const isDesktop = useIsDesktop();
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
  if (error) return <ErrorBox message={error} onRetry={onRetry} />;
  if (articles.length === 0) return <>{emptyContent}</>;
  return (
    <>
      <ul style={{ listStyle: "none", margin: isDesktop ? "8px 0 0" : 0, padding: 0 }}>
            {articles.map((article) => (
              <ArticleRow key={article.id} article={article} onUpdateState={onUpdateState} active={article.id === activeArticleId} />
            ))}
      </ul>
      <div ref={sentinelRef} />
      {loadingMore ? <Spinner /> : null}
    </>
  );
}

function ArticleRow({
  article,
  onUpdateState,
  active = false,
}: {
  article: ArticleListItem;
  onUpdateState?: (articleId: number, patch: ArticleStateMutation) => void;
  active?: boolean;
}) {
  const isDesktop = useIsDesktop();
  const { t } = useAppData();
  const [hovered, setHovered] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const { isRead, inReadingList, isBookmarked } = article.userState;
  const translatedTitle = useTitleTranslation().titleFor(article.id);
  const isTranslated = translatedTitle != null;
  const displayTitle = showOriginal || !isTranslated ? article.title : translatedTitle;
  const subscriptionId = article.subscriptionContext.subscriptionIds[0];

  const faviconEl = article.feed.faviconUrl ? (
    <img src={article.feed.faviconUrl} alt="" width={14} height={14} style={{ borderRadius: "3px", flexShrink: 0 }} />
  ) : (
    <span style={{ display: "block", flexShrink: 0, height: 14, width: 14 }} />
  );

  const feedNameEl =
    subscriptionId != null ? (
      <Link
        to={`/subscriptions/${subscriptionId}`}
        style={{
          color: palette.muted,
          flex: isDesktop ? 1 : undefined,
          fontSize: "12px",
          minWidth: 0,
          overflow: "hidden",
          position: "relative",
          textDecoration: "none",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          zIndex: 1,
        }}
      >
        {article.feed.title}
      </Link>
    ) : (
      <span
        style={{
          color: palette.muted,
          flex: isDesktop ? 1 : undefined,
          fontSize: "12px",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {article.feed.title}
      </span>
    );

  const translationLabel = isTranslated ? (
    <span
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setShowOriginal((v) => !v);
      }}
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: "3px",
        color: palette.muted,
        cursor: "pointer",
        flexShrink: 0,
        fontSize: "10px",
        lineHeight: "16px",
        padding: "0 4px",
        position: "relative",
        whiteSpace: "nowrap",
        zIndex: 1,
      }}
    >
      {showOriginal ? t("翻訳") : t("原文")}
    </span>
  ) : null;
  const dateEl = (
    <span style={{ color: palette.muted, flexShrink: 0, fontSize: "12px", whiteSpace: "nowrap" }}>
      {formatTimeCompact(article.publishedAt ?? article.fetchedAt)}
    </span>
  );

  const actions = onUpdateState ? (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: "2px",
        opacity: !isDesktop || hovered || inReadingList || isBookmarked ? 1 : 0,
        position: "relative",
        transition: "opacity 0.15s",
        zIndex: 1,
      }}
    >
      <IconButton
        icon="checkCircle"
        label={isRead ? t("未読にする") : t("既読にする")}
        active={isRead}
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

  return (
    <li
      id={`filo-article-${article.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? palette.hover : "transparent",
        borderBottom: `1px solid ${palette.mutedBorder}`,
        opacity: isRead ? 0.55 : 1,
        padding: isDesktop ? "6px 8px" : "4px 8px 8px",
        position: "relative",
        ...(isDesktop ? { alignItems: "center", display: "flex", gap: "8px" } : {}),
        outline: active ? `2px solid ${palette.accent}` : undefined,
        outlineOffset: active ? "-2px" : undefined,
      }}
    >
      {isDesktop ? (
        <>
          <div style={{ alignItems: "center", display: "flex", flex: 1, gap: "8px", minWidth: 0, overflow: "hidden" }}>
            {faviconEl}
            {/* フィード名とバッジを固定幅の列に収め、タイトルの開始位置を全行で揃える */}
            <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: "6px", width: "120px" }}>
              {feedNameEl}
              {translationLabel}
            </div>
            <span style={{ flexShrink: 0, fontSize: "14px", fontWeight: isRead ? 400 : 600, whiteSpace: "nowrap" }}>
              {displayTitle}
            </span>
            {article.previewText ? (
              <span
                style={{
                  color: palette.muted,
                  flex: 1,
                  fontSize: "13px",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {article.previewText}
              </span>
            ) : null}
          </div>
          {dateEl}
          {actions}
        </>
      ) : (
        <>
          <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
            {isDesktop ? faviconEl : null}
            {feedNameEl}
            {translationLabel}
            <span style={{ flex: 1 }} />
            {dateEl}
            {actions}
          </div>
          <div style={{ fontSize: "14px", fontWeight: isRead ? 400 : 600, lineHeight: 1.4, marginTop: 0 }}>
            {displayTitle}
          </div>
          {isDesktop && article.previewText ? (
            <div
              style={{
                color: palette.muted,
                display: "-webkit-box",
                fontSize: "13px",
                lineHeight: 1.4,
                marginTop: "2px",
                overflow: "hidden",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
              }}
            >
              {article.previewText}
            </div>
          ) : null}
        </>
      )}
      {/* Web は記事詳細画面を持たず、記事タップで実際の元記事ページを開く (SPEC/SCREENS.md) */}
      {article.canonicalUrl ? (
        <a
          href={article.canonicalUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={article.title}
          onClick={() => trackEvent("select_item", { items: [articleItem(article)] })}
          style={{ inset: 0, position: "absolute", zIndex: 0 }}
        />
      ) : null}
    </li>
  );
}
