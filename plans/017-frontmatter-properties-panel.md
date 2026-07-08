# Plan 017: File-properties panel over frontmatter (file stays the only store)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. On any STOP condition, stop and
> report. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat cd4bde1b..HEAD -- apps/desktop/src/renderer/editor packages/core/src/markdown`
> Plans 015/016 may have landed first — merge main; their changes are
> expected, not drift.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches note bytes — round-trip discipline applies)
- **Depends on**: 015 (if it added a frontmatter split helper in core, reuse it)
- **Category**: direction (feature — adopted from hubble ADR-0003)
- **Planned at**: commit `cd4bde1b`, 2026-07-08

## Why this matters

Frontmatter exists in the editor (frontmatter-kit round-trips it) but is
shown as raw YAML — no typed editing. The adopted model (hubble ADR-0003):
the markdown file is the ONLY property store — no metadata DB — with a panel
of typed controls parsed from frontmatter and recombined on save.
Conservative typing rules prevent YAML foot-guns.

## Current state

- `apps/desktop/src/renderer/editor/kits/frontmatter-kit.tsx` — the existing
  kit (read it end-to-end first: how frontmatter is represented as a node,
  how it serializes back byte-exactly).
- `@repo/core/markdown` — frontmatter parsing in the remark pipeline
  (`remark-frontmatter` presumably; locate). If plan 015 added a
  split/recombine helper, build on it.
- Round-trip law: byte-pinned fixtures under
  `apps/desktop/src/renderer/__tests__/fixtures/` — a note whose properties
  are NOT edited must round-trip byte-exactly, including odd-but-valid YAML.
- UI: panel components come from `@repo/ui` (Base UI) — inputs, checkbox,
  date is a plain `YYYY-MM-DD` text input v1 (no date-picker dep).

## Typing rules (adopt verbatim — they are the feature)

- YAML 1.2 core schema; duplicate keys invalid.
- `true`/`false` → checkbox; `yes/no/on/off` STAY TEXT (no coercion).
- Dates recognized ONLY from explicit `YYYY-MM-DD` strings.
- Numbers → number input; plain strings → text; string arrays → tags.
- Anything else (nested maps, mixed arrays, anchors) → "unsupported": shown
  as read-only raw YAML for that key, PRESERVED byte-exactly on save.
- Whole-frontmatter parse failure → panel shows "properties unavailable"
  and the raw block stays untouched; the panel never destroys what it can't
  read.
- Type overrides (user forces text→date etc.): session-memory only, never
  written to the file.

## Commands you will need

| Purpose       | Command                                                                                                     | Expected |
| ------------- | ----------------------------------------------------------------------------------------------------------- | -------- |
| Desktop tests | `pnpm --filter @repo/desktop test`                                                                          | pass     |
| Harness       | `pnpm --filter @repo/desktop dev:harness`                                                                   | :5173    |
| Full gate     | `pnpm format:fix` then `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` | exit 0   |

## Scope

**In scope**:

- NEW `apps/desktop/src/renderer/editor/properties/` (panel + per-type field components + a pure `property-typing.ts` with the rules above)
- `frontmatter-kit.tsx` / editor wiring so the panel renders above the doc (collapsed by default when empty; "Add property" affordance)
- Core markdown frontmatter helpers ONLY if 015 didn't already add them
- Tests: `property-typing.test.ts` (every rule above), round-trip fixtures
  (pipeline-generated) for edited-property notes, jsdom panel tests for the
  edit→serialize flow

**Out of scope**:

- Any property index/search/query over properties (future knowledge-engine work)
- Templates for properties; property suggestions across the vault
- Date pickers, rich tag autocomplete — plain inputs v1

## Git workflow

- Branch: `kyh/plan-017-properties-panel`
- Commit: `feat(editor): typed file-properties panel over frontmatter`

## Steps

1. **`property-typing.ts`** (pure): `parseProperties(yamlText)` →
   `{kind:"valid", props: TypedProp[]} | {kind:"invalid"} | {kind:"none"}`
   with `TypedProp = {key, type: text|number|checkbox|date|tags|unsupported,
value, rawYaml}` per the rules; `serializeProperties(props, priorRaw)` —
   recombines, preserving unsupported keys' raw bytes and key ORDER.
   Exhaustive unit tests (each rule + order preservation + unsupported
   passthrough). **Verify**: tests pass.
2. **Panel UI**: render above the editor for the open note when frontmatter
   exists (or via "Add property"); per-type controls; edits flow through the
   SAME editNote path as body edits (the panel edits the document's
   frontmatter node — never a second write path). **Verify**: jsdom tests +
   harness drive (edit a checkbox → serialized bytes show `key: true`; raw
   YAML for an unsupported key untouched).
3. **Round-trip fixtures**: a properties-rich note (all types + one
   unsupported nested map + one invalid-frontmatter note) generated through
   the pipeline; assert byte-exactness un-edited, and correct minimal diff
   when one property is edited. **Verify**: fixture tests pass; NO existing
   fixture bytes change.
4. **Gates**: full canonical gate.

## Done criteria

- [ ] Typed panel edits properties; file remains the only store; unsupported/invalid YAML preserved byte-exactly
- [ ] All typing rules unit-tested; fixtures pipeline-generated; zero existing fixture changes
- [ ] Harness-verified edit flow; full gate exits 0

## STOP conditions

- The frontmatter node's Plate representation can't express "edit properties
  without normalizing the body" — report before touching round-trip rules.
- Preserving unsupported-key BYTE ranges requires YAML source-surgery beyond
  the `yaml` lib's document API — report with options (the `yaml` package's
  Document API preserves formatting; prefer it).

## Maintenance notes

- Properties become agent-visible automatically (they're file bytes) and are
  already exposed via 015's broker `read → properties`; keep the two
  parse paths ONE path (core helper) or they will drift.
