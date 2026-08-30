import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  CHROME_EXTENSION_ORIGIN_PATTERN,
  resolveBetterAuthTrustedOrigins,
  resolveCorsOrigin,
} from "../src/lib/origin";

const unpackedExtensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe("API origins", () => {
  it("allows unpacked Chrome extensions in development", () => {
    expect(resolveCorsOrigin(unpackedExtensionOrigin, "", "development")).toBe(unpackedExtensionOrigin);
  });

  it("rejects invalid extension origins", () => {
    expect(resolveCorsOrigin("chrome-extension://not-an-extension-id", "", "development")).toBeUndefined();
    expect(resolveCorsOrigin("moz-extension://abcdefghijklmnopabcdefghijklmnop", "", "development")).toBeUndefined();
  });

  it("requires an explicit extension origin in production", () => {
    expect(resolveCorsOrigin(unpackedExtensionOrigin, "", "production")).toBeUndefined();
    expect(resolveCorsOrigin(unpackedExtensionOrigin, unpackedExtensionOrigin, "production")).toBe(unpackedExtensionOrigin);
  });

  it("adds the extension wildcard to Better Auth only in development", () => {
    const baseEnv = {
      CORS_ALLOWED_ORIGINS: "http://localhost:5173",
      BETTER_AUTH_TRUSTED_ORIGINS: "filo://auth",
    } as Env;

    expect(resolveBetterAuthTrustedOrigins({ ...baseEnv, APP_ENV: "development" })).toContain(
      CHROME_EXTENSION_ORIGIN_PATTERN,
    );
    expect(resolveBetterAuthTrustedOrigins({ ...baseEnv, APP_ENV: "production" })).not.toContain(
      CHROME_EXTENSION_ORIGIN_PATTERN,
    );
  });
});
