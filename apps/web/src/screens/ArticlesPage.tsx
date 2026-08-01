import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, useArticleList } from "../components/ArticleList";
import { TitleTranslationToggle } from "../components/TitleTranslationContext";
import { EmptyState, ErrorBox, FilterChip, IconButton, InlineButton, Spinner, palette } from "../components/ui";
import { useArticleFilterParams } from "../lib/articleFilters";
import { errorMessage } from "../lib/messages";
import { refreshFeedsAndWait } from "../lib/refresh";
import { detectReadingExtension, launchReadingExtension, subscribeExtensionEvents } from "../lib/extensionBridge";

export function ArticlesPage() {
  return <ArticlesListPage />;
}

function ArticlesListPage() {
  const isDesktop = useIsDesktop();
  const api = useApi();
  const { tags, subscriptions, settings, error: sideError, refresh: refreshAppData, language, t } = useAppData();
  const { tagId, bookmarkedOnly, readingListOnly, read, setRead, clearTag } = useArticleFilterParams();
  const [markAllError, setMarkAllError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [extensionReady, setExtensionReady] = useState(false);
  const [startingReading, setStartingReading] = useState(false);
  const [removingReadArticles, setRemovingReadArticles] = useState(false);

  const startReading = async (autoplay: boolean) => {
    if (!extensionReady || startingReading) return;
    setStartingReading(true);
    setMarkAllError(null);
    try {
      const session = await api.startReadingSession();
      if (!session.playbackState?.currentArticleId) {
        setMarkAllError("未読の記事がありません。");
        return;
      }
      await launchReadingExtension(session, { autoplay, targetLanguage: settings?.language ?? "ja" });
    } catch (e) {
      setMarkAllError(errorMessage(e, language));
    } finally {
      setStartingReading(false);
    }
  };

  const apiFilters = useMemo(
    () => ({
      tagId,
      read,
      readingList: readingListOnly ? (true as const) : undefined,
      bookmarked: bookmarkedOnly ? (true as const) : undefined,
    }),
    [tagId, read, readingListOnly, bookmarkedOnly],
  );

  const list = useArticleList(api, apiFilters);
  const reloadList = list.reload;

  useEffect(() => {
    if (!readingListOnly) return;
    void detectReadingExtension().then(setExtensionReady);
    return subscribeExtensionEvents((event) => {
      if (event.type === "articleRead") {
        void api.setArticleRead(event.articleId, true).then(reloadList);
      } else {
        void api.updatePlaybackState(event);
      }
    });
  }, [api, reloadList, readingListOnly]);

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

  return (
    <AppShell>
      <main style={{ padding: "4px 24px 16px" }}>
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
          <TitleTranslationToggle />
          {readingListOnly ? (
            <>
              <IconButton
                icon="trash"
                label={t("既読記事を削除")}
                disabled={removingReadArticles}
                onClick={() => void removeReadArticles()}
              />
              <InlineButton disabled={!extensionReady || startingReading} onClick={() => void startReading(false)}>
                {t("閲覧開始")}
              </InlineButton>
              <InlineButton disabled={!extensionReady || startingReading} onClick={() => void startReading(true)}>
                {t("読み上げ開始")}
              </InlineButton>
            </>
          ) : null}
          {!bookmarkedOnly && !readingListOnly ? (
            <>
              <IconButton icon="checkCircle" label={t("すべて既読にする")} onClick={() => void markAllRead()} />
              <IconButton
                icon="refresh"
                label={refreshing ? t("更新中…") : t("フィードを更新")}
                disabled={refreshing}
                onClick={() => void refreshFeeds()}
              />
            </>
          ) : null}
        </header>

        {selectedTag ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 0 4px" }}>
            <FilterChip label={`タグ: ${selectedTag.name} ✕`} active onClick={clearTag} />
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 0 4px" }}>
          <FilterChip label={t("全ての記事")} active={read === undefined} onClick={() => setRead(undefined)} />
          <FilterChip label={t("未読")} active={read === false} onClick={() => setRead(false)} />
          <FilterChip label={t("既読")} active={read === true} onClick={() => setRead(true)} />
        </div>

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
            emptyContent={emptyContent}
          />
        )}
      </main>
    </AppShell>
  );
}
