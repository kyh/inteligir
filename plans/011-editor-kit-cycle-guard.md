# Plan 011: Machine-enforce the editor kit import acyclicity that is currently comment-enforced

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` (only if that file exists — do not create it).
>
> **Drift check (run first)**: `git diff --stat 91347c66..HEAD -- apps/desktop/src/renderer/editor apps/desktop/src/__tests__`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt / dx
- **Planned at**: commit `91347c66`, 2026-07-12

## Why this matters

Six files in the editor are hand-structured — `React.lazy` boundaries,
dependency-free key modules — for one reason: to avoid closing an import cycle
around the Plate "kits". Every one of them says so **in a comment**, and a comment
is the only thing enforcing it. Break the rule and the failure mode is a module-init
cycle: a kit export evaluates as `undefined` at import time, and the editor breaks
intermittently in a way that is brutal to debug (the stack points at Plate, not at
the import that caused it). There is no `madge`, no `dependency-cruiser`, and
neither oxlint nor knip detects cycles — so nothing in CI would catch the
regression. A future contributor (or an agent) reading only the kit files would
never learn the rule exists.

This plan adds a **guard**: a check that fails the build when a cycle appears. It
changes no editor code.

## Current state

### The six files, with their verbatim comments

1. `apps/desktop/src/renderer/editor/wiki-input-key.ts:1-6` — the whole file:

```ts
// The `[[` autocomplete's trigger-element key, alone in a dependency-free
// module: markdown-kit (composed into BASE_KIT) needs it for disallowedNodes,
// while the kit itself (wiki-autocomplete.tsx) reaches into vault-context —
// importing the key from there would close an import cycle around the kits.

export const WIKI_INPUT_KEY = "wiki_input";
```

2. `apps/desktop/src/renderer/editor/wiki-chip.tsx:4-8`:

```ts
// Loaded via React.lazy from wiki-link-kit: this module reaches into
// vault-context (and through it the markdown pipeline and base-kit), so an
// eager import from the kit file — which base-kit composes — would close an
// import cycle around the kit files. Same seam as block-list → todo-delegation.
```

3. `apps/desktop/src/renderer/editor/block-list.tsx:6-9`:

```ts
// The delegation control lives in todo-delegation.tsx behind React.lazy: it
// reaches into vault-context (and through it the markdown pipeline and
// base-kit), so an eager import here would close an import cycle around the
// kit files. This module must stay workspace-free — list-kit imports it.
```

4. `apps/desktop/src/renderer/editor/transclusion.tsx:9-11`:

```ts
// Loaded via React.lazy from wiki-link-kit — this module reaches into
// vault-context, so an eager import from the kit file (which base-kit
// composes) would close an import cycle around the kit files.
```

5. `apps/desktop/src/renderer/editor/kits/wiki-link-kit.tsx:4-7`:

```ts
// The React half renders navigating chips (wiki-chip.tsx) and transclusion
// cards (transclusion.tsx) — both behind React.lazy, because they reach into
// vault-context and an eager import from this file (which base-kit composes)
// would close an import cycle around the kit files.
```

6. `apps/desktop/src/renderer/editor/todo-delegation.tsx:4-10`:

```ts
// Split from block-list.tsx and loaded via React.lazy: this module
// imports vault-context (which imports the markdown pipeline, which imports
// base-kit, which imports the kit files) — importing it eagerly from
// block-list would put the whole workspace inside the kit module graph and
// deadlock module init when an entrypoint reaches base-kit through a kit
// file. Deferring to render time breaks the cycle structurally.
```

**The rule, distilled**: `base-kit.ts` composes the kit files; the kit files must
not (eagerly) reach back into `vault-context` / the workspace, because
vault-context → markdown pipeline → base-kit → kits closes the loop. The
`React.lazy(() => import(...))` calls are **deferred** imports — they do not
close the cycle at module-init time.

### What does NOT exist (verified)

- No `madge` or `dependency-cruiser` anywhere: `grep -rn "madge\|dependency-cruiser"`
  over the root and every workspace `package.json` returns nothing; there is no
  `.dependency-cruiser*` and no `.madgerc`.
- oxlint (`.oxlintrc.json`) enforces **import boundaries** (renderer must not
  import electron/node; `@repo/core` must not import react/node/workspace) but has
  no cycle rule enabled.
- knip finds unused exports/files, not cycles.

So today: nothing catches it.

### Where the guard goes

`apps/desktop/vitest.config.ts` defines two projects:

- `node` — `include: ["src/**/*.test.ts"]`, `environment: "node"`
- `renderer` — `include: ["src/renderer/**/*.test.tsx"]`, `environment: "jsdom"`

A `.test.ts` file under `apps/desktop/src/__tests__/` therefore runs in the **node**
project, where `node:fs` is available for reading source files. That directory
already holds `agent-event-parser.test.ts`, `updater.test.ts`,
`vault-app-protocol.test.ts`, and is a knip entry (`knip.json`, `apps/desktop`
workspace: `"src/__tests__/**/*.test.ts"`), so a new file there needs no config
change.

`apps/desktop/src/renderer/__tests__/**` has `no-restricted-imports` **off**
(`.oxlintrc.json`: _"the portability boundary above applies to shipped renderer
code, not the [tests]"_), but `src/__tests__/**` is outside the renderer glob
entirely — a node-side test reading files with `node:fs` is exactly what
`vault-app-protocol.test.ts` and friends already are. Put the guard there.

### Conventions

- Filenames kebab-case (`editor-import-cycles.test.ts`).
- No `any`, no non-null `!`, no `as` casts — including in tests.
- Test framework: vitest (`describe`/`it`/`expect`).
- Alias: `@renderer` → `apps/desktop/src/renderer` (see `apps/desktop/vitest.config.ts`),
  `@` → `apps/desktop/src`. Your resolver must handle both, plus relative
  specifiers.

## Commands you will need

| Purpose        | Command                                                 | Expected on success |
| -------------- | ------------------------------------------------------- | ------------------- |
| Install        | `pnpm install`                                          | exit 0              |
| Format         | `pnpm format:fix` (run FIRST, never after gates)        | exit 0              |
| Typecheck      | `pnpm typecheck`                                        | exit 0              |
| Desktop tests  | `pnpm --filter @repo/desktop test`                      | all pass            |
| Just this test | `pnpm --filter @repo/desktop test editor-import-cycles` | passes              |
| Lint           | `pnpm lint`                                             | exit 0              |
| Dead code      | `pnpm knip`                                             | exit 0              |

## Scope

**In scope** (the only files you should create or modify):

- `apps/desktop/src/__tests__/editor-import-cycles.test.ts` (create)
- A small helper module **only if strictly necessary** — prefer keeping the
  detector inside the test file. If you do extract one, it goes at
  `apps/desktop/src/__tests__/` too, kebab-case, and must be imported by the test
  (otherwise knip flags it).

**Out of scope** (do NOT touch):

- **Every file under `apps/desktop/src/renderer/editor/`.** This plan adds a
  guard; it does not restructure anything. The current structure is correct.
- `apps/desktop/src/renderer/editor/kits/base-kit.ts` and the kit-parity test
  (`apps/desktop/src/renderer/__tests__/kit-parity.test.ts`) — settled design.
- `package.json` / `pnpm-lock.yaml` — see the dependency rule below.
- `.oxlintrc.json`, `knip.json`, `apps/desktop/vitest.config.ts` — the chosen
  location needs no config change.

## Git workflow

- Branch: `kyh/plan-011-editor-kit-cycle-guard`
- Conventional commit, e.g. `test(desktop): guard the editor kit import graph against cycles`
- Do NOT push and do NOT open a PR.

## Approach: pick one (default is (a))

**(a) Hand-rolled static scan in a vitest test — THE DEFAULT. Do this unless it
proves impossible.**

- Pros: no new dependency; runs inside the existing `pnpm test` gate; you control
  exactly what counts as an eager import (the `React.lazy(() => import())` calls
  must be treated as **non**-edges — a general tool would need configuring for
  that anyway); scoped precisely to the editor directory.
- Cons: you write ~80 lines of resolver. It does **not** need to be a
  general-purpose module resolver — only accurate over
  `apps/desktop/src/renderer/editor/**`.

**(b) `madge --circular` (or dependency-cruiser) as a devDependency + a script.**

- Pros: battle-tested, handles TS/TSX resolution and path aliases.
- Cons: a new dependency; needs config to ignore dynamic `import()` (or it reports
  the lazy edges as cycles — exactly the ones the code deliberately uses to break
  them); another tool in the gate chain.

**HARD RULE**: adding a dependency is the **operator's** call. If you conclude
option (b) is necessary, **STOP and report** — do not add a package unilaterally.

## Steps

### Step 1: Write the cycle detector

Create `apps/desktop/src/__tests__/editor-import-cycles.test.ts`. Structure:

1. **Collect** every `.ts`/`.tsx` file under
   `apps/desktop/src/renderer/editor/` (recursively, excluding `*.test.ts*`).
   Use `node:fs` + `node:path`; resolve the editor root from
   `import.meta.dirname` (the existing node-side tests in this directory show the
   pattern — read `apps/desktop/src/__tests__/vault-app-protocol.test.ts` first).

2. **Extract STATIC import specifiers** from each file's source text. Match, at
   minimum:
   - `import ... from "spec";`
   - `import "spec";`
   - `export ... from "spec";`
   - `import type ... from "spec";`

   **Deliberately EXCLUDE dynamic `import("spec")`** — the deferred
   `React.lazy(() => import("@renderer/editor/wiki-chip"))` edges are precisely
   how the cycles are broken today. A regex over the source is acceptable here;
   the corpus is a known, small, well-formatted directory (oxfmt-formatted). If a
   regex feels too fragile, `ts.createSourceFile` from the `typescript` package
   (already a devDependency — check `apps/desktop/package.json` before relying on
   it) is a legitimate alternative that needs no new install.

   Watch out for false positives: the word `import` inside a comment or string.
   Stripping `//` line comments and `/* */` block comments before matching is
   enough for this corpus.

3. **Resolve** each specifier to an absolute file path. Handle:
   - relative: `./foo`, `../kits/bar`
   - alias: `@renderer/...` → `apps/desktop/src/renderer/...`, `@/...` → `apps/desktop/src/...`
   - extension probing: try `.ts`, `.tsx`, then `/index.ts`, `/index.tsx`
   - **ignore anything that resolves outside the editor directory, and every bare
     package specifier** (`react`, `platejs`, `@repo/ui/...`, `@repo/core/...`).
     This guard is about the editor's internal graph. Edges _out_ of the editor
     dir (e.g. into `@renderer/workspace/vault-context`) are the ones that would
     eventually loop back — see step 2 for how to handle that.

4. **Detect cycles** with an iterative or recursive DFS carrying a
   `visiting`/`visited` marking, and on a back-edge, capture the actual cycle path
   for the failure message.

5. **Assert**: `expect(cycles).toEqual([])`. On failure, print the cycle as a
   readable chain (`a.ts → b.ts → kits/c.tsx → a.ts`) with file paths relative to
   the repo root — the whole value of this guard is a diagnosable message.

**Verify**: `pnpm --filter @repo/desktop test editor-import-cycles` → **PASSES**
on the current tree.

> **If it FAILS on first run**: that is a genuine latent cycle in the shipped
> editor. **STOP and report it** — do not "fix" it by editing editor files, and do
> not weaken the detector until it goes green. Untangling a real cycle is a
> separate, riskier change and the operator's call. Report the exact cycle chain.

### Step 2: Decide the boundary — extend the graph to the loop-closers

The intra-editor graph alone may be trivially acyclic, because the documented
cycle runs **through** `@renderer/workspace/vault-context` and the markdown
pipeline. A guard that only walks `editor/**` would then never catch the real
regression (an eager `import { useVault } from "@renderer/workspace/vault-context"`
added to a kit file).

Therefore, extend the crawl: **follow static import edges wherever they lead
inside `apps/desktop/src/renderer/`** (not just `editor/`), starting from the
editor files. Bare package specifiers and anything outside `src/renderer/` are
still ignored. That way the real loop — kit → vault-context → markdown pipeline →
base-kit → kit — is inside the graph and gets caught.

Then narrow the assertion to what this plan promises: **fail only on cycles that
touch at least one file under `apps/desktop/src/renderer/editor/`.** If the crawl
turns up an unrelated cycle elsewhere in the renderer, report it (`console.warn` +
mention it in your final report) but do not fail the test on it — fixing renderer
cycles outside the editor is not this plan's job.

**Verify**:

- The test still **passes** on the current tree.
- **Prove the guard is not a no-op**: temporarily add
  `import { useVault } from "@renderer/workspace/vault-context";` to
  `apps/desktop/src/renderer/editor/kits/wiki-link-kit.tsx`, run
  `pnpm --filter @repo/desktop test editor-import-cycles` → it must **FAIL** and
  print a cycle chain through `vault-context` and `base-kit`. **Then revert that
  edit** (`git checkout -- apps/desktop/src/renderer/editor/kits/wiki-link-kit.tsx`)
  and re-run → passes. Report both observations. If the guard does NOT fail on
  that injected import, the detector is broken — fix it before continuing.

### Step 3: Negative self-test (in-memory)

Add a second `it(...)` in the same file that runs the cycle-detection function
against a **synthetic in-memory graph** (a plain
`Map<string, readonly string[]>`), so the detector itself is proven to work
independently of the real tree. To do this, the detection step must take a graph
as an argument (pure function), separate from the file-crawling step:

```ts
// shape, not literal code
function findCycles(graph: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[];
```

Cases:

1. `a → b → c → a` → reports one cycle containing all three.
2. `a → b`, `a → c`, `b → d`, `c → d` (a diamond, acyclic) → reports **none**.
3. `a → a` (self-import) → reports a cycle.

This is the point of the step: **a guard that always passes is worse than none.**

**Verify**: `pnpm --filter @repo/desktop test editor-import-cycles` → 4+ tests
pass (the real-graph assertion + the three synthetic cases).

### Step 4: Gates

`pnpm format:fix` FIRST, then:
`pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build`

**Verify**: every command exits 0. Confirm `git status --short` lists **only**
the new test file.

## Test plan

The check **is** the test. One file,
`apps/desktop/src/__tests__/editor-import-cycles.test.ts`, containing:

- `it("the editor import graph is acyclic")` — crawls the real tree (step 2) and
  asserts no cycle touches `renderer/editor/`. Fails with the cycle chain printed.
- `it("detects a simple cycle")` / `it("accepts a diamond")` /
  `it("detects a self-import")` — the synthetic-graph self-tests (step 3).

Structural model: `apps/desktop/src/__tests__/vault-app-protocol.test.ts` (the
existing node-project test in the same directory — read it for the `node:fs` /
`import.meta.dirname` / vitest conventions used here).

No existing test changes.

## Done criteria

ALL must hold:

- [ ] `apps/desktop/src/__tests__/editor-import-cycles.test.ts` exists
- [ ] `pnpm --filter @repo/desktop test editor-import-cycles` exits 0 on the
      clean tree, with ≥4 passing tests
- [ ] The guard was **demonstrated to fail** on an injected eager
      `vault-context` import into a kit file, and that injection was reverted
      (`git status --short` shows no editor file modified)
- [ ] `pnpm typecheck && pnpm lint && pnpm knip && pnpm format && pnpm test && pnpm build` all exit 0
- [ ] `git diff --stat 91347c66..HEAD -- apps/desktop/src/renderer/editor` → **empty**
      (no editor file changed)
- [ ] `git diff --stat 91347c66..HEAD -- package.json pnpm-lock.yaml apps/desktop/package.json`
      → **empty** (no dependency added)
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The comments quoted in "Current state" don't match the live files (drift).
- **The guard fails on the current tree.** That means a real cycle exists today.
  Report the exact chain. Do NOT fix it here and do NOT loosen the detector to
  make it green.
- You conclude a devDependency (`madge`, `dependency-cruiser`, or anything else)
  is required. Adding a dependency is the operator's call — report the reasoning
  instead of installing.
- The guard cannot be made to fail on the step-2 injected import. A guard that
  can't detect the very regression it exists for is worthless — report rather
  than shipping it.
- Making the detector typecheck would require `any`, `!`, or an `as` cast.
- You find yourself needing to edit any file under
  `apps/desktop/src/renderer/editor/` for anything other than the temporary,
  reverted step-2 injection.

## Maintenance notes

- **The rule this guard encodes**: files under `apps/desktop/src/renderer/editor/kits/`
  (and anything `base-kit.ts` composes) must not _eagerly_ import
  `@renderer/workspace/vault-context` or anything that transitively reaches
  `base-kit.ts`. `React.lazy(() => import(...))` is the sanctioned escape — it is a
  deferred edge and the detector deliberately ignores it.
- If someone later adds a legitimate _dynamic_ import that genuinely does deadlock
  at module init, this detector will not catch it (by design, since the current
  code relies on dynamic imports being safe). That trade is intentional; record it
  if the assumption ever breaks.
- Reviewer should scrutinize: (1) that the detector's specifier extraction skips
  dynamic `import()` and comments, and (2) that the step-2 fail-injection was
  actually performed — a green guard that never fails proves nothing.
- Deferred out of scope: enabling a cycle check for the whole renderer (or the
  whole monorepo). The editor is where the constraint is documented and where the
  failure mode is expensive; widen it only if a cycle bites elsewhere.
