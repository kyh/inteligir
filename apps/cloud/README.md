# @repo/cloud — vault-sync backend (Cloudflare Worker)

A Worker that implements the vault-sync protocol from `@repo/domain/sync/*` over
**R2** (file bytes) + a **Durable Object** (per-vault source of truth), with
authentication served in-process by **Better Auth** over **D1**.

## Architecture

```
apps/cloud/
  wrangler.jsonc          # Worker + R2 (VAULT_FILES) + DO (VaultCoordinator) + D1 (DB) bindings
  drizzle.config.ts       # drizzle-kit push -> REMOTE D1 (d1-http); *.local.ts -> local miniflare D1
  src/
    index.ts              # Worker entry: /api/auth/* (Better Auth) + /v1/vault/* (sync) + CORS
    vault-coordinator.ts  # Durable Object: owns the manifest + versions + SSE + R2 writes
    route.ts              # matchRoute(): parse the @repo/domain/sync/wire routes into an ADT
    hash.ts               # sha256Hex() — server-authoritative content hashing
    env.d.ts              # types the runtime secrets (BETTER_AUTH_SECRET, OAuth) onto Env
    auth/auth.ts          # createAuth(env, baseURL): per-request Better Auth (Drizzle+D1, bearer)
    db/
      schema.ts           # Drizzle schema: Better Auth tables + vault_owner (ownership)
      client.ts           # createDb(d1): per-request Drizzle client over the D1 binding
  test/
    sync.test.ts          # miniflare DO + R2 + D1 in-process (@cloudflare/vitest-pool-workers)
    apply-schema.ts       # applies the exported schema DDL to each test file's D1
    env.d.ts              # types cloudflare:test's env (+ the test-only TEST_SCHEMA binding)
```

### Sync (`/v1/vault/*`)

- **One DO per vault** (`env.VaultCoordinator.idFromName(vaultId)`). It owns the
  manifest in DO SQLite storage (a `files` row per path: `version`, `contentHash`,
  `size`) plus a monotonic `generation` counter. File bytes live in R2, keyed
  `${vaultId}/${path}` — the manifest is authoritative for versions/hashes.
- **Versions & optimistic concurrency**: a PUT/DELETE carries `x-base-version`.
  A mismatch returns `version-conflict` **as a value at HTTP 200** (never an error
  status), mirroring `SyncPort`.
- **Race-free**: all mutations run through an in-memory promise-chain mutex; bytes
  are written to R2 before the manifest row commits.
- **Changes stream**: `GET …/changes` is Server-Sent Events.

### Auth (`/api/auth/*`) — Better Auth on the Worker

- `src/auth/auth.ts::createAuth(env, baseURL)` builds a **per-request** Better Auth
  instance (D1 is a runtime binding, not a module singleton; `baseURL` is the
  request origin). Plugin: **bearer** (clients authenticate with `Authorization:
Bearer <token>` — the token comes back in the `set-auth-token` header on
  sign-in/up). Email+password is enabled; the `socialProviders` seam turns on
  GitHub/Google when the matching `*_CLIENT_ID` + `*_CLIENT_SECRET` pair is set.
- **Desktop social handoff** (`src/auth/desktop-session.ts`): the OAuth flow's
  browser leg lands on `GET /v1/auth/desktop-callback?state=…` (session cookie
  just set by Better Auth), which mints a **90s single-use** code (stored
  hashed in D1, `desktop_auth_code`) and launches
  `inteligir://session?code&state` — the deep link never carries a token.
  `POST /v1/auth/exchange` burns the code (rate-limited 10/60s per IP) and
  returns the session bearer.
- The auth tables live in **D1** (`DB` binding) via the Drizzle adapter
  (`provider: "sqlite"`). Schema in `src/db/schema.ts`, applied with `drizzle-kit
push` — no migration files (`pnpm db:push:local` / `db:push:remote`).
- **Ownership** (`vault_owner` table): the first authenticated user to touch a
  `vaultId` claims it. A sync request for a claimed vault by a different user → 403;
  no/invalid bearer token → 401.

### CORS

Desktop (Electron) and mobile (Expo) call cross-origin, so every response carries
CORS headers, `OPTIONS` is answered as a preflight, and `x-vault-version` /
`x-vault-content-hash` / `set-auth-token` are exposed.

## Local development

```bash
pnpm --filter @repo/cloud dev          # wrangler dev (local R2 + DO + D1 simulation)
pnpm --filter @repo/cloud db:push:local # push the schema to the local miniflare D1 (run `dev` once first)
pnpm --filter @repo/cloud test         # vitest vs in-process miniflare (schema exported from schema.ts)
pnpm --filter @repo/cloud typecheck    # tsc --noEmit
pnpm --filter @repo/cloud cf-typegen   # regenerate worker-configuration.d.ts after config changes
```

## Deploy (run by the account owner)

> Provisioned 2026-07-09: R2 bucket + D1 (`database_id` in wrangler.jsonc) exist,
> schema pushed, `BETTER_AUTH_SECRET` set, worker live at
> <https://inteligir-cloud.kyh.workers.dev>. Steps 1–5 are for rebuilding from
> scratch; day-to-day redeploys only need step 6.

Deploying needs your Cloudflare account (`wrangler login` first).

```bash
# 1. Authenticate (once)
wrangler login

# 2. Create the R2 bucket the Worker binds to (once)
wrangler r2 bucket create inteligir-vault-files

# 3. Create the D1 auth database (once) and paste the printed database_id into
#    wrangler.jsonc -> d1_databases[0].database_id (replace the 0000… placeholder)
wrangler d1 create inteligir-auth

# 4. Push the schema (user/session/account/verification + vault_owner) to the
#    remote D1. No migration files — set the three creds, then push:
#      CLOUDFLARE_ACCOUNT_ID  CLOUDFLARE_DATABASE_ID  CLOUDFLARE_D1_TOKEN
#    (D1_TOKEN = a Cloudflare API token with D1 edit; DATABASE_ID = the id above)
pnpm --filter @repo/cloud db:push:remote

# 5. Set the runtime secrets (NOT committed). BETTER_AUTH_SECRET is a DEDICATED signing
#    key — generate a fresh random 32+ char value, don't reuse another key.
wrangler secret put BETTER_AUTH_SECRET                 # e.g. `openssl rand -base64 32`
#    Optional social OAuth (a provider is live only when BOTH its secrets are
#    set). In the provider console, register the authorized redirect URI
#    `https://<worker-host>/api/auth/callback/github` (or …/google):
# wrangler secret put GITHUB_CLIENT_ID
# wrangler secret put GITHUB_CLIENT_SECRET
# wrangler secret put GOOGLE_CLIENT_ID
# wrangler secret put GOOGLE_CLIENT_SECRET

#    (No BETTER_AUTH_URL to set — the auth baseURL is derived per-request from
#    the request origin, so localhost/preview/prod all work with no config.)

# 6. Deploy the Worker + Durable Object (creates the DO on first deploy)
pnpm --filter @repo/cloud deploy       # == wrangler deploy

# (optional) tail logs
wrangler tail inteligir-cloud
```
