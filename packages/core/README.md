# `@repo/core` — the isomorphic contract

The shared vocabulary every host and UI speaks: the Bridge/IPC registry, the WS wire protocol, domain schemas, and pure engines (knowledge index, agent-event parsing). **Isomorphic** — the same modules load in the browser, the Electron renderer, and node hosts, so no node built-ins and no electron anywhere (lint-enforced). No barrel; import by file.

## IPC registry → Bridge

`src/ipc-registry.ts` is the single source of truth for every channel crossing a host boundary. Each entry pairs a channel name with a TypeBox payload schema (runtime validation) and a result/event type (compile-time inference). Everything else is **derived** from it:

- the transport-agnostic `Bridge` type (re-exported via `src/ipc.ts`) that `@repo/app` consumes;
- the Electron preload bridge object (automatic — no per-channel code);
- the host handler registrar (`@repo/host` validates payloads and throws at boot on missing/duplicate handlers);
- the WS fold in `@repo/server`.

A renamed channel or changed payload is a compile error in every process. The `UPDATE_METHODS` trio (electron-updater) is a desktop-shell overlay: absent from host handlers, answered locally by the WS client.

**Adding a channel** is a four-step checklist (registry entry → host handler → one line in `bridge-ws-client.ts` → fixture-bridge coverage) — see [`docs/development.md`](../../docs/development.md#making-changes--checklists).

## Wire protocol

`src/bridge-wire.ts` defines the WS envelopes (request/response/event/error) that `@repo/server` folds the registry into at runtime — a new channel needs no wire changes. Binary frames are tag-prefixed for voice PCM: `0x01` client→server STT mic audio, `0x02` server→client TTS speech. `src/bridge-ws-client.ts` (`createWsBridge`) is the browser counterpart: satisfies `Bridge`, reconnects forever with capped backoff, resyncs on reopen.

## Knowledge engine

`src/knowledge/` is the vault knowledge engine: `knowledge-index.ts` composes wiki/md link extraction (`link-extract.ts`), global link resolution (`link-resolve.ts`), backlinks, and lexical search (`search-index.ts`) with incremental per-doc updates; `rename-links.ts` computes byte-surgical link rewrites on rename (aliases, anchors, padding survive verbatim; anti-shadow qualification when the new name would steal another doc's links). Pure and environment-free **by design**: the host (real vault + watcher) and the dev harness's fixture bridge (in-memory Map) run the same engine, and the wire types the knowledge channels return are defined here.

## Domain schemas & helpers

- `app-state.ts` — the app state machine's phases + events (TypeBox; the host reducer and the UI phase gate share it).
- `agent-events.ts` / `agent-event-parser.ts` — pi agent event surface + the pure parser that projects raw pi events into renderer-safe `AppAgentEvent`s.
- `agent.ts`, `delegation.ts`, `executor.ts`, `inline-ai.ts`, `ui-state.ts`, `voice.ts` — per-domain payload/result schemas referenced by the registry.
- `markdown/remark-wiki-link.ts` — the `[[wiki-link]]` micromark/remark extension shared by the editor pipeline and the knowledge engine.

## Test

```bash
pnpm --filter @repo/core test   # wire protocol, knowledge engine, parsers
```
