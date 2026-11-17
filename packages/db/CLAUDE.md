# Decisions: @repo/db

The D1 accounts database's schema, and each library cell's, each note's and
each conversation's: D1's ships by `drizzle-kit push`, each object's as the DDL
`drizzle-kit export` prints, which it applies when it wakes.

## Schemas

- **The D1 auth schema ships via `drizzle-kit push`; there are no migration
  files.** One deployer and no users, so a history serves nobody; the suites and
  the e2e apply the committed `ddl.sql`, a snapshot `test` holds to the schema.
  `packages/db/src/d1/ddl.sql`.
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
  bare `text` leaves each reader to pick a parser and prove the row again; only
  a column its row's own schema reads, or one matched as its text, stays text: a
  job's payload by its kind, an op's answer by its op, a change set's entry.
  `packages/db/src/cell/schema.ts`.
- **A purged item is a row of `purged_items`, never an `items` row emptied.**
  Both in one table make every column nullable and every query remember a
  filter. `packages/db/src/cell/schema.ts`.
- **What the cell holds once is a column of its one row, and what it counts is a
  sum of its rows.** A key-value table hands each fact back untyped, and a
  counter kept beside the rows it counts can drift. `packages/db/src/cell/schema.ts`.

## The local database

- **`pnpm bootstrap` brings a running local Worker to a dev account, which
  signs up through the invite gate.** miniflare makes D1's file on the Worker's
  first query, so the account's sign-in goes before the push, and a row seeded
  past Better Auth skips the gate every account passes.
  `packages/db/scripts/bootstrap.ts`.
