# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A macOS Electron desktop app. Each tab embeds a full VS Code instance via [code-server](https://github.com/coder/code-server) hosted in an Electron `<webview>`, bound to its own cwd. Claude Code in code-server's integrated terminal detects real VS Code → IDE-integrated mode fires natively (graphical diff, @ mentions, auto-accept).

**Why this exists vs cmux**: cmux solves parallel agent terminals; Agora extends to integrated full-IDE per tab. Each tab is `(cwd + code-server VS Code + Claude Code IDE features)`. cmux + N IDEs becomes Agora's N tabs. See `.plan/vision.md` for the thesis and `.plan/decisions.md` for why this design (Path D) was chosen over forking VS Code or building from scratch.

**Status (2026-04-28)**: M1 (single-session: folder picker → embedded code-server in webview) being rebuilt on the `m1-terminal-skeleton` branch with current toolchain (Electron 41, TS 6, electron-vite 5). Commits 1-5 done (tooling, main, React, preload, IPC contract); commits 6-10 reshape around code-server lifecycle instead of node-pty. M2 adds multi-tab + persistence + attention detection (via auto-installed `agora-helper` VS Code extension). M3 polish. M4 Mac packaging. **Mac-only for v1**; Linux/Windows deferred. See `.plan/roadmap.md`.

## Working style

Surface the technical details and tradeoffs behind non-trivial choices — don't just state the outcome. When picking a library, shaping an IPC channel, or making a lifecycle / security / performance tradeoff, explain the reasoning and the cost so the user understands the decision, not just the result. Flag considerations they may not see (e.g. "this means PTY bytes bypass React state", "this ships separate arm64/x64 dmgs instead of a universal").

**Be willing to be adversarial.** If the user proposes something you think is wrong, weakly reasoned, or storing up problems, say so plainly and argue the case before you implement. Push back on premises, flag risks, and offer the counter-view — agreeing reflexively is a failure mode, not politeness. The user wants a collaborator who'll challenge bad ideas early, not one who executes smoothly and leaves them to discover the cost later. Default to teaching _and_ disagreeing alongside executing.

## Commands

```
npm run dev          # electron-vite dev: builds main/preload, starts renderer HMR, launches Electron
npm run build        # production bundle to out/{main,preload,renderer}
npm run start        # preview a production build
npm run typecheck    # tsc --noEmit for both node (main/preload) and web (renderer) projects
```

No test runner is wired yet; when adding one, use Vitest for unit (mock `node-pty`) and Playwright's `_electron.launch` for e2e.

## Architecture

Three TypeScript projects behind one repo, enforced by two tsconfigs:

- **`tsconfig.node.json`** — compiles `src/main/**`, `src/preload/**`, `src/shared/**`, `electron.vite.config.ts`. Node + Electron types.
- **`tsconfig.web.json`** — compiles `src/renderer/**`, `src/shared/**`, `src/preload/index.d.ts`. DOM + React types.
- Both projects use the `@shared/*` path alias so `src/shared/` is the single source of truth for cross-process types. The same alias is registered in `electron.vite.config.ts` for bundling.

### Process roles

- **Main (`src/main/`)** — owns node-pty PTYs via `SessionManager`, exposes IPC, opens folder dialogs, will own filesystem I/O and `workspace.json` persistence in M2/M3.
- **Preload (`src/preload/index.ts`)** — `contextBridge.exposeInMainWorld('api', ...)` exposes a typed `RendererApi` to the renderer. `src/preload/index.d.ts` augments `Window` so renderer code can call `window.api.*` with full types. `contextIsolation: true`, `sandbox: false`.
- **Renderer (`src/renderer/`)** — React + xterm.js. The `Terminal` component owns an `Xterm` instance per `sessionId` and wires it to `window.api.ptyWrite/ptyResize/onPtyData/onPtyExit`.

### IPC contract

All channel names and payload types live in `src/shared/ipc.ts`. `RendererApi` is the interface the preload implements and that `window.api` conforms to in the renderer. When adding a channel, update (1) the `IPC` constants, (2) the request/response types, (3) `RendererApi`, (4) the preload bridge method, and (5) the main-process handler — in that order. Missing any of these produces compile errors on both sides thanks to the shared types.

### PTY data path (important)

PTY output does **not** flow through React state / Zustand. The Terminal component subscribes to `window.api.onPtyData` and writes bytes directly into xterm's buffer. xterm owns the scrollback. This matters because PTY streams hit 60fps+ during compile output; routing it through state would cause full-tree re-renders. When adding M2 multi-session state, keep PTY bytes out of the store and use a `Map<sessionId, Terminal>` ref registry in the renderer to route `onPtyData` events.

### Shell spawn behavior

`SessionManager.create(cwd)` spawns `$SHELL -l` (or `/bin/zsh -l`) in the chosen cwd with `TERM=xterm-256color`. The **login shell is intentional** — on macOS, apps launched from Finder have a minimal `process.env.PATH` that won't include `~/.local/bin` or `/opt/homebrew/bin`, and a login shell inherits the user's full PATH via `.zprofile` / `.zshrc`. Don't change to a non-login shell without a PATH-fallback strategy.

`close()` sends SIGHUP (not SIGKILL) so the shell can clean up. `app.before-quit` and `window-all-closed` both call `manager.disposeAll()`.

### Security boundary (for M3 work)

When fs IPC handlers are added, all `relPath` inputs must be validated against the session's cwd using `path.resolve` + `startsWith` in the main process. Never trust paths from the renderer. Files outside the session cwd must not be readable or writable.

### Docs convention

Planning and codebase documentation live in `.plan/`, which is a **separate private repo** (github.com/ajaojohn/agora-plan) mounted at `.plan/` locally and gitignored in this repo. If you're cloning Agora from GitHub you won't see those files — request access to the plan repo if you need them.

Inside `.plan/`:

- **`vision.md`** — product thesis (what + why). Read first.
- **`roadmap.md`** — milestone plan (M1–M4), IPC contract, architecture, risks.
- **`decisions.md`** — architecture decision rationale (why Path D, what was rejected).
- **`history.md`** — past-milestone ship records and rebuild-status notes. Append M2/M3 sections as they ship.
- **`code-map.md`** — per-file living reference. **Update it in the same commit as any non-trivial change under `src/`.** Missing entries are treated as broken builds. Since it lives in a separate repo, that's a separate `cd .plan && git commit` — the parent repo won't track the change.

Start there before diving into code.

### Comment convention

Every source file has a **light header comment** (1–3 lines) explaining its purpose and who uses it. Non-obvious exports get a one-line comment; obvious ones (where the name and signature already tell the story) get nothing. **Never** multi-paragraph docstrings, line-by-line narration, or `@param` blocks where TypeScript types already speak. Don't strip these back out — they're the project's onboarding surface alongside `.plan/code-map.md`.

## Native modules

`node-pty` is a native module. The `postinstall` hook runs `electron-rebuild -f -w node-pty` to rebuild against Electron's Node ABI. If you bump the `electron` version or switch architectures, run `npm rebuild` or reinstall to re-trigger.
