import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, useArticleList } from "../components/ArticleList";
import { ArticleListControls } from "../components/ArticleListControls";
import { BlockingProgress, Button, EmptyState, ErrorBox, IconButton, Spinner, Toast, useDialogFocus } from "../components/ui";
import { useArticleFilterParams } from "../lib/articleFilters";
import { detectReadingExtension, launchReadingExtension } from "../lib/extensionBridge";
import { errorMessage } from "../lib/messages";
import { enqueueFeedRefresh } from "../lib/refresh";
import { trackEvent } from "../lib/analytics";
import { useBackOr } from "../lib/navigation";

function isArticleVisibleInViewport(articleId: number): boolean {
  const row = document.getElementById(`filo-article-${articleId}`);
  if (!row) return false;
  const headerBottom = document.querySelector<HTMLElement>("[data-filo-page-header]")?.getBoundingClientRect().bottom ?? 0;
  const rect = row.getBoundingClientRect();
  return rect.bottom > headerBottom && rect.top < window.innerHeight;
}

function firstVisibleArticleIndex(articles: readonly { id: number }[]): number {
  const firstIndex = articles.findIndex((article) => isArticleVisibleInViewport(article.id));
  return firstIndex >= 0 ? firstIndex : 0;
}

function scrollArticlesToTop(): void {
  const page = document.querySelector<HTMLElement>(".articles-page");
  let parent = page?.parentElement;
  while (parent && parent !== document.body) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      parent.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    parent = parent.parentElement;
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function ArticlesPage() {
  return <ArticlesListPage />;
}

function ArticlesListPage() {
  const isDesktop = useIsDesktop();
  const api = useApi();
  const { tags, subscriptions, settings, error: sideError, refresh: refreshAppData, refreshUnreadCounts, language, t } = useAppData();
  const goBack = useBackOr("/articles");
  const { tagId, bookmarkedOnly, readingListOnly, read, sort, readOrder, setRead, setSort, setReadOrder } = useArticleFilterParams();
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [markAllNotice, setMarkAllNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [removingReadArticles, setRemovingReadArticles] = useState(false);
  const [activeArticleIndex, setActiveArticleIndex] = useState<number | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [startingReading, setStartingReading] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const closeShortcutHelp = useCallback(() => setShowShortcutHelp(false), []);
  useDialogFocus(showShortcutHelp, "filo-shortcut-help", closeShortcutHelp);

  useEffect(() => {
    if (!markAllNotice) return;
    const timer = window.setTimeout(() => setMarkAllNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [markAllNotice]);

  useEffect(() => {
    if (!refreshNotice) return;
    const timer = window.setTimeout(() => setRefreshNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [refreshNotice]);

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
    <EmptyState icon="rss">
      <p>{t("まだ購読がありません。")}</p>
      <Link to="/feeds/new" className="fl-btn fl-btn--primary">
        {t("フィードを追加")}
      </Link>
    </EmptyState>
  ) : hasFetchingSubscription ? (
    <EmptyState icon="refresh">
      <p>{t("記事を取得しています…")}</p>
      <Button onClick={() => void list.reload()}>{t("更新")}</Button>
    </EmptyState>
  ) : readingListOnly ? (
    <EmptyState icon="playlist">
      <p>{t("リーディングリストに保存した記事はありません。")}</p>
      <Link to="/articles" className="fl-btn fl-btn--secondary">{t("全ての記事")}</Link>
    </EmptyState>
  ) : bookmarkedOnly ? (
    <EmptyState icon="bookmark">{t("表示できる記事がありません。")}</EmptyState>
  ) : (
    <EmptyState icon="inbox">{t("表示できる記事がありません。")}</EmptyState>
  );

  const selectedTag = tagId !== undefined ? tags.find((t) => t.id === tagId) : undefined;

  // 更新: 購読 feed の取得ジョブを enqueue し、一覧を一度再読込する。
  const refreshFeeds = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const outcome = await enqueueFeedRefresh(api);
      if (outcome.enqueued === 0 && outcome.skipped > 0) {
        setRefreshNotice(t("最近取得済みのため、今回の取得対象はありませんでした。"));
      } else if (outcome.enqueued > 0) {
        setRefreshNotice(`${outcome.enqueued}${t("件のフィードの取得を開始しました。")}`);
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
    if (markingAllRead) return;
    setMarkingAllRead(true);
    setMarkAllNotice(null);
    setMarkAllError(null);
    try {
      await api.markAllArticlesRead(tagId);
      trackEvent("mark_all_articles_read", { scope: selectedTag ? "tag" : "all_articles" });
      await list.reload();
      void refreshAppData();
      setActiveArticleIndex(null);
      scrollArticlesToTop();
      setMarkAllNotice(t("既読への変更が完了しました。"));
    } catch (e) {
      setMarkAllError(errorMessage(e, language));
    } finally {
      setMarkingAllRead(false);
    }
  };

  const removeReadArticles = async () => {
    if (!window.confirm(t("既読の記事をリーディングリストから削除しますか？"))) return;
    setRemovingReadArticles(true);
    try {
      await api.removeReadArticlesFromReadingList();
      trackEvent("remove_read_articles_from_reading_list");
      await list.reload();
      void refreshUnreadCounts({ force: true }).catch(() => undefined);
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
      if (markingAllRead) {
        event.preventDefault();
        return;
      }
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
        goBack();
      } else if (event.key === "?") {
        event.preventDefault();
        setShowShortcutHelp(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeArticleIndex, bookmarkedOnly, goBack, list, markAllRead, markingAllRead, readingListOnly, refreshFeeds, showShortcutHelp]);

  useEffect(() => {
    const article = activeArticleIndex == null ? undefined : list.articles[activeArticleIndex];
    if (article) document.getElementById(`filo-article-${article.id}`)?.scrollIntoView({ block: "center" });
  }, [activeArticleIndex, list.articles]);

  const readingDisabled = !extensionReady || startingReading || !readingArticle;
  const headerActions = (
    <>
      {readingListOnly ? (
        isDesktop ? (
          <>
            <Button small icon="bookOpen" disabled={readingDisabled} onClick={() => void startReading(false)}>
              {t("閲覧開始")}
            </Button>
            <Button small kind="primary" icon="play" disabled={readingDisabled} onClick={() => void startReading(true)}>
              {t("読み上げ開始")}
            </Button>
            <span aria-hidden="true" style={{ width: "4px" }} />
          </>
        ) : (
          <>
            <IconButton icon="bookOpen" label={t("閲覧開始")} disabled={readingDisabled} onClick={() => void startReading(false)} />
            <IconButton icon="play" label={t("読み上げ開始")} disabled={readingDisabled} onClick={() => void startReading(true)} />
          </>
        )
      ) : null}
      {readingListOnly ? (
        <IconButton
          icon="trash"
          label={t("既読記事を削除")}
          disabled={removingReadArticles}
          onClick={() => void removeReadArticles()}
        />
      ) : null}
      {!bookmarkedOnly && !readingListOnly ? (
        <IconButton icon="checkCircle" label={t("すべて既読にする")} disabled={markingAllRead} onClick={() => void markAllRead()} />
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
    <AppShell title={title} actions={headerActions}>
      <main className="articles-page" aria-busy={markingAllRead} style={{ paddingBottom: "32px" }}>
        {sideError || markAllError ? (
          <div style={{ display: "grid", gap: "8px", padding: "16px var(--fl-page-gutter) 0" }}>
            {sideError ? <ErrorBox message={sideError} /> : null}
            {markAllError ? <ErrorBox message={markAllError} /> : null}
          </div>
        ) : null}
        {refreshNotice ? <Toast message={refreshNotice} /> : null}
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
      {markingAllRead ? <BlockingProgress message={t("既読に変更しています…")} /> : null}
      {markAllNotice ? <Toast message={markAllNotice} /> : null}
      {showShortcutHelp ? (
        <div
          role="dialog"
          id="filo-shortcut-help"
          aria-modal="true"
          aria-labelledby="filo-shortcut-help-title"
          onClick={() => setShowShortcutHelp(false)}
          className="fl-dialog-scrim"
        >
          <section onClick={(event) => event.stopPropagation()} className="fl-dialog" style={{ maxWidth: "360px" }}>
            <div className="fl-dialog-header">
              <h2 id="filo-shortcut-help-title">{t("ショートカット")}</h2>
              <IconButton icon="close" label={t("閉じる")} onClick={() => setShowShortcutHelp(false)} />
            </div>
            <pre style={{ fontFamily: "inherit", fontSize: "14px", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>{t("ショートカットヘルプ")}</pre>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
