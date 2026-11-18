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
- `pnpm install` at the repo root (workspace-wide), then `pnpm bootstrap`
  (§ Running). Restart `pnpm dev:web` after editing `.env`: the dev server
  watches only `apps/web`'s own env files.

## Commands

```bash
pnpm dev                # The Mac app's window on pnpm dev:web's /library
pnpm dev:mobile         # apps/mobile: expo start, in a terminal (turbo refuses it piped or under CI;
                        #   pnpm --filter @repo/mobile dev runs it without one); a physical phone
                        #   needs `expo start --tunnel`, since the note editor needs a secure
                        #   context plain http over the network is not (apps/mobile/README.md § Dev)
pnpm bootstrap          # .env, local Postgres, its schema and the seeded login; safe to run again, --dry-run prints it
pnpm dev:web            # apps/web: next dev on :5174 (pinned), over the Postgres .env.local names
pnpm dev:extension      # apps/extension: WXT's dev loop, rebuilding and reloading on change; it connects to pnpm dev:web's app
pnpm package:desktop    # The Mac app's release: the .app and dmg, signed and notarized, and its update (owner; docs/releasing.md)
pnpm package:extension  # The Web Store zip (wxt zip, checked) and the unpacked store build, under apps/extension/.output
pnpm testflight:mobile  # The phone: EAS builds it for iOS and submits it to TestFlight (owner; docs/releasing.md)
pnpm build              # Build all
pnpm typecheck          # Type check all
pnpm turbo run //#lint  # Lint all   (oxlint, type-aware), after the generate tasks whose types it reads
pnpm format:fix         # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify             # The static gate (CI adds the e2e flows on top)
pnpm e2e                # The Playwright flows, over the app's build and the extension's dev build
pnpm smoke              # The runtime legs a deployment passes, against the app on :5174 (SMOKE_URL for another)
```

The databases' commands are `@repo/db`'s (`packages/db/README.md`). Postgres
runs on its own, with no app server:

```bash
pnpm db:start                                   # local Postgres 17 on 54622 (Supabase's native runtime), its URL into .env.local
pnpm db:push                                    # sql/extensions.sql, then the Postgres schema, after an edit to it
pnpm --filter @repo/db push:check               # a second push plans nothing, as CI asks
pnpm --filter @repo/db studio                   # browse local Postgres (Drizzle Studio)
pnpm --filter @repo/db stop                     # stop it; `status` says whether it runs
pnpm db:seed                                    # the dev account and DEV-INVITE, into the pushed database; safe to run again
```

A suite under `dbSuite` (`@repo/db/test-database`) runs only with
`TEST_POSTGRES_URL` set, on a server that names: the run pushes the schema once
into a template there and gives each suite file a clone of it, all named
`<the URL's database>__…` and dropped as the run ends, so each worktree names
its own (`postgres://postgres:postgres@127.0.0.1:54622/wt_<name>`).

Never `pnpm db:push-remote` (`@repo/db`'s `push:remote`): it pushes the
PRODUCTION Postgres (`AGENTS.md` § Seeded login).

## Running

`pnpm bootstrap` (`scripts/bootstrap.ts`) takes a fresh clone to a database the
app runs on, with no server running: it writes `.env` from `.env.example` with a
fresh `BETTER_AUTH_SECRET` when there is none, starts local Postgres
(`pnpm db:start`) unless one already answers where `POSTGRES_URL` points, then
runs `pnpm db:push` and `pnpm db:seed` (`AGENTS.md` § Seeded login). Worktrees
share the one local Postgres on 54622, so a second worktree's bootstrap reuses
the first's. Run again, it changes nothing already there; `--dry-run` prints
the steps and does none of them.

`pnpm dev:web` is `next dev` on 5174 over that database: the site, the account
pages, the library tab, `/api/auth/*`, `/api/sign-up`, `/v1/rpc`, the connector
at `/connector` and `/api/health`. The built-in agent is not served on Next
yet. `pnpm build` then
`pnpm --filter @repo/web start` serves the production build on the same port.

`pnpm smoke` (`scripts/smoke.ts`) checks a running app as a deployment must
pass: `/api/health`, the home page's static policy, `/privacy`, `/library`'s
307 to sign in, a 426 below the build floor, and a signed-in call through the
extension's door and the phone's. Locally it signs in as the seeded login; with
`SMOKE_URL` it checks that deployment, signed in only with `SMOKE_EMAIL` and
`SMOKE_PASSWORD`, and `VERCEL_AUTOMATION_BYPASS_SECRET` carries it past the
deployment's protection. A leg whose route has not landed prints what it waits
for.

`pnpm dev` runs `tauri dev --config src-tauri/tauri.local.conf.json`: the Rust
shell compiled and launched on its `devUrl`, `http://localhost:5174/library`,
as an app of its own (`com.inteligir.desktop.dev`). An app on another port is
one more config for Tauri to merge:
`pnpm --filter @repo/desktop dev --config '{"build":{"devUrl":"http://localhost:<port>/library"}}'`.
Its first run is the site's sign-in with an account of that database
(`AGENTS.md` § Seeded login). An edit to the shell's Rust rebuilds and
relaunches it. Only the updater needs the shell; a tab's Settings says updates
come with the Mac app.

`pnpm package:desktop` is the owner's release of the .app, the shell alone
around the site's URL, and fails without the release's keys;
`pnpm --filter @repo/desktop tauri build` builds one for this Mac
(`apps/desktop/README.md` § Packaging).

From curl, a session is Better Auth's: sign in at `/api/auth/sign-in/email`
with `-c jar`, then call `/v1` as the phone does, `-b jar -H 'expo-origin:
inteligir://'` and the `x-inteligir-build` header, or as the extension does,
the jar's signed `better-auth.session_token` value as `Authorization: Bearer`.
A raw, unsigned token is refused, and a build below `MIN_CLIENT_BUILD` (0.7.0
unless `.env` names one) answers 426:

```sh
curl -s -b jar -X POST localhost:5174/v1/rpc/account/devices/list \
  -H 'content-type: application/json' -H 'expo-origin: inteligir://' \
  -H 'x-inteligir-build: 0.7.0+mobile' -d '{"json":{}}'
```

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
opens `http://localhost:5174/app/sign-in`, and signing in there is the whole of
it. A dev build saves to a local Worker on another port once its storage names
it, `chrome.storage.local.set({ "cloud-origin": "http://localhost:<port>" })`
in the welcome page's console, which is how the e2e points the dev build at the
Worker it boots (`tools/e2e/src/extension.spec.ts`). The store builds
(`pnpm package:extension`: the Web Store zip and
`.output/chrome-mv3-store-unpacked`, the same files with the key) name
`https://inteligir.com/*` as their one host and save there alone, whatever
their storage holds.

## Where state lives

| What                                                                 | Where                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app (`pnpm dev:web`, `pnpm --filter @repo/web start`)            | 5174 (pinned in `apps/web`'s scripts); each e2e worker's `next start` on a free port                                                                                                    |
| Extension dev server (`pnpm dev:extension`)                          | 3000, or the first free port to 3010 (WXT's own probe)                                                                                                                                  |
| The Mac app's WebKit store (the site's cookie, the tab's prefs)      | `~/Library/WebKit/com.inteligir.desktop/` and `~/Library/HTTPStorages/com.inteligir.desktop/`; a debug shell's under `com.inteligir.desktop.dev`                                        |
| The extension's account (email, its cookie's SHA-256), waiting saves | the browser's extension storage (`storage.local`), kept from the pages it scripts; the session is the site's cookie in the browser's own jar                                            |
| The iPhone's kept reads, the shares it waits on, its files           | expo-sqlite's key-value store, out of the iCloud backup; files in the purgeable `Paths.cache`; Better Auth's session cookie in the Keychain, this device only (`apps/mobile/CLAUDE.md`) |
| Local Postgres (`pnpm db:start`)                                     | 54622, its transaction pooler 54629; its files in the Supabase CLI's own store, `~/.supabase/stacks`                                                                                    |
| Accounts, sessions (every device's sign-in), invites                 | Local Postgres's `postgres` database; the suites' and the e2e's throwaway databases beside it (`wt_<name>__…`, `e2e_<run>…`)                                                            |
| The library's files                                                  | R2, `BLOBS` (same `.wrangler` dir)                                                                                                                                                      |
| Library cells, their sockets and conversations                       | Durable Objects (same `.wrangler` dir): items, filing rules, jobs, each cell's tables made from `packages/db/src/cell/ddl.sql` as it wakes                                              |
| Each item's note: its live document and the agent's turn log         | Durable Objects (same `.wrangler` dir), one per note opened: each note's tables made from `packages/db/src/note/ddl.sql` as it wakes                                                    |
| Each conversation with the built-in agent: its transcript and steps  | Durable Objects (same `.wrangler` dir), one per conversation: each conversation's tables made from `packages/db/src/thread/ddl.sql` as it wakes                                         |
| Connected assistants' clients, grants and tokens                     | KV, `OAUTH_KV` (same `.wrangler` dir)                                                                                                                                                   |

## Quality gates

```bash
pnpm format:fix && pnpm verify
```

`pnpm verify` is `tsc` over the root's own `scripts/`, then one turbo run of
`typecheck`, `lint`, `knip`, `format`, `test` and `build`, the step CI runs: `lint`, `knip` and oxfmt's half of
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
the shell's test, typecheck and format alone, since its macOS code compiles
and runs only there. Each step CI adds on top of
`pnpm verify` carries the reason `verify` cannot run it as a comment beside it
in `.github/workflows/ci.yml`.

## Tests

Every workspace answers `pnpm --filter <name> test`; each suite's own file
header says what it pins, and `tools/repo-guards` holds the one rule that
spans workspaces and no tool checks: product words. The cloud's suites are
`@repo/service`'s, under node, a database suite on its own clone of a pushed
template once `TEST_POSTGRES_URL` names a server (`packages/service/README.md`
§ Testing); `@repo/web`'s are the site's under node and the library tab's under
jsdom. A suite that reads generated types (the extension's) needs its
workspace's `generate` first, which `turbo run` does.

End-to-end: `pnpm e2e` is Playwright Test over apps/web's build and the
extension's dev build, which turbo builds first (`tools/e2e/turbo.json`). Its
globalSetup pushes the schema once into a template database on the server
`POSTGRES_URL` names; each Playwright worker runs one `next start` over its own
clone, on a fixed set of variables and nothing of `.env`, and each test signs up
an account by invite (`tools/e2e/src/fixtures.ts`). It is deliberately outside
`pnpm verify` — `tools/e2e/README.md` is the one-pager. `pnpm e2e -- <file>`
runs one spec and `pnpm e2e -- -g <name>` the tests whose title matches;
retries are 0, since a flaky flow is a bug.
