---
name: add-bridge-channel
description: Add a channel to the Bridge — the host↔UI contract behind every workspace call. Covers the registry entry in @repo/bridge, the handler in the UserHost Durable Object, the fixture-Bridge stub, event emission + reconnect hydration, and the client-class allowlist decision. Use when a UI surface needs data or an action the host owns, or when host-side state must push to the UI.
allowed-tools: Bash(*), Read, Edit, Write
---

# Add a Bridge channel

The Bridge is the ONLY way the workspace reaches the host.
`packages/bridge/src/ipc-registry.ts` is its single source of truth: each entry
pairs a TypeBox payload schema with a result/event type, and the `Bridge` type,
the socket's dispatch, and the host handler map are all DERIVED from it. A
channel is not "wired up" until three files agree, and the compiler enforces all
three.

## Read first

- `packages/bridge/src/ipc-registry.ts` — the registry, the entry helpers
  (`invoke` / `invokeVoid` / `send` / `event`), the method partitions, and the
  client-class allowlists.
- `apps/web/src/worker/host/handler-registry.ts` — `collectHandlers`, which
  validates payloads and throws at boot on a missing or duplicate handler.
- `packages/workspace/src/dev/fixture-bridge.ts` — the header's stub convention.
- CLAUDE.md § "Client capability is an ALLOWLIST, never a blocklist".

## The four entry kinds

```ts
invoke<Schema, Result>(schema); // UI → host, payload, awaited result
invokeVoid<Result>(); // UI → host, no payload, awaited result
send<Schema>(schema); // UI → host, fire-and-forget (throws are swallowed + logged)
event<Payload>(); // host → UI push; no handler, emitted via emitEvent
```

Pick `invoke` unless the call genuinely has nothing to say back. Failure that
the UI must branch on is a **VALUE, not a throw** — `toggleVaultTask` returns
`{ok:false, reason}` because the host has already self-healed and the UI
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
 * already kicked an index refresh, so the client refetches + toasts. */
export type ToggleTaskResult =
  | { ok: true; checked: boolean }
  | { ok: false; reason: "line-missing" | "line-changed" | "not-a-checkbox"; error: string };
```

```ts
  toggleVaultTask: invoke<typeof ToggleTaskSchema, ToggleTaskResult>(ToggleTaskSchema),
```

The doc comment on the entry is the channel's contract — the UI author
reads it instead of the handler. Say what the host guarantees and what a
failure means.

### 2. Host handler — `apps/web/src/worker/<domain>/<domain>-handlers.ts`

One `register<Domain>Handlers(handle, services)` per domain file, all called
from `host/handlers.ts`. The registrar is per-method typed: the payload and
result types come from the registry, so a typo'd method name is a compile error.

```ts
export function registerKnowledgeHandlers(
  handle: HandlerRegistrar,
  knowledge: UserKnowledge,
  vault: UserVault,
): void {
  handle("listVaultTasks", () => knowledge.tasks());
  handle("toggleVaultTask", ({ path, ordinal, expectedRaw }): ToggleTaskResult => {
    ...
  });
}
```

Services arrive as ARGUMENTS, from the Durable Object that constructed them.
There are no `getX()` singletons here and there must not be: one isolate serves
many users, so a module-level instance is a cross-tenant bug (CLAUDE.md § "One
host per user is a Durable Object").

A method with no implementation yet is registered as a SHIM naming the gap
(`CLOUD_SHIMS` for the backlog, `CLOUD_RETIRED` for a decision) — never a silent
`[]`.

### 3. Fixture stub — `packages/workspace/src/dev/fixture-bridge.ts`

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

### 4. The caller — the workspace

UI code reaches the Bridge only through `getBridge()` (`@repo/bridge/client`);
nothing under `packages/` may import node or electron at all, which is what
keeps the same code running in a browser and in React Native.

```ts
const result = await getBridge()
  .toggleVaultTask({ path: task.path, ordinal: task.ordinal, expectedRaw: task.raw })
  .catch(() => null);
```

### 5. Events only — emit, and decide about hydration

Host code emits through `host/host-events.ts`; the object subscribes and fans
out to every socket the class gate allows.

```ts
      () => emitEvent("onKnowledgeUpdated", {}),
```

If the event carries **state a late-joining client must not be stale about**,
pair it with the getter that answers the same shape in `HYDRATED_EVENTS`:

```ts
export const HYDRATED_EVENTS = {
  onAccountStateChanged: "getAccountState",
  onAppState: "getAppState",
  ...
} as const satisfies { readonly [E in EventMethod]?: HydrationGetter<E> };
```

`HydrationGetter<E>` proves the getter's result type EQUALS the event payload in
both directions, so the pair cannot drift. Pure invalidation pings
(`onKnowledgeUpdated`) need no entry — the client refetches anyway.

### 6. Client-class allowlist — decide, and default to NO

`REMOTE_ALLOWED_METHODS` / `REMOTE_ALLOWED_EVENTS` are the ONLY things a
companion client may reach. They are allowlists so a new channel is unreachable
until someone names it on purpose. **The default answer is: do not add it.**
Adding one is a deliberate act with a threat model attached — say in the PR why
a companion needs it, and remember the host enforces the lists at three points
(invoke/send dispatch, event broadcast, reconnect hydration).

### 7. The agent grant table — mandatory, and usually a denial

Every non-event channel must appear exactly once across `AGENT_GRANTS` ∪
`AGENT_NEVER_GRANTED` (`packages/bridge/src/agent-grants.ts`), enforced by
`packages/bridge/src/__tests__/agent-grants.test.ts`. Adding the row is the
moment "may the agent do this?" gets asked, and the usual answer is a
never-granted group whose `why` already fits. A GRANT is a separate
implementation host-side in `agent-tools.ts` — never the handler you just
wrote, which is written for a person looking at their own vault.

## Rules

- Never widen a payload with `Type.Any()`. `Type.Unknown()` emits the same wire
  schema but forces the handler to narrow; `Any` puts a real `any` into the
  derived `Bridge` type and exempts every caller from the repo's no-any rule.
  See `BinaryAudioSchema` for the one place `unknown` is correct and why.
- Never renumber a `BINARY_CHANNELS` tag — those are wire values. Retire and
  take the next.
- Don't add a `dispatch.get(...)` or a fresh socket loop in `user-host.ts`.
  Route through `resolveHandler()` / `sendEvent()`; a second gate call site is
  how holes appear, and `no-ungated-dispatch.test.ts` fails when one shows up.
- Deleting a channel is also three files plus its callers — leave no orphan
  registry entry.
- Naming a channel in prose (a doc, this skill) counts as a CALLER to the
  dead-channel guard, which scans `docs/` and `.claude/` too. Don't write a
  channel's name into documentation to keep a test green.

## Verify

Static, narrow first:

```bash
pnpm --filter @repo/bridge typecheck      # registry compiles, derived Bridge type is sound
pnpm --filter @repo/workspace typecheck   # the fixture Bridge covers the channel
pnpm --filter @repo/web test              # handler completeness + gate guards
pnpm --filter @repo/bridge test           # ws protocol + grant-table completeness
pnpm --filter @repo/repo-guards test      # no dead channels
```

`pnpm --filter @repo/web test` is the one that matters. It runs:

- `src/worker/__tests__/host-handlers.test.ts` — the registered map is exactly
  `HOST_METHODS`, the implemented/pending/retired split adds up, and every shim
  refuses by naming its gap.
- `src/worker/__tests__/no-ungated-dispatch.test.ts` — the class gate still has
  exactly two chokepoints.
- `src/worker/__tests__/user-host.test.ts` — a real client over the real object.

Then drive it. Type-checks are not feature-correct: `pnpm dev:web`, then
`agent-browser open http://localhost:5174/app`. Any Bridge method can be called
straight from `agent-browser eval` — the snippet is in `docs/e2e-driving.md`.

Before committing: `pnpm format:fix && pnpm verify` (format FIRST, never after).
