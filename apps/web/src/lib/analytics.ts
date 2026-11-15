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

const PRIVATE_PAGE_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/sign-out",
  "/settings/account-deletion",
];

export function isPrivatePagePath(pathname: string): boolean {
  const pagePath = pathname || "/";
  return PRIVATE_PAGE_PREFIXES.some(
    (prefix) => pagePath === prefix || pagePath.startsWith(`${prefix}/`),
  );
}

export function trackPageView(pathname: string) {
  const pagePath = pathname || "/";
  if (isPrivatePagePath(pagePath)) return;
  trackEvent("page_view", {
    page_location: `${window.location.origin}${pagePath}`,
    page_path: pagePath,
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
