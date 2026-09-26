# @repo/repo-guards — the fitness tests over the repo itself

Derived fitness tests over the REPO rather than any one workspace: the
invariants that span packages and belong to none of them. Each guard walks the
real tree, derives the population it judges, holds it against ONE declared
table, and fails with the rule, the file and the fix in the message. They are
this workspace's `test` script, so `pnpm verify` and CI carry them beside
every other suite.

## Why it exists

There is no coverage tooling, on purpose. What the repo pins instead is
structure: the dependency DAG and the platform each package may touch, that
every socket change kind has a producer, that a route path has one spelling,
that CI is `pnpm verify` plus a declared extra set. Those are questions the
compiler, knip and a unit suite cannot ask — a file guard cannot see one unused
export beside four used ones, TypeScript catches a missing arm but never a
drifted table, and turbo strips an undeclared env var with no error on either
side.

Every guard obeys three rules. It states its own rule in the failure, so the
message is the documentation. It names the file to change. And it DERIVES every
value it compares — the workspace list from `pnpm-workspace.yaml`, a vocabulary
from its zod declaration, the route paths from the contract's constants — so a
copy cannot drift from what it copies. The one hand-written list in the package
is `DECLARED_EDGES` in `dep-dag.test.ts`, and that is the pin itself: the
statement of which package may import which, held against the import graph
from both sides.

## Layout

```
src/
  repo.ts             # the ONE tree walk every guard shares: globs read from
                      # pnpm-workspace.yaml, workspaces() by manifest,
                      # workspaceFiles (src/** split shipped vs test),
                      # workspaceSourceFiles (the whole workspace dir — scripts/
                      # included), styleFiles, sourceOf (full-line comments
                      # dropped, so prose cannot invent a package), importsOf,
                      # and the turbo.json readers (turboTaskBodies,
                      # workspaceTurboConfig)
  ui-package.ts       # @repo/ui's swept roots, read from its exports map, and
                      # the gallery dir that never counts as a consumer
  *.test.ts           # one guard per file — the table below
```

The walk skips `node_modules`, `dist`, `coverage` and every dot-directory, so a
guard passes the same on CI and on a machine that has run a build, and an agent
worktree under `.claude` is never read as this commit's tree.

## The guards

| file                           | the rule it derives, and refuses                                          |
| ------------------------------ | ------------------------------------------------------------------------- |
| `dep-dag.test.ts`              | The workspace DAG from BOTH sides: every workspace has a `DECLARED_EDGES` |
|                                | row; shipped imports match it (an undeclared edge and a dead edge both    |
|                                | fail); every import is in the importer's manifest; every manifest         |
|                                | dependency is imported, or is a `DECLARED_ARTIFACT_EDGES` row (installed  |
|                                | and executed, never imported — `inteligir` → `@repo/agent-skills`); no    |
|                                | cycles. Then platform purity: `PURITY_RULES` per package (node, react,    |
|                                | electron), `@repo/domain` declares only zod, no package imports an app,   |
|                                | every `CLOUD_ONLY_CLIENTS` row (`@repo/web`, `@repo/mobile`, each with    |
|                                | why it ships apart) reaches `@repo/api/cloud/*` and nothing else of the   |
|                                | contract, `src/cloud` never reaches `src/local` and a third bucket under  |
|                                | `packages/api/src` fails, and the Worker imports no package whose shipped |
|                                | graph reaches `node:`.                                                    |
| `dangling-references.test.ts`  | Every `@repo/*` name and every group-anchored path written in a tracked   |
|                                | source, config, markdown or yaml file resolves to a workspace or a path   |
|                                | on disk. What it reads is stated in its own section below.                |
| `ci-verify-parity.test.ts`     | A gate workflow (`pull_request` or `push`) runs `pnpm verify` or every    |
|                                | link of its chain, each job in verify's order; every step on top is a     |
|                                | `DECLARED_CI_EXTRAS` row with a reason; every workspace `smoke` script is |
|                                | reachable from a root script; every root `smoke*` runs in a gate or is a  |
|                                | `MANUAL_SMOKES` row; a `run:` step with no `name:` throws.                |
| `ws-change-kinds.test.ts`      | Every kind in `@repo/domain/change-kinds` is fired by a `notifyVault`,    |
|                                | `notifyDoc` or `notifyThread` call in shipped source outside              |
|                                | `packages/domain`, and every fired kind is declared.                      |
| `domain-dispatch.test.ts`      | One total dispatch per vocabulary: a shipped file quoting EVERY member    |
|                                | (vault sync state, thread status, pending-interaction status, thread and  |
|                                | vault change kinds) is a table, and must be the declaration or a          |
|                                | `dispatchedIn` row saying what it decides that the others do not. The     |
|                                | members are read from the declarations themselves.                        |
| `one-spelling.test.ts`         | One spelling per cross-cutting predicate: "is path P under root R?" is    |
|                                | `apps/cli/src/server/path-containment.ts`, "what does                     |
|                                | `git status --porcelain` say?" is                                         |
|                                | `apps/cli/src/server/vault/git-porcelain.ts`; a re-spelling needs an      |
|                                | `elsewhere` row. Detection is textual and a lower bound — the shapes      |
|                                | these were actually re-spelled in.                                        |
| `route-paths.test.ts`          | Every non-procedure route path (the local `/rpc`, `/health`,              |
|                                | `/vault/asset` and `/html-frame`; the cloud `VAULT_API_PATHS`) is         |
|                                | spelled only at its contract home. The sweep covers `scripts/`, where the |
|                                | smokes that drift live; tests are excluded, because a test deriving its   |
|                                | URL from the contract could not catch the contract moving.                |
| `turbo-passthrough.test.ts`    | Every workspace whose shipped source calls `resolveAppConfig` has a       |
|                                | `turbo.json` whose config-running tasks name exactly `ENV_VAR_NAMES` from |
|                                | `inteligir/server/config` — strict env mode strips the rest silently.     |
| `turbo-cache-keys.test.ts`     | Every cached turbo task a workspace with workspace dependencies runs      |
|                                | carries a `^` edge in its effective `dependsOn` (the root's, the          |
|                                | override, or both through `$TURBO_EXTENDS$`) — turbo hashes another       |
|                                | workspace's files into a key only through one, so without it an edit to   |
|                                | a bundled package replays stale output. `^topo` is the edge where `^self` |
|                                | would cycle; a `WITHOUT_DEPENDENCY_EDGE` row carries its reason. And a    |
|                                | relative import that leaves every workspace (`/privacy`'s                 |
|                                | `docs/privacy.md`) is named in its build's `inputs` as `$TURBO_ROOT$/…`.  |
| `ui-orphan-exports.test.ts`    | PER EXPORT under `@repo/ui`'s wildcard-exported roots: a consumer outside |
|                                | the gallery, an `AWAITING_CONSUMER` file (held whole, and not itself a    |
|                                | consumer) or an `ALLOWED_EXPORTS` row with its reason. `export *` is      |
|                                | refused as un-attributable.                                               |
| `gallery-coverage.test.ts`     | Every component under the demoed roots is imported by the `/design`       |
|                                | gallery or is a `NOT_DEMOED` row; `hooks` and `lib` are declared          |
|                                | non-component roots.                                                      |
| `type-roles.test.ts`           | The chrome under `apps/desktop/src/renderer`, `packages/editor/src`,      |
|                                | `packages/ui/src/components` and `packages/ui/src/ai` (minus              |
|                                | `AWAITING_CONSUMER`) draws text only in the five roles; a fixed note size |
|                                | is a `PROSE_SIZES` row with its reason.                                   |
| `compiled-hook-shapes.test.ts` | No react-importing source defines a `use*` hook inside another function — |
|                                | the React Compiler hoists its closures to module scope and reports no     |
|                                | diagnostic. The scanner is self-tested against braces in strings,         |
|                                | comments and template holes.                                              |
| `appearance-tokens.test.ts`    | The `--editor-*` funnel: the `dial()` rows in `appearance-options.ts`     |
|                                | write only tokens something reads, every read resolves to a `globals.css` |
|                                | declaration, every declaration is read, `--editor-width` carries no       |
|                                | fallback, and every fallback spells the stylesheet default exactly.       |
| `page-prefs.test.ts`           | Storage is read and written by key only in the desktop's `PREFS` table    |
|                                | (`apps/desktop/src/renderer/app/prefs.ts`), and no other file spells one  |
|                                | of its keys, which are read off the table's own rows; a store that is not |
|                                | the shell's is an `ELSEWHERE` row with its reason.                        |
| `workspace-coverage.test.ts`   | The walk's globs come from `pnpm-workspace.yaml` and their count matches  |
|                                | the raw text; every `package.json` on disk is reached by one; every       |
|                                | discovered workspace still has its manifest.                              |
| `script-naming.test.ts`        | A root script suffixed with a workspace directory drives that workspace;  |
|                                | every `--filter` target is a workspace.                                   |
| `catalog-spelling.test.ts`     | A dependency two or more manifests name is spelled `catalog:`; a          |
|                                | deliberate split is a `DECLARED_SPLITS` row with its reason.              |
| `tailwind-source.test.ts`      | Every `@source "…"` glob's static base is a directory that exists         |
|                                | relative to the stylesheet — Tailwind answers a missing base with an      |
|                                | empty scan, no error.                                                     |
| `wrangler-compat-date.test.ts` | `apps/web/wrangler.jsonc`'s `compatibility_date` is the OLDEST workerd    |
|                                | date `pnpm-lock.yaml` resolves — a workerd cannot emulate a date it       |
|                                | predates.                                                                 |
| `durable-git-stub.test.ts`     | The header of `apps/web/src/worker/types/durable-git.d.ts` names the      |
|                                | durable-git version `pnpm-lock.yaml` resolves — tsc checks the Worker     |
|                                | against that hand-written stub and never reads the package it bundles.    |
| `d1-unique-index.test.ts`      | The schema every `d1-http` drizzle config pushes declares no `.unique()`  |
|                                | column modifier — drizzle-kit 1.0 plans it as a table recreate, and D1's  |
|                                | DROP cascade-wipes the children. Uniques are named `uniqueIndex` rows.    |
| `agent-skills.test.ts`         | Every skill directory has a `SKILL.md` naming itself; the hub's Focused   |
|                                | Contracts index lists every other skill and no phantom; the file the CLI  |
|                                | resolver probes exists — a renamed probe answers null, not an error.      |
| `control-bytes.test.ts`        | No tracked source, markdown, config or sql file carries a raw control     |
|                                | byte other than tab, LF and CR — git diffs a file holding a NUL as        |
|                                | binary and ripgrep skips it. A string literal spells it as an escape.     |
| `changelog.test.ts`            | `CHANGELOG.md` is titled, every section is `## Unreleased` (top only) or  |
|                                | `## <version> — <date>`, releases run newest first, and the newest names  |
|                                | `apps/desktop`'s version — a release's notes are its top section. The     |
|                                | release-notes script, run over staged trees and the real one, prints that |
|                                | section only when it is titled for the package's version.                 |
| `ime-enter.test.ts`            | A source under `packages/ui/src`, `packages/editor/src` or the desktop    |
|                                | renderer that tests a key against Enter imports `isImeComposing`, or is   |
|                                | a `NOT_A_TEXT_FIELD` row — the Enter that commits an IME candidate is not |
|                                | the user's, and no unit suite types through a composition.                |
| `e2e-scenario-table.test.ts`   | `tools/e2e/README.md`'s scenario table names every scenario `SCENARIOS`   |
|                                | registers in `tools/e2e/src/run.ts`, in its order, each read from its own |
|                                | exported `name`.                                                          |
| `privacy-routes.test.ts`       | Every `/v1/` string literal in tracked non-test source under              |
|                                | `packages/api/src/cloud` has a row under `docs/privacy.md`'s "Every       |
|                                | address the app talks to", and every backticked `/v1/` route there is     |
|                                | still declared — the page promises every address the app talks to.        |
| `decisions-index.test.ts`      | `CLAUDE.md` § Decisions' index lists every `###` group under it, in their |
|                                | order, and every entry's anchor is a group's GitHub slug — a group added  |
|                                | or renamed far below cannot leave the index behind.                       |

Every exception table — `DECLARED_CI_EXTRAS`, `MANUAL_SMOKES`,
`ALLOWED_EXPORTS`, `AWAITING_CONSUMER`, `NOT_DEMOED`, `dispatchedIn`,
`elsewhere`, `ELSEWHERE`, `RUNS_OUTSIDE_TURBO`, `WITHOUT_DEPENDENCY_EDGE`,
`DECLARED_WITHOUT_PRODUCER`, `DECLARED_ARTIFACT_EDGES`, `DECLARED_SPLITS`,
`DATA_FILES`, `DELIBERATE_NON_REFERENCES`, `PROSE_SIZES`, `NOT_A_TEXT_FIELD` —
has a companion assertion that no row is STALE: a row whose subject is gone, or
whose gap has closed, fails too. An allowance that outlives what it excused only
ever loosens.

## What the dangling-reference sweep reads

The other guards read source, not prose — most through `sourceOf`, which drops
full-line comments — so prose and configuration would rot unwatched; this one
walks what the repo SAYS. Its population is git's index — never a directory walk, so build
output is not read as a claim — minus generated files (`*.gen.ts`,
`worker-configuration.d.ts`, the lockfile), dot-directories, `fixtures/`,
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
- **Every compared value is derived.** Workspaces from the manifest,
  vocabularies from their zod declarations, paths from the contract, the env
  contract from `config.ts`. `DECLARED_EDGES` is the one hand-written list
  because it is the pin.
- **A self-check per sweep.** Each guard asserts it found the thing it is held
  against (`ci.yml`, the `inteligir` workspace, `apps/cli/scripts/smoke.mjs`, a
  `dial()` row), so an empty population fails as "the sweep is broken, not
  the tree" rather than passing over nothing.
- **Shipped and test are split.** `workspaceFiles` classes `__tests__/`,
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
4. Knip reads `src/**/*.test.ts` as this workspace's entries (`knip.json`), so
   a helper module is reachable only from a test.

## Running

```sh
pnpm --filter @repo/repo-guards test    # vitest, maxWorkers 2
pnpm test                               # turbo runs it with every other suite
```
