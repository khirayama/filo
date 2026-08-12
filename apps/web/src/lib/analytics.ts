import type { ArticleListItem } from "../api/types";

type AnalyticsParams = Record<string, unknown>;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}

export function trackPageView(pathname: string, search: string) {
  trackEvent("page_view", {
    page_location: window.location.href,
    page_path: `${pathname}${search}`,
    page_title: document.title,
  });
}

export function articleItem(article: Pick<ArticleListItem, "id">, index?: number) {
  return {
    ...(index === undefined ? {} : { index }),
    item_category: "article",
    item_id: String(article.id),
  };
}
