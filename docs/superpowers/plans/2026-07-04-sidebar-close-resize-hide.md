# Sidebar Close UX + Resize/Hide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarded, discoverable tab close (hover × + native confirm sheet) and a drag-resizable, hideable sidebar, per `docs/superpowers/specs/2026-07-04-sidebar-close-resize-hide-design.md`.

**Architecture:** Renderer-only UI changes in `App.tsx`/`TabBar.tsx`/`index.css`, three new IPC channels via the 5-step contract in `src/shared/ipc.ts` (`dialog:confirmCloseTab`, `workspace:setSidebar`, `menu:toggleSidebar`), and a generic menu-accelerator dispatcher in main replacing `viewManager.ts`'s hardcoded Cmd+Shift+N match.

**Tech Stack:** Electron 35 / React 19 / TypeScript / zod. No test runner exists in this repo — per-task verification is `npm run typecheck` plus targeted manual checks in `npm run dev`. (TDD deviation is deliberate; adding a test harness is out of scope.)

**One evolving file warning:** Tasks 1, 3, 6, 7, 9 all edit `src/renderer/App.tsx`. Execute tasks **in order**; each task's "old" snippets assume the previous task landed.

---

### Task 1: Fix close-while-loading leak (existing latent bug)

Closing a tab whose spawn is in flight removes the tab but lets `spawn()` finish, re-inserting per-tab state for a deleted tab id and leaking a hidden live WebContentsView + a stale session record. Also fixes the stale "closing kills a code-server" comments (all tabs share one server since the shared-process refactor).

**Files:**

- Modify: `src/renderer/App.tsx` (spawn function, ~line 65; close comment ~line 141)
- Modify: `src/renderer/TabBar.tsx` (header comment, lines 1–4)

- [ ] **Step 1: Add a tabs ref mirror in `App()`**

Directly after the `perTabState` useState (App.tsx ~line 32), add:

```tsx
// Ref mirror of tabs -- spawn() completions race against close(); they
// must check tab membership at resolution time, not capture time.
const tabsRef = useRef(tabs);
tabsRef.current = tabs;
```

- [ ] **Step 2: Replace the whole `spawn` function**

```tsx
// Spawn a tab: pre-check cwd existence, then createSession + setActiveView.
// Updates perTabState through each phase. cwd-vanished gets a clearer
// message (Q14 cwd-vanished special case). Every await is a window for the
// user to close the tab, so each landing checks `gone()` -- a completed
// spawn for a closed tab must tear down its view + session instead of
// re-inserting state for a deleted id.
async function spawn(tab: Tab): Promise<void> {
  setPerTabState((prev) => new Map(prev).set(tab.id, { kind: "loading" }));

  const gone = (): boolean => !tabsRef.current.some((t) => t.id === tab.id);

  if (!(await window.api.cwdExists(tab.cwd))) {
    if (gone()) return;
    setPerTabState((prev) =>
      new Map(prev).set(tab.id, {
        kind: "error",
        message: `Folder no longer exists at ${tab.cwd}`,
      }),
    );
    return;
  }

  let session: Session | null = null;
  try {
    session = await window.api.createSession(tab.cwd);
    await window.api.setActiveView(session.sessionId);
    if (gone()) {
      // Tab closed mid-spawn: destroy the view + session that just came
      // up so they don't leak as a hidden webContents + stale record.
      await window.api.closeView(session.sessionId);
      await window.api.closeSession(session.sessionId);
      return;
    }
    setPerTabState((prev) =>
      new Map(prev).set(tab.id, { kind: "loaded", session: session! }),
    );
  } catch (err) {
    if (session) {
      await window.api.closeSession(session.sessionId).catch(() => {
        // best-effort -- the stale record is dropped at app quit anyway
      });
    }
    if (gone()) return;
    const message = err instanceof Error ? err.message : String(err);
    setPerTabState((prev) =>
      new Map(prev).set(tab.id, { kind: "error", message }),
    );
  }
}
```

Known pre-existing limitation (do not fix here): two concurrent `setActiveView` calls can interleave in main; the cleanup above guarantees the closed tab's view is destroyed regardless of which call wins.

- [ ] **Step 3: Fix the stale close comment on `close()`**

Old (App.tsx ~line 141):

```tsx
// Close-tab: destroy view + kill code-server, remove from list, switch
```

New:

```tsx
// Close-tab: destroy view + drop the session record (the shared
// code-server keeps running for other tabs), remove from list, switch
```

- [ ] **Step 4: Fix the stale TabBar header comment**

Old (TabBar.tsx lines 1–4):

```tsx
// Vertical tab bar -- one row per persisted project, "+" at the bottom.
// Right-click on a row pops a context menu with a single Close action
// (Q7: closing kills a code-server + any in-flight agent work, so the
// only path to it is intentional). Click anywhere else dismisses.
```

New:

```tsx
// Vertical tab bar -- one row per persisted project, "+" at the bottom.
// Right-click on a row pops a context menu with a single Close action.
// Closing destroys the tab's view; server-side terminal processes keep
// running until app quit (shared code-server). Click anywhere else
// dismisses.
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean exit, no errors.

- [ ] **Step 6: Manual check**

Run: `npm run dev`. Open a folder, immediately right-click → Close while the spinner shows. Expected: tab disappears, no error, and switching to another tab still works.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx src/renderer/TabBar.tsx
git commit -m "fix: tear down view and session when tab is closed mid-spawn"
```

---

### Task 2: `dialog:confirmCloseTab` IPC channel

5-step IPC contract change; no UI yet.

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/dialog.ts`

- [ ] **Step 1: Add channel constant in `src/shared/ipc.ts`**

In the `IPC` const, after `dialogPickFolder`:

```ts
  dialogConfirmCloseTab: "dialog:confirmCloseTab",
```

- [ ] **Step 2: Add the RendererApi method**

In `interface RendererApi`, after `pickFolder`:

```ts
  // Native sheet asking to close a live tab. Resolves true when the user
  // confirms. Close is non-destructive server-side (terminals keep running
  // until app quit); the sheet guards losing sight of a live agent.
  confirmCloseTab(cwd: string): Promise<boolean>;
```

- [ ] **Step 3: Preload bridge in `src/preload/index.ts`**

After the `pickFolder` line:

```ts
  confirmCloseTab: (cwd) => ipcRenderer.invoke(IPC.dialogConfirmCloseTab, cwd),
```

- [ ] **Step 4: Main handler in `src/main/ipc/dialog.ts`**

Inside `registerDialogIpc()`, after the existing `dialogPickFolder` handler:

```ts
ipcMain.handle(
  IPC.dialogConfirmCloseTab,
  async (_event, cwd: unknown): Promise<boolean> => {
    const folder = typeof cwd === "string" ? cwd : "";
    const name = folder.split("/").filter(Boolean).pop() ?? "this project";
    const opts: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: ["Close Project", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      message: `Close “${name}”?`,
      detail:
        "Anything running in its terminals keeps running in the background until Agora quits.",
    };
    const parent = BrowserWindow.getFocusedWindow();
    const result = parent
      ? await dialog.showMessageBox(parent, opts)
      : await dialog.showMessageBox(opts);
    return result.response === 0;
  },
);
```

(`dialog` and `BrowserWindow` are already imported in this file.)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. (The contract makes a missing preload/handler a compile error — if it fails, a step above was skipped.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc/dialog.ts
git commit -m "feat: add dialog:confirmCloseTab IPC channel"
```

---

### Task 3: Guard live-tab close behind the confirm sheet

**Files:**

- Modify: `src/renderer/App.tsx` (`close()`, ~line 144)

- [ ] **Step 1: Insert the guard at the top of `close()`**

Old:

```tsx
  async function close(tab: Tab): Promise<void> {
    const idx = tabs.findIndex((t) => t.id === tab.id);
```

New:

```tsx
  async function close(tab: Tab): Promise<void> {
    const liveState = perTabState.get(tab.id);
    const live =
      liveState !== undefined &&
      typeof liveState === "object" &&
      (liveState.kind === "loaded" || liveState.kind === "loading");
    // Only live tabs get the sheet -- unspawned/error have nothing running.
    if (live && !(await window.api.confirmCloseTab(tab.cwd))) return;

    const idx = tabs.findIndex((t) => t.id === tab.id);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — expected clean.

- [ ] **Step 3: Manual check**

`npm run dev`:

- Close a loaded tab → sheet appears; Cancel keeps the tab working; confirm closes it.
- Close a never-clicked (dimmed, unspawned) tab → no sheet, instant close.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: guard live tab close behind native confirm sheet"
```

---

### Task 4: Hover × close button on tab rows

**Files:**

- Modify: `src/renderer/TabBar.tsx` (row JSX, ~lines 77–83)
- Modify: `src/renderer/index.css`

- [ ] **Step 1: Add the × button after the indicator spans**

Old:

```tsx
              {state && typeof state === "object" && state.kind === "error" && (
                <span className="tab-error-dot" aria-label="error" />
              )}
            </div>
```

New:

```tsx
              {state && typeof state === "object" && state.kind === "error" && (
                <span className="tab-error-dot" aria-label="error" />
              )}
              <button
                className="tab-close"
                title="Close"
                onClick={(e) => {
                  // Row onClick would otherwise activate (and maybe spawn)
                  // the tab being closed.
                  e.stopPropagation();
                  onClose(tab);
                }}
              >
                ×
              </button>
            </div>
```

- [ ] **Step 2: Add CSS after the `.tab-error-dot` rule in `index.css`**

```css
/* Hover-only close button. Shares the indicator slot: on row hover the
   spinner/error dot yields to the ×. */
.tab-close {
  display: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 1;
}
.tab:hover .tab-close {
  display: block;
}
.tab:hover .tab-spinner,
.tab:hover .tab-error-dot {
  display: none;
}
.tab-close:hover {
  background: rgba(128, 128, 128, 0.25);
}
```

- [ ] **Step 3: Typecheck + manual check**

`npm run typecheck` clean. `npm run dev`: hovering a row swaps spinner/dot for ×; clicking × closes (sheet for live tabs); clicking elsewhere on the row still activates.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/TabBar.tsx src/renderer/index.css
git commit -m "feat: add hover close button to tab rows"
```

---

### Task 5: Persist sidebar state + `workspace:setSidebar` IPC

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/workspace.ts`

- [ ] **Step 1: Schema + type in `src/shared/ipc.ts`**

Add to `WorkspaceSchema` after `codeServerPort`:

```ts
  // Sidebar layout. Optional so pre-existing workspace.json files parse.
  sidebarWidth: z.number().int().positive().optional(),
  sidebarHidden: z.boolean().optional(),
```

After the `Workspace` type, add:

```ts
// Payload of workspace:setSidebar -- renderer-owned sidebar layout.
export interface SidebarState {
  width: number;
  hidden: boolean;
}
```

- [ ] **Step 2: Channel constant**

In the `IPC` const, after `workspaceSetActive`:

```ts
  workspaceSetSidebar: "workspace:setSidebar",
```

- [ ] **Step 3: RendererApi method**

After `setWorkspaceActive` in `RendererApi`:

```ts
  setWorkspaceSidebar(state: SidebarState): Promise<void>;
```

- [ ] **Step 4: Preload bridge**

After the `setWorkspaceActive` line in `src/preload/index.ts`:

```ts
  setWorkspaceSidebar: (state) =>
    ipcRenderer.invoke(IPC.workspaceSetSidebar, state),
```

- [ ] **Step 5: Main handler in `src/main/ipc/workspace.ts`**

After the `ActivePayload` const:

```ts
const SidebarPayload = z.object({
  width: z.number().int().min(120).max(400),
  hidden: z.boolean(),
});
```

After the `workspaceSetActive` handler:

```ts
ipcMain.handle(
  IPC.workspaceSetSidebar,
  async (_event, state: unknown): Promise<void> => {
    const validated = SidebarPayload.parse(state);
    const next = {
      ...store.current(),
      sidebarWidth: validated.width,
      sidebarHidden: validated.hidden,
    };
    store.set(next);
  },
);
```

- [ ] **Step 6: Typecheck + commit**

`npm run typecheck` clean, then:

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/ipc/workspace.ts
git commit -m "feat: persist sidebar width and hidden state in workspace"
```

---

### Task 6: Sidebar drag-resize

Width state + drag handle + live resize. No hiding yet — dragging past the minimum just clamps at 120 until Task 7 adds the snap.

**Files:**

- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/TabBar.tsx` (width prop)
- Modify: `src/renderer/index.css`

- [ ] **Step 1: Constants + clamp helper in `App.tsx`** (module scope, above `App()`):

```tsx
const SIDEBAR_MIN_PX = 120;
const SIDEBAR_MAX_PX = 400;
const SIDEBAR_DEFAULT_PX = 200;

function clampSidebarWidth(px: number): number {
  const max = Math.min(SIDEBAR_MAX_PX, Math.floor(window.innerWidth / 2));
  return Math.min(max, Math.max(SIDEBAR_MIN_PX, Math.round(px)));
}
```

- [ ] **Step 2: Sidebar state + refs inside `App()`** (after the `tabsRef` block from Task 1):

```tsx
const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_PX);
const [sidebarHidden, setSidebarHidden] = useState(false);
const [sidebarDragging, setSidebarDragging] = useState(false);
// Mirrors for the drag effect -- its closures must see current values at
// pointer-up, not the values captured when the drag started.
const sidebarRef = useRef({ width: SIDEBAR_DEFAULT_PX, hidden: false });
sidebarRef.current = { width: sidebarWidth, hidden: sidebarHidden };
// Loaded active session, or null. Drag start/end hides/restores its view:
// the WebContentsView is a native layer no DOM overlay can cover, so
// pointer events die when the cursor crosses into it mid-drag.
const activeSessionRef = useRef<string | null>(null);
const activeStateNow =
  activeId !== null ? perTabState.get(activeId) : undefined;
activeSessionRef.current =
  activeStateNow !== undefined &&
  typeof activeStateNow === "object" &&
  activeStateNow.kind === "loaded"
    ? activeStateNow.session.sessionId
    : null;
```

- [ ] **Step 3: Hydrate from workspace** — in the mount effect's `init()`, after `setActiveId(ws.activeId)`:

```tsx
setSidebarWidth(clampSidebarWidth(ws.sidebarWidth ?? SIDEBAR_DEFAULT_PX));
setSidebarHidden(ws.sidebarHidden ?? false);
```

- [ ] **Step 4: Drag effect + start handler inside `App()`**:

```tsx
// Sidebar drag: window-level listeners so the gesture survives the cursor
// leaving the 5px handle. Persist once on pointer-up.
useEffect(() => {
  if (!sidebarDragging) return;
  function onMove(e: PointerEvent): void {
    setSidebarWidth(clampSidebarWidth(e.clientX));
  }
  function onUp(): void {
    setSidebarDragging(false);
    const { width, hidden } = sidebarRef.current;
    void window.api.setWorkspaceSidebar({ width, hidden });
    if (activeSessionRef.current) {
      void window.api.setActiveView(activeSessionRef.current);
    }
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
}, [sidebarDragging]);

function startSidebarDrag(): void {
  if (activeSessionRef.current) void window.api.setActiveView(null);
  setSidebarDragging(true);
}
```

- [ ] **Step 5: Render the handle + shield** — replace the `<TabBar ... />` element in the return:

```tsx
      <TabBar
        tabs={tabs}
        activeId={activeId}
        perTabState={perTabState}
        width={sidebarWidth}
        onActivate={activate}
        onClose={close}
        onAdd={open}
      />
      <div
        className="sidebar-handle"
        onPointerDown={(e) => {
          e.preventDefault();
          startSidebarDrag();
        }}
      />
      {sidebarDragging && <div className="drag-shield" />}
```

- [ ] **Step 6: Width prop in `TabBar.tsx`**

Add `width: number;` to `Props`, add `width` to the destructured params, and change the root div:

```tsx
    <div className="tab-bar" style={{ width }}>
```

- [ ] **Step 7: CSS** — after the `.tab-bar` rule:

```css
/* Resize handle: 5px strip overlapping the sidebar's right edge so it adds
   no layout width. */
.sidebar-handle {
  flex: 0 0 5px;
  margin-left: -5px;
  cursor: col-resize;
  z-index: 10;
}
.sidebar-handle:hover {
  background: rgba(74, 158, 255, 0.4);
}

/* Covers the page during a sidebar drag (the editor view is hidden for the
   gesture) -- keeps the col-resize cursor and blocks stray selection. */
.drag-shield {
  position: fixed;
  inset: 0;
  z-index: 100;
  cursor: col-resize;
}
```

- [ ] **Step 8: Typecheck + manual check**

`npm run typecheck` clean. `npm run dev`: drag the sidebar edge — editor blanks during the gesture and returns on release at the new width; width clamps at 120/400; relaunch restores the width.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/App.tsx src/renderer/TabBar.tsx src/renderer/index.css
git commit -m "feat: add drag-resizable sidebar width"
```

---

### Task 7: Hide: snap-past-min, double-click, edge strip

**Files:**

- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/index.css`

- [ ] **Step 1: Snap constant** (module scope, with the other constants):

```tsx
const SIDEBAR_SNAP_HIDE_PX = 80;
```

- [ ] **Step 2: Snap logic in the drag effect** — replace `onMove`:

```tsx
function onMove(e: PointerEvent): void {
  if (e.clientX < SIDEBAR_SNAP_HIDE_PX) {
    setSidebarHidden(true);
    return;
  }
  setSidebarHidden(false);
  setSidebarWidth(clampSidebarWidth(e.clientX));
}
```

- [ ] **Step 3: Toggle function inside `App()`** (after `startSidebarDrag`):

```tsx
function toggleSidebar(): void {
  const hidden = !sidebarRef.current.hidden;
  setSidebarHidden(hidden);
  void window.api.setWorkspaceSidebar({
    width: sidebarRef.current.width,
    hidden,
  });
}
```

- [ ] **Step 4: Conditional rendering** — replace the TabBar + handle block from Task 6 Step 5:

```tsx
{
  !sidebarHidden && (
    <>
      <TabBar
        tabs={tabs}
        activeId={activeId}
        perTabState={perTabState}
        width={sidebarWidth}
        onActivate={activate}
        onClose={close}
        onAdd={open}
      />
      <div
        className="sidebar-handle"
        onPointerDown={(e) => {
          e.preventDefault();
          startSidebarDrag();
        }}
        onDoubleClick={toggleSidebar}
      />
    </>
  );
}
{
  sidebarHidden && (
    <div
      className="sidebar-reveal"
      title="Show Sidebar"
      onClick={toggleSidebar}
    />
  );
}
{
  sidebarDragging && <div className="drag-shield" />;
}
```

Note: when a drag snaps the sidebar hidden, the handle unmounts but the drag listeners live on the window (App-level effect), so pointer-up still fires and persists the hidden state.

- [ ] **Step 5: CSS** — after `.drag-shield`:

```css
/* Left-edge reveal strip shown while the sidebar is hidden. */
.sidebar-reveal {
  flex: 0 0 8px;
  cursor: pointer;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
  background: rgba(128, 128, 128, 0.05);
}
.sidebar-reveal:hover {
  background: rgba(74, 158, 255, 0.2);
}
```

- [ ] **Step 6: Typecheck + manual check**

`npm run typecheck` clean. `npm run dev`: drag far left → sidebar snaps away, release, edge strip shows; click strip → sidebar returns at prior width; double-click handle hides; relaunch restores hidden state.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx src/renderer/index.css
git commit -m "feat: add sidebar hide with snap, double-click, and edge strip"
```

---

### Task 8: Generic menu-accelerator dispatcher (implements viewManager's TODO)

A focused code-server view swallows keystrokes before menu accelerators run. `viewManager.ts` hardcodes a Cmd+Shift+N match with a TODO to generalize once a second shortcut lands — Task 9's Cmd+Ctrl+B is that shortcut.

**Files:**

- Create: `src/main/menuAccelerators.ts`
- Modify: `src/main/menu.ts` (tag item with id)
- Modify: `src/main/viewManager.ts` (replace hardcoded block, ~lines 166–183)

- [ ] **Step 1: Create `src/main/menuAccelerators.ts`**

```ts
// Routes keystrokes swallowed by focused code-server views back to
// application-menu items. Chromium delivers keys to the focused
// WebContentsView before menu accelerators run, so custom shortcuts never
// fire while an editor view has focus; views call dispatchMenuAccelerator
// from before-input-event instead.
//
// Only items whose id starts with "agora:" participate -- role items
// (copy/paste/zoom) must keep Chromium's native handling.
import { Menu, type MenuItem } from "electron";

interface ParsedAccelerator {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  code: string;
}

// Minimal parser: modifier+single-letter accelerators only, which is all
// Agora uses. Returns null (never matches) for anything fancier.
function parse(accelerator: string): ParsedAccelerator | null {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  if (!/^[a-zA-Z]$/.test(key)) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return {
    meta: mods.has("cmd") || mods.has("command") || mods.has("cmdorctrl"),
    ctrl: mods.has("ctrl") || mods.has("control"),
    alt: mods.has("alt") || mods.has("option"),
    shift: mods.has("shift"),
    code: `Key${key.toUpperCase()}`,
  };
}

// Returns true when a menu item consumed the keystroke (caller should
// preventDefault).
export function dispatchMenuAccelerator(input: Electron.Input): boolean {
  const menu = Menu.getApplicationMenu();
  if (!menu) return false;
  const item = findMatch(menu.items, input);
  if (!item) return false;
  item.click();
  return true;
}

function findMatch(items: MenuItem[], input: Electron.Input): MenuItem | null {
  for (const item of items) {
    if (item.submenu) {
      const hit = findMatch(item.submenu.items, input);
      if (hit) return hit;
    }
    if (!item.id?.startsWith("agora:") || !item.accelerator) continue;
    const parsed = parse(String(item.accelerator));
    if (!parsed) continue;
    if (
      parsed.meta === input.meta &&
      parsed.ctrl === input.control &&
      parsed.alt === input.alt &&
      parsed.shift === input.shift &&
      parsed.code === input.code
    ) {
      return item;
    }
  }
  return null;
}
```

Note: `CmdOrCtrl` maps to `meta` only — correct for this Mac-only app; revisit if Linux/Windows ever lands.

- [ ] **Step 2: Tag the New Workspace item in `src/main/menu.ts`**

Old:

```ts
        {
          label: "New Workspace...",
          accelerator: "CmdOrCtrl+Shift+N",
```

New:

```ts
        {
          id: "agora:newWorkspace",
          label: "New Workspace...",
          accelerator: "CmdOrCtrl+Shift+N",
```

- [ ] **Step 3: Replace the hardcoded match in `src/main/viewManager.ts`**

Old (~lines 166–183):

```ts
// Chromium swallows Cmd+Shift+N before menu.ts's accelerator sees it
// when a view is focused. KEEP IN SYNC with menu.ts.
// TODO: when a second shortcut lands, replace this hardcoded match
// with a generic dispatcher that walks Menu.getApplicationMenu() and
// routes any accelerator match to the corresponding item's click.
view.webContents.on("before-input-event", (event, input) => {
  if (input.type !== "keyDown") return;
  if (
    input.meta &&
    input.shift &&
    !input.control &&
    !input.alt &&
    input.code === "KeyN"
  ) {
    event.preventDefault();
    this.getMainWindow()?.webContents.send(IPC.menuNewWorkspace);
  }
});
```

New:

```ts
// Chromium swallows keystrokes before menu accelerators run when a
// view is focused; route them through the menu's own agora:* items.
view.webContents.on("before-input-event", (event, input) => {
  if (input.type !== "keyDown") return;
  if (dispatchMenuAccelerator(input)) event.preventDefault();
});
```

Add the import at the top of viewManager.ts:

```ts
import { dispatchMenuAccelerator } from "./menuAccelerators";
```

If `IPC` is now unused in viewManager.ts, remove it from the import (check — `IPC` is also used by nothing else in that file after this change; `ViewBounds` type import stays).

- [ ] **Step 4: Typecheck + manual regression check**

`npm run typecheck` clean. `npm run dev`: click into the editor (view focused), press Cmd+Shift+N → folder picker opens, same as before.

- [ ] **Step 5: Commit**

```bash
git add src/main/menuAccelerators.ts src/main/menu.ts src/main/viewManager.ts
git commit -m "refactor: route view keystrokes through generic menu accelerator dispatcher"
```

---

### Task 9: View → Toggle Sidebar menu item (Cmd+Ctrl+B)

**Files:**

- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Channel constant in `src/shared/ipc.ts`** — after `menuNewWorkspace`:

```ts
  menuToggleSidebar: "menu:toggleSidebar",
```

- [ ] **Step 2: RendererApi method** — after `onMenuNewWorkspace`:

```ts
  onMenuToggleSidebar(cb: () => void): () => void;
```

- [ ] **Step 3: Preload bridge** — after the `onMenuNewWorkspace` block:

```ts
  onMenuToggleSidebar: (cb) => {
    ipcRenderer.on(IPC.menuToggleSidebar, cb);
    return () => ipcRenderer.removeListener(IPC.menuToggleSidebar, cb);
  },
```

- [ ] **Step 4: Menu item in `src/main/menu.ts`** — replace `{ role: "viewMenu" }` with a custom View menu (same role contents plus our item; Cmd+Ctrl+B is unbound in VS Code, whose own Cmd+B / Cmd+Option+B must keep working inside the editor):

```ts
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
```

Also update the file's header comment — it currently says the menu is "Standard role-based defaults plus a File menu"; it now also owns a custom View menu whose `agora:`-tagged items are dispatched by `menuAccelerators.ts` when a view has focus.

- [ ] **Step 5: Renderer listener in `App.tsx`** — after the existing `onMenuNewWorkspace` effect, using the same ref-indirection pattern:

```tsx
const toggleSidebarRef = useRef(toggleSidebar);
toggleSidebarRef.current = toggleSidebar;
useEffect(
  () => window.api.onMenuToggleSidebar(() => toggleSidebarRef.current()),
  [],
);
```

- [ ] **Step 6: Typecheck + manual check**

`npm run typecheck` clean. `npm run dev`:

- View menu shows Toggle Sidebar ⌃⌘B; clicking it hides/shows.
- Cmd+Ctrl+B with the shell focused (e.g. right after launch, empty state) toggles.
- Cmd+Ctrl+B with the **editor focused** toggles (dispatcher path).
- Cmd+B inside the editor still toggles VS Code's own sidebar.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/menu.ts src/renderer/App.tsx
git commit -m "feat: add View menu toggle-sidebar with Cmd+Ctrl+B"
```

---

### Task 10: Full verification sweep + empirical close-semantics check

No new code expected; one contingent copy fix.

- [ ] **Step 1: Run the spec's manual checklist** (`npm run dev`):

1. Close unspawned tab → instant, no sheet.
2. Close loaded tab → sheet; Cancel keeps everything working; Close Project removes it.
3. Close during spinner → sheet (loading is live); confirm → no leaked view (open a new tab afterwards, app behaves normally).
4. Hover × swaps with spinner/error dot; row click still activates.
5. Drag resize: clamps 120–400, editor blanks during gesture only, width persists across relaunch.
6. Snap-hide by dragging past ~80px; edge strip reveals; double-click handle hides; hidden persists across relaunch.
7. Cmd+Ctrl+B toggles with editor focused; Cmd+B still works inside VS Code; Cmd+Shift+N still opens the picker with editor focused.

- [ ] **Step 2: Empirical close-semantics check**

In a tab's integrated terminal: `sleep 600 &` (note the PID). Close the tab (confirm). Then in a system terminal: `pgrep -f "sleep 600"`.

- Expected: PID alive; reopening the same folder reattaches the terminal.
- If the process is dead instead: change the `detail` string in `src/main/ipc/dialog.ts` to `"Running terminals and agents will be killed."` and commit:

```bash
git add src/main/ipc/dialog.ts
git commit -m "fix: correct close-dialog copy to match measured terminal lifetime"
```

- [ ] **Step 3: Docs hygiene**

README's only related claim ("React tab bar + content area") still holds — no edit needed. Confirm `CLAUDE.md` needs nothing (no invariant touched; IPC contract process followed).
