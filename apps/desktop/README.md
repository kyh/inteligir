# `@repo/desktop` — Inteligir Electron app

Three-process Electron app wrapping a pi-coding-agent runtime. The agent does real work (filesystem, shell, browser via agent-browser CLI, Google Workspace via gws CLI); the renderer is a chat UI over it.

## Layout

```
src/
  main/      Electron main process — app lifecycle, agent singleton, IPC, auto-updater
  preload/   Bridge — exposes a typed window.api to the renderer over contextBridge
  renderer/  React UI — chat, login, onboarding, voice, settings
  agent/     pi-coding-agent composition — extension bundles + Agent class
  shared/    Types/schemas crossing the IPC boundary (used by main + renderer)
  __tests__/ Vitest suites — reducer, machine, effects, etc.

resources/   Bundled assets shipped inside the .app — agent skills, AGENTS.md, icons
scripts/     Build-time verifiers (runtime deps, model registry)
```

Each top-level dir has its own README where the architecture isn't obvious from reading code:

- [`src/main/README.md`](./src/main/README.md) — state machine triad, IPC pattern, how to add an effect
- [`src/agent/README.md`](./src/agent/README.md) — pi extension bundle pattern, how to add an extension

## Process boundary

```
renderer (sandboxed Chromium)
   ↕  contextBridge → window.api
preload (Node, isolated)
   ↕  ipcRenderer ⇄ ipcMain
main (full Node + Electron)
   ↕  Agent (pi-coding-agent)
filesystem / shell / agent-browser CLI / gws CLI
```

- **Renderer** never touches Node APIs. Sandboxed, no nodeIntegration, contextIsolation on.
- **Preload** is the narrow bridge. Validates inbound, types outbound.
- **Main** is where everything real happens. Holds the agent singleton, manages auth, runs the state machine.

IPC is typed end-to-end via `shared/ipc.ts` (channel constants) + Zod schemas (`shared/app-state.ts`, `shared/voice.ts`, `shared/task.ts`). Both processes import from `shared/`, so renaming a channel or changing a payload shape produces a typecheck error in both places.

## App lifecycle

The state machine in `src/main/` drives onboarding:

```
logged_out → logging_in → logged_in → setting_up → ready
                  ↓                        ↓           ↓
                error                    error      logging_out
```

`setting_up` runs `seedResources()` (skills, bin dir, PATH, all extension bundle setups) then `startAgent()`. See [`src/main/README.md`](./src/main/README.md).

## Dev

```bash
pnpm dev:desktop
```

Opens Electron with HMR (renderer) + tsc watch (main/preload). CDP exposed on port 9222 — inspect with `agent-browser --session inteligir-desktop connect 9222` (see root `AGENTS.md`).

## Build & ship

- `pnpm build` — `electron.vite.config.ts` bundles main/preload/renderer; `tsc` typechecks.
- `electron-builder.yml` packages the .app and configures auto-update.
- `scripts/verify-packaged-runtime-deps.mjs` runs in CI to catch missing native deps before release.

## Adding things — quick map

| Adding...                                 | Where                                                         | See                                |
| ----------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| New IPC channel                           | `shared/ipc.ts` + handler in `main/index.ts` + preload bridge | `main/README.md`                   |
| New app state phase                       | `shared/app-state.ts` + reducer + tests                       | `main/README.md`                   |
| New side effect on transition             | `main/app-effects.ts` + `EffectDeps` + machine wiring         | `main/README.md`                   |
| New pi tool / 3rd-party integration       | `agent/<name>/extension.ts` + glob picks it up                | `agent/README.md`                  |
| Reusable install primitive                | `packages/agent-runtime/`                                     | `packages/agent-runtime/README.md` |
| New chat UI panel                         | `renderer/chat/`                                              | (no README — standard React)       |
| Bundled resource (skill, AGENTS.md, etc.) | `resources/agent/` + reference in `agent/setup.ts`            | `agent/README.md`                  |
