# @repo/repo-guards — the fitness tests over the repo itself

Derived fitness tests over the REPO rather than any one workspace: the
invariants that span packages and belong to none of them. Each guard walks the
real tree, derives the population it judges, holds it against ONE declared
table, and fails with the rule, the file and the fix in the message. They are
this workspace's `test` script, so `pnpm verify` and CI carry them beside
every other suite.

## Why it exists

There is no coverage tooling, on purpose. What the repo pins instead is
structure: the dependency DAG and where each package may reach, that every
socket change kind has a producer, that a route path has one spelling, that
every turbo cache key names what its output reads. Those are questions the
compiler, knip and a unit suite cannot ask — a file guard cannot see one unused
export beside four used ones, TypeScript catches a missing arm but never a
drifted table, and turbo strips an undeclared env var with no error on either
side.

Every guard obeys three rules. It states its own rule in the failure, so the
message is the documentation. It names the file to change. And it DERIVES every
value it compares — the workspace list from pnpm itself, a vocabulary
from its zod declaration, the route paths from the contract's constants — so a
copy cannot drift from what it copies. What a guard cannot derive is a
hand-written table, and there are two kinds: a pin, like `DECLARED_EDGES` in
`dep-dag.test.ts`, which states which package may import which and is held
against the import graph from both sides; and an exception table, each row
carrying its reason, held stale-free (below).

## Layout

```
src/
  repo.ts             # the ONE tree walk every guard shares: workspaces()
                      # as pnpm lists them, workspaceGroups(),
                      # workspaceFiles (src/** split shipped vs test),
                      # workspaceSourceFiles (the whole workspace dir — scripts/
                      # included), styleFiles, sourceOf (full-line comments
                      # dropped, so prose cannot invent a package), importsOf,
                      # and the turbo.json readers (turboTaskBodies,
                      # workspaceTurboConfig)
  ui-package.ts       # @repo/ui's swept roots, read from its exports map, and
                      # the gallery dir that never counts as a consumer
  content-security-policy.ts
                      # a policy read as a map of directives, so the first
                      # run's and the phone page's compare to the server's
  *.test.ts           # one guard per file — the list below
```

The walk skips `node_modules`, `dist`, `coverage` and every dot-directory, so a
guard passes the same on CI and on a machine that has run a build, and an agent
worktree under `.claude` is never read as this commit's tree.

## The guards

One per file; its header and its failure message state the rule in full.

- `dep-dag.test.ts`: imports match `DECLARED_EDGES` from both sides, and each package reaches only what its platform allows.
- `dangling-references.test.ts`: every `@repo/*` name and group-anchored path in a tracked file resolves (what it reads: below).
- `ws-change-kinds.test.ts`: every declared change kind is fired, and every fired kind declared.
- `domain-dispatch.test.ts`: a file quoting every member of a vocabulary is its declaration or a `dispatchedIn` row.
- `one-spelling.test.ts`: path containment and porcelain parsing are spelled once, or in an `elsewhere` row.
- `route-paths.test.ts`: a non-procedure route path is spelled only at its contract home.
- `turbo-passthrough.test.ts`: a workspace that reads `resolveAppConfig` passes exactly `ENV_VAR_NAMES` through turbo.
- `turbo-cache-keys.test.ts`: a cached task over workspace deps has a `^` edge, and an import outside every workspace is a build input.
- `desktop-shell-wire.test.ts`: the words the Rust shell shares with the page and the CLI match on both sides.
- `phone-page-csp.test.ts`: the phone page's CSP is the server's, apart from a `PAGE_DEPARTURES` row.
- `ui-orphan-exports.test.ts`: every `@repo/ui` export has a consumer outside the gallery, or a reasoned row.
- `gallery-coverage.test.ts`: every component under the demoed roots is in the gallery, or a `NOT_DEMOED` row.
- `type-roles.test.ts`: chrome draws text only in the five type roles, or a `PROSE_SIZES` row.
- `compiled-hook-shapes.test.ts`: no react source defines a `use*` hook inside another function.
- `appearance-tokens.test.ts`: every `--editor-*` token written is read, declared, and falls back to the stylesheet default.
- `page-prefs.test.ts`: a storage key is spelled only in the workspace's `PREFS` table, or an `ELSEWHERE` row.
- `workspace-coverage.test.ts`: every `package.json` on disk is a pnpm workspace, one level under its group.
- `script-naming.test.ts`: a root script's workspace suffix and every `--filter` name a real workspace.
- `catalog-spelling.test.ts`: a dependency two manifests name is `catalog:`, or a `DECLARED_SPLITS` row.
- `tailwind-source.test.ts`: every `@source` glob's static base exists.
- `workerd-compat-date.test.ts`: the Worker's `compatibilityDate` is the oldest workerd date the lockfile resolves.
- `durable-git-stub.test.ts`: the durable-git stub's header names the version the lockfile resolves.
- `d1-unique-index.test.ts`: no `d1-http` schema declares `.unique()`; a unique is a `uniqueIndex` row.
- `agent-skills.test.ts`: every skill names itself, the hub indexes every skill, and the CLI's probe file exists.
- `control-bytes.test.ts`: no tracked text file carries a raw control byte other than tab, LF and CR.
- `changelog.test.ts`: `CHANGELOG.md` runs newest first, its top release naming the desktop's version.
- `release-versions.test.ts`: the CLI, desktop and phone carry one version, and EAS builds with the repo's pins.
- `ime-enter.test.ts`: a source testing a key against Enter imports `isImeComposing`, or is a `NOT_A_TEXT_FIELD` row.
- `privacy-routes.test.ts`: every cloud `/v1/` route has a row in `docs/privacy.md`, and every row a route.
- `decisions-index.test.ts`: `AGENTS.md` § Decisions indexes every nested `CLAUDE.md`, and the root one is `@AGENTS.md`.
- `tests-beside-source.test.ts`: no tracked path sits in a `__tests__` folder; a suite is beside its module, shared test code in `test-support/`.

Every exception table — `ALLOWED_EXPORTS`, `AWAITING_CONSUMER`, `NOT_DEMOED`,
`dispatchedIn`, `elsewhere`, `ELSEWHERE`,
`DECLARED_SPLITS`, `DATA_FILES`, `DELIBERATE_NON_REFERENCES`, `PROSE_SIZES`,
`NOT_A_TEXT_FIELD` — has a companion assertion that no row is STALE: a row
whose subject is gone, or whose gap has closed, fails too. An allowance that
outlives what it excused only ever loosens.

## What the dangling-reference sweep reads

The other guards read source, not prose — most through `sourceOf`, which drops
full-line comments — so prose and configuration would rot unwatched; this one
walks what the repo SAYS. Its population is git's index — never a directory walk, so build
output is not read as a claim — minus generated files (`*.gen.ts`,
the lockfile), dot-directories, `fixtures/`,
`__fixtures__/` and `seed/` directories, and the `DATA_FILES` rows. It matches
line by line with no markdown parsing, so a path inside a README's code block
counts exactly as one in its prose does, and a comment in source counts like
both.

Two limits, stated. A reference is checked only if it is a `@repo/<name>` (the
subpath after the name is not resolved) or a path anchored on a workspace group
(`packages/notes/src/knowledge/projection.ts` is checked; a relative
`src/projection.ts` in a Layout block is not). And a path git ignores (`dist/`,
`.wrangler/`) is excused by asking `git check-ignore`, so the rule stays in
`.gitignore` and this guard cannot disagree with it.

## Invariants

- **A guard states its rule in the failure**, names the file to change and
  says the fix. The message is the documentation; a green run needs none.
- **Every compared value is derived.** Workspaces from pnpm,
  vocabularies from their zod declarations, paths from the contract, the env
  contract from `config.ts`. A hand-written table is a pin or a reasoned
  exception, never a copy of something the tree already says.
- **A self-check per sweep.** Each guard asserts it found the thing it is held
  against (the `inteligir` workspace, `apps/cli/scripts/smoke.ts`, a `dial()`
  row), so an empty population fails as "the sweep is broken, not the tree"
  rather than passing over nothing.
- **Shipped and test are split.** `workspaceFiles` classes
  `test-support/` and `*.test.*` as test; an edge only a test crosses is not a
  DAG edge but must still be declared in the manifest.
- **This package reaches nothing.** Its `DECLARED_EDGES` row is empty: the
  contract, domain and config values its guards import are devDependencies,
  read at test time, and so are edges of no shipped graph.

## Adding a guard

1. `src/<name>.test.ts`. Derive the population through `repo.ts`, never a
   private walk — `workspace-coverage.test.ts` is what keeps the one walk
   honest, and a second one is a smaller tree with a green run over it.
2. Hold it against ONE declared table, and give that table a staleness
   assertion.
3. Fail with the rule, the file and the fix, and assert the sweep found its
   anchor.
4. Knip's vitest plugin reads `src/**/*.test.ts` as this workspace's entries,
   so a helper module is reachable only from a test.

## Running

```sh
pnpm --filter @repo/repo-guards test    # vitest, maxWorkers 2
pnpm test                               # turbo runs it with every other suite
```
