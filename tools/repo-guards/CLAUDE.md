# Decisions: repo guards and tooling

The guards, vendored code, the toolchain's pins and the build's rules.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Repo guards, vendoring and tooling

- **No coverage tooling, on purpose, and a structural guard states its own
  rule.** Targeted structural invariants instead: the dependency DAG and where
  each package may reach, ws change-kind reachability (`tools/repo-guards`),
  each package's node and react rule (`oxlint.config.ts`), route-table
  completeness (`apps/cli/src/server/__tests__/http-surface.test.ts`),
  migration↔schema agreement
  (`packages/db/src/__tests__/schema-agreement.test.ts`), the per-export orphan
  guard and the type-role guard over `@repo/ui`, the CLI guide and its `--json`
  flags, the editor's buffer invariant, and the words on every surface a person
  reads (the window, the phone, the editor, `@repo/ui`, the extension, the
  shell's Rust and the sentences `@repo/notes` spells for them), where "vault" and the engine's words are Settings ›
  Advanced's alone (`tools/repo-guards/src/product-words.test.ts`, a textual
  lower bound over quoted literals and JSX text, like `one-spelling.test.ts`).
  If coverage is ever added,
  `coverage.include` is mandatory in Vitest 4, and gate only `@repo/notes`. A
  guard states its own rule in the failure, names the file, and derives every
  value it can; what it cannot is a row carrying its reason
  (`AWAITING_CONSUMER`, `CLOUD_ONLY_CLIENTS`, `EXCLUDED_COMMANDS`,
  `PROSE_SIZES`, product-words' `ALLOWED`), and `dep-dag.test.ts`'s `DECLARED_EDGES` is the pin itself. A
  guard is for a failure nothing else reports, because a second copy of a
  tool's check or of what the tree already prints is one more table every
  change keeps in step: knip's unused dependencies, oxlint's import rules and
  `pnpm e2e --list` get none, and CI is `pnpm verify` plus the steps `verify`
  cannot run, each with its reason beside it in `.github/workflows/ci.yml`.

- **VENDORED CODE IS THIS REPO'S CODE, except for the attribution.** Rename,
  restructure and delete freely; "the next re-pull becomes a conflict" is not a
  reason. Every vendored file keeps its `// Vendored from X, MIT.` header and
  the licence texts live under `tools/licenses`, staged into the artifact as
  `dist/licenses`, with `pnpm smoke:cli` deriving the expected set from the
  directory. The licences shipped elsewhere are the .app's own, since only the
  .app carries what they cover: the bundled git's and node's beside them, and
  the notices of every Rust crate the shell links, written at package time from
  cargo's resolve (`apps/desktop/scripts/rust-notices.ts`) and checked by the
  smoke. `packages/ui/components.json` declares `rsc: true` and it is inert:
  no consumer renders server components, each a Vite build, the extension's
  through WXT.

- **THE REACT COMPILER IS ON FOR EVERY BUNDLE**: `compiler: true` on
  `@vitejs/plugin-react` in the workspace's, the web's and the phone editor
  page's vite configs and in the browser extension's WXT config
  (`apps/extension/wxt.config.ts`), and `reactCompiler: true` in
  `apps/mobile/app.config.js`.
  The suites run what ships: the workspace's, `@repo/editor`'s, `@repo/ui`'s and
  the phone page's DOM tests compile their sources the same way (test files
  excluded, because a fixture hook minted in a factory is hoisted with no
  diagnostic), and a `compiled-under-test` suite in each fails when the plugin
  goes (the phone page's is the last case of
  `apps/mobile-editor/src/__tests__/editor-page.test.tsx`, and the extension's
  of `apps/extension/src/entrypoints/popup/__tests__/popup.test.tsx`). A node
  suite, and the workspace UI's booted ones (`apps/cli/src/workspace/__tests__`),
  cannot run compiled: the plugin skips the ssr transform. The manual-memo sweep
  is #820.

- **TOOLING PINS, each with its reason beside it**: `vite` is a pnpm override
  because the catalog bound only the manifests that spell it; `@types/node`
  tracks `engines.node`; `compatibility_date` is the lockfile's oldest workerd,
  held by `tools/repo-guards/src/workerd-compat-date.test.ts`; `pnpm e2e` boots
  the built Worker bundle (`tools/e2e/src/scenarios/built-worker-boot.ts`), the
  built CLI bundle (`tools/e2e/src/scenarios/built-cli-boot.ts`) and the built
  desktop shell (`tools/e2e/src/scenarios/desktop-shell.ts`); agent-browser and
  tauri-driver are pinned by hand in `.github/workflows/ci.yml` because a global
  install rides no lockfile, and the Rust toolchain by
  `apps/desktop/rust-toolchain.toml`, beside the `Cargo.lock` every cargo step
  runs `--locked` against. The browser-extension scenario passes agent-browser's
  `--profile` and `--extension` on every call
  (`tools/e2e/src/scenarios/browser-extension.ts`), since agent-browser launches
  its browser on whichever call comes first. The arguments are `pnpm-workspace.yaml`'s comments.
  AN UPDATE SWEEP SKIPS THE EXPO SDK'S NAMES, NOT ITS `expo:` CATALOG:
  `update.ignoreDeps` holds `expo`, `expo-*`, `@expo/*`, `react-native`,
  `react-native-*` and `@react-native/*` under `pnpm up --latest -r`. It matches
  by name, so `react` and `typescript`, which web shares, cannot be listed
  without freezing web too: after a sweep, revert the `expo:` catalog rows by
  hand, then `npx expo install --check` in `apps/mobile`. An SDK upgrade moves
  all of them together, `expo-share-intent` by hand: it is third-party, so
  `npx expo install --fix` does not manage it, though its major tracks the SDK
  (its peer `expo` range) and the `expo-*` glob skips it.

- **A TURBO CACHE KEY NAMES EVERYTHING ITS OUTPUT READS**, because a hit replays
  the output with no error, and the e2e suite and `package:*` ship what it
  replays. Another workspace's files enter a key only through a `^` edge
  (`tools/repo-guards/src/turbo-cache-keys.test.ts`), and no task names another
  workspace's: the CLI's build reaches `@repo/workspace#build` through its own
  dependency, and the shell's tasks reach both through theirs
  (`apps/desktop/turbo.json`). A file in no workspace is a named input
  (`apps/cli/turbo.json`), which the same guard holds for a bundled import
  (`/privacy` renders `docs/privacy.md`); a followed file is a named output
  (`apps/web/turbo.json`), and `NODE_ENV` is hashed, not passed through: vite
  emits React's dev build under `development`. The same inputs decide whether
  the Worker deploys: `futureFlags.affectedUsingTaskInputs` (`turbo.json`)
  counts a changed file for every task whose inputs name it, and Deploy asks
  `turbo query affected`, which honours the flag where `turbo ls` does not
  (`.github/workflows/deploy.yml`), so an edit to the legal texts alone deploys.

- **A DEPENDENCY'S COST WE CANNOT WAIT OUT UPSTREAM IS A pnpm PATCH, AND A TEST
  FAILS WITHOUT IT.** micromark merges a paragraph's text with one splice per
  line, and GFM's email autolink splits it at every word, so one long paragraph
  parsed in time quadratic in its lines. `patches/micromark@4.0.3.patch` is
  upstream's own open fix (micromark/micromark#233), applied through
  `patchedDependencies` in `pnpm-workspace.yaml`; a bump fails the install until
  the patch is re-cut or dropped. A workaround in `@repo/notes` was rejected:
  splitting the paragraph changes what it parses to.
  `packages/notes/src/__tests__/projection-cost.test.ts` compares a 20k-line
  paragraph's projection with an eighth of it. Residual: a paragraph dense with
  emphasis or inline nodes is still superlinear upstream, and not patched.
  `patches/@platejs__core@53.3.15.patch` is the second: Plate resolved a
  throwaway plugin to answer the type of a key no plugin registers, and the
  markdown serializer asks that of every mark rule on every text node, four
  fifths of a long note's save;
  `packages/editor/src/__tests__/typing-budget.test.tsx` fails on a save that
  resolves one. `patches/react-dom@19.2.8.patch` is the third: before every
  commit React read the focused element's selection as text offsets, and for a
  contenteditable that walked every node of the open note, on each keystroke and
  each scroll frame a commit rode, though the editor keeps its own selection;
  `packages/editor/src/__tests__/commit-selection-walk.test.tsx` fails on a
  commit that walks it.

- **NO TYPE ASSERTION, AND NO ESCAPE COMMENT** (owner decision).
  `typescript/consistent-type-assertions` at `assertionStyle: "never"` refuses
  every `as T` and `<T>x`, tests included; `as const` and `satisfies` stay
  legal. anti-slop's `require-safety-comment-for-type-assertion` is off: it
  admitted a cast behind a `// SAFETY:` comment, so a green lint read as
  permission; documenting that escape was the rejected alternative. A library's
  wide type is narrowed by its own guard (`ElementApi.isElementList` in
  `packages/editor/src/markdown/markdown-doc.ts`) or parsed by the schema that
  names it. `oxlint.config.ts`.

- **A RELEASE SCRIPT IS TYPESCRIPT NODE RUNS AS IT STANDS, CHECKED AS NODE
  RESOLVES IT.** `apps/desktop/scripts` and `apps/cli/scripts` (and
  `apps/workspace/scripts`, the page's dev loop) are `.ts` files node 24 strips
  of their types, each workspace's `typecheck` checking them as a
  `scripts/tsconfig.json` program under `nodenext` and `erasableSyntaxOnly`, so
  an extensionless import or an enum fails the typecheck rather than the
  release; a relative import names its `.ts`, JSON a script reads is parsed by
  zod, and its own manifest is a JSON import. Rejected: `checkJs` over `.mjs`,
  whose JSDoc casts the type-assertion rule cannot see, and `tsx`, a loader for
  what node already runs. A module whose imports name no extension (the
  server's, most of the contract's) cannot load in a script, so a smoke parses
  only the fields it reads (`apps/cli/scripts/smoke-lib.ts`).
  `.github/scripts/worker-preview.mjs` stays JS: its first step runs before the
  job sets up the repo's node.
