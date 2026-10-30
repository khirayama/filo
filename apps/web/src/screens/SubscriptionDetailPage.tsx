import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api/useApi";
import { ApiRequestError } from "../api/client";
import type { Subscription } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { ArticleRows, NewArticlesNotice, useArticleList } from "../components/ArticleList";
import { ArticleListControls } from "../components/ArticleListControls";
import { PullToRefresh } from "../components/PullToRefresh";
import { SubscriptionHealth } from "../components/SubscriptionHealth";
import { TagPicker } from "../components/TagPicker";
import { Button, EmptyState, ErrorBox, IconButton, MenuItem, Spinner, Toast, palette, useDialogFocus, usePopover } from "../components/ui";
import { useArticleFilterParams } from "../lib/articleFilters";
import { errorMessage } from "../lib/messages";
import { enqueueFeedRefresh } from "../lib/refresh";
import { trackEvent } from "../lib/analytics";
import { useBackOr } from "../lib/navigation";
import { articleShortcut } from "../lib/articleShortcuts";

export function SubscriptionDetailPage() {
  const api = useApi();
  const navigate = useNavigate();
  const goBack = useBackOr("/subscriptions");
  const params = useParams();
  const subscriptionId = Number(params.subscriptionId);

  const { tags: allTags, settings, refresh: refreshAppData, language, t } = useAppData();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { open: menuOpen, setOpen: setMenuOpen, ref: menuRef } = usePopover();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [markAllNotice, setMarkAllNotice] = useState<string | null>(null);
  const [activeArticleIndex, setActiveArticleIndex] = useState<number | null>(null);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const closeShortcutHelp = useCallback(() => setShowShortcutHelp(false), []);
  useDialogFocus(showShortcutHelp, "filo-subscription-shortcuts", closeShortcutHelp);
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

  useEffect(() => {
    void load();
  }, [load]);

  const rename = async () => {
    if (!subscription) return;
    const title = window.prompt(t("購読名を変更（空欄でフィード名に戻す）"), subscription.customTitle ?? "");
    if (title === null) return;
    try {
      setSubscription(await api.updateSubscription(subscription.id, title.trim() || null));
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
    if (!window.confirm(t("この購読を解除しますか？ブックマークした記事は残ります。"))) return;
    try {
      await api.deleteSubscription(subscription.id);
      void refreshAppData();
      navigate("/subscriptions");
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const markAllRead = async () => {
    if (!subscription || markingAllRead) return;
    setMarkingAllRead(true);
    setMarkAllNotice(null);
    setError(null);
    const rollback = list.markAllReadLocally();
    try {
      const result = await api.markAllRead(subscription.id);
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
      if (outcome.timedOut) setRefreshNotice(t("取得に時間がかかっています。あとで再度更新してください。"));
      else if (outcome.enqueued > 0) setRefreshNotice(`${outcome.enqueued}${t("件のフィードを更新しました。")}`);
      await load();
      await list.reload();
      void refreshAppData();
    } catch (e) {
      setRefreshNotice(errorMessage(e, language));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showShortcutHelp) {
        if (event.key === "Escape") { event.preventDefault(); setShowShortcutHelp(false); }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false'])")) return;
      const action = articleShortcut(event);
      if (action === "markAll") { event.preventDefault(); void markAllRead(); return; }
      if (action === "next" || action === "previous") {
        event.preventDefault();
        if (!list.articles.length) return;
        const step = action === "next" ? 1 : -1;
        setActiveArticleIndex((current) => {
          const visible = (index: number) => {
            const row = document.getElementById(`filo-article-${list.articles[index]?.id}`);
            const rect = row?.getBoundingClientRect();
            const header = document.querySelector<HTMLElement>("[data-filo-page-header]")?.getBoundingClientRect().bottom ?? 0;
            return !!rect && rect.bottom > header && rect.top < window.innerHeight;
          };
          if (current != null && visible(current)) return Math.max(0, Math.min(list.articles.length - 1, current + step));
          const first = list.articles.findIndex((_, index) => visible(index));
          return first < 0 ? 0 : first;
        });
      } else if (action === "open" || action === "external" || action === "read" || action === "list" || action === "bookmark") {
        event.preventDefault();
        const index = activeArticleIndex ?? 0;
        const article = list.articles[index];
        if (!article) return;
        setActiveArticleIndex(index);
        if (action === "open" || action === "external") {
          if (article.canonicalUrl) window.open(article.canonicalUrl, "_blank", "noopener,noreferrer");
        } else {
          const patch = action === "read" ? { isRead: !article.userState.isRead }
            : action === "list" ? { inReadingList: !article.userState.inReadingList }
              : { isBookmarked: !article.userState.isBookmarked };
          void list.updateState(article.id, patch);
        }
      } else if (action === "refresh") { event.preventDefault(); void refreshFeed(); }
      else if (action === "help") { event.preventDefault(); setShowShortcutHelp(true); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    setActiveArticleIndex((index) => index == null || list.articles.length === 0 ? null : Math.min(index, list.articles.length - 1));
  }, [list.articles.length]);
  useEffect(() => {
    const article = activeArticleIndex == null ? undefined : list.articles[activeArticleIndex];
    if (article) document.getElementById(`filo-article-${article.id}`)?.scrollIntoView({ block: "center" });
  }, [activeArticleIndex, list.articles]);

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
              disabled={markingAllRead}
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
                        window.prompt(t("フィードURL"), subscription.feed.feedUrl);
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
        {loading ? (
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
              activeArticleId={activeArticleIndex == null ? undefined : list.articles[activeArticleIndex]?.id}
              showFeed={false}
              emptyContent={
                subscription.initialFetchStatus === "fetching" ? (
                  <EmptyState icon="refresh">{t("記事を取得しています…")}</EmptyState>
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
      {showShortcutHelp ? (
        <div role="dialog" id="filo-subscription-shortcuts" aria-modal="true" aria-labelledby="filo-subscription-shortcuts-title" onClick={closeShortcutHelp} className="fl-dialog-scrim">
          <section onClick={(event) => event.stopPropagation()} className="fl-dialog" style={{ maxWidth: "360px" }}>
            <div className="fl-dialog-header">
              <h2 id="filo-subscription-shortcuts-title">{t("ショートカット")}</h2>
              <IconButton icon="close" label={t("閉じる")} onClick={closeShortcutHelp} />
            </div>
            <pre style={{ fontFamily: "inherit", fontSize: "14px", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>{t("ショートカットヘルプ")}</pre>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
