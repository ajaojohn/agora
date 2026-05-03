// Owns the lifecycle of code-server child processes.
//
// One SessionManager per app. Each session = one cwd + one code-server child
// bound to a unique localhost port. The renderer (M1: empty state, M2+: tabs)
// asks the manager to create/close sessions via IPC; the manager hides the
// process bookkeeping.
//
// Bound to 127.0.0.1 with --auth none. Loopback-only is the only thing keeping
// an unauthenticated VS Code off the LAN — never bind to 0.0.0.0.
import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { mkdir } from "fs/promises";
import { randomUUID } from "crypto";

export interface Session {
  sessionId: string;
  port: number;
  cwd: string;
}

interface SessionRecord extends Session {
  proc: ChildProcess;
}

export interface SessionManagerOptions {
  // Absolute path to the code-server binary, resolved by codeServerLocator.
  codeServerPath: string;
  // Shared user-data-dir for every session. Created lazily on first spawn.
  userDataDir: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private userDataDirReady = false;

  constructor(private readonly opts: SessionManagerOptions) {}

  async create(cwd: string): Promise<Session> {
    await this.ensureUserDataDir();

    const sessionId = randomUUID();
    const port = await pickFreePort();

    const proc = spawn(
      this.opts.codeServerPath,
      [
        "--auth",
        "none",
        "--bind-addr",
        `127.0.0.1:${port}`,
        "--user-data-dir",
        this.opts.userDataDir,
        "--disable-telemetry",
        cwd,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        // Detach from parent's controlling terminal; we kill explicitly on dispose.
        detached: false,
      },
    );

    proc.on("exit", (code, signal) => {
      // If the child dies on its own (crash, OOM, manual kill), drop the record
      // so a later close() doesn't try to signal a dead pid.
      this.sessions.delete(sessionId);
      console.log(`[session ${sessionId}] code-server exited code=${code} signal=${signal}`);
    });

    // For now, surface child output on the main process console for debugging.
    // Will be replaced by an attention-detection pipe in M2.5.
    proc.stdout?.on("data", (chunk) => process.stdout.write(`[cs ${port}] ${chunk}`));
    proc.stderr?.on("data", (chunk) => process.stderr.write(`[cs ${port}] ${chunk}`));

    const record: SessionRecord = { sessionId, port, cwd, proc };
    this.sessions.set(sessionId, record);

    return { sessionId, port, cwd };
  }

  async close(sessionId: string): Promise<void> {
    const record = this.sessions.get(sessionId);
    if (!record) return;

    this.sessions.delete(sessionId);
    await terminate(record.proc);
  }

  list(): Session[] {
    return [...this.sessions.values()].map(({ sessionId, port, cwd }) => ({
      sessionId,
      port,
      cwd,
    }));
  }

  async disposeAll(): Promise<void> {
    const records = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(records.map((r) => terminate(r.proc)));
  }

  private async ensureUserDataDir(): Promise<void> {
    if (this.userDataDirReady) return;
    await mkdir(this.opts.userDataDir, { recursive: true });
    this.userDataDirReady = true;
  }
}

// Asks the OS for a free port by binding an ephemeral server on port 0,
// reading the assigned port, and closing the server. Tiny race window
// between close() and code-server bind() — acceptable on localhost.
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

// Sends SIGTERM, escalates to SIGKILL if the child hasn't exited within 2s.
// SIGTERM lets code-server flush state; SIGKILL is the hammer.
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
