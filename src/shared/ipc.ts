// Single source of truth for IPC. Channel-name constants, payload types,
// and the RendererApi interface implemented by the preload.
//
// Adding a channel is a 5-step change:
//   (1) add to IPC constants below
//   (2) define request/response types here
//   (3) add the method to RendererApi
//   (4) implement it in src/preload/index.ts
//   (5) handle it in src/main/ipc/<area>.ts
// Missing any step produces compile errors on both sides.

export const IPC = {
  dialogPickFolder: "dialog:pickFolder",
  sessionCreate: "session:create",
  sessionClose: "session:close",
  sessionList: "session:list",
  viewAttach: "view:attach",
  viewSetBounds: "view:setBounds",
  viewDetach: "view:detach",
} as const;

export type PickFolderResponse = { path: string } | null;

// One running code-server child as seen by the renderer.
// `proc` and other internal handles never cross IPC -- only this serializable shape.
export interface Session {
  sessionId: string;
  port: number;
  cwd: string;
}

// Position + size of a code-server WebContentsView inside the BrowserWindow.
// Renderer measures its content area (excluding tab bar) and reports here.
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RendererApi {
  pickFolder(): Promise<PickFolderResponse>;
  createSession(cwd: string): Promise<Session>;
  closeSession(sessionId: string): Promise<void>;
  listSessions(): Promise<Session[]>;
  // Spawns a code-server WebContentsView for an existing session, waits for
  // the port to be live + the page to render, resolves on success. Slow:
  // 5-10s typical, can take up to 30s. Show a spinner.
  attachView(sessionId: string): Promise<void>;
  setViewBounds(sessionId: string, bounds: ViewBounds): Promise<void>;
  detachView(sessionId: string): Promise<void>;
}
