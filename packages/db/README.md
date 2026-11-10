# @repo/db

Four kinds of database's drizzle schemas. The D1 accounts database: Better
Auth's tables, the invite codes and the connector's revoked grants, the client
the Worker opens over its binding, and the drizzle-kit configs that push the
schema. Each account's library cell, each item's note and each conversation
with the built-in agent: their SQLite tables and the migrations drizzle-kit
generates from them, which each object runs when it wakes. The
Worker's code (`@repo/service`) imports both, and the cell's columns are held
to `@repo/contract`'s vocabularies; nothing else ships them.

## Layout

```
src/d1/schema.ts         # the ONE D1 schema, as Better Auth's generator prints it
src/d1/client.ts         # createDb: drizzle over the D1 binding
src/cell/schema.ts       # the ONE cell schema: every table but the search index
src/cell/migrations/     # drizzle-kit's migrations, and the search index's own
src/note/schema.ts       # the ONE note schema: its Yjs updates, snapshot, turn log and answered ops
src/note/migrations/     # drizzle-kit's migrations for a note
src/thread/schema.ts     # the ONE conversation schema: its transcript, turns, calls and outbox
src/thread/migrations/   # drizzle-kit's migrations for a conversation
drizzle.config.ts        # the remote D1, over d1-http (owner only)
drizzle.config.local.ts  # the local Worker's miniflare D1 file
drizzle.config.cell.ts   # the cell's migrations, for the durable-sqlite driver
drizzle.config.note.ts   # a note's migrations, for the same driver
drizzle.config.thread.ts # a conversation's migrations, for the same driver
```

## Scripts

- `pnpm --filter @repo/db run --silent export` prints the D1 schema's DDL,
  which `@repo/service`'s suites and the e2e harness apply as one D1 batch.
- `pnpm --filter @repo/db push` and `studio` reach the local D1, the file
  `pnpm dev:web` keeps under `apps/web/.wrangler/state`; it appears on the
  first request that touches D1 (`AGENTS.md` § Quickstart).
- `pnpm --filter @repo/db generate:cell` writes a migration for a change to
  `src/cell/schema.ts`. The search index is an FTS5 table sqlite-core cannot
  declare, so it is a custom migration of its own
  (`drizzle-kit generate --custom`).
- `pnpm --filter @repo/db generate:note` writes a migration for a change to
  `src/note/schema.ts`.
- `pnpm --filter @repo/db generate:thread` writes a migration for a change to
  `src/thread/schema.ts`.

> **Never run `push:remote` or `studio:remote`.** Both load
> `drizzle.config.ts` with the root `.env.production.local` creds and hit the
> PRODUCTION D1.

D1 has no migration files: its schema ships by `drizzle-kit push`, and a
unique is a named unique index, never `.unique()`. A cell's schema ships as
migrations, since a Durable Object has no push, and so do a note's and a
conversation's: `@repo/service` runs them as each object wakes
(`packages/service/src/library/cell-db.ts`, `packages/service/src/note/note-db.ts`,
`packages/service/src/agent/thread-db.ts`). Why each is so is this package's
[`CLAUDE.md`](CLAUDE.md).

## Testing

The package has no suites of its own: its schemas run where they are read.
`@repo/service`'s workerd suites apply the D1 DDL `export` prints and open
every object through its migrations, so a schema change is tested by
`pnpm --filter @repo/service test`, and the e2e harness applies the same DDL
to each Worker it boots. `tools/repo-guards/src/d1-unique-index.test.ts`
refuses a `.unique()` in the D1 schema. `pnpm --filter @repo/db typecheck`
checks the schemas and the configs.
