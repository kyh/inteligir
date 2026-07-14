# Plan 008: Key the open-note self-save filter on the full stat fingerprint, not mtime alone

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index (or the index does not exist yet, in which case skip it).
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- packages/features/src/server/vault packages/features/src/server/__tests__/classify-file-change.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

The app runs exactly ONE filesystem watcher — a non-recursive watch on the
**currently open note** (a deliberate design: the vault listing is an ephemeral
index, no recursive watcher). To keep the editor from reloading onto its own
autosaves, the host records each app-initiated write in a `SelfSaveRegistry` and
filters the watch event it produces. That registry matches on **`mtimeMs`
alone**, with a 5-second TTL.

So: within 5 seconds of an autosave, an external edit to the open note that
happens to land the **same `mtimeMs`** is classified as our own write and
swallowed. The editor never reloads; the user keeps typing into stale bytes
while the file on disk says something else. Coarse filesystem mtime granularity
plus a rapid agent/tool write is exactly the shape that produces the collision —
and this is the one file the app actively watches, so it is the file where
staleness is most visible and most costly.

The codebase already knows the answer. The knowledge manager keys its "did this
change?" check on `mtimeMs + size + ino` and documents _why_ the inode matters.
This plan makes the self-save registry use the same key.

## Current state

### File 1 — `packages/features/src/server/vault/classify-file-change.ts` (the bug)

Header comment, `classify-file-change.ts:15-19` (verbatim):

```ts
//   - `SelfSaveRegistry` — records app-initiated writes by (path, mtimeMs) with
//     a short TTL, so the watch event a self-save necessarily produces is
//     filtered out before it ever reaches the classifier. Only the editor's own
//     write path records here; restore / sync-pull / external edits do NOT, so
//     those still surface as reloads.
```

`classify-file-change.ts:58-93` (verbatim):

```ts
/** Age after which a recorded self-save is forgotten. Generous relative to the
 * gap between a write and the watch event it triggers (sub-second in practice);
 * long enough that a slow FSEvents delivery still matches, short enough that a
 * stale entry can't mask a genuine later external edit at the same mtime. */
const SELF_SAVE_TTL_MS = 5_000;

/** Records the app's own writes so the watch event they produce can be filtered
 * out. Keyed by vault-relative path → the mtimeMs we wrote; a genuine external
 * edit lands a different mtime and so is NOT matched. Entries expire by age.
 *
 * Only the editor write path (writeVaultDoc) records here. Restore, sync-pull,
 * and external tools do not, so their writes still surface as reloads. */
export class SelfSaveRegistry {
  private readonly entries = new Map<string, { mtimeMs: number; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Record that the app just wrote `path`, landing it at `mtimeMs`. */
  record(path: string, mtimeMs: number): void {
    this.entries.set(path, { mtimeMs, expiresAt: this.now() + SELF_SAVE_TTL_MS });
    this.prune();
  }

  /** True when a watch event for `path` at `mtimeMs` corresponds to a recent
   * app-initiated write (and should therefore be ignored). Not one-shot: a
   * single write can produce several watch events (tmp-rename + change), all of
   * which carry the same mtime and must all be filtered. */
  isSelfSave(path: string, mtimeMs: number): boolean {
    const entry = this.entries.get(path);
    if (entry === undefined) return false;
    if (this.now() > entry.expiresAt) {
      this.entries.delete(path);
      return false;
    }
    return entry.mtimeMs === mtimeMs;
  }
```

Note the docstring's own claim — "a genuine external edit lands a different
mtime" — is precisely the assumption that does not hold at fs mtime granularity.
The TTL comment ("short enough that a stale entry can't mask a genuine later
external edit at the same mtime") is trying to bound a hazard that a stronger key
simply removes.

`classify-file-change.ts:95-105` — `forget(path)` and `prune()` round out the
class; both are keyed by path only and need **no change**.

### File 2 — `packages/features/src/server/vault/vault.ts` (the two call sites)

`vault.ts:278-290` — the record site (`markSelfSave` already stats the file; it
just throws away everything except the mtime):

```ts
  /** Record that the app itself just wrote `rel` (the editor's autosave path),
   * so the watch event that write triggers on the open note is filtered out
   * rather than mistaken for an external edit. Called by the editor write
   * handler only — restore / sync-pull deliberately do NOT record, so their
   * writes to the open note still surface as reloads. */
  markSelfSave(rel: string): void {
    try {
      const stat = fs.statSync(this.resolve(rel));
      this.selfSaves.record(rel, stat.mtimeMs);
    } catch {
      // Path escaped the vault or vanished — nothing to record.
    }
  }
```

`vault.ts:487-520` — the check site (`onOpenNoteEvent`). It already has the full
`stat` in hand and even builds the full three-part key on the very next line:

```ts
  private onOpenNoteEvent(rel: string, target: string): void {
    // Still the note we're meant to be watching? (watchOpenNote(null) closes the
    // watcher, but a queued event could still land.)
    if (this.watchedPath !== rel) return;
    let stat: fs.Stats | null;
    try {
      stat = fs.statSync(target);
    } catch {
      stat = null; // vanished/unreadable
    }
    if (stat === null) {
      // The open note disappeared — broadcast so the renderer's vanish watcher
      // closes it. Keep the directory watch running (and the last fingerprint)
      // so a recreate/rename-back is still caught; the renderer clears the
      // watcher via setWatchedNote(null) when it drops the note.
      this.notify("refresh");
      return;
    }
    // Our own autosave landing — never reload the editor onto what it just wrote.
    if (this.selfSaves.isSelfSave(rel, stat.mtimeMs)) return;
    const current = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
```

`this.selfSaves` is declared at `vault.ts:107`:

```ts
  private readonly selfSaves = new SelfSaveRegistry();
```

The public method `markSelfSave(rel: string)` takes only a path — its **signature
does not change**, so its one external caller
(`packages/features/src/server/handlers/vault-handlers.ts:71-79`, the
`writeVaultDoc` editor write path) needs **no edit**:

```ts
handle("writeVaultDoc", ({ path, content }) => {
  const vault = getVaultManager();
  vault.writeText(path, content);
  // This is the editor's write path (autosave). Mark it a self-save so the
  // open-note watcher filters the event it triggers rather than reloading the
  // editor onto what it just saved (ADR-0001). Restore / sync-pull do NOT go
  // through here, so their writes still surface as reloads.
  vault.markSelfSave(path);
});
```

### The pattern to mirror — `packages/features/src/server/knowledge/knowledge-manager.ts:33-36` (verbatim)

```ts
// ino rides along because vault writes are atomic (write temp + rename): a
// swap always lands on a fresh inode, so even an exact (mtime, size)
// collision can't masquerade as "unchanged".
type Fingerprint = { mtimeMs: number; size: number; ino: number };
```

and its comparison, `knowledge-manager.ts:127-135`:

```ts
const prior = this.fingerprints.get(entry.path);
if (
  prior &&
  prior.mtimeMs === fingerprint.mtimeMs &&
  prior.size === fingerprint.size &&
  prior.ino === fingerprint.ino
) {
  continue;
}
```

The vault manager also has the string form of the same key,
`vault.ts:311-323` (`statFingerprint(rel): string | null` →
`` `${stat.mtimeMs}:${stat.size}:${stat.ino}` ``), used by the sync engine's hash
cache and by the open-note watcher's `watchedFingerprint`.

### Existing tests (EXTEND, don't replace)

`packages/features/src/server/__tests__/classify-file-change.test.ts` already
unit-tests the registry — `describe("SelfSaveRegistry")` at line 44 with five
cases (same-mtime match, repeat match, TTL expiry, `forget`, re-record). They all
call `reg.record("a.md", 500)` / `reg.isSelfSave("a.md", 500)` and **will not
compile** once the signature takes a fingerprint. Updating them is part of the
job.

`packages/features/src/server/__tests__/vault.test.ts:251-272` has the
integration test ("open-note watcher broadcasts external edits but filters
self-saves") over a real temp-dir vault. It must keep passing untouched.

### Repo conventions that apply

- **Make illegal states unrepresentable**: model the key as a type, not three
  loose parameters. Mirror `knowledge-manager`'s `Fingerprint` shape.
- **No `any`, no non-null `!`, no `as` casts.**
- Kebab-case filenames; no barrel files (direct subpath imports).
- Prose comments explaining the WHY, matching the surrounding files.
- Conventional commits; branch prefix `kyh/`.

## Commands you will need

| Purpose        | Command                                                                              | Expected on success |
| -------------- | ------------------------------------------------------------------------------------ | ------------------- |
| Install        | `pnpm install`                                                                       | exit 0              |
| Format         | `pnpm format:fix` (run FIRST, never after gates)                                     | exit 0              |
| Typecheck      | `pnpm typecheck`                                                                     | exit 0, no errors   |
| Features tests | `pnpm --filter @repo/features test`                                                  | all pass            |
| One test file  | `pnpm --filter @repo/features test classify-file-change`                             | all pass            |
| Lint           | `pnpm lint`                                                                          | exit 0              |
| Full gates     | `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0              |

## Scope

**In scope** (the only files you should modify):

- `packages/features/src/server/vault/classify-file-change.ts` — the
  `SelfSaveRegistry` key (and its doc comments).
- `packages/features/src/server/vault/vault.ts` — **the two call sites only**
  (`markSelfSave` at ~278-290, and the `isSelfSave` call inside
  `onOpenNoteEvent` at ~506).
- `packages/features/src/server/__tests__/classify-file-change.test.ts` — extend
  the existing `describe("SelfSaveRegistry")` block.

**Out of scope** (do NOT touch, even though they look related):

- `classifyFileChange` itself (`classify-file-change.ts:42-56`) — the pure
  reload-vs-conflict verdict is **correct**; the bug is upstream of it, in the
  filter that decides whether the classifier even runs.
- The no-recursive-watcher design — deliberate (PR #411). Do **not** add
  watchers, do not widen the open-note watch, do not "just poll".
- `SELF_SAVE_TTL_MS` (5s) — leave the value alone. A stronger key is the fix; the
  TTL is a separate, already-reasoned tradeoff.
- `packages/features/src/server/handlers/vault-handlers.ts` — `markSelfSave(path)`
  keeps its signature, so this file needs no change. If you find yourself editing
  it, you changed the wrong signature.
- `packages/features/src/server/knowledge/knowledge-manager.ts` — the source of
  the pattern; copy it, don't refactor it into a shared module (a 4-line type is
  not worth a new cross-module dependency; the two live at different layers).
- `vault.ts`'s `statFingerprint` (string form) and `watchedFingerprint` — used by
  the sync hash cache and the classifier baseline. Leave them.

## Git workflow

- Branch: `kyh/plan-008-self-save-fingerprint`
- Conventional commits, e.g.
  `fix(vault): key the self-save filter on the full stat fingerprint`
- Do NOT push and do NOT open a PR.

## Steps

### Step 1: Write the failing test FIRST (red)

In `packages/features/src/server/__tests__/classify-file-change.test.ts`, inside
`describe("SelfSaveRegistry")`, add the case that pins the bug. Write it against
the **target** API (a fingerprint object), so it will not compile until Step 2 —
that compile failure IS the red state:

```ts
it("does NOT treat a same-mtime, different-size write as a self-save", () => {
  const reg = new SelfSaveRegistry(() => 1000);
  reg.record("a.md", { mtimeMs: 500, size: 10, ino: 7 });
  // A rapid external (agent/tool) write can land the SAME coarse mtime. It is
  // a different file now — mtime alone would have swallowed it and left the
  // editor showing stale bytes.
  expect(reg.isSelfSave("a.md", { mtimeMs: 500, size: 11, ino: 7 })).toBe(false);
});
```

**Verify**: `pnpm --filter @repo/features test classify-file-change` → **fails**
(type error on the new call shape, or a failed assertion). Confirm you have seen
it fail before continuing. If it somehow passes, the bug is not where this plan
says it is → STOP and report.

### Step 2: Change the registry's key to the full fingerprint

In `packages/features/src/server/vault/classify-file-change.ts`:

1. Export a fingerprint type mirroring `knowledge-manager`'s, with the WHY
   comment carried over (do not paraphrase it away):

```ts
/** The stat identity of a written file. `ino` rides along because vault writes
 * are atomic (write temp + rename): a swap always lands on a fresh inode, so
 * even an exact (mtime, size) collision can't masquerade as "the write we just
 * made". `size` catches the common case — a coarse-granularity mtime shared
 * with a rapid external write of different length. */
export type WriteFingerprint = { mtimeMs: number; size: number; ino: number };
```

2. Change the map's value to `{ fp: WriteFingerprint; expiresAt: number }`.
3. `record(path: string, fp: WriteFingerprint): void` — store it whole.
4. `isSelfSave(path: string, fp: WriteFingerprint): boolean` — keep the
   undefined-entry and TTL-expiry checks exactly as they are, then require a
   **full** match on all three fields (compare field-by-field; do not stringify
   and do not compare object identity).
5. `forget` and `prune` are unchanged.
6. Update the class docstring and the module header (lines 15-19): the registry
   is keyed by `(path, mtimeMs+size+ino)`, and say why — an external edit that
   collides on mtime alone is no longer mistaken for our own save. Also soften
   the `SELF_SAVE_TTL_MS` comment's clause "short enough that a stale entry can't
   mask a genuine later external edit at the same mtime": with the full
   fingerprint, mtime collision alone no longer masks anything.

**Verify**: `pnpm typecheck` → fails **only** in `vault.ts` (the two call sites,
Step 3) — the test file from Step 1 now type-checks.

### Step 3: Pass the full fingerprint at both call sites in `vault.ts`

1. `markSelfSave(rel)` (~line 283) — it already calls `fs.statSync`. Pass all
   three fields through instead of just `mtimeMs`:

```ts
const stat = fs.statSync(this.resolve(rel));
this.selfSaves.record(rel, { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino });
```

**Keep the public signature `markSelfSave(rel: string)`** — the stat happens
inside, so `vault-handlers.ts` stays untouched. **Important**: this stat must
be the **post-write** stat. It already is — `writeVaultDoc` calls
`vault.writeText(path, content)` and _then_ `vault.markSelfSave(path)`
(`vault-handlers.ts:71-79`). Do not reorder those, and do not move the stat
earlier.

2. `onOpenNoteEvent` (~line 506) — it already holds the full `fs.Stats`:

```ts
// Our own autosave landing — never reload the editor onto what it just wrote.
if (this.selfSaves.isSelfSave(rel, { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino }))
  return;
```

Leave the line below it (`const current = \`${stat.mtimeMs}:${stat.size}:${stat.ino}\`;`)
exactly as is — that string is the classifier's baseline, a different thing.

**Verify**: `pnpm typecheck` → exit 0.
`grep -n "isSelfSave\|\.record(" packages/features/src/server/vault/vault.ts` →
both hits pass an object with `mtimeMs`, `size` and `ino`.

### Step 4: Finish the test suite (green)

Complete the rest of the Test plan below (update the five existing cases to the
new call shape; add the ino case).

**Verify**: `pnpm --filter @repo/features test` → all pass, including the
untouched integration test at `vault.test.ts:251-272`.

### Step 5: Gates

```bash
pnpm format:fix   # FIRST — never after gates
pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build
```

**Verify**: every command exits 0.

## Test plan

All in the **existing** file
`packages/features/src/server/__tests__/classify-file-change.test.ts`, inside the
existing `describe("SelfSaveRegistry")` block (line 44). Do not create a new test
file. The `describe("classifyFileChange")` block above it (lines 5-42) must stay
byte-identical — the pure classifier is out of scope.

Migrate the five existing cases to the fingerprint call shape (they keep testing
what they tested — same-key match, repeat match, TTL expiry, `forget`,
re-record), then ensure these cases exist:

1. **The bug (must be red before Step 2)** — same `mtimeMs`, **different `size`**
   → `isSelfSave` is `false`.
2. **Same `mtimeMs` and `size`, different `ino`** → `false`. (An atomic
   temp+rename by an external tool that happens to produce the same length and
   mtime; the inode always moves.)
3. **Exact full match, within TTL** → `true`. (Unchanged behavior — the app's own
   autosave is still filtered. This is the case that must NOT regress, or every
   autosave round-trips a pointless reload.)
4. **Exact full match, past the TTL** → `false`. (Expiry still works — keep the
   existing `clock = 1000 + 5_000 + 1` pattern from line 66.)
5. **Repeat matches** — a single write fires several watch events; the same
   fingerprint matches every time (not one-shot).
6. **`forget(path)`** drops the record.
7. **Unrecorded path** → `false`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `pnpm --filter @repo/features test` exits 0, including the new same-mtime/
      different-size and different-ino cases
- [ ] `grep -n "mtimeMs: number; expiresAt" packages/features/src/server/vault/classify-file-change.ts`
      returns **no matches** (the mtime-only entry shape is gone)
- [ ] `grep -n "isSelfSave" packages/features/src/server/vault/vault.ts` shows the
      call passing `size` and `ino`, not just `mtimeMs`
- [ ] `git status --porcelain packages/features/src/server/handlers/` is empty
      (the handler signature did not change)
- [ ] The `describe("classifyFileChange")` block in the test file is unchanged
      (`git diff packages/features/src/server/__tests__/classify-file-change.test.ts`
      shows edits only below line 43)
- [ ] `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` all exit 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated (if that index exists)

## STOP conditions

Stop and report back (do not improvise) if:

- **The Step-1 test passes before the fix.** That means the registry is not the
  filter in the path you think it is — re-verify against the live code and report
  rather than "fixing" something that isn't broken.
- **Case 3 (exact full match → `true`) regresses.** If autosaves stop being
  filtered, every save round-trips a spurious reload and the editor will fight
  the user's cursor. This is the one behavior the change must preserve; a failure
  here means the comparison or the record-time stat is wrong. Do not "fix" it by
  loosening the key back toward mtime-only.
- `packages/features/src/server/__tests__/vault.test.ts`'s open-note watcher test
  (line ~251) fails. It drives a real temp-dir vault end-to-end; a failure means
  the record-site stat is being taken at the wrong moment (before the write, or
  of the temp file rather than the renamed target). Report the failure and what
  you observe — do not add a sleep to make it pass.
- `ino` turns out to be unavailable or always `0` on the test platform. (It is a
  standard `fs.Stats` field on macOS and Linux, and `knowledge-manager` already
  depends on it — but if you see zeros, report rather than silently dropping the
  field.)
- You find yourself needing to change `vault-handlers.ts`, `classifyFileChange`,
  or the watcher's structure — all out of scope.
- The excerpts in "Current state" don't match the live code (drift).

## Maintenance notes

For the human/agent who owns this after the change lands:

- **The key now matches `knowledge-manager`'s `Fingerprint` by design.** Two
  copies of the same 3-field shape live in the tree on purpose — one in the
  knowledge layer, one in the vault layer — because merging them would create a
  cross-layer dependency for four lines. If a **third** copy ever appears, that's
  the signal to promote it to a shared type (the natural home would be beside
  `vault.ts`'s `statFingerprint`).
- What the change does NOT fix: an external write that reproduces the app's
  **exact** mtime, size AND inode. That is not reachable through an atomic
  temp+rename (the inode always moves) and would require an in-place write of
  identical length within the mtime tick — at which point "same bytes" is nearly
  the only explanation, and swallowing the event is correct anyway.
- The 5s `SELF_SAVE_TTL_MS` is untouched. With the stronger key, the TTL is now
  purely a memory bound (drop stale entries), not a correctness lever — its
  comment should read that way after this lands. If someone later wants the TTL
  shortened or removed, that's a safe, separate change.
- What a reviewer should scrutinize: (a) that `markSelfSave`'s stat is taken
  AFTER the write, on the final (renamed) target — the ordering in
  `vault-handlers.ts:71-79` is load-bearing; (b) that the "exact match → still a
  self-save" test exists and passes (the anti-regression), not just the new
  negative cases; (c) that nobody widened `markSelfSave`'s public signature and
  pushed the stat out to the handler.
