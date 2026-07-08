# Plan 004: Take whole-document serialization off the per-keystroke path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- apps/desktop/src/renderer/editor/markdown-editor.tsx apps/desktop/src/renderer/workspace/vault-context.tsx apps/desktop/src/renderer/workspace/open-note-flush.ts`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED-HIGH (live editing/save path)
- **Depends on**: plans/005-renderer-test-infra-note-runtime.md (test infra + NoteRuntime seam must exist first)
- **Category**: perf
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

Plate's `onChange` serializes the ENTIRE Slate document to markdown on every
content-changing keystroke, synchronously, on the main thread. The 600ms
autosave debounce only gates the disk write, not the serialize. In large notes
this is O(document) work per input event — typing lag. Deferring the serialize
behind a short debounce (with a synchronous flush hook for save/close paths)
bounds per-keystroke work without changing what reaches disk.

## Current state

- `apps/desktop/src/renderer/editor/markdown-editor.tsx` `onChange` (~:129-153):

  ```tsx
  onChange={() => {
    if (settling.current) return;
    if (editor.operations.every((op) => op.type === "set_selection")) return;
    const reviewing = hasTransientSuggestions(editor);
    useAiReviewStore.getState().setReviewing(path, reviewing);
    if (reviewing || hasTransientAiState(editor)) return;
    const md = serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
    if (md === seeded.current) return;   // drop programmatic re-seed echo
    seeded.current = null;
    lastValueProp.current = md;
    onChange(md);
  }}
  ```

- Downstream: `vault-context.tsx` `editNote` receives `md`, calls
  `runtime.controller.edit(next)` and schedules `controller.flush()` after
  `AUTOSAVE_DEBOUNCE_MS = 600`. The provider also calls `flushCurrent()`
  (via `open-note-flush.ts` and directly) before rename/delete/close — those
  flushes assume the controller already holds the latest bytes. **That
  assumption is what a deferred serialize breaks** — the flush hook below
  exists to restore it.

- Guards that MUST be preserved exactly: `settling.current`, the
  selection-only skip, the transient-AI/suggestion freeze, the
  `seeded`/`lastValueProp` echo suppression.

## Commands you will need

| Purpose        | Command                                   | Expected      |
| -------------- | ----------------------------------------- | ------------- |
| Renderer tests | `pnpm --filter @repo/desktop test`        | pass          |
| Typecheck/lint | `pnpm typecheck && pnpm lint`             | exit 0        |
| Manual drive   | `pnpm --filter @repo/desktop dev:harness` | vite on :5173 |

## Suggested executor toolkit

- The `agent-browser` skill (if available) to drive the dev harness for the
  manual verification in Step 4.

## Scope

**In scope**:

- `apps/desktop/src/renderer/editor/markdown-editor.tsx`
- `apps/desktop/src/renderer/workspace/vault-context.tsx` (wiring the flush hook)
- New test file(s) under `apps/desktop/src/renderer/` (`.test.tsx`, jsdom project from plan 005)
- `plans/README.md`

**Out of scope**:

- `serializeMd` / the markdown pipeline itself — no serializer changes.
- `AUTOSAVE_DEBOUNCE_MS` and controller/flush semantics in `editor/` — untouched.
- Round-trip fixtures (`src/renderer/__tests__/fixtures/`) — NEVER touch.

## Git workflow

- Branch: `kyh/plan-004-serialize-debounce`
- Commit: `perf(editor): debounce whole-doc serialize off the keystroke path`

## Steps

### Step 1: Introduce a serialize scheduler inside markdown-editor.tsx

Replace the tail of `onChange` (from `const md = serializeMd(...)` down) with a
scheduled serialize:

- Keep ALL existing guards ABOVE that line running synchronously per event
  (they're cheap and order-sensitive).
- Add `const serializeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)`
  and `const serializeNow = useRef<() => void>(...)`. `serializeNow` performs
  exactly today's tail: serialize → seeded-echo check → `lastValueProp` →
  `onChange(md)`; clear the timer first.
- In `onChange`, instead of serializing: reset the timer to fire
  `serializeNow.current()` after `SERIALIZE_DEBOUNCE_MS = 150`.
- Flush pending serialize synchronously (call `serializeNow.current()` if a
  timer is pending) at these points:
  1. component unmount (cleanup effect),
  2. before an external re-seed applies (the code path that sets
     `seeded.current` when the `value` prop changes — locate it in this file;
     flush BEFORE the new seed overwrites the ref),
  3. when the transient-AI/suggestion freeze LIFTS (today "the next onChange
     serializes the settled document" — a settle with no following keystroke
     must still propagate; schedule, don't drop).

### Step 2: Expose a flush hook to the provider

Add an optional prop `onRegisterSerializeFlush?: (flush: () => void) => void`
to the markdown editor component; call it once with a stable function that
runs the pending serialize (no-op when none pending). In `vault-context.tsx`,
store the registered flush on the open note's runtime and invoke it at the top
of `flushCurrent()` (before `controller.flush()`), and before
`controller.remove()` in `deleteEntry`. Keep the prop optional so the raw
editor and harness paths compile unchanged.

**Verify**: `pnpm typecheck` → exit 0

### Step 3: Tests (jsdom project from plan 005)

New `.test.tsx` exercising the editor component with a small doc:

1. Burst of N synthetic edits → `onChange` (the prop) called once after the
   debounce, with the final markdown.
2. Unmount with a pending serialize → `onChange` called before teardown.
3. Registered flush invoked → pending serialize delivered synchronously.
4. Selection-only operations → no serialize scheduled (spy on the prop).
   If mounting the full Plate editor under jsdom proves impractical, extract the
   scheduler into `editor/serialize-scheduler.ts` (pure: schedule/flush/cancel
   around an injected `doSerialize`) and unit-test THAT, keeping the component
   wiring thin — this is the fallback, not the default.

**Verify**: `pnpm --filter @repo/desktop test` → pass, including new tests

### Step 4: Manual drive (required — perf changes lie in unit tests)

`pnpm --filter @repo/desktop dev:harness`, open the sample vault's largest
note: type a sentence, confirm characters echo without visible lag; edit then
IMMEDIATELY rename the note via the sidebar — the rename must carry the edit
(flush hook working); edit then close/reopen — bytes persisted.

**Verify**: all three behaviors observed; note them in the PR description.

### Step 5: Gates

`pnpm format:fix` then full gate:
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`.

## Done criteria

- [ ] `serializeMd` is no longer called synchronously per keystroke (code inspection: it is only reachable via the scheduler)
- [ ] All existing round-trip/kit-parity tests pass untouched
- [ ] New scheduler tests pass; manual harness drive performed and reported
- [ ] Full gate exits 0; `plans/README.md` updated

## STOP conditions

- The `onChange` body doesn't match the excerpt (drift).
- You cannot find the external re-seed path that sets `seeded.current` from
  the `value` prop — report instead of guessing.
- The rename-carries-edit harness check fails after two fix attempts —
  this is the highest-risk regression; report with the failing sequence.
- The fix seems to require changing `VaultEditorController` or
  `open-note-flush.ts` semantics.

## Maintenance notes

- 150ms is a UX guess; it only delays when bytes reach the CONTROLLER — disk
  writes still ride the 600ms autosave. Tune with real large-note profiling.
- Anyone adding a new "read the controller's content right now" path
  (export, print, share) must call the registered serialize-flush first.
- Reviewer: scrutinize the freeze-lift path (Step 1.3) — dropping the settle
  serialize would silently lose the last accepted AI suggestion.
