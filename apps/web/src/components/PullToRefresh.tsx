import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

const TRIGGER_PX = 64;
const MAX_PX = 96;

// Pull down at the top of the list to refresh, like the native apps. Touch
// only: it owns its listeners and its indicator, so a pull re-renders nothing
// else on the page.
export function PullToRefresh({ onRefresh, disabled = false }: { onRefresh: () => void; disabled?: boolean }) {
  const [pull, setPull] = useState(0);
  const latest = useRef({ onRefresh, disabled });
  latest.current = { onRefresh, disabled };

  useEffect(() => {
    let startY: number | null = null;
    let distance = 0;
    const isAtTop = () =>
      window.scrollY <= 0
      && (document.querySelector<HTMLElement>("[data-filo-scroll-container]")?.scrollTop ?? 0) <= 0;
    const reset = () => {
      startY = null;
      distance = 0;
      setPull(0);
    };
    const onTouchStart = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (latest.current.disabled || event.touches.length !== 1 || !isAtTop()
        || target?.closest("#filo-mobile-drawer, .fl-menu, .fl-dialog-scrim")) return;
      startY = event.touches[0].clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY === null) return;
      const delta = event.touches[0].clientY - startY;
      // An upward or sideways start is a scroll, not a pull.
      if (delta <= 0 || !isAtTop()) {
        reset();
        return;
      }
      // Keep the browser's own overscroll and page reload out of the way.
      if (event.cancelable) event.preventDefault();
      distance = Math.min(delta / 2, MAX_PX);
      setPull(distance);
    };
    const onTouchEnd = () => {
      if (startY === null) return;
      const triggered = distance >= TRIGGER_PX;
      reset();
      if (triggered && !latest.current.disabled) latest.current.onRefresh();
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", reset);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, []);

  if (pull <= 0) return null;
  return (
    <div
      aria-hidden="true"
      className="fl-pull-refresh"
      data-ready={pull >= TRIGGER_PX}
      style={{ opacity: Math.min(pull / TRIGGER_PX, 1), transform: `translate(-50%, ${pull}px) rotate(${pull * 3}deg)` }}
    >
      <Icon name="refresh" size={18} />
    </div>
  );
}
