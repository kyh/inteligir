# Plan 011: Knowledge/search perf tail — suffix-indexed link resolution, bounded prefix search, sidebar re-render skip

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5e6523c6..HEAD -- packages/core/src/knowledge/link-resolve.ts packages/core/src/knowledge/search-index.ts apps/desktop/src/renderer/workspace/vault-context.tsx`
> On any mismatch with the excerpts below, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW-MED (behavior must be IDENTICAL — these are pure-speedup changes)
- **Depends on**: plans/005-renderer-test-infra-note-runtime.md only for item C's placement (vault-context churn); A and B are independent
- **Category**: perf
- **Planned at**: commit `5e6523c6`, 2026-07-07

## Why this matters

Three sub-linear-scaling hazards that are cheap to fix while behavior is
pinned by tests: (A) path-style `[[dir/note]]` wiki links resolve by scanning
the ENTIRE file list per link (O(links × files) on every index rebuild — the
resolution map is invalidated on every doc change); (B) the command palette's
prefix match iterates every unique token in the vault per keystroke; (C) every
vault change — including each autosave — re-fetches the whole listing and
re-sets it into React state even when nothing structural changed.

## Current state

- **(A)** `packages/core/src/knowledge/link-resolve.ts` Tier 3 (~:99-104):

  ```ts
  // Tier 3 — path suffix.
  const suffixes = [`/${clean}`, `/${clean}.md`];
  const cs = pickBest(all.filter((p) => suffixes.some((s) => p.endsWith(s))));
  if (cs !== null) return cs;
  const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
  return pickBest(all.filter((p) => lowerSuffixes.some((s) => p.toLowerCase().endsWith(s))));
  ```

  The same builder already maintains `byName` / `byNameLower` maps
  (basename/stem buckets) used by Tier 2 — read the whole `buildResolver` to
  see how they're populated.

- **(B)** `packages/core/src/knowledge/search-index.ts` `search()` (~:107-116),
  last-token prefix expansion:

  ```ts
  if (isLast) {
    for (const [candidate, docs] of this.postings) {
      if (candidate === token || !candidate.startsWith(token)) continue;
      for (const [path, counts] of docs) {
        const scored = PREFIX_FACTOR * weightOf(counts);
        ...
  ```

- **(C)** `apps/desktop/src/renderer/workspace/vault-context.tsx` — the
  `onVaultChanged` effect calls `refreshList()` on every broadcast, and
  `refreshList` fetches `bridge.listVault()` and `setEntries(...)`
  unconditionally. An autosave write trips the fs watcher, so every save
  round-trips a full listing and a sidebar reconciliation.

- Behavior pins: resolver tests and search tests exist under
  `packages/core/src/knowledge/__tests__/` (find them; they pin tier ordering,
  `pickBest` determinism, and prefix scoring). They must pass UNCHANGED — if a
  fix needs a test edited, the fix is wrong.

## Commands you will need

| Purpose        | Command                            | Expected       |
| -------------- | ---------------------------------- | -------------- |
| Core tests     | `pnpm --filter @repo/core test`    | pass unchanged |
| Desktop tests  | `pnpm --filter @repo/desktop test` | pass           |
| Typecheck/lint | `pnpm typecheck && pnpm lint`      | exit 0         |

## Scope

**In scope**:

- `packages/core/src/knowledge/link-resolve.ts`
- `packages/core/src/knowledge/search-index.ts`
- `apps/desktop/src/renderer/workspace/vault-context.tsx` (refreshList equality skip only)
- New perf-shape tests in `packages/core/src/knowledge/__tests__/`
- `plans/README.md`

**Out of scope**:

- `knowledge-index.ts` invalidation strategy (`resolved = null` per change) —
  coarser but correct; do not redesign.
- Watcher-scoped knowledge refresh (stat only touched files) — REJECTED for
  now: `fs.watch` coarseness makes the full-scan fallback the safety net;
  revisit only with a real profiling case.
- Sidebar component memoization — only the context-level skip.

## Git workflow

- Branch: `kyh/plan-011-knowledge-perf`
- One commit per item: `perf(knowledge): ...`, `perf(search): ...`, `perf(renderer): ...`

## Steps

### Step A: Tier-3 via the basename bucket

In `buildResolver`, replace the full-list `all.filter(...)` scans: derive the
FINAL path segment of `clean` (e.g. `"notes/foo"` → `"foo"`, and the `.md`
variant `"foo.md"` → stem handling must mirror how `byName`/`byNameLower` are
keyed — read their population code first). Fetch the candidate bucket from
`byName` (then `byNameLower` for the case-insensitive pass) and apply the SAME
`endsWith` suffix checks to just that bucket, then the same `pickBest`.
Outcome must be identical for every input — the bucket provably contains
every path that can end with `/${clean}` (its basename is `clean`'s basename).
Keep the two-pass (case-sensitive, then insensitive) order.

**Verify**: `pnpm --filter @repo/core test` → resolver tests pass UNCHANGED

### Step B: Sorted-token range scan for prefix search

In `search-index.ts`, maintain alongside `postings` a sorted array of token
keys, rebuilt lazily: a `dirty` flag set by every mutation
(`setDoc`/`remove`/whatever mutates postings — find them), and rebuilt
(`[...postings.keys()].sort()`) on first search after a mutation. In the
`isLast` branch, binary-search the array for the first key `>= token` and walk
forward while `key.startsWith(token)`, skipping the exact token as today.
Scoring code unchanged. (Memory: one string array of the vocabulary — fine.)

**Verify**: `pnpm --filter @repo/core test` → search tests pass UNCHANGED

### Step C: Listing equality skip

In `vault-context.tsx` `refreshList`, before `setEntries(next)`: compare
`next` to the current entries (same length AND every index has equal
`path`/`name`/`kind`) and skip the set when equal. Keep a ref of the last
listing for the comparison (don't read React state in the async callback).

**Verify**: `pnpm --filter @repo/desktop test` → pass; in `dev:harness`,
typing in a note no longer flashes/re-renders the sidebar tree (observe via
React DevTools or a temporary render counter — remove it before commit).

### Step D: Perf-shape tests (core)

Two cheap invariants (not timing tests): (a) resolver — build over 5,000
synthetic paths, resolve 1,000 `dir/note`-style links, assert results equal a
brute-force reference implementation (copy today's filter code into the test
as the oracle); (b) search — same oracle pattern for prefix expansion over a
synthetic corpus. These make behavioral equivalence executable instead of
asserted.

**Verify**: `pnpm --filter @repo/core test` → all pass

### Step E: Gates

`pnpm format:fix` then the full canonical gate.

## Done criteria

- [ ] No full-`all` scan remains in Tier 3; no full-postings iteration in the prefix branch
- [ ] ALL pre-existing knowledge/search tests pass without edits
- [ ] Oracle-equivalence tests pass; sidebar skip verified in harness
- [ ] Full gate exits 0; `plans/README.md` updated

## STOP conditions

- Excerpts drifted.
- `byName`'s keying doesn't cover the Tier-3 candidate set (i.e. you find an
  input where the bucket misses a path the full scan would catch) — report
  with the counterexample; do NOT ship a lossy bucket fix.
- Any pinned test would need editing.

## Maintenance notes

- The rejected watcher-scoped refresh idea is recorded in plans/README.md —
  don't re-audit it without profiling data.
- Reviewer: Step A's stem/extension handling is where equivalence bugs will
  hide (`[[dir/note]]` vs `[[dir/note.md]]`); insist on the oracle test
  covering both spellings and case variants.
