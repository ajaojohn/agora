// IPC handlers for native dialogs

import { IPC, type PickFolderResponse } from "@shared/ipc";
import { ipcMain, dialog, BrowserWindow } from "electron";

export function registerDialogIpc(window: BrowserWindow) {
  ipcMain.handle(
    IPC.dialogPickFolder,
    async (): Promise<PickFolderResponse> => {
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return { path: result.filePaths[0] };
    },
  );
}
