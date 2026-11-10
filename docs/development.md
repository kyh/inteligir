# Development guide

How to run, verify, and change inteligir — the ONE home for the commands, the
ports, where state lives and the gate; `README.md` and `AGENTS.md` link here
rather than restating them. `AGENTS.md` is the coding agents' root: the
premises, the quickstart and the index of the decisions, each workspace's
`CLAUDE.md` its own; `apps/web/README.md` has the Worker's routes, doors and
deploy, `packages/service/README.md` the cloud's code and its suites,
`packages/db/README.md` the schemas, and `docs/releasing.md` the release:
every step and check that is the owner's.

## Prerequisites

- Node 24, pnpm 12 (`corepack enable` reads the root `packageManager`)
- Rust through rustup: `apps/desktop/rust-toolchain.toml` pins the toolchain the
  desktop shell builds on, and the first `cargo` call installs it. On Linux,
  Tauri's prerequisites too (on Debian or Ubuntu: `build-essential`,
  `libxdo-dev`, `libssl-dev`, `libwebkit2gtk-4.1-dev`, `librsvg2-dev`; other
  distributions are in
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
pnpm dev                # The Mac app's window on the local Worker's library page (pnpm dev:web)
pnpm dev:desktop        # Alias of dev
pnpm dev:mobile         # apps/mobile: expo start, in a terminal (turbo refuses it piped or under CI;
                        #   pnpm --filter @repo/mobile dev runs it without one); a physical phone
                        #   needs `expo start --tunnel`, since the note editor's page needs a secure
                        #   context plain http over the network is not (apps/mobile/README.md § Dev)
pnpm dev:web            # apps/web: vite + miniflare on :5174 (pinned, strictPort), the site and
                        #   the library's page at /library off vite's dev server, and the scripted
                        #   Messages API on :5177 its built-in agent talks to
pnpm dev:gallery        # tools/ui-gallery: the @repo/ui gallery alone, at localhost:5175 (never deployed)
pnpm dev:extension      # apps/extension: WXT's dev loop, rebuilding and reloading on change; it connects from pnpm dev:web's Worker
pnpm package:desktop    # The macOS arm64 .app and dmg, signed + notarized when the keys are present
pnpm package:extension  # The Web Store zip (wxt zip, checked) and the unpacked store build, under apps/extension/.output
pnpm smoke:desktop      # Package the .app, check its bundle and signature, open it on a Worker this machine boots (macOS only)
pnpm testflight:mobile  # The phone: EAS builds it for iOS and submits it to TestFlight (owner; docs/releasing.md)
pnpm hotfix:mobile      # A JS-only fix to the phone builds already out, as an EAS Update
pnpm build              # Build all
pnpm typecheck          # Type check all
pnpm turbo run //#lint  # Lint all   (oxlint, type-aware), after the generate tasks whose types it reads
pnpm format:fix         # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify             # The static gate (CI adds the e2e suite on top)
pnpm e2e                # The scenario suite, over the built Worker
```

The databases' commands are `@repo/db`'s (`packages/db/README.md`), run
against the local Worker's files:

```bash
pnpm --filter @repo/db push                     # the D1 schema into pnpm dev:web's local D1
pnpm --filter @repo/db studio                   # browse it (mint an invite here)
pnpm --filter @repo/db generate:cell --name <x> # the next cell migration, from src/cell/schema.ts
pnpm --filter @repo/db generate:note --name <x> # the next note migration, from src/note/schema.ts
pnpm --filter @repo/db run --silent export      # the D1 schema's DDL, as the suites apply it
```

Never `push:remote` or `studio:remote`: both reach the PRODUCTION D1
(`AGENTS.md` § There is no seeded login).

## Running

`pnpm dev` runs `tauri dev --config src-tauri/tauri.local.conf.json`: the Rust
shell compiled and launched on its `devUrl`, `http://localhost:5174/library`,
the page `pnpm dev:web` serves, as an app of its own
(`com.inteligir.desktop.dev`). `INTELIGIR_CLOUD_ORIGIN`, a loopback origin
only, points any build at another Worker on this machine
(`apps/desktop/src-tauri/src/window.rs`). Its first run is the site's sign-in
with an account of that Worker (`AGENTS.md` § There is no seeded login). An
edit to the shell's Rust rebuilds and relaunches it; an edit to the page
reaches the window as `pnpm dev:web` serves it.

Iterating on the PAGE needs no Rust: `pnpm dev:web` serves the library at
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
library's page at `/library` — over a local D1 file, R2, a queue, KV and
miniflare's Durable Objects. Sign-up is invite-only and there is no seeded account — `AGENTS.md`
§ "There is no seeded login" has the exact commands.

From curl, a session is Better Auth's: sign in at `/api/auth/sign-in/email`
with `-c jar`, then call `/v1` as the phone does, `-b jar -H 'expo-origin:
inteligir://'` and the `x-inteligir-build` header, or as the extension does,
the jar's signed `better-auth.session_token` value as `Authorization: Bearer`.
A raw, unsigned token is refused.

The site's per-page share cards under `apps/web/public/og/` are rendered,
never drawn by hand: `pnpm --filter @repo/web og:cards`
(`apps/web/scripts/og-cards.ts`) renders a 1200x630 card per page in
`apps/web/src/lib/page-meta.ts` in the site's own type and logo. It needs
Playwright's Chromium, and sits outside `pnpm verify` and the build.

The built-in agent's system prompt, `packages/service/src/agent/agent-prompt.ts`,
is written, never edited by hand: `pnpm --filter @repo/service agent-prompt`
(`packages/service/scripts/agent-prompt.ts`) writes it from `@repo/agent-skills`, and
`tools/repo-guards` fails a tree whose module differs from what it would write
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
(`tools/e2e/src/harness/extension-fixture.ts`). The store builds
(`pnpm package:extension`: the Web Store zip and
`.output/chrome-mv3-store-unpacked`, the same files with the key) name
`https://inteligir.com/*` as their one host and save there alone.

## Where state lives

| What                                                                 | Where                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site + cloud Worker (`pnpm dev:web`)                                 | 5174 (pinned — `strictPort`)                                                                                                                                                            |
| UI gallery (`pnpm dev:gallery`)                                      | 5175 (pinned — `strictPort`)                                                                                                                                                            |
| Scripted Messages API (`pnpm dev:web`)                               | 5177 (pinned — `.dev.vars`' `ANTHROPIC_FAKE_URL` names it)                                                                                                                              |
| Extension dev server (`pnpm dev:extension`)                          | 3000, or the first free port to 3010 (WXT's own probe)                                                                                                                                  |
| The Mac app's WebKit store (the site's cookie, the page's prefs)     | `~/Library/WebKit/com.inteligir.desktop/` and `~/Library/HTTPStorages/com.inteligir.desktop/`; a debug shell's under `com.inteligir.desktop.dev`                                        |
| The extension's account (its email and site), the saves it waits on  | the browser's extension storage (`storage.local`), kept from the pages it scripts; the session is the site's cookie in the browser's own jar                                            |
| The iPhone's kept reads, the shares it waits on, its files           | expo-sqlite's key-value store, out of the iCloud backup; files in the purgeable `Paths.cache`; Better Auth's session cookie in the Keychain, this device only (`apps/mobile/CLAUDE.md`) |
| Accounts, sessions (every device's sign-in), invites, revoked grants | D1 (local file under `apps/web/.wrangler`)                                                                                                                                              |
| The library's files                                                  | R2, `BLOBS` (same `.wrangler` dir)                                                                                                                                                      |
| Library cells, their sockets and conversations                       | Durable Objects (same `.wrangler` dir): items, filing rules, jobs, each cell's tables migrated from `packages/db/src/cell/migrations` as it wakes                                       |
| Each item's note: its live document and the agent's turn log         | Durable Objects (same `.wrangler` dir), one per note opened: each note's tables migrated from `packages/db/src/note/migrations` as it wakes                                             |
| Each conversation with the built-in agent: its transcript and steps  | Durable Objects (same `.wrangler` dir), one per conversation: each conversation's tables migrated from `packages/db/src/thread/migrations` as it wakes                                  |
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
tasks run at once (four by default), as it does for `pnpm test`. To run knip on its own, use `pnpm turbo run //#knip`: knip
reads the extension's program, which extends the `.wxt/tsconfig.json` its
`generate` task writes, so a bare `pnpm knip` on a fresh checkout sees none of
the extension's suites and calls the exports they use unused. Lint on its own
is `pnpm turbo run //#lint` for the same reason: its type-aware pass reads
every workspace's program, and the Worker's, the service's and the extension's
take the Env types and the `.wxt/tsconfig.json` their `generate` tasks write,
so a bare `pnpm lint` on a fresh checkout reads those three programs without
them.

CI then runs a few more that `verify` cannot: it installs agent-browser
(pinned by hand) and runs the scenario suite, in two lanes, half its four
cores. ONE run, because there is one build: the library's page is a route of
the built Worker, so the suite drives the same bytes and the same document
policy a user gets. So a green `verify` is not a green CI;
run `pnpm e2e` too before claiming one. A second job runs on macOS, where the
app ships: `pnpm test` again, since the shell's macOS code compiles and runs
only there, and `pnpm smoke:desktop` on an ad-hoc pack
(`INTELIGIR_PACK_UNSIGNED=1`), its window opened on a Worker the smoke boots
on the runner. Each step CI adds on top of `pnpm verify`
carries the reason `verify` cannot run it as a comment beside it in
`.github/workflows/ci.yml`.

## Tests

Every workspace answers `pnpm --filter <name> test`; each suite's own file
header says what it pins, and `tools/repo-guards` holds the invariants that
span workspaces (the dep DAG, turbo's cache keys, dangling references, the
per-export orphan guard over `@repo/ui`). The cloud's suites are
`@repo/service`'s, inside workerd on its own never-deployed Worker, with the
model's pure suites under node (`packages/service/README.md` § Testing);
`@repo/web`'s are the site's under node and the library's under jsdom. A
suite that reads generated types (the Worker's, the service's and the
extension's) needs its workspace's `generate` first, which `turbo run` does.

End-to-end: `pnpm e2e` boots the built Worker under Miniflare, each scenario's
own with its state in a scratch dir, and drives it the way a person or an
assistant does: the library's tab in a headless browser, the browser extension
in Chromium, and the phone's runtime and its exported note page, loaded from
its file in a stand-in for the phone's web view. It is deliberately outside
`pnpm verify` — `tools/e2e/README.md` is the one-pager. It runs scenarios in
lanes, half the machine's cores and at most four at once, each printed whole
when it ends; `--lanes 1` runs them one at a time and streams every line, and
`--only <names>` runs just the ones a change touches.
