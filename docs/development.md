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
  request fails.

## Commands

```bash
pnpm dev                # THE PRODUCT — the shell over its own server
pnpm dev:desktop        # Alias of dev
pnpm dev:workspace      # The page alone in a browser tab, on this checkout's server; no Rust
pnpm dev:mobile         # apps/mobile: expo start
pnpm cli serve          # The server ALONE, from source, no window; a shell adopts it
pnpm cli <verb>         # Every other verb, against this checkout's instance
pnpm dev:web            # apps/web: vite + miniflare on :5174 (pinned, strictPort)
pnpm dev:gallery        # tools/ui-gallery: the @repo/ui gallery alone, at localhost:5175 (never deployed)
pnpm dev:extension      # apps/extension: this checkout's browser door, then the dev build rebuilt on change
pnpm package:cli        # The npm artifact (apps/cli) — `npx inteligir serve`
pnpm package:desktop    # The macOS arm64 .app and dmg, signed + notarized when the keys are present
pnpm package:extension  # The Web Store zip and the unpacked store build, under apps/extension/.output
pnpm smoke:cli          # Pack, install into a scratch prefix, boot, probe, stop
pnpm smoke:desktop      # Package the .app, launch it, drive its server and an agent turn, SIGTERM (macOS only)
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

`pnpm dev` runs `tauri dev`: the page's Vite dev server, the Rust shell
compiled and launched, and the CLI's bundle rebuilt first — because the shell
RUNS that bundle on your node, so a stale `dist/` would be a window on last
week's server. Its child boots the server: config → SQLite open + migrate →
Hono (the oRPC handler at /rpc, the /ws invalidation bus). No login. The window
loads the server's own origin, as a packaged one does, and that server answers
the page's files from Vite, so an edit reloads in place
(`apps/cli/src/server/ui-dev-server.ts`). An edit to the shell's Rust rebuilds
and relaunches it.

Iterating on the PAGE needs no Rust: `pnpm dev:workspace` starts the same Vite,
then this checkout's server from source with `INTELIGIR_UI_DEV_URL` naming it,
and opens a browser tab on that server, signed in through the same one-time
handoff (`apps/workspace/scripts/dev.ts`). A CSS edit reloads in place with no
cargo, and Ctrl+C stops both. Whatever needs the shell (the updater, the vault
switch, Reveal, printing, the diagnostics) draws nothing in a tab.

Iterating on the SERVER is `pnpm cli serve` in its own terminal: that runs the
TypeScript source under tsx, and a shell started afterwards ADOPTS it instead
of starting a second one.

The dev port and data dir are DERIVED PER CHECKOUT (sha256 of the checkout
root — `apps/cli/src/server/dev-instance.ts` is the whole scheme), so parallel
worktrees never share a database or collide on a socket; a busy derived port
is probed upward and the winner logged. The checkout is walked up to from
wherever the command started, so `pnpm dev` (from apps/desktop) and
`pnpm cli …` (from wherever you stand) name the same instance. `INTELIGIR_PORT`
and `INTELIGIR_DATA_DIR` override; a dev data dir is marked with its checkout
path on first boot and refuses a different checkout thereafter.

A checkout whose dev instance has no vault yet opens the shell on its FIRST
RUN, as a fresh install does: a page that asks for a new vault or an existing
folder before any server boots (`apps/desktop/README.md` § The first run is
decided before any server exists). Its proposed vault is the dev instance's
own `vault/` folder, so Create with the defaults never touches `~/Inteligir`.
`INTELIGIR_VAULT_DIR` or `INTELIGIR_DATA_DIR` skips it, as does a vault an
earlier `pnpm dev` or `pnpm cli serve` already made.

Every `INTELIGIR_*` variable that module declares works on `pnpm dev`, and
that is a fact `apps/desktop/turbo.json` has to keep: turbo runs in STRICT env
mode, so a variable its `dev` task does not name is stripped before the
process starts — silently, with no error to read, so
`INTELIGIR_AGENT=scripted pnpm dev` would simply boot the default agent. The
task list is held against the module's own declared set by
`tools/repo-guards/src/turbo-passthrough.test.ts`, so adding a variable to
`config.ts` fails the gate until the task names it.

When something "didn't update", `INTELIGIR_DEBUG` names what to trace,
comma-separated: `watcher`, `knowledge`, `sync`, `acp`
(`INTELIGIR_DEBUG=watcher,knowledge pnpm dev`). The server then writes each
decision those make to its stderr as a `[debug:<name>]` line, by path and id,
never by a note's content or a credential; an unknown name is refused at boot.
`inteligir guide` § Diagnostics is the user's copy, and
`apps/cli/src/server/debug-log.ts` says what each one traces.

A Finder-launched app has no env to set and no terminal to read, so the
desktop shell carries both halves itself. Settings › Advanced › Debug logging
is `diagnostics.json` in the shell's own folder, read before each start: on,
the server the shell starts next runs with every namespace (`serve --debug`
through the CLI's desktop entry), so a change asks for a restart; off, the
shell's own `INTELIGIR_DEBUG` still reaches the child. Whatever that child
prints, traced or not, is appended, stamped, to `<dataDir>/logs/server.log`,
which rotates at 5 MiB into one `server.log.1`
(`apps/desktop/src-tauri/src/server_log.rs`); Show log reveals it. A server the
shell adopted is not its child, so neither the switch nor the log reaches it.

The prod path is `pnpm package:cli`, which bundles the server, the CLI and the
staged workspace UI into `apps/cli/dist`; `inteligir serve` then runs plain
`node` on port 4664. `pnpm package:desktop` stages that same package with its
production dependencies as the .app's resource, beside the node it runs on and
the git a Mac without the developer tools runs (both fetched and pinned at
package time), signed when the keychain holds a Developer ID and notarized when
`.release/` is present (`apps/desktop/README.md` § Packaging).

`pnpm dev:web` runs the site and the whole cloud — `/api/auth/*`, thread sync,
the dispatch inbox, the hosted vault git remote — over a local D1 file and
miniflare's Durable Objects. Sign-up is invite-only and there is no seeded account — `AGENTS.md`
§ "There is no seeded login" has the exact commands.

## Browser extension

`apps/extension` is the browser's Save: a Chromium extension that captures the
page and hands it to the app on the same machine through `inteligir
native-host`, which Chrome starts by the manifest a browser keeps for it
(`apps/extension/README.md`). `pnpm dev:extension` writes this checkout's door
once (`pnpm cli native-host --install`), builds the extension into
`apps/extension/dist` and rebuilds it on every change; load that folder with
Load unpacked on `chrome://extensions` (Developer mode on), and reload it there
after a change to its worker. Its committed key gives the unpacked build the id
`EXTENSION_ID` (`packages/contract/src/browser/extension-identity.ts`), the one
origin the door allows.

THE DEV BUILD DIALS `com.inteligir.desktop.dev`, the manifest `--install`
writes, whose launcher runs this checkout's `apps/cli/bin/inteligir
native-host` from the checkout, so it reaches this checkout's instance (a
`pnpm cli serve` or `pnpm dev`). The store builds (`pnpm package:extension`:
the Web Store zip and `.output/unpacked`, the same files with the key) dial
`com.inteligir.desktop`, which the packaged app writes for every Chromium
browser at each launch (`apps/cli/src/desktop/native-hosts.ts`), so they reach
the installed app and never a checkout. `--install` writes a manifest only
where a browser's folder exists, so open the browser once first; on Linux it
writes Chrome's and Chromium's under `~/.config`. `--install` is refused in the
packaged mode, and the e2e's `browser-extension` scenario writes its own door
into a scratch profile (`tools/e2e/src/harness/native-host-fixture.ts`).

## Where state lives

| What                                              | Where                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| The product (`pnpm dev`)                          | derived port 21000–28999 (hash of checkout root)                                   |
| An agent's preview server (`.claude/launch.json`) | 5176 (pinned — `INTELIGIR_PORT`, never probed)                                     |
| The page's vite dev server                        | 31000 (pinned — `strictPort`; `tauri dev` waits)                                   |
| Site + cloud Worker (`pnpm dev:web`)              | 5174 (pinned — `strictPort`)                                                       |
| UI gallery (`pnpm dev:gallery`)                   | 5175 (pinned — `strictPort`)                                                       |
| The vault selector, config.json                   | `~/.inteligir-dev/<hash>/data/` (prod: `~/.inteligir`)                             |
| Each vault's SQLite and sign-in                   | `<that dir>/vaults/<hash of its physical path>/`                                   |
| Folders, agent, vault and phone-request prefs     | JSON files beside them (the app writes these)                                      |
| Connectors                                        | the agent's own: `~/.claude.json`, `~/.codex`                                      |
| The desktop's server log                          | `<data dir>/logs/server.log` (+ one `.1`)                                          |
| The desktop's own folder                          | `desktop/` beside config.json: recent vaults, the debug choice, Linux's web stores |
| The fills a save still owes                       | the `pending_fills` table in that vault's `inteligir.db`                           |
| The grid's thumbnails                             | `<that vault's data dir>/thumbs/`, a cache pruned to 256 MiB                       |
| A Raindrop import's copy of its CSV and its job   | `<that vault's data dir>/imports/` (`job.json`), until the import ends             |
| The browsers' door                                | `native-host/` beside config.json: the launcher the app writes at each boot        |
| Highlights and their notes                        | `.inteligir/annotations/<item id>.json` in the vault itself                        |
| The library's filing rules                        | `AGENTS.md` at the vault's root, which the agent reads                             |
| Accounts, sessions, devices, invites              | D1 (local file under `apps/web/.wrangler`)                                         |
| Thread log, dispatch inbox, hosted vault          | Durable Objects (same `.wrangler` dir)                                             |

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
`webkit2gtk-driver` from the runner's apt), and
runs the scenario suite under `xvfb-run`, since the desktop shell's scenarios
open a real window. ONE run, because there is one build —
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
`pnpm verify` — `tools/e2e/README.md` is the one-pager.
