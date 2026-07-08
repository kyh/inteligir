# Plan 009: One base-manifest store — lift the JsonFile BaseStore into @repo/core

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/core/src/sync/base-store.ts apps/mobile/src/lib/sync/base-store.ts packages/features/src/server/sync/sync-manager.ts`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW-MED (base-file format change on desktop — safe by design, see below)
- **Depends on**: plans/001-sync-listing-cap-data-loss.md and plans/003-sync-hash-cache.md (same files; land those first to avoid rebase churn)
- **Category**: tech-debt
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

The "persist the last-synced base manifest as JSON" logic exists twice:
desktop (~90 LOC over a versioned `JsonStore`) and mobile (~40 LOC over a
`JsonFile` port). Same contract both times: the base is a PURE CACHE — any
missing/corrupt/legacy content means "re-sync from empty", never data loss.
Two implementations can drift; the contract belongs in `@repo/core` next to
the `BaseStore` interface, with each platform injecting only a tiny
`{read, write}` file port. Mobile's shape is the cleaner template.

## Current state

- `packages/core/src/sync/base-store.ts` — the interface + `InMemoryBaseStore`
  only (`load(): VaultManifest | null`, `save(manifest)`).

- `apps/mobile/src/lib/sync/base-store.ts` — the template to lift, verbatim:

  ```ts
  export type JsonFile = {
    read(): string | null;
    write(text: string): void;
  };
  export function createBaseStore(file: JsonFile): BaseStore {
    return {
      load: () => {
        const text = file.read();
        if (text === null || text === "") return null;
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return null;
        }
        return parseVaultManifest(raw);
      },
      save: (manifest) => {
        file.write(JSON.stringify(manifest));
      },
    };
  }
  ```

- `packages/features/src/server/sync/sync-manager.ts` `createJsonBaseStore`
  (~:112-155) — a `JsonStore<VaultManifest>` with `BASE_VERSION` envelope
  (`{version, vaultId, generation, files}` on disk), a `fromLegacy` that
  throws, decode/encode hooks, and a vaultId guard on load:

  ```ts
  return {
    load: () => {
      const stored = store.read();
      return stored.vaultId === vaultId ? stored : emptyManifest(vaultId);
    },
    save: (manifest) => {
      store.write(manifest);
    },
  };
  ```

  Note: desktop's `load` returns `emptyManifest(vaultId)` on mismatch, but the
  ENGINE also guards (`engine.ts` `loadBase`: `stored === null || stored.vaultId
!== this.vaultId` → empty) — so returning `null` from the store is equally
  safe. The engine-side guard is the one that matters.

- **Format-change consequence (accepted)**: desktop base files on disk today
  carry the `{version: BASE_VERSION, ...}` envelope. The lifted store persists
  the bare manifest. On first run after this change, `parseVaultManifest` on
  an enveloped file either still parses (if it ignores extra keys) or returns
  null → base treated as absent → **one full re-sync from empty**, which by
  the module's own doc is "never data loss" (reconcile with an empty base
  pushes/pulls but cannot infer deletions — deletions need a base entry).
  Desktop also loses the JsonStore quarantine/recovery-toast for this one
  file — acceptable for a pure cache.

## Commands you will need

| Purpose        | Command                             | Expected |
| -------------- | ----------------------------------- | -------- |
| Core tests     | `pnpm --filter @repo/core test`     | pass     |
| Features tests | `pnpm --filter @repo/features test` | pass     |
| Mobile tests   | `pnpm --filter @repo/mobile test`   | pass     |
| Full gate      | see plan 002's canonical gate       | exit 0   |

## Scope

**In scope**:

- `packages/core/src/sync/base-store.ts` (add `JsonFile` + `createJsonFileBaseStore`)
- `packages/core/src/sync/__tests__/` (move/adapt mobile's base-store tests)
- `apps/mobile/src/lib/sync/base-store.ts` (delete; rewire its importer)
- `apps/mobile/src/__tests__/` (drop the now-core-owned cases, keep adapter wiring tests)
- `packages/features/src/server/sync/sync-manager.ts` (replace `createJsonBaseStore` internals with core store + a small fs `JsonFile`)
- `plans/README.md`

**Out of scope**:

- `JsonStore` itself (`packages/features/src/server/lib/json-store.ts`) — other stores keep using it.
- The engine and reconcile — untouched.
- Any base-file migration shim — the re-sync-from-empty path IS the migration.

## Git workflow

- Branch: `kyh/plan-009-base-store-dedup`
- Commit: `refactor(sync): one JsonFile base store in core; platforms inject {read,write}`

## Steps

### Step 1: Lift into core

Move mobile's `JsonFile` type + factory into
`packages/core/src/sync/base-store.ts`, renamed
`createJsonFileBaseStore(file: JsonFile): BaseStore` (name it so the
in-memory store and the file store read distinctly). Keep the header comment
about "pure cache → corrupt = re-sync from empty". Core purity holds: no
imports beyond `./manifest`.

**Verify**: `pnpm --filter @repo/core test` → pass; `pnpm typecheck` → exit 0

### Step 2: Mobile consumes core

Delete `apps/mobile/src/lib/sync/base-store.ts`; point its importer (grep
`createBaseStore` under `apps/mobile/src`) at
`@repo/core/sync/base-store`. Move the base-store unit tests that test the
FACTORY into core's test dir (adapt import paths); keep any mobile test that
tests mobile's `JsonFile` wiring.

**Verify**: `pnpm --filter @repo/mobile test && pnpm --filter @repo/core test` → pass

### Step 3: Desktop consumes core

In `sync-manager.ts`, reimplement `createJsonBaseStore(vaultId, opts)` as:
a ~10-line fs-backed `JsonFile` (read: `readFileSync(path, "utf8")` or null
on ENOENT/any error; write: `mkdirSync(dirname, {recursive:true})` +
`writeFileSync`) over `opts.path ?? baseStorePath(vaultId)`, passed to core's
`createJsonFileBaseStore`. Keep the exported signature so callers don't
change; keep the vaultId guard by wrapping `load` (or rely on the engine's
guard — if you rely on the engine, say so in a comment). Delete the
`BaseManifestSchema`/`BASE_VERSION`/decode/encode machinery this obsoletes
(knip will confirm).

**Verify**: `pnpm --filter @repo/features test` → pass; `pnpm knip` → exit 0

### Step 4: Behavior test for the format change

In features' sync tests: write an OLD-envelope base file
(`{version: 1, vaultId, generation, files}`) to a temp path, construct the
new store over it → `load()` returns either a valid manifest (extra-key
tolerated) or null; assert it does NOT throw. This pins the "old file
degrades to re-sync, never crashes" contract.

**Verify**: `pnpm --filter @repo/features test` → pass

### Step 5: Gates

`pnpm format:fix` then the full canonical gate.

## Done criteria

- [ ] One JSON base-store implementation, in core; mobile file deleted
- [ ] Desktop's `createJsonBaseStore` is a thin JsonFile adapter; envelope machinery gone (knip green)
- [ ] Old-envelope file load test passes (no throw)
- [ ] Full gate exits 0; `plans/README.md` updated

## STOP conditions

- Excerpts drifted.
- `parseVaultManifest` THROWS (rather than returning null) on malformed
  input — check its contract first; if it throws, wrap in the core factory,
  don't change the parser.
- Desktop callers depend on `createJsonBaseStore` returning the
  quarantine/recovery behavior (grep for tests asserting recovery toasts on
  the base store) — report if so.

## Maintenance notes

- If the base manifest ever gains fields, version it with a `parse-or-null`
  evolution in `parseVaultManifest` (core), not with per-platform envelopes.
- Reviewer: confirm the desktop write path creates parent dirs (first sync on
  a fresh install writes into a not-yet-existing directory).
