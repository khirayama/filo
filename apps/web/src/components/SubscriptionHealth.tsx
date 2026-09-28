import type { Subscription } from "../api/types";
import { initialFetchErrorMessage } from "../lib/messages";
import { useAppData } from "./AppDataContext";
import { StatusText } from "./ui";

// Feed health as a quiet inline status; renders nothing for healthy feeds.
export function SubscriptionHealth({ subscription }: { subscription: Subscription }) {
  const { t, language } = useAppData();
  if (subscription.initialFetchStatus === "failed") {
    return <StatusText tone="danger">{initialFetchErrorMessage(subscription.initialFetchErrorCode, language)}</StatusText>;
  }
  if (subscription.initialFetchStatus === "fetching") return <StatusText>{t("記事取得中")}</StatusText>;
  if (subscription.feedHealthStatus === "paused") return <StatusText tone="danger">{t("更新停止中")}</StatusText>;
  if (subscription.feedHealthStatus === "stale") return <StatusText tone="warn">{t("しばらく更新なし")}</StatusText>;
  return null;
}
