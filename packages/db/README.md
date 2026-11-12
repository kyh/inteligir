# @repo/db

The drizzle schemas of four kinds of database: the D1 accounts database (Better
Auth's tables, the invite codes, the connector's revoked grants) with its
client and push configs, and each library cell's, note's and conversation's
SQLite with the DDL each object applies as it wakes. `@repo/service` imports
both, and nothing else ships them. Why each ships as it does is this package's
[`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/d1/            the ONE D1 schema, as Better Auth's generator prints it, and the client over its binding
src/cell/, src/note/, src/thread/   each object's schema and the ddl.sql written from it
scripts/           drizzle-kit's export of each object's DDL, the search index appended
drizzle.config*.ts the remote D1 (owner only) and the local Worker's D1 file
```

## Scripts

```bash
pnpm --filter @repo/db push                  # the D1 schema into pnpm dev:web's local D1
pnpm --filter @repo/db studio                # browse it (mint an invite here)
pnpm --filter @repo/db ddl                   # each object's ddl.sql, after a change to its schema
pnpm --filter @repo/db run --silent export   # the D1 schema's DDL, as the suites and the e2e apply it
```

> **Never run `push:remote` or `studio:remote`.** Both load
> `drizzle.config.ts` with the root `.env.production.local` creds and hit the
> PRODUCTION D1.

## Testing

`test` fails while a committed `ddl.sql` differs from what its schema writes.
A schema change is tested by `@repo/service`'s workerd suites, which apply the
D1 DDL and open every object through its own, and
`tools/repo-guards/src/d1-unique-index.test.ts` refuses a `.unique()` in the
D1 schema.
