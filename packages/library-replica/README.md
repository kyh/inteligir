# @repo/library-replica

The replica engine every device runs: the account's library as this device
holds it, read offline and caught up with the account's library cell whenever
it can reach it. It is one package so the Mac's window, the browser tab and the
phone hold the same rows by the same rules, and it names no platform: the host
hands it its SQLite, its clock, its ids, its `/v1` transport, its socket dial,
the place its unsent files wait, and the editor's block merge.

## How a device catches up

A pass sends the outbox oldest first, pulls the change log after the cursor a
page at a time, then fetches the bodies whose items moved: the one open on a
screen first, then the newest. It runs when the host starts or resumes the
replica, when a write is queued, when the socket says the library moved or
opens, and on the minute's check-in; a failure waits a doubling while and goes
again, and a session's end stops the replica until its host starts it again (a
sign-out wipes it). The socket is a hint and never the state.

## Layout

- `src/library-replica.ts` — `openLibraryReplica`: the schema at open (a
  mismatch starts over), the passes, the status, the change and thread
  listeners, and the reads and writes a screen calls.
- `src/replica-ports.ts` — what the host hands the engine.
- `src/replica-pull.ts` — the change log's pages and the bodies.
- `src/replica-rows.ts` — the replica's own SQL over the shared schema
  (`@repo/notes/library/library-schema`): a change laid only over an older row,
  the reset, this device's own landings, and the rows a screen lists.
- `src/replica-listing.ts` — an item and the listing's rows as a screen reads
  them, the outbox laid over.
- `src/overlay.ts` — one outbox row laid over the item it names.
- `src/replica-commands.ts` — the writes a screen makes, each checked against
  the item as it reads and queued.
- `src/outbox.ts`, `src/outbox-rows.ts`, `src/outbox-ops.ts`,
  `src/outbox-settle.ts` — the queue, its table, what a row holds and how two
  writes join, and how a `CONFLICT` settles.
- `src/folded-makes.ts` — the makes the cell folded this run, by the id a screen
  open on one still holds.
- `src/replica-socket.ts` — the account's socket.
- `src/call-outcome.ts` — what a call's failure means to the passes, and a
  file's upload.
- `src/memory-sql.ts` — SQLite's own wasm build in memory: the browser tab's
  replica and the suites'.

## Tests

`pnpm --filter @repo/library-replica test` runs the engine against a fake cell
(`src/test-support/fake-cell.ts`), oRPC's own handler over the contract's rows,
with seeded properties for seq-ordered apply (`src/replica-rows.test.ts`),
compaction (`src/outbox-ops.test.ts`) and replay
(`src/library-replica.test.ts`), and its passes' schedule on a clock moved by
hand, the socket's frames included (`src/library-replica-passes.test.ts`). The
real cell holds it to the same promises in
`apps/web/src/worker/library/library-replica.test.ts`.
