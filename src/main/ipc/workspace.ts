// IPC handlers for the persisted tab list (workspace.json).
//
// Thin pass-through to WorkspaceStore. Mutations replace the whole field
// (tabs or activeId) -- renderer is the source of truth for both, so it
// always sends the full list. Schema validation runs server-side via the
// store, so even a malformed payload from a compromised renderer can't
// poison the on-disk file beyond a debounce window.
import { ipcMain } from "electron";
import { IPC, TabSchema, type Tab, type Workspace } from "@shared/ipc";
import { z } from "zod";
import type { WorkspaceStore } from "../workspaceStore";

// Local schemas for payload validation. setTabs takes Tab[]; setActive takes
// string|null. Reject malformed payloads explicitly so the store snapshot
// never holds invalid data.
const TabsPayload = z.array(TabSchema);
const ActivePayload = z.string().nullable();

export function registerWorkspaceIpc(store: WorkspaceStore): void {
  ipcMain.handle(IPC.workspaceGet, async (): Promise<Workspace> => {
    return store.current();
  });

  ipcMain.handle(
    IPC.workspaceSetTabs,
    async (_event, tabs: unknown): Promise<void> => {
      const validated: Tab[] = TabsPayload.parse(tabs);
      const next = { ...store.current(), tabs: validated };
      store.set(next);
    },
  );

  ipcMain.handle(
    IPC.workspaceSetActive,
    async (_event, activeId: unknown): Promise<void> => {
      const validated = ActivePayload.parse(activeId);
      const next = { ...store.current(), activeId: validated };
      store.set(next);
    },
  );
}
