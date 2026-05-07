# Agora

macOS multi-tab IDE host for running CLI coding agents in parallel across many projects.

<p align="center">
  <img width="1724" height="980" alt="agora readme gif" src="https://github.com/user-attachments/assets/9f033273-637a-46dd-9326-8904d6b61287" />
</p>

> ⚠️ Early development. M1 (multi-tab daily-driver) in progress on `m1-terminal-skeleton`. Not yet packaged for install.

## What it is

Agora is a single Electron window with N tabs. Each tab embeds a full VS Code instance (via [code-server](https://github.com/coder/code-server)) bound to its own working directory. You open the integrated terminal in any tab and run a CLI coding agent — Claude Code, Codex, Aider, whatever — and it runs there isolated from the other tabs.

Switching tabs swaps which workspace is foregrounded. Each tab keeps its agent running, its editor state, its terminal scrollback, its source-control panel. Tab list survives quit and restart.

## Why

If you run AI coding agents across many repos, you currently juggle:

- A terminal multiplexer per agent
- N separate VS Code or Cursor windows scattered across the desktop, one per repo, for diff review and editing

Agora collapses both into one window. Each tab is `(cwd + agent + IDE)`. Project switching becomes a tab click instead of a Cmd-Tab dance through scattered windows. Claude Code's IDE features (graphical diff, @ mentions, auto-accept) fire natively because each tab really is VS Code.

## Status

| Milestone | Status | What ships |
|---|---|---|
| M1 — multi-tab daily-driver | In progress | Tab bar, per-tab code-server, persistent workspace, lazy spawn |
| M2 — attention detection | Planned | `agora-helper` extension, per-tab indicators, macOS notifications, dock badge |
| M3 — polish | Planned | Settings UI, tab reorder/rename, prewarm pool |
| M4 — packaging | Planned | Signed/notarized dmg, auto-update |

See [`.plan/roadmap.md`](.plan/roadmap.md) for the full roadmap and [`.plan/vision.md`](.plan/vision.md) for the product thesis.

## Requirements

- macOS (v1 is Mac-only — Linux/Windows deferred)
- `code-server` on `PATH`: `brew install code-server`
- A CLI coding agent of your choice (e.g. `claude`, `codex`) installed inside any tab's VS Code

## Run from source

```bash
git clone https://github.com/ajaojohn/agora
cd agora
npm install
npm run dev
```

## Build a Mac dmg

```bash
npm run build:mac
```

Output lands in `release/`. Note: M4 (signing + notarization + auto-update) not done yet — local builds run unsigned.

## Architecture

Three TypeScript projects in one repo:

- **Main** — owns code-server child processes, port allocation, `workspace.json` persistence, view lifecycle
- **Preload** — typed `contextBridge` exposing `window.api`
- **Renderer** — React + tab bar + content area; hosts `WebContentsView` per tab

IPC channel contract lives in `src/shared/ipc.ts`. Architecture decision rationale in [`.plan/decisions.md`](.plan/decisions.md).

## License

MIT — see [LICENSE](LICENSE).
