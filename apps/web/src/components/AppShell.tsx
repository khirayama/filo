import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { Subscription } from "../api/types";
import { groupSubscriptionsByTag } from "../lib/grouping";
import { useAppData } from "./AppDataContext";
import { Icon, IconButton, palette } from "./ui";

const SIDEBAR_WIDTH = 280;
const DESKTOP_QUERY = "(min-width: 1024px)";

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

const DRAWER_ANIMATION_MS = 200;

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useAppData();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();

  // The mobile drawer lives on the history stack: opening pushes an entry with
  // `state.drawer`, so the browser/OS back gesture closes it, and closing via
  // the scrim or ✕ just navigates back. Whether it is open derives entirely
  // from the current history entry.
  const drawerRequested = !isDesktop && (location.state as { drawer?: boolean } | null)?.drawer === true;
  const openDrawer = () => navigate(location.pathname + location.search, { state: { drawer: true } });
  const closeDrawer = () => navigate(-1);

  // Keep the drawer mounted while it slides out; `shown` drives the CSS
  // transition (false on mount → slide in on the next frame).
  const [drawerMounted, setDrawerMounted] = useState(drawerRequested);
  const [drawerShown, setDrawerShown] = useState(drawerRequested);
  useEffect(() => {
    if (drawerRequested) {
      setDrawerMounted(true);
      const raf = requestAnimationFrame(() => setDrawerShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setDrawerShown(false);
    const timer = window.setTimeout(() => setDrawerMounted(false), DRAWER_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [drawerRequested]);

  if (isDesktop) {
    return (
      <div style={{ color: palette.text, display: "flex", fontFamily: "system-ui, sans-serif", minHeight: "100vh" }}>
        <aside
          style={{
            borderRight: `1px solid ${palette.mutedBorder}`,
            boxSizing: "border-box",
            flexShrink: 0,
            height: "100vh",
            overflowY: "auto",
            padding: "16px 12px",
            position: "sticky",
            top: 0,
            width: `${SIDEBAR_WIDTH}px`,
          }}
        >
          <SidebarNav />
        </aside>
        <div style={{ flex: 1, minWidth: 0 }}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div style={{ color: palette.text, fontFamily: "system-ui, sans-serif", minHeight: "100vh" }}>
      <header
        style={{
          alignItems: "center",
          background: palette.surface,
          borderBottom: `1px solid ${palette.mutedBorder}`,
          display: "flex",
          gap: "8px",
          padding: "8px 12px",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <IconButton icon="menu" label={t("メニュー")} size={20} onClick={openDrawer} />
        <Link to="/articles" style={{ color: "inherit", fontWeight: 700, textDecoration: "none" }}>
          Filo
        </Link>
      </header>
      {drawerMounted ? (
        <div role="dialog" aria-modal="true" style={{ inset: 0, position: "fixed", zIndex: 30 }}>
          <div
            onClick={closeDrawer}
            style={{
              background: palette.scrim,
              inset: 0,
              opacity: drawerShown ? 1 : 0,
              position: "absolute",
              transition: `opacity ${DRAWER_ANIMATION_MS}ms ease`,
            }}
          />
          <aside
            style={{
              background: palette.surface,
              bottom: 0,
              boxSizing: "border-box",
              left: 0,
              overflowY: "auto",
              padding: "16px 12px",
              position: "absolute",
              top: 0,
              transform: drawerShown ? "translateX(0)" : "translateX(-100%)",
              transition: `transform ${DRAWER_ANIMATION_MS}ms ease`,
              width: "100vw",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <IconButton icon="close" label={t("閉じる")} onClick={closeDrawer} />
            </div>
            <SidebarNav />
          </aside>
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

function SidebarNav() {
  const navigate = useNavigate();
  const { tags, subscriptions, t } = useAppData();
  const [expandedTags, setExpandedTags] = useState<Set<number | "untagged">>(new Set());

  const toggleExpand = (key: number | "untagged") => {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groups = groupSubscriptionsByTag(tags, subscriptions);

  return (
    <nav style={{ display: "grid", gap: "2px", fontSize: "14px", minWidth: 0, overflow: "hidden" }}>
      <Link
        to="/articles"
        style={{ color: "inherit", fontSize: "18px", fontWeight: 700, padding: "4px 8px 12px", textDecoration: "none" }}
      >
        Filo
      </Link>
      <button
        type="button"
        onClick={() => navigate("/feeds/new")}
        style={{
          alignItems: "center",
          background: palette.accent,
          border: "none",
          borderRadius: "6px",
          color: palette.onAccent,
          cursor: "pointer",
          display: "flex",
          fontSize: "14px",
          fontWeight: 600,
          gap: "8px",
          justifyContent: "center",
          marginBottom: "12px",
          padding: "10px 12px",
        }}
      >
        <Icon name="plus" size={16} />
        {t("フィードを追加")}
      </button>
      <button
        type="button"
        onClick={() => navigate("/articles/new")}
        style={{
          alignItems: "center",
          background: "transparent",
          border: `1px solid ${palette.border}`,
          borderRadius: "6px",
          color: palette.text,
          cursor: "pointer",
          display: "flex",
          fontSize: "14px",
          gap: "8px",
          justifyContent: "center",
          marginBottom: "12px",
          padding: "9px 12px",
        }}
      >
        <Icon name="plus" size={16} />
        {t("記事を追加")}
      </button>
      <SidebarLink to="/articles" icon="list" label={t("全ての記事")} />
      <SidebarLink to="/articles?readingList=1" icon="queueAdd" label={t("リーディングリスト")} />
      <SidebarLink to="/articles?bookmarked=1" icon="bookmark" label={t("ブックマーク")} />

      <p
        style={{
          color: palette.muted,
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          margin: "16px 8px 4px",
          textTransform: "uppercase",
        }}
      >
        {t("フィード")}
      </p>
      {groups.map((group) =>
        group.items.length === 0 && group.key === "untagged" ? null : (
          <div key={String(group.key)}>
            <div style={{ alignItems: "center", display: "flex" }}>
              <IconButton
                icon={expandedTags.has(group.key) ? "chevronDown" : "chevronRight"}
                label={expandedTags.has(group.key) ? t("折りたたむ") : t("展開")}
                size={14}
                onClick={() => toggleExpand(group.key)}
              />
              {group.tag !== undefined ? (
                <SidebarRowLink
                  to={`/articles?tagId=${group.tag.id}`}
                  label={group.label}
                  count={group.items.reduce((total, subscription) => total + subscription.unreadCount, 0)}
                />
              ) : (
                <span style={{ ...sidebarRowStyle, color: palette.muted }}>
                  <span style={ellipsisStyle}>{group.label}</span>
                  <span style={countStyle}>
                    {group.items.reduce((total, subscription) => total + subscription.unreadCount, 0)}
                  </span>
                </span>
              )}
            </div>
            {expandedTags.has(group.key)
              ? group.items.map((subscription) => (
                  <SubscriptionLink key={subscription.id} subscription={subscription} />
                ))
              : null}
          </div>
        )
      )}

      <div style={{ borderTop: `1px solid ${palette.mutedBorder}`, marginTop: "16px", paddingTop: "8px" }}>
        <SidebarLink to="/subscriptions" icon="list" label={t("購読管理")} />
        <SidebarLink to="/tags" icon="tag" label={t("タグ管理")} />
        <SidebarLink to="/status" icon="refresh" label={t("処理ステータス")} />
        <SidebarLink to="/settings" icon="gear" label={t("設定")} />
      </div>
    </nav>
  );
}

const sidebarRowStyle = {
  alignItems: "center",
  borderRadius: "6px",
  color: "inherit",
  display: "flex",
  flex: 1,
  gap: "8px",
  minWidth: 0,
  padding: "6px 8px",
  textDecoration: "none",
} as const;

const ellipsisStyle = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const countStyle = {
  color: palette.muted,
  fontSize: "12px",
} as const;

function useIsActive(to: string): boolean {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [path, query] = to.split("?");
  if (location.pathname !== path) return false;
  const target = new URLSearchParams(query ?? "");
  const keys = ["read", "readingList", "bookmarked", "tagId"];
  return keys.every((key) => (target.get(key) ?? null) === (searchParams.get(key) ?? null));
}

function SidebarLink({ to, icon, label }: { to: string; icon: Parameters<typeof Icon>[0]["name"]; label: string }) {
  const active = useIsActive(to);
  return (
    <Link
      to={to}
      style={{
        ...sidebarRowStyle,
        background: active ? palette.mutedBorder : "transparent",
        fontWeight: active ? 600 : 400,
      }}
    >
      <Icon name={icon} size={16} />
      <span style={ellipsisStyle}>{label}</span>
    </Link>
  );
}

function SidebarRowLink({ to, label, count }: { to: string; label: string; count: number }) {
  const active = useIsActive(to);
  return (
    <Link
      to={to}
      style={{
        ...sidebarRowStyle,
        background: active ? palette.mutedBorder : "transparent",
        fontWeight: active ? 600 : 400,
      }}
    >
      <span style={ellipsisStyle}>{label}</span>
      <span style={countStyle}>{count}</span>
    </Link>
  );
}

function SubscriptionLink({ subscription }: { subscription: Subscription }) {
  const location = useLocation();
  const active = location.pathname === `/subscriptions/${subscription.id}`;
  const title = subscription.customTitle ?? subscription.feed.title;
  const unhealthy =
    subscription.initialFetchStatus === "failed" || subscription.feedHealthStatus === "paused";
  const stale = subscription.feedHealthStatus === "stale";
  return (
    <Link
      to={`/subscriptions/${subscription.id}`}
      title={unhealthy ? `${title}（更新異常）` : stale ? `${title}（しばらく更新なし）` : title}
      style={{
        ...sidebarRowStyle,
        background: active ? palette.mutedBorder : "transparent",
        fontWeight: active ? 600 : 400,
        marginLeft: "28px",
        opacity: stale ? 0.7 : 1,
      }}
    >
      {subscription.feed.faviconUrl ? (
        <img
          src={subscription.feed.faviconUrl}
          alt=""
          width={16}
          height={16}
          style={{ borderRadius: "3px", flexShrink: 0 }}
        />
      ) : (
        <span
          style={{
            background: palette.mutedBorder,
            borderRadius: "3px",
            display: "inline-block",
            flexShrink: 0,
            height: "16px",
            width: "16px",
          }}
        />
      )}
      <span style={ellipsisStyle}>{title}</span>
      {unhealthy ? <span style={{ color: palette.danger, fontSize: "12px" }}>!</span> : null}
      {subscription.unreadCount > 0 ? <span style={countStyle}>{subscription.unreadCount}</span> : null}
    </Link>
  );
}
