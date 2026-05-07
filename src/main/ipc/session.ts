// IPC handlers for code-server session lifecycle + the related cwd:exists
// probe (folder-existence check used by the renderer's spawn flow to
// surface a clearer error message before attempting a doomed spawn).
//
// Thin pass-through to SessionManager. Errors thrown here surface in the
// renderer as rejected `window.api.*` promises.
//
// NOTE: createSession returns as soon as the child has been spawned -- the
// HTTP server takes ~5-10s to actually accept connections. The renderer
// waits for readiness via view:setActive, which calls tcpReady server-side.
import { ipcMain } from "electron";
import { access } from "fs/promises";
import { IPC, type Session } from "@shared/ipc";
import type { SessionManager } from "../sessionManager";

export function registerSessionIpc(manager: SessionManager): void {
  ipcMain.handle(
    IPC.sessionCreate,
    async (_event, cwd: string): Promise<Session> => {
      return manager.create(cwd);
    },
  );

  ipcMain.handle(
    IPC.sessionClose,
    async (_event, sessionId: string): Promise<void> => {
      await manager.close(sessionId);
    },
  );

  ipcMain.handle(IPC.sessionList, async (): Promise<Session[]> => {
    return manager.list();
  });

  ipcMain.handle(
    IPC.cwdExists,
    async (_event, cwd: string): Promise<boolean> => {
      try {
        await access(cwd);
        return true;
      } catch {
        return false;
      }
    },
  );
}
