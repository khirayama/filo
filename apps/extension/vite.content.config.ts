import { defineConfig } from "vite";
import { resolve } from "path";
import { browserTarget, outDir } from "./vite.target";

export default defineConfig({
  // The main build already copied public/ (and rewrote manifest.json there).
  publicDir: false,
  build: {
    outDir: outDir(browserTarget()),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content.ts"),
      formats: ["iife"],
      name: "FiloContent",
      fileName: () => "content.js",
    },
  },
});
