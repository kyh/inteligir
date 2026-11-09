# Decisions: repo guards and tooling

The guards, vendored code, the toolchain's pins and the build's rules.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Repo guards, vendoring and tooling

- **No coverage tooling, on purpose, and a structural guard states its own
  rule.** Targeted structural invariants instead: the dependency DAG and where
  each package may reach (`tools/repo-guards`), each package's node and react
  rule and the MCP and OpenAPI imports only the service makes
  (`oxlint.config.ts`), every `/v1` refusal mapped to a status
  (`packages/contract/src/v1-contract.test.ts`), `@repo/ui`'s per-export
  orphans and type roles, the editor's buffer invariant, and the words on
  every surface a person reads, the changelog aside, where neither "vault" nor
  an engine's word appears (`tools/repo-guards/src/product-words.test.ts`, a
  textual lower bound over quoted literals, templates, JSX text and the legal
  pages). Coverage, if ever added, needs `coverage.include` (Vitest 4) and
  gates only `@repo/contract` and `@repo/service`. A guard's failure states its rule and names the
  file.

- **A GUARD DERIVES EVERY VALUE IT CAN, AND IS FOR A FAILURE NOTHING ELSE
  REPORTS.** What it cannot derive is a row carrying its reason
  (`EDITOR_PAGE_CLIENTS`, `PROSE_SIZES`, product-words' `ALLOWED`), and
  `dep-dag.test.ts`'s `DECLARED_EDGES` is the pin itself. A second copy of a
  tool's check, or of what the tree already prints, is one more table every
  change keeps in step, so knip's unused dependencies,
  oxlint's import rules and `pnpm e2e --list` get no guard, and CI is
  `pnpm verify` plus the steps `verify` cannot run, each with its reason beside
  it in `.github/workflows/ci.yml`.

- **VENDORED CODE IS THIS REPO'S CODE, except for the attribution.** Rename,
  restructure and delete freely; "the next re-pull becomes a conflict" is not a
  reason. Every vendored file keeps its `// Vendored from X, MIT.` header, and
  the licence texts live under `tools/licenses`. The .app
  ships its own notices, since only it carries what they cover: every Rust
  crate the shell links, written at package time from cargo's resolve
  (`apps/desktop/scripts/rust-notices.ts`) and checked by the smoke.
  `packages/ui/components.json`'s `rsc: true` is inert: no consumer renders
  server components.

- **THE REACT COMPILER IS ON FOR EVERY BUNDLE, THROUGH react.dev's VITE PATH**
  (owner decision): `@vitejs/plugin-react`'s `reactCompilerPreset` run by
  `@rolldown/plugin-babel` in the web's, the phone editor page's and the
  gallery's vite configs and the extension's WXT config
  (`apps/extension/wxt.config.ts`), and `reactCompiler: true` in
  `apps/mobile/app.config.js`; the web's build says each component the
  compiler skipped (`apps/web/vite.config.ts`). The suites run what
  ships: the library's, `@repo/editor`'s, `@repo/ui`'s, the phone page's and
  the extension's DOM tests compile their sources the same way (not test files,
  where a fixture hook minted in a factory is hoisted with no diagnostic), and
  a `compiled-under-test` case in each fails without the preset (the phone
  page's in `apps/mobile-editor/src/item/item-page.test.tsx`, the extension's in
  `apps/extension/src/entrypoints/popup/popup.test.tsx`). A node suite cannot
  run compiled: the preset applies to the client environment alone. Rejected:
  the plugin's own `compiler` option (marked experimental, over a second
  compiler build that compiles code Babel's refuses). The manual-memo sweep is
  #820.

- **TOOLING PINS, each with its reason beside it**: `vite` is a pnpm override,
  since the catalog binds only the manifests that spell it; `@types/node` tracks
  `engines.node`; `compatibilityDate` is the lockfile's oldest workerd, and no
  earlier than 2026-10-01 (`tools/repo-guards/src/workerd-compat-date.test.ts`);
  `pnpm e2e` boots the built Worker
  (`tools/e2e/src/scenarios/built-worker-boot.ts`), and `pnpm smoke:desktop`
  the packaged .app on one (`apps/desktop/scripts/smoke-packaged.ts`);
  agent-browser is pinned by hand in `.github/workflows/ci.yml`, a global
  install riding no lockfile, and the Rust toolchain by `apps/desktop/rust-toolchain.toml`, beside
  the `Cargo.lock` every cargo step runs `--locked` against. The
  browser-extension scenarios pass agent-browser's `--profile` and
  `--extension` on every call (`tools/e2e/src/harness/extension-fixture.ts`),
  since agent-browser launches its browser on whichever call comes first. The
  arguments are `pnpm-workspace.yaml`'s comments.

- **AN UPDATE SWEEP SKIPS THE EXPO SDK'S NAMES, NOT ITS `expo:` CATALOG.**
  `update.ignoreDeps` holds `expo`, `expo-*`, `@expo/*`, `react-native`,
  `react-native-*` and `@react-native/*` under `pnpm up --latest -r`, and
  `nativewind`, whose `latest` is its Tailwind 3 line. It matches by name, so
  `react` and `typescript`, which web shares, cannot be listed without freezing
  web too: after a sweep, revert the `expo:` catalog rows by hand, then
  `npx expo install --check` in `apps/mobile`. An SDK upgrade moves all of them
  together, `expo-share-intent` by hand: it is third-party, so
  `npx expo install --fix` does not manage it, though its major tracks the SDK
  (its peer `expo` range) and the `expo-*` glob skips it.

- **A TURBO CACHE KEY NAMES EVERYTHING ITS OUTPUT READS**, because a hit replays
  the output with no error, and the e2e suite and `package:*` ship what it
  replays. Another workspace's files enter a key only through a `^` edge, and
  no task names another workspace's: the Worker's build reaches the editor's
  and the ui's files through its own `^build` edge. A
  file in no workspace is a named input, and a followed file a named output
  (`apps/web/turbo.json`); `tools/repo-guards/src/turbo-cache-keys.test.ts`
  holds the `^` edges and a bundled import's input (`/privacy` renders
  `docs/privacy.md`). `NODE_ENV` is hashed, not passed through: vite emits
  React's dev build under `development`.

- **THE WORKER DEPLOYS WHEN A TASK'S INPUTS CHANGED.** The cache key's inputs
  decide it: `futureFlags.affectedUsingTaskInputs` (`turbo.json`) counts a
  changed file for every task whose inputs name it, and Deploy asks
  `turbo query affected`, which honours the flag where `turbo ls` does not
  (`.github/workflows/deploy.yml`), so an edit to the legal texts alone deploys.

- **A DEPENDENCY'S COST WE CANNOT WAIT OUT UPSTREAM IS A pnpm PATCH, AND A TEST
  FAILS WITHOUT IT.** A patch applies through `patchedDependencies` in
  `pnpm-workspace.yaml`, and a bump fails the install until it is re-cut or
  dropped. `patches/micromark@4.0.3.patch` is upstream's own open fix
  (micromark/micromark#233): one splice per line, with GFM's email autolink
  splitting at every word, parses a long paragraph in time quadratic in its
  lines; `packages/editor/src/markdown/parse-cost.test.ts` compares a 20k-line
  paragraph's parse with an eighth of it. Rejected: a workaround
  in the editor's grammar (splitting the paragraph changes what it parses to).
  Residual: a paragraph dense with emphasis or inline nodes is still
  superlinear upstream, and not patched.

- **THE EDITOR'S SAVE AND ITS COMMITS EACH CARRY A PATCH.**
  `patches/@platejs__core@53.5.2.patch`: Plate resolves a throwaway plugin to
  answer the type of a key no plugin registers, and the markdown serializer
  asks that of every mark rule on every text node, four fifths of a long note's
  save; `packages/editor/src/typing-budget.test.tsx` fails on a save that
  resolves one. `patches/react-dom@19.2.8.patch`: before every commit React
  reads the focused element's selection as text offsets, which for a
  contenteditable walks every node of the open note on each keystroke and
  scroll frame a commit rides, though the editor keeps its own selection;
  `packages/editor/src/commit-selection-walk.test.tsx` fails on a commit that
  walks it.

- **NO TYPE ASSERTION, AND NO ESCAPE COMMENT** (owner decision).
  `typescript/consistent-type-assertions` at `assertionStyle: "never"` refuses
  every `as T` and `<T>x`, tests included; `as const` and `satisfies` stay
  legal. A library's wide type is narrowed by its own guard
  (`ElementApi.isElementList` in `packages/editor/src/markdown/markdown-doc.ts`)
  or parsed by the schema that names it. anti-slop's
  `require-safety-comment-for-type-assertion` is off: it admits a cast behind a
  `// SAFETY:` comment, so a green lint reads as permission. Rejected:
  documenting that escape. `oxlint.config.ts`.

- **A RELEASE SCRIPT IS TYPESCRIPT NODE RUNS AS IT STANDS, CHECKED AS NODE
  RESOLVES IT.** `apps/desktop/scripts` are `.ts` files node 24 strips of their
  types, the workspace's `typecheck` checking them as a
  `scripts/tsconfig.json` program under `nodenext`, `erasableSyntaxOnly` and
  `verbatimModuleSyntax`, so an extensionless import, an enum or a type
  imported as a value fails the typecheck rather than the release. A relative
  import names its `.ts`, JSON a script reads is parsed by zod, and its own
  manifest is a JSON import. Rejected: `checkJs` over `.mjs` (JSDoc casts the
  type-assertion rule cannot see); `tsx` (a loader for what node already runs).

- **A SCRIPT LOADS NO EXTENSIONLESS MODULE, AND ONE SCRIPT STAYS JS.** A module
  whose imports name no extension (most of the contract's) cannot load in a
  script, so a script parses only the fields it reads
  (`apps/desktop/scripts/rust-notices.ts`). `.github/scripts/worker-preview.mjs`
  stays JS: its first step runs before the job sets up the repo's node. It sits
  in no workspace, so this one's suite runs it against a stub of both APIs
  (`tools/repo-guards/src/worker-preview.test.ts`).

- **A TEST SITS BESIDE THE MODULE IT TESTS, AND A PACKAGE'S SHARED TEST CODE IS
  ITS `test-support/`.** A suite is `<name>.test.ts` beside its `<name>.ts`, and
  a suite over several modules sits in the folder that holds them; the
  harnesses, fakes, stubs, setup files and fixtures its suites share sit in the
  nearest `test-support/`, and a snapshot in vitest's `__snapshots__/` beside
  its suite. Those two names are all a config reads to tell a test from a
  source: every suite's React Compiler skips `/\.test\.tsx?$/` and
  `/\/test-support\//`, as do oxlint's test overrides (`oxlint.config.ts`),
  `isTestFile` (`tools/repo-guards/src/repo.ts`) and the pages' own program
  (`apps/web/tsconfig.page.json`). Rejected: `__tests__/` folders (a
  second place to look, drifting from its module; kyh/init puts a test beside
  its module). `tools/repo-guards/src/tests-beside-source.test.ts`.

- **EVERY TSCONFIG EXTENDS `@kyh/tsconfig/base.json`, AS kyh/init's DO** (owner
  decision). A program adds only what its runtime needs: its `lib` (ES2023, the
  pages' and Hermes' ceiling; a node program may take ES2024), `types`, `jsx`,
  `paths`, `customConditions` and `moduleSuffixes`, and one reaching a
  Worker's config (`apps/web/cloudflare.config.ts`,
  `packages/service/cloudflare.config.ts`) allows the `.ts` import spelling
  it uses. As
  each workspace's catalog dependency, the base's version is in every
  typecheck key with no global turbo row. With no `noImplicitReturns`, an
  exhaustive `switch` with no `default` declares a return type excluding
  undefined, so a new member fails it. The base's `allowJs` and `checkJs` are left as
  the base sets them, since no program's `include` holds a `.js` file. Rejected: a
  stricter local base (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`,
  `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
  everywhere), a second base beside the template's.

- **THE E2E RUNS IN LANES.**
  `pnpm e2e` runs one scenario per two of the machine's cores at once, at most
  four, each started in registry order as a lane frees and its log printed whole
  when it ends; `--lanes 1` runs them one after another, streaming. Ports,
  scratch dirs and browser sessions are each lane's own, and the Worker and the phone's editor page are built once
  per run, a build's wait behind another lane's not counted against its
  scenario's deadline. Rejected: one serial run (835 s against about 490 s on
  four cores). `tools/e2e/src/run.ts`.

- **LINT READS TYPES, AND EVERY SUITE IS HELD TO ULTRACITE'S VITEST PRESET.**
  oxlint runs type-aware (`oxlint-tsgolint`) after the `generate` tasks whose
  types the Worker's, the service's and the extension's programs extend, every type-aware rule
  at error but consistent-return, no-unnecessary-condition,
  prefer-optional-chain and prefer-readonly-parameter-types, and its own config
  makes an unused disable directive an error. Every suite is held to
  `ultracite/oxlint/vitest`: an `if` around a claim becomes vitest's `assert`
  narrowing the value, a loop of tests an `it.each`, an equality
  `toStrictEqual`. A rule stays off only with its reason beside it. Rejected: a
  fix taken unread (prefer-expect-resolves dropped `expect`'s message,
  prefer-called-with claimed a call with no arguments, prefer-comparison-matcher
  handed strings to number matchers, and prefer-optional-chain read
  `x === null || x.y === null` as `x?.y === null`); `vi.mock(import(…))` for a
  partial stub (it types the factory against the whole module).
  `oxlint.config.ts`.
