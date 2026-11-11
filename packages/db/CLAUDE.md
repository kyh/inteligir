# Decisions: @repo/db

The D1 accounts database's schema, and each library cell's, each note's and
each conversation's: D1's ships by `drizzle-kit push`, each object's as the
migrations it runs when it wakes.

## Schemas

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and no users, so a history serves nobody; the suites and
  the e2e apply the DDL `drizzle-kit export` prints. `tools/e2e/src/fixtures.ts`.
- **Declare D1 uniques as named unique indexes, never `.unique()`.** drizzle-kit
  1.0 plans `.unique()` as a table recreate whose `DROP` cascades through every
  child on D1. `tools/repo-guards/src/d1-unique-index.test.ts`.
- **The cell's schema is drizzle's, migrated when the cell wakes.** A
  hand-written DDL is a second spelling of the tables; no table is STRICT,
  WITHOUT ROWID or triggered, which a generated rebuild drops.
  `packages/db/src/cell/schema.ts`.
- **Each note's schema is drizzle's too, migrated in its constructor.**
  y-partyserver's `onLoad` runs only once a socket or a call starts the server,
  so a plain call would meet no tables. `packages/db/src/note/schema.ts`.
- **Each conversation's schema is drizzle's too, migrated in its constructor.**
  It runs before `agents/lifecycle` makes its job table, which the migrator
  would take for one drizzle did not make. `packages/db/src/thread/schema.ts`.
