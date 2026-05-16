// Electron-vite build config. Defines the main and renderer targets.
// Preload target is added in commit 4 when the IPC bridge lands.
//
// Note: dependency externalization for main is on by default in electron-vite 5
// (`build.externalizeDeps: true`). When node-pty arrives in commit 7, that
// default will keep its native binary out of the bundle automatically.
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
