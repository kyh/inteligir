# `@repo/desktop` — the Electron shell

The thin Electron wrapper over `@repo/host` (node backend) + `@repo/app`
(portable UI). Everything product-shaped lives in those packages; this one owns
only what is Electron's to own: window/menu lifecycle, the IPC transport, the
auto-updater, and native packaging (including the sherpa-onnx voice binaries).

## Layout

```
src/
  main/      Electron main process
    index.ts             app lifecycle — create window, boot host, wire IPC
    electron-platform.ts HostPlatform impl — dialogs, keychain cipher, notifications, resource paths
    host-fold.ts         folds host.handlers into ipcMain + forwards host.events
    updater.ts           electron-updater wiring
  preload/   contextBridge — exposes the typed window.desktopBridge derived from @repo/features/ipc-registry
  renderer/  entry shim — index.html + main.tsx that install window.desktopBridge into @repo/app
  __tests__/ Vitest — host-fold, updater, agent-event parsing

resources/   icons + entitlements shipped in the .app (agent assets live in packages/host/resources/agent)
scripts/     build-time verifiers (packaged runtime deps, model registry)
```

## Process boundary

```
renderer (sandboxed Chromium) — @repo/app
   ↕  contextBridge → window.desktopBridge
preload (Node, isolated)
   ↕  ipcRenderer ⇄ ipcMain
main (full Node + Electron) — createHost(@repo/host) behind an ElectronPlatform
```

- **Renderer** never touches Node APIs. Sandboxed, no nodeIntegration, contextIsolation on.
- **Preload** is the narrow bridge, derived from the registry in `@repo/features/ipc-registry`.
- **Main** composes `@repo/host` and folds its handler map into `ipcMain` (`host-fold.ts`).

IPC is typed end-to-end via the registry: each method pairs a channel name with
a TypeBox payload schema and a result/event type, so renaming a method or
changing a payload shape produces a typecheck error in both processes.

## Dev

```bash
pnpm dev:desktop
```

Opens Electron with HMR (renderer). CDP exposed on port 9222 — inspect with
`agent-browser connect 9222`.

## Build & ship

- `pnpm build` — `electron.vite.config.ts` bundles main/preload/renderer into `.output/app`.
- `electron-builder.yml` packages the .app (dmg + zip) and configures auto-update; agent assets are copied from `packages/host/resources/agent` via `extraResources`.
- `scripts/verify-packaged-runtime-deps.mjs` walks the packed .app to catch missing native deps (sherpa-onnx) before release.
- Releases ship via the `release` skill — see `.claude/skills/release/SKILL.md`.
