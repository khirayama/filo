import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { Subscription, Tag } from "../api/types";
import { AppShell, useIsDesktop } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { SubscriptionHealth } from "../components/SubscriptionHealth";
import { TagPicker } from "../components/TagPicker";
import {
  Button,
  EmptyState,
  ErrorBox,
  IconButton,
  Spinner,
  formatTime,
  palette,
} from "../components/ui";
import { groupSubscriptionsByTag } from "../lib/grouping";
import { errorMessage } from "../lib/messages";
import { moveItem } from "../lib/reorder";

export function SubscriptionsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const appData = useAppData();
  const { t, language } = appData;
  // Local copies allow optimistic reordering; the context stays the source
  // of truth and is refreshed after every successful mutation.
  const [subscriptions, setSubscriptions] = useState<Subscription[]>(appData.subscriptions);
  const [tags, setTags] = useState<Tag[]>(appData.tags);
  const [error, setError] = useState<string | null>(null);
  const [collapsedTags, setCollapsedTags] = useState<Set<number | "untagged">>(new Set());
  const [busy, setBusy] = useState(false);
  const loading = appData.loading;

  useEffect(() => {
    setSubscriptions(appData.subscriptions);
  }, [appData.subscriptions]);
  useEffect(() => {
    setTags(appData.tags);
  }, [appData.tags]);

  const load = appData.refresh;

  const moveSubscription = async (id: number, direction: -1 | 1, groupItems: Subscription[]) => {
    const groupIndex = groupItems.findIndex((subscription) => subscription.id === id);
    const neighbor = groupItems[groupIndex + direction];
    if (groupIndex < 0 || !neighbor) return;
    const index = subscriptions.findIndex((subscription) => subscription.id === id);
    const neighborIndex = subscriptions.findIndex((subscription) => subscription.id === neighbor.id);
    if (index < 0 || neighborIndex < 0) return;
    const next = [...subscriptions];
    [next[index], next[neighborIndex]] = [next[neighborIndex]!, next[index]!];
    setSubscriptions(next);
    setBusy(true);
    try {
      await api.reorderSubscriptions(next.map((s) => s.id));
      void load();
    } catch (e) {
      setError(errorMessage(e, language));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const renameTag = async (tag: Tag) => {
    const name = window.prompt(t("タグ名を変更"), tag.name);
    if (!name || name === tag.name) return;
    try {
      await api.updateTag(tag.id, { name });
      await load();
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const moveTag = async (tagId: number, direction: -1 | 1) => {
    const next = moveItem(tags, tagId, direction, (t) => t.id);
    if (!next) return;
    setTags(next);
    try {
      await api.reorderTags(next.map((t) => t.id));
      void load();
    } catch (e) {
      setError(errorMessage(e, language));
      await load();
    }
  };

  const updateSubscriptionTags = async (subscriptionId: number, tagIds: number[]) => {
    try {
      const updated = await api.setSubscriptionTags(subscriptionId, tagIds);
      setSubscriptions((prev) => prev.map((s) => (s.id === subscriptionId ? updated : s)));
      void load();
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const toggleCollapse = (key: number | "untagged") => {
    setCollapsedTags((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groups = groupSubscriptionsByTag(tags, subscriptions);

  return (
    <AppShell
      title={t("購読管理")}
      actions={
        isDesktop ? (
          <>
            <Button small icon="tag" onClick={() => navigate("/tags")}>{t("タグ管理")}</Button>
            <Button small kind="primary" icon="plus" onClick={() => navigate("/feeds/new")}>{t("フィードを追加")}</Button>
          </>
        ) : (
          <>
            <IconButton icon="tag" label={t("タグ管理")} onClick={() => navigate("/tags")} />
            <IconButton icon="plus" label={t("フィードを追加")} onClick={() => navigate("/feeds/new")} />
          </>
        )
      }
    >
      <main className="fl-page fl-page--narrow">
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} onRetry={() => void load()} />
        ) : subscriptions.length === 0 ? (
          <EmptyState icon="rss">
            <p>{t("まだ購読がありません。")}</p>
            <Link to="/feeds/new" className="fl-btn fl-btn--primary">
              {t("フィードを追加")}
            </Link>
          </EmptyState>
        ) : (
          <div className="fl-stack" style={{ gap: "28px" }}>
            {groups.map((group) => {
              if (group.items.length === 0) return null;
              const label = group.key === "untagged" ? t("タグなし") : group.label;
              const collapsed = collapsedTags.has(group.key);
              return (
                <section key={String(group.key)} aria-labelledby={`subscription-group-${String(group.key)}`}>
                  <div
                    className="fl-reveal-host"
                    style={{
                      alignItems: "center",
                      borderBottom: `1px solid ${palette.border}`,
                      display: "flex",
                      gap: "8px",
                      minHeight: "40px",
                      paddingBottom: "4px",
                    }}
                  >
                    <IconButton
                      icon={collapsed ? "chevronRight" : "chevronDown"}
                      label={`${label}: ${collapsed ? t("展開") : t("折りたたむ")}`}
                      size={14}
                      ariaExpanded={!collapsed}
                      ariaControls={`subscription-group-items-${String(group.key)}`}
                      onClick={() => toggleCollapse(group.key)}
                    />
                    <div style={{ alignItems: "baseline", display: "flex", flex: 1, gap: "8px", minWidth: 0 }}>
                      {group.tag ? (
                        <Link
                          to={`/articles?tagId=${group.tag.id}`}
                          id={`subscription-group-${String(group.key)}`}
                          className="fl-link"
                          style={{ fontSize: "15px", fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {label}
                        </Link>
                      ) : (
                        <span id={`subscription-group-${String(group.key)}`} style={{ fontSize: "15px", fontWeight: 700 }}>{label}</span>
                      )}
                      <span style={{ color: palette.muted, flexShrink: 0, fontSize: "12px" }}>{t("{count}件の購読", { count: group.items.length })}</span>
                    </div>
                    {group.tag ? (
                      <div className="fl-reveal" style={{ display: "flex", gap: "2px" }}>
                        <IconButton icon="chevronUp" label={t("タグを上へ")} size={16} onClick={() => void moveTag(group.tag!.id, -1)} />
                        <IconButton icon="chevronDown" label={t("タグを下へ")} size={16} onClick={() => void moveTag(group.tag!.id, 1)} />
                        <IconButton icon="pencil" label={t("名前変更")} size={16} onClick={() => void renameTag(group.tag!)} />
                      </div>
                    ) : null}
                  </div>
                  {!collapsed ? (
                    <ul id={`subscription-group-items-${String(group.key)}`} className="fl-list">
                      {group.items.map((subscription) => (
                        <SubscriptionRow
                          key={subscription.id}
                          subscription={subscription}
                          allTags={tags}
                          busy={busy}
                          onMoveUp={() => void moveSubscription(subscription.id, -1, group.items)}
                          onMoveDown={() => void moveSubscription(subscription.id, 1, group.items)}
                          onTagsChange={(tagIds) => void updateSubscriptionTags(subscription.id, tagIds)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function SubscriptionRow({
  subscription,
  allTags,
  busy,
  onMoveUp,
  onMoveDown,
  onTagsChange,
}: {
  subscription: Subscription;
  allTags: Tag[];
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onTagsChange: (tagIds: number[]) => void;
}) {
  const { t, language } = useAppData();
  const title = subscription.customTitle ?? subscription.feed.title;

  const toggleTag = (tagId: number) => {
    const next = subscription.tagIds.includes(tagId)
      ? subscription.tagIds.filter((id) => id !== tagId)
      : [...subscription.tagIds, tagId];
    onTagsChange(next);
  };

  return (
    <li className="fl-list-row fl-reveal-host" style={{ paddingLeft: "var(--fl-disclosure-indent)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link
          to={`/subscriptions/${subscription.id}`}
          className="fl-link"
          style={{ display: "block", fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {title}
        </Link>
        <div style={{ alignItems: "center", color: palette.muted, display: "flex", flexWrap: "wrap", fontSize: "12px", gap: "4px 12px", marginTop: "2px" }}>
          <span>{t("最終公開 {time}", { time: formatTime(subscription.feed.latestPublishedAt ?? null, language) || "—" })}</span>
          <SubscriptionHealth subscription={subscription} />
        </div>
      </div>
      <div className="fl-reveal" style={{ display: "flex", gap: "2px" }}>
        <TagPicker
          id={`subscription-tag-menu-${subscription.id}`}
          tags={allTags}
          selectedIds={subscription.tagIds}
          onToggle={toggleTag}
        />
        <IconButton icon="chevronUp" label={t("上へ")} size={16} disabled={busy} onClick={onMoveUp} />
        <IconButton icon="chevronDown" label={t("下へ")} size={16} disabled={busy} onClick={onMoveDown} />
      </div>
    </li>
  );
}
