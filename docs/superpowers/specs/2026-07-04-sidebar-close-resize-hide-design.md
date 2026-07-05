# Sidebar UX: close affordance + resize/hide — design

2026-07-04. Covers two features on the renderer's left tab bar ("sidebar"):
a guarded, discoverable close flow, and user-controlled sidebar width
including full hide.

## A. Close UX

### Affordance

- A small `×` button appears on each tab row **on hover only**, right-aligned,
  occupying the same slot as the loading spinner / error dot (on hover the ×
  replaces the indicator — browser-tab idiom).
- The existing right-click context menu keeps its Close item.
- Both paths call the same `close()` in `App.tsx`.

### Confirm rule

- Tab state `loading` or `loaded` → native confirm sheet before closing.
  Killing the session kills the code-server child, its integrated terminals,
  and any agent process running in them; VS Code per-workspace UI state
  survives on disk, killed processes do not.
- Tab state `unspawned` or `error` → close immediately, no dialog (no live
  process to lose).
- Dialog copy: title "Close project?", message names the folder basename and
  states that running terminals and agents will be killed. Buttons:
  "Close Project" (destructive default) / "Cancel".

### Mechanism

- New IPC request channel `dialog:confirmCloseTab` — renderer sends the tab's
  `cwd`, main shows `dialog.showMessageBox` as a sheet attached to the
  BrowserWindow, resolves `boolean` (true = proceed). Renderer-side
  `window.confirm` rejected: blocks the event loop and looks non-native.
- Sheet is window-modal, so a second close click while one sheet is open
  cannot stack a second dialog.

### Close-while-loading (existing latent bug, fixed here)

Today `close()` tears down only `loaded` tabs. Closing a tab whose spawn is
in flight removes the tab but lets `spawn()` finish, re-inserting state for a
deleted tab id and leaking an orphan code-server child. Fix: when `spawn()`
resolves, check the tab still exists in current tab state; if not, close the
just-created session and discard the state update.

## B. Sidebar resize + hide

### Resize

- Drag handle: ~5px hit strip on the sidebar's right edge, `col-resize`
  cursor, pointer-event based.
- Width clamped to **120–400px**.
- Dragging below ~80px snaps the sidebar to hidden (VS Code idiom).
- Double-click on the handle toggles hidden.
- **Drag shield**: while a drag is active, a transparent full-content overlay
  div captures pointer events. Required because the code-server
  WebContentsView is a separate compositor layer with its own web contents —
  it swallows mousemove the moment the cursor crosses in, killing the drag
  mid-gesture.

### Hide / show

- Hidden state: tab bar unmounted from layout; a thin (~8px) clickable strip
  remains at the window's left edge; clicking it shows the sidebar again.
- Menu item `View → Toggle Sidebar`, accelerator **Cmd+Ctrl+B** (unbound in
  VS Code — Cmd+B and Cmd+Option+B are VS Code's own sidebar toggles and an
  app-menu accelerator would steal them from the editor).
- Menu fires a one-way main → renderer event mirroring the existing
  `menu:newWorkspace` pattern (`onMenuToggleSidebar` in `RendererApi`).
- The editor view follows automatically: `Active`'s ResizeObserver on
  `.view-host` already reports bounds to main on any layout change. No new
  bounds plumbing.

### Persistence

- `WorkspaceSchema` gains two optional fields:
  - `sidebarWidth: number` (int, clamped range) — default 200
  - `sidebarHidden: boolean` — default false
- Optional keeps old workspace.json files parsing without migration.
- New IPC request channel `workspace:setSidebar` persisting both fields via
  the same debounced-write path as `setTabs`/`setActive`.

## IPC changes (each via the 5-step contract in `src/shared/ipc.ts`)

| Channel                  | Direction               | Shape                                         |
| ------------------------ | ----------------------- | --------------------------------------------- |
| `dialog:confirmCloseTab` | invoke                  | `(cwd: string) → boolean`                     |
| `workspace:setSidebar`   | invoke                  | `({ width: number; hidden: boolean }) → void` |
| `menu:toggleSidebar`     | main → renderer send/on | `() → void`                                   |

## State ownership

- `sidebarWidth` / `sidebarHidden` live as `App` state, hydrated from
  `getWorkspace()` on mount, passed to `TabBar` (and the handle/strip) as
  props. `TabBar` stays fully prop-driven; the × button wires to the
  existing `onClose` prop, no new props needed.
- Drag-in-progress is transient local state (no persistence until pointer
  up).

## Edge cases

- Hidden sidebar + zero tabs: `EmptyHint` still fills content; edge strip
  still available.
- Window narrower than sidebar max: width clamp also bounded by window size
  during drag.
- Persist on pointer-up only, not per-mousemove (debounced disk write is
  cheap, but no reason to churn it at 60Hz).
- Relaunch restores width and hidden state before first paint of the tab bar
  (hydrated in the same `getWorkspace()` call the tab list already awaits).

## Out of scope

- Icon-rail collapsed mode.
- Undo/reopen-closed-tab.
- Any additional context-menu items (Reveal in Finder etc.).

## Verification

- `npm run typecheck` clean.
- Manual run: close unspawned tab (instant), close loaded tab (sheet →
  confirm kills, cancel keeps), close while loading (no orphan child —
  verify via `pgrep -f code-server` count), drag resize + clamp, drag-past-min
  snap-hide, double-click hide, edge-strip reveal, Cmd+Ctrl+B toggle with
  editor focused (VS Code Cmd+B still works inside the editor), relaunch
  restores width/hidden.
