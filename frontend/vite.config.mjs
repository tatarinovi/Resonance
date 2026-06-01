import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const srcRoot = path.resolve(process.cwd(), "src");

export default defineConfig({
  resolve: {
    alias: {
      "@": srcRoot,
    },
    dedupe: ["react", "react-dom"],
  },
  /** Tailwind обрабатывается через PostCSS (`postcss.config.mjs` + `@tailwindcss/postcss`). */
  plugins: [react()],
  base: "/",
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setupTests.ts"],
  },
});
