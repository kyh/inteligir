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
  child on D1, so lint refuses the modifier under `src/d1`. `oxlint.config.ts`.
- **Each object's schema is its drizzle schema's DDL, and a different DDL wipes
  the object, until the no-users premise is struck** (owner decision: push, not
  migrations). A migration history serves no user; the cell's search index is
  the one hand-written statement, and no table is STRICT, WITHOUT ROWID or
  triggered, which the export cannot spell. `packages/db/scripts/object-ddl.ts`.
- **A cell column whose rows share one schema says it: JSON through
  `json(schema)`, a flag a boolean, a vocabulary an enum under its CHECK.** A
  bare `text` leaves each reader to pick a parser and prove the row again; a
  fields part stays text, being what its hash is of. `packages/db/src/cell/schema.ts`.
- **A purged item is a row of `purged_items`, never an `items` row emptied.**
  Both in one table make every column nullable and every query remember a
  filter. `packages/db/src/cell/schema.ts`.
- **What the cell holds once is a column of its one row, and what it counts is a
  sum of its rows.** A key-value table hands each fact back untyped, and a
  counter kept beside the rows it counts can drift. `packages/db/src/cell/schema.ts`.
