# Decisions: repo guards and tooling

The guards, vendored code, the toolchain's pins and the build's rules.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Repo guards, vendoring and tooling

- **A guard is for a rule spanning workspaces that no tool checks**, and states
  its rule and the file to change. Why: a guard repeating pnpm, tsc, knip,
  oxlint or a build is one more table to keep in step. `tools/repo-guards/README.md`.
- **Vendored code is this repo's code, except for the attribution**: rename and
  delete freely, keeping each `// @license MIT, vendored from X.` header and the
  project's licence in the workspace's `licenses/`, which the site and the
  extension carry for every workspace they bundle. Why: a re-pull conflict is
  no reason, and the licence asks its text travel with every copy, as the .app
  ships its crates' notices (`apps/desktop/src-tauri/about.toml`).
  `apps/web/scripts/write-licenses.ts`.
- **A bundle's notices are its build's**: Vite's `build.license` writes the
  licence of each package the extension's zip holds, a file per group of
  entrypoints. Why: a generator of ours is a list to keep in step with the
  lockfile. `apps/extension/wxt.config.ts`.
- **The React Compiler is on for every bundle** (owner decision), Next's
  `reactCompiler` for the site and react.dev's Vite path for the extension,
  every DOM suite compiles its sources the same way, and a hand `useMemo` or
  `useCallback` stays only as an effect's dependency or where the compiler would
  key a value wrongly. Why: the suites run what ships, a `compiled-under-test`
  case fails without the preset, and the compiler memoizes the rest.
  `apps/web/next.config.ts`, `apps/extension/wxt.config.ts`,
  `apps/mobile/app.config.js`.
- **A hook or component defined inside a function fails the extension's and the
  phone's build, and the library tab's suites.** Why: the compiler outlines its
  closures to module scope, past the enclosing function's locals, and says so
  only under `validateNoDynamicallyCreatedComponentsOrHooks`, which Next's
  compiler option has no slot for. `apps/web/vitest.config.ts`.
- **A tooling pin carries its reason beside it**: `vite` is a pnpm override,
  `@types/node` tracks `engines.node`, the Rust toolchain rides a `--locked`
  `Cargo.lock`. Why: the catalog binds only the manifests that spell a package.
  `pnpm-workspace.yaml`, `apps/desktop/rust-toolchain.toml`.
- **The product's version is the root `package.json`'s, and each shipped app
  reads it there.** Why: one client build floor holds every app, so a copy per
  manifest is three chances to ship apart. `package.json`.
- **A dependency two workspaces name is spelled `catalog:`**. Why: it is one
  version the repo agrees on; one manifest's inline range stays. `pnpm-workspace.yaml`.
- **An update sweep skips the Expo SDK's names, not its `expo:` catalog**: after
  `pnpm up --latest -r`, revert the `expo:` rows by hand and run
  `npx expo install --check` in `apps/mobile`. Why: `update.ignoreDeps` matches
  by name, and `typescript` is web's too. `pnpm-workspace.yaml`.
- **A turbo cache key names everything its output reads.** Why: a hit replays
  the output with no error, and the e2e and `package:*` ship it. `apps/web/turbo.json`.
- **A changed file counts for every task whose inputs name it**, under
  `futureFlags.affectedUsingTaskInputs`. Why: an edit to the legal texts alone
  deploys, and `verify:affected` lints and knips a change in any workspace,
  which only the root's tasks do. `turbo.json`.
- **A dependency's cost we cannot wait out upstream is a pnpm patch, and a test
  fails without it.** Why: a bump fails the install until the patch is re-cut
  or dropped. `patches/` (micromark:
  `packages/editor/src/headless/markdown/parse-cost.test.ts`;
  @platejs/core: `packages/editor/src/typing-budget.test.tsx`; react-dom:
  `packages/editor/src/commit-selection-walk.test.tsx`; next, its react-dom:
  `apps/web/src/library/commit-selection-walk.test.tsx`; slate-react:
  `tools/e2e/src/editor.test.ts`).
- **No type assertion, and no escape comment** (owner decision):
  `assertionStyle: "never"`, tests included. Why: a cast is a claim nothing
  checks, where a library's own guard or schema narrows. `oxlint.config.ts`.
- **A release script is TypeScript node runs as it stands**, checked under
  `nodenext`, `erasableSyntaxOnly` and `verbatimModuleSyntax`. Why: a bad
  import fails the typecheck, not the release. `apps/desktop/scripts/tsconfig.json`.
- **A test sits beside the module it tests, Playwright's flows included
  (`*.test.ts`, never `*.spec.ts`), and shared test code in `test-support/` as
  `*.test-utils.ts`, seed data as `*.fixture.ts`, which only a suite imports.**
  Why: those names are all a config, and landmines' `colocated-tests` and
  `test-file-names`, read to tell a test from a source, and a fake reaches oRPC
  and node, which one import would bring onto a page. `oxlint.config.ts`.
- **A DOM suite is a `*.test.tsx`**, in `@repo/ui`, the library tab and the
  editor: its vitest project sets jsdom and a setup file unmounts after each
  case, so a suite that needs a document is a `*.test.tsx` even with no JSX.
  Why: an environment and an unmount spelled per file are forgotten per file,
  and landmines leaves no vitest docblock. `packages/ui/vitest.config.ts`.
- **Every tsconfig extends `@kyh/tsconfig/base.json`, as kyh/init's do** (owner
  decision), adding only what its runtime needs, and no `lib` equal to the
  base's, the Mac WebKit's ES2023 ceiling in `apps/web/tsconfig.json`. Why: a
  second base beside the template's drifts from it.
- **Lint reads types**: oxlint runs type-aware after the `generate` tasks, an
  unused disable directive is an error, and a rule stays off only with its
  reason here or in a disable directive's `-- why`. Why: the unsafe-`any` and
  promise rules need the types. `oxlint.config.ts`.
- **Lint takes ultracite's landmines preset whole, every rule at error** (owner
  decision): no prose comments (only directives, a single-line `// WARNING:`
  for a dangerous recurring footgun, `@license` headers and TSDoc on an
  export), no annotated return type (pin a contract with `satisfies` or a typed
  variable), real implementations in suites with MSW for the network, no sleep,
  retry or raised timeout, and explicit package entrypoints. Why: rationale
  lives in these files and the commit, not beside the code.
  `oxlint.config.ts`.
- **`anti-slop/require-safety-comment-for-type-assertion` is off.** Why: it
  demands a `// SAFETY:` comment landmines forbids, and no assertion passes
  both (interfere-inc/landmines#4). `oxlint.config.ts`.
- **A suite standing in for what jsdom, the fake browser or the Mac app lacks
  keeps its double (`BROWSER_STAND_INS`)**: layout and its observers,
  `matchMedia`, canvas, navigation, Tauri's IPC, the fake browser's missing
  APIs, a dependency's internal calls counted, and a store or session failure
  injected into a database suite. Why: no real implementation runs under
  vitest; Playwright covers them in a browser. `oxlint.config.ts`.
- **A suite that drives its subject through the editor harness, or tests a
  stylesheet, is exempt from `colocated-tests` (`HARNESS_DRIVEN_SUITES`).**
  Why: its subject is loaded by the kit or is CSS, so no import names it.
  `oxlint.config.ts`.
- **A suite that does real work past vitest's default keeps its timeout,
  counted in `SLOW_SUITES`, and two waits no event ends are counted in
  `WAITED_OUT`**: sonner's own unmount timer, and the relay holding a turn's
  events for a window. Why: the counts only shrink. `oxlint.config.ts`.
- **An override's `no-restricted-imports` restates the repo-wide rows**
  (`restrictedImports`), each row a regex rather than a group. Why: an
  override's options replace the base's, and a group matches gitignore-style,
  so `react` would also refuse `@platejs/react`. `oxlint.config.ts`.
- **Rules off, and why**: `no-await-in-loop` (ordered awaits are deliberate: the
  outbox sends oldest first, an import lands a batch at a time),
  `typescript/consistent-return` (it flags the exhaustive switch tsc checks),
  `react/jsx-no-constructed-context-values` (the React Compiler memoizes a
  context's value); a string spread is allowed (it means code points),
  `instanceof Function` is allowed (anti-slop owns `typeof`), plain JS files
  turn off the unsafe-`any` rules (no program includes them), eve's two tool
  files keep snake_case names, Playwright's `{}` fixture destructure and `use`
  pass, and suites skip `require-await`, the unsafe-`any` rules and
  `no-empty-function` (a stub is `async` to match its port, vitest types its
  matchers `any`). `oxlint.config.ts`.
- **An icon-only button shows `@repo/ui`'s Tooltip, never the native `title`**,
  but the two per-block drag handles keep it. Why: one Tooltip root per block
  in a long note is a cost nobody measured. `oxlint.config.ts`.
