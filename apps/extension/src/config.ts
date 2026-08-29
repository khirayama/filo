export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
export const WEB_APP_URL = import.meta.env.VITE_WEB_APP_URL ?? "http://localhost:5173";


export function webAppPath(path: string): string {
  return new URL(path, `${WEB_APP_URL.replace(/\/$/, "")}/`).toString();
}
