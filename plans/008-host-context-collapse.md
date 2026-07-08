# Plan 008: One DI story in the backend — collapse HostContext into the getX() singletons

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/features/src/server/host-context.ts packages/features/src/server/create-host.ts`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (boot-ordering is load-bearing)
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

The backend has two parallel dependency-access mechanisms: ~29 process-global
`getX()/resetX()` accessors (used everywhere in `server/**`) and a
`HostContext` getter-bag built by `buildHostContext()` whose every field just
delegates to a `getX()` — consumed by exactly ONE file (`create-host.ts`),
which uses ~6 of its 13 fields. Adding a service today means maintaining both.
This plan keeps the valuable part (the eager, dependency-ordered construction
with notifiers installed first) and deletes the ceremony (~100 LOC and one
concept), so `getX()` is THE way.

**Decision context**: `HostContext` was introduced deliberately in PR #397
("make create-host a real composition root"). This plan is the judgment that
the migration stalled at one consumer and the half-state is worse than either
end-state. If the maintainer would rather finish the migration instead
(migrate `server/**` readers onto `ctx`), REJECT this plan in
`plans/README.md` rather than executing it — do not do both.

## Current state

- `packages/features/src/server/host-context.ts` — `buildHostContext()`
  (~:90-153): first the load-bearing bootstrap —

  ```ts
  const notifiers = buildHostNotifiers();
  installHostNotifiers(notifiers);
  setStoreRecoveryNotifier(notifiers.storeRecovery);
  // Eager, dependency-ordered construction ... notifiers already installed.
  // Two pieces deliberately NOT eager: uiState (reads+migrates on construct),
  // authStorage (pi call, must wait for configurePaths() in start()).
  getSecretStore();
  getNotifications();
  getVaultManager();
  getKnowledgeManager();
  getDelegationManager();
  getExecutorDaemon();
  getSyncCoordinator();
  ```

  — then a returned object of 13 fields where each getter delegates
  (`get vault() { return getVaultManager(); }` etc.).

- `packages/features/src/server/create-host.ts` — the only consumer. Its
  `ctx.` uses (from grep): `ctx.vault.ensureReady()`, `ctx.notifiers.vaultChange`,
  `ctx.sync.onVaultChanged()`, `ctx.knowledge.scheduleRefresh()`,
  `ctx.delegation.pruneSnapshots()`, `ctx.sync.start()`, `ctx.sync.dispose()`.

- Convention: every service module in `server/**` already exposes
  `getX()`/`resetX()` accessors and imports peers the same way.

## Commands you will need

| Purpose        | Command                             | Expected                  |
| -------------- | ----------------------------------- | ------------------------- |
| Features tests | `pnpm --filter @repo/features test` | pass                      |
| Typecheck/lint | `pnpm typecheck && pnpm lint`       | exit 0                    |
| Dead code      | `pnpm knip`                         | exit 0                    |
| Real app       | `pnpm dev:desktop`                  | boots, chat + editor work |

## Scope

**In scope**:

- `packages/features/src/server/host-context.ts`
- `packages/features/src/server/create-host.ts`
- Any test importing `buildHostContext`/`HostContext` (grep first)
- `plans/README.md`

**Out of scope**:

- The `getX()` accessors themselves — unchanged.
- `buildHostNotifiers` / `installHostNotifiers` — unchanged semantics.
- `HostPlatform` / `installHostRuntime` — the platform-injection seam stays.

## Git workflow

- Branch: `kyh/plan-008-di-collapse`
- Commit: `refactor(features): collapse HostContext — getX() is the one DI path`

## Steps

### Step 1: Map every reference

`grep -rn "HostContext\|buildHostContext" packages/ apps/` — expect
host-context.ts, create-host.ts, possibly type exports/tests. List them; if
anything OTHER than these two files consumes the type in a way that isn't a
re-export, STOP and report.

### Step 2: Shrink host-context.ts to the bootstrap

Replace `buildHostContext(): HostContext` with
`constructHostSingletons(): HostNotifiers` — the bootstrap block VERBATIM
(notifier build/install, `setStoreRecoveryNotifier`, the eager ordered
`getX()` calls with their comments intact, including the two
deliberately-lazy exceptions and their comment) — returning just `notifiers`.
Delete the `HostContext` type and the getter-bag return. Keep the module
header honest: it is now "boot-order bootstrap", not a context builder.

### Step 3: Rewire create-host.ts

Replace `const ctx = buildHostContext()` with
`const notifiers = constructHostSingletons()`, and each `ctx.X` with the
direct accessor: `getVaultManager().ensureReady()`,
`notifiers.vaultChange`, `getSyncCoordinator().onVaultChanged()`,
`getKnowledgeManager().scheduleRefresh()`,
`getDelegationManager().pruneSnapshots()`, `getSyncCoordinator().start()` /
`.dispose()`. Import the accessors from their home modules (follow existing
import paths used elsewhere in `server/**` — no barrels; the repo prefers
direct subpath imports). Preserve statement ORDER exactly — the comments
around the vault-change wrapper and `ensureReady` encode boot races.

**Verify**: `pnpm typecheck && pnpm lint && pnpm knip` → exit 0

### Step 4: Tests + live boot

`pnpm --filter @repo/features test` → pass. Then `pnpm dev:desktop`: app
boots, open a note, edit + autosave works, chat sends, and (if a vault is
synced/enabled) no sync errors in the main-process log. Kill leftovers on
9222/47888 first.

### Step 5: Gates

`pnpm format:fix` then full gate:
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`.

## Done criteria

- [ ] `grep -rn "HostContext" packages apps` → no matches (type gone)
- [ ] Eager-construction order and its comments preserved verbatim (reviewer diff-check)
- [ ] Full gate exits 0; desktop boots and edits/chats in dev
- [ ] `plans/README.md` updated

## STOP conditions

- Step 1 finds consumers beyond the two files.
- Any test constructs a fake/partial `HostContext` (a seam someone relies on
  for injection) — that changes the calculus; report it.
- Boot order can't be preserved without the ctx object for some reason you
  can articulate — report rather than reorder.

## Maintenance notes

- The inverse resolution (migrate everything to `ctx`, delete `getX()`) was
  considered and set aside as strictly larger; if the codebase later grows a
  second host (e.g. a headless CLI host), revisit — a context object earns
  its keep at two consumers.
- Reviewer: the ONLY acceptable diff in behavior is "none". Scrutinize the
  vault-change wrapper block ordering (`ensureReady` before wrapping,
  wrapping before `scheduleRefresh`).
