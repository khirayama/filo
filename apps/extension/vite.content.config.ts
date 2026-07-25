import { defineConfig } from "vite";
import { resolve } from "path";

// MV3 content scripts are classic scripts and cannot use ES module imports,
// so content.ts is built separately as a self-contained IIFE bundle.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content.ts"),
      formats: ["iife"],
      name: "FiloContent",
      fileName: () => "content.js",
    },
  },
});
