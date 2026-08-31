import { useEffect, useRef, type AriaAttributes, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { useAppData } from "./AppDataContext";

export { Icon, type IconName } from "./icons";

export function useDialogFocus(open: boolean, containerId: string, onClose: () => void) {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = document.getElementById(containerId);
    const focusable = container?.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    focusable?.[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
      previousFocus.current = null;
    };
  }, [containerId, onClose, open]);
}

// All colors resolve to CSS variables declared in global.css so that the
// light/dark theme (settings.theme) applies to every inline style.
export const palette = {
  bg: "var(--fl-bg)",
  surface: "var(--fl-surface)",
  text: "var(--fl-text)",
  border: "var(--fl-border)",
  mutedBorder: "var(--fl-muted-border)",
  muted: "var(--fl-muted)",
  danger: "var(--fl-danger)",
  dangerBg: "var(--fl-danger-bg)",
  accent: "var(--fl-accent)",
  onAccent: "var(--fl-on-accent)",
  star: "var(--fl-star)",
  ok: "var(--fl-ok)",
  okBg: "var(--fl-ok-bg)",
  okBorder: "var(--fl-ok-border)",
  warn: "var(--fl-warn)",
  warnBg: "var(--fl-warn-bg)",
  warnBorder: "var(--fl-warn-border)",
  hover: "var(--fl-hover)",
  scrim: "var(--fl-scrim)",
  shadow: "var(--fl-shadow)",
};

export const pageStyle: CSSProperties = {
  color: palette.text,
  fontFamily: "system-ui, sans-serif",
  minHeight: "100vh",
  padding: "24px",
};

export const shellStyle: CSSProperties = { margin: "0 auto", maxWidth: "720px" };

export const sectionStyle: CSSProperties = {
  border: `1px solid ${palette.border}`,
  marginTop: "16px",
  padding: "16px",
  borderRadius: "6px",
};

export const menuStyle: CSSProperties = {
  background: palette.surface,
  border: `1px solid ${palette.border}`,
  borderRadius: "6px",
  boxShadow: `0 4px 16px ${palette.shadow}`,
  display: "grid",
  padding: "4px",
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  zIndex: 10,
};

export function Button({
  children,
  onClick,
  disabled,
  kind = "secondary",
  type = "button",
  small,
  ariaBusy,
  ariaDescribedBy,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  small?: boolean;
  ariaBusy?: boolean;
  ariaDescribedBy?: string;
}) {
  const base: CSSProperties = {
    border: `1px solid ${kind === "danger" ? palette.danger : palette.text}`,
    background: kind === "primary" ? palette.text : "transparent",
    color: kind === "primary" ? palette.bg : kind === "danger" ? palette.danger : palette.text,
    padding: small ? "4px 10px" : "10px 14px",
    borderRadius: "6px",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontSize: small ? "13px" : "14px",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-busy={ariaBusy}
      aria-describedby={ariaDescribedBy}
      style={base}
    >
      {children}
    </button>
  );
}

export function InlineButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        border: "none",
        color: "inherit",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        padding: 0,
        textDecoration: "underline",
        fontSize: "14px",
      }}
    >
      {children}
    </button>
  );
}

export function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? palette.text : "transparent",
        border: `1px solid ${palette.border}`,
        borderRadius: "999px",
        color: active ? palette.bg : "inherit",
        cursor: "pointer",
        fontSize: "13px",
        padding: "4px 12px",
      }}
    >
      {label}
    </button>
  );
}

export function MenuItem({ label, onClick, danger, role }: { label: string; onClick: () => void; danger?: boolean; role?: "menuitem" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={role}
      style={{
        background: "transparent",
        border: "none",
        borderRadius: "4px",
        color: danger ? palette.danger : "inherit",
        cursor: "pointer",
        fontSize: "14px",
        padding: "8px 12px",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = palette.mutedBorder;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

export function Spinner({ label = "読み込み中…" }: { label?: string }) {
  const { t } = useAppData();
  return (
    <p role="status" aria-live="polite" style={{ color: palette.muted }}>
      {label === "読み込み中…" ? t(label) : label}
    </p>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useAppData();
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        border: `1px solid ${palette.danger}`,
        borderRadius: "6px",
        color: palette.danger,
        marginTop: "16px",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
      }}
    >
      <span>{message}</span>
      {onRetry ? (
        <Button small onClick={onRetry}>
          {t("再試行")}
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px dashed ${palette.border}`,
        borderRadius: "6px",
        color: palette.muted,
        marginTop: "16px",
        padding: "32px 16px",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "warn" | "danger" | "ok" }) {
  const colors: Record<string, string> = {
    muted: palette.muted,
    warn: palette.warn,
    danger: palette.danger,
    ok: palette.ok,
  };
  return (
    <span
      style={{
        border: `1px solid ${colors[tone]}`,
        borderRadius: "999px",
        color: colors[tone],
        fontSize: "12px",
        padding: "1px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  size = 18,
  filled,
  color,
  ariaExpanded,
  ariaHaspopup,
  ariaControls,
}: {
  icon: IconName;
  label: string;
  onClick?: (e: ReactMouseEvent) => void;
  active?: boolean;
  disabled?: boolean;
  size?: number;
  filled?: boolean;
  color?: string;
  ariaExpanded?: boolean;
  ariaHaspopup?: AriaAttributes["aria-haspopup"];
  ariaControls?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(e);
      }}
      disabled={disabled}
      style={{
        alignItems: "center",
        background: "transparent",
        border: "none",
        borderRadius: "50%",
        color: color ?? (active ? palette.text : palette.muted),
        cursor: disabled ? "default" : "pointer",
        display: "inline-flex",
        height: `${size + 14}px`,
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
        padding: 0,
        width: `${size + 14}px`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = palette.mutedBorder;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon name={icon} size={size} filled={filled ?? active} />
    </button>
  );
}

function relativeTime(iso: string | null, labels: { now: string; m: string; h: string; d: string }, dateFormat: Intl.DateTimeFormatOptions, language: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return labels.now;
  if (minutes < 60) return `${minutes}${labels.m}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${labels.h}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}${labels.d}`;
  const locale = language === "zh" ? "zh-CN" : language === "ko" ? "ko-KR" : language === "es" ? "es-ES" : language === "en" ? "en-US" : "ja-JP";
  return date.toLocaleDateString(locale, dateFormat);
}

export function formatTime(iso: string | null, language = "ja"): string {
  const labels = language === "en"
    ? { now: "just now", m: " min ago", h: " hr ago", d: " days ago" }
    : language === "zh"
      ? { now: "刚刚", m: "分钟前", h: "小时前", d: "天前" }
      : language === "ko"
        ? { now: "방금", m: "분 전", h: "시간 전", d: "일 전" }
        : language === "es"
          ? { now: "ahora", m: " min", h: " h", d: " días" }
          : { now: "たった今", m: "分前", h: "時間前", d: "日前" };
  return relativeTime(iso, labels, { year: "numeric", month: "short", day: "numeric" }, language);
}

export function formatTimeCompact(iso: string | null, language = "ja"): string {
  const labels = language === "ja"
    ? { now: "今", m: "分", h: "時間", d: "日" }
    : language === "zh"
      ? { now: "刚刚", m: "分", h: "时", d: "天" }
      : language === "ko"
        ? { now: "방금", m: "분", h: "시간", d: "일" }
        : language === "es"
          ? { now: "ahora", m: "m", h: "h", d: "d" }
          : { now: "now", m: "m", h: "h", d: "d" };
  return relativeTime(iso, labels, { month: "numeric", day: "numeric" }, language);
}
