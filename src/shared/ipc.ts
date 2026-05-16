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

import { z } from "zod";

export const IPC = {
  dialogPickFolder: "dialog:pickFolder",
  sessionCreate: "session:create",
  sessionClose: "session:close",
  sessionList: "session:list",
  viewSetActive: "view:setActive",
  viewSetBounds: "view:setBounds",
  viewClose: "view:close",
  workspaceGet: "workspace:get",
  workspaceSetTabs: "workspace:setTabs",
  workspaceSetActive: "workspace:setActive",
  cwdExists: "cwd:exists",
  // One-way main -> renderer event (uses send/on, not invoke/handle).
  menuNewWorkspace: "menu:newWorkspace",
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

// Persisted record of one project tab. Lives in workspace.json and is the
// payload of workspace:* IPC. `id` is a stable UUID so renderer + main can
// agree on identity across restarts (the runtime sessionId is regenerated
// on each spawn). `order` defines display order in the tab bar.
export const TabSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  order: z.number().int().nonnegative(),
});
export type Tab = z.infer<typeof TabSchema>;

// Top-level shape of workspace.json. `activeId` is the tab the user was
// last on -- bootstrap respawns this one eagerly. Null means no active tab.
// `codeServerPort` is the port the shared code-server bound to last time;
// reusing it across launches keeps the workspace URI stable so VS Code's
// per-workspace state (open editors, panel sizes, sidebar widths) actually
// persists. Optional because cold launch hasn't picked one yet.
export const WorkspaceSchema = z.object({
  tabs: z.array(TabSchema),
  activeId: z.string().nullable(),
  codeServerPort: z.number().int().positive().optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const EMPTY_WORKSPACE: Workspace = { tabs: [], activeId: null };

export interface RendererApi {
  pickFolder(): Promise<PickFolderResponse>;
  createSession(cwd: string): Promise<Session>;
  closeSession(sessionId: string): Promise<void>;
  listSessions(): Promise<Session[]>;
  // Foregrounds the named session's WebContentsView, hiding whatever was
  // previously active. First call for a sessionId is slow (5-10s typical,
  // up to 30s) -- main spawns the view, waits for code-server's HTTP port,
  // and loads the page. Subsequent calls reuse the live webContents,
  // resolving instantly. Pass null to hide the current view without
  // showing another. Show a spinner during first-time activation.
  setActiveView(sessionId: string | null): Promise<void>;
  setViewBounds(sessionId: string, bounds: ViewBounds): Promise<void>;
  // Permanently destroys the session's view. webContents is closed; future
  // setActiveView for this sessionId would re-spawn from scratch. Use on
  // close-tab.
  closeView(sessionId: string): Promise<void>;
  // Persisted tab list. getWorkspace returns the current snapshot (cheap,
  // in-memory). setTabs / setActive mutate and schedule a debounced disk
  // write; the change is visible immediately on subsequent getWorkspace.
  getWorkspace(): Promise<Workspace>;
  setWorkspaceTabs(tabs: Tab[]): Promise<void>;
  setWorkspaceActive(activeId: string | null): Promise<void>;
  // Server-side fs.access check. Used by the renderer's spawn flow to give
  // a clearer "Folder no longer exists" error before attempting a code-
  // server spawn that would fail anyway.
  cwdExists(cwd: string): Promise<boolean>;
  onMenuNewWorkspace(cb: () => void): () => void;
}
