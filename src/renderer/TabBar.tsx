// Vertical tab bar -- one row per persisted project, "+" at the bottom.
// Close paths: hover x on each row, or the File menu / Ctrl+Cmd+W.
// Closing destroys the tab's view; server-side terminal processes keep
// running until app quit (shared code-server).
//
// Per-tab visual state is driven entirely by props -- this component
// owns no state of its own.
import type { Tab } from "@shared/ipc";
import type { TabState } from "./App";
import { basename } from "./util";

interface Props {
  tabs: Tab[];
  activeId: string | null;
  perTabState: Map<string, TabState>;
  width: number;
  onActivate: (tab: Tab) => void;
  onClose: (tab: Tab) => void;
  onAdd: () => void;
}

export function TabBar({
  tabs,
  activeId,
  perTabState,
  width,
  onActivate,
  onClose,
  onAdd,
}: Props) {
  return (
    <div className="tab-bar" style={{ width }}>
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
