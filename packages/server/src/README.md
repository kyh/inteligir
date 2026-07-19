# `server/src` — the node backend

The platform-agnostic backend (imported as `@repo/server/*`): app lifecycle, the agent singleton, the knowledge host shell, delegation, capture, restore, provider config, and the Bridge handler map — the composition glue over the extracted capability packages (`@repo/storage`, `@repo/vault`, `@repo/voice`, `@repo/connectors`, `@repo/sync`). `createHost(platform, options)` (`boot/create-host.ts`) composes it all; the Electron desktop shell (`apps/desktop`) injects a `HostPlatform` (`platform.ts`) for everything OS/shell-shaped — native dialogs, secret cipher (keychain or file-key), notifications, packaged-resource paths — folds `host.handlers` over Electron IPC, and forwards `host.events`. Only one real host runs at a time: `@repo/storage/host-lock` is a pidfile under `~/.inteligir`. The UI talks to it only via methods declared in the registry (`@repo/bridge/ipc-registry`). No electron imports anywhere in this package — lint-enforced. The pi capability lives in `@repo/agent` (generic CLI provisioning in `@repo/installer`); the boot/ composition root injects `AgentPorts` — @repo/agent has no dep on this package, so "agent never reaches into the backend" is a package fact.

## State machine — three-part split

The app has a hard-to-test mix of concerns: pure logic ("which phase do we transition to?"), side effects ("download the binary"), and orchestration ("queue events serially, broadcast after each step"). They live in three files:

```
app-reducer.ts    pure (state, event) → { next, effect } | null
app-effects.ts    impure runEffect(tag, deps): MachineEvent
app-machine.ts    glue: serialized queue + broadcast + injectable deps
```

**Why split:**

- `app-reducer.ts` has zero imports from the platform or the agent layer. Trivial to unit-test exhaustively (every state × event combination).
- `app-effects.ts` takes deps as an arg, so tests pass mocks. No singletons reached at runtime.
- `app-machine.ts` is the only file that wires real deps + broadcasts to renderer. Small surface to integration-test.

The reducer returns an `EffectTag` (a string), not the effect itself. The runner maps tags to operations. This keeps the reducer pure and lets the machine class swap in fake deps for tests.

## Adding to the machine

**New external event** (renderer-triggered):

1. Add to `AppEventSchema` in `@repo/bridge/app-state` (validates the Bridge payload).
2. Add a `case` in `app-reducer.ts` returning `{ next, effect }` — guard with the source phase.
3. If it triggers an effect, add the tag to `EffectTag` and a case in `runEffect`.

Internal events (`SETUP_OK`/`SETUP_FAIL`, `NEW_SESSION_OK`/`NEW_SESSION_FAIL`, `AGENT_START`/`AGENT_END`) are emitted only by the effect runner, never by the renderer. Each `*_FAIL` carries a `message`; the reducer routes it into the `error` phase, which records `prev` so `RETRY` knows where to resume. There is no login phase — the app boots as a guest (#459); the only full-teardown path is the `RESET_APP_DATA` external event (the `RESET` effect: stop → wipe → resume writes → re-seed → re-harden perms).

**New phase**:

1. Add to `AppStateSchema` in `@repo/bridge/app-state`.
2. Update reducer guards (`state.phase !== "..."` checks) to include the new phase wherever it should accept events.
3. Add tests in `src/__tests__/app-machine.test.ts` for the new transitions.

**New side effect**:

1. Extend `EffectDeps` in `app-effects.ts` with the function signature.
2. Wire the real implementation in `realDeps` in `app-machine.ts`.
3. Mirror in `fakeDeps` / `makeDeps` in tests.

If the effect is part of `SETUP` (binary install, config seed), prefer adding it to a [pi extension bundle](../../agent/src/README.md) instead. Bundles run inside `seedResources()` so each new third-party integration doesn't grow the EffectDeps surface.

## Agent singleton

`app-machine.ts` holds the single `Agent` instance. `getAgent()` is the only way the IPC layer reaches it. Lifecycle:

- `startAgent()` — constructs `new Agent({ ...opts, ports: getAgentPorts() })`, awaits `start()`, subscribes to events, starts the background delegation agent, and wires it to the delegation queue. On failure, fully tears down so a retry doesn't see a half-initialized singleton.
- `stopAgent()` — awaits `agent.stop()`, nulls the ref, stops the background delegation agent and the executor daemon.
- `newSession()` — `stop` + `start({ newSession: true })`. Opens a fresh pi session.

**Composition seam** — the composition module (`boot/agent-wiring.ts`) builds the `AgentPorts` capability object (`{ executor, knowledge, privacy, checkpoints }`) handed to agent extension bundles plus the injected bundled-resource location, and owns seed/login/teardown orchestration. `@repo/agent` must never import the host — it has no dep edge on this package; anything an extension needs flows through the ports. `app/agent-gateway.ts` (the single entry point for interactive agent commands) imports `getAgent` from `app-machine`, so the cycle is one-directional and needs no injection.

## Per-turn instrumentation

`handleAgentEvent` in `app-machine.ts` mirrors every pi event to the dev terminal (and to `~/.inteligir/logs/agent.log` — see `@repo/storage/agent-log`) with an `[agent-event]` prefix, and tracks per-turn state in a `Turn` object. If a turn ends without any assistant text, tool call, or pi-emitted error, it emits a synthetic `turn_error { kind: "auth" }` event — the silent-empty-turn fallback for upstream failures that pi swallowed as success. The renderer's `ReauthDialog` listens on the same event.

## Bridge handlers

Domain-grouped under `handlers/` (one file per domain, composed by `handlers/register-handlers.ts`). Each group registers through the typed registrar (`handlers/handler-registry.ts::collectHandlers`): the channel, TypeBox payload schema, and result type are looked up from the shared registry (`@repo/bridge/ipc-registry`), payloads are `Value.Check`-validated before the handler runs, and boot throws if any host-owned method is left unhandled. The registry's `UPDATE_METHODS` trio is deliberately absent — electron-updater is the desktop shell's overlay. Host → UI events use `events.ts::emitEvent`, keyed by the same registry — a renamed channel or changed payload shape is a compile error on both sides, and each shell's bridge is derived from the registry too.

## Other modules

What REMAINS here is host-shell/composition glue; the capabilities themselves are their own packages.

- `knowledge/` — the knowledge host shell: `knowledge-manager.ts` runs the pure engine from `@repo/notes/knowledge` over vault events (incremental link graph, backlinks, lexical search), `sqlite-knowledge-store.ts` binds the SQL store to `node:sqlite`, and `rename-rewrite.ts` applies byte-surgical `[[link]]` rewrites across the vault on rename.
- `app/agent-gateway.ts` — the single entry point for interactive agent commands (a thin typed pass-through to the live agent).
- `app/inline-ai.ts` + `app/ghost-text.ts` — the editor-AI backends: intent classification/generation on a no-tools pi session, and ephemeral ghost-text completions on a fast model.
- `app/session-history.ts` — reads recent pi messages from disk for UI history rehydration (one-shot per mount; no cache).
- `delegation/` — checkbox delegation: a versioned store + serialized queue (`delegation-manager.ts`) running tasks on a dedicated `background-agent.ts`; the target file is snapshotted before dispatch so "Restore original" undoes an agent edit byte-exactly; `find-task-line.ts` is the pure checkbox locator.
- `capture/` — the `inteligir://` deep-link surface: `deep-link-service.ts` routes the parsed verbs, `capture-manager.ts` is the durable capture inbox with the exactly-once CAS drain onto today's daily note.
- `restore/` — the ONE AI-edit-undo module (`restore-manager.ts` over `snapshot-store.ts`): chat's tool-gate captures feed the post-turn undo toast; delegation's pre-run captures feed the dock's "Restore original".
- `provider/` — agent provider selection: the catalog's pure normalization (`provider-catalog.ts`), the dumb config store (`provider-config.ts`), and `provider-service.ts` gluing them to pi's on-device credential store.
- `transport/` — the local WebSocket host (`ws-host.ts`), per-boot/paired-device auth (`device-auth.ts`), and the remote-access config/pairing owner (`remote-access-manager.ts`).
- `notifications.ts` — notification settings + message shaping (delivery goes through `platform.notify`).
- `ui-state.ts` — persisted renderer UI state (a generic JSON key→value store; no per-feature key knowledge).
- `boot/` — the composition tier: `create-host.ts`, dependency-ordered singleton construction (`singletons.ts`), notifier composition (`notifier-wiring.ts`), agent ports + seed/login/teardown orchestration (`agent-wiring.ts`, `agent-knowledge-port.ts`), and the post-rename metadata remap (`rename-orchestration.ts`).

The extracted capability packages this shell composes: `@repo/vault` (the user's markdown folder — confined IO, ephemeral listing, open-note watcher, `./vault` agent symlink), `@repo/storage` (versioned JsonStore over `~/.inteligir`, atomic writes, host pidfile lock, permission sweep, agent-log tee, encrypted SecretStore), `@repo/connectors` (the vendor executor daemon + connector install orchestration), `@repo/voice` (sherpa-onnx STT, model download, TTS proxy), and `@repo/sync` (the node sync adapters over the `@repo/notes` engine).
