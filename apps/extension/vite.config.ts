import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { browserTarget, manifestFor, outDir, type BrowserTarget } from "./vite.target";

// The Web bridge content script runs only on the Filo Web origin, so the
// manifest's placeholder match must track VITE_WEB_APP_URL. The rest of the
// manifest is adapted to the target browser.
function filoManifest(webOrigin: string, target: BrowserTarget): Plugin {
  return {
    name: "filo-manifest",
    closeBundle() {
      const manifestPath = resolve(__dirname, outDir(target), "manifest.json");
      if (!existsSync(manifestPath)) return;
      const manifest = manifestFor(target, JSON.parse(readFileSync(manifestPath, "utf8")));
      for (const script of manifest.content_scripts ?? []) {
        script.matches = script.matches.map((pattern) => pattern === "http://localhost:5173/*" ? `${webOrigin}/*` : pattern);
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

function validateEnvironment(mode: string, env: Record<string, string>): void {
  const isProduction = mode === "production";
  const apiBaseUrl = env.VITE_API_BASE_URL ?? "";
  const webAppUrl = env.VITE_WEB_APP_URL ?? "";

  if (isProduction) {
    if (!apiBaseUrl.startsWith("https://") || !webAppUrl.startsWith("https://")) {
      throw new Error("Production extension builds require https API and Web URLs.");
    }
    return;
  }

  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiBaseUrl)) {
    throw new Error("Development extension builds require a localhost VITE_API_BASE_URL.");
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(webAppUrl)) {
    throw new Error("Development extension builds require a localhost VITE_WEB_APP_URL.");
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  validateEnvironment(mode, env);
  const webOrigin = new URL(env.VITE_WEB_APP_URL ?? "http://localhost:5173").origin;
  const target = browserTarget();

  return {
    base: "./",
    plugins: [react(), filoManifest(webOrigin, target)],
    define: {
      global: "globalThis",
    },
    build: {
      outDir: outDir(target),
      emptyOutDir: false,
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "popup.html"),
          background: resolve(__dirname, "src/background.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunk-[name].js",
          assetFileNames: "[name].[ext]",
          inlineDynamicImports: false,
        },
      },
    },
    publicDir: "public",
  };
});
