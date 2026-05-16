# Agora

macOS Electron app — multiple VS Code workspaces in one window with quick tab switching.

<p align="center">
  <img width="1724" height="980" alt="agora readme gif" src="https://github.com/user-attachments/assets/9f033273-637a-46dd-9326-8904d6b61287" />
</p>

> ⚠️ Pre-1.0. Active development; breaking changes possible. Agora ships the IDE host today — agent-aware features (per-tab attention indicators, cross-tab notifications, dock badges, prewarm pool) are on the roadmap and not yet built. See [Releases](../../releases) for what has shipped.

## What it is

A tabbed wrapper around N VS Code instances. Each tab runs a full [code-server](https://github.com/coder/code-server) bound to a folder. Click a tab → that workspace foregrounds. State persists across quit: editor buffers, terminal scrollback, any process running in a tab's integrated terminal, source-control panel, tab list.

That's the whole app today. No agent integration, no cross-tab coordination, no per-tab indicators — just a window manager for parallel VS Code workspaces.

## Why

If you work across many repos with AI coding agents, you currently juggle N separate VS Code or Cursor windows scattered across the desktop plus a terminal multiplexer for the agents themselves. Agora collapses that into one window: each tab is its own real VS Code, and whatever you run in its integrated terminal (agent, dev server, REPL) stays isolated. Because each tab really is VS Code, any IDE features the agent itself ships (graphical diff, @ mentions, auto-accept) fire when it runs in the terminal — Agora doesn't add or proxy them.

## Requirements

- macOS (v1 is Mac-only — Linux/Windows deferred)
- `code-server` on `PATH`: `brew install code-server`
- A CLI coding agent of your choice installed inside any tab's VS Code

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

Output lands in `release/`. Builds are ad-hoc signed — Gatekeeper will warn on first open; right-click → Open to bypass. CI also builds and publishes a universal dmg on every release; grab it from the [Releases](../../releases) page. Proper signing + notarization + auto-update pending Apple Developer ID enrollment.

## Architecture

Three TypeScript projects in one repo:

- **Main** — owns code-server child processes, port allocation, view lifecycle, persistence
- **Preload** — typed `contextBridge` exposing `window.api`
- **Renderer** — React tab bar + content area; each tab hosts a `WebContentsView` painted over the content div

IPC channel contract lives in `src/shared/ipc.ts`.

## License

MIT — see [LICENSE](LICENSE).
