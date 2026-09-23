# @repo/db

The local SQLite database: drizzle over better-sqlite3, the committed SQL
migrations applied on boot, and the row-level writers for threads, events,
queued messages, pending interactions and the sync outbox. A standalone write
announces through `@repo/domain`'s `DbNotifier`; a write composed into the
server's transaction is announced by its composer after the commit.

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
                      # BEGIN IMMEDIATE; closeConnection, which hands free pages
                      # back and checkpoints the -wal
  schema.ts           # the tables: meta, threads, events, queued_thread_messages,
                      # pending_interactions, sync_outbox, sync_state,
                      # sync_applied_captures, sync_own_devices — each constraint
                      # says why beside itself
  migrate.ts          # runMigrations: drizzle's migrator over drizzle/, foreign keys
                      # OFF around it and foreign_key_check after; returns the
                      # migration-folder count, which IS the schema version
  meta.ts             # getSchemaVersion — refuses a file a NEWER build upgraded
  ids.ts              # createPrefixedId + the minters (thr_, evt_, turn_, qmsg_,
                      # pint_, obx_) over a 32-letter alphabet minus the look-alikes
  events.ts           # the append-only log: contiguous per-thread sequence, the
                      # turn/started gate, synced-origin dedupe, one prepared insert
  threads.ts          # thread rows, the lifecycle CAS, origin rebinding on rename (one
                      # transaction per rename), setThreadProviderSession
  queued-messages.ts  # FIFO per thread under claim tokens, released whole at boot
  pending-interactions.ts
                      # provider prompts, idempotent on (thread, requestKey)
  sync-outbox.ts      # the frozen-body outbox, the device_seq high-water, the pull
                      # cursor, the applied-capture ledger, the own device ids
  __tests__/          # real files under a temp dir; schema-agreement.test.ts is
                      # the migration↔schema pin (reading sqlite_master through
                      # json-source.ts), legacy-migrations-table.test.ts the
                      # pre-1.0 __drizzle_migrations upgrade
drizzle/              # the committed SQL migrations, one folder per generation:
                      # <yyyymmddhhmmss>_<name>/migration.sql + drizzle-kit's snapshot.json
drizzle.config.ts     # `pnpm --filter @repo/db db:generate` writes the next one
```

## Invariants

- **WAL + `synchronous=NORMAL`, on purpose.** No fsync per commit; a power
  loss can drop the last transactions and cannot corrupt the file. Pinned by
  `db.test.ts`. `auto_vacuum=INCREMENTAL` takes effect only on a brand-new
  file; an existing one converts on its next full VACUUM. It only marks a
  deleted row's pages free: `closeConnection` runs `incremental_vacuum` before
  the close to hand them back, best effort, so a crash or a file another writer
  holds leaves them for the next clean close.
- **`writeTransaction` is the ONE spelling of `BEGIN IMMEDIATE`** (repo
  Decisions). The write lock is taken up front, so a read-then-write can never
  hit `SQLITE_BUSY` upgrading midway; `appendEventsInTransaction` reads its
  high-water and inserts under the caller's, which is what makes the unique
  index a backstop rather than the mechanism.
- **Migrations are committed SQL, applied on boot, and every generation bumps
  `meta.schema_version` to its own index.** The migration-folder count IS the
  version: `getSchemaVersion` refuses a file above it, because an older build
  opening a newer database applies nothing and would otherwise read a schema it
  does not know. Foreign keys are OFF around the migrator — the pragma is a
  silent no-op inside the transaction drizzle wraps each migration in, and a
  table rebuild's DROP would cascade-wipe the children — and
  `foreign_key_check` refuses the boot afterwards. The folder is a
  PARAMETER: the CLI resolves the source tree first and the staged
  `dist/drizzle` only where `@repo/db` cannot be resolved (`apps/cli/src/paths.ts`);
  this package never probes another package's layout. Never hand-edit a
  migration that shipped; `drizzle/20260822060000_repair_schema_version/migration.sql`
  is the one no-schema generation and says why it exists. The migrator keys the
  applied set on the folder name; a file the pre-1.0 migrator wrote (a
  `__drizzle_migrations` with no `name` column) is upgraded in place on the
  first boot, each row matched to its folder by created_at, and
  `legacy-migrations-table.test.ts` boots exactly such a file.
- **The migrations and `src/schema.ts` agree, and neither checks the other.**
  `schema-agreement.test.ts` migrates a scratch file, builds a second from
  `drizzle-kit export`'s DDL, and diffs `sqlite_master` with normalized SQL —
  table members sorted, index columns not, because column order inside an
  index is the index, and drizzle-kit 1.0's spelling of a primary key, a
  foreign key and a CHECK folded to the one the shipped migrations carry,
  which its own `generate` reads as no change. A drift names the object and
  the fix.
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
- **A sign-out forgets the positions, never the device ids.** `resetSyncState`
  clears the outbox, both positions and the capture ledger in one transaction,
  and keeps `sync_own_devices`: the log still holds rows under every id this
  install signed in as, and the install holds those events locally with a
  null origin, which `events_origin_idx` cannot match. A pull skips a row under any
  of those ids; forgetting one doubles everything written under it.
- **The lifecycle CAS names the turn.**
  `applyThreadLifecycleEventInTransaction` evaluates `@repo/domain`'s
  transition table, then updates only where status AND `active_turn_id` still
  match, so a settle validated against turn A cannot land after turn B bound.
  The loser is a typed `cas-conflict`, never a throw.
- **Notifications follow the commit, never precede it.** A standalone writer
  takes a `DbNotifier` and announces after its own write commits;
  `rebindThreadOrigins` moves a folder's threads in one transaction and
  announces each after it. An `*InTransaction` writer announces nothing: the
  server composes it into one immediate transaction and its
  `NotificationBuffer` announces after the commit, so a subscriber never sees
  rolled-back state. `setThreadProviderSession` announces nothing on purpose:
  the provider session is runtime plumbing, not a fact a client renders.
- **A claim has no TTL, so boot releases them all.** One server owns a data
  dir, so no claim can be live at boot; `releaseAllQueuedMessageClaims` runs
  in `ThreadService.boot()` (`apps/cli/src/server/threads/service.ts`).

## Seams

- `DbNotifier` (`@repo/domain/notifier`) — the announcement port every writer
  takes. The server binds the `/ws` bus; `noopNotifier` is the test's.
- `DbTransaction` and the `*InTransaction` variants — how the server composes
  append, lifecycle projection, queue touch and outbox enqueue into ONE
  immediate transaction (`apps/cli/src/server/threads/service.ts`). An append,
  a lifecycle move, an enqueue, a claim and a claimed delete have no standalone
  twin: one would be an append that skips the lifecycle projection and the
  outbox, and a second spelling of `BEGIN IMMEDIATE`. Tests run them through
  `writeTransaction` as the server does.
- `runMigrations(db, folder?)` — the staged-content seam the packaged CLI
  drives.

## Testing

`pnpm --filter @repo/db test` — vitest over real files in a temp dir
(`__tests__/open-temp-db.ts`, disposed with the test). Pinned: boot migrates
and bumps the version, upgrades a POPULATED v2 file in place with its child
rows and foreign keys intact, refuses a newer build's file, opens with WAL and
`synchronous=NORMAL`, hands a deleted row's pages back on close; contiguous
sequences under interleaved writers, the turn/started gate, the scope CHECK at
the database, a 20-event burst prepares two SELECTs and one INSERT; the
lifecycle happy path and its typed no-ops, a folder rebind a write refuses
partway moving nothing, `listThreads` answered from its partial indexes with
no temp b-tree; FIFO claims across connections and same-millisecond bursts;
interaction idempotency. `schema-agreement.test.ts` spawns `drizzle-kit`, so
it carries its own 30s budget.
