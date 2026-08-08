---
name: add-bridge-channel
description: Add a channel to the Bridge — the host↔UI contract behind every workspace call. Covers the registry entry in @repo/bridge, the handler in the UserHost Durable Object, the fixture-Bridge stub, event emission + reconnect hydration, and the client-class allowlist decision. Use when a UI surface needs data or an action the host owns, or when host-side state must push to the UI.
allowed-tools: Bash(*), Read, Edit, Write
---

# Add a Bridge channel

**Write the entry, then let the compiler drive.** Three of the four edits are
compile errors until you make them, and they arrive in the order you should do
them. Nothing is pinned by hand — there is no method list to append to and no
count to bump.

```
1. registry entry  →  packages/bridge/src/ipc-registry.ts
2. grant-table row →  packages/bridge/src/agent-grants.ts     (compile error names the method)
3. fixture stub    →  packages/workspace/src/dev/fixture-bridge.ts
4. host handler    →  apps/web/src/worker/**/<domain>-handlers.ts
5. the caller      →  the surface that needed it
```

Step 4 is not a type error — it is a construction throw
(`host handlers missing for: yourMethod`), so the object refuses to boot and
`@repo/web`'s suite fails naming it. Step 5 is the one thing no type can see: a
channel with no CALLER anywhere in the repo fails `no-dead-channels`
(`tools/repo-guards`).

## The IPC seam is four files

| file                | what it is                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `ipc-entry.ts`      | the four channel kinds + their constructors                                                        |
| `ipc-registry.ts`   | **the table** — one row per channel, and nothing else                                              |
| `ipc-contract.ts`   | the machinery derived from it (`Bridge`, `HostMethod`, `IpcHandler`, `IpcEvent`); names no channel |
| `channel-policy.ts` | the three per-channel opt-ins the compiler cannot ask for                                          |

## 1. The registry entry

```ts
invoke<Schema, Result>(schema); // → host, payload, awaited result
invokeVoid<Result>(); // → host, no payload, awaited result
send<Schema>(schema); // → host, fire-and-forget (throws swallowed + logged)
event<Payload>(); // host → client push; no handler
```

Pick `invoke` unless the call genuinely has nothing to say back. Failure the UI
must branch on is a **VALUE, not a throw** — `toggleVaultTask` returns
`{ok:false, reason}` because the host has already self-healed and the UI needs
to know which refusal it hit. Reserve throws for programmer error.

**Payload schemas and result types do not live in the registry.** Put them in
the module that owns the concept — `vault.ts`, `knowledge.ts`, `skills.ts`,
`delegation.ts`, `agent-actions.ts`, `voice.ts`, … — and import them into the
row. `additionalProperties: false` on every object schema. Never
`Type.Any()`: `Type.Unknown()` emits the same wire schema but forces the handler
to narrow, where `Any` puts a real `any` into the derived `Bridge` type and
exempts every caller from the repo's no-any rule (`BinaryAudioSchema` is the one
place `unknown` is right, and says why).

The doc comment on the row is the channel's contract — the UI author reads it
instead of the handler. Say what the host guarantees and what a failure means.

## 2. The grant-table row — the compiler will ask

`agent-grants.ts` stops compiling with
`Type 'true' is not assignable to type '"yourNewMethod"'` until the method
carries a row. That error IS the question "may the agent do this?", and the
usual answer is an `AGENT_NEVER_GRANTED` group whose `why` already fits. A GRANT
is a separate implementation host-side in `agent-tools.ts` — never the handler
you are about to write, which is written for a person looking at their own
vault. Events need nothing: both tables are typed `HostMethod`.

## 3. The fixture stub

The fixture Bridge is typed `: Bridge`, so it fails typecheck until covered.
From its own header:

> Make the stub DO something real against the in-memory state, or throw
> `unavailable("<feature>")` naming the gap. Never silently return
> `[]`/undefined/false where the real host would act — a stub that answers wrong
> is worse than an error that names itself.

Events subscribe through the file's `Emitter`
(`onKnowledgeUpdated: knowledgeEvents.subscribe`).

## 4. The host handler

One `register<Domain>Handlers(handle, services)` per domain file, all called
from `host/handlers.ts`. Services arrive as ARGUMENTS. There are no `getX()`
singletons here and there must not be: one isolate serves many users, so a
module-level instance is a cross-tenant bug (CLAUDE.md § "Nothing is module
scope. Ever.").

```ts
handle("toggleVaultTask", async ({ path, ordinal, expectedRaw }): Promise<ToggleTaskResult> => {
  const text = await vault.readText(path);
  ...
});
```

**Every channel is answered for real.** There is no shim table and no "not
available yet" registration: a method that answers only by refusing satisfies
both the completeness check and `no-dead-channels` while failing at runtime. So
adding the channel is the LAST step of building the capability, and retiring one
deletes it. `unavailable()` is for a CONDITION a real handler can be in (no AI
provider configured), never for a whole channel.

## 5. Events — emit, and answer the hydration question

Host code emits through the `HostEvents` bus (`host/host-events.ts`), an
INSTANCE handed in with the services — a module-level listener set would fan one
user's events onto another user's sockets.

```ts
services.events.emit("onKnowledgeUpdated", {});
```

## The three judgement calls — `channel-policy.ts`

These are the only decisions left to you, and none of them can be a compile
error, because **the default answer to each is NO and the default is the safe
one.** Unnamed means unreachable from a companion, never re-pushed on reconnect,
framed as JSON. Open the file, answer all three, move on.

1. **`REMOTE_ALLOWED_METHODS` / `_EVENTS` — default: do not add it.** These are
   the ONLY things a companion client may reach. Allowlists, so a new channel is
   unreachable until someone names it on purpose. Adding one is a deliberate act
   with a threat model attached — say in the PR why a companion needs it, and
   remember the host enforces the lists at three points (invoke/send dispatch,
   event broadcast, reconnect hydration).
2. **`HYDRATED_EVENTS` — only for an event whose payload IS state.** Pair it
   with the getter answering the same shape; `HydrationGetter<E>` proves the
   pair in both directions, so it cannot drift. A pure invalidation ping
   (`onKnowledgeUpdated`) needs no entry — the client refetches anyway.
3. **`BINARY_CHANNELS` — only for raw bytes at streaming rates.** Tags are wire
   values: **never renumber one.** Retire it and take the next.

## Rules

- Don't add a `dispatch.get(...)` or a fresh socket loop anywhere. Route through
  `SocketGate`'s `resolve()` / `push()` (`host/socket-gate.ts`); a second gate
  call site is how holes appear, and `no-ungated-dispatch.test.ts` fails when
  one shows up.
- Deleting a channel is the same edits in reverse, plus its callers.
- Naming a channel in prose counts as a CALLER to the dead-channel guard, which
  scans `docs/` and `.claude/` too — so don't write a channel's name into
  documentation to keep a test green. The two blueprint skills (this one and
  `add-editor-node`) are the exception: the guard excludes them as SUPPLY,
  precisely so a worked example cannot prop a dead channel up.

## Verify

```bash
pnpm typecheck                       # steps 1-3: all three are compile errors
pnpm --filter @repo/web test         # step 4: the object refuses to construct
pnpm --filter @repo/repo-guards test # step 5: a real caller exists
```

Then drive it. Type-checks are not feature-correct: `pnpm dev:web`, then
`agent-browser open http://localhost:5174/app`. Any Bridge method can be called
straight from `agent-browser eval` — the snippet is in `docs/e2e-driving.md`.

Before committing: `pnpm format:fix && pnpm verify` (format FIRST, never after).
