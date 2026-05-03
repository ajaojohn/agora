// Owns the lifecycle of WebContentsView instances that render code-server's
// VS Code UI inside the Agora window.
//
// One view per session. Created on attach (waits for code-server's HTTP port
// to come up first), destroyed on detach. The renderer reports the visible
// bounds it wants the view positioned in via setBounds; the manager passes
// them through to view.setBounds.
//
// Security: views load arbitrary HTTP origins (code-server is local but the
// page it serves is a full HTML5 environment running extensions). Views run
// with sandbox: true, contextIsolation: true, no preload -- they cannot
// reach our window.api or any Node primitive. The M2.5 attention extension
// will talk to main via a separate localhost WebSocket, not the preload bridge.
import { WebContentsView, type BrowserWindow } from "electron";
import { waitForPort } from "./tcpReady";

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewRecord {
  view: WebContentsView;
  parent: BrowserWindow;
}

export class ViewAlreadyAttachedError extends Error {
  constructor(sessionId: string) {
    super(`View for session ${sessionId} is already attached. Detach first.`);
    this.name = "ViewAlreadyAttachedError";
  }
}

export class ViewLoadError extends Error {
  constructor(sessionId: string, reason: string) {
    super(`Failed to load code-server view for session ${sessionId}: ${reason}`);
    this.name = "ViewLoadError";
  }
}

export class ViewManager {
  private readonly views = new Map<string, ViewRecord>();

  // Waits for the port to accept connections, creates a sandboxed
  // WebContentsView, attaches it to the parent's contentView tree, loads
  // http://127.0.0.1:<port>, and resolves once the page finishes loading.
  // On any failure, cleans up the partially-attached view so the manager
  // map stays consistent.
  async attach(
    sessionId: string,
    port: number,
    parent: BrowserWindow,
  ): Promise<void> {
    if (this.views.has(sessionId)) {
      throw new ViewAlreadyAttachedError(sessionId);
    }

    await waitForPort(port);

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Default to the parent's full content area; renderer will refine via
    // setBounds once it has measured the visible region (excluding tab bar).
    const [width, height] = parent.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });

    parent.contentView.addChildView(view);
    this.views.set(sessionId, { view, parent });

    try {
      await loadAndAwait(view, `http://127.0.0.1:${port}`, sessionId);
    } catch (err) {
      // Roll back so the renderer can retry without hitting ViewAlreadyAttached.
      this.views.delete(sessionId);
      parent.contentView.removeChildView(view);
      view.webContents.close();
      throw err;
    }
  }

  setBounds(sessionId: string, bounds: ViewBounds): void {
    const record = this.views.get(sessionId);
    if (!record) return;
    record.view.setBounds(bounds);
  }

  detach(sessionId: string): void {
    const record = this.views.get(sessionId);
    if (!record) return;
    this.views.delete(sessionId);
    record.parent.contentView.removeChildView(record.view);
    record.view.webContents.close();
  }

  destroyAll(): void {
    for (const sessionId of [...this.views.keys()]) {
      this.detach(sessionId);
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
