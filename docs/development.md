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
pnpm dev                # THE PRODUCT — the Mac app's window over the local Worker (pnpm dev:web)
pnpm dev:desktop        # Alias of dev
pnpm dev:mobile         # apps/mobile: expo start, in a terminal (turbo refuses it piped or under CI;
                        #   pnpm --filter @repo/mobile dev runs it without one)
pnpm cli serve          # The local server ALONE, from source, no window
pnpm cli <verb>         # Every other verb, against this checkout's instance
pnpm dev:web            # apps/web: vite + miniflare on :5174 (pinned, strictPort), the library's
                        #   page at /library rebuilt on change, and the scripted Messages API on
                        #   :5177 its built-in agent talks to
pnpm dev:gallery        # tools/ui-gallery: the @repo/ui gallery alone, at localhost:5175 (never deployed)
pnpm dev:extension      # apps/extension: this checkout's browser door, then WXT's dev loop, rebuilding and reloading on change
pnpm package:cli        # The npm artifact (apps/cli) — `npx inteligir serve`
pnpm package:desktop    # The macOS arm64 .app and dmg, signed + notarized when the keys are present
pnpm package:extension  # The Web Store zip (wxt zip, checked) and the unpacked store build, under apps/extension/.output
pnpm smoke:cli          # Pack, install into a scratch prefix, boot, probe, stop
pnpm smoke:desktop      # Package the .app, check its bundle and signature, launch it to its page, SIGTERM (macOS only)
pnpm testflight:mobile  # The phone: EAS builds it for iOS and submits it to TestFlight (owner; docs/releasing.md)
pnpm hotfix:mobile      # A JS-only fix to the phone builds already out, as an EAS Update
pnpm build              # Build all
pnpm typecheck          # Type check all
pnpm lint               # Lint all   (oxlint)
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

Iterating on the local SERVER is `pnpm cli serve` in its own terminal: that
runs the TypeScript source under tsx.

The dev port and data dir are DERIVED PER CHECKOUT (sha256 of the checkout
root — `apps/cli/src/server/dev-instance.ts` is the whole scheme), so parallel
worktrees never share a database or collide on a socket; a busy derived port
is probed upward and the winner logged. The checkout is walked up to from
wherever the command started, so every `pnpm cli …`, from wherever you stand,
names the same instance. `INTELIGIR_PORT`
and `INTELIGIR_DATA_DIR` override; a dev data dir is marked with its checkout
path on first boot and refuses a different checkout thereafter.

When something "didn't update", `INTELIGIR_DEBUG` names what to trace,
comma-separated: `watcher`, `knowledge`, `sync`, `acp`
(`INTELIGIR_DEBUG=watcher,knowledge pnpm cli serve`). The server then writes each
decision those make to its stderr as a `[debug:<name>]` line, by path and id,
never by a note's content or a credential; an unknown name is refused at boot.
`inteligir guide` § Diagnostics is the user's copy, and
`apps/cli/src/server/debug-log.ts` says what each one traces.

The prod path is `pnpm package:cli`, which bundles the server and the CLI into
`apps/cli/dist`; `inteligir serve` then runs plain
`node` on port 4664. `pnpm package:desktop` builds the .app around the page's
build, with nothing else to run inside it, signed when the keychain holds a
Developer ID and notarized when `.release/` is present (`apps/desktop/README.md`
§ Packaging).

`pnpm dev:web` runs the site and the whole cloud — `/api/auth/*`, device
login, `/v1`, every library cell and the account's socket, the library's page
at `/library`, the hosted vault git remote — over a local D1 file and
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

`apps/extension` is the browser's Save: a Chromium extension that captures the
page and hands it to the app on the same machine through `inteligir
native-host`, which Chrome starts by the manifest a browser keeps for it
(`apps/extension/README.md`). `pnpm dev:extension` writes this checkout's door
once (`pnpm cli native-host --install`), then runs WXT's dev loop (`wxt`), which
builds the extension into `apps/extension/.output/chrome-mv3-dev`, rebuilds it
on every change and reloads it in the browser; load that folder once with Load
unpacked on `chrome://extensions` (Developer mode on). `pnpm --filter
@repo/extension build` writes the same flavor, without the dev server, to
`.output/chrome-mv3`, which the e2e loads. Its committed key gives the unpacked
build the id `EXTENSION_ID`
(`packages/contract/src/browser/extension-identity.ts`), the one origin the
door allows.

THE DEV BUILD DIALS `com.inteligir.desktop.dev`, the manifest `--install`
writes, whose launcher runs this checkout's `apps/cli/bin/inteligir
native-host` from the checkout, so it reaches this checkout's instance (a
`pnpm cli serve`). The store builds (`pnpm package:extension`:
the Web Store zip and `.output/chrome-mv3-store-unpacked`, the same files with
the key) dial `com.inteligir.desktop`, which nothing writes now: the Mac app
runs no server for a door to reach, so a store build saves through no app. `--install` writes a
manifest only where a browser's folder exists, so open the browser once first;
on Linux it writes Chrome's and Chromium's under `~/.config`. `--install` is
refused in the packaged mode, and the e2e's `browser-extension` scenario writes
its own door into a scratch profile
(`tools/e2e/src/harness/native-host-fixture.ts`).

## Where state lives

| What                                              | Where                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| The local server (`pnpm cli serve`)               | derived port 21000–28999 (hash of checkout root)                                 |
| An agent's preview server (`.claude/launch.json`) | 5176 (pinned — `INTELIGIR_PORT`, never probed)                                   |
| Site + cloud Worker (`pnpm dev:web`)              | 5174 (pinned — `strictPort`)                                                     |
| UI gallery (`pnpm dev:gallery`)                   | 5175 (pinned — `strictPort`)                                                     |
| Scripted Messages API (`pnpm dev:web`)            | 5177 (pinned — `.dev.vars`' `ANTHROPIC_FAKE_URL` names it)                       |
| Extension dev server (`pnpm dev:extension`)       | 3000, or the first free port to 3010 (WXT's own probe)                           |
| The vault selector, config.json                   | `~/.inteligir-dev/<hash>/data/` (prod: `~/.inteligir`)                           |
| Each vault's SQLite and sign-in                   | `<that dir>/vaults/<hash of its physical path>/`                                 |
| Agent and vault prefs                             | JSON files beside them (the app writes these)                                    |
| Connectors                                        | the agent's own: `~/.claude.json`, `~/.codex`                                    |
| The Mac app's replica and its staged files        | `~/Library/Application Support/com.inteligir.desktop/` (`library/`, `staged/`)   |
| The Mac app's fetched files                       | `~/Library/Caches/com.inteligir.desktop/files/`, the least read let go past 5 GB |
| The Mac app's credential                          | the Keychain, service `com.inteligir.desktop`                                    |
| A debug shell's (`pnpm dev`), all three           | the same places under `com.inteligir.desktop.dev`, an app of its own             |
| The fills a save still owes                       | the `pending_fills` table in that vault's `inteligir.db`                         |
| The grid's thumbnails                             | `<that vault's data dir>/thumbs/`, a cache pruned to 256 MiB                     |
| A Raindrop import's copy of its CSV and its job   | `<that vault's data dir>/imports/` (`job.json`), until the import ends           |
| The browsers' door                                | `native-host/` beside config.json: the launcher `native-host --install` writes   |
| Highlights and their notes                        | `.inteligir/annotations/<item id>.json` in the vault itself                      |
| The library's filing rules                        | `AGENTS.md` at the vault's root, which the agent reads                           |
| Accounts, sessions, devices, invites              | D1 (local file under `apps/web/.wrangler`)                                       |
| Library cells and their sockets, hosted vault     | Durable Objects (same `.wrangler` dir)                                           |
| Connected assistants' clients, grants and tokens  | KV, `OAUTH_KV` (same `.wrangler` dir)                                            |

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
tasks run at once (four by default), as it does for `pnpm test`.

CI then runs a few more that `verify` cannot: it installs agent-browser
and the shell's WebDriver (`tauri-driver`, each pinned by hand, over
`webkitgtk-webdriver` from the runner's apt), and
runs the scenario suite under `xvfb-run`, since the desktop shell's scenarios
open a real window, in two lanes, half its four cores. ONE run, because there
is one build —
the workspace is a plain SPA served as files, so the suite drives the same
bytes and the same policy a user gets. So a green `verify` is not a green CI;
run `pnpm e2e` too before claiming one. A second job runs on macOS, where the
app ships: `pnpm test` again, since APFS, FSEvents and a tmpdir behind a
symlink exist only there, and `pnpm smoke:desktop` on an ad-hoc pack
(`INTELIGIR_PACK_UNSIGNED=1`). Each step CI adds on top of `pnpm verify`
carries the reason `verify` cannot run it as a comment beside it in
`.github/workflows/ci.yml`.

## Tests

Every workspace answers `pnpm --filter <name> test`; each suite's own file
header says what it pins, and `tools/repo-guards` holds the invariants that
span workspaces (the dep DAG, ws change kinds, turbo's cache keys, dangling
references, the per-export orphan guard over `@repo/ui`).

End-to-end: `pnpm e2e` boots real app instances on scratch dirs (fixture
vaults, scratch git remotes, a headless browser, and the desktop shell itself,
driven over WebDriver on Linux) and is deliberately outside
`pnpm verify` — `tools/e2e/README.md` is the one-pager. It runs scenarios in
lanes, half the machine's cores and at most four at once, each printed whole
when it ends; `--lanes 1` runs them one at a time and streams every line, and
`--only <names>` runs just the ones a change touches.
