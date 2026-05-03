// Main process entry. Owns app lifecycle, the BrowserWindow, and the
// SessionManager that supervises code-server child processes.
import { app, BrowserWindow, dialog } from "electron";
import { join } from "path";
import { registerDialogIpc } from "./ipc/dialog";
import { registerSessionIpc } from "./ipc/session";
import { locateCodeServer, CodeServerNotFoundError } from "./codeServerLocator";
import { SessionManager } from "./sessionManager";

// Module-scope so before-quit / window-all-closed handlers can dispose it.
// Null until app.whenReady resolves the locator. IPC handlers (commit 8) will
// guard against null and surface a UI error if the binary went missing.
let sessionManager: SessionManager | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  registerDialogIpc(win);

  // electron-vite sets ELECTRON_RENDERER_URL in dev so HMR works against the Vite dev server.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

async function bootstrap(): Promise<void> {
  try {
    const codeServerPath = await locateCodeServer();
    sessionManager = new SessionManager({
      codeServerPath,
      userDataDir: join(app.getPath("userData"), "code-server-data"),
    });
    registerSessionIpc(sessionManager);
    console.log(`[main] code-server resolved at ${codeServerPath}`);
  } catch (err) {
    if (err instanceof CodeServerNotFoundError) {
      // Show a blocking error dialog so the missing-dep state is impossible to miss.
      // Replaced by an in-app empty state once the renderer can render one (M1 commit 10).
      dialog.showErrorBox("code-server not found", err.message);
      app.quit();
      return;
    }
    throw err;
  }

  createWindow();
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Mac convention: clicking the dock icon with no windows open re-opens one.
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Kill every code-server child before the app fully exits. before-quit fires
// while the event loop is still spinning, so async disposeAll can complete.
app.on("before-quit", async (event) => {
  if (!sessionManager) return;
  const manager = sessionManager;
  sessionManager = null;
  event.preventDefault();
  try {
    await manager.disposeAll();
  } finally {
    app.exit(0);
  }
});
