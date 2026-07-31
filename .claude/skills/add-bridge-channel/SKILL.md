---
name: add-bridge-channel
description: Add a channel to the Bridge — the host↔UI IPC contract behind every renderer and mobile call. Covers the registry entry in @repo/bridge, the host handler in @repo/server, the dev-harness fixture stub, event emission + reconnect hydration, and the remote-device allowlist decision. Use when a UI surface needs data or an action the host owns, or when host-side state must push to the UI.
allowed-tools: Bash(*), Read, Edit, Write
---

# Add a Bridge channel

The Bridge is the ONLY way the renderer (and the Expo companion) reaches the
host. `packages/bridge/src/ipc-registry.ts` is its single source of truth: each
entry pairs a TypeBox payload schema with a result/event type, and the `Bridge`
type, the ws transport's dispatch, and the host handler map are all DERIVED from
it. A channel is not "wired up" until three files agree, and the compiler
enforces all three.

## Read first

- `packages/bridge/src/ipc-registry.ts` — the registry, the entry helpers
  (`invoke` / `invokeVoid` / `send` / `event`), the method partitions, and the
  remote allowlists.
- `packages/server/src/handlers/handler-registry.ts` — `collectHandlers`, which
  validates payloads and throws at boot on a missing or duplicate handler.
- `apps/desktop/dev/fixture-bridge.ts` — the header's stub convention.
- CLAUDE.md § "Remote-device capability is an ALLOWLIST, never a blocklist".

## The four entry kinds

```ts
invoke<Schema, Result>(schema); // UI → host, payload, awaited result
invokeVoid<Result>(); // UI → host, no payload, awaited result
send<Schema>(schema); // UI → host, fire-and-forget (throws are swallowed + logged)
event<Payload>(); // host → UI push; no handler, emitted via emitEvent
```

Pick `invoke` unless the call genuinely has nothing to say back. Failure that
the UI must branch on is a **VALUE, not a throw** — `toggleVaultTask` returns
`{ok:false, reason}` because the host has already self-healed and the renderer
needs to know which refusal it hit. Reserve throws for programmer error.

## Files to touch

The worked example below is `toggleVaultTask` (invoke) and its sibling
`onKnowledgeUpdated` (event) — read them end to end in the tree; they are the
smallest complete pair.

### 1. Registry entry — `packages/bridge/src/ipc-registry.ts`

Schema near the other schemas, entry in the domain-grouped registry block.
`additionalProperties: false` on every object schema.

```ts
// Guarded task toggle — keyed by ORDINAL (delegation's anchor key; survives
// line shifts and duplicate identical lines) plus the exact recorded line.
const ToggleTaskSchema = Type.Object(
  {
    path: Type.String(),
    /** Position among the file's GFM task items (find-task-line's counting). */
    ordinal: Type.Number({ minimum: 0 }),
    /** The task's exact untrimmed source line (terminator excluded) as the
     * projection recorded it — the write proceeds only on byte equality. */
    expectedRaw: Type.String(),
  },
  { additionalProperties: false },
);

/** toggleVaultTask's verdict. Failures are VALUES, never throws: the host has
 * already kicked an index refresh, so the renderer refetches + toasts. */
export type ToggleTaskResult =
  | { ok: true; checked: boolean }
  | { ok: false; reason: "line-missing" | "line-changed" | "not-a-checkbox"; error: string };
```

```ts
  toggleVaultTask: invoke<typeof ToggleTaskSchema, ToggleTaskResult>(ToggleTaskSchema),
```

The doc comment on the entry is the channel's contract — the renderer author
reads it instead of the handler. Say what the host guarantees and what a
failure means.

### 2. Host handler — `packages/server/src/handlers/<domain>-handlers.ts`

One `register<Domain>Handlers(handle)` per domain file, all called from
`register-handlers.ts`. The registrar is per-method typed: the payload and
result types come from the registry, so a typo'd method name is a compile error.

```ts
export function registerKnowledgeHandlers(handle: HandlerRegistrar): void {
  handle("listVaultTasks", () => getKnowledgeManager().tasks());
  handle("toggleVaultTask", ({ path, ordinal, expectedRaw }): ToggleTaskResult => {
    ...
  });
}
```

Adding a whole new domain = a new `*-handlers.ts` plus one line in
`registerAllHandlers`. Reach host services through their `getX()` singletons
(`getVaultManager()`, `getKnowledgeManager()`) — that is the deliberate model,
not an omission (CLAUDE.md § "Host services are process-global `getX()`
singletons ON PURPOSE").

Two channels are NOT host-owned: `DESKTOP_SHELL_METHODS` (the `vault-app://`
token mint/revoke) are implemented by the Electron shell and passed to
`startWsHost` as `shellHandlers` (`apps/desktop/src/main/index.ts`). Only add
to that set when the handler must touch main-process state the host package
cannot see.

### 3. Fixture stub — `apps/desktop/dev/fixture-bridge.ts`

The harness's Bridge is typed `: Bridge`, so this file **fails typecheck until
the channel is covered**. The convention from its header:

> Make the stub DO something real against the in-memory state, or throw
> `unavailable("<feature>")` naming the gap. Never silently return
> `[]`/undefined/false where the real host would act — a stub that answers
> wrong is worse than an error that names itself.

The toggle stub runs the SAME pure core the host handler does, over the
in-memory vault:

```ts
    toggleVaultTask: async ({ path, ordinal, expectedRaw }) => {
      const content = vault.get(path);
      if (content === undefined) {
        return { ok: false, reason: "line-missing", error: `no such file: ${path}` };
      }
      const result = toggleTaskAtOrdinal(content, ordinal, expectedRaw);
      ...
    },
```

Events subscribe through the file's `Emitter`: `onKnowledgeUpdated:
knowledgeEvents.subscribe`.

### 4. The caller — renderer or mobile

Renderer code reaches the Bridge only through `getBridge()`
(`apps/desktop/src/renderer/lib/bridge.ts`); it never imports electron, node, or
`@repo/server` (lint-enforced, and the dep edge does not exist).

```ts
const result = await getBridge()
  .toggleVaultTask({ path: task.path, ordinal: task.ordinal, expectedRaw: task.raw })
  .catch(() => null);
```

Mobile needs no per-channel work: `apps/mobile` dials the same host through the
generic `createWsBridge`, so the derived `Bridge` type carries the new method
automatically — subject to the allowlist in step 6.

### 5. Events only — emit, and decide about hydration

Host code emits through `packages/server/src/events.ts`; the ws host subscribes
and fans out.

```ts
      () => emitEvent("onKnowledgeUpdated", {}),
```

If the event carries **state a late-joining client must not be stale about**,
pair it with the getter that answers the same shape in `HYDRATED_EVENTS`:

```ts
export const HYDRATED_EVENTS = {
  onRemoteAccessChanged: "getRemoteAccessState",
  onSyncStateChanged: "getSyncState",
  ...
} as const satisfies { readonly [E in EventMethod]?: HydrationGetter<E> };
```

`HydrationGetter<E>` proves the getter's result type EQUALS the event payload in
both directions, so the pair cannot drift. Pure invalidation pings
(`onKnowledgeUpdated`) need no entry — the client refetches anyway.

### 6. Remote-device allowlist — decide, and default to NO

`REMOTE_ALLOWED_METHODS` / `REMOTE_ALLOWED_EVENTS` are the ONLY things a paired
phone may reach. They are allowlists so a new channel is unreachable until
someone names it on purpose. **The default answer is: do not add it.** Adding
one is a deliberate act with a threat model attached — say in the PR why a
network-reachable device needs it, and remember the ws host enforces the lists at
three points (invoke/send dispatch, event broadcast, reconnect hydration).

## Rules

- Never widen a payload with `Type.Any()`. `Type.Unknown()` emits the same wire
  schema but forces the handler to narrow; `Any` puts a real `any` into the
  derived `Bridge` type and exempts every caller from the repo's no-any rule.
  See `BinaryAudioSchema` for the one place `unknown` is correct and why.
- Never renumber a `BINARY_CHANNELS` tag — those are wire values. Retire and
  take the next.
- Don't add a `dispatch.get(...)` or a fresh `authedSockets` loop in
  `ws-host.ts`. Route through `resolveHandler()` / `sendEvent()`; a second gate
  call site is how holes appear.
- Deleting a channel is also three files plus its callers — leave no orphan
  registry entry.
- Naming a channel in prose (a doc, this skill) counts as a CALLER to the
  dead-channel guard, which scans `docs/` and `.claude/` too. Don't write a
  channel's name into documentation to keep a test green.

## Verify

Static, narrow first:

```bash
pnpm --filter @repo/bridge typecheck    # registry compiles, derived Bridge type is sound
pnpm --filter @repo/desktop typecheck   # fixture-bridge covers the channel (dev/ is in tsconfig)
pnpm --filter @repo/server test         # handler completeness + gate guards
pnpm --filter @repo/bridge test         # ws protocol
```

`pnpm --filter @repo/server test` is the one that matters. It runs:

- `src/__tests__/register-handlers.test.ts` — the real handler groups cover
  exactly `HOST_METHODS`.
- `src/__tests__/handler-registry.test.ts` — the partitions add up
  (host + desktop-shell = every non-event method) and `collectHandlers` throws
  by name on a gap.
- `src/__tests__/no-dead-channels.test.ts` — every registry method has a caller
  outside the registry, the handlers dir, and the fixture.
- `src/transport/__tests__/no-ungated-dispatch.test.ts` — the remote gate still
  has exactly two chokepoints.
- `src/transport/__tests__/ws-transport.test.ts` — a real client over the real
  host.

Then drive it. Type-checks are not feature-correct:

```bash
pnpm --filter @repo/desktop dev:harness   # localhost:5173, fixture Bridge
```

…and for anything the fixture can only approximate, the real app —
`pnpm dev:desktop` then `agent-browser connect 9222`. Any Bridge method can be
called directly from `agent-browser eval` via `window.bridgeBootstrap`; see the
`e2e-drive` skill.

Before committing: `pnpm format:fix && pnpm verify` (format FIRST, never after).
