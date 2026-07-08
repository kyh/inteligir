# Plan 005: Renderer test infrastructure + extract NoteRuntime into a testable module

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- apps/desktop/vitest.config.ts apps/desktop/src/renderer/workspace/vault-context.tsx apps/desktop/package.json`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P1
- **Effort**: M-L
- **Risk**: MED (live editing path refactor — behavior-preserving)
- **Depends on**: none (blocks plan 004)
- **Category**: tests / tech-debt
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

The renderer — the entire product UI — has zero component/hook tests: the
desktop vitest config is node-env and includes only `*.test.ts`. The single
most regression-prone object is the open note's runtime inside
`vault-context.tsx` (683 LOC): autosave debounce, vanish watcher, rename
carry-over. Lost-edit bugs here are silent. This plan adds a jsdom test
project and extracts the NoteRuntime lifecycle into a standalone module with
characterization tests, which also unblocks plan 004's tests.

## Current state

- `apps/desktop/vitest.config.ts`:

  ```ts
  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      server: { deps: { inline: [/@platejs\/math/] } },
    },
    resolve: { alias: { "@": ..., "@renderer": resolve(import.meta.dirname, "src/renderer") } },
  });
  ```

- `apps/desktop/src/renderer/workspace/vault-context.tsx` — the runtime type
  (~:80-95):

  ```ts
  /** The open note's live machinery: its editor controller (per-doc state), its
   * autosave debounce, and the vanish watcher that closes the note when the file
   * disappears out from under it. */
  type NoteRuntime = {
    path: string;
    controller: VaultEditorController;
    saveTimer: ReturnType<typeof setTimeout> | null;
    opened: boolean; // gates the vanish watcher (initial path:null must not close)
    unsubscribe: () => void;
  };
  ```

  The autosave path (`editNote`, ~:300-312):

  ```ts
  const editNote = useCallback((path: string, next: string) => {
    const runtime = runtimeRef.current;
    if (runtime?.path !== path) return;
    if (runtime.controller.getState().content === next) return; // identical bytes no-op
    runtime.controller.edit(next);
    if (runtime.saveTimer) clearTimeout(runtime.saveTimer);
    runtime.saveTimer = setTimeout(() => {
      runtime.saveTimer = null;
      void runtime.controller.flush();
    }, AUTOSAVE_DEBOUNCE_MS); // 600
  }, []);
  ```

  Elsewhere in the file: `ensureRuntime(path)` / `disposeRuntime()` construct
  and tear down the runtime (locate them — they subscribe to the controller and
  implement the vanish watcher gated by `opened`), `deleteEntry` clears the
  timer + `controller.remove()`, rename disposes-before-bridge-call to dodge a
  vanish-watcher race (see the comments there), unmount flushes. `VAULT_IO`
  (top of file) already isolates the bridge behind a `VaultIO` object —
  the controller is bridge-agnostic by design.

- Conventions: kebab-case files; renderer never imports electron/node
  (lint-enforced); pure logic modules live next to their consumers.

## Commands you will need

| Purpose        | Command                                                           | Expected |
| -------------- | ----------------------------------------------------------------- | -------- |
| Add deps       | `pnpm --filter @repo/desktop add -D jsdom @testing-library/react` | exit 0   |
| Desktop tests  | `pnpm --filter @repo/desktop test`                                | pass     |
| Typecheck/lint | `pnpm typecheck && pnpm lint`                                     | exit 0   |
| Harness        | `pnpm --filter @repo/desktop dev:harness`                         | :5173    |

## Scope

**In scope**:

- `apps/desktop/vitest.config.ts`, `apps/desktop/package.json` (devDeps)
- `apps/desktop/src/renderer/workspace/note-runtime.ts` (create)
- `apps/desktop/src/renderer/workspace/note-runtime.test.ts` (create)
- `apps/desktop/src/renderer/workspace/vault-context.tsx` (consume the module)
- `plans/README.md`

**Out of scope**:

- `VaultEditorController` and everything under `editor/` — consume, don't change.
- `open-note-flush.ts` — its contract is unchanged.
- Broad vault-context decomposition (listing, ui-state persistence stay put) —
  ONLY the NoteRuntime lifecycle moves.

## Git workflow

- Branch: `kyh/plan-005-note-runtime-tests`
- Commits: `test(desktop): jsdom vitest project for renderer` then
  `refactor(renderer): extract note-runtime lifecycle (behavior-preserving)`

## Steps

### Step 1: jsdom test project

Convert `vitest.config.ts` to two projects (vitest 4 `test.projects`):

- `node` project: today's config verbatim (`src/**/*.test.ts`, node env).
- `renderer` project: `environment: "jsdom"`, include
  `src/renderer/**/*.test.tsx`, same plugins/aliases/inline deps.
  Add devDeps `jsdom` + `@testing-library/react`. Add a trivial
  `smoke.test.tsx` (renders a `<div>`, asserts textContent) to prove the
  project runs; delete it in the same PR once note-runtime tests exist.

**Verify**: `pnpm --filter @repo/desktop test` → both projects run, all pass

### Step 2: Extract `note-runtime.ts` (no behavior change)

Create `workspace/note-runtime.ts` exporting roughly:

```ts
export type NoteRuntimeCallbacks = {
  /** The note's file vanished after a successful open — close it. */
  onVanished(path: string): void;
  /** Controller state changed (re-render trigger). */
  onStateChanged(): void;
};
export function createNoteRuntime(path: string, io: VaultIO, cb: NoteRuntimeCallbacks): NoteRuntime; // { path, controller, edit(next), flush(), dispose(), remove() }
```

Move VERBATIM from vault-context.tsx: controller construction, the
subscription + `opened` gating + vanish detection, the autosave debounce
(`edit` owns the 600ms timer), timer cleanup on dispose/remove/flush.
`vault-context.tsx` keeps: WHEN to create/dispose (open/rename/delete/root
switch ordering — those comments encode races; do not reorder), ui-state
persistence, listing. The provider's `runtimeRef` now holds the module's
runtime object. Preserve the rename dance exactly (dispose before bridge
call, re-attach on failure).

**Verify**: `pnpm typecheck && pnpm lint` → exit 0;
`pnpm --filter @repo/desktop test` → existing tests pass

### Step 3: Characterization tests (`note-runtime.test.ts`, node project, fake timers)

Against an in-memory `VaultIO` fake (Map-backed read/write/remove):

1. `edit` then 600ms elapse → exactly one write with final bytes; three rapid
   edits coalesce to one write.
2. `edit` with identical bytes → no dirty, no timer (pin the no-op guard).
3. `flush()` mid-debounce → immediate write, timer cleared, no second write.
4. Vanish: after a successful load, io signaling the file gone (drive the same
   path the controller uses — read rejects / external change to `path: null`)
   → `onVanished` fired once. Before first successful load → NOT fired
   (the `opened` gate).
5. `dispose()` with a pending timer → timer cleared, no write after.
6. `remove()` → underlying io.remove called; pending timer cleared.
   (Exact mechanics of #4 depend on `VaultEditorController`'s API — read
   `@renderer` editor controller source first; if the vanish signal cannot be
   driven through the public controller API with a fake io, STOP and report the
   API gap instead of reaching into privates.)

**Verify**: `pnpm --filter @repo/desktop test` → all pass, ≥6 new tests

### Step 4: Manual harness drive

In `dev:harness`: open note → type → wait 1s → reload page → text persisted.
Rename an edited note → content carried. Delete the open note from the
sidebar → editor closes without error.

### Step 5: Gates

`pnpm format:fix` then full gate:
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`.

## Done criteria

- [ ] jsdom project runs `.test.tsx` files
- [ ] `note-runtime.ts` exists; vault-context.tsx no longer owns the save
      timer or vanish gating directly (grep `saveTimer` in vault-context.tsx → 0 matches)
- [ ] ≥6 characterization tests pass; full gate exits 0
- [ ] Manual drive performed; `plans/README.md` updated

## STOP conditions

- `NoteRuntime`/`editNote` don't match the excerpts (drift).
- The controller API forces the extraction to change observable timing
  (e.g. subscription order) — report the specific coupling.
- Step 3 case 4's vanish signal can't be driven via public API.

## Maintenance notes

- Plan 004 builds on this seam (registers a serialize-flush on the runtime).
- The remaining vault-context concerns (listing refresh, ui-state persistence)
  are deliberately NOT extracted — do that only if they grow tests of their own.
- Reviewer: diff Step 2 hard for accidental reordering around rename/delete —
  the inline comments there document real races (flush-before-rename,
  dispose-before-bridge-call).
