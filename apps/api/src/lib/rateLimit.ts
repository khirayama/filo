import { errors } from "./errors";

export function rateLimitRoute(method: string, path: string): string {
  return `${method}:${path.replace(/\/\d+(?=\/|$)/g, "/:id")}`;
}

export async function enforceRateLimit(limiter: RateLimit, dimensions: string[]): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dimensions.join("\u0000")));
  const key = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const outcome = await limiter.limit({ key });
  if (!outcome.success) throw errors.rateLimited();
}
