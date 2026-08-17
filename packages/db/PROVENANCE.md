# Vendored: bb's thread store

- **Upstream**: https://github.com/get-bb/bb, `packages/db` and the service
  modules named per file below
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — `LICENSE.bb` in this directory is upstream's own text,
  copied verbatim. The per-file notice below is not a substitute for it: MIT
  requires the license itself to travel with the copy, and it names a
  copyright holder no notice line carries.
- **Vendored**: 2026-08-17

This package is NOT wholly vendored, which is why the record is per file. bb's
thread store came across — the connection pragmas, the prefixed-id alphabet,
the events/queue/interaction tables and the lifecycle CAS. The vault, the
knowledge tables, the migrations and everything the vault write path needs are
house-authored and carry no notice.

Vendored rather than depended on because bb publishes no packages and this repo
carries a fraction of a much larger store.

## Attribution

```text
Vendored from bb (github.com/get-bb/bb), MIT.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                          | Upstream                                                         | Carried  |
| ----------------------------- | ---------------------------------------------------------------- | -------- |
| `src/connection.ts`           | `packages/db/src/connection.ts`                                  | vendored |
| `src/events.ts`               | `packages/db/src/data/events.ts`                                 | vendored |
| `src/ids.ts`                  | `packages/db/src/ids.ts`, `packages/domain/src/raw-thread-id.ts` | vendored |
| `src/pending-interactions.ts` | `packages/db/src/data/pending-interactions.ts`                   | adapted  |
| `src/queued-messages.ts`      | `packages/db/src/data/queued-thread-messages.ts`                 | vendored |
| `src/schema.ts`               | `packages/db/src/schema.ts`                                      | vendored |
| `src/threads.ts`              | `packages/db/src/data/threads.ts`                                | vendored |

## Partial copies

Four of the rows above cover part of their file, and a reader looking for
upstream code in the rest will not find it:

- `src/events.ts` — a hard trim of a 3,476-line upstream, but the kept code is
  upstream's: `MissingTurnStartedError` (upstream's `MissingStored…` with the
  infix dropped), `hasStoredTurnStarted`, `getMaxSequence` (upstream's
  `getLatestThreadSequence`), `listStoredThreadEvents`, and
  `appendEventsInTransaction`'s whole skeleton, whose turn-started guard is
  lifted from upstream's OTHER append path. The `StoredThreadEvent` interface,
  the `AppendEventsResult` wrapper and the write-time `threadEventSchema.parse`
  are house, as is the move from upstream's raw `sql` INSERT to the drizzle
  builder.
- `src/schema.ts` — the notice sits at the table it scopes, not at line 1. The
  `events`, `queued_thread_messages` and `pending_interactions` tables below it
  are upstream's, index definitions and the `events_scope_shape_check` SQL
  included. `meta` and `threads` above it are house: upstream's `threads` has
  24 columns to this one's handful, and every index on it, the
  `threads_origin_pair_check` and `activeTurnId` are this repo's.
- `src/threads.ts` — the lifecycle half (`applyThreadLifecycleEventRecord` and
  its wrappers, `getThread`, `archiveThread`) is upstream's, with the CAS
  predicate extended to `activeTurnId`. `listThreads`,
  `listThreadsByOriginDoc`, `rebindThreadOrigins` and
  `setThreadProviderSession` have no upstream counterpart.
- `src/queued-messages.ts` — upstream's row types, listing, and select-then-CAS
  claim carry over; the fractional order keys are replaced by
  `createSortKeyAfter`, and upstream's grouping/reorder/stale-claim half is not
  carried.

The `adapted` row is the weakest claim in the package and is kept attributed on
purpose. `src/pending-interactions.ts` keeps the names and the status
vocabulary while rewriting every body — its create is idempotent where
upstream's is a plain insert, and its resolve returns a three-way union where
upstream returns a row or null.

Upstream's `packages/db/src/notifier.ts` is vendored here too, but into
`packages/domain` — the seam types both the store and the wire contract, so it
sits below both. Its record is that package's.

## Re-vendor recipe

Clone upstream at a newer commit and diff each row's upstream file against its
counterpart here, ignoring the notice lines and expecting the trims above.
Update the commit pin here and run this package's tests, which include the
migration↔schema agreement check.
