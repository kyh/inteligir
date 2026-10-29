# Decisions: @repo/library-replica

The replica engine: its ports, the pull, the overlay, the outbox, the socket
and the in-memory SQLite. `AGENTS.md` § Decisions says how a bullet is written
and cited.

## The replica

- **ONE ENGINE FOR EVERY DEVICE, ITS PLATFORM THE HOST'S PORTS.** The SQL (an
  async `all` and `run`, and `exclusive` around a transaction), the clock, the
  ids, the `/v1` transport, the socket dial, the staged files and the block
  merge are handed in; the package imports no node, React, React Native, Expo,
  editor or UI module and touches no platform global (`oxlint.config.ts`), so
  the editor's diff3 is injected as the merge. Rejected: an engine per host
  (the Mac's and the phone's rules would drift); importing the merge (Plate
  into Hermes and every node suite).
  `packages/library-replica/src/replica-ports.ts`.

- **A PULLED ROW LANDS ONLY OVER AN OLDER ONE, A PAGE A TRANSACTION, AND ITS
  BODY COMES APART.** Each page lands with the cursor it moved to in one
  transaction, every row only over a lower sequence, and an address goes to the
  item holding it at the higher one, whichever came first; a moved item's body
  is wanted at its row's sequence and fetched the open item first, then the
  newest, laid only under the row it was sent for. An answer naming another
  epoch wipes the rows, keeps the outbox and pulls from nothing. Rejected:
  bodies in the log (a page of long notes); dropping the outbox on a reset
  (the person's writes lost). `packages/library-replica/src/replica-pull.ts`,
  `replica-rows.ts`.

- **THE SYNCED TABLES HOLD ONLY WHAT THE CELL SENT, AND THE OUTBOX IS LAID OVER
  THEM AS A SCREEN READS.** An item, its listing row and its highlights are
  read with every row naming it laid over, oldest first, a parked one too; a
  landing writes the answered row and the blocks it wrote at the answer's
  sequence, and a folder or highlight stands at sequence 0 until the pull
  replaces it. A save of an address another item holds lists no card of its
  own. Residuals: search finds an unsent edit's words once it lands; a landing
  asks for the item's body again. Rejected: optimistic rows in the synced
  tables (a pull could not tell them apart).
  `packages/library-replica/src/replica-listing.ts`, `overlay.ts`.

- **THE OUTBOX SENDS OLDEST FIRST UNDER AN OP ID PINNED BEFORE IT FIRST GOES.**
  A write joins the item's last row while it waits, compacted onto the first
  bases; one change to the outbox runs at a time, so a pin sends what a join
  left, and a staged file goes once no row names it. A `CONFLICT` settles
  through the merge, a `BLOB_MISSING` uploads again, a refusal no resend passes
  parks the row and its items' rows behind it, and a landing this copy cannot
  lay leaves the row to the pull. Rejected: dropping a refused write; a
  whole-item retry (two devices' edits to different blocks would meet).
  `packages/library-replica/src/outbox.ts`, `outbox-settle.ts`,
  `outbox-ops.ts`.

- **THE SOCKET IS A HINT, AND THE MINUTE'S CHECK-IN THE FLOOR.** A pass runs as
  the socket opens, on a frame naming a head past the cursor, on a thread's
  stored event, on every write and every minute; the socket pings, drops a
  silent connection and dials again on a doubling wait, its ticket minted by
  `account.socketTicket`. Rejected: state in the frames (a dropped frame would
  be a lost write). `packages/library-replica/src/replica-socket.ts`,
  `library-replica.ts`.

- **THE BROWSER TAB'S REPLICA AND THE SUITES' ARE SQLITE'S OWN WASM, IN
  MEMORY.** `@sqlite.org/sqlite-wasm` with FTS5, one connection serving every
  call in order, a transaction `BEGIN IMMEDIATE` to `COMMIT`; it imports
  nothing of the package's but types, so the Worker's suite holds it on its
  node side, since workerd compiles no WebAssembly a module did not ship.
  Rejected: a fake SQL in the suites (the shared plans would go untried); the
  wasm in workerd (sqlite-wasm compiles its glue at load).
  `packages/library-replica/src/memory-sql.ts`,
  `apps/web/replica-sql-service.ts`.
