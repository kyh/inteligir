# Plan 001: Stop the 2,000-entry listing cap from feeding the sync manifest (data-loss fix)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/features/src/server/vault/vault.ts packages/features/src/server/sync/sync-manager.ts packages/core/src/sync/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (data loss)
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

`VaultManager.list()` stops walking at 2,000 entries. The sync engine uses that
capped listing as the complete local manifest. The 3-way reconcile treats "was
in base and remote, missing from local" as a **local deletion** and emits a
remote delete — which then propagates to every other synced device. So a vault
with more than 2,000 files silently deletes real user files from the
coordinator and all peers. This is the single worst bug in the repo; sync being
off by default is the only mitigation.

## Current state

- `packages/features/src/server/vault/vault.ts` — vault owner. The cap:

  ```ts
  // vault.ts:60
  const MAX_LIST_ENTRIES = 2000;
  ```

  Inside `list()` (vault.ts:~154-183) the recursive `walk` returns early:

  ```ts
  const walk = (dir: string): void => {
    if (out.length >= MAX_LIST_ENTRIES) return;
    ...
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          if (out.length >= MAX_LIST_ENTRIES) return;
          const rel = path.relative(root, full).split(path.sep).join("/");
          out.push({ path: rel, name: entry.name, kind: classify(entry.name) });
        }
  ```

  It skips dot-entries, `SKIP_DIRS` (`.git`, `node_modules`, `.obsidian`,
  `.trash`), and `*.tmp` files, then returns `out.toSorted(...)`.

- `packages/features/src/server/sync/sync-manager.ts:~60` — the sync adapter
  feeds the capped list straight into the engine:

  ```ts
  export function createVaultSyncIo(vault: VaultManager): SyncIo {
    return {
      list: () => vault.list().map((entry) => entry.path),
      ...
  ```

- `packages/core/src/sync/engine.ts:~329-336` — `buildLocalManifest()` treats
  `this.io.list()` as the complete local state (reads + hashes each path).

- `packages/core/src/sync/reconcile.ts:~56-63` — the deletion inference:

  ```ts
  // 2. One-sided local change.
  if (localChanged && !remoteChanged) {
    if (l) {
      ops.push({ kind: "push", path, expectedBaseVersion: r?.version ?? ABSENT_VERSION });
    } else if (r) {
      // deleted locally, coordinator unchanged -> delete on the coordinator
      ops.push({ kind: "delete", side: "remote", path, expectedBaseVersion: r.version });
    }
  ```

- Conventions: strict TS (no `any`, no `as`, no `!`), kebab-case files,
  conventional-commit messages (e.g. `fix(sync): ...`). Vault tests live in
  `packages/features/src/server/vault/__tests__/vault.test.ts` (temp-dir vaults);
  sync adapter code is in `sync-manager.ts`.

## Commands you will need

| Purpose   | Command                              | Expected on success |
| --------- | ------------------------------------ | ------------------- |
| Install   | `pnpm install`                       | exit 0              |
| Format    | `pnpm format:fix` (run BEFORE gates) | exit 0              |
| Typecheck | `pnpm typecheck`                     | exit 0              |
| Tests     | `pnpm --filter @repo/features test`  | all pass            |
| Lint      | `pnpm lint`                          | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `packages/features/src/server/vault/vault.ts`
- `packages/features/src/server/sync/sync-manager.ts`
- `packages/features/src/server/vault/__tests__/vault.test.ts` (or a sibling test file)
- `packages/features/src/server/sync/__tests__/*` (create if absent)
- `plans/README.md` (status row)

**Out of scope** (do NOT touch):

- `packages/core/src/sync/*` — reconcile's deletion semantics are correct; the
  bug is feeding it a truncated listing.
- The UI listing path (`listVault` IPC channel, sidebar) — keeping the UI cap
  is a deliberate product decision for now (documented follow-up below).
- The knowledge manager (also consumes `vault.list()`) — same cap, but a capped
  index is a degraded feature, not data loss. Do not change it here.

## Git workflow

- Branch: `kyh/plan-001-sync-listing-cap`
- Conventional commits, e.g. `fix(sync): sync manifest walks the vault uncapped`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an uncapped enumeration to VaultManager

In `vault.ts`, add a method `listAllPaths(): string[]` next to `list()`:
same walk (same `SKIP_DIRS`, dot-entry and `.tmp` skips, same POSIX
relative-path normalization, same sorted return), but **no
`MAX_LIST_ENTRIES` early-returns**, and it returns `string[]` of relative
paths (no `VaultEntry` classification needed). Factor the shared walk into a
private helper if that keeps `list()` byte-for-byte equivalent; duplicating
the ~25-line walk is also acceptable if a shared helper would change `list()`
behavior. Add a doc comment stating explicitly: "Sync must see every file —
a truncated manifest reads as deletions (see plan 001)."

Also update `list()`'s doc comment to state that it is capped at
`MAX_LIST_ENTRIES` and is for UI listing only.

**Verify**: `pnpm typecheck` → exit 0

### Step 2: Point the sync adapter at the uncapped listing

In `sync-manager.ts`, change `createVaultSyncIo`:

```ts
list: () => vault.listAllPaths(),
```

(The `.map((entry) => entry.path)` disappears — `listAllPaths` already returns
paths.)

**Verify**: `pnpm typecheck` → exit 0

### Step 3: Regression tests

1. In the vault tests (temp-dir pattern — model after existing tests in
   `packages/features/src/server/vault/__tests__/vault.test.ts`): create a temp
   vault with **2,050 small files** (e.g. `f0000.md`..`f2049.md`, one byte
   each; creating them in a loop is fast), then assert:
   - `vault.list().length === 2000` (the UI cap still holds)
   - `vault.listAllPaths().length === 2050`
   - `vault.listAllPaths()` still excludes a planted `.git/x`, `foo.tmp`, and a
     dot-file.
2. Sync adapter test: `createVaultSyncIo(vault).list().length === 2050` on the
   same fixture — this is the exact regression pin for the data-loss path.

**Verify**: `pnpm --filter @repo/features test` → all pass, including the new tests

### Step 4: Gates

Run `pnpm format:fix`, then `pnpm typecheck && pnpm lint && pnpm --filter @repo/features test && pnpm --filter @repo/core test`.

**Verify**: all exit 0

## Done criteria

- [ ] `grep -n "vault.list()" packages/features/src/server/sync/sync-manager.ts` returns no matches
- [ ] New tests exist and pass (`pnpm --filter @repo/features test`)
- [ ] `pnpm typecheck && pnpm lint` exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `list()` or `createVaultSyncIo` no longer match the excerpts above.
- The walk helper cannot be added without changing `list()`'s observed output
  for the existing vault tests.
- You find OTHER consumers of `vault.list()` inside the sync path (grep
  `vault.list` under `packages/features/src/server/sync/`) beyond
  `createVaultSyncIo` — report them instead of changing them.

## Maintenance notes

- Follow-ups deliberately deferred: (a) the UI/sidebar and knowledge index are
  still capped at 2,000 — degraded but safe; if the cap is raised or made
  user-visible ("N files not shown"), do it in the UI listing path, not here.
  (b) Consider an engine-level guard (refuse a pass whose local manifest is
  flagged truncated) if a capped listing ever reaches sync again.
- Reviewer: scrutinize that `list()`'s behavior is byte-identical (the sidebar
  and fixture harness depend on its ordering), and that `listAllPaths` cannot
  be reached from any IPC channel (it must stay server-internal).
