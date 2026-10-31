import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, NewArticlesNotice, useArticleList } from "../components/ArticleList";
import { ArticleListControls } from "../components/ArticleListControls";
import { useDialogs } from "../components/Dialogs";
import { PullToRefresh } from "../components/PullToRefresh";
import { Button, EmptyState, ErrorBox, IconButton, Spinner, Toast } from "../components/ui";
import { ShortcutHelpDialog, useArticleShortcuts } from "../components/useArticleShortcuts";
import { useArticleFilterParams } from "../lib/articleFilters";
import { detectReadingExtension, launchReadingExtension } from "../lib/extensionBridge";
import { errorMessage } from "../lib/messages";
import { enqueueFeedRefresh, refreshNoticeMessage } from "../lib/refresh";
import { trackEvent } from "../lib/analytics";
import { firstUnreadReadingArticle } from "../lib/readingStart";

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
  const { confirm } = useDialogs();
  const { tagId, bookmarkedOnly, readingListOnly, read, sort, readOrder, setRead, setSort, setReadOrder } = useArticleFilterParams();
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [markAllNotice, setMarkAllNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [removingReadArticles, setRemovingReadArticles] = useState(false);
  // null until the first check answers, so the hint does not flash.
  const [extensionReady, setExtensionReady] = useState<boolean | null>(null);
  const [startingReading, setStartingReading] = useState(false);

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
  ) : read !== undefined ? (
    <EmptyState icon="sliders">
      <p>{read ? t("既読の記事はありません。") : t("未読の記事はありません。")}</p>
      <Button onClick={() => setRead(undefined)}>{t("絞り込みを解除")}</Button>
    </EmptyState>
  ) : readingListOnly ? (
    <EmptyState icon="playlist">
      <p>{t("リーディングリストに保存した記事はありません。")}</p>
      <Link to="/articles" className="fl-btn fl-btn--secondary">{t("全ての記事")}</Link>
    </EmptyState>
  ) : bookmarkedOnly ? (
    <EmptyState icon="bookmark">{t("ブックマークした記事はありません。")}</EmptyState>
  ) : (
    <EmptyState icon="inbox">{t("表示できる記事がありません。")}</EmptyState>
  );

  const selectedTag = tagId !== undefined ? tags.find((t) => t.id === tagId) : undefined;

  // 更新: 購読 feed の取得ジョブの完了を確認してから再読込する。
  const refreshFeeds = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const outcome = await enqueueFeedRefresh(api);
      setRefreshNotice(refreshNoticeMessage(outcome, t));
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
    const upToArticleId = list.markAllUpToId;
    if (markingAllRead || upToArticleId === null) return;
    const confirmed = await confirm({
      title: t("「{name}」の記事をすべて既読にしますか？", { name: title }),
      confirmLabel: t("すべて既読にする"),
    });
    if (!confirmed) return;
    setMarkingAllRead(true);
    setMarkAllNotice(null);
    setMarkAllError(null);
    const rollback = list.markAllReadLocally();
    try {
      await api.markAllArticlesRead(upToArticleId, tagId);
      trackEvent("mark_all_articles_read", { scope: selectedTag ? "tag" : "all_articles" });
      await list.reload();
      void refreshAppData();
      shortcuts.clearSelection();
      scrollArticlesToTop();
      setMarkAllNotice(t("既読への変更が完了しました。"));
    } catch (e) {
      rollback();
      setMarkAllError(errorMessage(e, language));
    } finally {
      setMarkingAllRead(false);
    }
  };

  const removeReadArticles = async () => {
    const confirmed = await confirm({
      title: t("既読の記事をリーディングリストから削除しますか？"),
      confirmLabel: t("既読記事を削除"),
      danger: true,
    });
    if (!confirmed) return;
    setRemovingReadArticles(true);
    try {
      const { removedCount } = await api.removeReadArticlesFromReadingList();
      trackEvent("remove_read_articles_from_reading_list");
      await list.reload();
      setMarkAllNotice(removedCount > 0
        ? t("{count}件の既読記事を削除しました。", { count: removedCount })
        : t("削除できる既読記事はありません。"));
      void refreshUnreadCounts({ force: true }).catch(() => undefined);
    } catch (e) {
      setMarkAllError(errorMessage(e, language));
    } finally {
      setRemovingReadArticles(false);
    }
  };

  const startReading = async (autoplay: boolean) => {
    if (startingReading) return;
    setStartingReading(true);
    setMarkAllError(null);
    try {
      // The visible list can be filtered or only partly loaded. The session
      // starts from the same complete, unfiltered reading list as the apps.
      const readingArticle = await firstUnreadReadingArticle(api.listArticles);
      if (!readingArticle?.canonicalUrl) {
        setMarkAllError(t("未読の記事がありません。"));
        return;
      }
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

  const shortcuts = useArticleShortcuts({
    articles: list.articles,
    onUpdateState: (id, patch) => void list.updateState(id, patch),
    onRefresh: () => void refreshFeeds(),
    onMarkAll: bookmarkedOnly || readingListOnly ? undefined : () => void markAllRead(),
  });

  useEffect(() => {
    if (!readingListOnly) {
      setExtensionReady(null);
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

  const readingDisabled = extensionReady !== true || startingReading || list.articles.length === 0;
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
        <>
          <IconButton icon="refresh" label={t("フィードを更新")} disabled={refreshing} spinning={refreshing} onClick={() => void refreshFeeds()} />
          <IconButton icon="checkAll" label={t("すべて既読にする")} disabled={markingAllRead || list.markAllUpToId === null} onClick={() => void markAllRead()} />
        </>
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
        <PullToRefresh disabled={refreshing} onRefresh={() => void refreshFeeds()} />
        {readingListOnly && extensionReady === false ? (
          <p className="fl-notice">{t("閲覧と読み上げには Browser Extension が必要です。")}</p>
        ) : null}
        <NewArticlesNotice visible={list.hasNewArticles} disabled={list.loading || refreshing || markingAllRead} onLoad={() => {
          shortcuts.clearSelection();
          void list.reload().then((loaded) => { if (loaded) { scrollArticlesToTop(); void refreshUnreadCounts(); } });
        }} />
        {sideError || markAllError ? (
          <div style={{ display: "grid", gap: "8px", padding: "16px var(--fl-page-gutter) 0" }}>
            {sideError ? <ErrorBox message={sideError} /> : null}
            {markAllError ? <ErrorBox message={markAllError} /> : null}
          </div>
        ) : null}
        {refreshing ? <Toast message={t("フィードを更新しています…")} /> : refreshNotice ? <Toast message={refreshNotice} /> : null}
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
            activeArticleId={shortcuts.activeArticleId}
            emptyContent={emptyContent}
          />
        )}
      </main>
      {markAllNotice ? <Toast message={markAllNotice} /> : null}
      {shortcuts.helpOpen ? <ShortcutHelpDialog onClose={shortcuts.closeHelp} /> : null}
    </AppShell>
  );
}
