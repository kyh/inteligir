# @repo/db

The D1 accounts database: Better Auth's tables, the invite codes and the
connector's revoked grants as one drizzle schema, the client the Worker opens
over its binding, and the drizzle-kit configs that push the schema. The
Worker's code (`@repo/service`) imports both; nothing else ships them.

## Layout

```
src/d1/schema.ts         # the ONE schema, as Better Auth's generator prints it
src/d1/client.ts         # createDb: drizzle over the D1 binding
drizzle.config.ts        # the remote D1, over d1-http (owner only)
drizzle.config.local.ts  # the local Worker's miniflare D1 file
```

## Scripts

- `pnpm --filter @repo/db run --silent export` prints the schema's DDL, which
  `@repo/service`'s suites and the e2e harness apply as one D1 batch.
- `pnpm --filter @repo/db push` and `studio` reach the local D1, the file
  `pnpm dev:web` keeps under `apps/web/.wrangler/state`; it appears on the
  first request that touches D1 (`AGENTS.md` § Quickstart).

> **Never run `push:remote` or `studio:remote`.** Both load
> `drizzle.config.ts` with the root `.env.production.local` creds and hit the
> PRODUCTION D1.

No migration files: the schema ships by `drizzle-kit push`, and a unique is a
named unique index, never `.unique()` (`apps/web/CLAUDE.md`, The D1 auth
schema ships via `drizzle-kit push`).
