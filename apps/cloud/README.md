# @repo/cloud — vault-sync backend (Cloudflare Worker)

A Worker that implements the vault-sync protocol from `@repo/notes/sync/*` over
**R2** (file bytes) + a **Durable Object** (per-vault source of truth), with
authentication served in-process by **Better Auth** over **D1**.

## Architecture

```
apps/cloud/
  wrangler.jsonc          # Worker + R2 (VAULT_FILES) + DO (VaultCoordinator) + D1 (DB) bindings
  drizzle.config.ts       # drizzle-kit push -> REMOTE D1 (d1-http); *.local.ts -> local miniflare D1
  src/
    index.ts              # Worker entry: /api/auth/* (Better Auth) + /v1/vault/* (sync) + CORS
    vault-coordinator.ts  # Durable Object: owns the manifest + versions + SSE + R2 writes + the device roster
    route.ts              # matchRoute(): parse the @repo/notes/sync/wire routes into an ADT
    device-assertion.ts   # parse + verify a device assertion — the ONE module the Worker and DO share
    device-body.ts        # boundary parsers for the enroll/revoke request bodies
    rate-limit.ts         # fixed-window budget over the shared rate_limit D1 table
    hash.ts               # sha256Hex()/sha256Bytes() — server-authoritative content hashing
    log.ts                # logUnhandled() — the structured error line both fetch entries emit
    env.d.ts              # types the OPTIONAL runtime vars onto Env (the required one is generated)
    auth/auth.ts          # createAuth(env, baseURL): per-request Better Auth (Drizzle+D1, bearer)
    auth/desktop-session.ts # the desktop social handoff: mint/burn the single-use exchange code
    auth/reset-page.ts    # the password-reset form the emailed link lands on
    auth/reset-email.ts   # sends that link over the EMAIL binding (Cloudflare Email Sending)
    db/
      schema.ts           # Drizzle schema: Better Auth tables + vault_owner (ownership)
      client.ts           # createDb(d1): per-request Drizzle client over the D1 binding
  test/
    sync.test.ts          # miniflare DO + R2 + D1 in-process (@cloudflare/vitest-pool-workers)
    e2e-sync.test.ts      # the real @repo/notes engine against the real Worker, in-process
    device-identity.test.ts # founding, enrollment, replay, revocation, clock skew, forged headers
    device-helpers.ts     # a test-side Ed25519 device that mints REAL assertions
    desktop-session.test.ts # the code mint/exchange path (state check, single use, TTL)
    password-reset.test.ts  # request → token → reset over real Better Auth, with a mock EMAIL binding
    apply-schema.ts       # applies the exported schema DDL to each test file's D1
    env.d.ts              # types cloudflare:test's env (+ the test-only TEST_SCHEMA binding)
```

### Sync (`/v1/vault/*`)

- **One DO per vault** (`env.VaultCoordinator.getByName(vaultId)`). It owns the
  manifest in DO SQLite storage (a `files` row per path: `version`, `contentHash`,
  `size`). File bytes live in R2, keyed
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
push` — no migration files (`pnpm db:push:local` / `db:push`).
- **Ownership** (`vault_owner` table): the first authenticated user to touch a
  `vaultId` claims it. A sync request for a claimed vault by a different user → 403;
  no/invalid bearer token → 401.

### Device keys (`/v1/vault/:vaultId/{enroll-offer,enroll,devices,revoke}`)

The second, account-free identity model, running **alongside** the one above.
A bearer that parses as a device assertion is judged as one; anything else goes
to Better Auth — except on a `v1…` vaultId, where a session is refused outright
(`401 device-credential-required`) so an account cannot claim a vault no device
founded. Every account-model vaultId is a UUID, so nothing live is affected.
The device routes accept only device credentials, so neither model reaches into
the other.

- **A vaultId is the fingerprint of its founding key** —
  `"v1" + base32lower(sha256(rawEd25519PublicKey))`, `^v1[a-z2-7]{52}$`. Claiming
  someone else's vault is a preimage problem, not a race to be first.
- **The credential is a self-issued 5-minute assertion**, not a minted token:
  `base64url({v,vid,dev,iat,exp}) + "." + base64url(Ed25519 signature)` over a
  domain-separated prefix (`@repo/notes/sync/wire`). It is `Authorization:
Bearer <string>` like everything else, which is why `HttpSyncPort` needed
  nothing but `getToken` per request.
- **Verification is split and neither half trusts the other's word.** The
  Worker checks shape, signature, the time window and `vid` — statelessly, before
  `getByName`, which is what stops an unauthenticated caller instantiating DOs by
  naming strings. The DO re-parses the same raw header and adds the one question
  only it can answer: is this key on my `devices` roster? There is deliberately
  no `x-device`-style forwarded verdict to forge.
- **This is why the DO now authenticates at all.** It holds the ownership record,
  so it is the only component that can answer membership without an extra hop —
  a membership question about its own state, not a second credential check.
- **Founding is arithmetic**: an empty roster admits exactly the key whose
  digest reproduces the DO's own name. The DO also admits a session-authorized
  request while its roster is empty — reachable only for a UUID vault (that is
  every vault today), since the Worker refuses a session on a `v1…` id; the
  first device to found takes that door away too.
- **A 403 never says whether a vault has been founded.** An unenrolled key and a
  non-founding key on an empty roster get the SAME `device-not-enrolled`;
  distinguishing them would make any key holder a prober of founding state.
- **Growth is by signature.** An enrolled device POSTs `enroll-offer` with
  `sha256hex(secret)` — the server never holds the secret. The joining device
  POSTs `enroll` with the secret itself, **unauthenticated by design**. Wrong,
  expired, already-consumed and over-the-attempt-budget all answer an identical
  `{ok:false}`, so the route is not an offer-existence oracle. It is gated on
  the vaultId's shape and on a **10/60s-per-IP budget in the Worker**, both
  _before_ `getByName`. The secret itself must decode
  to **≥ 32 bytes** (`MIN_ENROLL_SECRET_BYTES`) — the server cannot check
  randomness, but a short preimage of the stored `sha256hex(secret)` is
  searchable, so length is refused at both ends.
- **A stranger can instantiate an empty Durable Object.** Anyone can generate a
  keypair offline and self-sign an assertion naming any well-shaped `v1…` id; the
  signature verifies against the key inside it, so the Worker has nothing to
  object to and the DO runs before answering `device-not-enrolled`. Closing it
  would need the roster, which lives in the DO — until it is consulted, an
  enrolled non-founding device and a stranger are the same request. Accepted: the
  cost is a DO with three empty tables, never vault access. The shape gate and the
  enroll budget bound the malformed and credential-free cases only.

- **Revocation is a tombstone**, never a `DELETE` — a replayed offer must not
  resurrect a key — and it **closes every open SSE subscriber**, because the DO
  cannot tell which stream belongs to the revoked device. Honest ones reconnect
  and re-authenticate. Revoking the **last live device is refused**
  (`{ok:false, reason:"last-device"}`): a vault with no live key can neither
  authenticate nor enroll, so that one tombstone strands the DO and its R2 prefix
  permanently. Leaving is a client-side "disconnect this vault", not a revoke.
- **Clock skew is a liveness dependency.** A 401's body carries the reason
  (`assertion-expired`, `assertion-not-yet-valid`, …) so a client can say "check
  this device's clock" rather than "sign in again" — there is no sign-in to offer.
- **Accepted residual: an assertion is replayable across routes.** It binds the
  vault and a ≤5-minute window, but NOT the method, path or body — so a captured
  `Authorization` header is good on **every route of that vault** until it
  expires: `GET manifest`, `GET/PUT/DELETE file`, `GET changes`, `POST
enroll-offer`, `GET devices` and `POST revoke`. Concretely, within those minutes
  a captured header can read and overwrite any file, mint a pairing offer that
  enrolls an attacker's key permanently, and tombstone devices (all but the
  last). TLS is what keeps the header off the wire; the fix, if that stops being
  enough, is to cover the request in the signature — the seam is
  `deviceAssertionSignedBytes` in `@repo/notes/sync/wire`, whose
  domain-separated prefix exists precisely so a second signed shape can be added
  without either being replayable as the other.

### CORS

Desktop (Electron) and mobile (Expo) call cross-origin, so every response carries
CORS headers, `OPTIONS` is answered as a preflight, and `x-vault-version` /
`x-vault-content-hash` / `set-auth-token` are exposed.

## Local development

```bash
pnpm --filter @repo/cloud dev          # wrangler dev (local R2 + DO + D1 simulation)
pnpm --filter @repo/cloud db:push:local # push the schema to the local miniflare D1 (see below)
pnpm --filter @repo/cloud test         # vitest vs in-process miniflare (schema exported from schema.ts)
pnpm --filter @repo/cloud typecheck    # tsc --noEmit
pnpm --filter @repo/cloud cf-typegen   # regenerate worker-configuration.d.ts after config changes
```

`db:push:local` needs the miniflare D1 file to exist, and `dev` alone does not
create it — miniflare materializes it lazily on the first request that touches
the binding. So: start `dev`, hit a D1 route
(`curl -s -o /dev/null localhost:8787/api/auth/get-session`), _then_ push. The
full recipe, including creating an account, is in AGENTS.md § "There is no
seeded login".

> **Never run `db:push` or `db:studio`.** Both go through `drizzle.config.ts`
> (`driver: "d1-http"`) at the PRODUCTION D1 — `db:studio` is a read/write UI
> over the same database. The local one is `db:push:local`.

## Deploy (run by the account owner)

> **Already provisioned.** The R2 bucket and D1 (`database_id` in
> wrangler.jsonc) exist, the schema is pushed, `BETTER_AUTH_SECRET` is set, and
> the worker is live at <https://inteligir-cloud.kyh.workers.dev>. Steps 1–5 are
> for rebuilding from scratch; day-to-day redeploys only need step 6.

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
#    remote D1. No migration files — put the three creds in the root
#    .env.production.local (see .env.example), then push:
#      CLOUDFLARE_ACCOUNT_ID  CLOUDFLARE_DATABASE_ID  CLOUDFLARE_D1_TOKEN
#    (D1_TOKEN = a Cloudflare API token with D1 edit; DATABASE_ID = the id above)
pnpm --filter @repo/cloud db:push

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
