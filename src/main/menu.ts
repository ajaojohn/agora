// macOS application menu. Standard role-based defaults plus a File menu
// with "New Workspace..." (Cmd+Shift+N) and a custom View menu with
// "Toggle Sidebar" (Cmd+Ctrl+B). Items whose `id` starts with "agora:" are
// also dispatched by menuAccelerators.ts when a code-server view has focus.
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
          id: "agora:newWorkspace",
          label: "New Workspace...",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            // Target the shell window, not the focused webContents -- a
            // code-server view has no preload bridge to receive on.
            getMainWindow()?.webContents.send(IPC.menuNewWorkspace);
          },
        },
        {
          id: "agora:closeTab",
          label: "Close Workspace",
          accelerator: "Ctrl+Cmd+W",
          click: () => {
            getMainWindow()?.webContents.send(IPC.menuCloseTab);
          },
        },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          id: "agora:toggleSidebar",
          label: "Toggle Sidebar",
          accelerator: "Cmd+Ctrl+B",
          click: () => {
            getMainWindow()?.webContents.send(IPC.menuToggleSidebar);
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
