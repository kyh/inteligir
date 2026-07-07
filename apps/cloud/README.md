# @repo/cloud — vault-sync backend (Cloudflare Worker)

A Worker that implements the vault-sync protocol from `@repo/core/sync/*` over
**R2** (file bytes) + a **Durable Object** (per-vault source of truth), with
authentication served in-process by **Better Auth** over **D1**.

## Architecture

```
apps/cloud/
  wrangler.jsonc          # Worker + R2 (VAULT_FILES) + DO (VaultCoordinator) + D1 (DB) bindings
  drizzle.config.ts       # drizzle-kit: generate the D1 migration SQL from the schema
  src/
    index.ts              # Worker entry: /api/auth/* (Better Auth) + /v1/vault/* (sync) + CORS
    vault-coordinator.ts  # Durable Object: owns the manifest + versions + SSE + R2 writes
    route.ts              # matchRoute(): parse the @repo/core/sync/wire routes into an ADT
    hash.ts               # sha256Hex() — server-authoritative content hashing
    env.d.ts              # types the runtime secrets (AUTH_SECRET, OAuth) onto Env
    auth/auth.ts          # createAuth(env, baseURL): per-request Better Auth (Drizzle+D1, bearer)
    db/
      schema.ts           # Drizzle schema: Better Auth tables + vault_owner (ownership)
      client.ts           # createDb(d1): per-request Drizzle client over the D1 binding
      migrations/         # drizzle-kit generated SQL (applied by wrangler + tests)
  test/
    sync.test.ts          # miniflare DO + R2 + D1 in-process (@cloudflare/vitest-pool-workers)
    apply-migrations.ts   # applies the D1 migration SQL to each test file's database
    env.d.ts              # types cloudflare:test's env (+ the test-only TEST_MIGRATIONS binding)
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

- `src/auth/auth.ts::createAuth(env)` builds a **per-request** Better Auth instance
  (D1 is a runtime binding, not a module singleton). Plugins: **bearer** (clients
  authenticate with `Authorization: Bearer <token>` — the token comes back in the
  `set-auth-token` header on sign-in/up) and **expo** (mobile). Email+password is
  enabled; the `socialProviders` seam turns on GitHub when `GITHUB_CLIENT_ID` +
  `GITHUB_CLIENT_SECRET` are set.
- The auth tables live in **D1** (`DB` binding) via the Drizzle adapter
  (`provider: "sqlite"`). Schema in `src/db/schema.ts`; migration SQL in
  `src/db/migrations/` (regenerate with `pnpm --filter @repo/cloud db:generate`).
- **Ownership** (`vault_owner` table): the first authenticated user to touch a
  `vaultId` claims it. A sync request for a claimed vault by a different user → 403;
  no/invalid bearer token → 401.

### CORS

Desktop (Electron) and mobile (Expo) call cross-origin, so every response carries
CORS headers, `OPTIONS` is answered as a preflight, and `x-vault-version` /
`x-vault-content-hash` / `set-auth-token` are exposed.

## Local development

```bash
pnpm --filter @repo/cloud dev         # wrangler dev (local R2 + DO + D1 simulation)
pnpm --filter @repo/cloud test        # vitest against real in-process miniflare (applies D1 migrations)
pnpm --filter @repo/cloud typecheck   # tsc --noEmit
pnpm --filter @repo/cloud db:generate # regenerate src/db/migrations after a schema change
pnpm --filter @repo/cloud cf-typegen  # regenerate worker-configuration.d.ts after config changes
```

## Deploy (run by the account owner)

Deploying needs your Cloudflare account (`wrangler login` first).

```bash
# 1. Authenticate (once)
wrangler login

# 2. Create the R2 bucket the Worker binds to (once)
wrangler r2 bucket create inteligir-vault-files

# 3. Create the D1 auth database (once) and paste the printed database_id into
#    wrangler.jsonc -> d1_databases[0].database_id (replace the 0000… placeholder)
wrangler d1 create inteligir-auth

# 4. Apply the auth + vault_owner migrations to the remote D1
wrangler d1 migrations apply inteligir-auth --remote

# 5. Set the runtime secrets (NOT committed). AUTH_SECRET is a DEDICATED signing
#    key — generate a fresh random 32+ char value, don't reuse another key.
wrangler secret put AUTH_SECRET                 # e.g. `openssl rand -base64 32`
#    Optional GitHub OAuth (only if you enable the provider):
# wrangler secret put GITHUB_CLIENT_ID
# wrangler secret put GITHUB_CLIENT_SECRET

#    (No BETTER_AUTH_URL to set — the auth baseURL is derived per-request from
#    the request origin, so localhost/preview/prod all work with no config.)

# 6. Deploy the Worker + Durable Object (creates the DO on first deploy)
pnpm --filter @repo/cloud deploy       # == wrangler deploy

# (optional) tail logs
wrangler tail inteligir-cloud
```
