import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell, SIDEBAR_WIDTH, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, useArticleList } from "../components/ArticleList";
import { ArticleListControls } from "../components/ArticleListControls";
import { Button, EmptyState, ErrorBox, FilterChip, IconButton, InlineButton, Spinner, palette, useDialogFocus } from "../components/ui";
import { useArticleFilterParams } from "../lib/articleFilters";
import { detectReadingExtension, launchReadingExtension } from "../lib/extensionBridge";
import { errorMessage } from "../lib/messages";
import { refreshFeedsAndWait } from "../lib/refresh";
import { trackEvent } from "../lib/analytics";

function isArticleVisibleInViewport(articleId: number): boolean {
  const row = document.getElementById(`filo-article-${articleId}`);
  if (!row) return false;
  const headerBottom = document.querySelector<HTMLElement>(".articles-page > header")?.getBoundingClientRect().bottom ?? 0;
  const rect = row.getBoundingClientRect();
  return rect.bottom > headerBottom && rect.top < window.innerHeight;
}

function firstVisibleArticleIndex(articles: readonly { id: number }[]): number {
  const firstIndex = articles.findIndex((article) => isArticleVisibleInViewport(article.id));
  return firstIndex >= 0 ? firstIndex : 0;
}

export function ArticlesPage() {
  return <ArticlesListPage />;
}

function ArticlesListPage() {
  const isDesktop = useIsDesktop();
  const api = useApi();
  const { tags, subscriptions, settings, error: sideError, refresh: refreshAppData, language, t } = useAppData();
  const { tagId, bookmarkedOnly, readingListOnly, read, sort, readOrder, setRead, setSort, setReadOrder, clearTag } = useArticleFilterParams();
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [removingReadArticles, setRemovingReadArticles] = useState(false);
  const [activeArticleIndex, setActiveArticleIndex] = useState<number | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [startingReading, setStartingReading] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const articleHeaderRef = useRef<HTMLElement | null>(null);
  const [articleHeaderHeight, setArticleHeaderHeight] = useState(0);
  const closeShortcutHelp = useCallback(() => setShowShortcutHelp(false), []);
  useDialogFocus(showShortcutHelp, "filo-shortcut-help", closeShortcutHelp);

  useLayoutEffect(() => {
    const header = articleHeaderRef.current;
    if (!isDesktop || !header) {
      setArticleHeaderHeight(0);
      return;
    }
    const updateHeight = () => setArticleHeaderHeight(header.offsetHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => observer.disconnect();
  }, [isDesktop]);

  const apiFilters = useMemo(
    () => ({
      tagId,
      read,
      sort,
      readOrder,
      readingList: readingListOnly ? (true as const) : undefined,
      bookmarked: bookmarkedOnly ? (true as const) : undefined,
    }),
    [tagId, read, sort, readOrder, readingListOnly, bookmarkedOnly],
  );

  const list = useArticleList(api, apiFilters);

  // Native apps also start a reading session at the first unread item. Keep
  // the Web entry point independent from the keyboard-selected row.
  const readingArticle = list.articles.find((article) => !article.userState.isRead && article.canonicalUrl)
    ?? list.articles.find((article) => article.canonicalUrl);

  const hasSubscriptions = subscriptions.length > 0;
  const hasArticleFilter = tagId !== undefined || read !== undefined || readingListOnly || bookmarkedOnly;
  const hasFetchingSubscription = read === undefined && !readingListOnly && !bookmarkedOnly && subscriptions.some(
    (subscription) =>
      subscription.initialFetchStatus === "fetching"
      && (tagId === undefined || subscription.tagIds.includes(tagId)),
  );

  const emptyContent = !hasSubscriptions && !hasArticleFilter ? (
    <EmptyState>
      <p>{t("まだ購読がありません。")}</p>
      <Link to="/feeds/new" style={{ color: "inherit" }}>
        {t("フィードを追加")} 
      </Link>
    </EmptyState>
  ) : hasFetchingSubscription ? (
    <EmptyState>
      <p>{t("記事を取得しています…")}</p>
      <InlineButton onClick={() => void list.reload()}>{t("更新")}</InlineButton>
    </EmptyState>
  ) : readingListOnly ? (
    <EmptyState>
      <p>{t("リーディングリストに保存した記事はありません。")}</p>
      <Link to="/articles" style={{ color: "inherit" }}>{t("全ての記事")}</Link>
    </EmptyState>
  ) : (
    <EmptyState>{t("表示できる記事がありません。")}</EmptyState>
  );

  const selectedTag = tagId !== undefined ? tags.find((t) => t.id === tagId) : undefined;

  // 更新: 購読 feed の取得ジョブを enqueue し、/status のポーリングで完了を待って再読込する
  const refreshFeeds = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const outcome = await refreshFeedsAndWait(api);
      if (outcome.enqueued === 0 && outcome.skipped > 0) {
        setRefreshNotice(t("最近取得済みのため、今回の取得対象はありませんでした。"));
      } else if (outcome.timedOut) {
        setRefreshNotice(t("取得に時間がかかっています。あとで再度更新してください。"));
      }
      trackEvent("refresh_feeds", {
        enqueued: outcome.enqueued,
        skipped: outcome.skipped,
        source: "articles",
        timed_out: outcome.timedOut,
      });
      await list.reload();
      void refreshAppData();
    } catch (e) {
      setRefreshNotice(errorMessage(e, language));
    } finally {
      setRefreshing(false);
    }
  };

  const markAllRead = async () => {
    try {
      await api.markAllArticlesRead(tagId);
      trackEvent("mark_all_articles_read", { scope: selectedTag ? "tag" : "all_articles" });
      setMarkAllError(null);
      await list.reload();
      void refreshAppData();
    } catch (e) {
      setMarkAllError(errorMessage(e, language));
    }
  };

  const removeReadArticles = async () => {
    if (!window.confirm(t("既読の記事をリーディングリストから削除しますか？"))) return;
    setRemovingReadArticles(true);
    try {
      await api.removeReadArticlesFromReadingList();
      trackEvent("remove_read_articles_from_reading_list");
      await list.reload();
    } catch (e) {
      setMarkAllError(errorMessage(e, language));
    } finally {
      setRemovingReadArticles(false);
    }
  };

  const startReading = async (autoplay: boolean) => {
    if (!readingArticle?.canonicalUrl || startingReading) return;
    setStartingReading(true);
    setMarkAllError(null);
    try {
      await launchReadingExtension(
        { id: readingArticle.id, url: readingArticle.canonicalUrl, title: readingArticle.title },
        { autoplay, targetLanguage: settings?.language ?? language },
      );
      trackEvent(autoplay ? "start_reading_aloud" : "start_reading", { source: "web_extension" });
    } catch (error) {
      setMarkAllError(error instanceof Error ? t(error.message) : errorMessage(error, language));
    } finally {
      setStartingReading(false);
    }
  };

  const title = selectedTag?.name ?? (readingListOnly ? t("リーディングリスト") : bookmarkedOnly ? t("ブックマーク") : t("全ての記事"));

  useEffect(() => {
    setActiveArticleIndex((current) => current == null ? null : Math.min(current, Math.max(list.articles.length - 1, 0)));
  }, [list.articles.length]);

  useEffect(() => {
    if (!readingListOnly) {
      setExtensionReady(false);
      return;
    }
    let active = true;
    const check = () => {
      void detectReadingExtension().then((available) => {
        if (active) setExtensionReady(available);
      });
    };
    check();
    const interval = window.setInterval(check, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [readingListOnly]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showShortcutHelp && event.key === "Escape") {
        event.preventDefault();
        setShowShortcutHelp(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey || event.altKey;
      if (event.shiftKey && key === "a" && !modifier) {
        event.preventDefault();
        if (!bookmarkedOnly && !readingListOnly) void markAllRead();
        return;
      }
      if (modifier) return;
      const isArticleNavigationKey = key === "j"
        || event.key === "ArrowDown"
        || key === "k"
        || event.key === "ArrowUp";
      if (event.repeat && !isArticleNavigationKey) return;
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setActiveArticleIndex((current) => {
          if (current != null && isArticleVisibleInViewport(list.articles[current]?.id ?? -1)) {
            return Math.min(current + 1, Math.max(list.articles.length - 1, 0));
          }
          return firstVisibleArticleIndex(list.articles);
        });
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveArticleIndex((current) => {
          if (current != null && isArticleVisibleInViewport(list.articles[current]?.id ?? -1)) {
            return Math.max(current - 1, 0);
          }
          return firstVisibleArticleIndex(list.articles);
        });
      } else if (key === "enter" || key === "o" || key === "v") {
        event.preventDefault();
        const articleIndex = activeArticleIndex ?? 0;
        setActiveArticleIndex((current) => current ?? 0);
        const article = list.articles[articleIndex];
        if (article?.canonicalUrl) window.open(article.canonicalUrl, "_blank", "noopener,noreferrer");
      } else if (key === "m" || key === "s" || key === "b") {
        event.preventDefault();
        const articleIndex = activeArticleIndex ?? 0;
        setActiveArticleIndex((current) => current ?? 0);
        const article = list.articles[articleIndex];
        if (!article) return;
        const patch = key === "m"
          ? { isRead: !article.userState.isRead }
          : key === "s"
            ? { inReadingList: !article.userState.inReadingList }
            : { isBookmarked: !article.userState.isBookmarked };
        void list.updateState(article.id, patch);
      } else if (key === "r") {
        event.preventDefault();
        void refreshFeeds();
      } else if (event.key === "Escape") {
        event.preventDefault();
        window.history.back();
      } else if (event.key === "?") {
        event.preventDefault();
        setShowShortcutHelp(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeArticleIndex, bookmarkedOnly, list, markAllRead, readingListOnly, refreshFeeds, showShortcutHelp]);

  useEffect(() => {
    const article = activeArticleIndex == null ? undefined : list.articles[activeArticleIndex];
    if (article) document.getElementById(`filo-article-${article.id}`)?.scrollIntoView({ block: "center" });
  }, [activeArticleIndex, list.articles]);

  const renderArticleHeaderContent = () => (
    <>
      <h1 style={{ flex: 1, fontSize: "18px", margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {title}
      </h1>
      {readingListOnly ? (
        <>
          <InlineButton
            disabled={!extensionReady || startingReading || !readingArticle}
            onClick={() => void startReading(false)}
          >
            {t("閲覧開始")}
          </InlineButton>
          <InlineButton
            disabled={!extensionReady || startingReading || !readingArticle}
            onClick={() => void startReading(true)}
          >
            {t("読み上げ開始")}
          </InlineButton>
          <IconButton
            icon="trash"
            label={t("既読記事を削除")}
            disabled={removingReadArticles}
            onClick={() => void removeReadArticles()}
          />
        </>
      ) : null}
      {!bookmarkedOnly && !readingListOnly ? (
        <IconButton icon="checkCircle" label={t("すべて既読にする")} onClick={() => void markAllRead()} />
      ) : null}
      <ArticleListControls
        read={read}
        sort={sort}
        readOrder={readOrder}
        defaultSort={settings?.articleSortOrder ?? "published_at_desc"}
        setRead={setRead}
        setSort={setSort}
        setReadOrder={setReadOrder}
        t={t}
      />
    </>
  );

  return (
    <AppShell mobileHeaderContent={isDesktop ? undefined : renderArticleHeaderContent()}>
      <main className="articles-page" style={{ padding: "0 0 16px", ...(isDesktop ? { paddingTop: `${articleHeaderHeight}px` } : {}) }}>
        {isDesktop ? (
          <header
            ref={articleHeaderRef}
            style={{
              alignItems: "center",
              borderBottom: `1px solid ${palette.mutedBorder}`,
              display: "flex",
              gap: "8px",
              padding: "8px 16px",
              position: "fixed",
              left: `${SIDEBAR_WIDTH}px`,
              right: 0,
              top: 0,
              zIndex: 10,
              background: palette.bg,
            }}
          >
            {renderArticleHeaderContent()}
          </header>
        ) : null}

        {selectedTag ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 16px 4px" }}>
            <FilterChip label={t("タグ: {name} ✕", { name: selectedTag.name })} active onClick={clearTag} />
          </div>
        ) : null}

        {sideError ? <ErrorBox message={sideError} /> : null}
        {markAllError ? <ErrorBox message={markAllError} /> : null}
        {refreshNotice ? (
          <p
            role="status"
            aria-live="polite"
            style={{
              background: palette.surface,
              border: `1px solid ${palette.mutedBorder}`,
              borderRadius: "6px",
              bottom: "16px",
              boxShadow: `0 4px 12px ${palette.shadow}`,
              boxSizing: "border-box",
              color: palette.muted,
              fontSize: "13px",
              left: isDesktop ? `${SIDEBAR_WIDTH + 16}px` : "16px",
              margin: 0,
              maxWidth: "480px",
              padding: "8px 12px",
              pointerEvents: "none",
              position: "fixed",
              right: "16px",
              width: "calc(100% - 32px)",
              zIndex: 15,
            }}
          >
            {refreshNotice}
          </p>
        ) : null}
        {list.loading && list.articles.length === 0 ? (
          <Spinner />
        ) : (
          <ArticleRows
            articles={list.articles}
            loading={list.loading}
            loadingMore={list.loadingMore}
            error={list.error}
            nextCursor={list.nextCursor}
            onRetry={() => void list.reload()}
            onLoadMore={() => void list.loadMore()}
            onUpdateState={(id, patch) => void list.updateState(id, patch)}
            activeArticleId={activeArticleIndex == null ? undefined : list.articles[activeArticleIndex]?.id}
            emptyContent={emptyContent}
          />
        )}
      </main>
      {showShortcutHelp ? (
        <div
          role="dialog"
          id="filo-shortcut-help"
          aria-modal="true"
          aria-labelledby="filo-shortcut-help-title"
          onClick={() => setShowShortcutHelp(false)}
          style={{ alignItems: "center", background: "rgba(0,0,0,0.35)", display: "flex", inset: 0, justifyContent: "center", position: "fixed", zIndex: 100 }}
        >
          <section onClick={(event) => event.stopPropagation()} style={{ background: palette.surface, borderRadius: "8px", maxWidth: "360px", padding: "20px", width: "calc(100% - 32px)" }}>
            <h2 id="filo-shortcut-help-title" style={{ fontSize: "18px", margin: "0 0 12px" }}>{t("ショートカット")}</h2>
            <pre style={{ fontFamily: "inherit", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{t("ショートカットヘルプ")}</pre>
            <Button onClick={() => setShowShortcutHelp(false)}>{t("閉じる")}</Button>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
