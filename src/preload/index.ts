// Preload script. Bridges main's IPC handlers to the renderer via window.api.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type RendererApi } from "@shared/ipc";

const api: RendererApi = {
  pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder),
  confirmCloseTab: (cwd) => ipcRenderer.invoke(IPC.dialogConfirmCloseTab, cwd),
  createSession: (cwd) => ipcRenderer.invoke(IPC.sessionCreate, cwd),
  closeSession: (sessionId) => ipcRenderer.invoke(IPC.sessionClose, sessionId),
  listSessions: () => ipcRenderer.invoke(IPC.sessionList),
  setActiveView: (sessionId) =>
    ipcRenderer.invoke(IPC.viewSetActive, sessionId),
  setViewBounds: (sessionId, bounds) =>
    ipcRenderer.invoke(IPC.viewSetBounds, sessionId, bounds),
  closeView: (sessionId) => ipcRenderer.invoke(IPC.viewClose, sessionId),
  getWorkspace: () => ipcRenderer.invoke(IPC.workspaceGet),
  setWorkspaceTabs: (tabs) => ipcRenderer.invoke(IPC.workspaceSetTabs, tabs),
  setWorkspaceActive: (activeId) =>
    ipcRenderer.invoke(IPC.workspaceSetActive, activeId),
  setWorkspaceSidebar: (state) =>
    ipcRenderer.invoke(IPC.workspaceSetSidebar, state),
  cwdExists: (cwd) => ipcRenderer.invoke(IPC.cwdExists, cwd),
  onMenuNewWorkspace: (cb) => {
    ipcRenderer.on(IPC.menuNewWorkspace, cb);
    return () => ipcRenderer.removeListener(IPC.menuNewWorkspace, cb);
  },
  onMenuToggleSidebar: (cb) => {
    ipcRenderer.on(IPC.menuToggleSidebar, cb);
    return () => ipcRenderer.removeListener(IPC.menuToggleSidebar, cb);
  },
};

// Puts `api` on the renderer's `window` as `window.api`.
// contextIsolation blocks direct assignment, so the bridge is the only way across.
contextBridge.exposeInMainWorld("api", api);
