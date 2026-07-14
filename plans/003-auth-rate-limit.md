# Plan 003: Add effective rate limiting to the cloud auth endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/cloud/src`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

`/api/auth/sign-in/email` is effectively unthrottled. Better Auth's default rate limiter stores counters in instance memory, and this Worker constructs a **fresh Better Auth instance per request** (a deliberate pattern — D1 is a runtime binding), so the counter store is recreated empty on every request and never accumulates. Result: unlimited online password guessing and credential stuffing. Because the first authenticated user to touch a vaultId owns it and vault bytes sync to R2, a cracked account yields the victim's entire synced vault. This is defensive hardening on the only public server surface the product has.

## Current state

- `apps/cloud/src/auth/auth.ts:64-74` — the instance factory; no `rateLimit` key:

```ts
export function createAuth(env: Env, baseURL: string) {
  return betterAuth({
    database: drizzleAdapter(createDb(env.DB), { provider: "sqlite" }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    plugins: [bearer()],
    emailAndPassword: { enabled: true },
    trustedOrigins: trustedOrigins(env),
    ...socialProviders(env),
  });
}
```

- `apps/cloud/src/index.ts:86-98` — per-request construction, twice (auth handler + sync session check):

```ts
if (url.pathname.startsWith("/api/auth/")) {
  return withCors(request, await createAuth(env, url.origin).handler(request));
}
...
const auth = createAuth(env, url.origin);
const authResult = await auth.api.getSession({ headers: request.headers });
```

- The per-request-instance pattern is DOCUMENTED as deliberate (`auth.ts:6-8` comment) — do not fight it; give the limiter durable storage instead.
- Better Auth version: `catalog:` in `apps/cloud/package.json` (1.6.x line — check `pnpm why better-auth` for the exact resolved version).
- Better Auth supports `rateLimit: { enabled, window, max, storage, customStorage }` where `storage: "secondary-storage"` uses the instance's `secondaryStorage` (a get/set/delete KV-shaped interface). On Workers, a KV namespace binding is the natural backing. Consult the Better Auth docs for the exact option names on the resolved version — do not guess from this plan.
- Existing bindings (`apps/cloud/wrangler.jsonc` / `worker-configuration.d.ts`): D1 `DB`, DO `VaultCoordinator`, R2. **No KV namespace yet.**
- Tests: `apps/cloud/test/` runs against real in-process miniflare (DO + R2 + D1 + Better Auth) — new bindings must be added to the test environment config too (see `apps/cloud/vitest.config.ts` for how bindings are declared).
- Deploy is owner-only (`apps/cloud/README.md`); this plan only changes code/config — the operator deploys.

## Commands you will need

| Purpose     | Command                                                                                                                                  | Expected                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Install     | `pnpm install`                                                                                                                           | exit 0                                  |
| Format      | `pnpm format:fix` (FIRST)                                                                                                                | exit 0                                  |
| Typecheck   | `pnpm typecheck`                                                                                                                         | exit 0                                  |
| Cloud tests | `pnpm --filter @repo/cloud test`                                                                                                         | all pass                                |
| Types regen | `pnpm --filter @repo/cloud exec wrangler types` (if the package has a types script, prefer it — check `apps/cloud/package.json` scripts) | regenerates `worker-configuration.d.ts` |

## Scope

**In scope**:

- `apps/cloud/src/auth/auth.ts`
- `apps/cloud/wrangler.jsonc` (add KV namespace binding)
- `apps/cloud/worker-configuration.d.ts` (regenerated — this file is committed by design, marked linguist-generated)
- `apps/cloud/vitest.config.ts` (test-env KV binding)
- `apps/cloud/test/` (new rate-limit test)
- `apps/cloud/README.md` (one line: the new KV binding must exist before deploy)

**Out of scope**:

- `apps/cloud/src/index.ts` routing — the per-request pattern stays.
- Turnstile/CAPTCHA — heavier UX decision, not this plan.
- Desktop/mobile clients — sign-in retry loops are user-initiated; no client change.
- Cloudflare dashboard WAF rules — operator territory, note as an option in the report.

## Git workflow

- Branch: `kyh/plan-003-auth-rate-limit`
- Conventional commit, e.g. `fix(cloud): durable rate limiting on auth endpoints`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a KV namespace binding

In `apps/cloud/wrangler.jsonc`, add a `kv_namespaces` entry (binding name `RATE_LIMIT_KV`, placeholder id with a comment that the operator must `wrangler kv namespace create` before deploy — mirror how the D1 `database_id` provisioning is annotated). Regenerate `worker-configuration.d.ts` so `Env` gains the binding.

**Verify**: `pnpm typecheck` → exit 0; `grep -n "RATE_LIMIT_KV" apps/cloud/worker-configuration.d.ts` → present.

### Step 2: Wire Better Auth's rate limiter to KV

In `createAuth`, add `secondaryStorage` backed by `env.RATE_LIMIT_KV` (get/set-with-ttl/delete mapping to `KVNamespace.get/put/delete`) and enable the limiter:

```ts
rateLimit: {
  enabled: true,           // defaults to prod-only; enable explicitly so tests exercise it
  window: 60,
  max: 20,                 // generous globally…
  storage: "secondary-storage",
},
```

Better Auth applies stricter built-in per-path caps on sensitive endpoints (sign-in) when the limiter is on — **verify the exact option names and per-route override syntax against the resolved better-auth version's docs/types** (`node_modules/better-auth/dist/**/*.d.ts`). If per-route rules need explicit config (e.g. `customRules: { "/sign-in/email": { window: 60, max: 5 } }`), add sign-in/sign-up rules at ~5/min/IP.

Keep the comment style of the file (explains WHY; notes the per-request-instance rationale). Document in the comment: memory storage is useless here because instances are per-request — that's why KV.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Test

In `apps/cloud/test/`, following the existing miniflare test pattern: hammer `/api/auth/sign-in/email` with wrong-password attempts for one email from one IP (set a fixed `x-forwarded-for` if the limiter keys on IP) and assert attempts beyond the cap return HTTP 429; assert a request under the cap still returns the normal 401-invalid-credentials.

**Verify**: `pnpm --filter @repo/cloud test` → all pass including the new test.

### Step 4: Gates + deploy note

`pnpm format:fix`, full gates. Add one line to `apps/cloud/README.md` deploy steps: create the KV namespace and paste its id into `wrangler.jsonc` before `wrangler deploy`.

**Verify**: gates exit 0.

## Test plan

Covered in Step 3. Cases: (1) N+1th bad sign-in within the window → 429; (2) under-cap behavior unchanged; (3) e2e sync test still green (the sync path's `getSession` per request must not be throttled into failure — if the limiter counts `/api/auth/get-session` style internal checks, exclude or raise that path's cap; the existing `test/e2e-sync.test.ts` will catch it).

## Done criteria

- [ ] `pnpm --filter @repo/cloud test` green, including new rate-limit test AND the existing e2e sync test
- [ ] `grep -n "rateLimit" apps/cloud/src/auth/auth.ts` → present with `enabled: true` and durable storage
- [ ] Full gates green
- [ ] `plans/README.md` updated

## STOP conditions

- The resolved better-auth version's rate limiter cannot use external storage with per-request instances (storage option missing/ignored) — report; fallback design (a DO-based limiter or Cloudflare WAF rule) is a separate decision.
- The e2e sync test starts failing 429 (bearer `getSession` being counted) and no config excludes it — report rather than raising limits to uselessness.
- miniflare's KV emulation doesn't honor TTL semantics the limiter needs — report with the failing behavior.

## Maintenance notes

- The operator must create the KV namespace before next deploy (README line added in Step 4).
- If Turnstile is ever added to sign-up, revisit the caps (bot pressure drops).
- Reviewer: check the limiter keys on IP correctly behind Cloudflare (`CF-Connecting-IP`), not on a header a client can spoof.
