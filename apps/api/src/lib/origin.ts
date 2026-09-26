import type { Env } from "../env";

const DEV_WEB_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
// Unpacked / temporarily loaded extensions in development. Firefox and Safari
// assign a random UUID per install, so they cannot be listed explicitly.
const DEV_EXTENSION_ORIGINS = [
  /^chrome-extension:\/\/[a-p]{32}$/,
  /^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  /^safari-web-extension:\/\/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/,
];

export const DEV_EXTENSION_ORIGIN_PATTERNS = ["chrome-extension://*", "moz-extension://*", "safari-web-extension://*"];

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
  if (appEnv === "development" && DEV_EXTENSION_ORIGINS.some((pattern) => pattern.test(origin))) return origin;
  return undefined;
}

export function resolveBetterAuthTrustedOrigins(env: Env): string[] {
  return [
    ...configuredOrigins(env.CORS_ALLOWED_ORIGINS),
    ...configuredOrigins(env.BETTER_AUTH_TRUSTED_ORIGINS ?? "filo://auth"),
    ...(env.APP_ENV === "development" ? DEV_EXTENSION_ORIGIN_PATTERNS : []),
  ];
}
