// IPC handlers for native dialogs.
//
// Registered once at app bootstrap, not per-window. ipcMain.handle is global
// per channel and re-registering throws, so this must not run on every
// createWindow() call (e.g. macOS `activate` re-opens the window).
// Parents the dialog to the currently-focused window at invoke time, so it
// stays correct even after the original window is destroyed and recreated.

import { IPC, type PickFolderResponse } from "@shared/ipc";
import { ipcMain, dialog, BrowserWindow } from "electron";

export function registerDialogIpc(): void {
  ipcMain.handle(
    IPC.dialogPickFolder,
    async (): Promise<PickFolderResponse> => {
      const opts: Electron.OpenDialogOptions = {
        properties: ["openDirectory"],
      };
      const parent = BrowserWindow.getFocusedWindow();
      const result = parent
        ? await dialog.showOpenDialog(parent, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return { path: result.filePaths[0] };
    },
  );
  ipcMain.handle(
    IPC.dialogConfirmCloseTab,
    async (_event, cwd: unknown): Promise<boolean> => {
      const folder = typeof cwd === "string" ? cwd : "";
      const name = folder.split("/").filter(Boolean).pop() ?? "this project";
      const opts: Electron.MessageBoxOptions = {
        type: "warning",
        buttons: ["Close Project", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        message: `Close "${name}"?`,
        detail:
          "Anything running in its terminals keeps running in the background until Agora quits.",
      };
      const parent = BrowserWindow.getFocusedWindow();
      const result = parent
        ? await dialog.showMessageBox(parent, opts)
        : await dialog.showMessageBox(opts);
      return result.response === 0;
    },
  );
}
