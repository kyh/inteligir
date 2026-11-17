# @repo/db

Postgres: the drizzle client over `POSTGRES_URL`, the push of its schema and of
the extensions the schema leans on, the local Supabase that runs it, and the
suites' databases. Beside it until they go, the drizzle schemas of the D1
accounts database (Better Auth's tables, the invite codes, the connector's
revoked grants) with its client, and each library cell's, note's and
conversation's SQLite with the DDL each object applies as it wakes. Why each
ships as it does is this package's [`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/drizzle-client.ts      the one Postgres client, pooled, over POSTGRES_URL
src/*-schema.ts            the Postgres schema, one module per area, each table withRLS
src/test-database*.ts      dbSuite, and the vitest globalSetup and setup file that give each suite file a database
sql/extensions.sql         the extensions push applies before the schema
supabase/                  local Supabase: Postgres and its pooler alone, natively, no Docker
scripts/                   push, its second-push check; drizzle-kit's export of each object's DDL; the local Worker's D1 file and its bootstrap
src/d1/                    the ONE D1 schema, as Better Auth's generator prints it, the client over its binding, and the ddl.sql the suites apply
src/cell/, src/note/, src/thread/   each object's schema and the ddl.sql written from it
drizzle.config.ts          Postgres, on POSTGRES_URL_NON_POOLING ?? POSTGRES_URL
drizzle.config.local.ts    the local Worker's D1 file
```

## Scripts

```bash
pnpm db:start                                # local Postgres 17 on 54622, its pooler on 54629; writes POSTGRES_URL to the root .env.local
pnpm db:push                                 # sql/extensions.sql, then drizzle-kit push
pnpm --filter @repo/db push:check            # a second push must plan nothing
pnpm --filter @repo/db studio                # Drizzle Studio on local Postgres
pnpm --filter @repo/db reset                 # local Postgres emptied, then pushed
pnpm --filter @repo/db stop | status
pnpm bootstrap [port]                        # the D1 schema and the dev account, into a running pnpm dev:web (5174)
pnpm --filter @repo/db ddl                   # each object schema's ddl.sql, after a change to it
```

The scripts read the root `.env.local`, then `.env`, and a variable already set
beats both. `bootstrap` signs the dev account in, pushes D1, and signs it up on
a fresh invite when the sign-in was refused (`AGENTS.md` § Seeded login). The
sign-in comes first because miniflare makes D1's file on the Worker's first
query, and the push reads that file under this checkout's `apps/web/.wrangler`.

> **Never run `push:remote` (`pnpm db:push-remote`).** It reads the root
> `.env.production.local` and pushes the PRODUCTION Postgres.

## Testing

`test` fails while a committed `ddl.sql` differs from what its schema writes,
then runs the suites. A suite that reaches Postgres is a `dbSuite`, which runs
only with `TEST_POSTGRES_URL` set: the run makes `<its database>__<run>template`
on that server, pushes into it once, gives each suite file a clone as its
`POSTGRES_URL`, and drops them all as it ends. A workspace takes the same with
`globalSetup: ["@repo/db/test-database"]` and
`setupFiles: ["@repo/db/test-database-file"]` in its `vitest.config.ts`.

```bash
TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:54622/wt_<name> pnpm --filter @repo/db test
```

`schema-rls.test.ts` fails while any table of the pushed schema leaves row-level
security off. The D1 schema is tested by `@repo/service`'s workerd suites,
which apply D1's `ddl.sql` and open every object through its own, and lint
refuses a `.unique()` in the D1 schema (`oxlint.config.ts`).
