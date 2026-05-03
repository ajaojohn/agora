// Preload script. Bridges main's IPC handlers to the renderer via window.api.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type RendererApi } from "@shared/ipc";

const api: RendererApi = {
  pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder),
  createSession: (cwd) => ipcRenderer.invoke(IPC.sessionCreate, cwd),
  closeSession: (sessionId) => ipcRenderer.invoke(IPC.sessionClose, sessionId),
  listSessions: () => ipcRenderer.invoke(IPC.sessionList),
  attachView: (sessionId) => ipcRenderer.invoke(IPC.viewAttach, sessionId),
  setViewBounds: (sessionId, bounds) =>
    ipcRenderer.invoke(IPC.viewSetBounds, sessionId, bounds),
  detachView: (sessionId) => ipcRenderer.invoke(IPC.viewDetach, sessionId),
  getWorkspace: () => ipcRenderer.invoke(IPC.workspaceGet),
  setWorkspaceTabs: (tabs) => ipcRenderer.invoke(IPC.workspaceSetTabs, tabs),
  setWorkspaceActive: (activeId) =>
    ipcRenderer.invoke(IPC.workspaceSetActive, activeId),
};

// Puts `api` on the renderer's `window` as `window.api`.
// contextIsolation blocks direct assignment, so the bridge is the only way across.
contextBridge.exposeInMainWorld("api", api);
