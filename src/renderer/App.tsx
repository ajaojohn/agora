// Top-level component. Owns the multi-tab state shape and routes the
// active tab's WebContentsView placement to main via the view IPC.
//
// Two ID concepts deliberately kept separate:
//   tab.id        -- persisted UUID, stable across app launches, lives in
//                    workspace.json. Renderer thinks in these.
//   session.id    -- runtime UUID from createSession, regenerated on each
//                    spawn. Only the spawn flow + view IPC need it.
//
// State machine for each tab:
//   unspawned     -- in workspace.json but no code-server running. Lazy.
//   loading       -- spawn flow in flight (createSession + setActiveView).
//   loaded        -- code-server up, view attached, session in hand.
//   error         -- spawn or load failed. Tab stays in list; retry via
//                    re-activating.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Session, Tab } from "@shared/ipc";
import { TabBar } from "./TabBar";
import { basename } from "./util";

export type TabState =
  | "unspawned"
  | { kind: "loading" }
  | { kind: "loaded"; session: Session }
  | { kind: "error"; message: string };

const SIDEBAR_MIN_PX = 120;
const SIDEBAR_MAX_PX = 400;
const SIDEBAR_DEFAULT_PX = 200;
const SIDEBAR_SNAP_HIDE_PX = 80;

function clampSidebarWidth(px: number): number {
  const max = Math.min(SIDEBAR_MAX_PX, Math.floor(window.innerWidth / 2));
  return Math.min(max, Math.max(SIDEBAR_MIN_PX, Math.round(px)));
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [perTabState, setPerTabState] = useState<Map<string, TabState>>(
    () => new Map(),
  );

  // Ref mirror of tabs -- spawn() completions race against close(); they
  // must check tab membership at resolution time, not capture time.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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

  // Mount: hydrate from persisted workspace, then spawn the previously-active
  // tab eagerly (hybrid spawn -- other tabs stay unspawned until clicked).
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const ws = await window.api.getWorkspace();
      if (cancelled) return;
      setTabs(ws.tabs);
      setActiveId(ws.activeId);
      setSidebarWidth(clampSidebarWidth(ws.sidebarWidth ?? SIDEBAR_DEFAULT_PX));
      setSidebarHidden(ws.sidebarHidden ?? false);
      setPerTabState(() => {
        const initial = new Map<string, TabState>();
        for (const tab of ws.tabs) initial.set(tab.id, "unspawned");
        return initial;
      });
      if (ws.activeId) {
        const tab = ws.tabs.find((t) => t.id === ws.activeId);
        if (tab) await spawn(tab);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spawn a tab: pre-check cwd existence, then createSession + setActiveView.
  // Updates perTabState through each phase. cwd-vanished gets a clearer
  // message (Q14 cwd-vanished special case). Every await is a window for the
  // user to close the tab, so each landing checks `gone()` -- a completed
  // spawn for a closed tab must tear down its view + session instead of
  // re-inserting state for a deleted id.
  async function spawn(tab: Tab): Promise<void> {
    setPerTabState((prev) => new Map(prev).set(tab.id, { kind: "loading" }));

    const gone = (): boolean => !tabsRef.current.some((t) => t.id === tab.id);

    const cwdOk = await window.api.cwdExists(tab.cwd);
    if (gone()) return;
    if (!cwdOk) {
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

  // Sidebar drag: window-level listeners so the gesture survives the cursor
  // leaving the 5px handle. Persist once on pointer-up.
  useEffect(() => {
    if (!sidebarDragging) return;
    function onMove(e: PointerEvent): void {
      if (e.clientX < SIDEBAR_SNAP_HIDE_PX) {
        setSidebarHidden(true);
        return;
      }
      setSidebarHidden(false);
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

  function toggleSidebar(): void {
    const hidden = !sidebarRef.current.hidden;
    setSidebarHidden(hidden);
    void window.api.setWorkspaceSidebar({
      width: sidebarRef.current.width,
      hidden,
    });
  }

  // Make `tab` the active tab. If already loaded, reuses the live view via
  // setActiveView (instant). If unspawned (lazy from persistence) or in
  // error state, re-runs spawn flow.
  async function activate(tab: Tab): Promise<void> {
    setActiveId(tab.id);
    await window.api.setWorkspaceActive(tab.id);
    const state = perTabState.get(tab.id);
    if (state && typeof state === "object" && state.kind === "loaded") {
      await window.api.setActiveView(state.session.sessionId);
    } else if (
      state === "unspawned" ||
      (state && typeof state === "object" && state.kind === "error")
    ) {
      await spawn(tab);
    }
    // loading: no-op, the in-flight spawn will land in loaded/error.
  }

  // Open Folder flow: pick a cwd, dedupe against existing tabs (Q12 -- pick
  // the same project twice = activate existing, no new spawn), else create
  // a new tab and spawn it.
  async function open(): Promise<void> {
    const folder = await window.api.pickFolder();
    if (!folder) return;
    const existing = tabs.find((t) => t.cwd === folder.path);
    if (existing) {
      await activate(existing);
      return;
    }
    const tab: Tab = {
      id: crypto.randomUUID(),
      cwd: folder.path,
      order: tabs.length,
    };
    const nextTabs = [...tabs, tab];
    setTabs(nextTabs);
    setActiveId(tab.id);
    setPerTabState((prev) => new Map(prev).set(tab.id, "unspawned"));
    await window.api.setWorkspaceTabs(nextTabs);
    await window.api.setWorkspaceActive(tab.id);
    await spawn(tab);
  }

  // Close-tab: destroy view + drop the session record (the shared
  // code-server keeps running for other tabs), remove from list, switch
  // active to right neighbor (fall back to left, fall back to no-active),
  // persist. order is recomputed so the persisted indices stay contiguous.
  async function close(tab: Tab): Promise<void> {
    const liveState = perTabState.get(tab.id);
    const live =
      typeof liveState === "object" &&
      (liveState.kind === "loaded" || liveState.kind === "loading");
    // Only live tabs get the sheet -- unspawned/error have nothing running.
    if (live) {
      const confirmed = await window.api.confirmCloseTab(tab.cwd);
      if (!confirmed) return;
    }

    const idx = tabs.findIndex((t) => t.id === tab.id);
    const wasActive = activeId === tab.id;
    const nextActive: string | null = wasActive
      ? (tabs[idx + 1]?.id ?? tabs[idx - 1]?.id ?? null)
      : activeId;

    const state = perTabState.get(tab.id);
    if (state && typeof state === "object" && state.kind === "loaded") {
      await window.api.closeView(state.session.sessionId);
      await window.api.closeSession(state.session.sessionId);
    }

    const nextTabs = tabs
      .filter((t) => t.id !== tab.id)
      .map((t, i) => ({ ...t, order: i }));
    setTabs(nextTabs);
    setActiveId(nextActive);
    setPerTabState((prev) => {
      const next = new Map(prev);
      next.delete(tab.id);
      return next;
    });
    await window.api.setWorkspaceTabs(nextTabs);
    await window.api.setWorkspaceActive(nextActive);

    if (wasActive && nextActive !== null) {
      const nextTab = nextTabs.find((t) => t.id === nextActive);
      if (nextTab) await activate(nextTab);
    }
  }

  // Ref indirection: open() closes over tabs[], subscribing once would
  // freeze the initial empty list and race new tabs against stale state.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(
    () => window.api.onMenuNewWorkspace(() => void openRef.current()),
    [],
  );

  const toggleSidebarRef = useRef(toggleSidebar);
  toggleSidebarRef.current = toggleSidebar;
  useEffect(
    () => window.api.onMenuToggleSidebar(() => toggleSidebarRef.current()),
    [],
  );

  // Window title: Mac convention is "<app> — <doc>". Empty when no active.
  useEffect(() => {
    if (activeId !== null) {
      const tab = tabs.find((t) => t.id === activeId);
      if (tab) document.title = `Agora — ${basename(tab.cwd)}`;
    } else {
      document.title = "Agora";
    }
  }, [activeId, tabs]);

  const activeState =
    activeId !== null ? (perTabState.get(activeId) ?? null) : null;

  return (
    <div className="app">
      {!sidebarHidden && (
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
      )}
      {sidebarHidden && (
        <div
          className="sidebar-reveal"
          title="Show Sidebar"
          onClick={toggleSidebar}
        />
      )}
      {sidebarDragging && <div className="drag-shield" />}
      <div className="content">
        {activeId === null && <EmptyHint onOpen={open} />}
        {activeId !== null && activeState === "unspawned" && (
          <Loading phase="starting" cwd={cwdFor(tabs, activeId)} />
        )}
        {activeId !== null &&
          activeState &&
          typeof activeState === "object" &&
          activeState.kind === "loading" && (
            <Loading phase="attaching" cwd={cwdFor(tabs, activeId)} />
          )}
        {activeId !== null &&
          activeState &&
          typeof activeState === "object" &&
          activeState.kind === "loaded" && (
            <Active session={activeState.session} />
          )}
        {activeId !== null &&
          activeState &&
          typeof activeState === "object" &&
          activeState.kind === "error" && (
            <ErrorView
              message={activeState.message}
              onRetry={() => {
                const tab = tabs.find((t) => t.id === activeId);
                if (tab) void spawn(tab);
              }}
              onClose={() => {
                const tab = tabs.find((t) => t.id === activeId);
                if (tab) void close(tab);
              }}
            />
          )}
      </div>
    </div>
  );
}

function cwdFor(tabs: Tab[], id: string): string {
  return tabs.find((t) => t.id === id)?.cwd ?? "";
}

// Hint shown in the content area when no tab is active. The "+" in the
// tab bar is the primary affordance once the user has tabs; this is the
// friendly version for first-launch / closed-the-last-tab states.
function EmptyHint({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="empty">
      <h1>Agora</h1>
      <p>Open a folder to start a code-server session.</p>
      <button onClick={onOpen}>+ Open Folder</button>
    </div>
  );
}

function Loading({
  phase,
  cwd,
}: {
  phase: "starting" | "attaching";
  cwd: string;
}) {
  const label =
    phase === "starting" ? "Starting code-server…" : "Loading editor…";
  return (
    <div className="loading">
      <div className="spinner" />
      <p>{label}</p>
      <p>{cwd}</p>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="error">
      <h1>Couldn't open session</h1>
      <p className="error-message">{message}</p>
      <div className="error-actions">
        <button onClick={onRetry}>Try again</button>
        <button onClick={onClose}>Close tab</button>
      </div>
    </div>
  );
}

// Reserves the area where the WebContentsView should be rendered. Reports
// its bounding rect to main on mount and on resize. Main calls
// view.setBounds with the same rect; the view is painted on a separate
// Electron compositor layer over this div.
function Active({ session }: { session: Session }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let timer: number | null = null;

    function report(): void {
      const rect = el!.getBoundingClientRect();
      window.api.setViewBounds(session.sessionId, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }

    function schedule(): void {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(report, 50);
    }

    report();
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [session.sessionId]);

  return <div ref={ref} className="view-host" />;
}
