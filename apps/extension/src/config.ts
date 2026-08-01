export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
export const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL ?? "http://localhost:5173";
export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

const webUrl = new URL(WEB_APP_URL);
const defaultSyncHost =
  webUrl.hostname === "localhost" ? `${webUrl.protocol}//${webUrl.hostname}` : webUrl.origin;
export const CLERK_SYNC_HOST = import.meta.env.VITE_CLERK_SYNC_HOST ?? defaultSyncHost;

export function webAppPath(path: string): string {
  return new URL(path, `${WEB_APP_URL.replace(/\/$/, "")}/`).toString();
}
