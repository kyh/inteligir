# Plan 010: Move the SyncStatus type + outcome→status projection into @repo/core

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (only if that file exists — do not create it).
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- packages/core/src/sync packages/features/src/sync.ts packages/features/src/server/sync apps/mobile/src/lib/sync apps/mobile/src/app/index.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

Desktop and mobile both drive the **same** sync engine from `@repo/core` and both
project its `SyncOutcome` into a four-state "what did the last pass do" status for
their UI. They wrote that projection twice, and the two copies have **already
drifted**: desktop discriminates on `phase`, mobile on `kind`. One shared contract,
derived from one shared core type, maintained in two enums and two functions. Any
change to outcome semantics (a new phase, another counter) is now a four-file edit
with no compiler pressure keeping the two in agreement. This plan defines the type
and the projection **once**, in core, next to the `SyncOutcome` it derives from.

## Current state

### 1. The source type — already in core

`packages/core/src/sync/engine.ts:68-83`:

```ts
/** What one `syncOnce` pass did (or why it failed). */
export type SyncOutcome =
  | {
      readonly status: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
      /** Conflict-COPY paths created this pass (the sibling files preserving
       * each conflict's losing bytes) — what a conflict UI lists and opens.
       * May differ from `conflicts`: one conflict can spawn two copies (a
       * local-wins downgraded to remote-wins mid-flight) or none (the remote
       * loser vanished before it could be copied). */
      readonly conflictPaths: readonly VaultPath[];
    }
  | { readonly status: "error"; readonly message: string };
```

### 2. Desktop's status type — `packages/features/src/sync.ts:40-52`

```ts
/** The most recent pass's status for the settings UI: idle before any pass,
 * syncing while one runs, then the outcome of the last completed pass. */
export type SyncStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "syncing" }
  | {
      readonly phase: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
    }
  | { readonly phase: "error"; readonly message: string };
```

### 3. Desktop's projection — `packages/features/src/server/sync/sync-coordinator.ts:31-41`

```ts
function toStatus(outcome: CoreSyncOutcome): SyncStatus {
  return outcome.status === "ok"
    ? {
        phase: "ok",
        pushed: outcome.pushed,
        pulled: outcome.pulled,
        deleted: outcome.deleted,
        conflicts: outcome.conflicts,
      }
    : { phase: "error", message: outcome.message };
}
```

(`toStatus` is module-private. `SyncStatus` is also used at
`sync-coordinator.ts:76`: `private status: SyncStatus = { phase: "idle" };`)

### 4. Mobile's status type — `apps/mobile/src/lib/sync/manager.ts:32-44`

```ts
/** The last sync pass's outcome, as the UI renders it. */
export type SyncStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "syncing" }
  | {
      readonly kind: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
      readonly at: number;
    }
  | { readonly kind: "error"; readonly message: string };
```

### 5. Mobile's projection — `apps/mobile/src/lib/sync/manager.ts:48-59`

```ts
function statusFromOutcome(outcome: SyncOutcome): SyncStatus {
  return outcome.status === "ok"
    ? {
        kind: "ok",
        pushed: outcome.pushed,
        pulled: outcome.pulled,
        deleted: outcome.deleted,
        conflicts: outcome.conflicts,
        at: Date.now(),
      }
    : { kind: "error", message: outcome.message };
}
```

The two projections are identical modulo the discriminant key and the `at` stamp.

### 6. Everywhere `SyncStatus` is referenced (the full blast radius)

```
apps/desktop/src/renderer/settings/sections/sync-section.tsx:10   import type { SyncState, SyncStatus } from "@repo/features/sync";
apps/desktop/src/renderer/settings/sections/sync-section.tsx:13   function formatSyncStatus(status: SyncStatus): string {
apps/mobile/src/app/index.tsx:19                                  import { syncOnce, useSyncStatus, type SyncStatus } from "@/lib/sync/manager";
apps/mobile/src/app/index.tsx:184                                 function describeStatus(status: SyncStatus): string {
apps/mobile/src/lib/sync/manager.ts:33,46,48,131
packages/features/src/sync.ts:42,72                               (SyncState.status: SyncStatus)
packages/features/src/server/sync/sync-coordinator.ts:28,31,76
```

Mobile's `describeStatus` (`apps/mobile/src/app/index.tsx:184-195`) switches on
`status.kind`:

```ts
function describeStatus(status: SyncStatus): string {
  switch (status.kind) {
    case "idle":
      return "Not synced yet";
    case "syncing":
      return "Syncing…";
    case "ok":
      return `Synced — ↑${status.pushed} ↓${status.pulled} ✕${status.deleted} ⚠${status.conflicts}`;
    case "error":
      return `Sync failed: ${status.message}`;
  }
}
```

It must be updated to switch on `status.phase`. **The rendered strings must not
change.**

### Constraints you must honor

- **`@repo/core` is PURE and clock-free.** `.oxlintrc.json` enforces it for
  `packages/core/src/**`: _"@repo/core is PURE and platform-neutral — it runs
  unchanged in a Cloudflare Worker, React Native, and the desktop renderer. No
  node, no electron, no react, no other workspace package."_ The rule's
  `no-restricted-imports` patterns block `node:*`, `electron`, `react`,
  `react-dom`, `@repo/features*`, `@repo/ui*`. `engine.ts:62-66` states the
  clock rule outright:

```ts
/**
 * A filesystem-safe timestamp for a conflict-copy name (no `:` — Windows/exFAT
 * reject it). @repo/core stays clock-free; the platform adapter supplies this.
 */
export type Clock = () => string;
```

So: **no `Date.now()` in the new core module.** Mobile stamps `at` itself,
after calling the shared projection.

- **`packages/features/src/sync.ts` is ISO code that loads in the RENDERER.** Its
  header says so:

```ts
// packages/features/src/sync.ts:1-11
// Vault-sync contract — the isomorphic shapes the Bridge/IPC registry, the host
// handlers, and the renderer settings UI all share. The sync ENGINE lives in
// @repo/core (pure reconcile) and its desktop adapters in server/sync/; this
// module is only the wire contract, so it stays node-free and loads in the
// renderer too.
//
// `SyncOutcome` mirrors @repo/core's engine outcome STRUCTURALLY (rather than
// importing it) so the renderer never has to reach into @repo/core: the desktop
// coordinator returns core's outcome and it assigns cleanly to this one.
```

Note the deliberate choice recorded there: `SyncOutcome` is **mirrored, not
imported**. `SyncStatus` is a different case — it is a _shared_ UI-facing
contract both platforms need, so importing it from core is the point of this
plan. **Do not touch `SyncOutcome` in that file.** The renderer already imports
from `@repo/core` elsewhere (e.g. `vault-context.tsx` imports
`@repo/core/knowledge/link-resolve`), so a core import from an iso module is
fine.

- **Pick ONE discriminant: `phase`.** Desktop's settings UI, the IPC-facing
  contract in `features/src/sync.ts`, and the coordinator already speak `phase`.
  Mobile is the smaller blast radius (2 files). Mobile changes to `phase`.

- No barrel files — direct subpath imports (`@repo/core/sync/status`).
- Filenames kebab-case. No `any`, no non-null `!`, no `as` casts.
- **New core subpaths must be declared in `packages/core/package.json`
  `exports`** or nothing can import them. Existing entries look like
  `"./sync/engine": "./src/sync/engine.ts"`.

## Commands you will need

| Purpose        | Command                                          | Expected on success |
| -------------- | ------------------------------------------------ | ------------------- |
| Install        | `pnpm install`                                   | exit 0              |
| Format         | `pnpm format:fix` (run FIRST, never after gates) | exit 0              |
| Typecheck      | `pnpm typecheck`                                 | exit 0              |
| Core tests     | `pnpm --filter @repo/core test`                  | all pass            |
| Features tests | `pnpm --filter @repo/features test`              | all pass            |
| Desktop tests  | `pnpm --filter @repo/desktop test`               | all pass            |
| Mobile tests   | `pnpm --filter @repo/mobile test`                | all pass            |
| Lint           | `pnpm lint`                                      | exit 0              |
| Dead code      | `pnpm knip`                                      | exit 0              |

## Scope

**In scope** (the only files you should modify or create):

- `packages/core/src/sync/status.ts` (create)
- `packages/core/src/sync/__tests__/status.test.ts` (create)
- `packages/core/package.json` (add the `./sync/status` export entry — nothing else)
- `packages/features/src/sync.ts` (re-export the core type; delete the local definition)
- `packages/features/src/server/sync/sync-coordinator.ts` (delete `toStatus`, import the core projection)
- `apps/mobile/src/lib/sync/manager.ts` (import the core type + projection; keep the `at` stamp locally)
- `apps/mobile/src/app/index.tsx` (`describeStatus`: switch on `phase` instead of `kind` — no string changes)

**Out of scope** (do NOT touch, even though they look related):

- `packages/core/src/sync/engine.ts` — `SyncOutcome` is unchanged. Do not move it,
  do not import `status.ts` from it.
- `packages/features/src/sync.ts`'s `SyncOutcome` mirror — the header explains why
  it is a structural mirror rather than an import. Leave it.
- `apps/desktop/src/renderer/settings/sections/sync-section.tsx` — it already
  speaks `phase`; the type's shape does not change, so this file must NOT need
  editing. If it does, STOP.
- The wire protocol (`packages/core/src/sync/wire.ts`) and `apps/cloud/**` —
  `SyncStatus` never goes over the network; it's a local UI projection.
- Mobile's reactive store wrapper (`createExternalStore`, `StatusReportingSyncEngine`,
  `useSyncStatus`) — keep it, only its status _type_ changes.

## Git workflow

- Branch: `kyh/plan-010-sync-status-dedup`
- Conventional commits, e.g. `refactor(core): own SyncStatus + the outcome projection`
- Do NOT push and do NOT open a PR.

## Steps

### Step 1: Create the core module

Create `packages/core/src/sync/status.ts`:

```ts
// ---------------------------------------------------------------------------
// SyncStatus — the "what did the last pass do" projection of the engine's
// `SyncOutcome`, shared by every platform's sync UI. It lives in @repo/core
// next to the outcome it derives from: desktop and mobile used to each define
// this enum and its projection, and drifted (one said `phase`, the other
// `kind`). One definition, one projection, one place to change.
//
// Clock-free, like the rest of @repo/core (see engine.ts's `Clock`): a platform
// that wants a "synced at" timestamp stamps it itself, around this projection.
// ---------------------------------------------------------------------------

import type { SyncOutcome } from "./engine";

/** The most recent pass's status for a sync UI: idle before any pass, syncing
 * while one runs, then the outcome of the last completed pass. */
export type SyncStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "syncing" }
  | {
      readonly phase: "ok";
      readonly pushed: number;
      readonly pulled: number;
      readonly deleted: number;
      readonly conflicts: number;
    }
  | { readonly phase: "error"; readonly message: string };

/** Project one completed pass's outcome into the status a UI renders. */
export function syncStatusFromOutcome(outcome: SyncOutcome): SyncStatus {
  return outcome.status === "ok"
    ? {
        phase: "ok",
        pushed: outcome.pushed,
        pulled: outcome.pulled,
        deleted: outcome.deleted,
        conflicts: outcome.conflicts,
      }
    : { phase: "error", message: outcome.message };
}
```

Add the subpath export to `packages/core/package.json`, next to the other
`./sync/*` entries:

```json
"./sync/status": "./src/sync/status.ts",
```

**Verify**: `pnpm typecheck` → exit 0. `pnpm lint` → exit 0 (proves the core
purity rule is satisfied: no node/react/workspace import in the new module).

### Step 2: Point features at it

In `packages/features/src/sync.ts`, delete the local `SyncStatus` definition
(lines 40–52) and re-export core's:

```ts
export type { SyncStatus } from "@repo/core/sync/status";
```

Keep the explanatory doc comment (move it to core in step 1 — it's already in the
snippet above). `SyncState.status` (line 72) keeps referencing `SyncStatus`
unchanged. **Do not touch `SyncOutcome` in this file.**

In `packages/features/src/server/sync/sync-coordinator.ts`: delete the private
`toStatus` function (lines 31–41) and import the core projection instead:

```ts
import { syncStatusFromOutcome } from "@repo/core/sync/status";
```

Replace every `toStatus(...)` call site with `syncStatusFromOutcome(...)` (find
them: `grep -n "toStatus" packages/features/src/server/sync/sync-coordinator.ts`).
The `SyncStatus` type import from `@repo/features/sync` at line 28 can stay —
it now resolves to the core type.

**Verify**:

- `pnpm typecheck` → exit 0.
- `pnpm --filter @repo/features test && pnpm --filter @repo/desktop test` → all pass.
- `git status --short` shows **no change** to
  `apps/desktop/src/renderer/settings/sections/sync-section.tsx`. (The shape is
  identical, so the renderer is import-only churn — in fact, zero churn.)
- `grep -rn "phase: \"idle\"" packages/features/src` → still matches
  `sync-coordinator.ts:76` (unchanged).

### Step 3: Point mobile at it

In `apps/mobile/src/lib/sync/manager.ts`:

1. Delete the local `SyncStatus` type (lines 32–44).
2. Import from core:
   ```ts
   import {
     syncStatusFromOutcome,
     type SyncStatus as CoreSyncStatus,
   } from "@repo/core/sync/status";
   ```
3. Mobile's `ok` variant carries an extra `at: number` (a "last synced" stamp the
   mobile UI owns). Core stays clock-free, so **compose** rather than fork:

   ```ts
   /** Core's status, plus the local wall-clock stamp the mobile UI shows. The
    * stamp is added HERE (not in core, which is clock-free — see
    * @repo/core/sync/engine.ts `Clock`). */
   export type SyncStatus =
     | Exclude<CoreSyncStatus, { phase: "ok" }>
     | (Extract<CoreSyncStatus, { phase: "ok" }> & { readonly at: number });

   function statusFromOutcome(outcome: SyncOutcome): SyncStatus {
     const status = syncStatusFromOutcome(outcome);
     return status.phase === "ok" ? { ...status, at: Date.now() } : status;
   }
   ```

   `Exclude`/`Extract` are type operators, not `as` casts — allowed. The
   `status.phase === "ok"` narrowing is a real discriminant check, so the spread
   is type-safe with no assertion.

   If this composition proves awkward against the live code, the acceptable
   fallback is to keep mobile's `at` in a **separate** store value
   (`lastSyncedAt: number | null`) and use core's `SyncStatus` verbatim. Either is
   fine; do NOT reintroduce a forked enum.

4. Update the three literal status writes in this file — `{ kind: "idle" }`
   (line 46), `{ kind: "syncing" }` (line 68), and the two
   `{ kind: "error", message }` (lines 113, 124) — to use `phase`.

In `apps/mobile/src/app/index.tsx`, change `describeStatus` (line 184) to
`switch (status.phase)`. **The returned strings must be byte-identical.**

**Verify**:

- `pnpm typecheck` → exit 0.
- `pnpm --filter @repo/mobile test` → all pass, unchanged.
- `grep -rn "kind: \"idle\"\|kind: \"syncing\"\|kind: \"ok\"\|kind: \"error\"" apps/mobile/src`
  → **no matches** (the discriminant is fully migrated).
- `git diff -- apps/mobile/src/app/index.tsx` → the only changes are `kind` →
  `phase`; every string literal is untouched.

### Step 4: Tests

See the test plan. Write the core test, then run all suites.

**Verify**: `pnpm --filter @repo/core test && pnpm --filter @repo/features test && pnpm --filter @repo/desktop test && pnpm --filter @repo/mobile test` → all pass.

### Step 5: Gates

`pnpm format:fix` FIRST, then:
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`

**Verify**: every command exits 0. If `knip` flags `src/sync/status.ts` as
unused, the `packages/core/package.json` export entry is missing or misspelled —
fix that, not the knip config (`knip.json`'s `packages/core` workspace already
sets `"includeEntryExports": false` and treats the subpath exports as the public
API).

## Test plan

- **New**: `packages/core/src/sync/__tests__/status.test.ts` — model it after the
  existing tests in that directory (`reconcile.test.ts` is the closest pure-function
  test). Cover `syncStatusFromOutcome`:
  1. **ok with counts**: given
     `{ status: "ok", pushed: 2, pulled: 1, deleted: 0, conflicts: 3, conflictPaths: ["a.md"] }`
     → `{ phase: "ok", pushed: 2, pulled: 1, deleted: 0, conflicts: 3 }`. Assert
     the result has **no** `conflictPaths` key (the status is the UI projection —
     the copy paths are listed separately in Settings → Sync).
  2. **error**: `{ status: "error", message: "boom" }` → `{ phase: "error", message: "boom" }`.
  3. **ok with all-zero counts** still projects to `phase: "ok"` (an empty
     successful pass is a success, not idle).
- **Existing suites must stay green with NO edits**: desktop
  (`sync-section.tsx` renders status), features (`sync-coordinator` tests), mobile
  (`apps/mobile/src/lib/sync/__tests__/*`). If a mobile test asserts on `kind`,
  updating that assertion to `phase` is expected and allowed — it is pinning the
  discriminant this plan is unifying. Any OTHER test edit is a STOP condition.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm test` exits 0 (all five suites); the new core `status.test.ts` passes
- [ ] `pnpm lint && pnpm knip && pnpm format && pnpm build` all exit 0
- [ ] `packages/core/src/sync/status.ts` exists and exports both `SyncStatus` and
      `syncStatusFromOutcome`
- [ ] `grep -n '"./sync/status"' packages/core/package.json` → 1 match
- [ ] `grep -rn "kind: \"idle\"\|kind: \"syncing\"\|kind: \"ok\"\|kind: \"error\"" apps/mobile/src` → no matches
- [ ] `grep -n "^function toStatus" packages/features/src/server/sync/sync-coordinator.ts` → no matches
- [ ] `grep -rn "Date.now()" packages/core/src/sync/status.ts` → no matches (core stays clock-free)
- [ ] `git status --short` does NOT list `apps/desktop/src/renderer/settings/sections/sync-section.tsx`
      nor `packages/core/src/sync/engine.ts`
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live code (drift since `91347c66`).
- **The `SyncStatus` shape has to change** to make this compile. Only its
  _definition_ moves; the shape is identical. A required shape change means the
  Bridge wire contract changes, which ripples to the renderer — that is the
  operator's call, not yours.
- `apps/desktop/src/renderer/settings/sections/sync-section.tsx` needs an edit.
  Same reason.
- `pnpm lint` rejects the new core module (a restricted import). Core purity is
  non-negotiable — report rather than adding a lint exception.
- Making the mobile `at` stamp typecheck would require an `as` cast or a
  non-null `!`. Use the `lastSyncedAt` fallback in step 3 instead; if neither
  works, report.
- A test outside mobile's `kind` → `phase` assertions needs editing to pass.

## Maintenance notes

- The whole point: **there is now one place to add a phase or a counter.** A new
  `SyncOutcome` field means one edit in `packages/core/src/sync/status.ts` and the
  compiler finds every consumer.
- `packages/features/src/sync.ts` still _mirrors_ `SyncOutcome` structurally
  rather than importing it — that is deliberate (the file's header explains it) and
  intentionally NOT unified here. If a future plan wants to unify that too, note
  that the mirror exists so the IPC contract module stays self-describing; weigh
  that before collapsing it.
- Reviewer should scrutinize exactly two things: (1) that the mobile UI strings in
  `describeStatus` are byte-identical to before, and (2) that no `Date.now()` (or
  any clock) crept into `@repo/core`.
- Deferred: mobile still owns its own reactive store (`createExternalStore`) and
  the `StatusReportingSyncEngine` subclass. Those are platform wrappers, correctly
  platform-local — do not chase them into core.
