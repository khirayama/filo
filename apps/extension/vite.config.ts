import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";

// MV3 blocks requests to hosts missing from host_permissions, so the
// manifest's API entry must track VITE_API_BASE_URL instead of being pinned
// to localhost.
function manifestApiHost(apiOrigin: string): Plugin {
  return {
    name: "filo-manifest-api-host",
    closeBundle() {
      const manifestPath = resolve(__dirname, "dist/manifest.json");
      if (!existsSync(manifestPath)) return;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { host_permissions?: string[] };
      manifest.host_permissions = (manifest.host_permissions ?? []).map((pattern) =>
        pattern === "http://localhost:8787/*" ? `${apiOrigin}/*` : pattern
      );
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const apiBase = env.VITE_API_BASE_URL ?? "http://localhost:8787";
  const apiOrigin = new URL(apiBase).origin;

  return {
    base: "./",
    plugins: [react(), manifestApiHost(apiOrigin)],
    define: {
      global: "globalThis",
    },
    build: {
      outDir: "dist",
      emptyOutDir: false,
      modulePreload: false,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "popup.html"),
          background: resolve(__dirname, "src/background.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "[name].js",
          assetFileNames: "[name].[ext]",
          inlineDynamicImports: false,
        },
      },
    },
    publicDir: "public",
  };
});
