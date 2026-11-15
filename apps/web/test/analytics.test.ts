import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isPrivatePagePath } from "../src/lib/analytics.ts";

test("does not track authentication or account deletion pages", () => {
  for (const path of [
    "/sign-in",
    "/sign-up/callback",
    "/forgot-password",
    "/reset-password",
    "/sign-out",
    "/settings/account-deletion",
  ]) {
    assert.equal(isPrivatePagePath(path), true, path);
  }
});

test("tracks normal application pages", () => {
  assert.equal(isPrivatePagePath("/articles"), false);
  assert.equal(isPrivatePagePath("/settings"), false);
  assert.equal(isPrivatePagePath("/reset-password-help"), false);
});
