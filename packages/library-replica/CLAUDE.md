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
  the editor's diff3 is injected as the merge, which resolves, so the phone
  runs it in its headless page (`apps/mobile/src/editor/headless-page-host.ts`).
  Rejected: an engine per host (the tab's and the phone's rules would drift);
  importing the merge (Plate into Hermes and every node suite).
  `packages/library-replica/src/replica-ports.ts`.

- **A PULLED ROW LANDS ONLY OVER AN OLDER ONE, A PAGE A TRANSACTION, AND ITS
  BODY COMES APART.** Each page lands with the cursor it moved to in one
  transaction, every row only over a lower sequence, and an address goes to the
  item holding it at the higher one, whichever came first; a moved item's body
  is wanted at its row's sequence and fetched the open item first, then the
  newest, laid only under the row it was sent for, and one that meets another
  row leaves the want standing for the next pass. An answer naming another
  epoch wipes the rows, keeps the outbox and pulls from nothing. A row held
  ahead of every block is a body still to come, and a write on a block it may
  hold, or on a base that moved, answers `waiting` until it lands, while a field
  over its base or a new block goes. Residual: a queued write that outlives a
  reset, or a relaunch after its fold, lands as the whole body until the body
  comes. Rejected: bodies in the log (a page of long notes); dropping the outbox
  on a reset (the person's writes lost); a write judged over a body not here (no
  blocks calls a put moved and a drop or a move already true, and a `changed`
  answered over none empties the editor); dropping the want of a body newer than
  its row, for the row's own change to want again (until that change came, the
  row read as a body held with nothing in it).
  `packages/library-replica/src/replica-pull.ts`, `replica-rows.ts`,
  `replica-commands.ts`.

- **THE SYNCED TABLES HOLD ONLY WHAT THE CELL SENT, AND THE OUTBOX IS LAID OVER
  THEM AS A SCREEN READS.** An item and its listing row are read with every
  row naming it laid over, oldest first, a parked one too; a landing writes
  the answered row and the blocks it wrote at the answer's sequence, and a
  folder stands at sequence 0 until the pull replaces it. A save of an address another item holds lists no card of its
  own. A make shows by the field rules the cell lands it by, so a card reads
  alike on both sides of its landing. Residuals: search finds an unsent edit's
  words once it lands, and an unsent delete in Deleted's search once it lands; a
  landing asks for the item's body again; a saved link's note shows once the
  cell has read it from markdown. Rejected: optimistic rows in the synced tables
  (a pull could not tell them apart); a device's own guess at a make's fields (a
  video listed as a link until it landed).
  `packages/library-replica/src/replica-listing.ts`, `overlay.ts`,
  `packages/notes/src/library/item-makes.ts`.

- **THE OUTBOX SENDS OLDEST FIRST UNDER AN OP ID PINNED BEFORE IT FIRST GOES.**
  A write joins the item's last row while it waits, compacted onto the first
  bases, unless a row behind that one makes a folder it files in; one change to
  the outbox runs at a time, so a pin sends what a join left, and a staged file
  goes once no row names it. A `CONFLICT` settles
  through the merge, whose overlap the change it emits names (`overlapped`), a
  `BLOB_MISSING` uploads again, a refusal no resend passes
  parks the row and the rows on its items or folders behind it, and a landing
  this copy cannot lay leaves the row to the pull. A folder name a sibling
  holds is such a refusal, and so is an address another item holds, in the cell's
  own words, and a row its last resend left as it was: a
  parked row stops neither the pass nor the pull, and a folder's holds no other
  folder, so the person can rename the one in its way. A folder a row has yet to
  make holds what is filed in it, since its id names nothing at the cell; let go,
  it takes the ops on it along and what was filed in it lands unfiled, in the one
  transaction, while a folder that stands files what comes whatever parked on it.
  A make let go takes the writes on its item along in that transaction, the words
  going with the card, and a delete or a restore of it lets its id go.
  A make the cell folds onto the item at its address takes the writes naming it
  along, in its landing's
  transaction, and a block they name there settles as any other; a delete or a
  restore of it lets its id go, since the fold took the card away and the item it
  met is another's, older and with notes of its own. A restore the cell leaves
  in Deleted for an address another item holds parks what it left under a new op
  id, since the cell keeps its answer under the old one. Rejected: dropping a
  refused write; a whole-item retry (two devices' edits to different blocks would
  meet); stopping the pass on a row that cannot change (every later write and the
  pull wait on it, with nothing for the person to answer); parking a row on a
  folded or let-go id (its text shows nowhere and no resend can pass); filing past a folder
  the cell has yet to hold (a note lands with an id no folder takes, a link parks
  not-found); a delete following
  the card to the item it met (an older item binned for a duplicate).
  `packages/library-replica/src/outbox.ts`, `outbox-settle.ts`,
  `outbox-ops.ts`.

- **A FOLDED MAKE'S ID ANSWERS AS THE ITEM IT LANDED ON FOR THE REST OF THE
  RUN.** An item's read, a write and the change feed take
  the id a make was queued under to the item the cell folded it onto, so a screen
  open on the card stays open through the fold, its unsaved words going on to that
  item and a write past its check landing there. A write landing on that item
  while its body is still to come lays no block, since a part would read as all
  of it and take the open card's blocks away; the body brings them. No table keeps
  this, since only a url naming the card outlives the run, and the listing knows
  nothing of it, since a selection still naming the card must not reach the older
  item: `row` answers no row, and a delete asked by that id goes nowhere, so a
  screen acts on what it shows through its item read, by the id that answered and
  the fields it holds. Residuals: a call only the cell answers that no item read
  names, the agent's view of the open item, names the old id until the
  item opens again; a reload on a url naming a card that folded says the item
  isn't on this device, though it stands at its holder's id in the grid.
  Rejected: the session following the id alone (the item view, the phone's screen
  and its page read that id too, and the screen drops its page on an item it
  cannot read); a move in every host (a bridge event and a route per surface for
  what one map answers); the url moved to the landed id (an item's editor is keyed
  by its id, so the move closes a session in the middle of an edit, one waiting on
  a body with nowhere to write it); a table of folds (a second store for one reload
  of one url). `packages/library-replica/src/folded-makes.ts`,
  `library-replica.ts`.

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
  nothing of the package's but types and the serial lock, by the package's
  name, so the Worker's suite holds it on its node side, since workerd
  compiles no WebAssembly a module did not ship.
  Rejected: a fake SQL in the suites (the shared plans would go untried); the
  wasm in workerd (sqlite-wasm compiles its glue at load).
  `packages/library-replica/src/memory-sql.ts`,
  `apps/web/replica-sql-service.ts`.

- **A FILE KEPT FOR A BLOCK STILL TO BE WRITTEN IS AN OUTBOX ROW OF ITS OWN.**
  `keepFile` stages the bytes by sha with a `keep` row, which uploads them as
  soon as the outbox reaches it and lets them go; a write or a new note whose
  blocks name a file a row stages stages it too, so the bytes stay until that
  row lands and a `BLOB_MISSING` sends them again, and a file no write names
  goes up and is the cell's to let go a day on. The status counts a waiting
  keep row as no change, the write naming it being the person's, and a parked
  one as one. Rejected: the bytes passed with the write (the editor held them
  in memory through its pause); a table of kept files (a second staging beside
  the rows' own). `packages/library-replica/src/outbox.ts`,
  `replica-commands.ts`, `library-replica.ts`.

- **A CLOSED REPLICA REFUSES EVERY WRITE, IN THE PERSON'S WORDS.** A row and its
  files are laid only while the replica is open, checked under the outbox's own
  hold, which a wipe takes too, so a write is either past the check and removed
  by the wipe or refused with `ReplicaClosedError`, whose message a screen can
  say and whose type a caller that can keep the write reads
  (`apps/mobile/src/items/share-save.ts`). Rejected: taking the write and
  sending nothing (a row laid in a wiped database goes out under whoever signs
  in next, since rows name no account). `packages/library-replica/src/outbox.ts`.
