# Decisions: @repo/db

Postgres's schema, which ships by `drizzle-kit push`, and the local database
and the suites' databases it ships into.

## Postgres

- **The schema ships by `drizzle-kit push`, never a migration file, and a
  second push must plan nothing.** No users and one deployer, so a history
  serves nobody; drizzle-kit can misread what it created and fail halfway
  through the next push, so CI pushes twice. `packages/db/scripts/check-push.ts`.
- **Every table is `pgTable.withRLS(...)`, with no policy.** Supabase's API
  roles then read no table, while the app connects as the owner, whom row-level
  security does not bind; a suite fails on any pushed table without it.
  `packages/db/src/schema-rls.test.ts`.
- **Push never edits an existing index's expression, WHERE, opclass, collation
  or order, nor a CHECK's or a generated column's expression, so a changed one
  takes a new name.** drizzle-kit's push skips those in place; under a new name
  it drops the old and creates the new, a drop its plan refuses unattended, so
  the integrator runs that production push. `packages/db/src/library-schema.ts`.
- **An extension the schema leans on is a line of `sql/extensions.sql`, which
  `push` applies before drizzle-kit's.** drizzle-kit declares no extension, and
  a schema naming `unaccent` or a trigram index fails its push without it.
  `packages/db/scripts/push.ts`.
- **The client runs `prepare: false`.** Production reaches Postgres through
  Supabase's transaction pooler, which hands each transaction any server
  connection, where a statement prepared on another is missing; drizzle-kit
  alone takes the direct `POSTGRES_URL_NON_POOLING`, since its introspection
  stalls on the pooler. `packages/db/src/drizzle-client.ts`.
- **The client carries every table's relations, though none relates to
  another.** Better Auth's drizzle adapter for drizzle 1.0 finds its models in
  `db._.relations`. `packages/db/src/drizzle-relations.ts`.
- **An invite code is spent once and never deleted; deleting the account it
  made forgets only who spent it.** A deleted account's code would otherwise
  open a second one, and the address is the account's to take with it.
  `packages/db/src/auth-schema.ts`.

## The library

- **Every library table keys on `account_id` first: a root table's cascades
  from Better Auth's `user`, every other's hangs off its parent by a composite
  foreign key.** One shared database is a predicate away from another account's
  rows, and deleting a user empties its library with no purge of our own.
  `packages/db/src/library-schema.ts`.
- **Library times are `bigint` unix milliseconds and its ids text.** The
  library model spells them so on every device, so a row maps to it as it
  stands. `packages/db/src/library-schema.ts`.
- **A JSON column whose rows share one schema types it; one read through its
  row's own, a job's payload by its kind, an op's answer by its op, a change
  set's entry, stays untyped.** A typed column hands those back as a type no
  read proved. `packages/db/src/library-schema.ts`.
- **A key a link finds an item by, `title_key` and `alias_keys`, is computed in
  JS and stored.** Postgres's `lower()` folds neither Unicode form nor case as
  the library's `titleKey` does. `packages/db/src/library-schema.ts`.
- **What the library counts is a sum of its rows, and a purged item a row of
  `purged_item`.** A counter kept beside the rows it counts can drift, and a
  purged row in `item` makes every column nullable and every query filter it.
  `packages/db/src/library-schema.ts`.
- **A file's names cascade from the file.** Deleting an account reaches its
  files and the rows naming them in an order Postgres picks, which an immediate
  check fails, and drizzle declares no deferred one; a release asks after names
  itself, under the account's lock. `packages/db/src/library-schema.ts`.
