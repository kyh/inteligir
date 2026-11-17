# @repo/service

The cloud's code, which `apps/web` serves: the environment it reads, one zod
schema in `src/env.ts`. Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md).

## Testing

One vitest project under node, with `@repo/db`'s database setup: a suite that
reaches Postgres is a `dbSuite`, which runs only with `TEST_POSTGRES_URL` set
(`packages/db/README.md` § Testing).

```bash
TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:54622/wt_<name> pnpm --filter @repo/service test
```
