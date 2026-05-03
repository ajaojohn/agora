// Main process entry. Owns app lifecycle, the BrowserWindow, the
// SessionManager that supervises code-server child processes, and the
// ViewManager that hosts each session's WebContentsView.
import { app, BrowserWindow, dialog } from "electron";
import { join } from "path";
import { registerDialogIpc } from "./ipc/dialog";
import { registerSessionIpc } from "./ipc/session";
import { registerViewIpc } from "./ipc/view";
import { locateCodeServer, CodeServerNotFoundError } from "./codeServerLocator";
import { SessionManager } from "./sessionManager";
import { ViewManager } from "./viewManager";

// Module-scope so before-quit can dispose them. Null until app.whenReady
// resolves the locator and constructs the managers.
let sessionManager: SessionManager | null = null;
let viewManager: ViewManager | null = null;

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
    viewManager = new ViewManager();
    registerDialogIpc();
    registerSessionIpc(sessionManager);
    registerViewIpc(viewManager, sessionManager);
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

// Tear down views first (UI state), then code-server children (backends),
// then exit. before-quit fires while the event loop is still spinning, so
// async disposeAll can complete. preventDefault stops Electron's default
// quit so we control exit timing; app.exit (not app.quit) skips re-firing
// before-quit and avoids a recursion loop.
app.on("before-quit", async (event) => {
  if (!sessionManager && !viewManager) return;
  const sm = sessionManager;
  const vm = viewManager;
  sessionManager = null;
  viewManager = null;
  event.preventDefault();
  try {
    vm?.destroyAll();
    await sm?.disposeAll();
  } finally {
    app.exit(0);
  }
});
