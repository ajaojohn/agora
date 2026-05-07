// IPC handlers for code-server WebContentsView lifecycle.
//
// Three channels: setActive (foreground a session, lazily spawn+load if
// first time), setBounds (renderer-driven resize), close (permanent
// destroy, used on close-tab).
//
// `setActive` resolves the parent BrowserWindow from the IPC sender's
// WebContents so attaches stay correct after macOS recreates the window
// on activate. The session's port is looked up server-side via
// SessionManager.list -- renderer only knows the sessionId, can't aim a
// view at an arbitrary localhost port.
import { ipcMain, BrowserWindow } from "electron";
import { IPC, type ViewBounds } from "@shared/ipc";
import type { ViewManager } from "../viewManager";
import type { SessionManager } from "../sessionManager";

export function registerViewIpc(
  viewManager: ViewManager,
  sessionManager: SessionManager,
): void {
  ipcMain.handle(
    IPC.viewSetActive,
    async (event, sessionId: string | null): Promise<void> => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) {
        throw new Error("No parent window for IPC sender");
      }

      // For null (hide current) we don't need port/cwd. For a real
      // sessionId we look these up even if ViewManager already has the
      // view -- ViewManager ignores them when not first-time, so passing
      // them is harmless and means we never have to track which sessions
      // have been attached.
      let port: number | undefined;
      let cwd: string | undefined;
      if (sessionId !== null) {
        const session = sessionManager
          .list()
          .find((s) => s.sessionId === sessionId);
        if (!session) {
          throw new Error(`Unknown session: ${sessionId}`);
        }
        port = session.port;
        cwd = session.cwd;
      }

      await viewManager.setActive(sessionId, parent, port, cwd);
    },
  );

  ipcMain.handle(
    IPC.viewSetBounds,
    async (_event, sessionId: string, bounds: ViewBounds): Promise<void> => {
      viewManager.setBounds(sessionId, bounds);
    },
  );

  ipcMain.handle(
    IPC.viewClose,
    async (_event, sessionId: string): Promise<void> => {
      viewManager.close(sessionId);
    },
  );
}
