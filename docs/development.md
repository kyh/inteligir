# Development guide

How to run, verify and change inteligir: the one home for the commands, the
ports, where state lives and the gates beyond `AGENTS.md`'s quickstart, which
`README.md` and every workspace's README point here for. A workspace's README is
its own map, and `docs/releasing.md` every step that is the owner's.

## Prerequisites

- Node 24, pnpm 12 (`corepack enable` reads the root `packageManager`)
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
pnpm sign-in-code       # A fresh sign-in code for dev@inteligir.local (or the email given), mailing nothing
pnpm dev:extension      # apps/extension: WXT's dev loop, rebuilding and reloading on change; it connects to pnpm dev:web's app
pnpm package:desktop    # The Mac app's release: the .app and dmg, signed and notarized, and its update (owner; docs/releasing.md)
pnpm package:extension  # The Web Store zip (wxt zip, checked) and the unpacked store build, under apps/extension/.output
pnpm testflight:mobile  # The phone: EAS builds it for iOS and submits it to TestFlight (owner; docs/releasing.md)
pnpm build              # Build all
pnpm typecheck          # Type check all
pnpm turbo run //#lint  # Lint all   (oxlint, type-aware), after the generate tasks whose types it reads
pnpm format:fix         # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify             # The static gate (CI adds the smoke on next start on top)
pnpm smoke              # The runtime legs a deployment passes, against the app on :5174 (SMOKE_URL for another)
```

The databases' commands are `@repo/db`'s (`packages/db/README.md`). Postgres
runs on its own, with no app server:

```bash
pnpm db:start                                   # local Postgres 17 on 54622 (Supabase's native runtime), its URL into .env.local
pnpm db:push                                    # sql/extensions.sql, then the Postgres schema, after an edit to it
pnpm --filter @repo/db push:check               # a second push plans nothing, as CI asks
pnpm --filter @repo/db studio                   # browse local Postgres (Drizzle Studio)
pnpm --filter @repo/db status                   # whether Postgres answers where POSTGRES_URL points, from any worktree
pnpm --filter @repo/db stop                     # stop the local Postgres this checkout started
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
the first's, writing its URL into `.env.local` when no env file of its own names
one, as an `.env` copied from another checkout does not. Run again, it changes nothing already there; `--dry-run` prints
the steps and does none of them.

`pnpm dev:web` is `next dev` on 5174 over that database: the site, the account
pages, the library tab, `/api/auth/*`, `/api/sign-up`, `/v1/rpc`, the connector
at `/mcp`, `/api/health`, and the built-in agent under `/eve/v1`, for
which `next dev` starts eve's own server. `pnpm build` then
`pnpm --filter @repo/web start` serves the production build on the same port.

`pnpm smoke` (`scripts/smoke.ts`) checks a running app as a deployment must
pass: `/api/health`, the home page's static policy, `/privacy`, `/library`'s
307 to sign in, the agent's health, every cron route's 401 without
`CRON_SECRET`, a 426 below the build floor, a signed-in call through the
extension's door and the phone's, and a file of its own each run sent by
reserve, PUT and settle to whichever store the app keeps, then read back whole
and as `bytes=0-9` and `bytes=-1`. It signs in as the seeded login, on codes `pnpm sign-in-code` mints in the
local database, so with `SMOKE_URL` it checks only that deployment's signed-out
legs, `VERCEL_AUTOMATION_BYPASS_SECRET` carrying it past the deployment's
protection. On CI a leg that cannot run fails rather than skips.

`pnpm dev` runs `electron-vite dev --watch`: the Electron shell built and
launched on `http://localhost:5174/library`, as an app of its own ("Inteligir
(Dev)", with its own user data). Electron downloads its binary on first use,
from GitHub's releases. Its first run is the site's sign-in with an account of
that database (`AGENTS.md` § Seeded login). An edit to main or the preload
rebuilds and relaunches it. Only the updater needs the shell; a tab's Settings
says updates come with the Mac app.

`pnpm package:desktop` is the owner's release of the .app, the shell alone
around the site's URL, and fails without the release's keys
(`apps/desktop/README.md` § Packaging).

From curl, a session is Better Auth's: sign in at `/api/auth/sign-in/email-otp`
with `pnpm sign-in-code`'s code and `-c jar` (`AGENTS.md` § Seeded login), then call `/v1` as the phone does, `-b jar -H 'expo-origin:
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
build` writes the same flavor, without the dev server, to `.output/chrome-mv3`.
Its committed key gives the unpacked build the id
`EXTENSION_ID` (`packages/contract/src/extension/extension-identity.ts`).

THE DEV BUILD SAVES TO `pnpm dev:web`'S APP, AS WHOEVER IS SIGNED IN THERE:
it reads that browser's `better-auth.session_token` cookie for
`http://localhost:5174` (its host permission names `http://localhost/*`, any
port) and sends it as its bearer. Its welcome page's Sign in to Inteligir
opens `http://localhost:5174/app/sign-in`, and signing in there is the whole of
it. A dev build saves to a local app on another port once its storage names
it, `chrome.storage.local.set({ "cloud-origin": "http://localhost:<port>" })`
in the welcome page's console. The store builds
(`pnpm package:extension`: the Web Store zip and
`.output/chrome-mv3-store-unpacked`, the same files with the key) name
`https://www.inteligir.com/*` as their one host and save there alone, whatever
their storage holds.

## Where state lives

| What                                                                       | Where                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app (`pnpm dev:web`, `pnpm --filter @repo/web start`)                  | 5174 (pinned in `apps/web`'s scripts)                                                                                                                                                   |
| Extension dev server (`pnpm dev:extension`)                                | 3000, or the first free port to 3010 (WXT's own probe)                                                                                                                                  |
| The Mac app's WebKit store (the site's cookie, the tab's prefs)            | `~/Library/WebKit/com.inteligir.desktop/` and `~/Library/HTTPStorages/com.inteligir.desktop/`; a debug shell's under `com.inteligir.desktop.dev`                                        |
| The extension's account (email, its cookie's SHA-256), waiting saves       | the browser's extension storage (`storage.local`), kept from the pages it scripts; the session is the site's cookie in the browser's own jar                                            |
| The iPhone's kept reads, the shares it waits on, its files                 | expo-sqlite's key-value store, out of the iCloud backup; files in the purgeable `Paths.cache`; Better Auth's session cookie in the Keychain, this device only (`apps/mobile/CLAUDE.md`) |
| Local Postgres (`pnpm db:start`)                                           | 54622, its transaction pooler 54629; its files in the Supabase CLI's own store, `~/.supabase/stacks`                                                                                    |
| Accounts, sessions (every device's sign-in), invites                       | Local Postgres's `postgres` database; the suites' throwaway databases beside it (`wt_<name>__…`)                                                                                        |
| Every account's library: items, bodies, search, folders, jobs, change sets | Local Postgres's `postgres` database (`packages/db/src/library-schema.ts`)                                                                                                              |
| The built-in agent's threads, turns, events and spend                      | the same database (`packages/db/src/agent-schema.ts`); eve's own sessions, its build beside them, in `apps/web/.eve`                                                                    |
| Connected assistants' clients, consents and tokens                         | the same database, Better Auth's OAuth provider's tables (`packages/db/src/auth-schema.ts`)                                                                                             |
| The library's files                                                        | the folder `FILE_STORE_DIR` names, `.data/files` from the server's working folder (`apps/web/.data/files` under `pnpm dev:web`); Vercel Blob once `BLOB_READ_WRITE_TOKEN` is set        |

## Quality gates

```bash
pnpm format:fix && pnpm verify
```

`pnpm verify` is `tsc` over the root's own `scripts/`, then a turbo run of `lint` alone, then one
of `typecheck`, `knip`, `format`, `test` and `build`, the step CI runs: `lint`, `knip` and oxfmt's half of
`format` are the root package's own tasks in `turbo.json`. Lint runs first and alone because its
type-aware pass holds every workspace's program at once (about 4 GB): beside the site's and the
phone's builds it pushed a 16 GB, four-core machine out of memory and the kernel killed it. It costs
the half minute lint takes, and a red lint still lets the second run go on and fails `verify` after it;
`verify:affected` does the same. Its `build` bundles the phone too (`expo export --platform
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
use unused. Lint, oxlint over ultracite's core, react, anti-slop and landmines
presets, is `pnpm turbo run //#lint` on its own for the same reason: its
type-aware pass reads the site's route types and the extension's
`.wxt/tsconfig.json`, which their `generate` tasks write.

CI then runs what `verify` cannot: on the schema it pushed, it runs
`pnpm db:seed` twice, the second run having to find the dev account signing in
and `DEV-INVITE` there, so a Better Auth change that breaks a fresh clone's
first sign-in goes red; then it starts the build `verify` made on `next start`,
which serves eve's agent, here on the mock model, and runs `pnpm smoke` against it
signed in as that account, so a green `verify` is not a green CI. CI's
`verify` covers the shell too, under node. The Mac and Windows packs run on
GitHub only in `.github/workflows/desktop-release.yml`, unsigned, on a published
release and by hand (`gh workflow run desktop-release.yml --ref <branch>`),
never on a push or a PR: a macOS runner bills about ten times a Linux one and a
Windows runner twice. Each step CI adds on top of
`pnpm verify` carries the reason `verify` cannot run it as a comment beside it
in `.github/workflows/ci.yml`.

A push to main deploys production on Vercel, which holds the deployment off the
production domains until its Deployment Check passes: CI's `check`, which
runs `pnpm smoke` on `next start` (`docs/releasing.md` § Once per product: the
deployment's checks).

## Tests

Every workspace answers `pnpm --filter <name> test`; each suite's own file
header says what it pins, and `tools/repo-guards` holds the one rule that
spans workspaces and no tool checks: product words. The cloud's suites are
`@repo/service`'s, under node, a database suite on its own clone of a pushed
template once `TEST_POSTGRES_URL` names a server (`packages/service/README.md`
§ Testing); `@repo/web`'s are the site's under node and the library tab's under
jsdom. A suite that reads generated types (the extension's) needs its
workspace's `generate` first, which `turbo run` does.
