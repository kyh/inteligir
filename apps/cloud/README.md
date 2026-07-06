# @repo/cloud — vault-sync backend (Cloudflare Worker)

A Worker that implements the vault-sync protocol from `@repo/core/sync/*` over
**R2** (file bytes) + a **Durable Object** (per-vault source of truth).

## Architecture

```
apps/cloud/
  wrangler.jsonc          # Worker + R2 (VAULT_FILES) + DO (VaultCoordinator) bindings
  src/
    index.ts              # Worker entry: route match -> auth -> forward to the vault's DO
    vault-coordinator.ts  # Durable Object: owns the manifest + versions + SSE + R2 writes
    route.ts              # matchRoute(): parse the @repo/core/sync/wire routes into an ADT
    auth.ts               # authorize() — AUTH SEAM, replace with real auth
    hash.ts               # sha256Hex() — server-authoritative content hashing
  test/
    sync.test.ts          # miniflare DO + R2 in-process (@cloudflare/vitest-pool-workers)
    env.d.ts              # types cloudflare:test's env from the Worker's Env
```

- **One DO per vault** (`env.VaultCoordinator.idFromName(vaultId)`). It owns the
  manifest in DO SQLite storage (a `files` row per path: `version`, `contentHash`,
  `size`) plus a monotonic `generation` counter. File bytes live in R2, keyed
  `${vaultId}/${path}` — the manifest is authoritative for versions/hashes.
- **Versions & optimistic concurrency**: a PUT/DELETE carries `x-base-version`.
  The DO accepts it only if it equals the path's current version (or the file is
  absent and base is `ABSENT_VERSION`), then bumps the per-file version +
  generation. A mismatch returns `version-conflict` **as a value at HTTP 200**
  (never an error status), mirroring `SyncPort`.
- **Race-free**: all mutations run through an in-memory promise-chain mutex, and
  SQLite's synchronous API makes the version read+bump atomic — two puts on the
  same base can't both win. Bytes are written to R2 before the manifest row
  commits (deletes remove the row first), so the manifest never points at a
  missing blob.
- **Changes stream**: `GET …/changes` is Server-Sent Events (`text/event-stream`).
  The DO holds each subscriber's stream controller and pushes a `formatChangeFrame`
  frame on every mutation; the controller is dropped on disconnect.
- **Auth**: `src/index.ts` parses the bearer token and calls `authorize(token,
vaultId)`. It is a STUB (`token === vaultId`) — **replace it with real auth**
  (see `src/auth.ts`).

## Local development

```bash
pnpm --filter @repo/cloud dev        # wrangler dev (local R2 + DO simulation)
pnpm --filter @repo/cloud test       # vitest against a real in-process miniflare
pnpm --filter @repo/cloud typecheck  # tsc --noEmit
pnpm --filter @repo/cloud cf-typegen # regenerate worker-configuration.d.ts after config changes
```

## Deploy (run by the account owner)

Deploying needs your Cloudflare account (`wrangler login` first). The R2 bucket
must exist; its name matches `r2_buckets[0].bucket_name` in `wrangler.jsonc`.

```bash
# 1. Authenticate (once)
wrangler login

# 2. Create the R2 bucket the Worker binds to (once)
wrangler r2 bucket create inteligir-vault-files

# 3. Deploy the Worker + Durable Object (creates the DO on first deploy)
pnpm --filter @repo/cloud deploy      # == wrangler deploy

# (optional) tail logs
wrangler tail inteligir-cloud
```

`wrangler deploy` applies the `v1` DO migration (`new_sqlite_classes`)
automatically on first deploy. Before wiring real clients, replace the auth stub
in `src/auth.ts`.
