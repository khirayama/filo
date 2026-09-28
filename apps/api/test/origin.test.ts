import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  DEV_EXTENSION_ORIGIN_PATTERNS,
  resolveBetterAuthTrustedOrigins,
  resolveCorsOrigin,
} from "../src/lib/origin";

const unpackedExtensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe("API origins", () => {
  it("allows unpacked Chrome extensions in development", () => {
    expect(resolveCorsOrigin(unpackedExtensionOrigin, "", "development")).toBe(unpackedExtensionOrigin);
  });

  it("allows temporarily loaded Firefox and Safari extensions in development", () => {
    const firefox = "moz-extension://0f8c2a4e-1b3d-4e5f-9a7b-6c8d0e2f4a6b";
    const safari = "safari-web-extension://0F8C2A4E-1B3D-4E5F-9A7B-6C8D0E2F4A6B";
    expect(resolveCorsOrigin(firefox, "", "development")).toBe(firefox);
    expect(resolveCorsOrigin(safari, "", "development")).toBe(safari);
    expect(resolveCorsOrigin(firefox, "", "production")).toBeUndefined();
  });

  it("rejects invalid extension origins", () => {
    expect(resolveCorsOrigin("chrome-extension://not-an-extension-id", "", "development")).toBeUndefined();
    expect(resolveCorsOrigin("moz-extension://abcdefghijklmnopabcdefghijklmnop", "", "development")).toBeUndefined();
  });

  it("requires an explicit extension origin in production", () => {
    expect(resolveCorsOrigin(unpackedExtensionOrigin, "", "production")).toBeUndefined();
    expect(resolveCorsOrigin(unpackedExtensionOrigin, unpackedExtensionOrigin, "production")).toBe(unpackedExtensionOrigin);
  });

  it("adds the extension wildcards to Better Auth only in development", () => {
    const baseEnv = {
      CORS_ALLOWED_ORIGINS: "http://localhost:5173",
      BETTER_AUTH_TRUSTED_ORIGINS: "filo://auth",
    } as Env;

    expect(resolveBetterAuthTrustedOrigins({ ...baseEnv, APP_ENV: "development" })).toEqual(
      expect.arrayContaining(DEV_EXTENSION_ORIGIN_PATTERNS),
    );
    for (const pattern of DEV_EXTENSION_ORIGIN_PATTERNS) {
      expect(resolveBetterAuthTrustedOrigins({ ...baseEnv, APP_ENV: "production" })).not.toContain(pattern);
    }
  });
});
