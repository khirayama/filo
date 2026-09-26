import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { Subscription } from "../api/types";
import { groupSubscriptionsByTag } from "../lib/grouping";
import { useAppData } from "./AppDataContext";
import { Brand } from "./Brand";
import { Icon, IconButton, MenuItem, usePopover, type IconName } from "./ui";

export const SIDEBAR_WIDTH = 280;
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

function isDrawerHistoryEntry(location: ReturnType<typeof useLocation>): boolean {
  return (location.state as { drawer?: boolean } | null)?.drawer === true;
}

const DRAWER_ANIMATION_MS = 200;

// Every signed-in screen shares one header: an optional back button (task
// screens), the title, and trailing actions. On mobile the header is the app
// bar itself, led by the menu button unless the screen has a back button.
export function AppShell({
  title,
  onBack,
  actions,
  children,
}: {
  title: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useAppData();
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const navigate = useNavigate();

  // The mobile drawer lives on the history stack: opening pushes an entry with
  // `state.drawer`, so the browser/OS back gesture closes it, and closing via
  // the scrim or ✕ just navigates back. Whether it is open derives entirely
  // from the current history entry.
  const drawerRequested = !isDesktop && (location.state as { drawer?: boolean } | null)?.drawer === true;
  const wasDesktop = useRef(isDesktop);
  const previousFocus = useRef<HTMLElement | null>(null);
  const openDrawer = () => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    navigate(location.pathname + location.search, { state: { drawer: true } });
  };
  const closeDrawer = () => {
    if (location.key === "default") navigate(location.pathname + location.search, { replace: true });
    else navigate(-1);
  };

  useEffect(() => {
    if (!wasDesktop.current && isDesktop && isDrawerHistoryEntry(location)) {
      navigate(location.pathname + location.search, { replace: true });
    }
    wasDesktop.current = isDesktop;
  }, [isDesktop, location, navigate]);

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

  useEffect(() => {
    if (!drawerMounted || !drawerShown) {
      if (!drawerMounted) {
        previousFocus.current?.focus();
        previousFocus.current = null;
      }
      return;
    }
    const drawer = document.getElementById("filo-mobile-drawer");
    const focusable = drawer?.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerMounted, drawerShown]);

  const lead = onBack ? (
    <IconButton icon="back" label={t("戻る")} onClick={onBack} />
  ) : !isDesktop ? (
    <IconButton
      icon="menu"
      label={t("メニュー")}
      ariaExpanded={drawerRequested}
      ariaHaspopup="dialog"
      ariaControls="filo-mobile-drawer"
      onClick={openDrawer}
    />
  ) : null;

  const header = (
    <header data-filo-page-header="true" className={`fl-page-header${lead ? " fl-page-header--with-lead" : ""}`}>
      {lead}
      <div className="fl-page-header-title" style={lead ? { marginLeft: "4px" } : undefined}>
        <h1>{title}</h1>
      </div>
      {actions ? <div className="fl-page-header-actions">{actions}</div> : null}
    </header>
  );

  if (isDesktop) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <aside
          aria-label={t("サイドバー")}
          className="fl-sidebar"
          style={{
            bottom: 0,
            left: 0,
            overflowY: "auto",
            padding: "12px",
            position: "fixed",
            top: 0,
            width: `${SIDEBAR_WIDTH}px`,
            zIndex: 20,
          }}
        >
          <SidebarNav />
        </aside>
        <div
          data-filo-scroll-container="true"
          style={{
            height: "100vh",
            marginLeft: `${SIDEBAR_WIDTH}px`,
            minWidth: 0,
            overflowY: "auto",
          }}
        >
          {header}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      {header}
      {drawerMounted ? (
        <div
          id="filo-mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={t("メニュー")}
          style={{ inset: 0, position: "fixed", zIndex: 30 }}
        >
          <div
            aria-hidden="true"
            onClick={closeDrawer}
            data-filo-drawer-scrim="true"
            style={{
              background: "var(--fl-scrim)",
              inset: 0,
              opacity: drawerShown ? 1 : 0,
              position: "absolute",
              transition: `opacity ${DRAWER_ANIMATION_MS}ms var(--fl-ease-out)`,
            }}
          />
          <aside
            aria-label={t("サイドバー")}
            data-filo-drawer-panel="true"
            className="fl-sidebar"
            style={{
              bottom: 0,
              boxShadow: "0 0 32px var(--fl-shadow)",
              left: 0,
              overflowY: "auto",
              padding: "8px 12px 24px",
              position: "absolute",
              top: 0,
              transform: drawerShown ? "translateX(0)" : "translateX(-100%)",
              transition: `transform ${DRAWER_ANIMATION_MS}ms var(--fl-ease-drawer)`,
              width: "100%",
            }}
          >
            <SidebarNav trailing={<IconButton icon="close" label={t("閉じる")} onClick={closeDrawer} />} />
          </aside>
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
}

function AddMenu() {
  const navigate = useNavigate();
  const { t } = useAppData();
  const { open, setOpen, ref } = usePopover();
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <IconButton
        icon="plus"
        label={t("追加")}
        ariaExpanded={open}
        ariaHaspopup="menu"
        ariaControls="filo-add-menu"
        onClick={() => setOpen((value) => !value)}
      />
      {open ? (
        <div id="filo-add-menu" role="menu" aria-label={t("追加")} className="fl-menu" style={{ minWidth: "200px" }}>
          <MenuItem role="menuitem" icon="rss" label={t("フィードを追加")} onClick={() => go("/feeds/new")} />
          <MenuItem role="menuitem" icon="playlist" label={t("記事を追加")} onClick={() => go("/articles/new")} />
        </div>
      ) : null}
    </div>
  );
}

function SidebarNav({ trailing }: { trailing?: ReactNode }) {
  const { tags, subscriptions, unreadCounts, t } = useAppData();
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
    <nav aria-label={t("メインナビゲーション")} className="fl-nav">
      <div style={{ alignItems: "center", display: "flex", gap: "4px", margin: "0 0 12px", minHeight: "40px" }}>
        <Link
          to="/articles"
          style={{ color: "inherit", flex: 1, fontSize: "17px", fontWeight: 700, padding: "0 6px", textDecoration: "none" }}
        >
          <Brand size={26} />
        </Link>
        <AddMenu />
        {trailing}
      </div>
      <SidebarLink to="/articles" icon="inbox" label={t("全ての記事")} count={unreadCounts.allArticles} />
      <SidebarLink to="/articles?readingList=1" icon="playlist" label={t("リーディングリスト")} count={unreadCounts.readingList} />
      <SidebarLink to="/articles?bookmarked=1" icon="bookmark" label={t("ブックマーク")} />

      <p className="fl-nav-section">{t("フィード")}</p>
      {groups.map((group) => {
        if (group.items.length === 0 && group.key === "untagged") return null;
        const unreadCount = group.items.reduce((total, subscription) => total + subscription.unreadCount, 0);
        const label = group.key === "untagged" ? t("タグなし") : group.label;
        const expanded = expandedTags.has(group.key);
        const groupId = `filo-sidebar-group-${String(group.key)}`;
        return (
          <div key={String(group.key)}>
            <div className="fl-nav-group">
              <button
                type="button"
                className="fl-nav-disclosure"
                aria-label={`${label}: ${expanded ? t("折りたたむ") : t("展開")}`}
                title={`${label}: ${expanded ? t("折りたたむ") : t("展開")}`}
                aria-expanded={expanded}
                aria-controls={groupId}
                onClick={() => toggleExpand(group.key)}
              >
                <Icon name={expanded ? "chevronDown" : "chevronRight"} size={14} />
              </button>
              {group.tag !== undefined ? (
                <SidebarRowLink to={`/articles?tagId=${group.tag.id}`} label={label} count={unreadCount} />
              ) : (
                <span className="fl-nav-row" style={{ color: "var(--fl-muted)" }}>
                  <span className="fl-nav-label">{label}</span>
                  {unreadCount > 0 ? <span className="fl-nav-count">{unreadCount}</span> : null}
                </span>
              )}
            </div>
            {expanded ? (
              <div id={groupId} className="fl-nav-children">
                {group.items.map((subscription) => (
                  <SubscriptionLink key={subscription.id} subscription={subscription} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div style={{ borderTop: "1px solid var(--fl-muted-border)", display: "grid", gap: "1px", marginTop: "16px", paddingTop: "12px" }}>
        <SidebarLink to="/subscriptions" icon="rss" label={t("購読管理")} />
        <SidebarLink to="/tags" icon="tag" label={t("タグ管理")} />
        <SidebarLink to="/status" icon="activity" label={t("処理ステータス")} />
        <SidebarLink to="/settings" icon="gear" label={t("設定")} />
      </div>
    </nav>
  );
}

function useIsActive(to: string): boolean {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [path, query] = to.split("?");
  if (location.pathname !== path) return false;
  const target = new URLSearchParams(query ?? "");
  const keys = ["read", "readingList", "bookmarked", "tagId"];
  return keys.every((key) => (target.get(key) ?? null) === (searchParams.get(key) ?? null));
}

function SidebarLink({ to, icon, label, count }: { to: string; icon: IconName; label: string; count?: number }) {
  const active = useIsActive(to);
  return (
    <Link to={to} aria-current={active ? "page" : undefined} className="fl-nav-row">
      <span className="fl-nav-icon"><Icon name={icon} size={16} /></span>
      <span className="fl-nav-label">{label}</span>
      {count ? <span className="fl-nav-count">{count}</span> : null}
    </Link>
  );
}

function SidebarRowLink({ to, label, count }: { to: string; label: string; count?: number }) {
  const active = useIsActive(to);
  return (
    <Link to={to} aria-current={active ? "page" : undefined} className="fl-nav-row">
      <span className="fl-nav-label">{label}</span>
      {count ? <span className="fl-nav-count">{count}</span> : null}
    </Link>
  );
}

function SubscriptionLink({ subscription }: { subscription: Subscription }) {
  const location = useLocation();
  const { t } = useAppData();
  const active = location.pathname === `/subscriptions/${subscription.id}`;
  const title = subscription.customTitle ?? subscription.feed.title;
  const unhealthy =
    subscription.initialFetchStatus === "failed" || subscription.feedHealthStatus === "paused";
  const stale = subscription.feedHealthStatus === "stale";
  return (
    <Link
      to={`/subscriptions/${subscription.id}`}
      aria-current={active ? "page" : undefined}
      title={unhealthy ? `${title}（${t("更新異常")}）` : stale ? `${title}（${t("しばらく更新なし")}）` : title}
      className="fl-nav-row"
      data-stale={stale}
    >
      <span className="fl-nav-label">{title}</span>
      {unhealthy ? <span className="fl-nav-alert" aria-label={t("更新異常")} /> : null}
      {subscription.unreadCount > 0 ? <span className="fl-nav-count">{subscription.unreadCount}</span> : null}
    </Link>
  );
}
