# Plan 006: Give the mobile sync adapter a fingerprint port so passes stop re-hashing the whole vault

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index (or the index does not exist yet, in which case skip it).
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/mobile/src/lib/sync packages/core/src/sync/engine.ts packages/features/src/server/sync/sync-manager.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. **Known expected drift**: plan
> `001-sync-empty-manifest-guard.md` also edits
> `apps/mobile/src/lib/sync/expo-vault-fs.ts` (it makes `listDir("")` throw when
> the vault root is missing). If 001 has landed, that change is EXPECTED — keep
> it, and add this plan's `fingerprint` alongside it.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

Every mobile sync pass re-reads and SHA-256s **every byte of the vault**, even
when nothing changed. The shared engine already has the fix wired in — an
optional `fingerprint(path)` port that lets a pass reuse a cached hash for a
file whose cheap stat key is unchanged — and the desktop supplies it. The Expo
adapter simply never implemented it, so mobile silently falls into the
"re-hash everything" fallback path. Cost scales with **total vault bytes**, not
changed bytes, on the battery-constrained platform, and it fires on the initial
pass, every realtime remote-change pass, and every periodic pass. Wiring the
port through the Expo `File` API's `size` + `lastModified` makes an unchanged
vault cost one `list()` + one stat per file, and zero file reads.

## Current state

Files involved, each with its role:

- `packages/core/src/sync/engine.ts` — the platform-neutral sync engine
  (**out of scope — already supports this; do NOT change it**). It defines the
  optional port and the hash cache that consumes it.
- `packages/features/src/server/sync/sync-manager.ts` — the desktop adapter.
  Supplies the port. The reference implementation to mirror.
- `apps/mobile/src/lib/sync/sync-io.ts` — the mobile `VaultFs` port + the
  `createSyncIo` adapter that maps it onto the engine's `SyncIo`. **Missing the
  fingerprint.**
- `apps/mobile/src/lib/sync/expo-vault-fs.ts` — the Expo File-API backing for
  `VaultFs`. **Missing the fingerprint.**
- `apps/mobile/src/lib/sync/manager.ts` — mobile composition root; proves the
  engine (and therefore its hash cache) is long-lived, so a fingerprint pays off
  across passes.
- `apps/mobile/src/lib/sync/__tests__/fakes.ts` — the in-memory `VaultFs` fake
  (`memVaultFs`) the mobile suite runs against on node. No simulator involved.

### The engine's contract (read this before writing any code)

`packages/core/src/sync/engine.ts:38-52` — the `SyncIo` port:

```ts
export type SyncIo = {
  /** Vault-relative POSIX paths of every file (all kinds — assets sync too). */
  list(): readonly VaultPath[];
  /** Raw bytes of a vault file. */
  read(path: VaultPath): Uint8Array;
  /** Atomically write raw bytes to a vault file (creating parent dirs). */
  write(path: VaultPath, content: Uint8Array): void;
  /** Remove a vault file (idempotent — absent is fine). */
  remove(path: VaultPath): void;
  /** Cheap change-detection key for a file (e.g. "mtimeMs:size:ino"), or null
   * when unavailable. OPTIONAL — platforms without cheap stat omit it and the
   * engine re-hashes every file (previous behavior). A stale fingerprint must
   * be impossible: the key must change whenever content can have changed. */
  fingerprint?(path: VaultPath): string | null;
};
```

**"A stale fingerprint must be impossible" is the load-bearing invariant of this
plan.** If the key can stay the same while content changes, the engine will
serve a stale hash, conclude the file is converged, and the edit never syncs —
silent data divergence. That is why Step 1 is a verification step, not a coding
step.

`packages/core/src/sync/engine.ts:386-411` — where the port is consumed
(`buildLocalManifest`, called at the top of every pass):

```ts
  private async buildLocalManifest(): Promise<LocalManifest> {
    const files: LocalFile[] = [];
    const seen = new Set<VaultPath>();
    for (const path of this.io.list()) {
      seen.add(path);
      const fp = this.io.fingerprint?.(path) ?? null;
      if (fp !== null) {
        const cached = this.hashCache.get(path);
        if (cached && cached.fp === fp) {
          // Fingerprint matches — content can't have changed; reuse the hash.
          files.push({ path, contentHash: cached.contentHash, size: cached.size });
          continue;
        }
      }
      const bytes = this.io.read(path);
      const contentHash = await this.hash(bytes);
      const size = bytes.length;
      files.push({ path, contentHash, size });
      // Only cache when we have a fingerprint to validate future reuse against.
      if (fp !== null) this.hashCache.set(path, { fp, contentHash, size });
    }
```

Note the engine invalidates its own cache entry whenever _it_ writes or removes a
file (`this.hashCache.delete(path)` in `applyOp`/`pullInto`/`syncConflictCopy`),
so the adapter does not need to care about engine-initiated writes.

### The desktop reference (mirror this)

`packages/features/src/server/sync/sync-manager.ts:62-74`:

```ts
/** Adapt the live `VaultManager` to the engine's `SyncIo` port. */
export function createVaultSyncIo(vault: VaultManager): SyncIo {
  return {
    list: () => vault.listAllPaths(),
    read: (path) => vault.readBytes(path),
    write: (path, content) => vault.writeBytes(path, content),
    remove: (path) => {
      vault.delete(path);
    },
    // Stat-keyed change detection so a pass skips re-hashing unchanged files.
    fingerprint: (path) => vault.statFingerprint(path),
  };
}
```

The desktop key is `mtimeMs:size:ino`
(`packages/features/src/server/vault/vault.ts:316-323`).

### What mobile has today (the gap)

`apps/mobile/src/lib/sync/sync-io.ts:28-37` — the `VaultFs` port has **no stat
method at all**:

```ts
export type VaultFs = {
  /** Immediate children of a vault-relative dir (`""` = root). A missing dir → `[]`. */
  listDir(relDir: string): readonly VaultEntry[];
  /** Raw bytes of a vault file. */
  readBytes(path: VaultPath): Uint8Array;
  /** Write raw bytes, creating any missing parent directories. */
  writeBytes(path: VaultPath, bytes: Uint8Array): void;
  /** Remove a vault file (idempotent — absent is fine). */
  remove(path: VaultPath): void;
};
```

`apps/mobile/src/lib/sync/sync-io.ts:50-62` — `createSyncIo` therefore returns a
`SyncIo` with only four members, and the engine falls into the re-hash-everything
path:

```ts
/** Adapt a `VaultFs` to the engine's `SyncIo` port. */
export function createSyncIo(fs: VaultFs): SyncIo {
  return {
    list: () => walk(fs, "").toSorted(),
    read: (path) => fs.readBytes(path),
    write: (path, content) => {
      fs.writeBytes(path, content);
    },
    remove: (path) => {
      fs.remove(path);
    },
  };
}
```

`apps/mobile/src/lib/sync/expo-vault-fs.ts:29-53` — the Expo backing:

```ts
/** A `VaultFs` backed by Expo's synchronous File API. */
export function createExpoVaultFs(): VaultFs {
  return {
    listDir: (relDir) => {
      const dir = dirFor(relDir);
      if (!dir.exists) return [];
      return dir.list().map((entry) => ({
        name: entry.name,
        isDirectory: entry instanceof Directory,
      }));
    },
    readBytes: (path) => fileFor(path).bytesSync(),
    writeBytes: (path, bytes) => {
      const file = fileFor(path);
      // `intermediates` creates any missing parent directories; `overwrite`
      // makes the create idempotent when the file already exists. Then write.
      file.create({ intermediates: true, overwrite: true });
      file.write(bytes);
    },
    remove: (path) => {
      const file = fileFor(path);
      if (file.exists) file.delete();
    },
  };
}
```

`fileFor` / `dirFor` (`expo-vault-fs.ts:17-27`) build a **fresh** `File` /
`Directory` per call, and the module header (`expo-vault-fs.ts:1-7`) states this
explicitly: "A fresh File/Directory instance is created per call so `exists`
always reflects current filesystem state." Keep that property — a cached `File`
could serve stale stat values.

### Why the cache survives between passes on mobile

`apps/mobile/src/lib/sync/manager.ts:1-14` (module header):

```ts
// ONE engine lives as long as its bearer token: it is rebuilt whenever the
// token changes (the auth client refreshes it), so no pass ever carries a
// stale credential, while the engine's cross-pass machinery — debounce, pass
// serialization, hash cache — stays warm between passes.
```

So a fingerprint added here is not academic: the second and every later pass
reuses the cache.

### Repo conventions that apply

- Kebab-case filenames; no barrel files (import via direct subpaths, e.g.
  `@repo/core/sync/engine`).
- **No `any`, no non-null assertion `!`, no `as` casts.** The Expo stat values
  are nullable — handle the `null` explicitly with a check, never with `!`.
- Comments explain the WHY, in prose, matching the surrounding files.
- Conventional commits; branch prefix `kyh/`.

## Commands you will need

| Purpose      | Command                                                                              | Expected on success  |
| ------------ | ------------------------------------------------------------------------------------ | -------------------- |
| Install      | `pnpm install`                                                                       | exit 0               |
| Format       | `pnpm format:fix` (run FIRST, never after gates)                                     | exit 0               |
| Typecheck    | `pnpm typecheck`                                                                     | exit 0, no errors    |
| Mobile tests | `pnpm --filter @repo/mobile test`                                                    | all pass             |
| Core tests   | `pnpm --filter @repo/core test`                                                      | all pass (unchanged) |
| Lint         | `pnpm lint`                                                                          | exit 0               |
| Full gates   | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0               |

The mobile suite is plain vitest on node (`apps/mobile/package.json` →
`"test": "vitest run"`). **No simulator, no device, no Expo runtime** — it runs
against the in-memory `VaultFs` fake in
`apps/mobile/src/lib/sync/__tests__/fakes.ts`.

## Scope

**In scope** (the only files you should modify):

- `apps/mobile/src/lib/sync/sync-io.ts` — add `fingerprint` to the `VaultFs`
  port and forward it in `createSyncIo`.
- `apps/mobile/src/lib/sync/expo-vault-fs.ts` — implement `fingerprint` over the
  Expo File API.
- `apps/mobile/src/lib/sync/__tests__/fakes.ts` — teach `memVaultFs` a
  fingerprint + a read counter.
- `apps/mobile/src/lib/sync/__tests__/sync-io.test.ts` — unit tests for the
  adapter's fingerprint forwarding.
- `apps/mobile/src/lib/sync/__tests__/engine.test.ts` — the end-to-end proof that
  an unchanged second pass reads zero file bytes. (Alternatively create
  `apps/mobile/src/lib/sync/__tests__/engine-hash-cache.test.ts` if you prefer a
  separate file — either is fine, but do not create both.)

**Out of scope** (do NOT touch, even though they look related):

- `packages/core/src/sync/**` — the engine ALREADY supports the optional port and
  is unit-tested for it
  (`packages/core/src/sync/__tests__/engine-hash-cache.test.ts`). Changing core is
  not needed and would widen the blast radius to desktop.
- `packages/features/**` (desktop sync) — already has a fingerprint.
- `apps/mobile/src/lib/sync/manager.ts` / `vault-access.ts` — they call
  `createSyncIo(createExpoVaultFs())`; adding a member to the returned object
  requires no change at these call sites.
- The wire protocol / manifest shape — the fingerprint is a purely local,
  in-memory cache key and NEVER crosses the wire or lands in the base manifest.

## Git workflow

- Branch: `kyh/plan-006-mobile-sync-fingerprint`
- Conventional commits, e.g.
  `perf(mobile): fingerprint vault files so sync passes skip unchanged hashes`
- Do NOT push and do NOT open a PR.

## Steps

### Step 1: Verify the Expo File API actually exposes the stat properties (VERIFICATION ONLY — no edits)

**Do not skip this step and do not guess property names.** A fabricated or
unstable fingerprint violates the engine's "a stale fingerprint must be
impossible" contract and silently loses user edits.

Run:

```bash
grep -rn "size\|lastModified\|modificationTime\|creationTime" \
  "$(find node_modules/.pnpm -maxdepth 4 -path '*expo-file-system*/node_modules/expo-file-system/src/internal/NativeFileSystem.types.ts' | head -1)"
```

At the pinned version (expo-file-system 57.0.0) the `File` native base class
declares, verbatim:

```ts
/**
 * A size of the file in bytes. 0 if the file does not exist, or it cannot be read.
 */
size: number;
/**
 * A last modification time of the file expressed in milliseconds since the epoch. Returns a `null` if the file does not exist, or if it cannot be read.
 * @deprecated In favor of `lastModified` to be more in line with web [`File`](https://developer.mozilla.org/en-US/docs/Web/API/File)
 */
modificationTime: number | null;
/**
 * A last modification time of the file expressed in milliseconds since the epoch. Returns a `null` if the file does not exist, or if it cannot be read.
 */
lastModified: number | null;
```

**Verify**: the grep output contains `size: number`, `lastModified: number | null`.

- If it does → proceed. Use **`lastModified`** (NOT the deprecated
  `modificationTime`).
- If `lastModified` is absent but `modificationTime` is present → use
  `modificationTime` and say so in your final report.
- **If NEITHER a modification time NOR `size` is available on `File`** → **STOP
  and report.** Do not invent a key, do not fall back to hashing inside the
  adapter (that would defeat the entire point), and do not use `md5` (it reads
  the whole file — the exact cost this plan removes).

### Step 2: Add `fingerprint` to the `VaultFs` port and forward it in `createSyncIo`

In `apps/mobile/src/lib/sync/sync-io.ts`:

1. Add the method to `VaultFs` (line ~28-37). It is **required** on `VaultFs`
   (an in-repo port with exactly two implementations — the Expo one and the test
   fake — so making it required is free and prevents a silent regression), even
   though it stays **optional** on the engine's `SyncIo`:

```ts
  /** Cheap change-detection key for a file (`"lastModified:size"`), or null when
   * the file is missing/unreadable. Must change whenever content can have
   * changed — the engine reuses a cached hash on an unchanged key, so a stale
   * key would silently drop an edit from the sync. */
  fingerprint(path: VaultPath): string | null;
```

2. Forward it in `createSyncIo` (line ~51-62), mirroring the desktop adapter's
   comment style:

```ts
    // Stat-keyed change detection so a pass skips re-hashing unchanged files.
    fingerprint: (path) => fs.fingerprint(path),
```

**Verify**: `pnpm typecheck` → **fails**, with errors pointing at
`expo-vault-fs.ts` and `__tests__/fakes.ts` for the missing `fingerprint`
member. That failure is the expected, desired signal that both implementations
must be updated (Steps 3 and 4). Do not proceed until you have seen exactly
those two files named.

### Step 3: Implement `fingerprint` in the Expo adapter

In `apps/mobile/src/lib/sync/expo-vault-fs.ts`, add to the object returned by
`createExpoVaultFs()`:

```ts
    // Cheap stat-keyed change detection for the engine's hash cache. Expo gives
    // no inode analog (desktop keys on mtimeMs:size:ino), so the key is
    // `lastModified:size`. `lastModified` is null when the file is missing or
    // unreadable — return null then, and the engine re-hashes (the safe path)
    // rather than trusting a key it can't trust.
    fingerprint: (path) => {
      const file = fileFor(path);
      const lastModified = file.lastModified;
      if (lastModified === null) return null;
      return `${lastModified}:${file.size}`;
    },
```

Notes for the executor:

- Read `lastModified` **before** `size`: `size` is documented as `0` for a
  missing file (not null), so the null-check on `lastModified` is what detects
  absence. Never use `!` to strip the null — check it.
- Keep using `fileFor(path)` (a fresh `File` per call) — do not hoist or cache
  the instance.
- Extend the module header comment (`expo-vault-fs.ts:1-7`) with one sentence
  noting the adapter now also serves the engine's stat-keyed hash cache.

**Verify**: `pnpm typecheck` → the only remaining error is the missing
`fingerprint` on the test fake in `__tests__/fakes.ts`.

### Step 4: Teach the in-memory fake a fingerprint and a read counter

In `apps/mobile/src/lib/sync/__tests__/fakes.ts`, `memVaultFs()` currently
returns a flat-map `VaultFs` (lines 33-76). Change it to:

1. Keep a `Map<VaultPath, string>` of fingerprints and a monotonic counter; bump
   the counter on **every** mutation (`writeBytes` and the test-only `writeText`),
   exactly like `FingerprintVault` in
   `packages/core/src/sync/__tests__/engine-hash-cache.test.ts:43-91` (a
   `fp-${counter}` token per path). Delete the entry in `remove`.
2. `fingerprint: (path) => fps.get(path) ?? null` — a path with no entry (absent
   file) is `null`.
3. Count `readBytes` calls so a test can assert **zero** file reads:
   expose `reads: VaultPath[]` (push the path on every `readBytes`) on the
   returned `MemVault` type.

Do NOT change `memVaultFs`'s existing exported behavior (`writeText`,
`readText`, `files`) — other tests depend on it.

**Verify**: `pnpm typecheck` → exit 0 (all three `VaultFs` obligations satisfied).
`pnpm --filter @repo/mobile test` → all existing tests still pass.

### Step 5: Tests

Write the tests in the Test plan below.

**Verify**: `pnpm --filter @repo/mobile test` → all pass, including the new
tests. `pnpm --filter @repo/core test` → all pass, **unchanged** (you must not
have touched core).

### Step 6: Gates

```bash
pnpm format:fix   # FIRST — never after gates
pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build
```

**Verify**: every command exits 0.

## Test plan

Model the engine-level test on
`packages/core/src/sync/__tests__/engine-hash-cache.test.ts` (its
`countingHasher` and `FingerprintVault` show the exact shape), and the adapter
test on the existing `apps/mobile/src/lib/sync/__tests__/sync-io.test.ts`.

**A. Adapter unit tests** — `apps/mobile/src/lib/sync/__tests__/sync-io.test.ts`:

1. `createSyncIo(fs).fingerprint?.("a.md")` returns the fake's key for an
   existing file, and the key **changes** after a `writeBytes` to that path.
2. `fingerprint` returns `null` for a path that does not exist.

**B. Engine-level proof (the point of the plan)** — in
`apps/mobile/src/lib/sync/__tests__/engine.test.ts` (or a new
`engine-hash-cache.test.ts` in the same dir), building the engine exactly as
`engine.test.ts:25-34` does (`io: createSyncIo(vault.fs)`, `InMemorySyncPort`,
`webCryptoHasher()`, `debounceMs: 0`):

1. **Unchanged vault reads zero bytes.** Seed 2-3 files, `await
engine.syncOnce()`, snapshot `vault.reads.length`, then `await
engine.syncOnce()` again → the second pass adds **0** entries to
   `vault.reads` (today it adds one per file). This is the regression that must
   go red without the fix.
2. **A changed file IS re-read and re-hashed.** After the first pass, mutate one
   file (which bumps only its fingerprint) → the second pass reads **exactly**
   that one path and pushes it; the untouched files are not read.
3. **A file with no fingerprint still syncs.** Make the fake return `null` for
   one path (e.g. an optional `markNoFingerprint(path)` helper on the fake,
   mirroring `engine-hash-cache.test.ts:87-90`) → that file is re-read and
   re-hashed on every pass, the outcome is still `{status: "ok"}`, and its bytes
   still reach the port. (Proves the null fallback is safe, not a silent skip.)

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @repo/mobile test` exits 0, including the three new
      engine-level cases and the two new adapter cases
- [ ] `pnpm --filter @repo/core test` exits 0 and `git status` shows **no**
      modification under `packages/core/`
- [ ] `grep -n "fingerprint" apps/mobile/src/lib/sync/sync-io.ts apps/mobile/src/lib/sync/expo-vault-fs.ts`
      returns matches in both files
- [ ] `grep -rn "as \|!\." apps/mobile/src/lib/sync/expo-vault-fs.ts` shows no
      new type assertion or non-null assertion introduced by this change
- [ ] `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` all exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated (if that index exists)

## STOP conditions

Stop and report back (do not improvise) if:

- **Step 1 fails**: the Expo `File` API at the installed version exposes neither
  `lastModified` nor `modificationTime`, or does not expose `size`. Do NOT
  synthesize a fingerprint from anything else (a hash, a counter, `md5`) — a key
  that can go stale, or one that costs a full read, defeats the plan and risks
  data divergence.
- The stat properties turn out to be **async** (a Promise) at the installed
  version — the engine's `SyncIo` is synchronous and cannot await them. Report;
  do not block on a promise or fabricate a sync wrapper.
- The excerpts in "Current state" don't match the live code (drift), beyond the
  expected plan-001 drift in `expo-vault-fs.ts` noted at the top.
- A test asserts that mobile re-hashes every pass (i.e. something in
  `apps/mobile` pins the OLD behavior) — report which test before changing it.
  (Note: `packages/core/src/sync/__tests__/engine-hash-cache.test.ts:189` has a
  case titled "...when the adapter omits fingerprint (mobile pin)" — that test
  uses its own `NoFingerprintVault` and stays valid; do NOT touch it.)
- Any change appears to require editing `packages/core` or `packages/features`.

## Maintenance notes

For the human/agent who owns this after it lands:

- **The mobile key is weaker than desktop's.** Desktop uses
  `mtimeMs:size:ino`; the inode component means an atomic write (temp + rename)
  always lands a fresh inode, so even an exact `(mtime, size)` collision cannot
  masquerade as unchanged. Expo exposes no inode analog, so mobile keys on
  `lastModified:size`. A file edited **within the filesystem's mtime granularity
  to exactly the same byte length** would be missed for that pass. This is
  extremely unlikely on mobile (the only local writer is the app itself, and the
  engine invalidates its cache on its own writes), but it is real — record it,
  don't forget it. If a future Expo version exposes a stronger stat component
  (an inode, a change-time, or a cheap content version), **prefer it** and add it
  to the key.
- `creationTime` is also available on the Expo `File` (nullable; null on Android
  below API 26) and was deliberately NOT included — it adds a
  platform-conditional component for near-zero extra strength. Revisit only if
  a same-size/same-mtime miss is ever actually observed.
- The fingerprint is **local-only**: it never enters the manifest, the base
  store, or the wire protocol. If someone proposes putting it there, that is a
  different (and much riskier) design — the manifest is content-hash-addressed on
  purpose.
- What a reviewer should scrutinize: (a) that `fingerprint` returns `null` —
  not a fabricated key — whenever the stat is unavailable; (b) that the fake's
  fingerprint bumps on EVERY mutation, or test 1 would pass vacuously; (c) that
  no `!` or `as` snuck in around the nullable Expo properties.
- Deferred out of this plan: the "(mobile pin)" title/comment on
  `packages/core/src/sync/__tests__/engine-hash-cache.test.ts:189` becomes a
  stale reference once mobile supplies a fingerprint. The test itself is still
  correct (it covers the _omitted-fingerprint fallback_, which remains a
  supported path for any future platform), so it is left alone here to keep
  `packages/core` out of this diff. Rename the case when core is next touched.
