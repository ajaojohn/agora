// Resolves the absolute path to the `code-server` binary at app startup.
//
// Why a login shell: when Agora is packaged and launched from Finder,
// process.env.PATH is minimal and won't include /opt/homebrew/bin,
// /usr/local/bin, or user-global npm/pnpm dirs. A login shell sources
// the user's profile (.zprofile / .zshrc) and inherits the full PATH.
import { spawn } from "child_process";

export class CodeServerNotFoundError extends Error {
  constructor() {
    super(
      [
        "code-server not found on PATH.",
        "Install with `brew install code-server` (macOS) and try again.",
        "If already installed, ensure it is on the PATH of your login shell.",
      ].join(" "),
    );
    this.name = "CodeServerNotFoundError";
  }
}

// Runs `command -v code-server` inside the user's login shell.
// `command -v` is POSIX (works in zsh + bash) and prints the absolute path.
// Resolves to the trimmed path, or throws CodeServerNotFoundError.
export async function locateCodeServer(): Promise<string> {
  const shell = process.env.SHELL ?? "/bin/zsh";

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(shell, ["-lc", "command -v code-server"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", () => {
      // discard
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      const path = stdout.trim();
      if (code === 0 && path.length > 0) {
        resolve(path);
      } else {
        reject(new CodeServerNotFoundError());
      }
    });
  });
}
