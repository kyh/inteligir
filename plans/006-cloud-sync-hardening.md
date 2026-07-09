# Plan 006: Cloud sync hardening — client hash verification on GET + PUT size cap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/core/src/sync/http-sync-port.ts apps/cloud/src/vault-coordinator.ts apps/cloud/test/ packages/features/src/server/sync/sync-manager.ts apps/mobile/src/lib/sync/`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness / security
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

Two residual gaps in the sync transport. (1) The Durable Object's GET reads
the manifest row, then fetches R2 **outside the mutex**; a PUT interleaving in
that window (PUT writes R2 bytes before committing the manifest) makes GET
return NEW bytes under OLD version/hash headers — and the client trusts the
headers without hashing the received bytes, so it can anchor its base on a
mismatched hash and churn spurious pushes/conflict copies. (2) PUT buffers the
entire request body in the DO with no size limit — a self-DoS/cost hole
(DO memory is ~128 MB).

## Current state

- `packages/core/src/sync/http-sync-port.ts` `getFile` (~:84-98):

  ```ts
  async getFile(path: VaultPath): Promise<GetResult> {
    const res = await this.fetchImpl(this.url(filePath(this.vaultId, path)), { method: "GET", headers: this.headers() });
    if (res.status === 404) return { ok: false, reason: "not-found" };
    if (!res.ok) throw transportError("getFile", res.status);
    const version = parseVersionHeader(res.headers.get(HEADER_VERSION));
    const contentHash = res.headers.get(HEADER_CONTENT_HASH);
    if (version === null || contentHash === null || !isValidHash(contentHash)) {
      throw new Error("sync: getFile response missing/invalid version or content-hash headers");
    }
    const content = new Uint8Array(await res.arrayBuffer());
    return { ok: true, file: { path, contentHash, version, size: content.length }, content };
  }
  ```

- `apps/cloud/src/vault-coordinator.ts` `handleGet` (~~:137-149) reads the
  manifest row synchronously then `await this.env.VAULT_FILES.get(...)` with
  reads deliberately outside the mutex; `handlePut` (~~:154-195) does
  `const bytes = new Uint8Array(await request.arrayBuffer())` before the
  mutex, with **no size check**, then writes R2 bytes first, manifest row
  second (that ordering is correct crash-consistency — keep it).

- The engine's `Hasher` type (`packages/core/src/sync/engine.ts`):
  `type Hasher = (bytes: Uint8Array) => Promise<string>`. Desktop supplies
  `createNodeHasher()` (`sync-manager.ts`); mobile has an expo hasher in
  `apps/mobile/src/lib/sync/`. Locate where each constructs `HttpSyncPort`
  (grep `new HttpSyncPort`).

- Conflict-as-value convention: a version conflict is an HTTP-200
  `{ok:false}` VALUE, never a throw — do not change that. E2E:
  `apps/cloud/test/e2e-sync.test.ts` drives the real engine against the real
  Worker in-process (Workers vitest pool).

## Commands you will need

| Purpose     | Command                          | Expected            |
| ----------- | -------------------------------- | ------------------- |
| Core tests  | `pnpm --filter @repo/core test`  | pass                |
| Cloud tests | `pnpm --filter @repo/cloud test` | pass (includes e2e) |
| Typecheck   | `pnpm typecheck && pnpm lint`    | exit 0              |

## Scope

**In scope**:

- `packages/core/src/sync/http-sync-port.ts`
- `packages/core/src/sync/__tests__/` (port test)
- `apps/cloud/src/vault-coordinator.ts` (+ its constants/protocol file if 413 needs one)
- `apps/cloud/test/e2e-sync.test.ts` (new cases)
- `packages/features/src/server/sync/sync-manager.ts`, `apps/mobile/src/lib/sync/*` (pass the hasher at port construction — wiring only)
- `plans/README.md`

**Out of scope**:

- The PUT write ordering (bytes → manifest) — correct, keep.
- Auth (`apps/cloud/src/index.ts`) and the Better Auth surface.
- Server-side GET-under-mutex — the client-side verify is sufficient; do not
  serialize reads.

## Git workflow

- Branch: `kyh/plan-006-cloud-hardening`
- Commits: `fix(sync): verify GET bytes against the reported hash` and
  `fix(cloud): cap PUT body size (413)`

## Steps

### Step 1: Client-side hash verification in HttpSyncPort

Add an optional `hasher?: Hasher` to `HttpSyncPort`'s constructor options
(read the constructor first; follow its existing options shape). In
`getFile`, after reading `content`: if a hasher is present, compute
`await this.hasher(content)`; on mismatch with the header hash, `throw new
Error("sync: getFile bytes do not match the reported content hash (raced a
concurrent write?) — will retry next pass")`. A transport throw fails the
pass; the next pass re-pulls — that is the desired recovery.

**Verify**: `pnpm typecheck` → exit 0

### Step 2: Wire the hasher at both construction sites

Desktop (`sync-manager.ts`): pass `createNodeHasher()` (already exported
there). Mobile (`apps/mobile/src/lib/sync/`): pass its existing expo hasher.
Both changes are one argument each.

**Verify**: `pnpm typecheck && pnpm --filter @repo/features test` → pass

### Step 3: Port unit test (core)

Model after existing http-sync-port tests (grep `fetchImpl` fakes under
`packages/core/src/sync/__tests__/`). Cases: (a) body matching the header
hash → `ok: true`; (b) body NOT matching → throws with the mismatch message;
(c) no hasher supplied → current behavior (no verification) — the
mobile/desktop wiring makes "no hasher" rare, but the default must stay
backward-compatible.

**Verify**: `pnpm --filter @repo/core test` → pass

### Step 4: PUT size cap in the coordinator

In `vault-coordinator.ts`, add `const MAX_FILE_BYTES = 33_554_432; // 32 MiB`
near the other constants with a comment (DO memory ~128 MB; a vault file
larger than this should not sync). In `handlePut`, BEFORE
`request.arrayBuffer()`: parse `Content-Length`; if present and
`> MAX_FILE_BYTES`, return `new Response("file too large", { status: 413 })`.
AFTER buffering, check `bytes.length > MAX_FILE_BYTES` too (chunked bodies
have no Content-Length) and return the same 413.

**Verify**: `pnpm --filter @repo/cloud test` → existing e2e passes

### Step 5: E2E cases

In `apps/cloud/test/e2e-sync.test.ts`, following its existing request
helpers: (a) PUT with a body of `MAX_FILE_BYTES + 1` zeros → 413, and the
manifest/generation unchanged; (b) PUT at exactly `MAX_FILE_BYTES` → accepted.
(If allocating 32 MiB in the Workers test pool is slow/flaky, lower the cap
to a test-injectable constant via the DO's env/options — only if needed;
otherwise keep the literal.)

**Verify**: `pnpm --filter @repo/cloud test` → all pass

### Step 6: Gates

`pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm --filter @repo/core test && pnpm --filter @repo/cloud test && pnpm --filter @repo/features test`.

## Done criteria

- [ ] `getFile` verifies bytes against the header hash when a hasher is wired; both platforms wire one
- [ ] Oversized PUT → 413 with no manifest mutation (e2e-tested)
- [ ] Version-conflict-as-value behavior unchanged (existing e2e green)
- [ ] Gates exit 0; `plans/README.md` updated

## STOP conditions

- `HttpSyncPort`'s constructor doesn't take an options object you can extend
  without breaking its callers — report its actual shape.
- Any existing e2e test fails after Step 4 (a legitimate flow exceeds 32 MiB?).
- The mobile hasher isn't an engine-compatible `Hasher` — report, don't adapt it inline.

## Maintenance notes

- 32 MiB is a policy number — document it in `apps/cloud/README.md` if quotas
  get a section. The client currently has no pre-flight size check; a friendly
  "file too large to sync" surface can come with the conflict UX (plan 014).
- Reviewer: confirm the 413 path allocates nothing in R2 and doesn't bump
  `generation`.
