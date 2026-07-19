# `@repo/backend` — the node backend

The node host behind `createHost()`: vault, delegation, connectors daemon, voice, sync adapters, the knowledge host shell, the ws transport, and the `boot/` composition root that wires `@repo/agent` capabilities in. See [`src/server/README.md`](./src/server/README.md).

The isomorphic wire contract (Bridge/IPC registry, ws client + protocol, shared schemas) lives in `@repo/bridge`; the pure domain (knowledge, markdown, sync engine) in `@repo/notes`; the pi capability in `@repo/agent`; generic CLI provisioning in `@repo/installer`.

No barrel; **exports are narrow on purpose** — the package.json `exports` map lists exactly the entrypoints the desktop main process composes (`server/boot/create-host`, `server/transport/ws-host`, `server/transport/remote-access-manager`, `server/capture/deep-link-service`, `server/platform`, `server/vault/vault`, `server/knowledge/sqlite-knowledge-store`). Everything else is package-private; widening the surface is a conscious exports-map change, not a driveby deep import.

## IPC registry → handlers

`@repo/bridge/ipc-registry` is the single source of truth for every channel. `createHost` returns a schema-validated handler map (`src/server/handlers/`) served over one local WebSocket server (`startWsHost`); payloads are validated at the boundary and boot throws on missing/duplicate handlers. A renamed channel or changed payload is a compile error in every process. The `UPDATE_METHODS` trio (electron-updater) is a desktop-shell overlay, answered locally rather than by the host.

**Adding a channel** is a three-step checklist (registry entry → host handler → fixture-bridge coverage) — see [`docs/development.md`](../../docs/development.md#making-changes--checklists).

## Test

```bash
pnpm --filter @repo/backend test
```
