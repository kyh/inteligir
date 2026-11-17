# @repo/db

Postgres: Better Auth's tables and the invite codes, the drizzle client over
`POSTGRES_URL`, the push of its schema and of
the extensions the schema leans on, the local Supabase that runs it, and the
suites' databases. Why each ships as it does is this package's
[`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/drizzle-client.ts      the one Postgres client, pooled, over POSTGRES_URL
src/*-schema.ts            the Postgres schema, one module per area, each table withRLS
src/auth-schema.ts         Better Auth's tables, rate_limit and invite_code
src/drizzle-relations.ts   every table's relations, where Better Auth's adapter finds its models
src/run-databases.ts       a run's template database pushed once, its clones and their drop: the suites' and the e2e's
src/test-database*.ts      dbSuite, and the vitest globalSetup and setup file that give each suite file a database
sql/extensions.sql         the extensions push applies before the schema
supabase/                  local Supabase: Postgres and its pooler alone, natively, no Docker
scripts/                   push and its second-push check
drizzle.config.ts          Postgres, on POSTGRES_URL_NON_POOLING ?? POSTGRES_URL
```

## Scripts

```bash
pnpm db:start                                # local Postgres 17 on 54622, its pooler on 54629; writes POSTGRES_URL to the root .env.local
pnpm db:push                                 # sql/extensions.sql, then drizzle-kit push
pnpm --filter @repo/db push:check            # a second push must plan nothing
pnpm --filter @repo/db studio                # Drizzle Studio on local Postgres
pnpm --filter @repo/db reset                 # local Postgres emptied, then pushed
pnpm --filter @repo/db stop | status
```

The scripts read the root `.env.local`, then `.env`, and a variable already set
beats both.

> **Never run `push:remote` (`pnpm db:push-remote`).** It reads the root
> `.env.production.local` and pushes the PRODUCTION Postgres.

## Testing

A suite that reaches Postgres is a `dbSuite`, which runs only with `TEST_POSTGRES_URL` set: the run makes `<its database>__<run>template`
on that server, pushes into it once, gives each suite file a clone as its
`POSTGRES_URL`, and drops them all as it ends. A workspace takes the same with
`globalSetup: ["@repo/db/test-database"]` and
`setupFiles: ["@repo/db/test-database-file"]` in its `vitest.config.ts`.

```bash
TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:54622/wt_<name> pnpm --filter @repo/db test
```

`schema-rls.test.ts` fails while any table of the pushed schema leaves row-level
security off.
