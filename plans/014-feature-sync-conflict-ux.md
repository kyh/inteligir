# Plan 014: Feature — make sync conflicts visible and resolvable (conflict UX)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/core/src/sync/ packages/features/src/sync.ts packages/features/src/server/sync/ apps/desktop/src/renderer/settings/settings-panel.tsx packages/features/src/ipc-registry.ts`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: plans/001-sync-listing-cap-data-loss.md (trust floor), plans/003-sync-hash-cache.md and plans/006-cloud-sync-hardening.md (same seams — land first)
- **Category**: direction (feature)
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

The engine's conflict handling is good — the losing side is preserved as a
sibling "conflict copy" file, never lost. But the UX ends at a text counter:
`"Synced — 2 conflicts."` in Settings. The user isn't told WHICH notes
conflicted or WHERE the copies are; conflict copies just appear in the file
tree unexplained. To take sync from "experimental, off by default" to
shippable, conflicts need to be listed, openable, and dismissible.

## Current state

- Conflict mechanics — `packages/core/src/sync/engine.ts` (~:320-326): a
  conflict writes `conflictCopyName(path, this.stamp())` locally AND pushes
  the copy to the coordinator. `conflictCopyName` lives in
  `packages/core/src/sync/reconcile.ts` (read it for the exact naming
  pattern; the stamp is filesystem-safe, no `:`).

- Outcome shape — `engine.ts`:

  ```ts
  export type SyncOutcome =
    | {
        readonly status: "ok";
        readonly pushed: number;
        readonly pulled: number;
        readonly deleted: number;
        readonly conflicts: number;
      }
    | { readonly status: "error"; readonly message: string };
  ```

  Counts only — no paths.

- UI — `apps/desktop/src/renderer/settings/settings-panel.tsx`
  `formatSyncStatus` renders the counter; `SyncSection` subscribes via
  `bridge.getSyncState()` + `bridge.onSyncStateChanged(...)`. The
  `SyncStatus`/`SyncState` types live in `packages/features/src/sync.ts`.

- IPC — `packages/features/src/ipc-registry.ts`: `getSyncState` (:497),
  `syncNow` (:508), `onSyncStateChanged` (:511). Adding/changing a channel =
  registry + handler + fixture-bridge line (typecheck-enforced).

- Renderer navigation: opening a note goes through `useVault()`
  (`workspace/vault-context.tsx` — `openNote`-style action; find the exact
  action name the sidebar uses). The Settings dialog can close itself and
  request a note open through the same context.

## Commands you will need

| Purpose        | Command                                   | Expected                          |
| -------------- | ----------------------------------------- | --------------------------------- |
| Core tests     | `pnpm --filter @repo/core test`           | pass                              |
| Features tests | `pnpm --filter @repo/features test`       | pass                              |
| Harness        | `pnpm --filter @repo/desktop dev:harness` | :5173 (fixture bridge stubs sync) |
| Full gate      | plan 002's canonical gate                 | exit 0                            |

## Scope

**In scope**:

- `packages/core/src/sync/engine.ts` (outcome carries conflict paths)
- `packages/core/src/sync/__tests__/` (outcome tests)
- `packages/features/src/sync.ts` (+ server sync files that map outcome → state)
- `packages/features/src/ipc-registry.ts`, handlers, `apps/desktop/dev/fixture-bridge.ts`
- `apps/desktop/src/renderer/settings/settings-panel.tsx` (conflict list UI)
- `plans/README.md`

**Out of scope**:

- A diff/merge view — v1 is list → open → let the user reconcile by hand,
  delete the copy when done. Do not build a merge editor.
- Changing conflict SEMANTICS (naming, both-sides preservation) — display only.
- Mobile UI.

## Git workflow

- Branch: `kyh/plan-014-conflict-ux`
- Commits: `feat(sync): conflict paths in the outcome` then `feat(desktop): conflict list in Settings → Sync`

## Steps

### Step 1: Outcome carries paths

In `engine.ts`, extend the ok-outcome with
`readonly conflictPaths: readonly VaultPath[]` — the conflict-COPY paths
created this pass (the `copyPath` values). Update every construction site and
the engine tests. Keep counts (they're cheap and already consumed).

**Verify**: `pnpm --filter @repo/core test` → pass (update existing outcome
assertions; new test: a forced conflict yields the copy's path in
`conflictPaths` and `conflicts === 1`)

### Step 2: Persist "unresolved conflicts" in sync state

In the features sync layer (`packages/features/src/sync.ts` types + the
server-side state mapping — find where `SyncStatus` is built from
`SyncOutcome`): accumulate conflict copies into the pushed `SyncState` as
`conflicts: { path: string; detectedAt: string }[]`:

- append this pass's `conflictPaths` (dedup by path),
- drop entries whose file no longer exists in the vault (deleting the copy =
  resolving it) — check on each state push using the vault listing,
- persist NOTHING new to disk: derive-on-boot is acceptable v1 — on
  coordinator start, seed the list by scanning the vault listing for the
  `conflictCopyName` pattern (export a `isConflictCopyPath(path)` matcher
  from `reconcile.ts` next to `conflictCopyName` so core owns the naming
  both ways; add a core unit test that round-trips name → matcher).

**Verify**: `pnpm --filter @repo/features test` → pass; `pnpm typecheck` →
exit 0 (fixture-bridge now fails until its `getSyncState` stub gains the
field — update it)

### Step 3: Settings UI

In `SyncSection`: under the status line, when `state.conflicts` is non-empty,
render a "Conflicts" list — each row: the note name (basename), relative
path, and two actions: **Open** (close the dialog, open the note via
`useVault()`'s open action) and **Dismiss copy** (confirm dialog — reuse
`@repo/ui`'s `confirm-dialog` — then delete the copy file via
`bridge.deleteVaultEntry`; the state prune from Step 2 removes the row).
Match the section's existing visual style (read the surrounding JSX; Base UI

- existing button variants — no new components).

**Verify**: in the harness, extend the fixture bridge's sync stub to return
two fake conflicts → rows render; Dismiss removes the file from the fixture
vault and the row disappears; Open opens the note.

### Step 4: Copy check

The user-facing strings ("Conflicts", "This keeps the synced version and
deletes the conflict copy." etc.) are product copy — keep them short,
non-jargon ("conflict copy" is already the file's visible name suffix; use
the same words the filename uses).

### Step 5: Gates + live pass

`pnpm format:fix` then the full canonical gate. If a coordinator is reachable
(operator-only deploy), a live two-device conflict is the gold check —
otherwise note it as operator-pending and rely on
`apps/cloud/test/e2e-sync.test.ts` (extend it: a conflicting write pass
asserts `conflictPaths` non-empty end-to-end).

## Done criteria

- [ ] `SyncOutcome` ok-variant carries `conflictPaths`; core tests pin it
- [ ] `isConflictCopyPath` matcher in core, tested against `conflictCopyName`
- [ ] Settings lists unresolved conflicts with working Open / Dismiss (harness-verified)
- [ ] Boot-time seeding finds pre-existing conflict copies
- [ ] e2e asserts conflict paths end-to-end; full gate exits 0; `plans/README.md` updated

## STOP conditions

- Excerpts drifted (especially the `SyncOutcome` shape).
- `SyncStatus`→UI mapping turns out to live somewhere other than
  `packages/features/src/sync.ts` + server sync files — report the actual
  seam before extending it.
- The conflict-copy naming pattern can't support a reliable reverse matcher
  (ambiguous with user files named similarly) — report; DO NOT loosen the
  matcher to fuzzy-match user files.

## Maintenance notes

- v2 candidates (deferred): side-by-side diff of copy vs. current; "keep
  mine/keep theirs" one-click resolution; a toast on conflict creation
  (notifications manager exists).
- Reviewer: the Dismiss path DELETES a user-visible file — the confirm dialog
  copy and the fact that the copy (not the main note) is what's deleted
  deserve real scrutiny.
