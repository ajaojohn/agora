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
} as const;

export type PickFolderResponse = { path: string } | null;

// One running code-server child as seen by the renderer.
// `proc` and other internal handles never cross IPC -- only this serializable shape.
export interface Session {
  sessionId: string;
  port: number;
  cwd: string;
}

export interface RendererApi {
  pickFolder(): Promise<PickFolderResponse>;
  createSession(cwd: string): Promise<Session>;
  closeSession(sessionId: string): Promise<void>;
  listSessions(): Promise<Session[]>;
}
