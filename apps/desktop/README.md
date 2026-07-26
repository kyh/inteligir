# `@repo/desktop` — the Electron app

The desktop product: the Electron main/preload processes plus the whole
renderer UI (the workspace — editor, sidebar, composer, settings, voice). The
node backend is `@repo/server`; the shared wire contract is `@repo/bridge`;
shared primitives are `@repo/ui`. Main owns what is Electron's to own: window/menu
lifecycle, the IPC transport, the auto-updater, and native packaging (including
the sherpa-onnx voice binaries).

## Layout

```
src/
  main/      Electron main process
    index.ts             app lifecycle — boot host, start the ws transport, create window
    electron-platform.ts HostPlatform impl — dialogs, keychain cipher, notifications, resource paths
    updater.ts           electron-updater wiring (the shell-owned updater trio)
  preload/   bootstrap-only — sendSync's the ws endpoint + per-boot local token to the renderer
  renderer/  the product UI — main.tsx dials createWsBridge, installs the Bridge, renders App;
             editor/, workspace/, composer/, sidebar/, settings/, voice/, … (imported via @renderer)
  __tests__/ Vitest — updater, navigation guard, vault-app protocol, editor import cycles,
             wasm search parity (the renderer's own suites live in src/renderer/__tests__/)

dev/         browser dev harness — in-memory fixture Bridge (`dev:harness`)
resources/   icons + entitlements shipped in the .app (agent assets live in packages/agent/resources/agent)
scripts/     build-time verifiers (packaged runtime deps, model registry)
```

## Process boundary

```
renderer (sandboxed Chromium) — the product UI, host-agnostic (talks via the Bridge)
   ↕  WebSocket — createWsBridge (@repo/bridge/ws-bridge), reconnect supervisor + auth
main (full Node + Electron) — createHost(@repo/server) behind an ElectronPlatform,
                              served by startWsHost (@repo/server/transport/ws-host)
```

- **Renderer** never touches Node APIs. Sandboxed, no nodeIntegration, contextIsolation on.
  Its Bridge is a WebSocket client (`createWsBridge`) derived from the registry in
  `@repo/bridge/ipc-registry`.
- **Preload** does not carry data. It is a one-shot bootstrap: a synchronous
  `inteligir:bootstrap` IPC fetches `{ url, token }` (the loopback ws endpoint and the
  per-boot local token) and exposes it as `window.bridgeBootstrap` — keeping the token
  off the renderer's OS command line and out of the page URL.
- **Main** composes `@repo/server` and serves its handler map + event stream
  over ONE WebSocket server (`startWsHost`); the shell-owned updater trio and html-app
  token methods ride along as `shellHandlers`. The same server is the remote-access
  surface for paired mobile devices.

The Bridge is typed end-to-end via the registry: each method pairs a channel name with
a TypeBox payload schema and a result/event type, so renaming a method or changing a
payload shape produces a typecheck error on both sides of the socket.

## Dev

```bash
pnpm dev:desktop
```

Opens Electron with HMR (renderer). CDP exposed on port 9222 — inspect with
`agent-browser connect 9222`.

## Build & ship

- `pnpm build` — `electron.vite.config.ts` bundles main/preload/renderer into `.output/app`.
- `electron-builder.yml` packages the .app (dmg + zip) and configures auto-update; agent assets are copied from `packages/agent/resources/agent` via `extraResources`.
- `scripts/verify-packaged-runtime-deps.mjs` walks the packed .app to catch missing native deps (sherpa-onnx) before release.
- Releases ship via the `release` skill — see `.claude/skills/release/SKILL.md`.
