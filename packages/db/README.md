# @repo/db

The drizzle schemas of four kinds of database: the D1 accounts database (Better
Auth's tables, the invite codes, the connector's revoked grants) with its
client and push configs, and each library cell's, note's and conversation's
SQLite with the DDL each object applies as it wakes. `@repo/service` imports
both, and nothing else ships them. Why each ships as it does is this package's
[`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/d1/            the ONE D1 schema, as Better Auth's generator prints it, the client over its binding, and the ddl.sql the suites apply
src/cell/, src/note/, src/thread/   each object's schema and the ddl.sql written from it
scripts/           drizzle-kit's export of each schema's DDL, the search index appended; the local Worker's D1 file and its bootstrap
drizzle.config*.ts the remote D1 (owner only) and the local Worker's D1 file
```

## Scripts

```bash
pnpm bootstrap [port]                        # the D1 schema and the dev account, into a running pnpm dev:web (5174)
pnpm --filter @repo/db push                  # the D1 schema alone, after an edit to it
pnpm --filter @repo/db studio                # browse the local D1 (another account's invite is a row here)
pnpm --filter @repo/db ddl                   # each schema's ddl.sql, after a change to it
```

`bootstrap` signs the dev account in, pushes, and signs it up on a fresh invite
when the sign-in was refused (`AGENTS.md` § Seeded login). The sign-in comes
first because miniflare makes D1's file on the Worker's first query, and `push`
and `studio` read that file under this checkout's `apps/web/.wrangler`.

> **Never run `push:remote` or `studio:remote`.** Both load
> `drizzle.config.ts` with the root `.env.production.local` creds and hit the
> PRODUCTION D1.

## Testing

`test` fails while a committed `ddl.sql` differs from what its schema writes.
A schema change is tested by `@repo/service`'s workerd suites, which apply
D1's `ddl.sql` and open every object through its own, and lint refuses a
`.unique()` in the D1 schema (`oxlint.config.ts`).
