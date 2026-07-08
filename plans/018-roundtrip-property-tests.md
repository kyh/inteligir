# Plan 018: Seeded property-based round-trip tests for the markdown pipeline

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cd4bde1b..HEAD -- apps/desktop/src/renderer/editor/markdown packages/core/src/markdown`

## Status

- **Priority**: P3
- **Effort**: S-M
- **Risk**: LOW (tests only — but may DISCOVER real bugs; that is the point)
- **Depends on**: none
- **Category**: tests (adopted from hubble's MarkdownRoundtrip.test.ts pattern)
- **Planned at**: commit `cd4bde1b`, 2026-07-08

## Why this matters

Our round-trip safety is byte-pinned fixtures — strong for KNOWN shapes,
blind to unknown ones. hubble complements hand-written cases with a
property-based test: a seeded RNG generates random documents from the node
vocabulary, asserts parse→serialize idempotence, and prints the seed on
failure so any counterexample is replayable. Adding this to our pipeline
turns "we round-trip everything we thought of" into "a fuzzer agrees".

## Current state

- The round-trip brain: `apps/desktop/src/renderer/editor/markdown/`
  (Slate↔mdast rules, bounded-fixpoint `roundTrip`/`toCanonical` — read the
  existing fixture tests under `apps/desktop/src/renderer/__tests__/` for
  the exact entry points and the canonical/richSafe vocabulary).
- Vocabulary: GFM + `[[wiki-links]]` (+aliases, transclusion), `$$` math,
  mermaid fences, alerts, `<toggle>`, `<column_group>/<column>`, `<video>`,
  `<media_embed>`, `<file>`, `<date>`, images (plan 012).
- Invariant to test: for a GENERATED canonical document `d`:
  `serialize(parse(d)) === d` (idempotence at the canonical fixpoint), and
  `toCanonical` converges within the bounded fixpoint for arbitrary
  vocabulary-composed input.

## Commands you will need

| Purpose       | Command                                                                                                     | Expected |
| ------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| Desktop tests | `pnpm --filter @repo/desktop test`                                                                          | pass     |
| Full gate     | `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Scope

**In scope**:

- NEW `apps/desktop/src/renderer/__tests__/markdown-roundtrip-property.test.ts`
- NEW generator module beside it (`markdown-doc-generator.ts`, test-only)
- Bug FIXES the fuzzer finds: report them in NOTES; fix ONLY if the fix is
  a one-liner in an obvious direction — otherwise pin the failing seed as a
  `test.skip` with a comment and report (each is a finding, not your scope)

**Out of scope**:

- New round-trip RULES or vocabulary changes.
- Touching existing byte-pinned fixtures.

## Git workflow

- Branch: `kyh/plan-018-roundtrip-property-tests`
- Commit: `test(editor): seeded property-based markdown round-trip fuzzing`

## Steps

1. **Deterministic generator**: mulberry32 (or equivalent tiny seeded PRNG —
   hand-roll ~10 lines, no dependency) + a document generator composing the
   vocabulary: headings, paragraphs with nested marks (bold/italic/code,
   including adjacent + nested combinations — the classic serializer
   killers), lists (nested, task), tables, blockquotes/alerts, code fences
   (mermaid + plain), math, wiki-links (plain/alias/transclusion), images,
   toggles, columns. Sized ~5–40 blocks. Every generated doc must be WITHIN
   vocabulary (the fuzzer tests round-trip, not the Raw-mode gate).
2. **The test**: for N=200 seeds (fixed base seed + index): generate →
   `toCanonical` → assert fixpoint reached; take the canonical bytes →
   parse → serialize → assert byte-equality. ON FAILURE: the assertion
   message MUST include the seed and the failing document bytes (truncated
   to ~2KB) so it's replayable with `SEED=<n>`. Support an env override
   (`ROUNDTRIP_SEED`) to re-run one seed.
3. **Budget**: the 200-seed run must stay under ~10s in the suite; tune N
   down before tuning doc size down.
4. **Gates**: full canonical gate. If the fuzzer finds failures you did not
   fix (pinned as skips), the gate must still be green and every pinned seed
   listed in NOTES.

## Done criteria

- [ ] 200-seed property test in the desktop suite, deterministic, replayable via env seed
- [ ] Failure output includes seed + doc excerpt
- [ ] Any discovered counterexamples either one-line-fixed or seed-pinned and reported
- [ ] Suite time impact <10s; full gate exits 0

## STOP conditions

- The generator can't produce vocabulary-legal docs without importing live
  editor React code into a node test (the base-kit/headless mirror should
  suffice — that's what it exists for); report if not.
- More than ~5 distinct failing shapes surface — stop pinning and report;
  that's a finding batch needing its own plan.

## Maintenance notes

- When new node types land (they will — 012 added images), extend the
  generator in the same PR as the kit; the kit-parity test won't catch a
  generator gap.
