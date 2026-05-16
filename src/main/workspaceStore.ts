// Reads / writes workspace.json -- the persisted tab list.
//
// Single in-memory snapshot. Writes are debounced 500ms to coalesce flurries
// (rapid add/close/setActive), then atomically renamed from .tmp so a crash
// mid-write can't corrupt the canonical file. before-quit calls flush() to
// drain any pending debounce before the process exits.
//
// Read errors (missing file, JSON parse error, schema mismatch) all fall
// back to EMPTY_WORKSPACE -- the user gets a fresh start rather than a
// crash. The original file is preserved at <path>.corrupt for postmortem.
import { readFile, writeFile, rename } from "fs/promises";
import { EMPTY_WORKSPACE, WorkspaceSchema, type Workspace } from "@shared/ipc";

const DEBOUNCE_MS = 500;

export class WorkspaceStore {
  private snapshot: Workspace = EMPTY_WORKSPACE;
  private timer: NodeJS.Timeout | null = null;
  // Write currently in flight, if any. Lets flush() await an active write
  // started by a prior debounce timer.
  private writeInFlight: Promise<void> | null = null;

  constructor(private readonly path: string) {}

  // Reads workspace.json into the in-memory snapshot. Safe to call once at
  // bootstrap; subsequent state lives entirely in the snapshot.
  async load(): Promise<Workspace> {
    try {
      const text = await readFile(this.path, "utf-8");
      const json = JSON.parse(text);
      this.snapshot = WorkspaceSchema.parse(json);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Cold launch -- normal, no workspace yet.
        this.snapshot = EMPTY_WORKSPACE;
      } else {
        // Corrupt or schema-incompatible. Preserve original for debugging
        // and reset to empty so the user can keep working.
        console.error(
          `[workspaceStore] failed to load ${this.path}, resetting to empty:`,
          err,
        );
        await this.preserveCorrupt().catch(() => {
          // best-effort
        });
        this.snapshot = EMPTY_WORKSPACE;
      }
    }
    return this.snapshot;
  }

  // Returns the current snapshot. Cheap -- just reads memory.
  current(): Workspace {
    return this.snapshot;
  }

  // Replaces the snapshot and schedules a debounced write. Call this from
  // any IPC handler that mutates state (workspace:setTabs, workspace:setActive).
  set(next: Workspace): void {
    this.snapshot = next;
    this.scheduleWrite();
  }

  // Cancels any pending debounce and writes immediately. Awaits both the
  // immediate write and any in-flight write started earlier. Use from
  // before-quit so no state is lost on graceful exit.
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.writeInFlight) {
      await this.writeInFlight;
    }
    await this.writeNow();
  }

  private scheduleWrite(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writeNow().catch((err) =>
        console.error("[workspaceStore] debounced write failed:", err),
      );
    }, DEBOUNCE_MS);
  }

  private writeNow(): Promise<void> {
    const tmp = `${this.path}.tmp`;
    const text = JSON.stringify(this.snapshot, null, 2);
    const job = (async () => {
      await writeFile(tmp, text, "utf-8");
      await rename(tmp, this.path);
    })();
    this.writeInFlight = job.finally(() => {
      this.writeInFlight = null;
    });
    return this.writeInFlight;
  }

  private async preserveCorrupt(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(this.path, `${this.path}.corrupt-${stamp}`);
  }
}
