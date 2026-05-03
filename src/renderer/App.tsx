// Top-level component. Multi-tab state shape, single-pane UI for now --
// tab bar component lands in commit 15.
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

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [perTabState, setPerTabState] = useState<Map<string, TabState>>(
    () => new Map(),
  );

  // Mount: hydrate from persisted workspace, then spawn the previously-active
  // tab eagerly (hybrid spawn -- other tabs stay unspawned until clicked).
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const ws = await window.api.getWorkspace();
      if (cancelled) return;
      setTabs(ws.tabs);
      setActiveId(ws.activeId);
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

  // Spawn a tab: createSession + setActiveView. Updates perTabState through
  // each phase. Catches anywhere -> error state.
  async function spawn(tab: Tab): Promise<void> {
    setPerTabState((prev) =>
      new Map(prev).set(tab.id, { kind: "loading" }),
    );
    try {
      const session = await window.api.createSession(tab.cwd);
      await window.api.setActiveView(session.sessionId);
      setPerTabState((prev) =>
        new Map(prev).set(tab.id, { kind: "loaded", session }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPerTabState((prev) =>
        new Map(prev).set(tab.id, { kind: "error", message }),
      );
    }
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
    } else if (state === "unspawned" || (state && typeof state === "object" && state.kind === "error")) {
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

  function reset(): void {
    setActiveId(null);
    void window.api.setWorkspaceActive(null);
    void window.api.setActiveView(null);
  }

  // Close-tab: destroy view + kill code-server, remove from list, switch
  // active to right neighbor (fall back to left, fall back to no-active),
  // persist. order is recomputed so the persisted indices stay contiguous.
  async function close(tab: Tab): Promise<void> {
    const idx = tabs.findIndex((t) => t.id === tab.id);
    const wasActive = activeId === tab.id;
    const nextActive: string | null = wasActive
      ? tabs[idx + 1]?.id ?? tabs[idx - 1]?.id ?? null
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
    activeId !== null ? perTabState.get(activeId) ?? null : null;

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeId={activeId}
        perTabState={perTabState}
        onActivate={activate}
        onClose={close}
        onAdd={open}
      />
      <div className="content">
        {activeId === null && <EmptyHint onOpen={open} />}
        {activeId !== null && activeState === "unspawned" && (
          <Loading phase="starting" cwd={cwdFor(tabs, activeId)} />
        )}
        {activeId !== null && activeState && typeof activeState === "object" && activeState.kind === "loading" && (
          <Loading phase="attaching" cwd={cwdFor(tabs, activeId)} />
        )}
        {activeId !== null && activeState && typeof activeState === "object" && activeState.kind === "loaded" && (
          <Active session={activeState.session} />
        )}
        {activeId !== null && activeState && typeof activeState === "object" && activeState.kind === "error" && (
          <ErrorView message={activeState.message} onRetry={reset} />
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
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="error">
      <h1>Couldn't open session</h1>
      <p className="error-message">{message}</p>
      <button onClick={onRetry}>Try again</button>
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
