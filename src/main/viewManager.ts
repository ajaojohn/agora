// Owns the lifecycle of WebContentsView instances that render code-server's
// VS Code UI inside the Agora window.
//
// One view per session. Views are created lazily on first setActive (waits
// for code-server's HTTP port, loads the URL, but does NOT auto-show).
// Showing = parent.contentView.addChildView. Hiding = removeChildView; the
// webContents stays alive in memory so background tabs preserve state
// (terminal scrollback, extension state, mid-edit buffers). Permanent
// destruction happens only on close().
//
// Security: views load arbitrary HTTP origins (code-server is local but the
// page it serves is a full HTML5 environment running extensions). Views run
// with sandbox: true, contextIsolation: true, no preload -- they cannot
// reach our window.api or any Node primitive. The M2 attention extension
// will talk to main via a separate localhost WebSocket, not the preload bridge.
import { WebContentsView, type BrowserWindow } from "electron";
import type { ViewBounds } from "@shared/ipc";
import { waitForPort } from "./tcpReady";

interface ViewRecord {
  view: WebContentsView;
  // The BrowserWindow this view is currently attached to, or null if the
  // view exists in memory but is not currently shown anywhere.
  parent: BrowserWindow | null;
}

export class ViewLoadError extends Error {
  constructor(sessionId: string, reason: string) {
    super(`Failed to load code-server view for session ${sessionId}: ${reason}`);
    this.name = "ViewLoadError";
  }
}

export class ViewManager {
  private readonly views = new Map<string, ViewRecord>();
  // Currently-shown sessionId, or null if no view is foregrounded. Used by
  // setActive to know what to hide before showing the next.
  private activeSessionId: string | null = null;

  // High-level "switch the foregrounded view". Hides current active (keeps
  // its webContents alive), then either shows an already-attached view or
  // creates+loads+shows a new one. Pass null to hide the current view
  // without showing anything.
  //
  // `port` and `cwd` are required only the first time a sessionId is set
  // active -- subsequent calls reuse the existing view. Caller (ipc/view.ts)
  // can safely pass them every time; they're ignored if the view already
  // exists. cwd is needed for the URL's ?folder= query param so code-server
  // opens the right project (without it, VS Code restores last-opened from
  // the shared user-data-dir).
  async setActive(
    sessionId: string | null,
    parent: BrowserWindow,
    port?: number,
    cwd?: string,
  ): Promise<void> {
    if (this.activeSessionId === sessionId) return; // no-op for same target

    // Hide whatever is currently active. Removes from contentView tree but
    // leaves webContents alive in the map for fast re-show later.
    if (this.activeSessionId !== null) {
      const current = this.views.get(this.activeSessionId);
      if (current && current.parent) {
        current.parent.contentView.removeChildView(current.view);
        current.parent = null;
      }
    }

    if (sessionId === null) {
      this.activeSessionId = null;
      return;
    }

    // Lazy first-attach: create view + load URL if we've never seen this
    // sessionId before.
    if (!this.views.has(sessionId)) {
      if (port === undefined || cwd === undefined) {
        throw new Error(
          `setActive(${sessionId}): port + cwd required for first-time attach`,
        );
      }
      await this.attachInternal(sessionId, port, cwd);
    }

    // Show: add to parent's contentView with default bounds (renderer will
    // refine via setBounds once it has measured the visible region).
    const record = this.views.get(sessionId)!;
    const [width, height] = parent.getContentSize();
    record.view.setBounds({ x: 0, y: 0, width, height });
    parent.contentView.addChildView(record.view);
    record.parent = parent;
    this.activeSessionId = sessionId;
  }

  setBounds(sessionId: string, bounds: ViewBounds): void {
    const record = this.views.get(sessionId);
    if (!record) return;
    record.view.setBounds(bounds);
  }

  // Permanent destroy -- removes from parent if attached, closes webContents,
  // forgets the session. If the closed view was active, clears activeSessionId.
  // Use on close-tab; for hide-but-keep-alive use setActive(null) or setActive(otherId).
  close(sessionId: string): void {
    const record = this.views.get(sessionId);
    if (!record) return;
    if (record.parent) {
      record.parent.contentView.removeChildView(record.view);
    }
    record.view.webContents.close();
    this.views.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  destroyAll(): void {
    for (const sessionId of [...this.views.keys()]) {
      this.close(sessionId);
    }
  }

  // Creates the view and loads the URL but does NOT add to any parent's
  // contentView. Caller (setActive) handles attaching after this resolves.
  // Rolls back the map entry on load failure so a retry is a fresh attempt.
  //
  // The ?folder= query param forces VS Code to open `cwd` regardless of
  // its restore-last-workspace state. Without this, the shared
  // --user-data-dir means every fresh code-server opens whatever folder
  // was last opened in any session.
  private async attachInternal(
    sessionId: string,
    port: number,
    cwd: string,
  ): Promise<void> {
    await waitForPort(port);

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.views.set(sessionId, { view, parent: null });

    const url = `http://127.0.0.1:${port}/?folder=${encodeURIComponent(cwd)}`;
    try {
      await loadAndAwait(view, url, sessionId);
    } catch (err) {
      this.views.delete(sessionId);
      view.webContents.close();
      throw err;
    }
  }
}

// Wires loadURL to a promise that resolves on did-finish-load and rejects on
// did-fail-load. Without did-fail-load, a missing/refused URL would hang the
// caller forever -- did-finish-load only fires on success.
function loadAndAwait(
  view: WebContentsView,
  url: string,
  sessionId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      view.webContents.removeListener("did-finish-load", onLoad);
      view.webContents.removeListener("did-fail-load", onFail);
      if (err) reject(err);
      else resolve();
    };

    const onLoad = (): void => finish(null);
    // isMainFrame filter: did-fail-load fires for every failed sub-resource
    // (icons, extension JS, telemetry pings). Only top-level navigation
    // failure means the page itself is unreachable.
    const onFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return;
      finish(new ViewLoadError(sessionId, `${errorDescription} (${errorCode})`));
    };

    view.webContents.on("did-finish-load", onLoad);
    view.webContents.on("did-fail-load", onFail);

    view.webContents.loadURL(url).catch((err) => finish(err as Error));
  });
}
