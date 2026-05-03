// IPC handlers for code-server WebContentsView lifecycle.
//
// Bridges renderer requests (`window.api.attachView` etc) to ViewManager.
// Resolves the parent BrowserWindow from the IPC sender's WebContents so the
// view attaches to the window the request came from -- no closure over a
// module-scope window ref that could go stale on macOS activate.
//
// `attach` looks up the session's port on SessionManager. Renderer only knows
// the sessionId; we keep the port-lookup detail server-side so a leaked port
// number can't be used to attach a view to an unrelated child.
import { ipcMain, BrowserWindow } from "electron";
import { IPC, type ViewBounds } from "@shared/ipc";
import type { ViewManager } from "../viewManager";
import type { SessionManager } from "../sessionManager";

export function registerViewIpc(
  viewManager: ViewManager,
  sessionManager: SessionManager,
): void {
  ipcMain.handle(
    IPC.viewAttach,
    async (event, sessionId: string): Promise<void> => {
      const session = sessionManager
        .list()
        .find((s) => s.sessionId === sessionId);
      if (!session) {
        throw new Error(`Unknown session: ${sessionId}`);
      }

      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) {
        throw new Error("No parent window for IPC sender");
      }

      await viewManager.attach(sessionId, session.port, parent);
    },
  );

  ipcMain.handle(
    IPC.viewSetBounds,
    async (_event, sessionId: string, bounds: ViewBounds): Promise<void> => {
      viewManager.setBounds(sessionId, bounds);
    },
  );

  ipcMain.handle(
    IPC.viewDetach,
    async (_event, sessionId: string): Promise<void> => {
      viewManager.detach(sessionId);
    },
  );
}
