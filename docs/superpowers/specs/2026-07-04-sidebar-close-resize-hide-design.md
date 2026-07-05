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

- What close actually does (corrected after reading `sessionManager.ts` /
  `viewManager.ts`): all tabs share ONE code-server process; close destroys
  the tab's WebContentsView and forgets the logical session, the server
  survives. Integrated-terminal processes live server-side and VS Code's
  persistent-terminal default keeps them running after the client
  disconnects — reopening the same folder reattaches them. The risk close
  guards against is losing _sight_ of a live agent (it keeps running
  invisibly until app quit), not killing it. The stale `TabBar.tsx` /
  `App.tsx` comments claiming close "kills a code-server" get fixed in the
  same change.
- Tab state `loading` or `loaded` → native confirm sheet before closing.
- Tab state `unspawned` or `error` → close immediately, no dialog (nothing
  live behind the tab).
- Dialog copy: message `Close “<basename>”?`, detail "Anything running in
  its terminals keeps running in the background until Agora quits." Buttons:
  "Close Project" (default) / "Cancel". An empirical check during
  implementation verifies terminal-process survival; if processes in fact
  die on view close, the detail line changes to "Running terminals and
  agents will be killed."

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
deleted tab id and leaking a hidden live WebContentsView plus a stale session
record (not a process — the server is shared). Fix: when `spawn()` resolves,
check the tab still exists in current tab state; if not, close the
just-created view + session and discard the state update.

## B. Sidebar resize + hide

### Resize

- Drag handle: ~5px hit strip on the sidebar's right edge, `col-resize`
  cursor, pointer-event based.
- Width clamped to **120–400px**.
- Dragging below ~80px snaps the sidebar to hidden (VS Code idiom).
- A small always-visible `‹` chevron pill centered on the handle toggles
  hidden (replaced the original double-click, which fired accidentally on
  repeated drag attempts).
- **View hidden during drag**: on drag start the renderer calls
  `setActiveView(null)` (webContents stays alive), on pointer-up it restores
  the active session's view — instant, no reload. Required because the
  WebContentsView is a native child view composited above the entire
  renderer page: no DOM overlay can cover it, and pointermove stops reaching
  the shell the moment the cursor crosses into it. Content area shows plain
  background during the gesture; a DOM shield div still overlays the (now
  view-free) page to keep the `col-resize` cursor and block text selection.

### Hide / show

- Hidden state: tab bar unmounted from layout; a thin (~12px) clickable strip
  with a `›` chevron remains at the window's left edge; clicking it shows
  the sidebar again.
- Menu item `View → Toggle Sidebar`, accelerator **Cmd+Ctrl+B** (unbound in
  VS Code — Cmd+B and Cmd+Option+B are VS Code's own sidebar toggles and an
  app-menu accelerator would steal them from the editor).
- Menu fires a one-way main → renderer event mirroring the existing
  `menu:newWorkspace` pattern (`onMenuToggleSidebar` in `RendererApi`).
- **Accelerator dispatcher**: a focused code-server view swallows keystrokes
  before menu accelerators run (`viewManager.ts` documents this and
  hardcodes a Cmd+Shift+N match with a TODO to generalize once a second
  shortcut lands). This work implements that TODO: a small
  `menuAccelerators.ts` walks `Menu.getApplicationMenu()` for items whose
  `id` starts with `agora:` (role items like Copy must keep Chromium's
  native handling), parses their modifier+letter accelerators, and routes
  matching `before-input-event` keystrokes to `item.click()`. The hardcoded
  Cmd+Shift+N block is replaced by the dispatcher.
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
  confirm closes, cancel keeps), close while loading (no leaked hidden view —
  session list empty after close), drag resize + clamp, drag-past-min
  snap-hide, chevron-click hide/show, edge-strip reveal, Cmd+Ctrl+B toggle with
  editor focused (VS Code Cmd+B still works inside the editor), Cmd+Shift+N
  still opens the folder picker with editor focused (dispatcher regression),
  relaunch restores width/hidden.
- Empirical close-semantics check: start `sleep 600` in a tab's integrated
  terminal, close the tab, `pgrep -f "sleep 600"` — expect survival; reopen
  the folder and expect the terminal to reattach. If it dies instead, change
  the dialog detail line per the Confirm rule section.
