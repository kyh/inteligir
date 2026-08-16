# `@repo/web` — inteligir.com

One Cloudflare Worker serving the marketing site and the account surface from
one origin: the TanStack Start pages, and Better Auth on D1 behind them.

## Layout

```
src/
  routes/            TanStack Start file routes (SSR)
    index.tsx        The marketing page
    app/             /app/sign-in, /app/sign-up, /app/forgot-password
  components/        The site's own components (auth card, header, theme, orb)
  lib/               Better Auth client, session guard, site config
  worker/            The Worker's API half — its OWN tsconfig program (no DOM)
    server.ts        The deployed entry: path-splits API vs site SSR
    index.ts         The API route table (also the test suite's entry)
    auth/            Better Auth factory, invite gate, reset email + page
    db/              Drizzle schema + client for the D1 auth database
    __tests__/       vitest-pool-workers suites (real miniflare + D1)
```

`src/worker/` compiles without `lib.dom` on purpose: workerd and the DOM both
declare `BufferSource`/`BodyInit` globally with different bounds, so one
program would typecheck the Worker against a stdlib it never runs on. That is
why the whole Worker — entry, routes, tests — lives under one directory with
its own `tsconfig.json`.

## Routes

| Route                  | What                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `/`                    | Marketing page (SSR)                                       |
| `/app/sign-in`         | Sign-in (SSR when signed out — see `lib/session-guard.ts`) |
| `/app/sign-up`         | Sign-up form; submits to the invite gate                   |
| `/app/forgot-password` | Requests the reset link                                    |
| `/api/auth/*`          | Better Auth (email+password, bearer, optional social)      |
| `/auth/reset`          | The ONE reset page — Worker-served, static, `no-store`     |
| `/v1/capabilities`     | Which social providers this deployment serves              |
| `/v1/auth/sign-up`     | The invite gate in front of Better Auth's sign-up          |

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
  `/api/auth/sign-up/email` and `auth.api.signUpEmail` together; each social
  provider carries its own `disableSignUp`, so a provider is a sign-in for an
  account that already linked it, never a way to get one.
- **Rate limits live in D1** (`rate_limit` table): Better Auth's own database
  limiter on the auth routes, and the same table behind the invite gate's
  10/60s-per-IP window (`src/worker/rate-limit.ts`).
- **No CORS**, deliberately: every browser client is served by this Worker from
  this origin, and a native client is not subject to CORS at all. If CORS is
  ever reintroduced, `access-control-allow-credentials` must stay absent — the
  auth surface is cookie-bearing.
- **Deleting the account** clears the deleted email off the invite it spent
  (`redeemed_at` stays set — the code stays burned) in a `beforeDelete` hook,
  so a failed step aborts the deletion rather than orphaning data.

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
#    Optional social OAuth (a provider is live only when BOTH its secrets are
#    set). Register `https://<worker-host>/api/auth/callback/github` (or
#    …/google) as the authorized redirect URI:
# wrangler secret put GITHUB_CLIENT_ID
# wrangler secret put GITHUB_CLIENT_SECRET
# wrangler secret put GOOGLE_CLIENT_ID
# wrangler secret put GOOGLE_CLIENT_SECRET

# 5. Password reset. Until the sending domain is onboarded, every reset email
#    fails server-side and is only logged — the request response stays neutral
#    on purpose. Onboard it, then set the sender if the verified domain is not
#    the default `inteligir.app`:
wrangler email sending enable <verified-domain>   # then the DKIM/SPF DNS
# wrangler secret put RESET_FROM_ADDRESS          # e.g. no-reply@<verified-domain>

# 6. Deploy
pnpm --filter @repo/web deploy       # == vite build && wrangler deploy

# (optional) tail logs
wrangler tail inteligir-web
```

The GitHub `Deploy` workflow does the same on push to main, gated on CI.
