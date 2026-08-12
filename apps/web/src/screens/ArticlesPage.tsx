import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, useArticleList } from "../components/ArticleList";
import { ArticleListControls } from "../components/ArticleListControls";
import { EmptyState, ErrorBox, FilterChip, IconButton, InlineButton, Spinner, palette } from "../components/ui";
import { useArticleFilterParams } from "../lib/articleFilters";
import { errorMessage } from "../lib/messages";
import { refreshFeedsAndWait } from "../lib/refresh";

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
  const [activeArticleIndex, setActiveArticleIndex] = useState(0);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

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
      await list.reload();
      void refreshAppData();
    } catch (e) {
      setRefreshNotice(errorMessage(e, language));
    } finally {
      setRefreshing(false);
    }
  };

  const markAllRead = async () => {
    const scope = selectedTag ? `${t("タグ")}「${selectedTag.name}」` : t("すべての購読");
    if (!window.confirm(`${scope}${t("の記事をすべて既読にしますか？")}`)) return;
    try {
      await api.markAllArticlesRead(tagId);
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
      await list.reload();
    } catch (e) {
      setMarkAllError(errorMessage(e, language));
    } finally {
      setRemovingReadArticles(false);
    }
  };

  const title = selectedTag?.name ?? (readingListOnly ? t("リーディングリスト") : bookmarkedOnly ? t("ブックマーク") : t("全ての記事"));

  useEffect(() => {
    setActiveArticleIndex((current) => Math.min(current, Math.max(list.articles.length - 1, 0)));
  }, [list.articles.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey || event.altKey;
      if (event.shiftKey && key === "a" && !modifier) {
        event.preventDefault();
        if (!bookmarkedOnly && !readingListOnly) void markAllRead();
        return;
      }
      if (modifier || event.repeat) return;
      if (key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setActiveArticleIndex((current) => Math.min(current + 1, Math.max(list.articles.length - 1, 0)));
      } else if (key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveArticleIndex((current) => Math.max(current - 1, 0));
      } else if (key === "enter" || key === "o" || key === "v") {
        event.preventDefault();
        const article = list.articles[activeArticleIndex];
        if (article?.canonicalUrl) window.open(article.canonicalUrl, "_blank", "noopener,noreferrer");
      } else if (key === "m" || key === "s" || key === "b") {
        event.preventDefault();
        const article = list.articles[activeArticleIndex];
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
  }, [activeArticleIndex, bookmarkedOnly, list, markAllRead, readingListOnly, refreshFeeds]);

  useEffect(() => {
    const article = list.articles[activeArticleIndex];
    if (article) document.getElementById(`filo-article-${article.id}`)?.scrollIntoView({ block: "nearest" });
  }, [activeArticleIndex, list.articles]);

  return (
    <AppShell>
      <main style={{ padding: "0 24px 16px" }}>
        <header
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${palette.mutedBorder}`,
            display: "flex",
            gap: "8px",
            padding: "8px 0",
            position: "sticky",
            top: isDesktop ? 0 : "51px",
            zIndex: 10,
            background: palette.bg,
          }}
        >
          <h1 style={{ flex: 1, fontSize: "20px", margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </h1>
          {readingListOnly ? (
            <>
              <IconButton
                icon="trash"
                label={t("既読記事を削除")}
                disabled={removingReadArticles}
                onClick={() => void removeReadArticles()}
              />
            </>
          ) : null}
          {!bookmarkedOnly && !readingListOnly ? (
            <>
              <IconButton icon="checkCircle" label={t("すべて既読にする")} onClick={() => void markAllRead()} />
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
        </header>

        {selectedTag ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 0 4px" }}>
            <FilterChip label={`タグ: ${selectedTag.name} ✕`} active onClick={clearTag} />
          </div>
        ) : null}

        {sideError ? <ErrorBox message={sideError} /> : null}
        {markAllError ? <ErrorBox message={markAllError} /> : null}
        {refreshing ? <Spinner label={t("フィードを更新しています…")} /> : null}
        {refreshNotice ? (
          <p style={{ color: palette.muted, fontSize: "13px", margin: "8px 0 0" }}>{refreshNotice}</p>
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
            activeArticleId={list.articles[activeArticleIndex]?.id}
            emptyContent={emptyContent}
          />
        )}
      </main>
      {showShortcutHelp ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setShowShortcutHelp(false)}
          style={{ alignItems: "center", background: "rgba(0,0,0,0.35)", display: "flex", inset: 0, justifyContent: "center", position: "fixed", zIndex: 100 }}
        >
          <section onClick={(event) => event.stopPropagation()} style={{ background: palette.surface, borderRadius: "8px", maxWidth: "360px", padding: "20px", width: "calc(100% - 32px)" }}>
            <h2 style={{ fontSize: "18px", margin: "0 0 12px" }}>{t("ショートカット")}</h2>
            <pre style={{ fontFamily: "inherit", lineHeight: 1.7, margin: 0, whiteSpace: "pre-wrap" }}>{"J / ↓  次の記事\nK / ↑  前の記事\nEnter / O  記事を開く\nV  元記事を開く\nM  既読／未読\nS  リーディングリスト\nB  ブックマーク\nR  更新\nShift+A  すべて既読\n?  この一覧"}</pre>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
