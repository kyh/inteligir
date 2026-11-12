# @repo/db

Four kinds of database's drizzle schemas. The D1 accounts database: Better
Auth's tables, the invite codes and the connector's revoked grants, the client
the Worker opens over its binding, and the drizzle-kit configs that push the
schema. Each account's library cell, each item's note and each conversation
with the built-in agent: their SQLite tables and the DDL drizzle-kit exports
from them, which each object applies when it wakes. The Worker's code
(`@repo/service`) imports both, and the cell's columns are held to
`@repo/contract`'s vocabularies; nothing else ships them.

## Layout

```
src/d1/schema.ts         # the ONE D1 schema, as Better Auth's generator prints it
src/d1/client.ts         # createDb: drizzle over the D1 binding
src/cell/schema.ts       # the ONE cell schema: every table but the search index
src/note/schema.ts       # the ONE note schema: its Yjs updates, snapshot, turn log and answered ops
src/thread/schema.ts     # the ONE conversation schema: its transcript, turns, calls and outbox
src/*/ddl.sql            # each object's DDL, written by scripts/object-ddl.ts
scripts/object-ddl.ts    # drizzle-kit's export of each object's schema, the search index appended
drizzle.config.ts        # the remote D1, over d1-http (owner only)
drizzle.config.local.ts  # the local Worker's miniflare D1 file
```

## Scripts

- `pnpm --filter @repo/db run --silent export` prints the D1 schema's DDL,
  which `@repo/service`'s suites and the e2e fixture apply as one D1 batch.
- `pnpm --filter @repo/db push` and `studio` reach the local D1, the file
  `pnpm dev:web` keeps under `apps/web/.wrangler/state`; it appears on the
  first request that touches D1 (`AGENTS.md` § Quickstart).
- `pnpm --filter @repo/db ddl` writes each object's `ddl.sql` after a change
  to its schema; `test` fails while one differs from what it would write.

> **Never run `push:remote` or `studio:remote`.** Both load
> `drizzle.config.ts` with the root `.env.production.local` creds and hit the
> PRODUCTION D1.

D1 has no migration files: its schema ships by `drizzle-kit push`, and a
unique is a named unique index, never `.unique()`. An object has no push, so
it applies its `ddl.sql` as it wakes and starts over empty when the DDL it
holds is another (`packages/service/src/object-schema.ts`). Why each is so is
this package's [`CLAUDE.md`](CLAUDE.md).

## Testing

`test` holds each committed `ddl.sql` to its schema. `@repo/service`'s workerd
suites apply the D1 DDL `export` prints and open every object through its
DDL, so a schema change is tested by `pnpm --filter @repo/service test`, and
the e2e fixture applies the same D1 DDL to each Worker it boots.
`tools/repo-guards/src/d1-unique-index.test.ts` refuses a `.unique()` in the
D1 schema. `pnpm --filter @repo/db typecheck` checks the schemas, the configs
and the script.
