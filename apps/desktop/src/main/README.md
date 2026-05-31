# `main/` — Electron main process

Owns the app lifecycle, the agent singleton, IPC handlers, and the auto-updater. Everything here runs in the privileged Node process; renderer code talks to it only via IPC channels declared in `shared/ipc.ts`.

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

**New phase**:

1. Add to `AppStateSchema` in `shared/app-state.ts`.
2. Update reducer guards (`state.phase !== "..."` checks) to include the new phase wherever it should accept events.
3. Add tests in `__tests__/app-machine.test.ts` for the new transitions.

**New side effect**:

1. Extend `EffectDeps` in `app-effects.ts` with the function signature.
2. Wire the real implementation in `realDeps` in `app-machine.ts`.
3. Mirror in `fakeDeps` / `makeDeps` in tests.

If the effect is part of `SETUP` (binary install, config seed), prefer adding it to a [pi extension bundle](../agent/README.md) instead. Bundles run inside `seedResources()` so each new third-party integration doesn't grow the EffectDeps surface.

## Agent singleton

`app-machine.ts` holds the single `Agent` instance. `getAgent()` is the only way the IPC layer reaches it. Lifecycle:

- `startAgent()` — constructs `new Agent(opts)`, awaits `start()`, restores persisted active tools, subscribes to events. On failure, fully tears down so a retry doesn't see a half-initialized singleton.
- `stopAgent()` — awaits `agent.stop()`, nulls the ref, stops the task scheduler.
- `newSession()` — `stop` + `start({ newSession: true })`. Clears cached history before opening a fresh pi session.

## IPC handlers

Live in `index.ts`. Two helpers:

- `createIpcHandler(channel, schema, handler)` — Zod-validated input.
- `createVoidIpcHandler(channel, handler)` — no input.

All channel constants live in `shared/ipc.ts`. Renderer + preload share the same `IPC_CHANNELS` source of truth.

## Other modules

- `active-tools.ts` — persists which extension tools the user has enabled.
- `notifications.ts` — desktop notification settings + delivery.
- `session-history.ts` — reads and caches recent pi messages for renderer history.
- `tasks/` — scheduled task manager (cron/interval/once); the tasks pi extension wraps it.
- `lib/` — shared helpers (broadcast, IPC handler factory, JSON store).
