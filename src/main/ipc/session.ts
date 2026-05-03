// IPC handlers for code-server session lifecycle.
//
// Thin pass-through to SessionManager. Errors thrown here surface in the
// renderer as rejected `window.api.*` promises.
//
// NOTE: createSession returns as soon as the child has been spawned -- the
// HTTP server takes ~5-10s to actually accept connections. The renderer is
// responsible for retrying / waiting on the port. M1 commit 9 will likely
// add a readiness probe (poll TCP / scrape stdout) before this returns.
import { ipcMain } from "electron";
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
}
