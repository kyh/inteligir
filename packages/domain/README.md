# @repo/domain

The zod-only leaf: the thread grammar every wire in the product carries, and
the vocabulary the write layer announces change through. The desktop renderer,
the local server, the cloud page planner and the phone all parse the same
event with it, so it holds schemas and pure tables and nothing else — no node,
no db, no transport, no React.

## Why it exists

A thread event is written by the local server, replayed by the renderer,
pushed through the Worker's merged log and pulled back down by another device,
and every one of those parses it at its own boundary. One grammar in one
package with one runtime dependency is what makes that the same parse on every
target. The leaf-ness is held by `tools/repo-guards/src/dep-dag.test.ts` three
ways — `@repo/domain` is declared with no outgoing edge, its purity rule
forbids node/react/electron imports, and the zod-only-leaf check refuses any
`dependencies` entry but `zod`, because a second runtime dep here ships to
every consumer — and by `tsconfig.json` (`ES2023`, `types: []`), so a node
global is a type error before it is a lint error.

Consumers: `@repo/db`, `@repo/api`, `@repo/agent-runtime`, the CLI server,
the desktop renderer, and `apps/mobile`, whose synced log is stored as this
package's `ThreadEvent`.

## Layout

```
src/
  thread-status.ts       # idle|starting|active|stopping|error as ONE tuple —
                         # the drizzle enum column and the wire schema both
                         # read it, so a status cannot exist on one side only
  thread-lifecycle.ts    # THREAD_LIFECYCLE: (status, event) → status as data.
                         # `evaluateThreadLifecycleEvent` checks supersession
                         # and turn identity BEFORE the table so a stale event
                         # reports its true diagnosis (superseded | stale-turn |
                         # illegal-transition). stop intent is the `stopping`
                         # status, not a side field, and `stopping` has no
                         # run.started cell: a queued turn cannot reactivate it
  provider-event.ts      # the PERSISTED ThreadEvent grammar, despite the name:
                         # seven item kinds, twelve event types, scope refined
                         # at parse. `client/turn/requested` carries the
                         # optional viewContext beside bb's `text`
  thread-event-scope.ts  # thread | turn scope, and the per-type policy table
                         # (`satisfies` keeps it total: a new type without a
                         # row stops compiling; anything looser than turn
                         # scope states its rationale in the row)
  view-context.ts        # the screen a message left from: `doc` + path +
                         # sha-256 revision. a single-member discriminatedUnion
                         # so a second surface breaks every consumer at compile
  pending-interactions.ts  # the provider-neutral approval grammar — subjects
                         # (command | file_change), decisions, payload,
                         # resolution — and `parseApprovalResolution`, the ONE
                         # parser the answer route's 400 gate and the runtime
                         # share (deny is always accepted; anything else must
                         # be a decision the request offered)
  pending-interaction-status.ts  # pending|resolving|resolved|interrupted, the
                         # same tuple-feeds-both-sides shape as thread-status
  change-kinds.ts        # the invalidation vocabulary: vault, doc and thread
                         # change kinds — pings naming a subscription target,
                         # never payloads
  notifier.ts            # DbNotifier, the seam writes announce through;
                         # NotificationBuffer queues deliveries and `flushTo`
                         # runs them AFTER commit, so no subscriber sees
                         # rolled-back state or re-enters the db mid-transaction
```

Every subpath is exported by name in `package.json`; there is no barrel.

## Invariants

- **Two grammars share the word "event"; only this one is durable.**
  `@repo/agent-runtime/vocabulary/provider-event` is what a provider adapter
  may EMIT; `provider-event.ts` here is what the `events` table STORES and a
  client replays. `apps/cli/src/server/agents/event-mapping.ts` is the one
  place that narrows the first onto the second — a kind with no persisted
  counterpart is dropped with a reason, never re-shaped. The shared leaves
  (file change, item status, scope) are one type here so a narrowing assigns
  them; a field-by-field respelling would mean the two had drifted. A shape bb
  already names is re-vendored from bb, not invented.
- **Scope is enforced twice, on purpose.** `threadEventSchema` refuses a
  turn-only event under thread scope, and a turn scope with no id, at parse;
  the `events_scope_shape_check` CHECK in
  `packages/db/drizzle/0001_early_tana_nile.sql` refuses the same row at
  insert. A turn-scoped row with no turn id is a row no query can place.
- **The lifecycle is a table, and the db applies it under a CAS.**
  `packages/db/src/threads.ts` evaluates the event here, then updates only
  where the status AND the active turn id still match what it read, so a
  settle validated against turn A cannot land after turn B bound.
- **Vendored from bb, and the header says so.** Every file that came from bb
  keeps `// Vendored from bb (github.com/get-bb/bb), MIT.` on its first line;
  the licence text is `tools/licenses/bb.LICENSE`; `view-context.ts` is this
  repo's own. Rename, trim and restructure freely — the attribution line is
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
  `packages/api/src/local/notifications.ts` reads them, and the repo guard's
  ws-reachability test holds every kind to a producer and a consumer.
- `threadEventSchema` is what the cloud page planner
  (`packages/api/src/cloud/sync/plan-page.ts`) re-parses every pulled row
  through before it may move a cursor.

## Testing

`pnpm --filter @repo/domain test` — vitest. `provider-event.test` pins the
scope refusals at parse, the either-scope `provider/error`, a streamed item's
round trip, and that a delta's item ref invents no kind.
`thread-lifecycle.test` fuzzes random event sequences inside the declared
statuses and turn-binding invariants: every absent cell is an
`illegal-transition` no-op, a settle naming another turn is `stale-turn`, an
archived thread supersedes new work before the table is consulted, `stopping`
cannot dispatch, and every reachable status can reach `idle` again.
