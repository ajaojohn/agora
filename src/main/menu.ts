// macOS application menu. Standard role-based defaults plus a File menu
// with "New Workspace..." (Cmd+Shift+N). The accelerator must live on a
// menu item so it preempts code-server's own Cmd+Shift+N handler.
import {
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { IPC } from "@shared/ipc";

export function installApplicationMenu(
  getMainWindow: () => BrowserWindow | null,
): void {
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "New Workspace...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            // Target the shell window, not the focused webContents -- a
            // code-server view has no preload bridge to receive on.
            getMainWindow()?.webContents.send(IPC.menuNewWorkspace);
          },
        },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
