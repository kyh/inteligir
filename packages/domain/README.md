# @repo/domain

The zod-only leaf: the thread grammar every wire in the product carries, and
the vocabulary the write layer announces change through. The workspace UI,
the local server and the agent runtime's host all parse the same event with
it, so it holds schemas and pure tables and nothing else — no node,
no db, no transport, no React.

## Why it exists

A thread event is written by the local server, stored in its database and
replayed by the page, and each of those parses it at its own boundary. One grammar in one
package with one runtime dependency is what makes that the same parse on every
target. The leaf-ness is held by `tools/repo-guards/src/dep-dag.test.ts` —
`@repo/domain` is declared with no outgoing edge, only `@repo/workspace`
reaches `@tauri-apps`, and the zod-only-leaf check refuses any `dependencies`
entry but `zod`, because a second runtime dep here ships to every consumer —
by `oxlint.config.ts`, which refuses its source a node or react import, and by
`tsconfig.json` (`ES2023`, `types: []`), so a node global is a type error
before it is a lint error.

Consumers: `@repo/db`, `@repo/contract`, `@repo/agent-runtime`, the CLI server
and the workspace UI. The phone holds no thread, so it reaches none of it.

## Layout

```
src/
  harness.ts                     # the harness ids the wire takes, and their names
  agent-shell-env.ts             # the thread-id env var the runtime sets and the CLI reads
  thread-status.ts               # the one status tuple the db column and the wire share
  thread-lifecycle.ts            # (status, event) → status, as data
  provider-event.ts              # the PERSISTED ThreadEvent grammar, despite the name
  thread-event-scope.ts          # the thread and turn scopes an event type names
  view-context.ts                # the screen a message left from
  thread-title.ts                # a thread's name from its first message, and its bound
  quote-selection.ts             # the one way a selection is quoted to the agent
  pending-interactions.ts        # the provider-neutral approval grammar
  pending-interaction-status.ts  # the interaction status tuple, shared like thread-status
  change-kinds.ts                # the invalidation vocabulary: pings, never payloads
  notifier.ts                    # DbNotifier, the seam a write announces through
```

Every subpath is exported by name in `package.json`; there is no barrel.

## Invariants

- **Two grammars share the word "event"; only this one is durable.**
  `@repo/agent-runtime/vocabulary/provider-event` is what a provider adapter
  may EMIT; `provider-event.ts` here is what the `events` table STORES and a
  client replays. `apps/cli/src/server/agents/runtime-manager.ts` is the one
  place that narrows the first onto the second, every kind the mapper emits but
  an adapter's notice, which the turn driver writes to the agent log instead;
  nothing is re-shaped. The shared leaves (file change, item status,
  scope) are one type here so a narrowing assigns them; a field-by-field
  respelling would mean the two had drifted. A shape bb already names is
  re-vendored from bb, not invented.
- **Scope is enforced twice, on purpose.** `threadEventSchema` refuses a
  turn-only event under thread scope, and a turn scope with no id, at parse;
  the `events_scope_shape_check` CHECK in `packages/db/src/schema.ts` refuses
  the same row at insert. A turn-scoped row with no turn id is a row no query can place.
- **The lifecycle is a table, and the db applies it under a CAS.**
  `packages/db/src/threads.ts` evaluates the event here, then updates only
  where the status AND the active turn id still match what it read, so a
  settle validated against turn A cannot land after turn B bound.
- **Vendored from bb, and the header says so.** Every file that came from bb
  keeps `// Vendored from bb (github.com/get-bb/bb), MIT.` on its first line;
  the licence text is `tools/licenses/bb.LICENSE`; `view-context.ts`,
  `thread-title.ts` and `quote-selection.ts` are this repo's own. Rename, trim and restructure freely — the attribution line is
  the one thing a vendored file must keep.
- **A view context rides the message.** Never a thread column, never a
  mutable "current view": it describes the screen a message left from, so
  nothing reconciles it on navigation. The durable binding is the thread's
  `originDocPath`, a different thing (`CONTEXT.md`, "view context vs thread
  origin").

## Seams

- `DbNotifier` (`notifier.ts`) — the port, with `noopNotifier` for a caller
  with nothing listening. `apps/cli/src/server/threads/service.ts` builds a
  `NotificationBuffer` per ingest transaction and flushes it after the commit.
- The change-kind tuples are the `/ws` bus's whole vocabulary:
  `packages/contract/src/local/notifications.ts` reads them, and the repo guard's
  ws-reachability test holds every kind to a producer in shipped source and
  every fired kind to the declaration; nothing checks that a client consumes
  a kind.

## Testing

`pnpm --filter @repo/domain test` — vitest. That a coalesced stream folds to
the same rows is fuzzed where the fold is reachable,
`apps/cli/src/server/agents/event-coalescer.test.ts`.
