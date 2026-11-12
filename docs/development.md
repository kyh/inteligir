# Development guide

How to run, verify and change inteligir: the one home for the commands, the
ports, where state lives and the gates beyond `AGENTS.md`'s quickstart, which
`README.md` and every workspace's README point here for. A workspace's README is
its own map, and `docs/releasing.md` every step that is the owner's.

## Prerequisites

- Node 24, pnpm 12 (`corepack enable` reads the root `packageManager`)
- Rust through rustup: `apps/desktop/rust-toolchain.toml` pins the toolchain the
  desktop shell builds on, and the first `cargo` call installs it. On Linux,
  Tauri's prerequisites too (on Debian or Ubuntu: `build-essential`,
  `libxdo-dev`, `libssl-dev`, `libwebkit2gtk-4.1-dev`, `librsvg2-dev`; other
  distributions are in
  <https://v2.tauri.app/start/prerequisites/>); a Mac ships its own WebKit
- `pnpm install` at the repo root (workspace-wide)
- For `dev:web` only: `cp .env.example .env`, which runs unedited. Restart
  `pnpm dev:web` after editing it: the dev server watches only `apps/web`'s own
  env files. The connector answers only `SITE_ORIGIN`'s host, `localhost:5174`
  here; `.env.example` says what to set to reach it through a tunnel.

## Commands

```bash
pnpm dev                # The Mac app's window on the local Worker's library tab (pnpm dev:web)
pnpm dev:mobile         # apps/mobile: expo start, in a terminal (turbo refuses it piped or under CI;
                        #   pnpm --filter @repo/mobile dev runs it without one); a physical phone
                        #   needs `expo start --tunnel`, since the note editor needs a secure
                        #   context plain http over the network is not (apps/mobile/README.md § Dev)
pnpm dev:web            # apps/web: vite + miniflare on :5174 (pinned, strictPort), the site and
                        #   the library tab at /library off vite's dev server, and the scripted
                        #   Messages API on :5177 its built-in agent talks to
pnpm dev:extension      # apps/extension: WXT's dev loop, rebuilding and reloading on change; it connects from pnpm dev:web's Worker
pnpm package:desktop    # The macOS arm64 .app and dmg, signed + notarized when the keys are present
pnpm package:extension  # The Web Store zip (wxt zip, checked) and the unpacked store build, under apps/extension/.output
pnpm testflight:mobile  # The phone: EAS builds it for iOS and submits it to TestFlight (owner; docs/releasing.md)
pnpm build              # Build all
pnpm typecheck          # Type check all
pnpm turbo run //#lint  # Lint all   (oxlint, type-aware), after the generate tasks whose types it reads
pnpm format:fix         # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify             # The static gate (CI adds the e2e flows on top)
pnpm e2e                # The Playwright flows, over the built Worker and the extension's dev build
```

The databases' commands are `@repo/db`'s (`packages/db/README.md`), run
against the local Worker's files:

```bash
pnpm --filter @repo/db push                     # the D1 schema into pnpm dev:web's local D1
pnpm --filter @repo/db studio                   # browse it (mint an invite here)
pnpm --filter @repo/db ddl                      # each object's ddl.sql, from its src/<object>/schema.ts
pnpm --filter @repo/db run --silent export      # the D1 schema's DDL, as the suites apply it
```

Never `push:remote` or `studio:remote`: both reach the PRODUCTION D1
(`AGENTS.md` § There is no seeded login).

## Running

`pnpm dev` runs `tauri dev --config src-tauri/tauri.local.conf.json`: the Rust
shell compiled and launched on its `devUrl`, `http://localhost:5174/library`,
the library tab `pnpm dev:web` serves, as an app of its own
(`com.inteligir.desktop.dev`). `INTELIGIR_CLOUD_ORIGIN`, a loopback origin
only, points any build at another Worker on this machine
(`apps/desktop/src-tauri/src/window.rs`). Its first run is the site's sign-in
with an account of that Worker (`AGENTS.md` § There is no seeded login). An
edit to the shell's Rust rebuilds and relaunches it; an edit to the library tab
reaches the window as `pnpm dev:web` serves it.

Iterating on the library tab needs no Rust: `pnpm dev:web` serves it at
`localhost:5174/library` as it serves the site, through the same route and
policy a deploy runs (`apps/web/src/routes/library.tsx`,
`apps/web/src/start.ts`); sign in at `/app/sign-in`. Only the updater needs the
shell; a tab's Settings says updates come with the Mac app.

`pnpm package:desktop` builds the .app, the shell alone, around the site's
URL, signed when the keychain holds a Developer ID and notarized when `.release/` is present (`apps/desktop/README.md`
§ Packaging).

`pnpm dev:web` runs the site and the whole cloud — `/api/auth/*`, every
device's sign-in, `/v1`, every library cell and the account's socket, each
conversation with the built-in agent, the fill queue, the connector and the
library tab at `/library` — over a local D1 file, R2, a queue, KV and
miniflare's Durable Objects. Sign-up is invite-only and there is no seeded account — `AGENTS.md`
§ "There is no seeded login" has the exact commands.

From curl, a session is Better Auth's: sign in at `/api/auth/sign-in/email`
with `-c jar`, then call `/v1` as the phone does, `-b jar -H 'expo-origin:
inteligir://'` and the `x-inteligir-build` header, or as the extension does,
the jar's signed `better-auth.session_token` value as `Authorization: Bearer`.
A raw, unsigned token is refused.

The built-in agent's system prompt is `@repo/agent-skills`'s files, which
`packages/service/src/agent/agent-prompt.ts` imports as text in the hub's
order; a new skill is a row there beside its row in the hub
(`packages/service/README.md` § The built-in agent).

## Browser extension

`apps/extension` is the browser's Save: a Chromium extension that reads the
page you're on and saves it to your library over `/v1`, under the browser's
own sign-in to the site (`apps/extension/README.md`). `pnpm dev:extension` runs
WXT's dev loop (`wxt`), which builds the extension into
`apps/extension/.output/chrome-mv3-dev`, rebuilds it on every change and
reloads it in the browser; load that folder once with Load unpacked on
`chrome://extensions` (Developer mode on). `pnpm --filter @repo/extension
build` writes the same flavor, without the dev server, to `.output/chrome-mv3`,
which the e2e loads. Its committed key gives the unpacked build the id
`EXTENSION_ID` (`packages/contract/src/extension/extension-identity.ts`),
the one extension origin the cloud's sign-in trusts.

THE DEV BUILD SAVES TO `pnpm dev:web`'S WORKER, AS WHOEVER IS SIGNED IN THERE:
it reads that browser's `better-auth.session_token` cookie for
`http://localhost:5174` (its host permission names `http://localhost/*`, any
port) and sends it as its bearer. Its welcome page's Sign in to Inteligir
opens `http://localhost:5174/connect/extension`, which signs you in; Connect
there tells the extension which site to save to, and nothing is handed over.
Any local Worker on `localhost`, on whatever port, may name itself that way,
which is how the e2e points the dev build at the Worker it boots
(`tools/e2e/src/extension.spec.ts`). The store builds
(`pnpm package:extension`: the Web Store zip and
`.output/chrome-mv3-store-unpacked`, the same files with the key) name
`https://inteligir.com/*` as their one host and save there alone.

## Where state lives

| What                                                                 | Where                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site + cloud Worker (`pnpm dev:web`)                                 | 5174 (pinned — `strictPort`)                                                                                                                                                            |
| Scripted Messages API (`pnpm dev:web`)                               | 5177 (pinned — `.env`'s `ANTHROPIC_FAKE_URL` names it)                                                                                                                                  |
| Extension dev server (`pnpm dev:extension`)                          | 3000, or the first free port to 3010 (WXT's own probe)                                                                                                                                  |
| The Mac app's WebKit store (the site's cookie, the tab's prefs)      | `~/Library/WebKit/com.inteligir.desktop/` and `~/Library/HTTPStorages/com.inteligir.desktop/`; a debug shell's under `com.inteligir.desktop.dev`                                        |
| The extension's account (its email and site), the saves it waits on  | the browser's extension storage (`storage.local`), kept from the pages it scripts; the session is the site's cookie in the browser's own jar                                            |
| The iPhone's kept reads, the shares it waits on, its files           | expo-sqlite's key-value store, out of the iCloud backup; files in the purgeable `Paths.cache`; Better Auth's session cookie in the Keychain, this device only (`apps/mobile/CLAUDE.md`) |
| Accounts, sessions (every device's sign-in), invites, revoked grants | D1 (local file under `apps/web/.wrangler`)                                                                                                                                              |
| The library's files                                                  | R2, `BLOBS` (same `.wrangler` dir)                                                                                                                                                      |
| Library cells, their sockets and conversations                       | Durable Objects (same `.wrangler` dir): items, filing rules, jobs, each cell's tables made from `packages/db/src/cell/ddl.sql` as it wakes                                              |
| Each item's note: its live document and the agent's turn log         | Durable Objects (same `.wrangler` dir), one per note opened: each note's tables made from `packages/db/src/note/ddl.sql` as it wakes                                                    |
| Each conversation with the built-in agent: its transcript and steps  | Durable Objects (same `.wrangler` dir), one per conversation: each conversation's tables made from `packages/db/src/thread/ddl.sql` as it wakes                                         |
| Connected assistants' clients, grants and tokens                     | KV, `OAUTH_KV` (same `.wrangler` dir)                                                                                                                                                   |

## Quality gates

```bash
pnpm format:fix && pnpm verify
```

`pnpm verify` is one turbo run of `typecheck`, `lint`, `knip`, `format`,
`test` and `build`, the step CI runs: `lint`, `knip` and oxfmt's half of
`format` are the root package's own tasks in `turbo.json`, beside the shell's
`cargo fmt` check. Its `build` bundles the phone too (`expo export --platform
ios`), its note editor's DOM bundle beside it (`apps/mobile/dist/www.bundle`),
so JavaScript Metro refuses fails here rather than on EAS. It is check-only on purpose — `format:fix` is a separate first
step, never folded in. Format before gates, commit after gates. Turbo carries
on past a failure to every task whose dependencies passed, so a red format
cannot hide test regressions behind it, and `TEST_CONCURRENCY` caps how many
tasks run at once (four by default), as it does for `pnpm test`.

knip runs once, over every workspace. On its own it is
`pnpm turbo run //#knip`: it reads the extension's program, which extends the
`.wxt/tsconfig.json` its `generate` task writes, so a bare `pnpm knip` on a
fresh checkout sees none of the extension's suites and calls the exports they
use unused. Lint, oxlint over ultracite's core, react, tanstack and anti-slop
presets, is `pnpm turbo run //#lint` on its own for the same reason: its
type-aware pass reads the Env types and the `.wxt/tsconfig.json` the
Worker's, the service's and the extension's `generate` tasks write.

CI then runs what `verify` cannot: it installs Playwright's Chromium
(`pnpm --filter @repo/e2e exec playwright install --with-deps --no-shell chromium`)
and runs `pnpm e2e`, two Playwright workers on its four cores, so a green
`verify` is not a green CI; run `pnpm e2e` too before claiming one. CI's
`verify` leaves the shell out: a second job runs on macOS, where the app ships,
`pnpm test` again and the shell's typecheck and format, since its macOS code
compiles and runs only there. Each step CI adds on top of
`pnpm verify` carries the reason `verify` cannot run it as a comment beside it
in `.github/workflows/ci.yml`.

## Tests

Every workspace answers `pnpm --filter <name> test`; each suite's own file
header says what it pins, and `tools/repo-guards` holds the four rules that
span workspaces and no tool checks: product words, compiled hook shapes, D1
uniques and remote media. The cloud's suites are
`@repo/service`'s, inside workerd on its own never-deployed Worker, with the
model's pure suites under node (`packages/service/README.md` § Testing);
`@repo/web`'s are the site's under node and the library tab's under jsdom. A
suite that reads generated types (the Worker's, the service's and the
extension's) needs its workspace's `generate` first, which `turbo run` does.

End-to-end: `pnpm e2e` is Playwright Test over apps/web's build output in an
in-process Miniflare and the extension's dev build, which turbo builds first
(`tools/e2e/turbo.json`). Each Playwright worker boots one Worker beside the
scripted Claude, and each test signs up an account by invite
(`tools/e2e/src/fixtures.ts`); it reads no `.env`. It is deliberately outside
`pnpm verify` — `tools/e2e/README.md` is the one-pager. `pnpm e2e -- <file>`
runs one spec and `pnpm e2e -- -g <name>` the tests whose title matches;
retries are 0, since a flaky flow is a bug.
