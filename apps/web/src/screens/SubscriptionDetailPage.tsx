import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api/useApi";
import { ApiRequestError } from "../api/client";
import type { Subscription } from "../api/types";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, useArticleList } from "../components/ArticleList";
import { ArticleListControls } from "../components/ArticleListControls";
import { Badge, Button, EmptyState, ErrorBox, FilterChip, IconButton, MenuItem, Spinner, menuStyle, palette } from "../components/ui";
import { useArticleFilterParams } from "../lib/articleFilters";
import { errorMessage, initialFetchErrorMessage } from "../lib/messages";
import { refreshFeedsAndWait } from "../lib/refresh";
import { trackEvent } from "../lib/analytics";

export function SubscriptionDetailPage() {
  const api = useApi();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const params = useParams();
  const subscriptionId = Number(params.subscriptionId);

  const { tags: allTags, settings, refresh: refreshAppData } = useAppData();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const { read, sort, readOrder, setRead, setSort, setReadOrder } = useArticleFilterParams();
  const filters = useMemo(
    () => ({
      subscriptionId,
      read,
      sort,
      readOrder,
    }),
    [subscriptionId, read, sort, readOrder]
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

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

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
    if (!window.confirm("この購読を解除しますか？ブックマークした記事は残ります。")) return;
    try {
      await api.deleteSubscription(subscription.id);
      void refreshAppData();
      navigate("/subscriptions");
    } catch (e) {
      setError(errorMessage(e));
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

  const refreshFeed = async () => {
    if (!subscription || refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const outcome = await refreshFeedsAndWait(api, { feedId: subscription.feed.id });
      trackEvent("refresh_feed", {
        feed_id: String(subscription.feed.id),
        source: "subscription_detail",
        timed_out: outcome.timedOut,
      });
      if (outcome.timedOut) {
        setRefreshNotice("取得に時間がかかっています。あとで再度更新してください。");
      }
      await list.reload();
      void refreshAppData();
    } catch (e) {
      setRefreshNotice(errorMessage(e));
    } finally {
      setRefreshing(false);
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
                position: "sticky",
                top: isDesktop ? 0 : "51px",
                zIndex: 10,
                background: palette.bg,
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
                icon="refresh"
                label="このフィードを更新"
                disabled={refreshing}
                onClick={() => void refreshFeed()}
              />
              <IconButton
                icon="checkCircle"
                label="すべて既読にする"
                onClick={() => void markAllRead()}
              />
              <div style={{ position: "relative" }}>
                <IconButton
                  icon="more"
                  label="購読の操作"
                  ariaExpanded={menuOpen}
                  ariaHaspopup="menu"
                  ariaControls="filo-subscription-actions"
                  onClick={() => setMenuOpen((v) => !v)}
                />
                {menuOpen ? (
                  <div id="filo-subscription-actions" role="menu" aria-label="購読の操作" style={{ ...menuStyle, minWidth: "180px" }}>
                    <MenuItem
                      label="名前を変更"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void rename();
                      }}
                    />
                    {subscription.feed.siteUrl ? (
                      <MenuItem
                        label="サイトを開く"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          window.open(subscription.feed.siteUrl ?? "", "_blank", "noreferrer");
                        }}
                      />
                    ) : null}
                    {subscription.feed.feedUrl ? (
                      <MenuItem
                        label="フィードURLを表示"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          window.prompt("フィードURL", subscription.feed.feedUrl);
                        }}
                      />
                    ) : null}
                    <MenuItem
                      label="購読解除"
                      role="menuitem"
                      danger
                      onClick={() => {
                        setMenuOpen(false);
                        void unsubscribe();
                      }}
                    />
                  </div>
                ) : null}
              </div>
              <ArticleListControls
                read={read}
                sort={sort}
                readOrder={readOrder}
                defaultSort={settings?.articleSortOrder ?? "published_at_desc"}
                setRead={setRead}
                setSort={setSort}
                setReadOrder={setReadOrder}
                t={(source) => source}
              />
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

            {refreshing ? <Spinner label="フィードを更新しています…" /> : null}
            {refreshNotice ? (
              <p role="status" aria-live="polite" style={{ color: palette.muted, fontSize: "13px", margin: "8px 0 0" }}>
                {refreshNotice}
              </p>
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
