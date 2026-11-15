import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  DEV_EXTENSION_ORIGIN_PATTERNS,
  resolveBetterAuthTrustedOrigins,
  resolveCorsOrigin,
} from "../src/lib/origin";

const unpackedExtensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

describe("API origins", () => {
  it("allows local web origins in development", () => {
    expect(resolveCorsOrigin("http://localhost:5173", "", "development")).toBe("http://localhost:5173");
    expect(resolveCorsOrigin("http://127.0.0.1:5173", "", "development")).toBe("http://127.0.0.1:5173");
  });

  it("does not implicitly allow local web origins in production", () => {
    expect(resolveCorsOrigin("http://localhost:5173", "", "production")).toBeUndefined();
    expect(resolveCorsOrigin("http://127.0.0.1:5173", "", "production")).toBeUndefined();
  });

  it("allows an explicitly configured local origin in production", () => {
    expect(resolveCorsOrigin("http://localhost:5173", "http://localhost:5173", "production")).toBe(
      "http://localhost:5173",
    );
  });

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
      BETTER_AUTH_TRUSTED_ORIGINS: "http://127.0.0.1:5173",
    } as Env;

    expect(resolveBetterAuthTrustedOrigins({ ...baseEnv, APP_ENV: "development" })).toEqual(
      expect.arrayContaining(DEV_EXTENSION_ORIGIN_PATTERNS),
    );
    for (const pattern of DEV_EXTENSION_ORIGIN_PATTERNS) {
      expect(resolveBetterAuthTrustedOrigins({ ...baseEnv, APP_ENV: "production" })).not.toContain(pattern);
    }
  });

  it("does not trust a mobile custom scheme by default", () => {
    const env = {
      CORS_ALLOWED_ORIGINS: "https://filoreader.app",
    } as Env;
    expect(resolveBetterAuthTrustedOrigins(env)).not.toContain("filo://auth");
  });
});
