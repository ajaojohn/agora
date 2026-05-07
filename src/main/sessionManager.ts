// Owns the SHARED code-server process. Multi-tab UI loads
// http://127.0.0.1:<sharedPort>/?folder=<cwd> with different cwds, so all
// tabs share one VS Code server but identify their own workspace via the
// folder query param. Stable port across launches (see pickStablePort) =
// stable workspace URI = stable workspace identity = persisted state.
//
// Each "session" is a logical record { sessionId, port, cwd } -- create()
// no longer spawns anything, just registers the tab. The shared process
// is spawned once at app bootstrap via start() and torn down at quit via
// disposeAll().
//
// Bound to 127.0.0.1 with --auth none. Loopback-only is the only thing
// keeping an unauthenticated VS Code off the LAN -- never bind to 0.0.0.0.
import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import type { Session, Workspace } from "@shared/ipc";
import { waitForPort } from "./tcpReady";

interface SessionRecord extends Session {}

export interface SessionManagerOptions {
  codeServerPath: string;
  userDataDir: string;
  // Resolved by pickStablePort before construction.
  port: number;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private proc: ChildProcess | null = null;
  private userDataDirReady = false;

  constructor(private readonly opts: SessionManagerOptions) {}

  // Spawns the shared code-server and waits for its HTTP port to accept
  // connections. Call once at app bootstrap. Subsequent calls are no-ops.
  // Throws if the process exits before the port comes up, or if waitForPort
  // times out (~30s).
  async start(): Promise<void> {
    if (this.proc) return;

    await this.ensureUserDataDir();

    this.proc = spawn(
      this.opts.codeServerPath,
      [
        "--auth",
        "none",
        "--bind-addr",
        `127.0.0.1:${this.opts.port}`,
        "--user-data-dir",
        this.opts.userDataDir,
        "--disable-telemetry",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      },
    );

    this.proc.on("exit", (code, signal) => {
      console.error(
        `[sessionManager] shared code-server exited code=${code} signal=${signal}`,
      );
      this.proc = null;
      // M1: no auto-restart. Subsequent create() calls will throw with a
      // user-visible message, surfaced via the renderer's error UI. User
      // must restart Agora.
    });

    this.proc.stdout?.on("data", (chunk) =>
      process.stdout.write(`[cs] ${chunk}`),
    );
    this.proc.stderr?.on("data", (chunk) =>
      process.stderr.write(`[cs] ${chunk}`),
    );

    await waitForPort(this.opts.port);
  }

  // Registers a logical session for `cwd`. No process spawn -- the shared
  // code-server already handles all cwds via the URL query param.
  // Throws if the shared server isn't running (e.g. crashed mid-session).
  create(cwd: string): Session {
    if (!this.proc) {
      throw new Error("code-server is not running. Restart Agora.");
    }
    const sessionId = randomUUID();
    const session: Session = { sessionId, port: this.opts.port, cwd };
    this.sessions.set(sessionId, session);
    return session;
  }

  close(sessionId: string): void {
    this.sessions.delete(sessionId);
    // Process kept alive for other tabs.
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  async disposeAll(): Promise<void> {
    this.sessions.clear();
    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      await terminate(proc);
    }
  }

  private async ensureUserDataDir(): Promise<void> {
    if (this.userDataDirReady) return;
    await mkdir(this.opts.userDataDir, { recursive: true });
    this.userDataDirReady = true;
  }
}

// Resolves the port to use for the shared code-server. Reuses a previously-
// saved port from workspace.json if it's still free, else picks fresh and
// persists the new value. The port has to be stable across launches so VS
// Code's workspace URI (which includes the port) hashes consistently and
// workspaceStorage state survives.
export async function pickStablePort(
  ws: Workspace,
  saveBack: (next: Workspace) => void,
): Promise<number> {
  if (ws.codeServerPort && (await isPortFree(ws.codeServerPort))) {
    return ws.codeServerPort;
  }
  const port = await pickFreePort();
  saveBack({ ...ws, codeServerPort: port });
  return port;
}

// Asks the OS for a free port by binding an ephemeral server on port 0.
function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error("could not determine free port"));
      }
    });
  });
}

// Probe: try to bind the named port. If it succeeds, port is free.
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

// SIGTERM with 2s SIGKILL escalation -- gives code-server time to flush
// per-workspace storage to SQLite before exit.
function terminate(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
    }, 2000);

    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    proc.kill("SIGTERM");
  });
}
