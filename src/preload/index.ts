// Preload script. Bridges main's IPC handlers to the renderer via window.api.
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type RendererApi } from "@shared/ipc";

const api: RendererApi = {
  pickFolder: () => ipcRenderer.invoke(IPC.dialogPickFolder),
};

// Puts `api` on the renderer's `window` as `window.api`.
// contextIsolation blocks direct assignment, so the bridge is the only way across.
contextBridge.exposeInMainWorld("api", api);
