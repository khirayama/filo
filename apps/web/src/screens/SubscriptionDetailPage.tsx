import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api/useApi";
import { ApiRequestError } from "../api/client";
import type { Subscription } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, useArticleList } from "../components/ArticleList";
import { Badge, Button, EmptyState, ErrorBox, FilterChip, IconButton, MenuItem, Spinner, menuStyle, palette } from "../components/ui";
import { useArticleFilterParams } from "../lib/articleFilters";
import { errorMessage, initialFetchErrorMessage } from "../lib/messages";
import { refreshFeedsAndWait } from "../lib/refresh";

export function SubscriptionDetailPage() {
  const api = useApi();
  const navigate = useNavigate();
  const params = useParams();
  const subscriptionId = Number(params.subscriptionId);

  const { tags: allTags, settings, refresh: refreshAppData } = useAppData();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { sort, setSort } = useArticleFilterParams();
  // sort 未指定時は server が current user の articleSortOrder を適用する
  const effectiveSort = sort ?? settings?.articleSortOrder ?? "published_at_desc";
  const filters = useMemo(
    () => ({
      subscriptionId,
      sort,
    }),
    [subscriptionId, sort]
  );
  const list = useArticleList(api, filters);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubscription(await api.getSubscription(subscriptionId));
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) setGone(true);
      else setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api, subscriptionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rename = async () => {
    if (!subscription) return;
    const title = window.prompt("購読名を変更（空欄でフィード名に戻す）", subscription.customTitle ?? "");
    if (title === null) return;
    try {
      setSubscription(await api.updateSubscription(subscription.id, title.trim() || null));
      void refreshAppData();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const toggleTag = async (tagId: number) => {
    if (!subscription) return;
    const next = subscription.tagIds.includes(tagId)
      ? subscription.tagIds.filter((id) => id !== tagId)
      : [...subscription.tagIds, tagId];
    try {
      setSubscription(await api.setSubscriptionTags(subscription.id, next));
      void refreshAppData();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const unsubscribe = async () => {
    if (!subscription) return;
    if (!window.confirm("この購読を解除しますか？リーディングリスト・ブックマークした記事は残ります。")) return;
    try {
      await api.deleteSubscription(subscription.id);
      void refreshAppData();
      navigate("/subscriptions");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const refreshFeed = async () => {
    if (!subscription || refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const outcome = await refreshFeedsAndWait(api, { feedId: subscription.feed.id });
      if (outcome.timedOut) {
        setRefreshNotice("取得に時間がかかっています。あとで再度更新してください。");
      }
      await list.reload();
    } catch (e) {
      setRefreshNotice(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const markAllRead = async () => {
    if (!subscription) return;
    if (!window.confirm("このフィードの記事をすべて既読にしますか？")) return;
    try {
      const result = await api.markAllRead(subscription.id);
      setSubscription({ ...subscription, unreadCount: result.unreadCount });
      await list.reload();
      void refreshAppData();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const retryInitial = async () => {
    if (!subscription) return;
    try {
      setSubscription(await api.retryInitialFetch(subscription.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (gone) {
    return (
      <AppShell>
        <main style={mainStyle}>
          <h1>購読が見つかりません</h1>
          <p>この購読は削除されたか、表示できません。</p>
          <Link to="/subscriptions" style={{ color: "inherit" }}>
            購読一覧へ戻る
          </Link>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main style={mainStyle}>
        {loading ? (
          <Spinner />
        ) : subscription ? (
          <>
            <header
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${palette.mutedBorder}`,
                display: "flex",
                gap: "8px",
                padding: "8px 0",
              }}
            >
              <IconButton icon="back" label="戻る" onClick={() => navigate(-1)} />
              {subscription.feed.faviconUrl ? (
                <img src={subscription.feed.faviconUrl} alt="" width={20} height={20} style={{ borderRadius: "4px" }} />
              ) : null}
              <h1
                style={{
                  flex: 1,
                  fontSize: "20px",
                  margin: 0,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subscription.customTitle ?? subscription.feed.title}
              </h1>
              <IconButton
                icon="checkCircle"
                label="すべて既読にする"
                onClick={() => void markAllRead()}
              />
              <IconButton
                icon="refresh"
                label={refreshing ? "更新中…" : "フィードを更新"}
                disabled={refreshing}
                onClick={() => void refreshFeed()}
              />
              <div style={{ position: "relative" }}>
                <IconButton icon="more" label="購読の操作" onClick={() => setMenuOpen((v) => !v)} />
                {menuOpen ? (
                  <div style={{ ...menuStyle, minWidth: "180px" }}>
                    <MenuItem
                      label="名前を変更"
                      onClick={() => {
                        setMenuOpen(false);
                        void rename();
                      }}
                    />
                    {subscription.feed.siteUrl ? (
                      <MenuItem
                        label="サイトを開く"
                        onClick={() => {
                          setMenuOpen(false);
                          window.open(subscription.feed.siteUrl ?? "", "_blank", "noreferrer");
                        }}
                      />
                    ) : null}
                    {subscription.feed.feedUrl ? (
                      <MenuItem
                        label="フィードURLを表示"
                        onClick={() => {
                          setMenuOpen(false);
                          window.prompt("フィードURL", subscription.feed.feedUrl);
                        }}
                      />
                    ) : null}
                    <MenuItem
                      label="購読解除"
                      danger
                      onClick={() => {
                        setMenuOpen(false);
                        void unsubscribe();
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </header>

            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 0 0" }}>
              {subscription.initialFetchStatus === "failed" ? (
                <>
                  <Badge tone="danger">{initialFetchErrorMessage(subscription.initialFetchErrorCode)}</Badge>
                  <Button small onClick={() => void retryInitial()}>
                    初回取得を再試行
                  </Button>
                </>
              ) : subscription.initialFetchStatus === "fetching" ? (
                <Badge>記事取得中</Badge>
              ) : subscription.feedHealthStatus === "paused" ? (
                <Badge tone="danger">更新停止中</Badge>
              ) : subscription.feedHealthStatus === "stale" ? (
                <Badge tone="warn">しばらく更新なし</Badge>
              ) : null}
              {allTags.map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  active={subscription.tagIds.includes(tag.id)}
                  onClick={() => void toggleTag(tag.id)}
                />
              ))}
            </div>

            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px", padding: "12px 0 4px" }}>
              <span style={{ color: palette.muted, fontSize: "13px", marginLeft: "auto" }}>並び順</span>
              <select
                value={effectiveSort}
                onChange={(e) => setSort(e.target.value as typeof effectiveSort)}
                aria-label="並び順"
                style={{ fontSize: "13px" }}
              >
                <option value="published_at_desc">公開日時が新しい順</option>
                <option value="fetched_at_desc">取得日時が新しい順</option>
              </select>
            </div>

            {refreshing ? <Spinner label="フィードを更新しています…" /> : null}
            {refreshNotice ? (
              <p style={{ color: palette.muted, fontSize: "13px", margin: "8px 0 0" }}>{refreshNotice}</p>
            ) : null}
            {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
            <ArticleRows
              articles={list.articles}
              loading={list.loading}
              loadingMore={list.loadingMore}
              error={list.error}
              nextCursor={list.nextCursor}
              onRetry={() => void list.reload()}
              onLoadMore={() => void list.loadMore()}
              onUpdateState={(id, patch) => void list.updateState(id, patch)}
              emptyContent={
                subscription.initialFetchStatus === "fetching" ? (
                  <EmptyState>記事を取得しています…</EmptyState>
                ) : (
                  <EmptyState>表示できる記事がありません。</EmptyState>
                )
              }
            />
          </>
        ) : error ? (
          <ErrorBox message={error} onRetry={() => void load()} />
        ) : null}
      </main>
    </AppShell>
  );
}

const mainStyle = {
  padding: "16px 24px 48px",
} as const;
