import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { FeedJob, StatusOverview, StatusSubscription } from "../api/types";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  IconButton,
  Spinner,
  Toast,
  formatTime,
  formatTimeCompact,
  palette,
} from "../components/ui";
import { errorMessage } from "../lib/messages";
import { trackEvent } from "../lib/analytics";

// One busy marker for all manual operations: which operation, and for which
// feed ("all" for the bulk buttons).
type BusyOp = { kind: "refresh"; target: number | "all" } | null;
type StatusSortKey = "status" | "feedTitle" | "fetchStatus" | "lastFetchedAt";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "attention" | "fetching" | "paused";

export function StatusPage() {
  const api = useApi();
  const isDesktop = useIsDesktop();
  const { language, t } = useAppData();
  const [status, setStatus] = useState<StatusOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyOp>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<{ key: StatusSortKey; direction: SortDirection }>({
    key: "status",
    direction: "asc",
  });
  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        setStatus(await api.getStatus());
        setError(null);
      } catch (e) {
        // Keep showing the last good snapshot and only surface errors when
        // there is nothing to show.
        setStatus((current) => {
          if (!current || showSpinner) setError(errorMessage(e, language));
          return current;
        });
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [api, language]
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Every manual operation shares the same shape: mark busy, clear the
  // notice, run, show the outcome, reload.
  const run = async (op: NonNullable<BusyOp>, action: () => Promise<string | null>) => {
    setBusy(op);
    setNotice(null);
    try {
      const outcome = await action();
      if (outcome) setNotice(outcome);
      await load();
    } catch (e) {
      setError(errorMessage(e, language));
    } finally {
      setBusy(null);
    }
  };

  const refreshAll = () =>
    run({ kind: "refresh", target: "all" }, async () => {
      const result = await api.refreshFeeds(true);
      trackEvent("refresh_feeds", { source: "status", enqueued: result.enqueued, skipped: result.skipped });
      return result.enqueued > 0
        ? `${result.enqueued}${t("件のフィードの取得を開始しました。")}`
        : t("取得対象のフィードがありません。");
    });

  const refreshFeed = (feedId: number) =>
    run({ kind: "refresh", target: feedId }, async () => {
      await api.refreshFeed(feedId);
      trackEvent("refresh_feed", { feed_id: String(feedId), source: "status" });
      return t("フィードの取得を開始しました。");
    });

  const refreshing = busy?.kind === "refresh";
  const visibleSubscriptions = useMemo(() => {
    if (!status) return [];
    const query = filterText.trim().toLocaleLowerCase();
    return status.subscriptionStatuses
      .filter((sub) => {
        if (query && !sub.feedTitle.toLocaleLowerCase().includes(query)) return false;
        if (statusFilter === "attention") return hasAttention(sub);
        if (statusFilter === "fetching") return isFetching(sub);
        if (statusFilter === "paused") return sub.feedStatus === "paused";
        return true;
      })
      .sort((a, b) => compareSubscriptions(a, b, sort, language));
  }, [filterText, language, sort, status, statusFilter]);

  const changeSort = (key: StatusSortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const rowState = (sub: StatusSubscription) => {
    const fetchBusy = isActiveJob(sub.fetchJob) || (refreshing && busy?.target === sub.feedId);
    const rowError = sub.fetchJob?.status === "failed" ? sub.fetchJob.lastError ?? sub.lastError : hasFetchAttention(sub) ? sub.lastError : null;
    return { fetchBusy, rowError };
  };

  const fetchButton = (sub: StatusSubscription, fetchBusy: boolean) => (
    <IconButton
      icon="refresh"
      label={fetchBusy ? t("取得中…") : t("このフィードを取得")}
      size={16}
      disabled={refreshing || fetchBusy}
      onClick={() => void refreshFeed(sub.feedId)}
    />
  );

  return (
    <AppShell
      title={t("処理ステータス")}
      actions={
        <>
          <IconButton icon="refresh" label={t("再読み込み")} onClick={() => void load(true)} />
          <Button small kind="primary" disabled={refreshing} onClick={() => void refreshAll()}>
            {refreshing && busy?.target === "all" ? t("取得中…") : t("すべて取得")}
          </Button>
        </>
      }
    >
      <main className="fl-page">
        <div className="fl-stack">
          {error ? <ErrorBox message={error} onRetry={() => void load(true)} /> : null}

          {loading || !status ? (
            <Spinner />
          ) : (
            <>
              <div className="fl-card fl-stat-grid">
                <Stat label={t("購読")} value={String(status.feeds.total)} />
                <Stat label={t("記事")} value={status.articles.total.toLocaleString()} />
                <Stat label={t("最終取得")} value={status.feeds.lastFetchedAt ? (isDesktop ? formatTime : formatTimeCompact)(status.feeds.lastFetchedAt, language) : "—"} />
              </div>

              <section aria-labelledby="filo-status-subscriptions">
                <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px 12px", marginBottom: "12px" }}>
                  <h2 id="filo-status-subscriptions" style={{ flex: "1 1 auto", fontSize: "15px", margin: 0 }}>
                    {t("購読一覧（{count}）", { count: status.subscriptionStatuses.length })}
                  </h2>
                  {status.subscriptionStatuses.length > 0 ? (
                    <div style={{ alignItems: "center", display: "flex", flex: isDesktop ? "0 1 auto" : "1 1 100%", gap: "8px" }}>
                      <input
                        type="search"
                        className="fl-input"
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder={t("購読名で検索")}
                        aria-label={t("購読名で検索")}
                        style={{ flex: 1, width: isDesktop ? "240px" : undefined }}
                      />
                      <select
                        value={statusFilter}
                        aria-label={t("状態")}
                        className="fl-select"
                        onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                      >
                        <option value="all">{t("すべて")}</option>
                        <option value="attention">{t("問題あり")}</option>
                        <option value="fetching">{t("取得中")}</option>
                        <option value="paused">{t("停止")}</option>
                      </select>
                      <span role="status" aria-live="polite" style={{ color: palette.muted, flexShrink: 0, fontSize: "12px", fontVariantNumeric: "tabular-nums", minWidth: "44px", textAlign: "right" }}>
                        {visibleSubscriptions.length}/{status.subscriptionStatuses.length}
                      </span>
                    </div>
                  ) : null}
                </div>
                {status.subscriptionStatuses.length === 0 ? (
                  <EmptyState icon="rss">{t("購読がありません。")}</EmptyState>
                ) : visibleSubscriptions.length === 0 ? (
                  <EmptyState>{t("条件に一致する購読がありません。")}</EmptyState>
                ) : isDesktop ? (
                  <table aria-label={t("購読一覧")} className="fl-table">
                    <thead>
                      <tr>
                        <SortableHeader label={t("状態")} sortKey="status" sort={sort} onSort={changeSort} width="120px" />
                        <SortableHeader label={t("購読")} sortKey="feedTitle" sort={sort} onSort={changeSort} />
                        <SortableHeader label={t("取得")} sortKey="fetchStatus" sort={sort} onSort={changeSort} width="120px" />
                        <SortableHeader label={t("最終取得")} sortKey="lastFetchedAt" sort={sort} onSort={changeSort} width="150px" />
                        <th scope="col" style={{ padding: "8px 0", textAlign: "right", width: "48px" }}>
                          <span style={{ border: 0, clip: "rect(0 0 0 0)", height: "1px", overflow: "hidden", position: "absolute", width: "1px" }}>{t("操作")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSubscriptions.map((sub) => {
                        const { fetchBusy, rowError } = rowState(sub);
                        return (
                          <tr key={sub.subscriptionId} style={hasAttention(sub) ? { background: palette.dangerBg } : undefined}>
                            <td><StatusBadge sub={sub} t={t} /></td>
                            <td style={{ maxWidth: 0, width: "100%" }}>
                              <Link
                                to={`/subscriptions/${sub.subscriptionId}`}
                                className="fl-link"
                                style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              >
                                {sub.feedTitle}
                              </Link>
                              {rowError ? (
                                <p style={{ color: palette.danger, fontSize: "12px", margin: "4px 0 0", overflowWrap: "anywhere" }}>{rowError}</p>
                              ) : null}
                            </td>
                            <td>
                              <JobBadge label={t("取得")} job={sub.fetchJob} fallback={fetchFallbackBadge(sub.lastResult, t)} t={t} />
                            </td>
                            <td style={{ color: palette.muted, fontSize: "13px", whiteSpace: "nowrap" }}>
                              {sub.lastFetchedAt ? formatTime(sub.lastFetchedAt, language) : "—"}
                            </td>
                            <td style={{ padding: "4px 0", textAlign: "right" }}>{fetchButton(sub, fetchBusy)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <ul aria-label={t("購読一覧")} className="fl-list" style={{ borderTop: `1px solid ${palette.mutedBorder}` }}>
                    {visibleSubscriptions.map((sub) => {
                      const { fetchBusy, rowError } = rowState(sub);
                      return (
                        <li key={sub.subscriptionId} className="fl-list-row" style={{ alignItems: "flex-start", gap: "8px" }}>
                          <div style={{ display: "grid", flex: 1, gap: "4px", minWidth: 0 }}>
                            <Link
                              to={`/subscriptions/${sub.subscriptionId}`}
                              className="fl-link"
                              style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                              {sub.feedTitle}
                            </Link>
                            <div style={{ alignItems: "center", color: palette.muted, display: "flex", flexWrap: "wrap", fontSize: "12px", gap: "6px 10px" }}>
                              <StatusBadge sub={sub} t={t} />
                              {(sub.fetchJob && sub.fetchJob.status !== "completed") || sub.lastResult === "error" ? (
                                <JobBadge label={t("取得")} job={sub.fetchJob} fallback={fetchFallbackBadge(sub.lastResult, t)} t={t} />
                              ) : null}
                              <span>{sub.lastFetchedAt ? formatTime(sub.lastFetchedAt, language) : "—"}</span>
                            </div>
                            {rowError ? (
                              <p style={{ color: palette.danger, fontSize: "12px", margin: 0, overflowWrap: "anywhere" }}>{rowError}</p>
                            ) : null}
                          </div>
                          {fetchButton(sub, fetchBusy)}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </main>
      {notice ? <Toast message={notice} /> : null}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="fl-stat">
      <span className="fl-stat-label">{label}</span>
      <span className="fl-stat-value">{value}</span>
    </div>
  );
}

function hasAttention(sub: StatusSubscription): boolean {
  return hasFetchAttention(sub);
}

function hasFetchAttention(sub: StatusSubscription): boolean {
  return sub.consecutiveFailures > 0 || sub.fetchJob?.status === "failed" || sub.lastResult === "error";
}

function isFetching(sub: StatusSubscription): boolean {
  return sub.fetchJob?.status === "pending" || sub.fetchJob?.status === "running";
}

function compareSubscriptions(
  a: StatusSubscription,
  b: StatusSubscription,
  sort: { key: StatusSortKey; direction: SortDirection },
  language: string,
): number {
  if (sort.key === "lastFetchedAt") {
    if (!a.lastFetchedAt && !b.lastFetchedAt) return 0;
    if (!a.lastFetchedAt) return 1;
    if (!b.lastFetchedAt) return -1;
  }

  let comparison = 0;
  if (sort.key === "status") {
    comparison = overallStatusRank(a) - overallStatusRank(b);
  } else if (sort.key === "feedTitle") {
    comparison = a.feedTitle.localeCompare(b.feedTitle, language);
  } else if (sort.key === "fetchStatus") {
    comparison = fetchStatusRank(a) - fetchStatusRank(b);
  } else {
    comparison = new Date(a.lastFetchedAt ?? 0).getTime() - new Date(b.lastFetchedAt ?? 0).getTime();
  }

  if (comparison === 0) comparison = a.feedTitle.localeCompare(b.feedTitle, language);
  return sort.direction === "asc" ? comparison : -comparison;
}

function fetchStatusRank(sub: StatusSubscription): number {
  if (hasFetchAttention(sub)) return 0;
  if (sub.fetchJob?.stalled) return 1;
  if (sub.fetchJob?.status === "running") return 2;
  if (sub.fetchJob?.status === "pending") return 3;
  if (sub.feedStatus === "paused") return 4;
  return 5;
}

// Keep the most actionable rows at the top. This is also the default sort, so
// a row moves automatically when the next status poll observes a transition.
function overallStatusRank(sub: StatusSubscription): number {
  if (hasAttention(sub)) return 0;
  if (sub.fetchJob?.stalled) return 1;
  if (sub.fetchJob?.status === "running") return 2;
  if (sub.fetchJob?.status === "pending") return 3;
  if (sub.feedStatus === "paused") return 4;
  return 5;
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  width,
}: {
  label: string;
  sortKey: StatusSortKey;
  sort: { key: StatusSortKey; direction: SortDirection };
  onSort: (key: StatusSortKey) => void;
  width?: string;
}) {
  const active = sort.key === sortKey;
  const direction = active ? sort.direction : undefined;
  return (
    <th
      scope="col"
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        style={{ alignItems: "center", background: "transparent", border: "none", color: active ? palette.text : "inherit", cursor: "pointer", display: "inline-flex", font: "inherit", gap: "4px", padding: "8px 0", textAlign: "left" }}
      >
        {label}
        <span aria-hidden="true" style={{ color: active ? palette.accent : palette.muted, opacity: active ? 1 : 0.6 }}>{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}

function StatusBadge({ sub, t }: { sub: StatusSubscription; t: (source: string) => string }) {
  if (hasAttention(sub)) return <Badge tone="danger">{t("失敗")}</Badge>;
  if (sub.fetchJob?.stalled) return <Badge tone="danger">{t("中断")}</Badge>;
  if (sub.fetchJob?.status === "running") return <Badge tone="warn">{t("取得中")}</Badge>;
  if (sub.fetchJob?.status === "pending") return <Badge tone="warn">{t("取得待ち")}</Badge>;
  if (sub.feedStatus === "paused") return <Badge tone="muted">{t("停止")}</Badge>;
  return <Badge tone="ok">{t("完了")}</Badge>;
}

// A stalled job (pending/running but untouched past the stall window) is not
// treated as active, so its row buttons stay enabled and the user can re-run.
function isActiveJob(job: FeedJob | null): boolean {
  return (job?.status === "pending" || job?.status === "running") && !job.stalled;
}

// Per-row job badge: hidden when idle (never requested or completed), so the
// list stays quiet unless something is queued, running, or broken.
function JobBadge({ label, job, fallback, t }: { label: string; job: FeedJob | null; fallback?: { label: string; tone: "danger" | "warn" | "ok" | "muted" } | null; t: (source: string) => string }) {
  if (!job || job.status === "completed") {
    return fallback ? <Badge tone={fallback.tone}>{fallback.label}</Badge> : <span style={{ color: palette.muted }}>—</span>;
  }
  if (job.stalled) return <Badge tone="danger">{label}{t("中断")}</Badge>;
  if (job.status === "failed") return <Badge tone="danger">{label}{t("失敗")}</Badge>;
  if (job.status === "running") return <Badge tone="warn">{label}{t("中")}</Badge>;
  return <Badge tone="warn">{label}{t("待ち")}</Badge>;
}

function fetchFallbackBadge(lastResult: string | null, t: (source: string) => string) {
  if (lastResult === "error") return { label: t("取得失敗"), tone: "danger" as const };
  return null;
}
