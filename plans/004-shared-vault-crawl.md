# Plan 004: Share one vault crawl+stat snapshot between the knowledge refresh and the sync pass

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- packages/features/src/server/vault/vault.ts packages/features/src/server/knowledge/knowledge-manager.ts packages/features/src/server/sync/sync-manager.ts packages/features/src/server/create-host.ts`
> On mismatch with "Current state", STOP. (Plan 001 deliberately touches
> `vault.ts` — if 001 landed, its strict-listing change is EXPECTED drift;
> re-read `listAllPaths`/`walk` and adapt excerpts, then proceed.)

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-sync-empty-manifest-guard.md (touches the same listing path; land 001 first)
- **Category**: perf
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

Every vault change notification — including every autosave — fans out to BOTH the knowledge manager and the sync coordinator. Each independently walks the entire vault tree and `stat`s files: knowledge calls `vault.list()` (full recursive walk) then `fs.statSync` per doc; sync calls `vault.listAllPaths()` (a second full walk) then `vault.statFingerprint` per file. Each walk also re-reads and re-parses `.gitignore`. On a vault of thousands of files that is two tree walks plus up to 2N stat syscalls per save/focus event, milliseconds apart, over identical filesystem state. One shared crawl-with-stats snapshot per notification removes half or more of the recurring IO with no behavior change.

## Current state

- `packages/features/src/server/create-host.ts:102-106` — the fan-out (both consumers ride one notifier):

```ts
const baseVaultNotifier = notifiers.vaultChange;
setVaultChangeNotifier((root, kind) => {
  baseVaultNotifier(root, kind); // → knowledge scheduleRefresh (100ms debounce)
  getSyncCoordinator().onVaultChanged(); // → engine scheduleSync (300ms debounce)
});
```

- `packages/features/src/server/vault/vault.ts:212-239` — the private `walk(root)` backing both `list()` (entries with `kind`) and `listAllPaths()` (paths only); `loadIgnore` re-parses ignore files per crawl (`vault.ts:245-258`).
- `packages/features/src/server/knowledge/knowledge-manager.ts:102-144` — `refresh()` iterates `vault.list()` and calls a local `statFingerprint(path.join(root, entry.path))` (`fs.statSync`, `knowledge-manager.ts:178-185`) per doc, diffing `{mtimeMs,size,ino}`.
- `packages/features/src/server/sync/sync-manager.ts:63-74` — the engine's io:

```ts
export function createVaultSyncIo(vault: VaultManager): SyncIo {
  return {
    list: () => vault.listAllPaths(),
    ...
    fingerprint: (path) => vault.statFingerprint(path),
  };
}
```

- `packages/core/src/sync/engine.ts:386-411` — `buildLocalManifest()` calls `io.list()` once, then `io.fingerprint(path)` per file. The fingerprint contract (`engine.ts:47-51`): "A stale fingerprint must be impossible: the key must change whenever content can have changed."
- `VaultManager.statFingerprint` exists on the vault (used by sync io); knowledge has its own private copy — same `{mtimeMs,size,ino}` shape.
- Layering rule: `@repo/core` stays pure — the sharing lives entirely in `packages/features` (the node host). The core engine and `KnowledgeIndex` are untouched.
- Timing: knowledge refresh fires ~100ms after a notification, sync pass ~300ms after. Window focus and explicit refresh also trigger both.

## Commands you will need

| Purpose        | Command                                                                              | Expected |
| -------------- | ------------------------------------------------------------------------------------ | -------- |
| Format         | `pnpm format:fix` (FIRST)                                                            | exit 0   |
| Typecheck      | `pnpm typecheck`                                                                     | exit 0   |
| Features tests | `pnpm --filter @repo/features test`                                                  | all pass |
| Full gates     | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Scope

**In scope**:

- `packages/features/src/server/vault/vault.ts` — add the snapshot API
- `packages/features/src/server/knowledge/knowledge-manager.ts` — consume it
- `packages/features/src/server/sync/sync-manager.ts` — consume it
- `packages/features/src/server/__tests__/` — new/updated tests

**Out of scope**:

- `packages/core/**` — the engine and index stay pure and unchanged.
- The renderer file listing (`vault.list()` calls from Bridge handlers for the sidebar) — it may benefit later, but keep this change to the two background consumers to bound risk.
- `create-host.ts` notifier wiring — unchanged.
- Watcher/self-save logic in `vault.ts` — unrelated (plan 008 territory).

## Git workflow

- Branch: `kyh/plan-004-shared-vault-crawl`
- Conventional commit, e.g. `perf(features): share one vault crawl between knowledge and sync`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a generation-keyed crawl snapshot to VaultManager

In `vault.ts`, add:

```ts
export type CrawlSnapshot = {
  /** Same shaping as list() — entries with kind, sorted by path. */
  readonly entries: readonly { path: string; name: string; kind: VaultEntryKind }[];
  /** Stat fingerprint per FILE path ("mtimeMs:size:ino" string form), taken during the crawl. */
  readonly fingerprints: ReadonlyMap<string, string>;
};
```

(Reuse the exact entry type `list()` already returns — check its declared type and match it.) Implement `crawlSnapshot(): CrawlSnapshot` as ONE walk that stats each file as it visits it (extend `walk` to optionally collect `fs.statSync` results, or stat inside a shared private method). Memoize it keyed by a **generation counter**: add a private `crawlGeneration` bumped in every code path that already invalidates vault state — the same methods that call the vault-change notifier (writes, deletes, renames) plus root switch. `crawlSnapshot()` returns the cached snapshot when the generation matches, otherwise recrawls. This is clock-free: two consumers of the same notification share one crawl; any app write starts a fresh generation. External changes were never seen between passes today either (no recursive watcher — the ephemeral-index decision, PR #411), so generation-keying does not widen any staleness window for app-initiated events. Window-focus triggers must recrawl: also bump the generation in whatever entry point the focus-refresh uses (find it: `grep -rn "refreshVault\|onVaultChanged" packages/features/src/server/handlers/`), or expose `crawlSnapshot({ fresh: true })` for that path.

Keep `list()` and `listAllPaths()` working (other callers exist); reimplement them over `crawlSnapshot()` internally if that's clean, or leave them as-is and only add the new method — prefer whichever keeps the diff smaller. Preserve plan 001's strict-listing behavior: a missing root or failed root readdir must still THROW from the snapshot path used by sync.

**Verify**: `pnpm typecheck` → exit 0; `pnpm --filter @repo/features test` → existing vault tests pass.

### Step 2: Knowledge manager consumes the snapshot

In `knowledge-manager.ts` `refresh()`: replace `vault.list()` + per-doc `statFingerprint(...)` with one `vault.crawlSnapshot()` — iterate `snapshot.entries`, read fingerprints from `snapshot.fingerprints`. Delete the now-unused private `statFingerprint` helper (knip will flag it otherwise). Keep the `{mtimeMs,size,ino}` semantics identical — if the snapshot exposes the string form, parse or compare strings consistently; comparing the composite string is equivalent to comparing the three fields.

**Verify**: `pnpm --filter @repo/features test` → knowledge-manager tests pass.

### Step 3: Sync io consumes the snapshot

In `sync-manager.ts` `createVaultSyncIo`: capture a snapshot per engine pass — `list()` takes `vault.crawlSnapshot()` and returns its file paths; `fingerprint(path)` serves from that same snapshot's map, falling back to `vault.statFingerprint(path)` on a miss (a file created mid-pass). The engine calls `list()` exactly once per pass, then fingerprints — hold the snapshot from the `list()` call in a closure variable and let `fingerprint` read it; refresh the closure on each `list()` call.

**Verify**: `pnpm --filter @repo/features test` → sync adapter tests pass.

### Step 4: Tests + gates

Test plan below, then `pnpm format:fix` and full gates.

**Verify**: all gates exit 0.

## Test plan

In `packages/features/src/server/__tests__/` (temp-dir vault pattern, model after `vault.test.ts`):

1. **Sharing**: two `crawlSnapshot()` calls with no intervening write perform ONE walk (assert via a counter/spy on `readdirSync` if practical, or by injecting; if not practical with the real fs, assert referential equality of the returned snapshot object).
2. **Invalidation**: `crawlSnapshot()` → `writeVaultDoc(...)` → `crawlSnapshot()` returns a fresh snapshot reflecting the write.
3. **Sync io freshness**: `createVaultSyncIo(vault)`: `list()` → write a file through the vault → `list()` again sees it (generation bumped by the write).
4. **Strictness preserved** (post-001): snapshot path throws on missing root.
5. Existing knowledge-manager incremental-refresh tests keep passing unchanged — they are the behavioral contract that the diff logic didn't change.

## Done criteria

- [ ] One crawl serves both consumers for a single notification (test 1 proves it)
- [ ] `grep -n "statFingerprint" packages/features/src/server/knowledge/knowledge-manager.ts` → no private duplicate helper remains
- [ ] All features tests pass; full gates green
- [ ] No files outside scope modified
- [ ] `plans/README.md` updated

## STOP conditions

- The excerpts don't match (beyond plan 001's expected changes).
- You cannot find a clean single place to bump the generation for app writes (the write paths are scattered) — report the actual write-path inventory instead of sprinkling bumps you're unsure about; a missed bump = stale listing bug, worse than the perf cost.
- Knowledge tests fail because entry `kind` shaping differs between `list()` and the snapshot — reconcile the types, don't fork the shaping logic.
- The focus-refresh entry point can't be identified with certainty — report; a wrong guess would leave focus refreshes serving stale listings.

## Maintenance notes

- Anyone adding a new VaultManager write path MUST bump the crawl generation — add a comment at the generation field saying exactly that, and name the invariant in the PR description.
- If the renderer's sidebar listing later consumes the snapshot too, focus-refresh semantics need re-checking (it must always recrawl).
- The `.gitignore` matcher is rebuilt per crawl (deliberate, `vault.ts:241-244`); the snapshot inherits that — an ignore-file edit invalidates naturally on the next generation bump. If users report stale ignore behavior after editing `.gitignore` externally, that's the focus-refresh path, not this cache.
- Plans 014/015 (knowledge-engine scaling) build on the same manager — coordinate if executing concurrently.
