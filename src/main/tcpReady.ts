// TCP readiness probe.
//
// Used after spawning code-server: the child returns from `spawn()` instantly,
// but its HTTP server takes ~5-10s to bind and accept connections. Loading the
// view's URL before then shows ERR_CONNECTION_REFUSED. Polling a TCP connect
// is the simplest "is the port live?" signal -- works without parsing stdout
// or coupling to code-server log formats.
import { connect, type Socket } from "net";

export interface WaitForPortOptions {
  host?: string;
  // Total time before rejecting. Default 30s -- comfortable margin over
  // code-server's typical 5-10s startup, low enough that a stuck process
  // still surfaces an error before the user gives up.
  timeoutMs?: number;
  // Gap between connect attempts. Default 200ms.
  intervalMs?: number;
}

export class PortNotReadyError extends Error {
  constructor(host: string, port: number, timeoutMs: number) {
    super(`Port ${host}:${port} did not become ready within ${timeoutMs}ms.`);
    this.name = "PortNotReadyError";
  }
}

export async function waitForPort(
  port: number,
  opts: WaitForPortOptions = {},
): Promise<void> {
  const host = opts.host ?? "127.0.0.1";
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const intervalMs = opts.intervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await tryConnect(host, port)) return;
    await sleep(intervalMs);
  }

  throw new PortNotReadyError(host, port, timeoutMs);
}

// Single connect attempt. Resolves true on connect, false on any failure.
// Always closes the socket; never leaks a half-open connection.
function tryConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, sock: Socket): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };

    const sock = connect({ host, port });
    // Per-attempt timeout shorter than the outer interval so we don't stall
    // when the kernel takes its time on a refused port.
    sock.setTimeout(500);
    sock.once("connect", () => finish(true, sock));
    sock.once("error", () => finish(false, sock));
    sock.once("timeout", () => finish(false, sock));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
