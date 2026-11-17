# Decisions: repo guards and tooling

The guards, vendored code, the toolchain's pins and the build's rules.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Repo guards, vendoring and tooling

- **A guard is for a rule spanning workspaces that no tool checks**, and states
  its rule and the file to change. Why: a guard repeating pnpm, tsc, knip,
  oxlint or a build is one more table to keep in step. `tools/repo-guards/README.md`.
- **Vendored code is this repo's code, except for the attribution**: rename and
  delete freely, keeping each `// Vendored from X, MIT.` header. Why: a re-pull
  conflict is no reason; the site serves the licences
  (`apps/web/public/licenses`), and the .app ships its crates' notices
  (`apps/desktop/src-tauri/about.toml`).
- **A bundle's notices are its build's**: Vite's `build.license` writes the
  licence of each package the site's pages bundle, served as `/licenses.md` and
  linked from the home page and Settings, and of each the extension's zip
  holds, a file per group of entrypoints. Why: a generator of ours is a list to
  keep in step with the lockfile. `apps/web/vite.config.ts`.
- **The React Compiler is on for every bundle, through react.dev's Vite path**
  (owner decision), every DOM suite compiles its sources the same way, and a
  hand `useMemo` or `useCallback` stays only as an effect's dependency or where
  the compiler would key a value wrongly. Why: the suites run what ships, a
  `compiled-under-test` case fails without the preset, and the compiler
  memoizes the rest. `apps/web/vite.config.ts`, `apps/mobile/app.config.js`.
- **A hook or component defined inside a function fails the build**, the
  site's, the extension's and the phone's alike. Why: the compiler outlines its
  closures to module scope, past the enclosing function's locals, and says so
  only under `validateNoDynamicallyCreatedComponentsOrHooks`.
  `apps/web/vite.config.ts`.
- **A tooling pin carries its reason beside it**: `vite` is a pnpm override,
  `@types/node` tracks `engines.node`, the Rust toolchain rides a `--locked`
  `Cargo.lock`. Why: the catalog binds only the manifests that spell a package.
  `pnpm-workspace.yaml`, `packages/service/compatibility.ts`,
  `apps/desktop/rust-toolchain.toml`.
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
- **The Worker deploys when a task's inputs changed**, which
  `futureFlags.affectedUsingTaskInputs` counts. Why: an edit to the legal texts
  alone deploys. `.github/workflows/deploy.yml`.
- **A dependency's cost we cannot wait out upstream is a pnpm patch, and a test
  fails without it.** Why: a bump fails the install until the patch is re-cut
  or dropped. `patches/` (micromark: `packages/editor/src/markdown/parse-cost.test.ts`;
  @platejs/core: `packages/editor/src/typing-budget.test.tsx`; react-dom:
  `packages/editor/src/commit-selection-walk.test.tsx`; slate-react:
  `tools/e2e/src/editor.spec.ts`).
- **No type assertion, and no escape comment** (owner decision):
  `assertionStyle: "never"`, tests included. Why: a cast is a claim nothing
  checks, where a library's own guard or schema narrows. `oxlint.config.ts`.
- **A release script is TypeScript node runs as it stands**, checked under
  `nodenext`, `erasableSyntaxOnly` and `verbatimModuleSyntax`. Why: a bad
  import fails the typecheck, not the release. `apps/desktop/scripts/tsconfig.json`.
- **A test sits beside the module it tests, and shared test code in
  `test-support/`.** Why: those two names are all a config reads to tell a test
  from a source, as kyh/init does. `oxlint.config.ts`.
- **A DOM suite is a `*.test.tsx`**, in `@repo/ui`, the library tab and the
  editor: its vitest project sets jsdom and a setup file unmounts after each
  case, and a `*.test.ts` that needs a document says so in vitest's docblock.
  Why: an environment and an unmount spelled per file are forgotten per file.
  `packages/ui/vitest.config.ts`.
- **Every tsconfig extends `@kyh/tsconfig/base.json`, as kyh/init's do** (owner
  decision), adding only what its runtime needs, and no `lib` equal to the
  base's, the Mac WebKit's ES2023 ceiling in `apps/web/tsconfig.json`. Why: a
  second base beside the template's drifts from it.
- **Lint reads types**: oxlint runs type-aware after the `generate` tasks, an
  unused disable directive is an error, and a rule stays off only with its
  reason beside it. Why: the unsafe-`any` and promise rules need the types.
  `oxlint.config.ts`.
