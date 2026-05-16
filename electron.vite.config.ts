// Electron-vite build config for main, preload, and renderer targets. Each
// resolves the `@shared/*` alias to `src/shared/` so the cross-process type
// contract is the single source of truth. Main uses electron-vite 5's default
// `build.externalizeDeps: true` to keep node deps out of the bundle.
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  main: {
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  preload: {
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
});
