import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function validateEnvironment(mode: string, env: Record<string, string>): void {
  const isProduction = mode === "production";
  const apiBaseUrl = env.VITE_API_BASE_URL ?? "";

  if (isProduction) {
    if (!apiBaseUrl.startsWith("https://")) {
      throw new Error("Production web builds require an https VITE_API_BASE_URL.");
    }
    return;
  }

  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiBaseUrl)) {
    throw new Error("Development web builds require a localhost VITE_API_BASE_URL.");
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  validateEnvironment(mode, env);
  return { plugins: [react()] };
});
