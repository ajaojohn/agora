// macOS application menu. Standard role-based defaults plus custom File and
// View items. Agora shell shortcuts all live in the Ctrl+Cmd namespace so
// they can never collide with VS Code's own keys. Items whose `id` starts
// with "agora:" are also dispatched by menuAccelerators.ts when a
// code-server view has focus.
import {
  Menu,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { IPC } from "@shared/ipc";

export function installApplicationMenu(
  getMainWindow: () => BrowserWindow | null,
  onReloadEditor: () => void,
): void {
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          id: "agora:newWorkspace",
          label: "New Workspace...",
          accelerator: "Ctrl+Cmd+N",
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
        {
          id: "agora:reloadEditor",
          label: "Reload Editor",
          accelerator: "Ctrl+Cmd+R",
          click: () => onReloadEditor(),
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
