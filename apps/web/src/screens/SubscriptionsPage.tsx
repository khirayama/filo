import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { Subscription, Tag } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import {
  Badge,
  EmptyState,
  ErrorBox,
  IconButton,
  InlineButton,
  Spinner,
  formatTime,
  menuStyle,
  palette,
} from "../components/ui";
import { groupSubscriptionsByTag } from "../lib/grouping";
import { errorMessage, initialFetchErrorMessage } from "../lib/messages";
import { moveItem } from "../lib/reorder";

export function SubscriptionsPage() {
  const api = useApi();
  const navigate = useNavigate();
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
          <h1 style={{ flex: 1, fontSize: "20px", margin: 0 }}>{t("購読管理")}</h1>
          <IconButton icon="plus" label={t("フィード追加")} onClick={() => navigate("/feeds/new")} />
          <IconButton icon="tag" label={t("タグ管理")} onClick={() => navigate("/tags")} />
        </header>
        {loading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox message={error} onRetry={() => void load()} />
        ) : subscriptions.length === 0 ? (
          <EmptyState>
            <p>{t("まだ購読がありません。")}</p>
            <Link to="/feeds/new" style={{ color: "inherit" }}>
              {t("フィードを追加")}
            </Link>
          </EmptyState>
        ) : (
          groups.map((group) =>
            group.items.length === 0 ? null : (
              <section key={String(group.key)} aria-labelledby={`subscription-group-${String(group.key)}`} style={{ marginTop: "16px" }}>
                <div
                  style={{
                    alignItems: "center",
                    borderBottom: `1px solid ${palette.mutedBorder}`,
                    display: "flex",
                    gap: "4px",
                    padding: "4px 0",
                  }}
                >
                  <IconButton
                    icon={collapsedTags.has(group.key) ? "chevronRight" : "chevronDown"}
                    label={`${group.label}: ${collapsedTags.has(group.key) ? t("展開") : t("折りたたむ")}`}
                    size={14}
                    ariaExpanded={!collapsedTags.has(group.key)}
                    ariaControls={`subscription-group-items-${String(group.key)}`}
                    onClick={() => toggleCollapse(group.key)}
                  />
                  {group.tag ? (
                    <Link
                      to={`/articles?tagId=${group.tag.id}`}
                      id={`subscription-group-${String(group.key)}`}
                      style={{ color: "inherit", fontWeight: 600, textDecoration: "none" }}
                    >
                      {group.label}
                    </Link>
                  ) : (
                    <span id={`subscription-group-${String(group.key)}`} style={{ fontWeight: 600 }}>{group.label}</span>
                  )}
                  <span style={{ color: palette.muted, fontSize: "13px" }}>{group.items.length}件</span>
                  <div style={{ flex: 1 }} />
                  {group.tag ? (
                    <>
                      <IconButton
                        icon="chevronUp"
                        label={t("タグを上へ")}
                        size={14}
                        onClick={() => void moveTag(group.tag!.id, -1)}
                      />
                      <IconButton icon="chevronDown" label={t("タグを下へ")} size={14} onClick={() => void moveTag(group.tag!.id, 1)} />
                      <InlineButton onClick={() => void renameTag(group.tag!)}>{t("名前変更")}</InlineButton>
                    </>
                  ) : null}
                </div>
                {!collapsedTags.has(group.key) ? (
                  <ul id={`subscription-group-items-${String(group.key)}`} style={{ listStyle: "none", margin: 0, padding: 0 }}>
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
            )
          )
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
  const [tagMenuOpen, setTagMenuOpen] = useState(false);

  useEffect(() => {
    if (!tagMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setTagMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tagMenuOpen]);

  const toggleTag = (tagId: number) => {
    const next = subscription.tagIds.includes(tagId)
      ? subscription.tagIds.filter((id) => id !== tagId)
      : [...subscription.tagIds, tagId];
    onTagsChange(next);
  };

  return (
    <li
      style={{
        alignItems: "center",
        borderBottom: `1px solid ${palette.mutedBorder}`,
        display: "flex",
        gap: "8px",
        padding: "8px 4px",
      }}
    >
      {subscription.feed.faviconUrl ? (
        <img src={subscription.feed.faviconUrl} alt="" width={16} height={16} style={{ borderRadius: "3px" }} />
      ) : (
        <span
          style={{
            background: palette.mutedBorder,
            borderRadius: "3px",
            display: "inline-block",
            height: "16px",
            width: "16px",
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link
          to={`/subscriptions/${subscription.id}`}
          style={{
            color: "inherit",
            display: "block",
            fontWeight: 600,
            overflow: "hidden",
            textDecoration: "none",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subscription.customTitle ?? subscription.feed.title}
        </Link>
        <div style={{ color: palette.muted, fontSize: "12px", marginTop: "2px" }}>
          最終公開 {formatTime(subscription.feed.latestPublishedAt ?? null) || "—"}
        </div>
        {subscription.initialFetchStatus === "failed" ? (
          <Badge tone="danger">{initialFetchErrorMessage(subscription.initialFetchErrorCode)}</Badge>
        ) : subscription.initialFetchStatus === "fetching" ? (
          <Badge>記事取得中</Badge>
        ) : subscription.feedHealthStatus === "paused" ? (
          <Badge tone="danger">更新停止中</Badge>
        ) : subscription.feedHealthStatus === "stale" ? (
          <Badge tone="warn">しばらく更新なし</Badge>
        ) : null}
      </div>
      {allTags.length > 0 ? (
        <div style={{ position: "relative" }}>
          <IconButton
            icon="tag"
            label="タグを編集"
            size={14}
            ariaExpanded={tagMenuOpen}
            ariaHaspopup="dialog"
            ariaControls={`subscription-tag-menu-${subscription.id}`}
            onClick={() => setTagMenuOpen((v) => !v)}
          />
          {tagMenuOpen ? (
            <div id={`subscription-tag-menu-${subscription.id}`} role="dialog" aria-label="タグを編集" style={{ ...menuStyle, fontSize: "13px", gap: "2px", padding: "8px", width: "200px" }}>
              {allTags.map((tag) => (
                <label
                  key={tag.id}
                  style={{
                    alignItems: "center",
                    cursor: "pointer",
                    display: "flex",
                    gap: "6px",
                    padding: "4px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={subscription.tagIds.includes(tag.id)}
                    onChange={() => toggleTag(tag.id)}
                  />
                  {tag.color ? (
                    <span
                      style={{
                        background: tag.color,
                        borderRadius: "50%",
                        display: "inline-block",
                        flexShrink: 0,
                        height: "10px",
                        width: "10px",
                      }}
                    />
                  ) : null}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {tag.name}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <IconButton icon="chevronUp" label="上へ" size={14} disabled={busy} onClick={onMoveUp} />
      <IconButton icon="chevronDown" label="下へ" size={14} disabled={busy} onClick={onMoveDown} />
    </li>
  );
}
