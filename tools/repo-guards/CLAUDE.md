# Decisions: repo guards and tooling

The guards, vendored code, the toolchain's pins and the build's rules.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Repo guards, vendoring and tooling

- **A guard is for a rule spanning workspaces that no tool checks**, and states
  its rule and the file to change. Why: a guard repeating pnpm, tsc, knip or
  oxlint is one more table to keep in step. `tools/repo-guards/README.md`.
- **Vendored code is this repo's code, except for the attribution**: rename and
  delete freely, keeping each `// Vendored from X, MIT.` header. Why: a re-pull
  conflict is no reason; the licences live in `tools/licenses`, and the .app
  ships its crates' notices (`apps/desktop/src-tauri/about.toml`).
- **The React Compiler is on for every bundle, through react.dev's Vite path**
  (owner decision), and every DOM suite compiles its sources the same way. Why:
  the suites run what ships, and a `compiled-under-test` case fails without the
  preset. `apps/web/vite.config.ts`, `apps/mobile/app.config.js`.
- **A tooling pin carries its reason beside it**: `vite` is a pnpm override,
  `@types/node` tracks `engines.node`, the Rust toolchain rides a `--locked`
  `Cargo.lock`. Why: the catalog binds only the manifests that spell a package.
  `pnpm-workspace.yaml`, `packages/service/compatibility.ts`,
  `apps/desktop/rust-toolchain.toml`.
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
- **`.github/scripts/worker-preview.mjs` stays JS.** Why: its first step runs
  before the job sets up the repo's node.
- **A test sits beside the module it tests, and shared test code in
  `test-support/`.** Why: those two names are all a config reads to tell a test
  from a source, as kyh/init does. `oxlint.config.ts`.
- **Every tsconfig extends `@kyh/tsconfig/base.json`, as kyh/init's do** (owner
  decision), adding only what its runtime needs, and no `lib` equal to the
  base's, the Mac WebKit's ES2023 ceiling in `apps/web/tsconfig.json`. Why: a
  second base beside the template's drifts from it.
- **Lint reads types**: oxlint runs type-aware after the `generate` tasks, an
  unused disable directive is an error, and a rule stays off only with its
  reason beside it. Why: the unsafe-`any` and promise rules need the types.
  `oxlint.config.ts`.
