// Top-level component. M1 single-session shell:
//   empty -> pickFolder -> createSession -> attachView -> active
// State is a discriminated union so each branch renders its own UI without
// a sea of nullable fields. Multi-session shell with a tab bar lands in M2.
import { useLayoutEffect, useRef, useState } from "react";
import type { Session } from "@shared/ipc";

type State =
  | { kind: "empty" }
  | { kind: "loading"; phase: "starting" | "attaching"; cwd: string }
  | { kind: "active"; session: Session }
  | { kind: "error"; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: "empty" });

  async function open(): Promise<void> {
    const folder = await window.api.pickFolder();
    if (!folder) return;
    setState({ kind: "loading", phase: "starting", cwd: folder.path });
    try {
      const session = await window.api.createSession(folder.path);
      setState({ kind: "loading", phase: "attaching", cwd: folder.path });
      await window.api.attachView(session.sessionId);
      setState({ kind: "active", session });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ kind: "error", message });
    }
  }

  function reset(): void {
    setState({ kind: "empty" });
  }

  return (
    <div className="app">
      {state.kind === "empty" && <Empty onOpen={open} />}
      {state.kind === "loading" && (
        <Loading phase={state.phase} cwd={state.cwd} />
      )}
      {state.kind === "active" && <Active session={state.session} />}
      {state.kind === "error" && (
        <ErrorView message={state.message} onRetry={reset} />
      )}
    </div>
  );
}

function Empty({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="empty">
      <h1>Agora</h1>
      <p>Open a folder to start a code-server session.</p>
      <button onClick={onOpen}>Open Folder</button>
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
