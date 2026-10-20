# Decisions: the knowledge runtime

How the server keeps the index: what it persists, where the scan runs, what a
slow or refused read costs. `AGENTS.md` § Decisions says how a bullet is written
and cited.

## Knowledge: index, search and links

- **THE INDEX SKIPS A DOC WHOSE SIZE AND MTIME ARE THE ONES IT INDEXED.** A
  reconcile compares the walk's stat (`listFileStats` in
  `apps/cli/src/server/vault/vault-service.ts`) with the `(size, modified_ms)`
  stored beside `content_hash`, opening only a doc whose pair moved; an
  announced change is always read. The pair is the stat taken before the read,
  so a write between the two is read again next reconcile, and a read whose
  bytes had not moved only rewrites the pair. Rejected: reading and hashing
  every doc at boot (about 1 GB of text read again each launch at 50k items, and
  an evicted placeholder downloads). Residual: a write that keeps both, as a
  checkout's same-second rewrite can, waits for the next content change.
  `apps/cli/src/server/knowledge/index-pass.ts`.

- **`KnowledgeIndex` IN `@repo/notes` IS NOT DEAD CODE**: the package carries no
  sqlite (`SqlDriver` is injected), so that in-memory composition is how it
  tests its own engine. `packages/notes/src/knowledge/knowledge-index.ts`.

- **A DOC THE INDEX CANNOT READ OR PROJECT COSTS THAT DOC, NEVER THE INDEX.** A
  refused read (EACCES, EIO) keeps the doc's last row and is retried every pass,
  since a permission fix announces nothing. A doc whose projection throws is
  indexed as an other with its hash kept, so it is not re-projected every
  reconcile nor after a restart (a build that can project it bumps
  `PROJECTION_VERSION`). Only the store's own failure rebuilds: the driver
  throws `KnowledgeStoreError` (`@repo/notes/knowledge/sql-knowledge-store`) for
  every database failure, and any other throw fails that pass and reconciles on
  the next. Rejected: rebuilding on either (the rebuild re-reads the same vault,
  fails the same way, and loops). `apps/cli/src/server/knowledge/index-pass.ts`,
  `apps/cli/src/server/knowledge/knowledge-runtime.ts`.

- **THE SCAN RUNS ON A WORKER; THE SERVER'S LOOP READS BYTES AND WRITES ROWS.**
  Projection, the stem shadow (`@repo/notes/knowledge/search-columns`) and both
  rewrite sets' byte surgery run on one warm worker, since a 20k-line note is
  seconds of synchronous CPU (2.9s measured) on every autosave, and the server's
  thread also answers every request, the ws bus and the watcher's liveness ping.
  No projection cap below the vault's 10 MiB read cap (a doc over it indexes as
  an other: resolvable, never searched); a lower one comes only if the worker
  cannot keep up (owner decision). Most suites run the jobs inline
  (`apps/cli/src/server/knowledge/test-support/inline-projector.ts`), since a
  worker booted from source (`apps/cli/src/server/worker-entry.ts`) costs
  seconds. `apps/cli/src/server/knowledge/projection-worker.ts`, pinned in
  `apps/cli/src/server/knowledge/knowledge-runtime.test.ts`.

- **THE LIBRARY LISTING IS ANSWERED FROM THE IN-MEMORY MIRROR.** `items`,
  `itemPaths`, `itemsAt`, `findByUrl`, `scopes` and `pathForNoteId` settle, then
  read `LinkGraphIndex`'s `LibraryIndex` (`@repo/notes/items/library-index`)
  with no SQL read and no walk: mtime and size come from the listing, and
  `scopes`' folders from the directory set the reconcile's walk keeps
  (`listDirs`), which an announced folder change updates for its own subtree.
  Rejected: SQLite columns and indexes (tag families, bareness and mtime live in
  memory anyway); a `listDirs` walk per call (the rail asks on every
  files-changed frame). `apps/cli/src/server/knowledge/knowledge-runtime.ts`.

- **A TARGET CHANGE IS ITS OWN KIND.** The runtime says `targets-changed` only
  when a settle added, removed or renamed a path or changed a doc's aliases, id,
  pin or title, the fields a targets row carries, since the page's pinned set
  and the link pickers' titles are read from those rows (`onTargetsChanged`,
  read once per pass from `LinkGraphIndex.takeTargetsChanged`).
  `apps/cli/src/server/knowledge/knowledge-runtime.ts`.

- **THE PAGE REFETCHES `knowledge.wikiTargets` ONLY ON A TARGET CHANGE, AT MOST
  ONCE PER 5 S**, outside the knowledge sweep a body edit or a listing change
  makes, since that answer holds every doc and asset (about 7.5 MB at 50k items)
  and a fill storm is one body change per item; a fill that gives a stub its
  first heading marks once, and the throttle folds a storm of those. Rejected:
  the knowledge-family sweep on every content change (it refetched every target
  per keystroke and per fill). `apps/workspace/src/app/change-batch.ts`.

- **A DOC WHOSE READ HAS NOT ANSWERED IN 2S IS DEFERRED, NOT AWAITED, AND EVERY
  VAULT READ OPENS INSIDE THE VAULT SERVICE'S BUDGET.** One open on an evicted
  placeholder, a sleeping disk or a network mount can block for minutes, and
  every query settles the pass first, so the doc answers from its last entry and
  its read lands in a later pass; the deadline runs from the call, so a read
  still waiting for a slot is deferred too. Rejected: a foreground deadline
  answering "unavailable" (it refuses a note on disk); re-reading every path
  once its late read lands (it loops on always-slow storage). Residual: the
  listing's walk has no deadline; a rename before a deferred doc lands misses a
  link the doc gained offline.
  `apps/cli/src/server/knowledge/deferred-reads.ts`.

- **A NEW PATH WHOSE READ IS OUT ANSWERS `pending`, NOT GONE.** It has no last
  entry, so while its read is out `knowledge.pathForNoteId` answers a null as
  `pending`, and the window keeps an item that moved rather than take it for
  gone. A read counts as out until the pass that took it has applied it, since
  the router asks after its settle and a queued pass can take what landed before
  the answer leaves. `readsOutstanding` in
  `apps/cli/src/server/knowledge/deferred-reads.ts` and
  `apps/cli/src/server/knowledge/index-pass.ts`, read by
  `apps/cli/src/server/knowledge/knowledge-router.ts`.

- **THE BUDGET IS 3 OPENS AT ONCE, WHOEVER ASKED, AND A BACKGROUND READ NEVER
  TAKES THE THIRD.** It wraps the open of a file's bytes in `read` and
  `readBytes`, since a stalled open holds one of node's four fs threads and a
  fourth stalls every fs call, saves included, which no deadline can free; a
  read left running keeps its slot. Background reads, the many a job nobody
  waits on makes (the index pass, the boot's origin repair), share two, so a
  read someone waits on opens beside two that hang; each such job runs no more
  at once than that share and waits inside itself, where the index reads the
  latest path first. Rejected: a wider cap (the pool cannot afford it).
  `apps/cli/src/server/vault/read-slots.ts`.

- **A SAVE NEVER WAITS BEHIND A STALLED READ.** The lstat and ancestry checks
  before an open stay outside the read budget, and so does a write's read of the
  bytes it replaces. Residual: a stat or a write's own read can still stall on
  slow storage. `apps/cli/src/server/vault/vault-service.ts`.

- **A REQUEST THAT READS MANY DOCS READS IN THE FOREGROUND LANE, ONE DOC AT A
  TIME**, since someone waits on it (a delete's id scan, a rename's snapshot):
  an index stalled on evicted placeholders never holds up a delete or a rename
  of notes on disk, and a request holds no more of the budget than one read
  does. Rejected: a request's reads in the background share (it queued a delete
  behind the index's stalls). Residual: while the index holds two stalled reads,
  a request whose own doc stalls holds the window's slot.
  `apps/cli/src/server/vault/read-slots.ts`.

- **NO PROVIDER PATH, BUNDLE ID OR MOUNT TYPE APPEARS ANYWHERE.** The scenario
  suite stalls a path through `INTELIGIR_SLOW_READS`
  (`apps/cli/src/server/vault/slow-reads.ts`), inside the read's slot, and the
  boot's timing line (`apps/cli/src/server/boot-report.ts`) counts what was
  deferred. `tools/e2e/src/scenarios/slow-storage.ts`.
