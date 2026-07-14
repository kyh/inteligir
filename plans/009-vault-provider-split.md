# Plan 009: Split the VaultProvider god-component into composable hooks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (only if that file exists — do not create it).
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/desktop/src/renderer/workspace`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `91347c66`, 2026-07-12

**Conflict warning**: plan 004 (shared vault crawl) touches the vault listing on
the **backend** (`packages/features/src/server/vault/`), not the renderer — it
does not conflict with this plan. The real conflict risk is any other in-flight
work inside `apps/desktop/src/renderer/workspace/`. Before starting, run
`git status` and `git log --oneline -5 -- apps/desktop/src/renderer/workspace`;
if someone else is mid-flight in this directory, STOP and report.

## Why this matters

`apps/desktop/src/renderer/workspace/vault-context.tsx` is 662 lines, of which
the `VaultProvider` function alone is ~495 (lines 167–661): ~20 `useCallback`s
and 6 `useEffect`s in one closure. It owns at least six unrelated concerns
(editor view/mode state, HTML-app view toggling, open-note runtime lifecycle,
the vault listing with its own sequencing/dedup logic, file CRUD, and wiki-target
resolution). Every renderer feature that needs any one of them takes a dependency
on all of them, and the file is now the highest-friction place in the renderer to
change safely — the ordering rules that keep user edits from being written into
the wrong file are implicit in the closure's shape.

This plan extracts the two concerns that are cleanly separable (listing, file
ops) into sibling hooks, following the precedent already set by
`workspace/note-runtime.ts`. **Zero behavior change.** After it lands,
`VaultProvider` is wiring plus the concerns that genuinely need the shared refs.

## Current state

### The file

- `apps/desktop/src/renderer/workspace/vault-context.tsx` — 662 lines. Exports
  `useVault()` (line 161) and `VaultProvider` (line 167). The context value type
  `VaultContextValue` is declared at lines 80–157 and is the **public contract**
  of this module.
- `apps/desktop/src/renderer/workspace/note-runtime.ts` — **the extraction
  precedent**. Its header comment states the split exactly:

```ts
// note-runtime.ts:1-6
// NoteRuntime — the open note's live machinery, extracted from vault-context so
// the debounce/vanish lifecycle can be characterized in isolation. The provider
// owns WHEN to create/dispose one (open/rename/delete/root-switch ordering —
// those races live in vault-context); this owns HOW one behaves: the editor
// controller, the autosave debounce timer, and the vanish watcher that fires
// when the file disappears out from under the open note.
```

It is already unit-tested at `apps/desktop/src/renderer/__tests__/note-runtime.test.ts`.
**Do not modify note-runtime.ts.**

### The six concerns inside `VaultProvider` (verified line ranges)

| Concern                     | Symbols                                                                                                                                       | Lines                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Open-note runtime lifecycle | `applyOpenPath`, `disposeRuntime`, `dropNote`, `ensureRuntime`, `flushCurrent`, `openFile`, `editNote`, `registerNoteSerializeFlush`, `flush` | 185–268, 316–326, 459 |
| Vault listing               | `listSeq`, `lastEntriesRef`, `refreshList`, `entries` state                                                                                   | 168, 279–314          |
| File CRUD                   | `createFileAt`, `createFile`, `openOrCreateNote`, `renameEntry`, `deleteEntry`, `changeFolder`                                                | 328–457               |
| Wiki resolution             | `resolver`, `resolveWikiTarget`                                                                                                               | 557–561               |
| Editor view/mode            | `isMarkdownOpen`, `mode`/`setMode`, `analyzed`, `richAvailable`                                                                               | 563–597               |
| HTML-app view               | `htmlAsText`, `openIsHtml`, `isHtmlApp`, `showHtmlAsText`, `showHtmlAsApp`                                                                    | 183, 599–603          |

### The refs everything shares (do not break these)

`VaultProvider` threads five refs through the closure. **The
synchronous-ref-as-source-of-truth pattern is DELIBERATE** — the file says so:

```ts
// vault-context.tsx:172-178
// ---- Open note -----------------------------------------------------------
// The ref is the source of truth every operation reads and writes
// SYNCHRONOUSLY; the state is its render mirror. Keeping mutations out of
// setState updaters keeps them single-shot under StrictMode's double-invoke.
const openPathRef = useRef<string | null>(null);
const [openPath, setOpenPath] = useState<string | null>(null);
const runtimeRef = useRef<NoteRuntime | null>(null);
```

- `openPathRef` (176) — the open note's path, read synchronously by `openFile`,
  `renameEntry`, and the restore effect.
- `runtimeRef` (178) — the live `NoteRuntime`.
- `rootRef` (170) — the vault root, read synchronously by `ensureRuntime`.
- `listSeq` (279) + `lastEntriesRef` (286) — listing ordering + dedup.

### The listing logic to extract (verbatim, lines 277–314)

```ts
// Ordering token so overlapping list calls (initial load + onVaultChanged, or
// rapid vault events) can't land out of order — only the latest applies.
const listSeq = useRef(0);
// Last-applied listing, in a ref so the async callback compares against the
// truly latest value (React state would be a stale closure). Every vault
// broadcast re-fetches the listing — focus refreshes, delegation completion,
// external open-note edits (autosaves went silent with ADR-0001) — and most
// of those don't change the listing, so skip the state set when nothing
// structural changed to keep the sidebar tree from re-rendering on refocus.
const lastEntriesRef = useRef<VaultEntry[]>([]);
const refreshList = useCallback(() => {
  const bridge = getBridge();
  if (!bridge) return;
  const seq = ++listSeq.current;
  void (async () => {
    try {
      const next = await bridge.listVault();
      if (seq !== listSeq.current) return;
      const prev = lastEntriesRef.current;
      const same =
        next.length === prev.length &&
        next.every((entry, i) => {
          const before = prev[i];
          return (
            before !== undefined &&
            entry.path === before.path &&
            entry.name === before.name &&
            entry.kind === before.kind
          );
        });
      if (same) return;
      lastEntriesRef.current = next;
      setEntries(next);
    } catch {
      // Best-effort — keep the last-known listing on a transient failure.
    }
  })();
}, []);
```

### The ordering rule you must not break

`openFile` (248–268) flushes the CURRENT note **before** disposing its runtime
and opening the next one:

```ts
const openFile = useCallback(
  (path: string) => {
    void (async () => {
      useViewStore.getState().setSurface("editor");
      if (openPathRef.current === path) return;
      // Flush the current note first, and refuse to navigate away from
      // edits that won't save (same contract as before).
      if (!(await flushCurrent())) {
        toast.error("Couldn't save the current file — resolve that before switching.");
        return;
      }
      disposeRuntime();
      ensureRuntime(path);
      applyOpenPath(path);
    })();
  },
  [applyOpenPath, disposeRuntime, ensureRuntime, flushCurrent],
);
```

`renameEntry` (383–417) has the same discipline (flush → dispose → bridge call →
re-attach). **If a flush ever lands AFTER the next note has opened, the old
note's bytes are written into the new note's file.** That is the worst possible
regression from this refactor and typecheck cannot catch it.

### Conventions that apply

- **Filenames are kebab-case** (`use-vault-listing.ts`, `use-vault-file-ops.ts`).
- **No `any`, no non-null `!`, no `as` casts.** The existing file honors this —
  match it.
- No barrel files: import directly by subpath (`@renderer/workspace/note-runtime`).
- The renderer is host-agnostic: it reaches the backend only through
  `getBridge()` from `@renderer/lib/bridge`. Lint blocks electron/node imports
  under `apps/desktop/src/renderer/**` (`.oxlintrc.json`, "the renderer UI is
  host-agnostic" rule). Your new hooks live in the renderer — same rule.
- Comment style: prose `//` comments that explain the WHY. Carry the existing
  comments across verbatim when you move code; they are the only record of the
  races being defended against.

### Consumers of `useVault()` (17 files — the contract you must not break)

```
apps/desktop/src/renderer/command/command-palette.tsx
apps/desktop/src/renderer/delegation/delegation-dock.tsx
apps/desktop/src/renderer/editor/editor-pane.tsx
apps/desktop/src/renderer/editor/todo-delegation.tsx
apps/desktop/src/renderer/editor/transclusion.tsx
apps/desktop/src/renderer/editor/wiki-autocomplete.tsx
apps/desktop/src/renderer/editor/wiki-chip.tsx
apps/desktop/src/renderer/layout/header.tsx
apps/desktop/src/renderer/settings/sections/sync-section.tsx
apps/desktop/src/renderer/sidebar/app-sidebar.tsx
apps/desktop/src/renderer/workspace/graph-view.tsx
apps/desktop/src/renderer/workspace/html-app-view.tsx
apps/desktop/src/renderer/workspace/links-panel.tsx
apps/desktop/src/renderer/workspace/save-indicator.tsx
apps/desktop/src/renderer/workspace/use-note-templates.ts
apps/desktop/src/renderer/workspace/workspace-page.tsx
```

(Re-derive with `grep -rln "useVault(" apps/desktop/src/renderer`.) **None of
these files may change.** If one has to, the refactor has changed the contract —
STOP.

## Commands you will need

| Purpose                           | Command                                          | Expected on success                  |
| --------------------------------- | ------------------------------------------------ | ------------------------------------ |
| Install                           | `pnpm install`                                   | exit 0                               |
| Format                            | `pnpm format:fix` (run FIRST, never after gates) | exit 0                               |
| Typecheck                         | `pnpm typecheck`                                 | exit 0                               |
| Desktop tests                     | `pnpm --filter @repo/desktop test`               | all pass                             |
| Lint                              | `pnpm lint`                                      | exit 0                               |
| Dead code                         | `pnpm knip`                                      | exit 0                               |
| Dev harness (browser, no backend) | `pnpm --filter @repo/desktop dev:harness`        | vite serves on http://localhost:5173 |

The desktop vitest config (`apps/desktop/vitest.config.ts`) runs **two
projects**: `node` (`src/**/*.test.ts`, node environment) and `renderer`
(`src/renderer/**/*.test.tsx`, **jsdom**). A test that renders a React hook must
therefore be named `*.test.tsx` and live under `src/renderer/` — a `.test.ts`
file gets the node environment and no DOM.

## Suggested executor toolkit

- Use the **agent-browser** skill (if available) to drive the dev harness in
  step 5. It attaches to a running browser and can click/type/screenshot.
- Read `apps/desktop/src/renderer/workspace/note-runtime.ts` and
  `apps/desktop/src/renderer/__tests__/note-runtime.test.ts` before writing any
  code — they are the shape to imitate.
- `docs/development.md` documents the two run modes (fixture harness / Electron).

## Scope

**In scope** (the only files you should modify or create):

- `apps/desktop/src/renderer/workspace/vault-context.tsx` (modify)
- `apps/desktop/src/renderer/workspace/use-vault-listing.ts` (create)
- `apps/desktop/src/renderer/workspace/use-vault-file-ops.ts` (create)
- Tests under `apps/desktop/src/renderer/__tests__/` (create/extend)

**Out of scope** (do NOT touch, even though they look related):

- `apps/desktop/src/renderer/workspace/note-runtime.ts` — already extracted and
  tested. Leave it exactly as is.
- All 17 `useVault()` consumers listed above — if any needs a change, the context
  value shape changed, which this plan forbids.
- `packages/features/src/ipc-registry.ts` and anything under
  `packages/features/src/server/` — the Bridge/IPC layer is untouched.
- Editor internals (`apps/desktop/src/renderer/editor/**`).
- Any visual/UI change. Zero pixels move.
- The editor-view/mode block (563–597) and the HTML-app block (599–603) — they
  read `editor`/`openPath` from the provider's own state and are cheap to leave.
  Extracting them is a follow-up, not this plan.

## Git workflow

- Branch: `kyh/plan-009-vault-provider-split`
- Conventional commits, one per extraction step, e.g.
  `refactor(desktop): extract useVaultListing from VaultProvider`
- Do NOT push and do NOT open a PR.

## Steps

### Step 0: Baseline

Confirm the tree is clean and the suite is green BEFORE touching anything, so
any later failure is unambiguously yours.

**Verify**: `git status --short` → empty. `pnpm --filter @repo/desktop test` →
all pass. Record the number of passing tests.

### Step 1: Extract `useVaultListing`

Create `apps/desktop/src/renderer/workspace/use-vault-listing.ts` containing the
listing concern, moved **verbatim** (comments included) from vault-context.tsx
lines 277–314 plus the `entries` state (line 168):

```ts
import { useCallback, useRef, useState } from "react";

import { getBridge } from "@renderer/lib/bridge";
import type { VaultEntry } from "@repo/features/ipc-registry";

export type VaultListing = {
  /** Flat listing of every file in the vault (the tree is derived from it). */
  readonly entries: VaultEntry[];
  /** Re-fetch the listing from the host. Overlapping calls land in order;
   * a structurally identical result does not re-render. */
  readonly refreshList: () => void;
};

/** The vault listing: one fetch-on-demand, sequenced so overlapping calls can't
 * land out of order, and deduped so a no-op vault broadcast doesn't re-render
 * the sidebar tree. Extracted from VaultProvider (plan 009) — behavior
 * unchanged. */
export function useVaultListing(): VaultListing {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  // ... listSeq, lastEntriesRef, refreshList — moved verbatim
  return { entries, refreshList };
}
```

Then in `vault-context.tsx`: delete the moved code and replace it with
`const { entries, refreshList } = useVaultListing();`. Every existing caller of
`refreshList` (`createFileAt`, `openOrCreateNote`, `renameEntry`, `deleteEntry`,
`changeFolder`, the initial-load effect at 468–479, the `onVaultChanged` effect at
497–512) keeps calling it unchanged. `refreshList` must stay referentially stable
(`useCallback` with `[]` deps) — several `useEffect` dependency arrays list it,
and an unstable identity would re-subscribe `onVaultChanged` on every render.

**Verify**:

- `pnpm typecheck` → exit 0.
- `pnpm --filter @repo/desktop test` → same pass count as step 0.
- `grep -n "listSeq\|lastEntriesRef" apps/desktop/src/renderer/workspace/vault-context.tsx`
  → no matches (they moved).
- `git diff --stat` → only `vault-context.tsx` + the new file.

Commit before continuing.

### Step 2: Extract `useVaultFileOps`

Create `apps/desktop/src/renderer/workspace/use-vault-file-ops.ts` holding
`createFileAt`, `createFile`, `openOrCreateNote`, `renameEntry`, `deleteEntry`,
`changeFolder` and the module-level helper `withDefaultExtension`
(vault-context.tsx lines 39–45).

These functions are **not** self-contained: they read and write the provider's
open-note machinery. Do not try to make them pure. Inject exactly what they need
as a parameter object, so the ordering stays owned by the caller:

```ts
export type VaultFileOpsDeps = {
  /** Flush the open note's pending edits. MUST be awaited before any op that
   * moves/deletes/replaces the open file — a flush that lands after the next
   * note opens writes the old note's bytes into the new note. */
  readonly flushCurrent: () => Promise<boolean>;
  /** The open note's path, read SYNCHRONOUSLY (ref, not state). */
  readonly getOpenPath: () => string | null;
  /** The open note's live runtime, read SYNCHRONOUSLY (ref, not state). */
  readonly getRuntime: () => NoteRuntime | null;
  readonly disposeRuntime: () => void;
  readonly ensureRuntime: (path: string) => NoteRuntime;
  readonly applyOpenPath: (next: string | null) => void;
  readonly dropNote: (path: string) => void;
  readonly openFile: (path: string) => void;
  readonly refreshList: () => void;
  readonly setRoot: (root: string) => void; // changeFolder writes rootRef + state
};
```

The provider passes getters (`() => openPathRef.current`,
`() => runtimeRef.current`) rather than the refs themselves — the hook must never
own the refs, and must never read a stale React state value in place of one.
`changeFolder` currently writes `rootRef.current = result.root; setRoot(result.root);`
(lines 451–452): pass a single `setRoot` callback from the provider that does
both, so the ref/state pair stays in one place.

**Move the bodies verbatim.** Do not "clean up" the toast strings, the early
returns, or the comments — especially the comment at lines 395–398 explaining why
`disposeRuntime()` must run BEFORE the rename's bridge call.

**Verify**:

- `pnpm typecheck` → exit 0.
- `pnpm --filter @repo/desktop test` → same pass count as step 0.
- `git diff 91347c66 -- apps/desktop/src/renderer/workspace/vault-context.tsx | grep '^+' | grep -c 'await flushCurrent'`
  → the flush calls still exist in the moved code (sanity: search the new hook
  file for `flushCurrent` — `openFile`'s flush is in the provider, `renameEntry`'s
  and `changeFolder`'s are in the hook; all three must be present somewhere).

Commit before continuing.

### Step 3: Confirm the context value is byte-for-byte the same shape

`VaultContextValue` (lines 80–157) and the `useMemo` that builds `value`
(605–659) must be **unchanged** — same 24 keys, same types, same dependency
array contents (modulo the identifiers now coming from hooks).

**Verify**:

- `git diff 91347c66 -- apps/desktop/src/renderer/workspace/vault-context.tsx`
  shows **no change** inside the `type VaultContextValue = {...}` block.
- `pnpm typecheck` → exit 0 with **zero** files outside the in-scope list
  modified: `git status --short` lists only the three workspace files (+ tests).

### Step 4: Tests

See "Test plan". Write them, then run the suite.

**Verify**: `pnpm --filter @repo/desktop test` → all pass, including the new tests.

### Step 5: Drive the dev harness (REQUIRED — not optional)

Typecheck and unit tests **cannot** catch a flush-ordering regression. You must
exercise the real UI.

```bash
pnpm --filter @repo/desktop dev:harness   # vite, http://localhost:5173
```

This runs the real renderer against an in-memory fixture Bridge with a sample
vault (`apps/desktop/dev/fixture-bridge.ts`) — no Electron, no backend. Use the
`agent-browser` skill if available; otherwise drive it however you can and report
what you observed.

Exercise ALL of these and confirm each:

1. **Edit-then-switch (the ordering regression)**: open note A, type a
   recognizable string (e.g. `PLAN009-A`), then **immediately** (within the
   600ms autosave debounce — do not wait) click note B in the sidebar. Then
   reopen A.
   - **Expected**: A contains `PLAN009-A`. B does **not** contain it.
   - If B contains A's text, the flush ordering broke → STOP and report.
2. **Create**: create a new file from the sidebar → it appears in the tree and
   opens.
3. **Rename**: rename the open note → the tree updates, the note stays open at
   the new path, its content is intact.
4. **Delete**: delete the open note → it closes, and it leaves the tree.
5. **Change folder**: trigger the change-folder action → no crash (the fixture
   Bridge may return a stub; a clean no-op is fine, an exception is not).
6. Check the browser console: **no new errors or React warnings** versus a
   pre-change baseline.

**Verify**: all six behaviors as described. Write down what you did and saw — the
report must include it.

### Step 6: Gates

`pnpm format:fix` FIRST, then:
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`

**Verify**: every command exits 0.

## Test plan

Structural model: `apps/desktop/src/renderer/__tests__/note-runtime.test.ts`
(node project, `.test.ts`) for logic; `apps/desktop/src/renderer/workspace/html-app-runtime.test.tsx`
(jsdom project, `.test.tsx`) for anything that renders/uses React hooks.

- **`use-vault-listing`** — new test file
  `apps/desktop/src/renderer/__tests__/use-vault-listing.test.tsx` (jsdom; must
  be `.tsx` to land in the `renderer` vitest project). Render the hook against a
  fake bridge (stub `getBridge`, following whatever mocking pattern the existing
  renderer tests use — check `html-app-runtime.test.tsx` first) and cover:
  1. `refreshList()` populates `entries` from `bridge.listVault()`.
  2. **Out-of-order landing**: two `refreshList()` calls where the FIRST resolves
     LAST → the SECOND call's entries win (the `listSeq` guard).
  3. **Dedup**: a second `refreshList()` returning a structurally identical
     listing does not produce a new `entries` array identity (no re-render).
  4. A rejected `bridge.listVault()` keeps the previous entries (best-effort).
  5. No bridge (`getBridge()` → null/undefined) → no throw.
- **`use-vault-file-ops`** — if the deps object makes it testable without a full
  provider, add `apps/desktop/src/renderer/__tests__/use-vault-file-ops.test.tsx`
  covering: `createFileAt` on an existing path returns `true` without writing;
  `renameEntry` calls `flushCurrent` BEFORE `bridge.renameVaultEntry` and
  `disposeRuntime` before it too (assert call ORDER, e.g. by pushing into a
  shared array from each fake); a failed rename re-attaches the runtime to the
  original path. If wiring a meaningful test needs a real provider render, say so
  in the report and rely on step 5 instead — do not fabricate a test that asserts
  nothing.
- **Existing suites that must stay green, unchanged**: find them with
  `grep -rln "vault-context\|note-runtime" apps/desktop/src` and run the full
  desktop suite. Do not edit an existing test to make it pass — if one fails, the
  refactor changed behavior. STOP.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @repo/desktop test` exits 0; new listing tests exist and pass
- [ ] `pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` all exit 0
- [ ] `apps/desktop/src/renderer/workspace/use-vault-listing.ts` and
      `use-vault-file-ops.ts` exist
- [ ] `git diff 91347c66 -- apps/desktop/src/renderer/workspace/vault-context.tsx`
      shows **no change** to the `VaultContextValue` type block (lines 80–157)
- [ ] `git status --short` lists **only**: `vault-context.tsx`, the two new hook
      files, and new test files. No consumer file modified.
- [ ] `wc -l apps/desktop/src/renderer/workspace/vault-context.tsx` is
      substantially below 662 (expect roughly 400–450)
- [ ] Step 5's six harness behaviors all confirmed, and the report says so
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts above don't match the live code (drift since `91347c66`).
- **The extraction cannot preserve the exact `VaultContextValue` shape.** Do not
  "improve" the contract — a wider refactor is the operator's call. Report what
  blocked you.
- Any of the 17 `useVault()` consumers needs a change to compile. Same reason.
- The harness check in step 5 shows note A's text landing in note B (or any edit
  loss). That is the flush-ordering regression; revert to the last green commit
  and report.
- An existing test fails and the only way to make it pass is to edit the test.
- You find yourself wanting to change `note-runtime.ts`. It is out of scope.
- Making the file-ops hook testable would require restructuring the ref pattern
  (e.g. moving `openPathRef` into the hook, or replacing refs with state). The
  ref-as-synchronous-source-of-truth is a deliberate StrictMode defense
  (vault-context.tsx:172–175) — do not undo it.

## Maintenance notes

- **Left deliberately in the provider**: the open-note runtime lifecycle
  (`applyOpenPath`/`ensureRuntime`/`disposeRuntime`/`flushCurrent`/`openFile`),
  the editor-view/mode block, and the HTML-app block. The first genuinely owns the
  shared refs and the ordering races — extracting it is a separate, riskier plan.
  The other two are small and read the provider's own state.
- The `useVaultFileOps` deps object is the seam where the ordering contract now
  lives. **A reviewer should scrutinize exactly one thing**: that every op which
  moves, deletes, or replaces the open file still awaits `flushCurrent()` before
  it touches the bridge, and that `renameEntry` still disposes the old runtime
  BEFORE the rename call (vault-context.tsx:395–398 explains why: the rename's
  vault-changed broadcast otherwise races the remap and the vanish watcher closes
  the carried-over note).
- Follow-up deliberately deferred: extracting the editor-view/mode block into a
  `useEditorView` hook. It is entangled with the state-adjustment-during-render
  pattern at lines 573–596, which is subtle enough to deserve its own plan.
