# `@repo/web` — inteligir.com

One Cloudflare Worker serving the marketing site and the whole v3 cloud from
one origin: the TanStack Start pages, Better Auth on D1, device login, the
per-user thread-sync Durable Object, the capture inbox and the hosted vault
git remote. The wire contract is `@repo/api/cloud` — the Worker implements
it, the local app's sync client consumes it.

## Layout

```
src/
  routes/            TanStack Start file routes (SSR)
    index.tsx        The marketing page
    app/             /app/sign-in, /app/sign-up, /app/forgot-password and
                     /app/devices (the device table, client-only)
  components/        The site's own components (auth card, header, theme, orb)
  lib/               Better Auth client, session guard, site config
  worker/            The Worker's API half — its OWN tsconfig program (no DOM)
    server.ts        The deployed entry: path-splits API vs site SSR
    index.ts         The API route table (also the test suite's entry)
    auth/            Better Auth factory, invite gate, reset email + page
    device/          Device login, credential verification, /v1/account
    sync/            ThreadSyncDO + the device-authed route chokepoint
    vault/           The hosted vault git remote (durable-git behind the
                     wrapper) + the git-less /v1/vault/* read routes
    db/              Drizzle schema + client for the D1 auth database
    __tests__/       vitest-pool-workers suites (real miniflare + D1 + DO)
```

`src/worker/` compiles without `lib.dom` on purpose: workerd and the DOM both
declare `BufferSource`/`BodyInit` globally with different bounds, so one
program would typecheck the Worker against a stdlib it never runs on. That is
why the whole Worker — entry, routes, tests — lives under one directory with
its own `tsconfig.json`.

## Routes

| Route                          | Auth    | What                                                       |
| ------------------------------ | ------- | ---------------------------------------------------------- |
| `/`                            | —       | Marketing page (SSR)                                       |
| `/app/sign-in`                 | —       | Sign-in (SSR when signed out — see `lib/session-guard.ts`) |
| `/app/sign-up`                 | —       | Sign-up form; submits to the invite gate                   |
| `/app/forgot-password`         | —       | Requests the reset link                                    |
| `/app/devices`                 | session | The device table: list and revoke                          |
| `/api/auth/*`                  | —       | Better Auth (email+password, bearer)                       |
| `/auth/reset`                  | —       | The ONE reset page — Worker-served, static, `no-store`     |
| `/v1/auth/sign-up`             | —       | The invite gate in front of Better Auth's sign-up          |
| `POST /v1/device/login`        | —       | Email + password in, the durable device credential out     |
| `GET /v1/device/list`          | session | The device table (revoked rows included)                   |
| `POST /v1/device/revoke`       | session | Cut a device off — bites on its next request               |
| `POST /v1/sync/push`           | device  | Outbox batch in — idempotent, conflict-aware               |
| `GET /v1/sync/pull`            | device  | Page the merged log by global `seq`                        |
| `GET /v1/sync/ws`              | device  | Invalidation socket (Bearer on the upgrade; hibernatable)  |
| `POST /v1/capture`             | device  | Quick capture in, deduped on an idempotency key            |
| `POST /v1/sync/captures/claim` | device  | Take the inbox for a five-minute window                    |
| `POST /v1/sync/captures/ack`   | device  | Delete what that claim owns — per-id outcomes              |
| `/v1/git/vault.git/*`          | device  | The hosted vault git remote — smart HTTP, per-user repo    |
| `GET /v1/vault/tree`           | device  | Flat listing of the hosted vault at one commit             |
| `GET /v1/vault/file`           | device  | One note's bytes at that commit — 2 MB ceiling             |
| `GET /v1/vault/asset`          | device  | One embedded binary at that commit                         |
| `GET /v1/account`              | device  | Whose account this device credential syncs as              |

"device" auth is the `igd_…` credential a login minted, verified per request by
hash compare against D1 — never cached, so revocation is immediate. The
VERIFIED credential's userId — never a path or a body — names the state it
reaches: the sync and capture routes fan out to that user's own
`ThreadSyncDO`, the git remote and the `/v1/vault/*` reads to that user's own
durable-git `RepoCell`, and `/v1/account` reads D1 directly.

## Auth

- `src/worker/auth/auth.ts::createAuth(env, baseURL)` builds a **per-request**
  Better Auth instance (D1 is a runtime binding, not a module singleton;
  `baseURL` is the request origin, so localhost/preview/prod all work with no
  config). Plugin: **bearer** — clients may authenticate with
  `Authorization: Bearer <token>`; the token comes back in the `set-auth-token`
  header on sign-in/up.
- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`src/worker/auth/invite.ts`). `POST /v1/auth/sign-up` claims the code in one
  atomic `UPDATE … WHERE redeemed_at IS NULL`, then forwards into the one
  instance built with sign-up enabled — so the response (cookie,
  `set-auth-token`, validation errors) is Better Auth's own, untouched. Every
  other caller's instance carries `disableSignUp`, which shuts
  `/api/auth/sign-up/email` and `auth.api.signUpEmail` together.
- **A device signs in with the account's own email and password**
  (`src/worker/device/login.ts`, the Obsidian Sync model). `POST /v1/device/login`
  verifies the pair through `auth.api.signInEmail`, mints the `igd_…` credential
  under the twenty-device cap, and DELETES the browser session that sign-in
  created — the device holds its credential and nothing else, and a session
  nobody sees is a bearer nobody revokes. A wrong password and an unknown
  address answer one `invalid-credentials`, throttled
  per address; `/app/devices` is where a credential is revoked.
- **Rate limits live in D1** (`rate_limit` table): Better Auth's own database
  limiter on the auth routes, and the same table behind the invite gate's and
  the device login's 10/60s-per-IP windows (`src/worker/rate-limit.ts`). The
  window is one upsert that RETURNS the count it settled on — a read-then-write
  limiter lets N concurrent requests all read the same count and all decide
  they are under the cap, which is the burst it exists to stop.
- **No CORS**, deliberately: every browser client is served by this Worker from
  this origin, and a native client is not subject to CORS at all. If CORS is
  ever reintroduced, `access-control-allow-credentials` must stay absent — the
  auth surface is cookie-bearing.
- **Deleting the account deletes the account's data** in a `beforeDelete` hook,
  so a failed step aborts the deletion rather than orphaning data. THE ORDER IS
  LOAD-BEARING: device rows first (while one lives its credential still
  verifies, and a request on it can rebuild whatever was deleted before it),
  then the hosted vault git repo, then the
  ThreadSyncDO — purged whole and TOMBSTONED, which refuses the request that
  authenticated microseconds before step one — then the deleted email off the
  invite it spent (`redeemed_at` stays set, so the code stays burned).
  `docs/privacy.md` is the user-facing statement of all of it.

Minting invites is `wrangler d1 execute`, deliberately — no admin UI, no
self-serve issuance:

```bash
# local (miniflare)
pnpm --filter @repo/web exec wrangler d1 execute inteligir-auth --local \
  --command "INSERT INTO invite_code (code) VALUES ('DEV-INVITE-001')"
# production
wrangler d1 execute inteligir-auth --remote \
  --command "INSERT INTO invite_code (code) VALUES ('...')"
```

## Dev

```bash
cp .dev.vars.example .dev.vars    # set BETTER_AUTH_SECRET to anything
pnpm dev:web                      # vite + miniflare on :5174 (pinned, strictPort)

# The local D1 file is materialized lazily, on the first request that touches
# the binding — `dev` alone does not create it. So hit one, THEN push:
curl -s -o /dev/null localhost:5174/api/auth/get-session
pnpm --filter @repo/web db:push:local
```

> **Never run `db:push` or `db:studio`.** Both load `drizzle.config.ts`
> (`driver: "d1-http"`) with the root `.env.production.local` creds and hit the
> PRODUCTION D1. The only local command is `db:push:local`.

Tests run in a real in-process Workers runtime (`@cloudflare/vitest-pool-workers`)
against the same D1 binding wrangler.jsonc declares; the schema DDL is derived
from `src/worker/db/schema.ts` at config load (see `vitest.config.ts`).

## Build & deploy (owner-only)

```bash
# 1. Authenticate (once)
wrangler login

# 2. Create the D1 auth database (once) and paste the printed database_id into
#    wrangler.jsonc -> d1_databases[0].database_id
wrangler d1 create inteligir-auth

# 3. Push the schema to the remote D1. No migration files — put the three creds
#    in the root .env.production.local (see .env.example), then:
pnpm --filter @repo/web db:push

# 4. Set the runtime secrets (NOT committed). BETTER_AUTH_SECRET is a DEDICATED
#    signing key — generate a fresh random 32+ char value, don't reuse another.
wrangler secret put BETTER_AUTH_SECRET

# 5. Password reset. Until the sending domain is onboarded, every reset email
#    fails server-side and is only logged — the request response stays neutral
#    on purpose. Onboard it, then set the sender if the verified domain is not
#    the default `inteligir.app`:
wrangler email sending enable <verified-domain>   # then the DKIM/SPF DNS
# wrangler secret put RESET_FROM_ADDRESS          # e.g. no-reply@<verified-domain>

# 6. The vault pack bucket (once — the R2 binding refuses to deploy without it)
wrangler r2 bucket create inteligir-vault

# 7. Deploy — the exact command the `Deploy` workflow runs
pnpm turbo run build --filter=@repo/web... && pnpm -F @repo/web exec wrangler deploy

# (optional) tail logs
wrangler tail inteligir-web
```

The GitHub `Deploy` workflow runs the same command on push to main, gated on
CI. It does NOT apply the schema: the schema reaches production only from a
local machine (step 3), so push it BEFORE merging a change that needs it — the
schema is additive, so an old Worker against a new database ignores what it
does not know, while a new Worker against an old database 500s on every
request touching a table that isn't there. The workflow's one secret is
`CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, plus Workers Routes: Edit on
the inteligir.com zone).
