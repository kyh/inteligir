# @repo/service

The cloud's code, which `apps/web` serves: the environment it reads, one zod
schema in `src/env.ts`, accounts on Better Auth over Postgres, `/v1/rpc` and
the library's writes on Postgres.
Its decisions are this package's [`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/env.ts              every key the cloud reads, parsed once
src/app-url.ts          the deployment's one origin: Better Auth's baseURL, llms.txt's connector
src/rate-limit.ts       the app's own windows on Better Auth's rate_limit table
src/auth/auth.ts        the two Better Auth instances, the session reads, the token strip
src/auth/auth-route.ts  /api/auth/*: the six routes a client calls, a 404 to the rest
src/auth/invite.ts      POST /api/sign-up: claim the code, forward, release on failure
src/auth/send-email.ts  the reset mail's one transport, in EMAIL_MODE's way
src/seed.ts             pnpm db:seed: the dev account and DEV-INVITE
src/rpc/v1-rpc.ts       /v1/rpc: admit, then the rows routed so far, a fault in the protocol
src/rpc/admit.ts        the build floor, the door and its session, before a call is read
src/rpc/orpc.ts         the contract's implementer, its context the admitted principal
src/rpc/account-router.ts account.devices.* and account.delete
src/rpc/rpc-refusal.ts  a refusal or fault outside every row, in the RPC protocol
src/rpc/library-router.ts the library's rows: library/library-read-rows.ts and library-write-rows.ts
src/library/library-access.ts  reading and writing: the caller, the read-only grant, each refusal's error
src/library/library-principal.ts who a call is by: a session, a connector grant, an agent turn
src/library/library-store.ts every library write: the account's lock, the sequence, the op ledger, attempts
src/library/library-landing.ts one item's change: every rule, then its rows
src/library/library-items.ts   notes and files made, organize, Deleted and back, Deleted emptied
src/library/library-writes.ts  an item's fields landed, a device's property ops
src/library/library-folders.ts the folder tree's writes, a path filed into
src/library/library-rows.ts  an item's rows to and from the library model
src/files/file-names.ts      the files the library's rows name, and touched_at
src/search/search-vector.ts  an item's tsvector literal, from search-query.ts's tokenizer
```

`apps/web` mounts the three handlers (`src/app/api/auth/[...all]/route.ts`,
`src/app/api/sign-up/route.ts`, `src/app/v1/rpc/[...rest]/route.ts`) and reads
a page's session through `src/lib/auth-server.ts`.

## Seed

```bash
pnpm db:seed    # into the database POSTGRES_URL names (.env.local); no server needed, safe to run again
```

It makes `dev@inteligir.local` / `password` (again, if the account is there
under another password) and the open invite `DEV-INVITE`.

## Testing

One vitest project under node, with `@repo/db`'s database setup: a suite that
reaches Postgres is a `dbSuite`, which runs only with `TEST_POSTGRES_URL` set
(`packages/db/README.md` § Testing). The account suites hand requests to the
route handlers themselves, each from an address of its own, with the limiter on
and mail in log mode, where a test reads the reset link off the log.

```bash
TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:54622/wt_<name> pnpm --filter @repo/service test
```
