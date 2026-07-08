# Plan 016: Ephemeral vault index — no recursive watcher; refresh on focus/save/manual

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cd4bde1b..HEAD -- packages/features/src/server/vault/vault.ts packages/features/src/server/create-host.ts packages/features/src/server/knowledge/knowledge-manager.ts packages/features/src/server/sync/sync-coordinator.ts apps/desktop/src/renderer/workspace`
> NOTE: plan 015 (`kyh/plan-015-html-apps`) may have landed on these renderer
> files first — merge its branch/main before starting if so; treat its changes
> as expected, not drift.

## Status

- **Priority**: P1 (adopted architecture decision — operator-approved 2026-07-08)
- **Effort**: L
- **Risk**: MED-HIGH (changes the liveness model of listing, knowledge, and sync)
- **Depends on**: 015 landing first (shared renderer files)
- **Category**: tech-debt / architecture
- **Planned at**: commit `cd4bde1b`, 2026-07-08

## Why this matters

Adopted from hubble.md's ADR-0008. Today one recursive `fs.watch` on the
vault root drives everything: every file event broadcasts `onVaultChanged`,
which re-lists the vault for the sidebar, re-scans for the knowledge index
(full walk + stat per event burst), and kicks the sync debounce — including
for OUR OWN autosaves. On large or repo-shaped vaults (node_modules, .git)
recursive watching is the scaling hazard, and it is why `MAX_LIST_ENTRIES`
exists. The ephemeral model deletes the class: one-shot crawl, refreshed on
window focus / app-initiated writes / manual sync; only the OPEN note is
watched (non-recursively) for external edits. Liveness trade (accepted):
agent edits to NON-open files appear when the window regains focus — which
is when the user looks.

## Current state

- Watcher: `packages/features/src/server/vault/vault.ts` — `fs.watch`
  recursive (with a Linux non-recursive fallback), started post-`ensureReady`
  via `create-host.ts` (`setVaultChangeNotifier` wrapper), broadcasting
  through `notifiers.vaultChange` → `emitEvent("onVaultChanged")` +
  `getKnowledgeManager().scheduleRefresh()` (`host-context.ts`
  `buildHostNotifiers`) + `getSyncCoordinator().onVaultChanged()`
  (`create-host.ts` start()).
- Cap: `MAX_LIST_ENTRIES = 2000` in `list()` (UI listing); `listAllPaths()`
  (uncapped) feeds sync — plan 001. `SKIP_DIRS = {.git, node_modules,
.obsidian, .trash}`.
- Renderer: `vault-context.tsx` — `onVaultChanged` handler re-lists (with
  plan 011's equality skip) and routes the open note's reload/vanish through
  the note-runtime; plan 014 seeded conflicts on boot and prunes on state
  reads.
- Sync: `sync-coordinator.ts` — engine's debounced reconcile kicked by
  `onVaultChanged()`; also `syncNow` IPC and an initial pass on start.
- Read `docs/adr/0001-ephemeral-vault-index.md` (committed with this plan's
  batch) — it records the decision and its trade; your implementation must
  match it.

## Commands you will need

| Purpose        | Command                                                                                                     | Expected |
| -------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| Features tests | `pnpm --filter @repo/features test`                                                                         | pass     |
| Desktop tests  | `pnpm --filter @repo/desktop test`                                                                          | pass     |
| Harness        | `pnpm --filter @repo/desktop dev:harness`                                                                   | :5173    |
| Real app       | `pnpm dev:desktop`                                                                                          | boots    |
| Full gate      | `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Scope

**In scope**:

- `packages/features/src/server/vault/vault.ts` (watcher → open-file watcher; cap removal; `.gitignore` respect in the crawl)
- `packages/features/src/server/create-host.ts`, `host-context.ts` (trigger rewiring)
- `packages/features/src/server/knowledge/knowledge-manager.ts` (refresh triggers only — not the index)
- `packages/features/src/server/sync/sync-coordinator.ts` (save/focus/interval triggers)
- `packages/features/src/ipc-registry.ts` + handlers + fixture-bridge (a `notifyWindowFocus` channel or equivalent; a `refreshVault` command)
- `apps/desktop/src/renderer/workspace/vault-context.tsx`, command palette (manual "Refresh vault" action)
- NEW `packages/features/src/server/vault/classify-file-change.ts` (pure: none|reload|conflict|match + self-save filtering) + tests
- Existing tests that pin watcher behavior (adapt deliberately, one by one — each adaptation named in your report)

**Out of scope**:

- The knowledge INDEX internals and sync ENGINE internals — triggers only.
- The `onVaultChanged` renderer event contract — it stays; only its SOURCES change.
- Mobile. The 2k cap in any non-UI consumer (already gone from sync via 001).

## Git workflow

- Branch: `kyh/plan-016-ephemeral-index`
- Conventional commits per step: `refactor(vault): ...`, `feat(vault): ...`

## Steps

### Step 1: Pure change classifier

`classify-file-change.ts`: given (lastKnownContentHashOrMtime, currentDiskState,
editorDirtyState) → `none | reload | conflict | match`, plus a self-save
registry (record app-initiated writes; prune by age; `isSelfSave(path, mtime)`).
Unit-test exhaustively — this is the open-note watcher's brain.
**Verify**: new tests pass.

### Step 2: Open-file watcher replaces the recursive watcher

In `vault.ts`: remove the recursive `fs.watch` + fallback. Add
`watchOpenFile(path)` — ONE non-recursive `fs.watch` on the currently-open
file's path (rewired on note switch via a new host handler the renderer
calls on open; simplest: an IPC channel `setWatchedNote` — registry +
handler + fixture stub). Its events run the Step-1 classifier; `reload`
and vanish broadcast `onVaultChanged` exactly as today (the renderer's
existing reload/vanish machinery keeps working unchanged); `conflict`
broadcasts too (same behavior as today's external-change path); self-saves
are filtered OUT (today they round-trip a broadcast per autosave).
**Verify**: existing vault tests adapted; renderer note-runtime tests
untouched and green.

### Step 3: Crawl improvements

`list()`: drop `MAX_LIST_ENTRIES` (the crawl is now on-demand, not per-event).
Respect `.gitignore`/`.ignore` files (use the `ignore` npm package — add to
features deps; parse the root ignore files only, v1) in addition to
`SKIP_DIRS` (keep those unconditionally). `listAllPaths()` (sync) keeps its
current semantics — sync must see everything NOT ignored; apply the same
ignore rules there ONLY if plan 001's regression tests still pass unchanged
in spirit (adapt the 2050-file test: it now asserts NO cap instead of the
cap boundary — rewrite it as "list() === listAllPaths() count on a plain
vault").
**Verify**: adapted vault tests; `pnpm --filter @repo/features test`.

### Step 4: Trigger rewiring

- Renderer: on `window` focus → call a new `refreshVault` command (re-list +
  knowledge refresh + sync kick). Debounce 1s. Command palette gains
  "Refresh vault" invoking the same.
- Host: every app-initiated write path already flows through VaultManager —
  after each write/delete/rename, fire the SAME pipeline (list consumers
  refresh via the existing `onVaultChanged` broadcast, knowledge
  scheduleRefresh, sync onVaultChanged) — i.e. app actions keep today's
  behavior exactly; only EXTERNAL discovery moves to focus/manual.
- Sync: `sync-coordinator.ts` adds a periodic pass (`SYNC_INTERVAL_MS = 5 *
60_000`, only when enabled+authed) and a kick on the focus refresh. Remove
  nothing else.
- Delegation: the background agent writes via `./vault` (external!) — its
  completion already flows through delegation-manager events; ADD a vault
  refresh kick when a delegation completes (find the completion point in
  `delegation-manager.ts`) so results appear without refocus.
  **Verify**: harness — edit fixture files через the app: sidebar updates
  immediately (app-initiated). Electron — `touch` a new file in the vault
  externally: sidebar does NOT update; refocus the window: it appears; open
  note edited externally: reloads (classifier). Delegation completion path:
  code-read + note in report (live delegation run optional).

### Step 5: Gates + docs

Update `docs/development.md`'s watcher/liveness paragraph (it documents the
recursive watcher today — find and rewrite honestly). Full canonical gate.

## Done criteria

- [ ] No recursive watcher exists (`grep -n "recursive: true" packages/features/src/server/vault/` → none)
- [ ] Open-note external edits still reload/conflict correctly (classifier tested; harness/Electron verified)
- [ ] Own autosaves no longer trigger vault-changed broadcasts (verify: type in a note, no sidebar refresh event — plan 011's skip made it cheap, this makes it zero)
- [ ] External file appears on refocus + manual refresh; delegation results appear on completion
- [ ] Cap gone; `.gitignore` respected; sync periodic+focus+save triggers work
- [ ] Full gate exits 0; development.md updated

## STOP conditions

- The renderer's reload/vanish machinery turns out to depend on watcher
  events for NON-open files in a way focus-refresh can't cover — report the
  dependency.
- Sync's e2e tests fail under the new triggers — report, don't loosen tests.
- The `ignore` package pulls surprising transitive weight — report before adding.

## Maintenance notes

- If "live updates while unfocused" is ever wanted (e.g. a second window),
  reintroduce watching as an OPT-IN per-folder watcher, never recursive-root.
- The interval constant is policy; revisit with real sync usage.
