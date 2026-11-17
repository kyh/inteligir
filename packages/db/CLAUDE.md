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
