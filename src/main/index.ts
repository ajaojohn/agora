// Main process entry. Owns app lifecycle, the BrowserWindow, the SHARED
// code-server SessionManager, the ViewManager that hosts each tab's
// WebContentsView, and the WorkspaceStore that persists tab list + the
// chosen code-server port across launches.
import { app, BrowserWindow, dialog } from "electron";
import { join } from "path";
import { registerDialogIpc } from "./ipc/dialog";
import { registerSessionIpc } from "./ipc/session";
import { registerViewIpc } from "./ipc/view";
import { registerWorkspaceIpc } from "./ipc/workspace";
import { locateCodeServer, CodeServerNotFoundError } from "./codeServerLocator";
import { SessionManager, pickStablePort } from "./sessionManager";
import { ViewManager } from "./viewManager";
import { WorkspaceStore } from "./workspaceStore";
import { seedUserDataDir } from "./userDataSeeder";

// Module-scope so before-quit can dispose them. Null until app.whenReady
// resolves the locator and constructs the managers.
let sessionManager: SessionManager | null = null;
let viewManager: ViewManager | null = null;
let workspaceStore: WorkspaceStore | null = null;

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
    const codeServerUserDataDir = join(
      app.getPath("userData"),
      "code-server-data",
    );
    // Seed default settings.json (theme) before code-server reads it.
    await seedUserDataDir(codeServerUserDataDir);

    // Workspace must load BEFORE pickStablePort so the persisted port is
    // visible. WorkspaceStore.set during pickStablePort schedules a
    // debounced write of the (possibly new) port; before-quit flushes it.
    workspaceStore = new WorkspaceStore(
      join(app.getPath("userData"), "workspace.json"),
    );
    const workspace = await workspaceStore.load();

    const port = await pickStablePort(workspace, (next) =>
      workspaceStore!.set(next),
    );
    // Force the (possibly new) port to disk before code-server starts using
    // it -- otherwise an early crash within the 500ms debounce window would
    // lose the port choice and orphan all the workspaceStorage entries.
    await workspaceStore.flush();

    sessionManager = new SessionManager({
      codeServerPath,
      userDataDir: codeServerUserDataDir,
      port,
    });
    viewManager = new ViewManager();

    console.log(`[main] code-server resolved at ${codeServerPath}`);
    console.log(`[main] starting shared code-server on port ${port}...`);
    await sessionManager.start();
    console.log(`[main] code-server ready`);
    console.log(
      `[main] workspace loaded: ${workspace.tabs.length} tab(s), activeId=${workspace.activeId}`,
    );

    registerDialogIpc();
    registerSessionIpc(sessionManager);
    registerViewIpc(viewManager, sessionManager);
    registerWorkspaceIpc(workspaceStore);
  } catch (err) {
    if (err instanceof CodeServerNotFoundError) {
      dialog.showErrorBox("code-server not found", err.message);
      app.quit();
      return;
    }
    // Surface other startup failures (port conflict, code-server crash on
    // launch, readiness timeout) without leaving the user staring at a
    // blank Electron window.
    dialog.showErrorBox(
      "Failed to start code-server",
      err instanceof Error ? err.message : String(err),
    );
    app.quit();
    return;
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
  if (!sessionManager && !viewManager && !workspaceStore) return;
  const sm = sessionManager;
  const vm = viewManager;
  const ws = workspaceStore;
  sessionManager = null;
  viewManager = null;
  workspaceStore = null;
  event.preventDefault();
  try {
    // Persist tab list FIRST -- if it fails or hangs we still want to kill
    // the children. Inverse order would risk losing the workspace write
    // because disposeAll's SIGKILL timeout could push us past whatever
    // grace window the OS allows for app exit.
    if (ws) {
      await ws
        .flush()
        .catch((err) => console.error("[main] workspace flush failed:", err));
    }
    vm?.destroyAll();
    await sm?.disposeAll();
  } finally {
    app.exit(0);
  }
});
