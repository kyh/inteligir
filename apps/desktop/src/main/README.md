# `main/` — Electron main process

Owns the app lifecycle, the agent singleton, IPC handlers, and the auto-updater. Everything here runs in the privileged Node process; renderer code talks to it only via IPC methods declared in the registry (`@repo/core/ipc-registry`).

## State machine — three-part split

The app has a hard-to-test mix of concerns: pure logic ("which phase do we transition to?"), side effects ("download the binary"), and orchestration ("queue events serially, broadcast after each step"). They live in three files:

```
app-reducer.ts    pure (state, event) → { next, effect } | null
app-effects.ts    impure runEffect(tag, deps): MachineEvent
app-machine.ts    glue: serialized queue + broadcast + injectable deps
```

**Why split:**

- `app-reducer.ts` has zero imports from Electron or the agent layer. Trivial to unit-test exhaustively (every state × event combination).
- `app-effects.ts` takes deps as an arg, so tests pass mocks. No singletons reached at runtime.
- `app-machine.ts` is the only file that wires real deps + broadcasts to renderer. Small surface to integration-test.

The reducer returns an `EffectTag` (a string), not the effect itself. The runner maps tags to operations. This keeps the reducer pure and lets the machine class swap in fake deps for tests.

## Adding to the machine

**New external event** (renderer-triggered):

1. Add to `AppEventSchema` in `shared/app-state.ts` (validates IPC payload).
2. Add a `case` in `app-reducer.ts` returning `{ next, effect }` — guard with the source phase.
3. If it triggers an effect, add the tag to `EffectTag` and a case in `runEffect`.

Internal events (`LOGIN_OK`/`LOGIN_FAIL`, `SETUP_OK`/`SETUP_FAIL`, `LOGOUT_OK`/`LOGOUT_FAIL`, `NEW_SESSION_OK`/`NEW_SESSION_FAIL`, `AGENT_START`/`AGENT_END`) are emitted only by the effect runner, never by the renderer. Each `*_FAIL` carries a `message`; the reducer routes it into the `error` phase, which records `prev` so `RETRY` knows where to resume.

**New phase**:

1. Add to `AppStateSchema` in `shared/app-state.ts`.
2. Update reducer guards (`state.phase !== "..."` checks) to include the new phase wherever it should accept events.
3. Add tests in `src/__tests__/app-machine.test.ts` for the new transitions.

**New side effect**:

1. Extend `EffectDeps` in `app-effects.ts` with the function signature.
2. Wire the real implementation in `realDeps` in `app-machine.ts`.
3. Mirror in `fakeDeps` / `makeDeps` in tests.

If the effect is part of `SETUP` (binary install, config seed), prefer adding it to a [pi extension bundle](../agent/README.md) instead. Bundles run inside `seedResources()` so each new third-party integration doesn't grow the EffectDeps surface.

## Agent singleton

`app-machine.ts` holds the single `Agent` instance. `getAgent()` is the only way the IPC layer reaches it. Lifecycle:

- `startAgent()` — constructs `new Agent({ ...opts, ports: getAgentPorts() })`, awaits `start()`, subscribes to events, starts the background delegation agent, and wires it to the delegation queue. On failure, fully tears down so a retry doesn't see a half-initialized singleton.
- `stopAgent()` — awaits `agent.stop()`, nulls the ref, stops the background delegation agent and the executor daemon.
- `newSession()` — `stop` + `start({ newSession: true })`. Opens a fresh pi session.

**Composition seam** — the lifecycle module (`lib/agent-lifecycle.ts`) builds the `AgentPorts` capability object (`{ executor }`) handed to agent extension bundles, and owns seed/login/teardown orchestration. `agent/` must never import `@/main/*` — the boundary is lint-enforced (oxlint `no-restricted-imports` override); anything an extension needs from main flows through the ports. `agent-gateway.ts` (the single entry point for interactive agent commands) imports `getAgent` from `app-machine`, so the cycle is one-directional and needs no injection.

## Per-turn instrumentation

`handleAgentEvent` in `app-machine.ts` mirrors every pi event to the dev terminal (and to `~/.inteligir/logs/agent.log` — see `lib/agent-log.ts`) with an `[agent-event]` prefix, and tracks per-turn state in a `Turn` object. If a turn ends without any assistant text, tool call, or pi-emitted error, it emits a synthetic `turn_error { kind: "auth" }` event — the silent-empty-turn fallback for upstream failures that pi swallowed as success. The renderer's `ReauthDialog` listens on the same event.

## IPC handlers

Domain-grouped across a few files:

- `index.ts::registerIpcHandlers()` — desktop, agent, app lifecycle, voice, notifications, UI state, executor, vault, delegation, skills, integrations.
- `vault-ipc.ts::registerVaultIpcHandlers()` — vault file ops (list/read/write/delete/rename).
- `executor-ipc.ts::registerExecutorIpcHandlers()` — executor daemon pass-throughs (integrations/connections/OAuth).

All registration goes through `lib/ipc-handler.ts::handle(method, fn)`: the channel, TypeBox payload schema, and result type are looked up from the shared registry (`@repo/core/ipc-registry`), and payloads are `Value.Check`-validated before the handler runs. Main → renderer events use `lib/broadcast.ts::broadcast`, keyed by the same registry — a renamed channel or changed payload shape is a compile error on both sides, and the preload bridge is derived from the registry too.

## Other modules

- `vault.ts` — the user's markdown vault (folder of files, watcher, `./vault` agent symlink).
- `agent-gateway.ts` — the single entry point for interactive agent commands (a thin typed pass-through to the live agent).
- `delegation/` — checkbox delegation: a versioned store + serialized queue (`delegation-manager.ts`) running tasks on a dedicated `background-agent.ts`; `find-task-line.ts` is the pure checkbox locator.
- `notifications.ts` — desktop notification settings + delivery.
- `session-history.ts` — reads recent pi messages from disk for renderer history rehydration (one-shot per renderer mount; no cache).
- `lib/` — shared helpers (agent lifecycle/ports, broadcast, registry-keyed IPC handler, TypeBox-validated JSON store with versioning/migrations, agent-log tee).
