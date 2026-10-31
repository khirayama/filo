import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api/useApi";
import { ApiRequestError } from "../api/client";
import type { Subscription } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, NewArticlesNotice, useArticleList } from "../components/ArticleList";
import { ArticleListControls } from "../components/ArticleListControls";
import { useDialogs } from "../components/Dialogs";
import { PullToRefresh } from "../components/PullToRefresh";
import { SubscriptionHealth } from "../components/SubscriptionHealth";
import { TagPicker } from "../components/TagPicker";
import { Button, EmptyState, ErrorBox, IconButton, MenuItem, Spinner, Toast, palette, usePopover } from "../components/ui";
import { ShortcutHelpDialog, useArticleShortcuts } from "../components/useArticleShortcuts";
import { useSubscriptionFetchPolling } from "../components/useSubscriptionFetchPolling";
import { useArticleFilterParams } from "../lib/articleFilters";
import { errorMessage } from "../lib/messages";
import { enqueueFeedRefresh, refreshNoticeMessage } from "../lib/refresh";
import { trackEvent } from "../lib/analytics";
import { useBackOr } from "../lib/navigation";

export function SubscriptionDetailPage() {
  const api = useApi();
  const navigate = useNavigate();
  const goBack = useBackOr("/subscriptions");
  const params = useParams();
  const subscriptionId = Number(params.subscriptionId);

  const { tags: allTags, settings, refresh: refreshAppData, language, t } = useAppData();
  const { confirm, prompt, showCopyable } = useDialogs();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { open: menuOpen, setOpen: setMenuOpen, ref: menuRef } = usePopover();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [markAllNotice, setMarkAllNotice] = useState<string | null>(null);
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

  useEffect(() => {
    if (!refreshNotice) return;
    const timer = window.setTimeout(() => setRefreshNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [refreshNotice]);

  useEffect(() => {
    if (!markAllNotice) return;
    const timer = window.setTimeout(() => setMarkAllNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [markAllNotice]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubscription(await api.getSubscription(subscriptionId));
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) setGone(true);
      else setError(errorMessage(e, language));
    } finally {
      setLoading(false);
    }
  }, [api, language, subscriptionId]);

  // Keeps the rows on screen during a refresh; another feed starts empty.
  useEffect(() => {
    setSubscription(null);
    setGone(false);
    void load();
  }, [load]);

  useSubscriptionFetchPolling(api, subscription, (settled) => {
    setSubscription(settled);
    void list.reload();
    void refreshAppData();
  });

  const rename = async () => {
    if (!subscription) return;
    const title = await prompt({
      title: t("購読名を変更"),
      initialValue: subscription.customTitle ?? "",
      placeholder: t("空欄でフィード名に戻す"),
      confirmLabel: t("変更"),
      allowEmpty: true,
    });
    if (title === null) return;
    try {
      setSubscription(await api.updateSubscription(subscription.id, title || null));
      void refreshAppData();
    } catch (e) {
      setError(errorMessage(e, language));
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
      setError(errorMessage(e, language));
    }
  };

  const unsubscribe = async () => {
    if (!subscription) return;
    const confirmed = await confirm({
      title: t("この購読を解除しますか？"),
      message: t("ブックマークした記事は残ります。"),
      confirmLabel: t("購読解除"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deleteSubscription(subscription.id);
      void refreshAppData();
      navigate("/subscriptions");
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const markAllRead = async () => {
    const upToArticleId = list.markAllUpToId;
    if (!subscription || markingAllRead || upToArticleId === null) return;
    const confirmed = await confirm({
      title: t("「{name}」の記事をすべて既読にしますか？", { name: subscription.customTitle ?? subscription.feed.title }),
      confirmLabel: t("すべて既読にする"),
    });
    if (!confirmed) return;
    setMarkingAllRead(true);
    setMarkAllNotice(null);
    setError(null);
    const rollback = list.markAllReadLocally();
    try {
      const result = await api.markAllRead(subscription.id, upToArticleId);
      setSubscription({ ...subscription, unreadCount: result.unreadCount });
      await list.reload();
      void refreshAppData();
      setMarkAllNotice(t("既読への変更が完了しました。"));
    } catch (e) {
      rollback();
      setError(errorMessage(e, language));
    } finally {
      setMarkingAllRead(false);
    }
  };

  const retryInitial = async () => {
    if (!subscription) return;
    try {
      setSubscription(await api.retryInitialFetch(subscription.id));
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const refreshFeed = async () => {
    if (!subscription || refreshing) return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const outcome = await enqueueFeedRefresh(api, { feedId: subscription.feed.id });
      trackEvent("refresh_feed", {
        feed_id: String(subscription.feed.id),
        source: "subscription_detail",
        timed_out: outcome.timedOut,
      });
      setRefreshNotice(refreshNoticeMessage(outcome, t));
      await load();
      await list.reload();
      void refreshAppData();
    } catch (e) {
      setRefreshNotice(errorMessage(e, language));
    } finally {
      setRefreshing(false);
    }
  };

  const shortcuts = useArticleShortcuts({
    articles: list.articles,
    onUpdateState: (id, patch) => void list.updateState(id, patch),
    onRefresh: () => void refreshFeed(),
    onMarkAll: () => void markAllRead(),
  });

  if (gone) {
    return (
      <AppShell title={t("購読が見つかりません")} onBack={goBack}>
        <main className="fl-page">
          <EmptyState icon="rss">
            <p>{t("この購読は削除されたか、表示できません。")}</p>
            <Link to="/subscriptions" className="fl-btn fl-btn--secondary">
              {t("購読一覧へ戻る")}
            </Link>
          </EmptyState>
        </main>
      </AppShell>
    );
  }

  const title = subscription ? subscription.customTitle ?? subscription.feed.title : "";
  const assignedTags = subscription ? allTags.filter((tag) => subscription.tagIds.includes(tag.id)) : [];

  return (
    <AppShell
      title={title}
      onBack={goBack}
      actions={
        subscription ? (
          <>
            <IconButton
              icon="refresh"
              label={t("このフィードを更新")}
              disabled={refreshing}
              spinning={refreshing}
              onClick={() => void refreshFeed()}
            />
            <IconButton
              icon="checkAll"
              label={t("すべて既読にする")}
              disabled={markingAllRead || list.markAllUpToId === null}
              onClick={() => void markAllRead()}
            />
            <div ref={menuRef} style={{ position: "relative" }}>
              <IconButton
                icon="more"
                label={t("購読の操作")}
                ariaExpanded={menuOpen}
                ariaHaspopup="menu"
                ariaControls="filo-subscription-actions"
                onClick={() => setMenuOpen((v) => !v)}
              />
              {menuOpen ? (
                <div id="filo-subscription-actions" role="menu" aria-label={t("購読の操作")} className="fl-menu" style={{ minWidth: "200px" }}>
                  <MenuItem
                    label={t("名前を変更")}
                    icon="pencil"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      void rename();
                    }}
                  />
                  {subscription.feed.siteUrl ? (
                    <MenuItem
                      label={t("サイトを開く")}
                      icon="externalLink"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        window.open(subscription.feed.siteUrl ?? "", "_blank", "noreferrer");
                      }}
                    />
                  ) : null}
                  {subscription.feed.feedUrl ? (
                    <MenuItem
                      label={t("フィードURLを表示")}
                      icon="rss"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        void showCopyable({ title: t("フィードURL"), value: subscription.feed.feedUrl ?? "" });
                      }}
                    />
                  ) : null}
                  <div className="fl-menu-divider" />
                  <MenuItem
                    label={t("購読解除")}
                    icon="trash"
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
              t={t}
            />
          </>
        ) : undefined
      }
    >
      <main aria-busy={markingAllRead} style={{ paddingBottom: "32px" }}>
        <PullToRefresh disabled={refreshing || !subscription} onRefresh={() => void refreshFeed()} />
        {loading && !subscription ? (
          <Spinner />
        ) : subscription ? (
          <>
            <div
              style={{
                alignItems: "center",
                borderBottom: `1px solid ${palette.mutedBorder}`,
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                padding: "10px var(--fl-page-gutter)",
              }}
            >
              <SubscriptionHealth subscription={subscription} />
              {subscription.initialFetchStatus === "failed" ? (
                <Button small onClick={() => void retryInitial()}>
                  {t("初回取得を再試行")}
                </Button>
              ) : subscription.feedHealthStatus === "paused" ? (
                <Button small disabled={refreshing} onClick={() => void refreshFeed()}>
                  {t("更新を再開")}
                </Button>
              ) : null}
              {assignedTags.map((tag) => (
                <Link key={tag.id} to={`/articles?tagId=${tag.id}`} className="fl-chip" style={{ textDecoration: "none" }}>
                  {tag.color ? <span style={{ background: tag.color, borderRadius: "50%", height: "8px", width: "8px" }} /> : null}
                  {tag.name}
                </Link>
              ))}
              <TagPicker
                id="filo-subscription-tag-menu"
                tags={allTags}
                selectedIds={subscription.tagIds}
                onToggle={(tagId) => void toggleTag(tagId)}
                variant="button"
              />
            </div>

            {refreshing ? <Spinner label={t("フィードを更新しています…")} /> : null}
            {refreshNotice ? <Toast message={refreshNotice} /> : null}
            {error ? <div style={{ padding: "16px var(--fl-page-gutter) 0" }}><ErrorBox message={error} onRetry={() => void load()} /></div> : null}
            <NewArticlesNotice visible={list.hasNewArticles} disabled={list.loading || refreshing || markingAllRead} onLoad={() => {
              void list.reload().then((loaded) => {
                if (loaded) document.querySelector("[data-filo-page-header]")?.scrollIntoView({ block: "start" });
              });
            }} />
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
              showFeed={false}
              emptyContent={
                subscription.initialFetchStatus === "fetching" ? (
                  <EmptyState icon="refresh">{t("記事を取得しています…")}</EmptyState>
                ) : read !== undefined ? (
                  <EmptyState icon="sliders">
                    <p>{read ? t("既読の記事はありません。") : t("未読の記事はありません。")}</p>
                    <Button onClick={() => setRead(undefined)}>{t("絞り込みを解除")}</Button>
                  </EmptyState>
                ) : (
                  <EmptyState icon="inbox">{t("表示できる記事がありません。")}</EmptyState>
                )
              }
            />
          </>
        ) : error ? (
          <div style={{ padding: "16px var(--fl-page-gutter)" }}><ErrorBox message={error} onRetry={() => void load()} /></div>
        ) : null}
      </main>
      {markAllNotice ? <Toast message={markAllNotice} /> : null}
      {shortcuts.helpOpen ? <ShortcutHelpDialog onClose={shortcuts.closeHelp} /> : null}
    </AppShell>
  );
}
