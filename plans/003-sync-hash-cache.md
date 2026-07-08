# Plan 003: Stop re-hashing the whole vault on every sync pass (stat-keyed hash cache)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. On
> any STOP condition, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/core/src/sync/engine.ts packages/features/src/server/sync/sync-manager.ts packages/features/src/server/vault/vault.ts apps/mobile/src/lib/sync/`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-sync-listing-cap-data-loss.md (touches the same `SyncIo` seam — land 001 first)
- **Category**: perf
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

Every sync pass reads and sha-256-hashes **every file in the vault** — and a
pass runs on every debounced local save and every remote change. Cost scales
with total vault bytes, not with what changed: a 2,000-file vault re-reads
hundreds of MB per keystroke-burst. A stat-keyed cache (mtime+size+ino) makes
passes scale with the delta. The repo already uses exactly this fingerprint
pattern in the knowledge manager.

## Current state

- `packages/core/src/sync/engine.ts:~329-336`:

  ```ts
  private async buildLocalManifest(): Promise<LocalManifest> {
    const files: LocalFile[] = [];
    for (const path of this.io.list()) {
      const bytes = this.io.read(path);
      files.push({ path, contentHash: await this.hash(bytes), size: bytes.length });
    }
    return { vaultId: this.vaultId, files };
  }
  ```

- The `SyncIo` port (engine.ts:~37-48):

  ```ts
  export type SyncIo = {
    list(): readonly VaultPath[];
    read(path: VaultPath): Uint8Array;
    write(path: VaultPath, content: Uint8Array): void;
    remove(path: VaultPath): void;
  };
  ```

- The proven fingerprint pattern —
  `packages/features/src/server/knowledge/knowledge-manager.ts` bottom:

  ```ts
  function statFingerprint(absolute: string): Fingerprint | null {
    try {
      const stat = fs.statSync(absolute);
      return { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
    } catch {
      return null;
    }
  }
  ```

- Desktop adapter: `createVaultSyncIo(vault)` in
  `packages/features/src/server/sync/sync-manager.ts` (after plan 001 it calls
  `vault.listAllPaths()`). Mobile adapter: `apps/mobile/src/lib/sync/` — do NOT
  require changes there (fingerprint must be optional).
- `@repo/core` purity rule: no node imports; everything platform-specific is an
  injected port. The engine's core tests live in
  `packages/core/src/sync/__tests__/` and run against in-memory fakes — follow
  their style.

## Commands you will need

| Purpose        | Command                             | Expected |
| -------------- | ----------------------------------- | -------- |
| Core tests     | `pnpm --filter @repo/core test`     | pass     |
| Features tests | `pnpm --filter @repo/features test` | pass     |
| Typecheck/lint | `pnpm typecheck && pnpm lint`       | exit 0   |
| Format         | `pnpm format:fix` (before gates)    | exit 0   |

## Scope

**In scope**:

- `packages/core/src/sync/engine.ts`
- `packages/core/src/sync/__tests__/` (engine cache tests)
- `packages/features/src/server/sync/sync-manager.ts`
- `packages/features/src/server/vault/vault.ts` (a `statFingerprint(rel)` accessor)
- `plans/README.md`

**Out of scope**:

- `apps/mobile/**` — fingerprint stays optional; mobile keeps full re-hash for now.
- `packages/core/src/sync/reconcile.ts` — untouched.
- Persisting the cache to disk — in-memory per engine instance only.

## Git workflow

- Branch: `kyh/plan-003-sync-hash-cache`
- Commit: `perf(sync): stat-keyed hash cache — passes scale with the delta`

## Steps

### Step 1: Extend the SyncIo port with an OPTIONAL fingerprint

In `engine.ts`, add to `SyncIo`:

```ts
/** Cheap change-detection key for a file (e.g. "mtimeMs:size:ino"), or null
 * when unavailable. OPTIONAL — platforms without cheap stat omit it and the
 * engine re-hashes every file (previous behavior). A stale fingerprint must
 * be impossible: the key must change whenever content can have changed. */
fingerprint?(path: VaultPath): string | null;
```

**Verify**: `pnpm typecheck` → exit 0 (optional member — no adapter breaks)

### Step 2: Cache hashes in the engine

Add a private `hashCache = new Map<VaultPath, { fp: string; contentHash: string; size: number }>()`.
Rewrite `buildLocalManifest`:

- For each path: if `this.io.fingerprint` exists, call it. On a non-null `fp`
  matching the cached entry's `fp`, reuse `{ contentHash, size }` WITHOUT
  reading the file. Otherwise read + hash as today and store
  `{ fp, contentHash, size }` (only when `fp` is non-null).
- When `fingerprint` is absent, behavior is byte-identical to today.
- Prune: after the loop, delete cache entries whose path wasn't in this pass's
  listing (deleted files must not pin memory).
- IMPORTANT: after the engine WRITES a file (pull/conflict-copy paths call
  `this.io.write`), the cached fingerprint for that path is stale. Simplest
  correct move: `this.hashCache.delete(path)` after every `io.write` and
  `io.remove` the engine performs. Find every call site of `this.io.write` /
  `this.io.remove` in engine.ts and add the invalidation.

**Verify**: `pnpm --filter @repo/core test` → all existing engine/reconcile tests pass unchanged

### Step 3: Desktop fingerprint implementation

- In `vault.ts`, add `statFingerprint(rel: string): string | null` — resolves
  the path through the existing private `resolve()` (confinement preserved),
  `fs.statSync`, returns `` `${stat.mtimeMs}:${stat.size}:${stat.ino}` ``,
  `null` on any error. Mirror the knowledge-manager helper.
- In `sync-manager.ts` `createVaultSyncIo`, add
  `fingerprint: (path) => vault.statFingerprint(path)`.

**Verify**: `pnpm typecheck && pnpm --filter @repo/features test` → pass

### Step 4: Engine cache tests (core, in-memory fakes)

Model after the existing engine tests. Use a counting hasher (wraps the fake,
increments per call). Cases:

1. Two passes, no changes between → second pass performs **zero** hash calls
   (fake io provides stable fingerprints).
2. One file's fingerprint changes → exactly that file re-hashed.
3. `fingerprint` returns null for a path → that path re-hashed every pass.
4. Adapter without `fingerprint` → hash count equals file count each pass
   (behavior pin for mobile).
5. After the engine pulls a remote change into a file (io.write), the next
   pass re-hashes that file (invalidation works) — or reuses a fingerprint the
   fake updated on write; assert the manifest hash is the NEW content's hash.

**Verify**: `pnpm --filter @repo/core test` → all pass including 5 new tests

### Step 5: Gates

`pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm --filter @repo/core test && pnpm --filter @repo/features test`.

## Done criteria

- [ ] Engine with no `fingerprint` behaves byte-identically (test #4)
- [ ] Unchanged files are not re-read or re-hashed (test #1)
- [ ] All pre-existing sync tests pass unchanged
- [ ] `pnpm typecheck && pnpm lint` exit 0; `plans/README.md` updated

## STOP conditions

- `buildLocalManifest` or `SyncIo` don't match the excerpts (drift).
- Invalidation on engine-side writes can't be localized (i.e. writes happen
  through a path you can't identify) — report the call sites you found.
- Any existing reconcile/e2e test fails after Step 2.

## Maintenance notes

- The cache assumes mtime granularity is fine-enough; the `ino` component
  guards replace-by-rename (atomicWrite creates a new inode). If a future
  platform port has coarse mtimes AND stable inodes, revisit.
- If mobile later wants the cache, implement `fingerprint` over
  `expo-file-system` stat and it lights up with zero engine changes.
- Reviewer: focus on Step 2's invalidation-on-write and the prune.
