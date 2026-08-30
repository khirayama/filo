import type { Env } from "../env";

const DEV_WEB_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

export const CHROME_EXTENSION_ORIGIN_PATTERN = "chrome-extension://*";

function configuredOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function resolveCorsOrigin(
  origin: string | undefined,
  allowedOrigins: string | undefined,
  appEnv: Env["APP_ENV"],
): string | undefined {
  if (!origin) return undefined;
  if (DEV_WEB_ORIGINS.has(origin) || configuredOrigins(allowedOrigins).includes(origin)) return origin;
  if (appEnv === "development" && CHROME_EXTENSION_ORIGIN.test(origin)) return origin;
  return undefined;
}

export function resolveBetterAuthTrustedOrigins(env: Env): string[] {
  return [
    ...configuredOrigins(env.CORS_ALLOWED_ORIGINS),
    ...configuredOrigins(env.BETTER_AUTH_TRUSTED_ORIGINS ?? "filo://auth"),
    ...(env.APP_ENV === "development" ? [CHROME_EXTENSION_ORIGIN_PATTERN] : []),
  ];
}
