import type { ArticleListItem } from "../api/types";

type AnalyticsParams = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const MEASUREMENT_ID = "G-DDB2609MRP";

// The URL analytics may see: never the query or fragment, which can carry a
// password-reset token or other secrets.
function analyticsLocation(pathname: string): string {
  return `${window.location.origin}${pathname || "/"}`;
}

// The standard gtag bootstrap. gtag.js is loaded only when the visit starts on
// an ordinary page: GA's automatic events (scroll, clicks, …) fire on their
// own and would otherwise report private pages such as /reset-password. Every
// event, automatic ones included, uses the sanitized page_location set here
// and updated by trackPageView.
export function initAnalytics(): void {
  if (typeof window === "undefined" || window.gtag) return;
  if (isPrivatePagePath(window.location.pathname)) return;
  const dataLayer = (window.dataLayer ??= []);
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, {
    send_page_view: false,
    page_location: analyticsLocation(window.location.pathname),
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.append(script);
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
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("set", { page_location: analyticsLocation(pagePath) });
  if (isPrivatePagePath(pagePath)) return;
  trackEvent("page_view", {
    page_location: analyticsLocation(pagePath),
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
