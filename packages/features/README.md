# `@repo/features` — the contract + the backend

One package, two halves split by subpath:

- **`src/` — isomorphic.** The shared vocabulary the renderer and backend both speak: the Bridge/IPC registry, domain schemas, and pure engines (knowledge index, agent-event parsing, markdown). The same modules load in the Electron renderer (a browser context) and node, so no node built-ins and no electron here (lint-enforced).
- **`src/server/` — the node backend.** vault, pi agent, delegation, executor, voice, and the Bridge handler map behind `createHost()` (pi-driver + agent-runtime folded in). Node is fine here; electron/desktop are not — the shell injects a `HostPlatform`. See [`src/server/README.md`](./src/server/README.md).

No barrel; import by file. The renderer imports the iso half (`@repo/features/...`); the desktop main process imports the backend (`@repo/features/server/...`).

## IPC registry → Bridge

`src/ipc-registry.ts` is the single source of truth for every channel crossing the main↔renderer boundary. Each entry pairs a channel name with a TypeBox payload schema (runtime validation) and a result/event type (compile-time inference). Everything else is **derived** from it:

- the transport-agnostic `Bridge` type (`src/ipc-registry.ts`) that the renderer consumes;
- the Electron preload bridge object (automatic — no per-channel code);
- the backend handler registrar (`src/server` validates payloads and throws at boot on missing/duplicate handlers).

A renamed channel or changed payload is a compile error in every process. The `UPDATE_METHODS` trio (electron-updater) is a desktop-shell overlay, answered locally rather than by the host.

**Adding a channel** is a three-step checklist (registry entry → host handler → fixture-bridge coverage) — see [`docs/development.md`](../../docs/development.md#making-changes--checklists).

## Knowledge engine

`src/knowledge/` is the vault knowledge engine: `knowledge-index.ts` composes wiki/md link extraction (`link-extract.ts`), global link resolution (`link-resolve.ts`), backlinks, and lexical search (`search-index.ts`) with incremental per-doc updates; `rename-links.ts` computes byte-surgical link rewrites on rename (aliases, anchors, padding survive verbatim; anti-shadow qualification when the new name would steal another doc's links). Pure and environment-free **by design**: the host (real vault + watcher) and the dev harness's fixture bridge (in-memory Map) run the same engine, and the wire types the knowledge channels return are defined here.

## Domain schemas & helpers

- `app-state.ts` — the app state machine's phases + events (TypeBox; the host reducer and the UI phase gate share it).
- `agent-events.ts` / `agent-event-parser.ts` — pi agent event surface + the pure parser that projects raw pi events into renderer-safe `AppAgentEvent`s.
- `delegation.ts`, `executor.ts`, `inline-ai.ts`, `ui-state.ts`, `voice.ts` — per-domain payload/result schemas referenced by the registry.
- `markdown/remark-wiki-link.ts` — the `[[wiki-link]]` micromark/remark extension shared by the editor pipeline and the knowledge engine.

## Test

```bash
pnpm --filter @repo/features test   # knowledge engine, parsers, schemas
```
