# Decisions: @repo/db

The D1 accounts database's schema, and each library cell's, each note's and
each conversation's: D1's ships by `drizzle-kit push`, each object's as the DDL
`drizzle-kit export` prints, which it applies when it wakes.

## Schemas

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and no users, so a history serves nobody; the suites and
  the e2e apply the DDL `drizzle-kit export` prints. `tools/e2e/src/fixtures.ts`.
- **Declare D1 uniques as named unique indexes, never `.unique()`.** drizzle-kit
  1.0 plans `.unique()` as a table recreate whose `DROP` cascades through every
  child on D1. `tools/repo-guards/src/d1-unique-index.test.ts`.
- **Each object's schema is its drizzle schema's DDL, and a different DDL wipes
  the object, until the no-users premise is struck** (owner decision: push, not
  migrations). A migration history serves no user; the cell's search index is
  the one hand-written statement, and no table is STRICT, WITHOUT ROWID or
  triggered, which the export cannot spell. `packages/db/scripts/object-ddl.ts`.
