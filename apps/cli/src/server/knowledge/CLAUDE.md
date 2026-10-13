# Decisions: the knowledge runtime

How the server keeps the index: what it persists, where the scan runs, what a
slow or refused read costs. `AGENTS.md` § Decisions says how a bullet is written
and cited.

## Knowledge: index, search and links

- **The knowledge index persists no stat fingerprint.** A warm reconcile over
  2000 notes reads and hashes every doc in ~200ms on a local disk, off the
  critical path, and a second persisted table in a cache whose recovery
  primitive is deleting the file is a crash waiting for a missed re-create. On
  storage that fetches or wakes, the read deadline (A DOC WHOSE READ HAS NOT
  ANSWERED, below) keeps the reconcile to ~2s whether one read stalls or all do,
  so the fingerprint is not what makes slow storage usable. What only size+mtime
  buys is not opening the file, so THE TRIGGER is a report of a vault whose
  notes the OS evicts to placeholders being fetched again on every boot; the
  walk already stats every file. `KnowledgeIndex` in `@repo/notes` is not dead
  code: the package carries no sqlite (`SqlDriver` is injected), so that
  in-memory composition is how it tests its own engine.

- **A DOC THE INDEX CANNOT READ OR PROJECT COSTS THAT DOC, NEVER THE INDEX.** A
  refused read (EACCES, EIO) keeps the doc's last row and is retried every pass,
  since a permission fix announces nothing. A doc whose projection throws is
  indexed as an other with its hash kept, so it is not re-projected every
  reconcile nor after a restart (a build that could project it bumps
  `PROJECTION_VERSION`). Rebuilding on either is rejected: the rebuild re-reads
  the same vault and fails the same way, so it loops. For the same reason only
  the store's own failure rebuilds: the driver throws `KnowledgeStoreError`
  (`@repo/notes/knowledge/sql-knowledge-store`) for every database failure, and
  any other throw fails that pass and reconciles on the next.
  `apps/cli/src/server/knowledge/index-pass.ts`.

- **THE SCAN RUNS ON A WORKER; THE SERVER'S LOOP READS BYTES AND WRITES ROWS.**
  Projecting a 20k-line note is seconds of synchronous CPU (2.9s measured),
  every autosave re-projects it, and the server's thread also answers every
  request, the ws bus and the watcher's liveness ping. So projection, the stem
  shadow (`@repo/notes/knowledge/search-columns`) and both rewrite sets' byte
  surgery run on one warm worker
  (`apps/cli/src/server/knowledge/projection-worker.ts`). No projection cap
  below the vault's 10 MiB read cap (a doc over it indexes as an other:
  resolvable, never searched): by owner decision a lower one is added only if
  the worker cannot keep up. Most suites run the jobs inline
  (`apps/cli/src/server/knowledge/__tests__/inline-projector.ts`), because a
  worker booted from source (`apps/cli/src/server/worker-entry.ts`) costs
  seconds. Pinned over a 20k-line note in
  `apps/cli/src/server/knowledge/__tests__/knowledge-runtime.test.ts`.

- **A DOC WHOSE READ HAS NOT ANSWERED IN 2S IS DEFERRED, NOT AWAITED, AND EVERY
  VAULT READ OPENS INSIDE THE VAULT SERVICE'S BUDGET.** On storage that fetches
  or wakes (an on-demand placeholder, a sleeping disk, a network mount) one open
  can block for minutes, and every query settles the pass first. So the pass
  moves on, the doc answers from its last entry, and the read lands in a later
  pass; the deadline runs from the call, so a read still waiting for a slot is
  deferred too. The budget is the vault service's own, around the open of a
  file's bytes in `read` and `readBytes`
  (`apps/cli/src/server/vault/read-slots.ts`): 3 at once, whoever asked, because
  a stalled open holds one of node's four fs threads and a fourth stalls every
  fs call in the process, saves included, which no deadline can free; a read
  left running keeps its slot. A BACKGROUND READ, one of many a job nobody waits
  on makes (the index pass, the boot's origin repair), never takes the third, so
  a read someone waits on opens beside two that hang; each such job runs no more
  at once than that share, so what waits does so in the job, where the index
  reads the latest path first. A request that reads many docs (a delete's id
  scan, a rename's snapshot) is waited on, so it reads in the foreground lane,
  one doc at a time: an index stalled on evicted placeholders never holds up a
  delete or a rename of notes on disk, and a request holds no more of the budget
  than one read does. The lstat and ancestry checks before the open stay outside
  it, and so does a write's read of the bytes it replaces, so a save never waits
  behind a stalled read. Rejected: a foreground deadline answering
  "unavailable", which refuses a note that is on disk; re-reading every path
  once its late read lands, which loops on storage that is always slow; a wider
  cap, which the pool cannot afford; and a request's reads in the background
  share, which queued a delete behind the index's stalls. No provider path,
  bundle id or mount type appears anywhere; the scenario suite stalls a path
  through `INTELIGIR_SLOW_READS` (`apps/cli/src/server/vault/slow-reads.ts`),
  inside the read's slot, and the boot's timing line
  (`apps/cli/src/server/boot-report.ts`) counts what was deferred. Residual: the
  listing's walk has no deadline, a stat or a write's own read can still stall
  on such storage, a rename run before a deferred doc lands misses a link the
  doc gained offline, and while the index holds two stalled reads a request
  whose own doc stalls holds the window's slot.
  `apps/cli/src/server/knowledge/deferred-reads.ts`,
  `tools/e2e/src/scenarios/slow-storage.ts`.
