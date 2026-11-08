# Development guide

How to run, verify, and change inteligir — the ONE home for the commands, the
ports, where state lives and the gate; `README.md` and `AGENTS.md` link here
rather than restating them. `AGENTS.md` is the coding agents' root: the
premises, the quickstart and the index of the decisions, each workspace's
`CLAUDE.md` its own; `apps/web/README.md` has the Worker's own routes and
deploy, and `docs/releasing.md` the release: every step and check that is the
owner's.

## Prerequisites

- Node 24, pnpm 12 (`corepack enable` reads the root `packageManager`)
- Rust through rustup: `apps/desktop/rust-toolchain.toml` pins the toolchain the
  desktop shell builds on, and the first `cargo` call installs it. On Linux,
  Tauri's prerequisites too (on Debian or Ubuntu: `build-essential`,
  `libxdo-dev`, `libssl-dev`, `libwebkit2gtk-4.1-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`; other distributions are in
  <https://v2.tauri.app/start/prerequisites/>); a Mac ships its own WebKit
- `pnpm install` at the repo root (workspace-wide)
- For `dev:web` only: `cp apps/web/.dev.vars.example apps/web/.dev.vars`,
  then set `BETTER_AUTH_SECRET` to anything. Without it every `/api/auth/*`
  request fails. The connector answers only `SITE_ORIGIN`'s host,
  `localhost:5174` here; the example says what to set to reach it through a
  tunnel. The example's `ANTHROPIC_FAKE_URL` points the built-in agent at
  the scripted Messages API `dev:web` serves (`tools/messages-fake`, whose
  README says how to script a turn).

## Commands

```bash
pnpm dev                # The Mac app's window over the local Worker (pnpm dev:web)
pnpm dev:desktop        # Alias of dev
pnpm dev:mobile         # apps/mobile: expo start, in a terminal (turbo refuses it piped or under CI;
                        #   pnpm --filter @repo/mobile dev runs it without one)
pnpm dev:web            # apps/web: vite + miniflare on :5174 (pinned, strictPort), the library's
                        #   page at /library rebuilt on change, and the scripted Messages API on
                        #   :5177 its built-in agent talks to
pnpm dev:gallery        # tools/ui-gallery: the @repo/ui gallery alone, at localhost:5175 (never deployed)
pnpm dev:extension      # apps/extension: WXT's dev loop, rebuilding and reloading on change; it connects from pnpm dev:web's Worker
pnpm package:desktop    # The macOS arm64 .app and dmg, signed + notarized when the keys are present
pnpm package:extension  # The Web Store zip (wxt zip, checked) and the unpacked store build, under apps/extension/.output
pnpm smoke:desktop      # Package the .app, check its bundle and signature, launch it to its page, SIGTERM (macOS only)
pnpm testflight:mobile  # The phone: EAS builds it for iOS and submits it to TestFlight (owner; docs/releasing.md)
pnpm hotfix:mobile      # A JS-only fix to the phone builds already out, as an EAS Update
pnpm build              # Build all
pnpm typecheck          # Type check all
pnpm turbo run //#lint  # Lint all   (oxlint, type-aware), after the generate tasks whose types it reads
pnpm format:fix         # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify             # The static gate (CI adds the e2e suite on top)
pnpm e2e                # The scenario suite (one mode — the SPA is a static build)
```

## Running

`pnpm dev` runs `tauri dev` over the page's last build, with no dev server of
its own (`--no-dev-server`) and the local policy
(`apps/desktop/src-tauri/tauri.local.conf.json`, which lets the page call this
machine alone): the Rust shell compiled and launched on its own page at
`tauri://localhost/library/`, calling the Worker `pnpm dev:web` serves on
`localhost:5174`, or the loopback origin `INTELIGIR_CLOUD_ORIGIN` names, the one
variable a debug shell reads (`apps/desktop/src-tauri/src/cloud.rs`) and the one
its turbo task passes through strict env mode (`apps/desktop/turbo.json`). Its
first run is a sign-in with an account of that Worker (`AGENTS.md` § There is
no seeded login). An edit to the shell's Rust rebuilds and relaunches it; an
edit to the page reaches the window once `pnpm --filter @repo/workspace build`
has run and the shell relaunches.

Iterating on the PAGE needs no Rust: `pnpm dev:web` rebuilds `@repo/workspace`
as it changes (`vite build --watch`) and the local Worker serves that build at
`localhost:5174/library`, through the same route and policy a deploy runs
(`apps/web/src/worker/library/library-page.ts`); sign in at `/app/sign-in` and
reload the tab after an edit. Whatever needs the shell (the updater, the
replica on disk, the Keychain) draws nothing in a tab.

`pnpm package:desktop` builds the .app around the page's build, with nothing else to run inside it, signed when the keychain holds a
Developer ID and notarized when `.release/` is present (`apps/desktop/README.md`
§ Packaging).

`pnpm dev:web` runs the site and the whole cloud — `/api/auth/*`, `/v1` with
the apps' sign-in, every library cell and the account's socket, each
conversation with the built-in agent, the fill queue, the connector and the
library's page at `/library` — over a local D1 file, R2, a queue, KV and
miniflare's Durable Objects. Sign-up is invite-only and there is no seeded account — `AGENTS.md`
§ "There is no seeded login" has the exact commands.

The site's per-page share cards under `apps/web/public/og/` are rendered,
never drawn by hand: `pnpm --filter @repo/web og:cards`
(`apps/web/scripts/og-cards.ts`) renders a 1200x630 card per page in
`apps/web/src/lib/page-meta.ts` in the site's own type and logo. It needs
Playwright's Chromium, and sits outside `pnpm verify` and the build.

The built-in agent's system prompt, `apps/web/src/worker/agent/agent-prompt.ts`,
is written, never edited by hand: `pnpm --filter @repo/web agent-prompt`
(`apps/web/scripts/agent-prompt.ts`) writes it from `@repo/agent-skills`, and
`tools/repo-guards` fails a tree whose module differs from what it would write
(`apps/web/README.md` § The built-in agent).

## Browser extension

`apps/extension` is the browser's Save: a Chromium extension that reads the
page you're on and saves it to your library over `/v1`, with a device
credential of its own (`apps/extension/README.md`). `pnpm dev:extension` runs
WXT's dev loop (`wxt`), which builds the extension into
`apps/extension/.output/chrome-mv3-dev`, rebuilds it on every change and
reloads it in the browser; load that folder once with Load unpacked on
`chrome://extensions` (Developer mode on). `pnpm --filter @repo/extension
build` writes the same flavor, without the dev server, to `.output/chrome-mv3`,
which the e2e loads. Its committed key gives the unpacked build the id
`EXTENSION_ID` (`packages/contract/src/cloud/extension/extension-identity.ts`),
the one extension origin the Worker answers CORS for.

THE DEV BUILD CONNECTS FROM `pnpm dev:web`'S WORKER: with `pnpm dev:web`
running, its welcome page's Connect your library opens
`http://localhost:5174/connect/extension`, which signs you in and hands the
extension its credential; any local Worker on `localhost`, on whatever port,
may connect it, which is how the e2e connects the dev build to the Worker it
boots (`tools/e2e/src/harness/extension-fixture.ts`). The store builds
(`pnpm package:extension`: the Web Store zip and
`.output/chrome-mv3-store-unpacked`, the same files with the key) connect from
`https://inteligir.com/connect/extension` alone.

## Where state lives

| What                                                 | Where                                                                             |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Site + cloud Worker (`pnpm dev:web`)                 | 5174 (pinned — `strictPort`)                                                      |
| UI gallery (`pnpm dev:gallery`)                      | 5175 (pinned — `strictPort`)                                                      |
| Scripted Messages API (`pnpm dev:web`)               | 5177 (pinned — `.dev.vars`' `ANTHROPIC_FAKE_URL` names it)                        |
| Extension dev server (`pnpm dev:extension`)          | 3000, or the first free port to 3010 (WXT's own probe)                            |
| The Mac app's replica and its staged files           | `~/Library/Application Support/com.inteligir.desktop/` (`library/`, `staged/`)    |
| The Mac app's fetched files                          | `~/Library/Caches/com.inteligir.desktop/files/`, the least read let go past 5 GB  |
| The Mac app's credential                             | the Keychain, service `com.inteligir.desktop`                                     |
| A debug shell's (`pnpm dev`), all three              | the same places under `com.inteligir.desktop.dev`, an app of its own              |
| The extension's credential and the saves it waits on | the browser's extension storage (`storage.local`), kept from the pages it scripts |
| Accounts, sessions, devices, invites, revoked grants | D1 (local file under `apps/web/.wrangler`)                                        |
| The library's files                                  | R2, `BLOBS` (same `.wrangler` dir)                                                |
| Library cells, their sockets and conversations       | Durable Objects (same `.wrangler` dir): items, filing rules, jobs                 |
| Connected assistants' clients, grants and tokens     | KV, `OAUTH_KV` (same `.wrangler` dir)                                             |

## Quality gates

```bash
pnpm format:fix && pnpm verify
```

`pnpm verify` is one turbo run of `typecheck`, `lint`, `knip`, `format`,
`test` and `build`, the step CI runs: `lint`, `knip` and oxfmt's half of
`format` are the root package's own tasks in `turbo.json`, beside the shell's
`cargo fmt` check. Its `build` bundles the phone too (`expo export --platform
ios`), so JavaScript Metro refuses fails here rather than on EAS. It is check-only on purpose — `format:fix` is a separate first
step, never folded in. Format before gates, commit after gates. Turbo carries
on past a failure to every task whose dependencies passed, so a red format
cannot hide test regressions behind it, and `TEST_CONCURRENCY` caps how many
tasks run at once (four by default), as it does for `pnpm test`. To run knip on its own, use `pnpm turbo run //#knip`: knip
reads the extension's program, which extends the `.wxt/tsconfig.json` its
`generate` task writes, so a bare `pnpm knip` on a fresh checkout sees none of
the extension's suites and calls the exports they use unused. Lint on its own
is `pnpm turbo run //#lint` for the same reason: its type-aware pass reads
every workspace's program, and the Worker's and the extension's take the Env
types and the `.wxt/tsconfig.json` their `generate` tasks write, so a bare
`pnpm lint` on a fresh checkout reads those two programs without them.

CI then runs a few more that `verify` cannot: it installs agent-browser
and the shell's WebDriver (`tauri-driver`, each pinned by hand, over
`webkitgtk-webdriver` from the runner's apt), and
runs the scenario suite under `xvfb-run`, since the desktop shell's scenarios
open a real window, in two lanes, half its four cores. ONE run, because there
is one build —
the workspace is a plain SPA served as files, so the suite drives the same
bytes and the same policy a user gets. So a green `verify` is not a green CI;
run `pnpm e2e` too before claiming one. A second job runs on macOS, where the
app ships: `pnpm test` again, since the shell's macOS code compiles and runs
only there, and `pnpm smoke:desktop` on an ad-hoc pack
(`INTELIGIR_PACK_UNSIGNED=1`). Each step CI adds on top of `pnpm verify`
carries the reason `verify` cannot run it as a comment beside it in
`.github/workflows/ci.yml`.

## Tests

Every workspace answers `pnpm --filter <name> test`; each suite's own file
header says what it pins, and `tools/repo-guards` holds the invariants that
span workspaces (the dep DAG, turbo's cache keys, dangling references, the
per-export orphan guard over `@repo/ui`).

End-to-end: `pnpm e2e` boots the built Worker under Miniflare, each scenario's
own with its state in a scratch dir, and drives it the way a person or an
assistant does: the library's tab in a headless browser, the browser extension
in Chromium, the phone's editor page and runtime, and the desktop shell itself,
over WebDriver on Linux. It is deliberately outside
`pnpm verify` — `tools/e2e/README.md` is the one-pager. It runs scenarios in
lanes, half the machine's cores and at most four at once, each printed whole
when it ends; `--lanes 1` runs them one at a time and streams every line, and
`--only <names>` runs just the ones a change touches.
