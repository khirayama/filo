import { useEffect, useRef, useState, type AriaAttributes, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
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

// Popovers close on Escape and on a pointer press outside their anchor.
export function usePopover(): { open: boolean; setOpen: (open: boolean | ((current: boolean) => boolean)) => void; ref: RefObject<HTMLDivElement | null> } {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return { open, setOpen, ref };
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
  star: "var(--fl-star)",
  ok: "var(--fl-ok)",
  warn: "var(--fl-warn)",
};

type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onClick,
  disabled,
  kind = "secondary",
  type = "button",
  small,
  icon,
  title,
  ariaBusy,
  ariaDescribedBy,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: ButtonKind;
  type?: "button" | "submit";
  small?: boolean;
  icon?: IconName;
  title?: string;
  ariaBusy?: boolean;
  ariaDescribedBy?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-busy={ariaBusy}
      aria-describedby={ariaDescribedBy}
      className={`fl-btn fl-btn--${kind}${small ? " fl-btn--sm" : ""}`}
    >
      {icon ? <Icon name={icon} size={small ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="fl-chip">
      {label}
    </button>
  );
}

export function MenuItem({ label, onClick, danger, icon, role }: { label: string; onClick: () => void; danger?: boolean; icon?: IconName; role?: "menuitem" }) {
  return (
    <button type="button" onClick={onClick} role={role} className={`fl-menu-item${danger ? " fl-menu-item--danger" : ""}`}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {label}
    </button>
  );
}

export function Switch({ id, checked, onChange, label }: { id?: string; checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="fl-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Spinner({ label = "読み込み中…" }: { label?: string }) {
  const { t } = useAppData();
  return (
    <p
      role="status"
      aria-live="polite"
      style={{ alignItems: "center", color: palette.muted, display: "flex", fontSize: "13px", gap: "8px", justifyContent: "center", margin: 0, padding: "32px 16px" }}
    >
      <span className="fl-spinner" aria-hidden="true" />
      {label === "読み込み中…" ? t(label) : label}
    </p>
  );
}

export function BlockingProgress({ message }: { message: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    containerRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div ref={containerRef} role="dialog" aria-modal="true" aria-label={message} tabIndex={-1} className="fl-dialog-scrim">
      <div role="status" aria-live="polite" className="fl-dialog" style={{ alignItems: "center", display: "flex", gap: "12px", maxWidth: "none", padding: "14px 18px", width: "auto" }}>
        <span className="fl-spinner" aria-hidden="true" />
        <span style={{ fontSize: "14px" }}>{message}</span>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="fl-toast">
      {message}
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
        alignItems: "center",
        background: palette.dangerBg,
        borderRadius: "var(--fl-radius)",
        color: palette.danger,
        display: "flex",
        fontSize: "14px",
        gap: "12px",
        justifyContent: "space-between",
        lineHeight: 1.5,
        padding: "10px 12px 10px 16px",
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

export function EmptyState({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="fl-empty">
      {icon ? (
        <span
          aria-hidden="true"
          style={{ alignItems: "center", background: "var(--fl-hover)", borderRadius: "50%", display: "inline-flex", height: "48px", justifyContent: "center", width: "48px" }}
        >
          <Icon name={icon} size={22} />
        </span>
      ) : null}
      {children}
    </div>
  );
}

const BADGE_TONES = {
  muted: { background: "var(--fl-pressed)", color: palette.muted },
  warn: { background: "var(--fl-warn-bg)", color: palette.warn },
  danger: { background: palette.dangerBg, color: palette.danger },
  ok: { background: "var(--fl-ok-bg)", color: palette.ok },
} as const;

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className="fl-badge" style={BADGE_TONES[tone]}>
      {children}
    </span>
  );
}

// Inline status text with a leading dot: quieter than a badge, for states that
// sit inside a row's metadata line.
export function StatusText({ children, tone = "muted" }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className="fl-status" style={{ color: BADGE_TONES[tone].color }}>
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
  danger,
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
  danger?: boolean;
  ariaExpanded?: boolean;
  ariaHaspopup?: AriaAttributes["aria-haspopup"];
  ariaControls?: string;
}) {
  const box = `${size + 14}px`;
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
      className={`fl-icon-btn${danger ? " fl-icon-btn--danger" : ""}`}
      style={{ color: color ?? (active ? palette.text : undefined), height: box, width: box }}
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
