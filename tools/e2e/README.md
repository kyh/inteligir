# @repo/e2e — the end-to-end suite

Boots REAL servers (`inteligir serve`, the same binary a packaged install
runs) on scratch instance dirs, drives them over the typed oRPC client and a
headless browser, and asserts on the wire AND on disk. It is orchestration
plus plain assertions on purpose — no test framework; the runner exits
non-zero on any failure with a readable transcript.

ONE mode: the workspace is a plain SPA, built once and served as files, so the
suite drives the same bytes and the same policy a user gets.

## Run it

```sh
pnpm e2e                      # every scenario (the runner builds the CLI first)
pnpm e2e --only debug-log     # one scenario (comma-separated, repeatable)
pnpm e2e --keep               # keep the scratch dirs for post-mortem
pnpm e2e --list               # names + descriptions
pnpm e2e --no-skip            # every SKIP FAILS: for a provisioned browser and display
```

Before the first scenario the runner builds the CLI bundle and the workspace
UI it stages, through turbo (`--filter=inteligir`): a cache hit when nothing
changed, and never a stale `dist/` booted as if it were this checkout.

Every scenario runs under a deadline (`timeoutMs`, default 180s; a scenario
that builds or boots a Worker, or the desktop shell, declares more). A run
still going past it FAILS with its instances' output tails and is torn down,
so a hang costs one scenario, not the whole job.

Deliberately OUTSIDE `pnpm verify`: the package typechecks/lints/formats in
the gate (it has a `typecheck` script and lives under the root oxlint/oxfmt
sweep), but its scenarios boot processes and a browser, so they run only via
`pnpm e2e`.

## What a scenario gets

Each scenario receives a context (`src/harness/scenario.ts`) that owns its
scratch dir and tears everything down afterwards:

- `boot({ name, mode?, extraEnv?, seedData? })` — a fresh instance. `mode` is
  `source` (the default: `bin/inteligir`, which runs `src/` under tsx in a
  checkout) or `built` (`dist/index.js` under `NODE_ENV=production`, what npm
  and the .app run). A scratch `data/` dir, empty vendor stores of its own
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, named on the instance as `vendorDirs`, so
  nothing an instance starts reaches the host's account), a reserved free port
  (bind races retry with a fresh port, bounded), health-gated on `/health`
  answering `{ok:true}`. Registered for teardown at SPAWN, before the health
  wait, and torn down as a process group that is polled to verified-dead
  (SIGTERM → SIGKILL → ESRCH) before its scratch is removed; Ctrl-C kills every
  live group. `extraEnv` may not touch harness-owned keys (paths, vendor
  stores, port, NODE_ENV, `GIT_*`) — collisions are refused loudly. `seedData`
  writes into the data dir before boot — a device credential, so the instance
  boots already signed in.
- `cloudWorker({ vars? })` — the product Worker (apps/web), built through turbo
  and booted from its `cf build` output under Miniflare
  (`src/harness/worker-host.ts`) on a scratch persist dir, its D1 carrying
  apps/web's own `db:export` schema plus one invite row; `vars` override
  cloudflare.config.ts's text bindings. Registered for teardown exactly like
  an instance.
- `instance.api` — the oRPC client over `@repo/contract/local`, carrying the
  device token this instance published in `<dataDir>/server.json`;
  `instance.dataDir` for on-disk assertions.
- `desktopShell({ seedOwnDir? })` — the checkout's built Tauri shell
  (`pnpm turbo run build:shell --filter=@repo/desktop`, an unbundled debug
  build the runner makes before the first scenario that asks, outside every
  deadline). Launched by `tauri-driver` on a scratch `HOME` (never
  `INTELIGIR_DATA_DIR`, so the data dir is the one a home derives, as the
  shell's CLI door derives it), a pinned server port and
  `INTELIGIR_AGENT=scripted`. Its `window` is a WebDriver session over the
  shell's first window: Tauri hands WebKit's automation the first web view it
  makes. `api` is the oRPC client over the server it runs; `target()` is the
  data dir it resolves; `ownDir` is the shell's own folder (its debug choice);
  `serverLog()` reads the server's log, where the shell notes each window it
  loads; `quit()` sends the shell the SIGTERM it quits on. Registered for
  teardown like an instance. It runs on Linux alone, and skips with no display
  (run the suite under `xvfb-run -a`), no `tauri-driver` or `WebKitWebDriver`,
  or no built shell.
- `browser(label)` — an agent-browser session registered for teardown like an
  instance, so a failed or abandoned scenario still closes it. It is callable
  with any agent-browser command, and `openWorkspace(app, { path? })`
  signs it in through a fresh handoff and returns once the rail mounted. It skips the scenario when no headless browser can launch (see CI).

Beside the context, `src/harness/` carries what the scenarios would otherwise
each re-spell: `pollUntil` (`poll.ts`), which returns the value it waited for
and fails with what the last read held; `untilThreadIdle` (`threads.ts`);
`modChord` for the platform's modifier key, `clickButtonIn` and
`untilBodyHolds` (`agent-browser.ts`); the workspace and Settings selectors
(`selectors.ts`); and the account's sign-up, device routes and the owner's
sign-in against a dev Worker, with `PHONE_NAME`, the device a scenario's
second login plays the phone as (`cloud-account.ts`).

## The scenarios

`pnpm e2e --list` prints this table from the registry itself; what follows is
what each one is FOR.

| name                       | proves                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| thread-sync-hosted         | a thread sent on A reaches B through a Miniflare Worker: B's real         |
|                            | socket opens, and B holds A's timeline before its poll timer could run,   |
|                            | so the Durable Object's ping is what delivered it                         |
| phone-dispatch-hosted      | a second login plays the phone: its request waits with no desktop online  |
|                            | until A signs in and runs it, the reply answering it and the phone's pull |
|                            | holding the request; with A and B both listening, exactly one runs the    |
|                            | next, before a poll could; a Mac that stops taking the phone's requests   |
|                            | is no longer counted                                                      |
| account-hosted             | an account created in the app (`cloud.signUp`) against a Miniflare        |
|                            | Worker signs that instance in as it; the invite is spent, so a second     |
|                            | sign-up with it is FORBIDDEN; a second instance signs in with the same    |
|                            | email and password                                                        |
| onboarding-account-browser | `/welcome`'s account step against a Miniflare Worker opens on Create;     |
|                            | an account made there with the invite code signs the instance in, and     |
|                            | the page moves on by itself to the workspace                              |
| built-worker-boot          | the built bundle — what `cf deploy` ships — boots under Miniflare and     |
|                            | answers; built through turbo on every run, so it is the                   |
|                            | current source, and the one place a module-scope crash of the emitted     |
|                            | module can show                                                           |
| built-cli-boot             | the esbuild bundle — what npm and the .app run — boots in production      |
|                            | mode, serves `dist/ui`'s shell byte for byte, lists a thread over its     |
|                            | migrated database, and answers a client verb run from the same split      |
|                            | bundle                                                                    |
| desktop-shell              | the built Tauri shell over WebDriver: the window is the server's own page |
|                            | signed in by its handoff, an action the API creates reaches the rail      |
|                            | through the socket, `window.open` is denied, every permission request is  |
|                            | refused, and a SIGTERM quit stops the server and retracts `server.json`   |
| desktop-diagnostics        | the shell's debug-logging choice, seeded in its own folder, reaches the   |
|                            | server it starts, whose output always lands in the data dir's             |
|                            | `logs/server.log`: off, the boot line and no trace; on, the shell says it |
|                            | started its server tracing, and turning it off over the bridge asks for a |
|                            | restart                                                                   |
| threads-scripted           | a turn through the scripted driver: send, settle, and the timeline        |
|                            | holding the message and the driver's answer                               |
| debug-log                  | a namespace no build traces refuses the boot; `INTELIGIR_DEBUG=sync`      |
|                            | traces each step of a signed-in instance's passes against a Miniflare     |
|                            | Worker, never a message's words or a credential; an instance without it   |
|                            | writes no debug line                                                      |
| browser-smoke              | headless page load: the REAL policy on the served document, SPA mount,    |
|                            | API reached, the palette chord safe, clean console after a settle window  |
| os-dictation-browser       | words the OS dictates (CDP's `Input.insertText`, the IME-style commit     |
|                            | macOS dictation makes) and words typed after them land in order and       |
|                            | once in the ⌘K composer's field, sending nothing                          |
| settings-browser           | /settings hosts the window-level surfaces: the Account section says a     |
|                            | dead cloud's device list couldn't load, Delete account… holds its button  |
|                            | until a password is typed and shows the refusal, Sign out opens its       |
|                            | confirm dialog on that route; signed out, Create an account asks for an   |
|                            | invite code, and a sign-up the cloud cannot answer keeps what was typed   |

## Adding a scenario

1. `src/scenarios/<name>.ts` exporting a `Scenario` (`name`, `description`,
   `run(ctx)`, and `timeoutMs` only when a green run can near the default);
   assert with `expect`/`expectEq`, bail with `skip(reason)` for a capability
   this environment/branch does not have yet.
2. Register it in `SCENARIOS` in `src/run.ts` (a static import — knip reads
   reachability from there).
3. Give it a row in the table above, at its place in `SCENARIOS`;
   `tools/repo-guards/src/e2e-scenario-table.test.ts` fails until it has one.

Each feature issue lands with its scenario here.

## The env contract the harness drives

| var                   | effect                                               |
| --------------------- | ---------------------------------------------------- |
| `INTELIGIR_DATA_DIR`  | absolute data dir (SQLite + config.json)             |
| `INTELIGIR_PORT`      | exact port (env-configured ports are never probed)   |
| `INTELIGIR_CLOUD_URL` | the cloud origin; the hosted scenarios point it at   |
|                       | their own scratch Miniflare Worker                   |
| `INTELIGIR_AGENT`     | `scripted` — the deterministic in-process driver the |
|                       | thread scenarios run against                         |
| `INTELIGIR_DEBUG`     | the diagnostics debug-log reads off an instance's    |
|                       | stderr; unset on every other instance                |

Instances run with every host `GIT_*` variable stripped, `GIT_CONFIG_GLOBAL`
/`GIT_CONFIG_SYSTEM` pinned to `/dev/null` and an explicit harness git
identity, the same env every git the harness itself runs gets. They also drop
the host's vendor credentials and executable overrides (`HOST_AGENT_ENV` in
`src/harness/exec.ts`), so nothing an instance starts reaches the host's
account.

## CI

Headless by construction: no interactive auth, no pinned ports, and no
accounts on any EXTERNAL service — thread-sync-hosted signs up a real account,
but against its own scratch Miniflare Worker (apps/web's build output, state
under the scenario's scratch dir; secrets are passed as text bindings, so no
`.dev.vars` is needed). The one setup step beyond `pnpm install` is the
browser binary every browser scenario needs: `npm i -g agent-browser@X.Y.Z &&
agent-browser install` (Linux: `--with-deps`), at the version
`.github/workflows/ci.yml` pins so a local run drives the browser CI drives.
The desktop shell opens a real window, so CI runs the suite under `xvfb-run -a`,
with WebKitGTK's WebDriver (`webkit2gtk-driver`) and `cargo install tauri-driver
--version X.Y.Z --locked` beside it, at the version CI pins; with no display, no
driver or no built shell, the shell scenarios skip. The first browser a run asks for probes the
environment with `about:blank`, once per run and in a session of its own, so
every scenario's session still launches with its own flags. Only a failure THERE (the browser cannot launch at all)
reports SKIP, for that scenario and every browser scenario after it, with the
exact launcher error; opening the app and everything after is a real assertion.
A SKIP still exits 0, which is right on a machine with no browser or no display
and wrong on one provisioned for both: there a failed install or a missing
display passes as skipped scenarios behind a green step. So a run whose
environment was provisioned passes `--no-skip`, and every skip, the browser's
and the display's alike, becomes a FAIL carrying the reason it would have
skipped with.

The runner's suite-start build is what stages `apps/cli/dist/ui`; the harness
still refuses to boot without it, because a server with no workspace UI
answers the API and serves a 404 to the browser — a green API run beside a
page that never loads. built-worker-boot builds apps/web for itself, through
turbo, because the bundle it boots is the thing under test and no other
scenario needs it.
