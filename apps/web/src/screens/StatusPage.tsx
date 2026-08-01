import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { FeedJob, StatusOverview, StatusSubscription } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBox,
  IconButton,
  Spinner,
  formatTime,
  palette,
  sectionStyle,
} from "../components/ui";
import { errorMessage } from "../lib/messages";

const POLL_INTERVAL_MS = 5000;

// One busy marker for all manual operations: which operation, and for which
// feed ("all" for the bulk buttons).
type BusyOp = { kind: "refresh"; target: number | "all" } | null;
type StatusSortKey = "status" | "feedTitle" | "fetchStatus" | "lastFetchedAt";
type SortDirection = "asc" | "desc";
type StatusFilter = "all" | "attention" | "fetching" | "paused";

export function StatusPage() {
  const api = useApi();
  const navigate = useNavigate();
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
  const pollRef = useRef<number | null>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        setStatus(await api.getStatus());
        setError(null);
      } catch (e) {
        // Background polls fail transiently (network blips); keep showing the
        // last good snapshot and only surface errors when there is nothing.
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
    pollRef.current = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [load]);

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
      return result.enqueued > 0
        ? `${result.enqueued}${t("件のフィードの取得を開始しました。")}`
        : t("取得対象のフィードがありません。");
    });

  const refreshFeed = (feedId: number) =>
    run({ kind: "refresh", target: feedId }, async () => {
      await api.refreshFeed(feedId);
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

  return (
    <AppShell>
      <main style={{ padding: "16px 24px 48px" }}>
        <header
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${palette.mutedBorder}`,
            display: "flex",
            gap: "8px",
            padding: "8px 0",
          }}
        >
          <IconButton icon="back" label={t("戻る")} onClick={() => navigate(-1)} />
          <h1 style={{ flex: 1, fontSize: "20px", margin: 0 }}>{t("処理ステータス")}</h1>
          <IconButton icon="refresh" label={t("再読み込み")} onClick={() => void load(true)} />
        </header>

        {error ? <ErrorBox message={error} onRetry={() => void load(true)} /> : null}

        {loading || !status ? (
          <Spinner />
        ) : (
          <>
            <section style={sectionStyle}>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px" }}>
                <p style={{ flex: 1, fontWeight: 600, margin: 0, minWidth: "120px" }}>{t("操作")}</p>
                <Button kind="primary" disabled={refreshing} onClick={() => void refreshAll()}>
                  {refreshing && busy?.target === "all" ? t("取得中…") : t("すべて取得")}
                </Button>
              </div>
              {notice ? (
                <p style={{ color: palette.muted, fontSize: "13px", margin: "12px 0 0" }}>{notice}</p>
              ) : null}
              <p style={{ color: palette.muted, fontSize: "12px", margin: "12px 0 0" }}>
                {t("購読")} {status.feeds.total}・{t("記事")} {status.articles.total}
                {status.feeds.lastFetchedAt ? `・最終取得 ${formatTime(status.feeds.lastFetchedAt)}` : ""}
                ・約{Math.round(POLL_INTERVAL_MS / 1000)}秒ごとに自動更新
              </p>
            </section>

            <section style={sectionStyle}>
              <p style={{ fontWeight: 600, margin: "0 0 4px" }}>{t("購読一覧")}（{status.subscriptionStatuses.length}）</p>
              {status.subscriptionStatuses.length === 0 ? (
                <EmptyState>{t("購読がありません。")}</EmptyState>
              ) : (
                <>
                  <div style={{ alignItems: "end", display: "flex", flexWrap: "wrap", gap: "12px", margin: "12px 0" }}>
                    <label style={{ display: "grid", gap: "4px", minWidth: "220px" }}>
                      <span style={{ color: palette.muted, fontSize: "12px" }}>{t("検索")}</span>
                      <input
                        type="search"
                        value={filterText}
                        onChange={(e) => setFilterText(e.target.value)}
                        placeholder={t("購読名で検索")}
                        aria-label={t("購読名で検索")}
                        style={{ border: `1px solid ${palette.border}`, borderRadius: "4px", fontSize: "14px", padding: "7px 8px", width: "220px" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: "4px" }}>
                      <span style={{ color: palette.muted, fontSize: "12px" }}>{t("状態")}</span>
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                        style={{ border: `1px solid ${palette.border}`, borderRadius: "4px", fontSize: "14px", padding: "7px 8px" }}
                      >
                        <option value="all">{t("すべて")}</option>
                        <option value="attention">{t("問題あり")}</option>
                        <option value="fetching">{t("取得中")}</option>
                        <option value="paused">{t("停止")}</option>
                      </select>
                    </label>
                    <span style={{ color: palette.muted, fontSize: "12px", paddingBottom: "8px" }}>
                      {visibleSubscriptions.length}/{status.subscriptionStatuses.length}
                    </span>
                  </div>
                  {visibleSubscriptions.length === 0 ? (
                    <EmptyState>{t("条件に一致する購読がありません。")}</EmptyState>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "collapse", minWidth: "900px", width: "100%" }}>
                        <thead>
                          <tr style={{ borderBottom: `2px solid ${palette.border}`, textAlign: "left" }}>
                            <SortableHeader label={t("状態")} sortKey="status" sort={sort} onSort={changeSort} />
                            <SortableHeader label={t("購読")} sortKey="feedTitle" sort={sort} onSort={changeSort} />
                            <SortableHeader label={t("取得")} sortKey="fetchStatus" sort={sort} onSort={changeSort} />
                            <SortableHeader label={t("最終取得")} sortKey="lastFetchedAt" sort={sort} onSort={changeSort} />
                            <th scope="col" style={{ padding: "8px", whiteSpace: "nowrap" }}>{t("操作")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleSubscriptions.map((sub) => {
                            const isError = hasAttention(sub);
                            const fetchBusy = isActiveJob(sub.fetchJob) || (refreshing && busy?.target === sub.feedId);
                            const rowError = sub.fetchJob?.status === "failed" ? sub.fetchJob.lastError ?? sub.lastError : hasFetchAttention(sub) ? sub.lastError : null;
                            return (
                              <tr key={sub.subscriptionId} style={{ background: isError ? palette.dangerBg : undefined, borderBottom: `1px solid ${palette.mutedBorder}`, verticalAlign: "top" }}>
                                <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>
                                  <StatusBadge sub={sub} t={t} />
                                </td>
                                <td style={{ maxWidth: "260px", padding: "10px 8px" }}>
                                  <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                    <a
                                      href={`/subscriptions/${sub.subscriptionId}`}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        navigate(`/subscriptions/${sub.subscriptionId}`);
                                      }}
                                      style={{ color: "inherit", overflow: "hidden", textDecoration: "underline", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                    >
                                      {sub.feedTitle}
                                    </a>
                                    {sub.feedStatus === "paused" ? <Badge tone="muted">{t("停止")}</Badge> : null}
                                  </div>
                                  {rowError ? (
                                    <p style={{ color: palette.danger, fontSize: "12px", margin: "5px 0 0", overflowWrap: "anywhere" }}>{rowError}</p>
                                  ) : null}
                                </td>
                                <td style={{ padding: "10px 8px", whiteSpace: "nowrap" }}>
                                  <JobBadge label={t("取得")} job={sub.fetchJob} fallback={fetchFallbackBadge(sub.lastResult, t)} t={t} />
                                </td>
                                <td style={{ color: palette.muted, fontSize: "12px", padding: "10px 8px", whiteSpace: "nowrap" }}>
                                  {sub.lastFetchedAt ? formatTime(sub.lastFetchedAt) : "—"}
                                </td>
                                <td style={{ padding: "8px" }}>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                    <RowAction
                                      label={fetchBusy ? t("取得中…") : t("取得")}
                                      title={t("このフィードを取得")}
                                      disabled={refreshing || fetchBusy}
                                      onClick={() => void refreshFeed(sub.feedId)}
                                    />
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </AppShell>
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
}: {
  label: string;
  sortKey: StatusSortKey;
  sort: { key: StatusSortKey; direction: SortDirection };
  onSort: (key: StatusSortKey) => void;
}) {
  const active = sort.key === sortKey;
  const direction = active ? sort.direction : undefined;
  return (
    <th
      scope="col"
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      style={{ padding: "0 8px", whiteSpace: "nowrap" }}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", font: "inherit", padding: "8px 0", textAlign: "left" }}
      >
        {label} <span aria-hidden="true" style={{ color: active ? palette.accent : palette.muted }}>{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
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
    return fallback ? <Badge tone={fallback.tone}>{fallback.label}</Badge> : null;
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

function RowAction({ label, title, disabled, onClick }: { label: string; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={{
        background: "none",
        border: `1px solid ${palette.mutedBorder}`,
        borderRadius: "4px",
        color: palette.muted,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "11px",
        padding: "2px 6px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
