# CLAUDE.md

Guidance for coding agents working with this repository.

## What this is

A macOS Electron desktop app. Each tab embeds a full VS Code instance via [code-server](https://github.com/coder/code-server) hosted in an Electron `WebContentsView`, bound to its own cwd. VS Code-aware coding agents running inside code-server's integrated terminal detect real VS Code → IDE-integrated features fire natively (graphical diff, @ mentions, auto-accept where supported).

**Shape**: each tab is `(cwd + code-server VS Code + agent IDE features)`. Tabs are independent — separate cwd, separate workspace state, separate agent sessions in the integrated terminal — but share a single code-server process under the hood for resource efficiency.

**Mac-only for v1**; Linux/Windows deferred.

## Working style

Surface the technical details and tradeoffs behind non-trivial choices — don't just state the outcome. When picking a library, shaping an IPC channel, or making a lifecycle / security / performance tradeoff, explain the reasoning and the cost so the user understands the decision, not just the result.

**Be willing to be adversarial.** If the user proposes something you think is wrong, weakly reasoned, or storing up problems, say so plainly and argue the case before you implement. Push back on premises, flag risks, and offer the counter-view — agreeing reflexively is a failure mode. Default to teaching _and_ disagreeing alongside executing.

## Where things live

- **`package.json` scripts** — `dev`, `build`, `start`, `typecheck`, `format`, `format:check`, `build:mac`. Run from there; don't memorize.
- **`src/shared/`** — single source of truth for cross-process types. `@shared/*` alias resolves in main, preload, and renderer via two tsconfigs (`tsconfig.node.json` for main/preload, `tsconfig.web.json` for renderer) and `electron.vite.config.ts`.

## Architecture invariants

- **Renderer is React only** — no terminal emulator, no native modules. code-server's own editor/terminal lives inside its WebContentsView; the React shell only hosts tabs, dialogs, and overlay UI.
- **IPC contract** — every channel lives in `src/shared/ipc.ts`. Adding one is a 5-step change in this order: (1) `IPC` constants, (2) request/response types, (3) `RendererApi` method, (4) preload bridge method, (5) main handler. Missing any step produces compile errors on both sides thanks to the shared types.
- **No high-frequency data through IPC** — terminal output, file watch streams, etc. already stay inside code-server's own WebSocket inside its WebContentsView. The Electron IPC layer is for control plane only (open folder, create session, set view bounds, menu events).
- **code-server is a third-party origin** — its WebContentsView has no preload bridge and cannot reach `window.api`. Treat the page as untrusted; route any cross-process needs through dedicated main-side IPC, never by exposing more surface to the view.
- **Security boundary for future fs handlers** — when any IPC handler accepts a path from the renderer, validate it against the session's cwd using `path.resolve` + `startsWith` in main. Files outside the session cwd must not be readable or writable. Currently no such handler exists; rule applies whenever one is added.

## Comment convention

Every source file has a **light header comment** (1–3 lines) explaining its purpose. Non-obvious exports get a one-line comment; obvious ones (where the name + TypeScript signature already tell the story) get nothing. **Never** multi-paragraph docstrings, line-by-line narration, or `@param` blocks. Don't strip these back out — they're the project's onboarding surface.

## Docs hygiene

Treat `CLAUDE.md` and `README.md` as part of the change surface. If a code or process change contradicts any claim in either file — architecture invariants, dependency list, release workflow, status statements — update or remove the affected prose in the same change. The same rule applies to source-file headers and config comments: when their stated rationale no longer matches the file's actual role, fix the comment, don't leave the drift behind.

## Release workflow

Releases are fully automated via `release-please` + electron-builder. Do not bump `package.json` version manually, do not create `vX.Y.Z` tags, do not push directly to `main`.

- **PR titles must use Conventional Commits** (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, `style:`, `test:`, `ci:`, `build:`). Enforced by `.github/workflows/pr-title.yml`. The PR title becomes the squash subject on merge, and that subject is what release-please scans to decide the bump (`feat:` → minor, `fix:` → patch, `feat!:` or `BREAKING CHANGE:` → major).
- **CI (`ci.yml`)** runs `npm run typecheck` on every PR and main push.
- **Cutting a release**: merge feature PRs to `main` normally. `release-please.yml` runs on each main push, scans commits since the last release, and opens (or updates) a single **Release PR** that bumps `package.json` + `.release-please-manifest.json` and rewrites `CHANGELOG.md`. Review and merge that Release PR → release-please creates the `vX.Y.Z` git tag + a **published** (non-draft) GitHub release with the CHANGELOG as release notes. Releases must never be drafts: a draft has no git tag, and until the tag exists release-please proposes a phantom next version (if one ever appears, close it, never merge it).
- **dmg build** is the `build-mac` job in `release-please.yml`, gated on `release_created`. macOS runner runs `npm run build:mac -- --universal --publish always`; electron-builder attaches the universal dmg to the just-published release (`releaseType: "release"` in `package.json` — must match the non-draft release or electron-builder creates a stray draft). Currently ad-hoc signed (`identity: "-"` in `package.json`); proper signing + notarization needs Apple Developer ID secrets — defer until enrolled.
- `.release-please-manifest.json` is the source of truth for "what version is currently released". Always edited by release-please's own PRs.
