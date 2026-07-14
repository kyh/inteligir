# Plan 001: Stop sync from propagating mass deletion when the local vault listing is empty or truncated

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- packages/core/src/sync packages/features/src/server/vault/vault.ts apps/mobile/src/lib/sync`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (data loss)
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

The sync engine's 3-way reconcile treats "path present in base, absent from local" as a local deletion and mirrors it to the coordinator, which fans it out to every peer. The desktop vault listing returns `[]` when the vault root is momentarily absent (external drive, network mount, iCloud eviction) and silently skips any subdirectory whose `readdir` fails. A periodic sync pass fires every few minutes with no user action. Combined: a transient read failure at the wrong moment deletes the entire vault (or a subtree) on every synced device. The code comment at `vault.ts:194-199` shows the truncation hazard is known for _ignore rules_ — the root-missing and partial-read cases have no guard anywhere. Mobile has the identical hole (`listDir` on a missing dir → `[]`).

## Current state

- `packages/core/src/sync/engine.ts` — the platform-neutral engine. `runOnce()` (line 211) builds the local manifest, loads base, reconciles, applies ops. **No guard** between `reconcile` and the apply loop:

```ts
// engine.ts:211-235 (abridged)
private async runOnce(): Promise<SyncOutcome> {
  try {
    const local = await this.buildLocalManifest();
    const base = this.loadBase();
    const remote = await this.port.listManifest();
    ...
    const plan = reconcile(base, local, remote);
    ...
    for (const op of plan.ops) {
      await this.applyOp(op, converged, counts, conflictPaths);
    }
```

- `packages/core/src/sync/engine.ts:38-52` — the `SyncIo` port. `list()` returns paths; there is no way for a platform to signal "root unavailable" other than throwing (which `runOnce`'s catch turns into a safe `{status:"error"}` outcome — base untouched, no ops applied).

- `packages/core/src/sync/reconcile.ts:56-64` — where a missing local path becomes a remote delete:

```ts
if (localChanged && !remoteChanged) {
  if (l) {
    ops.push({ kind: "push", path, expectedBaseVersion: r?.version ?? ABSENT_VERSION });
  } else if (r) {
    // deleted locally, coordinator unchanged -> delete on the coordinator
    ops.push({ kind: "delete", side: "remote", path, expectedBaseVersion: r.version });
  }
```

- `packages/features/src/server/vault/vault.ts:200-206` — desktop listing returns `[]` on missing root:

```ts
listAllPaths(): string[] {
  const root = this.getRoot();
  if (!fs.existsSync(root)) return [];
  return this.walk(root)...
```

- `packages/features/src/server/vault/vault.ts:215-221` — `walk`'s `visit` swallows per-directory read failures:

```ts
const visit = (dir: string): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
```

- `apps/mobile/src/lib/sync/expo-vault-fs.ts:32-39` — mobile: `listDir` returns `[]` when the dir doesn't exist (`if (!dir.exists) return [];`), so a vanished vault dir lists as empty.
- `apps/mobile/src/lib/sync/sync-io.ts:51-62` — `createSyncIo(fs).list()` walks via `listDir`.
- Both platforms drive the SAME engine (`sync-manager.ts` desktop, `manager.ts` mobile). Fix the engine once (belt) + tighten each platform's listing (suspenders).
- Deliberate design to preserve: sync errors are VALUES (`{status:"error"}`), never throws out of `syncOnce`; the base manifest must stay untouched on any failed/refused pass so the next pass retries from the last clean anchor. Conflict copies over data loss, always.

## Commands you will need

| Purpose        | Command                                          | Expected on success |
| -------------- | ------------------------------------------------ | ------------------- |
| Install        | `pnpm install`                                   | exit 0              |
| Format         | `pnpm format:fix` (run FIRST, never after gates) | exit 0              |
| Typecheck      | `pnpm typecheck`                                 | exit 0              |
| Core tests     | `pnpm --filter @repo/core test`                  | all pass            |
| Features tests | `pnpm --filter @repo/features test`              | all pass            |
| Mobile tests   | `pnpm --filter @repo/mobile test`                | all pass            |
| Lint           | `pnpm lint`                                      | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `packages/core/src/sync/engine.ts`
- `packages/core/src/sync/__tests__/engine.test.ts` (or the existing engine test file under `packages/core/src/sync/__tests__/` — find it with `ls`)
- `packages/features/src/server/vault/vault.ts`
- `packages/features/src/server/__tests__/vault.test.ts`
- `apps/mobile/src/lib/sync/expo-vault-fs.ts`
- `apps/mobile/src/lib/sync/sync-io.ts` (only if the guard needs the `VaultFs` type changed)
- mobile sync tests under `apps/mobile/src/lib/sync/__tests__/` (or wherever `sync-io` tests live — locate first)

**Out of scope** (do NOT touch, even though they look related):

- `packages/core/src/sync/reconcile.ts` — the pure reconcile is correct given its inputs; the bug is the inputs.
- `apps/cloud/**` — no server-side change needed.
- `packages/features/src/server/sync/sync-coordinator.ts` — trigger wiring is fine; the error outcome already flows to Settings → Sync via `onOutcome`.
- The `vaultId` guard in `loadBase` — unrelated protection, leave as is.

## Git workflow

- Branch: `kyh/plan-001-sync-empty-manifest-guard`
- Conventional commits, e.g. `fix(sync): refuse to propagate deletes from an empty local listing`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Engine guard — refuse a suspicious wipe

In `packages/core/src/sync/engine.ts`, inside `runOnce()` after `const base = this.loadBase();` and before calling `reconcile`, add:

```ts
// A transiently missing/unreadable vault root lists as empty; reconciling
// an empty local against a non-empty base would emit a delete for every
// file and fan it out to all peers. Refuse the pass instead — the base
// stays put and the next pass retries. A user who genuinely emptied the
// vault clears this by removing the files on another device or re-adding
// one file locally (see the error message).
if (local.files.length === 0 && base.files.length > 0) {
  return {
    status: "error",
    message:
      `sync: local listing is empty but the last-synced base has ${base.files.length} files — ` +
      "refusing to propagate mass deletion. If the vault folder is on an external/cloud drive, " +
      "check it is mounted. If you really deleted every note, delete them on another synced " +
      "device too (or add any file locally and sync again).",
  };
}
```

Match the file's comment style (prose comments explaining the WHY, `//` blocks). The guard goes in `runOnce`, NOT `syncOnce` — `syncOnce` is the queue/notify wrapper.

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Desktop — make a missing/unreadable root throw for sync

In `packages/features/src/server/vault/vault.ts`:

1. `listAllPaths()` (line 200): replace `if (!fs.existsSync(root)) return [];` with a throw:
   ```ts
   if (!fs.existsSync(root)) {
     throw new Error(`vault root unavailable: ${root}`);
   }
   ```
   The engine's `runOnce` catch converts this to `{status:"error"}` with the base untouched — exactly the safe behavior.
2. Add a `strict` mode to the private `walk(root)` so a failed `readdirSync` **throws** instead of skipping the subtree, and use it from `listAllPaths()` only. Signature: `private walk(root: string, opts: { strict: boolean } = { strict: false })`; in the `catch` around `readdirSync`, `if (opts.strict) throw err; return;`. `list()` (the UI listing) keeps the lenient behavior — a permission-blipped subfolder should not blank the sidebar.

Keep the doc comment on `listAllPaths` (lines 194-199) and extend it: it already explains why a truncated manifest reads as deletions; add one sentence that root-missing/unreadable now throws (strict) so sync errors out instead of wiping.

**Verify**: `pnpm typecheck` → exit 0. `pnpm --filter @repo/features test` → pre-existing tests pass (if a test asserted `[]` on missing root, update it to assert the throw — that assertion was pinning the bug).

### Step 3: Mobile — same strictness in the Expo adapter

In `apps/mobile/src/lib/sync/expo-vault-fs.ts`, `listDir` currently returns `[]` for ANY missing dir. Distinguish the root: when `relDir === ""` and `!dir.exists`, throw `new Error("vault root unavailable")`; missing sub-dirs can keep returning `[]` (they genuinely don't exist — nothing was truncated). If the `VaultFs` doc comment on `listDir` ("A missing dir → `[]`") needs updating in `sync-io.ts:29-30`, update it to document the root exception.

**Verify**: `pnpm typecheck` → exit 0.

### Step 4: Tests

See test plan below. Write them, then run all three suites.

**Verify**: `pnpm --filter @repo/core test && pnpm --filter @repo/features test && pnpm --filter @repo/mobile test` → all pass, including the new tests.

### Step 5: Gates

`pnpm format:fix` FIRST, then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`.

**Verify**: every command exits 0.

## Test plan

- **Core engine** (`packages/core/src/sync/__tests__/` — model after the existing engine tests there, which drive the engine against in-memory `SyncIo`/`SyncPort`/`BaseStore` fakes):
  1. Base has N>0 files, `io.list()` returns `[]`, remote unchanged → outcome is `{status:"error"}`, message mentions refusing mass deletion, **zero** `deleteFile` calls hit the port, base store unchanged.
  2. Base empty (first sync), local empty → pass proceeds normally (no false positive on a genuinely fresh empty vault).
  3. `io.list()` throws → outcome `{status:"error"}`, base unchanged (may already exist; if so, cite it as covered).
- **Features vault** (`packages/features/src/server/__tests__/vault.test.ts` — temp-dir pattern already used there): `listAllPaths()` throws when the root directory has been removed; `list()` still returns `[]` (lenient, UI path).
- **Mobile** (existing sync-io tests with the in-memory `VaultFs` fake): root-missing throws from `list()`; a missing subdirectory still lists as absent without throwing.

## Done criteria

- [ ] `pnpm typecheck` exits 0
- [ ] All five test suites pass (`pnpm test`)
- [ ] New engine test proves: empty-local + non-empty-base → error outcome, no port deletes, base untouched
- [ ] `grep -n "existsSync(root)) return \[\]" packages/features/src/server/vault/vault.ts` returns no matches
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live code (drift).
- You find an existing guard against empty-local elsewhere in the engine or coordinator (means the audit missed it — reassess before adding a second).
- The features test suite has a test that DEPENDS on `listAllPaths() === []` for missing root in a non-sync context (someone else consumes it — check callers with `grep -rn "listAllPaths" packages apps` first; if there are consumers other than `createVaultSyncIo`, report before changing semantics).
- Changing `walk` to strict mode breaks `list()` callers (it must not — only `listAllPaths` opts in).

## Maintenance notes

- The guard blocks the legitimate "user deleted every file" case until they touch any file or clear remotely; the error message documents the escape. If that friction ever matters, the follow-up is an explicit "force full push" action in Settings → Sync — deliberately NOT built here.
- Plan 004 (shared crawl snapshot) touches the same listing path — land this first so 004 inherits the strict semantics.
- Reviewer should scrutinize: that the error outcome flows to Settings → Sync UI (it does — `onOutcome` → sync-coordinator → `SyncStatus`), and that no code path caches an empty listing across the throw.
