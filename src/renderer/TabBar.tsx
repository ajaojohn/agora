// Vertical tab bar -- one row per persisted project, "+" at the bottom.
// Right-click on a row pops a context menu with a single Close action.
// Closing destroys the tab's view; server-side terminal processes keep
// running until app quit (shared code-server). Click anywhere else
// dismisses.
//
// Per-tab visual state is driven entirely by props -- this component
// owns no session state, just the open-context-menu coordinates.
import { useEffect, useState } from "react";
import type { Tab } from "@shared/ipc";
import type { TabState } from "./App";
import { basename } from "./util";

interface Props {
  tabs: Tab[];
  activeId: string | null;
  perTabState: Map<string, TabState>;
  onActivate: (tab: Tab) => void;
  onClose: (tab: Tab) => void;
  onAdd: () => void;
}

interface MenuPos {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({
  tabs,
  activeId,
  perTabState,
  onActivate,
  onClose,
  onAdd,
}: Props) {
  const [menu, setMenu] = useState<MenuPos | null>(null);

  // Dismiss menu on any click outside / Escape. Listener attached only
  // while menu is open to avoid wasted handler calls during normal use.
  useEffect(() => {
    if (!menu) return;
    function dismiss() {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {tabs.map((tab) => {
          const state = perTabState.get(tab.id);
          const isActive = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className={tabClassName(state, isActive)}
              title={tab.cwd}
              onClick={() => onActivate(tab)}
              onContextMenu={(e) => {
                e.preventDefault();
                // mousedown listener inside the menu effect would dismiss
                // immediately if we just set menu in the bubbling phase --
                // stop propagation so the menu opens instead.
                e.stopPropagation();
                setMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="tab-label">{basename(tab.cwd)}</span>
              {state &&
                typeof state === "object" &&
                state.kind === "loading" && <span className="tab-spinner" />}
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
          );
        })}
      </div>
      <button className="tab-add" onClick={onAdd} title="Open Folder (Cmd+T)">
        +
      </button>
      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          // Don't dismiss when clicking the menu itself; the global listener
          // covers everywhere else.
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const tab = tabs.find((t) => t.id === menu.tabId);
              setMenu(null);
              if (tab) onClose(tab);
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

// Maps the 5 visual states (unspawned / loading / active / loaded-inactive
// / error) into the className the stylesheet keys off. `tab-active`
// composes with the state class -- e.g. an error tab that's also active
// is `tab tab-error tab-active`, gets the accent left border + the red dot.
function tabClassName(state: TabState | undefined, isActive: boolean): string {
  const parts = ["tab"];
  if (state === "unspawned" || state === undefined) parts.push("tab-unspawned");
  else if (typeof state === "object") {
    if (state.kind === "loading") parts.push("tab-loading");
    else if (state.kind === "loaded") parts.push("tab-loaded");
    else if (state.kind === "error") parts.push("tab-error");
  }
  if (isActive) parts.push("tab-active");
  return parts.join(" ");
}
