# `features/src/server` — the node backend

The platform-agnostic backend (the node half of `@repo/features`, imported as `@repo/features/server/*`): app lifecycle, the agent singleton, vault, knowledge indexes, delegation, executor, voice, and the Bridge handler map. `createHost(platform, options)` (`create-host.ts`) composes it all; the Electron desktop shell (`apps/desktop`) injects a `HostPlatform` (`platform.ts`) for everything OS/shell-shaped — native dialogs, secret cipher (keychain or file-key), notifications, packaged-resource paths — folds `host.handlers` over Electron IPC, and forwards `host.events`. Only one real host runs at a time: `lib/host-lock.ts` is a pidfile under `~/.inteligir`. The UI talks to it only via methods declared in the registry (`@repo/features/ipc-registry`). No electron imports anywhere in `server/` — lint-enforced. `pi-driver/` and `agent-runtime/` are folded in as sibling dirs, reached from `agent/` via their `@repo/*` aliases.

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

1. Add to `AppEventSchema` in `@repo/features/app-state` (validates the Bridge payload).
2. Add a `case` in `app-reducer.ts` returning `{ next, effect }` — guard with the source phase.
3. If it triggers an effect, add the tag to `EffectTag` and a case in `runEffect`.

Internal events (`LOGIN_OK`/`LOGIN_FAIL`, `SETUP_OK`/`SETUP_FAIL`, `LOGOUT_OK`/`LOGOUT_FAIL`, `NEW_SESSION_OK`/`NEW_SESSION_FAIL`, `AGENT_START`/`AGENT_END`) are emitted only by the effect runner, never by the renderer. Each `*_FAIL` carries a `message`; the reducer routes it into the `error` phase, which records `prev` so `RETRY` knows where to resume.

**New phase**:

1. Add to `AppStateSchema` in `@repo/features/app-state`.
2. Update reducer guards (`state.phase !== "..."` checks) to include the new phase wherever it should accept events.
3. Add tests in `src/__tests__/app-machine.test.ts` for the new transitions.

**New side effect**:

1. Extend `EffectDeps` in `app-effects.ts` with the function signature.
2. Wire the real implementation in `realDeps` in `app-machine.ts`.
3. Mirror in `fakeDeps` / `makeDeps` in tests.

If the effect is part of `SETUP` (binary install, config seed), prefer adding it to a [pi extension bundle](./src/agent/README.md) instead. Bundles run inside `seedResources()` so each new third-party integration doesn't grow the EffectDeps surface.

## Agent singleton

`app-machine.ts` holds the single `Agent` instance. `getAgent()` is the only way the IPC layer reaches it. Lifecycle:

- `startAgent()` — constructs `new Agent({ ...opts, ports: getAgentPorts() })`, awaits `start()`, subscribes to events, starts the background delegation agent, and wires it to the delegation queue. On failure, fully tears down so a retry doesn't see a half-initialized singleton.
- `stopAgent()` — awaits `agent.stop()`, nulls the ref, stops the background delegation agent and the executor daemon.
- `newSession()` — `stop` + `start({ newSession: true })`. Opens a fresh pi session.

**Composition seam** — the lifecycle module (`lib/agent-lifecycle.ts`) builds the `AgentPorts` capability object (`{ executor }`) handed to agent extension bundles plus the injected bundled-resource location, and owns seed/login/teardown orchestration. `agent/` must never import the rest of the host — the boundary is lint-enforced (oxlint `no-restricted-imports` override); anything an extension needs flows through the ports. `app/agent-gateway.ts` (the single entry point for interactive agent commands) imports `getAgent` from `app-machine`, so the cycle is one-directional and needs no injection.

## Per-turn instrumentation

`handleAgentEvent` in `app-machine.ts` mirrors every pi event to the dev terminal (and to `~/.inteligir/logs/agent.log` — see `lib/agent-log.ts`) with an `[agent-event]` prefix, and tracks per-turn state in a `Turn` object. If a turn ends without any assistant text, tool call, or pi-emitted error, it emits a synthetic `turn_error { kind: "auth" }` event — the silent-empty-turn fallback for upstream failures that pi swallowed as success. The renderer's `ReauthDialog` listens on the same event.

## Bridge handlers

Domain-grouped under `handlers/` (one file per domain, composed by `handlers/register-handlers.ts`). Each group registers through the typed registrar (`lib/handler-registry.ts::collectHandlers`): the channel, TypeBox payload schema, and result type are looked up from the shared registry (`@repo/features/ipc-registry`), payloads are `Value.Check`-validated before the handler runs, and boot throws if any host-owned method is left unhandled. The registry's `UPDATE_METHODS` trio is deliberately absent — electron-updater is the desktop shell's overlay. Host → UI events use `events.ts::emitEvent`, keyed by the same registry — a renamed channel or changed payload shape is a compile error on both sides, and each shell's bridge is derived from the registry too.

## Other modules

- `vault/vault.ts` — the user's markdown vault (folder of files, watcher, `./vault` agent symlink).
- `knowledge/` — `knowledge-manager.ts` runs the pure engine from `@repo/features/knowledge` over vault events (incremental link graph, backlinks, lexical search); `rename-rewrite.ts` applies byte-surgical `[[link]]` rewrites across the vault on rename.
- `app/agent-gateway.ts` — the single entry point for interactive agent commands (a thin typed pass-through to the live agent).
- `app/inline-ai.ts` + `app/ghost-text.ts` — the editor-AI backends: intent classification/generation on a no-tools pi session, and ephemeral ghost-text completions on a fast model.
- `delegation/` — checkbox delegation: a versioned store + serialized queue (`delegation-manager.ts`) running tasks on a dedicated `background-agent.ts`; the target file is snapshotted before dispatch (newest 50 kept) so "Restore original" undoes an agent edit byte-exactly; `find-task-line.ts` is the pure checkbox locator.
- `executor/` — the MCP/connectors capability behind the executor daemon (integrations, OAuth flows, connection store).
- `voice/` — sherpa-onnx STT (`parakeet.ts`), model download, and the TTS proxy.
- `notifications.ts` — notification settings + message shaping (delivery goes through `platform.notify`).
- `secrets.ts` / `ui-state.ts` — cipher-backed secret store and persisted UI state (tabs, panes) shared across hosts.
- `app/session-history.ts` — reads recent pi messages from disk for UI history rehydration (one-shot per mount; no cache).
- `lib/` — shared helpers (agent lifecycle/ports, registry-keyed handler collection, TypeBox-validated JSON store with versioning/migrations, host pidfile lock, file-key cipher, agent-log tee).
