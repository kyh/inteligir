# @repo/db

The local SQLite database: drizzle over better-sqlite3, the committed SQL
migrations applied on boot, and the row-level writers for threads, events,
queued messages, pending interactions and the sync outbox. Every write
announces through `@repo/domain`'s `DbNotifier`.

## Why it exists

One process opens this file — `inteligir serve` — and every durable fact
about a conversation lives in it. Keeping the writers here rather than inside
the server's services makes each one's concurrency claim a unit that runs
against a real file: "two writers never allocate the same sequence", "one
claimant per queued message", "a settle for a stale turn is a typed no-op".
The package sits BELOW the wire (`@repo/db` → `@repo/domain` only, pinned by
`tools/repo-guards/src/dep-dag.test.ts`): an edge to `@repo/api` would drag
hono and the contract's notes edge into a package that only writes rows. The
events, threads, queue and interaction writers are vendored from bb (MIT) and
carry its header.

## Layout

```
src/
  connection.ts       # createConnection (WAL, synchronous=NORMAL, foreign_keys, a
                      # 5s busy_timeout); writeTransaction — the ONE spelling of
                      # BEGIN IMMEDIATE; closeConnection, which checkpoints the -wal
  schema.ts           # the tables: meta, threads, events, queued_thread_messages,
                      # pending_interactions, sync_outbox, sync_state,
                      # sync_applied_captures — each constraint says why beside itself
  migrate.ts          # runMigrations: drizzle's migrator over drizzle/, foreign keys
                      # OFF around it and foreign_key_check after; returns the
                      # generation count, which IS the schema version
  migration-journal.ts, json-source.ts
                      # the journal parse; fields this package has no reading for
                      # ride through, so a rewrite drops nothing drizzle wrote
  meta.ts             # getSchemaVersion — refuses a file a NEWER build upgraded
  ids.ts              # createPrefixedId + the minters (thr_, evt_, turn_, qmsg_,
                      # pint_, obx_) over a 32-letter alphabet minus the look-alikes
  events.ts           # the append-only log: contiguous per-thread sequence, the
                      # turn/started gate, synced-origin dedupe, one prepared insert
  threads.ts          # thread rows, the lifecycle CAS, origin rebinding on rename,
                      # setThreadProviderSession
  queued-messages.ts  # FIFO per thread under claim tokens, released whole at boot
  pending-interactions.ts
                      # provider prompts, idempotent on (thread, requestKey)
  sync-outbox.ts      # the frozen-body outbox, the device_seq high-water, the pull
                      # cursor, the applied-capture ledger
  __tests__/          # real files under a temp dir; schema-agreement.test.ts is
                      # the migration↔schema pin
drizzle/              # the committed SQL migrations + drizzle-kit's journal/snapshots
drizzle.config.ts     # `pnpm --filter @repo/db db:generate` writes the next one
```

## Invariants

- **WAL + `synchronous=NORMAL`, on purpose.** No fsync per commit; a power
  loss can drop the last transactions and cannot corrupt the file. Pinned by
  `db.test.ts`. `auto_vacuum=INCREMENTAL` takes effect only on a brand-new
  file; an existing one converts on its next full VACUUM.
- **`writeTransaction` is the ONE spelling of `BEGIN IMMEDIATE`** (repo
  Decisions). The write lock is taken up front, so a read-then-write can never
  hit `SQLITE_BUSY` upgrading midway; `appendEvents` reads its high-water and
  inserts under it, which is what makes the unique index a backstop rather
  than the mechanism.
- **Migrations are committed SQL, applied on boot, and every generation bumps
  `meta.schema_version` to its own index.** The journal's entry count IS the
  version: `getSchemaVersion` refuses a file above it, because an older build
  opening a newer database applies nothing and would otherwise read a schema it
  does not know. Foreign keys are OFF around the migrator — the pragma is a
  silent no-op inside the transaction drizzle wraps each migration in, and a
  table rebuild's DROP would cascade-wipe the children — and
  `foreign_key_check` refuses the boot afterwards. The folder is a
  PARAMETER: the CLI resolves the source tree first and the staged
  `dist/drizzle` only where `@repo/db` cannot be resolved (`apps/cli/src/paths.ts`);
  this package never probes another package's layout. Never hand-edit a
  migration that shipped; `drizzle/0008_repair_schema_version.sql` is the one
  no-schema generation and says why it exists.
- **The migrations and `src/schema.ts` agree, and neither checks the other.**
  `schema-agreement.test.ts` migrates a scratch file, builds a second from
  `drizzle-kit export`'s DDL, and diffs `sqlite_master` with normalized SQL —
  table members sorted, index columns not, because column order inside an
  index is the index. A drift names the object and the fix.
- **An event's scope is enforced twice.** `threadEventSchema.parse` at the
  write applies the per-type scope policy, and `events_scope_shape_check`
  backstops it in SQL: turn scope ⇒ `turn_id` set, thread scope ⇒ null. Turn
  content before its `turn/started` is stored throws
  `MissingTurnStartedError`, and a batch rolls back whole — a bad tail never
  leaves a good head behind.
- **`events.sequence` is per-thread arrival order and is never renumbered.** A
  synced row also carries `(origin_device_id, origin_device_seq)` under its
  own unique index — keyed on the device's position, not the account-global
  `seq`, because signing in again resets the cursor and the same `seq` then
  names another account's row. SQLite treats nulls as distinct there, so
  locally written rows coexist. `appendSyncedEventsInTransaction` answers the
  rows that LANDED, not a count, so lifecycle projects over what landed.
- **The outbox stores the bytes it will send, once, at enqueue.** The log
  calls a position replayed with a different body `sync-conflict`, so
  re-serializing at push time is not a retry. `device_seq` is its own counter
  in `sync_state` — not `MAX()` over a queue that shrinks as pushes are acked,
  not `events.sequence` — allocated as ONE range per batch so a concurrent
  writer cannot interleave. No foreign key to `threads`: a cascade would drop
  a position the log's high-water has passed. The ack deletes through the
  pushed batch's own high-water, so an enqueue that landed mid-push survives.
  The row the contract refuses is left out of the push but stays inside that
  high-water, in `apps/cli/src/server/cloud/outbox.ts`, which reads this queue.
- **The lifecycle CAS names the turn.** `applyThreadLifecycleEvent` evaluates
  `@repo/domain`'s transition table, then updates only where status AND
  `active_turn_id` still match, so a settle validated against turn A cannot
  land after turn B bound. The loser is a typed `cas-conflict`, never a throw.
- **Notifications follow the write, never precede it.** Every writer takes a
  `DbNotifier` and announces after its own statement runs; a caller composing
  several writes in one transaction passes a `NotificationBuffer` and flushes
  after commit, so a subscriber never sees rolled-back state.
  `setThreadProviderSession` announces nothing on purpose: the provider
  session is runtime plumbing, not a fact a client renders.
- **A claim has no TTL, so boot releases them all.** One server owns a data
  dir, so no claim can be live at boot; `releaseAllQueuedMessageClaims` runs
  in `ThreadService.boot()` (`apps/cli/src/server/threads/service.ts`).

## Seams

- `DbNotifier` (`@repo/domain/notifier`) — the announcement port every writer
  takes. The server binds the `/ws` bus; `noopNotifier` is the test's.
- `DbTransaction` and the `*InTransaction` variants — how the server composes
  append, lifecycle projection, queue touch and outbox enqueue into ONE
  immediate transaction (`apps/cli/src/server/threads/service.ts`).
- `runMigrations(db, folder?)` — the staged-content seam the packaged CLI
  drives.

## Testing

`pnpm --filter @repo/db test` — vitest over real files in a temp dir
(`__tests__/open-temp-db.ts`, disposed with the test). Pinned: boot migrates
and bumps the version, upgrades a POPULATED v2 file in place with its child
rows and foreign keys intact, refuses a newer build's file, opens with WAL and
`synchronous=NORMAL`; contiguous sequences under interleaved writers, the
turn/started gate, the scope CHECK at the database, a 20-event burst prepares
two SELECTs and one INSERT; the lifecycle happy path and its typed no-ops,
`listThreads` answered from its partial indexes with no temp b-tree; FIFO
claims across connections and same-millisecond bursts; interaction
idempotency. `schema-agreement.test.ts` spawns `drizzle-kit`, so it carries
its own 30s budget.
