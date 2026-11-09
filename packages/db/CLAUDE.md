# Decisions: @repo/db

The D1 accounts database's schema and each library cell's, and how each
ships: D1's by `drizzle-kit push`, a cell's as the migrations it runs when it
wakes. `AGENTS.md` § Decisions says how a bullet is written and cited.

## Schemas

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and no users (`AGENTS.md` § Project Overview), so a
  push may drop a column Better Auth does not write, and the schema follows
  what its generator prints for the plugin set (`packages/db/src/d1/schema.ts`
  says how). The suites and the e2e harness derive the DDL by `drizzle-kit
  export` and send it as one D1 batch. Rejected: migration files (a history for
  installs nobody holds). The first outside tester is the trigger for
  migrations. `packages/service/vitest.config.ts`,
  `tools/e2e/src/harness/cloud-worker.ts`.

- **Declare D1 uniques as named unique indexes, never `.unique()`**
  (`packages/db/src/d1/schema.ts`). Production D1 holds every unique as
  drizzle-kit 0.31's `<table>_<column>_unique` index, which
  `uniqueIndex("<table>_<column>_unique")` matches, so `drizzle-kit push
  --explain` reports no changes; refuse any plan that recreates a table
  (`tools/repo-guards/src/d1-unique-index.test.ts`). Rejected: inline
  `.unique()`, which drizzle-kit 1.0 plans as a table recreate whose `DROP`
  cascades through every `ON DELETE CASCADE` child (D1 ignores `PRAGMA
  foreign_keys=OFF`), and `push` applies it without asking.

- **THE CELL'S SCHEMA IS DRIZZLE'S, MIGRATED WHEN THE CELL WAKES.**
  `@repo/db/cell/schema` declares every table but the search index, an FTS5
  table sqlite-core cannot declare, which a custom migration of its own makes;
  drizzle-kit generates the rest (`packages/db/drizzle.config.cell.ts`). The
  cell runs drizzle's migrator under `blockConcurrencyWhile` on every wake,
  first wiping a cell that holds tables drizzle did not make or a migration
  this build's journal lacks, and logs the names a failed run left pending,
  since the migrator's rollback drops the failing statement's error. No table
  is STRICT or WITHOUT ROWID, which sqlite-core cannot spell and a generated
  table rebuild would drop, no trigger sits on one, for the same rebuild, and
  `meta.v` declares no type, so a value reads back as it was written.
  Rejected: a hand-written DDL versioned by a `meta` row (a second spelling of
  the tables, and every version bump wiped every cell).
  `packages/db/src/cell/schema.ts`, `packages/service/src/library/cell-db.ts`.
