// Preload script. Bridges main's IPC handlers to the renderer via window.api.
// Empty for now — channels added in commit 6 onward.
import { contextBridge } from 'electron';
import type { RendererApi } from '@shared/ipc';

const api: RendererApi = {};

// Puts `api` on the renderer's `window` as `window.api`.
// contextIsolation blocks direct assignment, so the bridge is the only way across.
contextBridge.exposeInMainWorld('api', api);
