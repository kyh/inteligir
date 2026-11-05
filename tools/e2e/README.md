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
pnpm e2e --only vault-sync    # one scenario (comma-separated, repeatable)
pnpm e2e --lanes 1            # one scenario at a time, every line as it happens
pnpm e2e --keep               # keep the scratch dirs for post-mortem
pnpm e2e --list               # every scenario, in run order, and what it proves
pnpm e2e --no-skip            # every SKIP FAILS: for a provisioned browser and display
```

Before the first scenario the runner builds the CLI bundle and the workspace
UI it stages, through turbo (`--filter=inteligir`): a cache hit when nothing
changed, and never a stale `dist/` booted as if it were this checkout.

Scenarios run in lanes: `--lanes <n>` of them at once, by default half this
machine's cores and at most four, each started in registry order as a lane
frees. With more than one lane a scenario's lines are held and printed whole
when it ends, after a live `[name] started` line, so two lanes never
interleave; `--lanes 1` streams each line as it happens. A run that dies first
(a signal, a crash, a job's timeout) prints what each scenario still running
had written, under an `[name] INTERRUPTED` line. The summary lists
every scenario in registry order whatever finished first. A scenario that needs
something only one may hold at a time names it in `exclusive` and never runs
beside another holding it: today that is `desktop-shell`, the shell's window on
the run's one display, driven through WebKit's WebDriver. Everything else a
scenario touches is its own, which is what lets it share a run: its scratch
dir, ports reserved ephemerally and never handed to two lanes in one run
(`src/harness/ports.ts`), and browser sessions named for it. A build a scenario
makes through turbo (the Worker, the phone's editor page) runs once per run and
one at a time (`src/harness/turbo-build.ts`), because a second build would
rewrite the output a running Worker serves its assets from.

Every scenario runs under a deadline (`timeoutMs`, default 180s; a scenario
that builds or boots a Worker, or the desktop shell, declares more). A run
still going past it FAILS with its instances' output tails and is torn down,
so a hang costs one scenario, not the whole job. Time its build sat queued
behind another lane's moves the deadline out by as much, since the budget is
for the scenario's own build.

Deliberately OUTSIDE `pnpm verify`: the package typechecks/lints/formats in
the gate (it has a `typecheck` script and lives under the root oxlint/oxfmt
sweep), but its scenarios boot processes and a browser, so they run only via
`pnpm e2e`.

## What a scenario gets

Each scenario receives a context (`src/harness/scenario.ts`) that owns its
scratch dir and tears everything down afterwards:

- `boot({ name, mode?, vaultRemote?, extraEnv?, seedVault?, seedData? })` — a
  fresh instance. `mode` is `source` (the default: `bin/inteligir`, which runs
  `src/` under tsx in a checkout) or `built` (`dist/index.js` under
  `NODE_ENV=production`, what npm runs). Scratch `data/` + `vault/`
  siblings, empty vendor stores of its own (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
  named on the instance as `vendorDirs`, so no instance runs the agent, asks
  its sign-in or edits its connectors on the host's account), a
  reserved free port (bind races retry with a fresh port,
  bounded), health-gated on `/health` answering `{ok:true}`. Registered for
  teardown at SPAWN, before the health wait. `stop()` is the quit a supervisor
  sends: SIGTERM to the leader alone, so the server runs one ordered shutdown,
  the vault flush included (a SIGTERM to the whole group reaches a source-mode
  server through the bin and tsx more than once, and a second is its cue to
  leave before the flush), then the process group is polled to verified-dead
  (SIGTERM → SIGKILL → ESRCH) before its scratch is removed; Ctrl-C kills
  every live group. `extraEnv` may not touch harness-owned keys (paths, vendor stores,
  port, NODE_ENV, `GIT_*`) — collisions are refused loudly. `seedVault` writes fixture files
  before boot; the app's repo init commits them. A seeded vault exists before
  boot, so the bootstrap adds no starter notes. `seedData` does the same for
  the data dir — a device credential, so the instance boots already signed in.
- `bareRemote()` — a scratch bare git repo, returned as the `file://` URL for
  `INTELIGIR_VAULT_REMOTE` or `vault.setRemote`.
- `cloudWorker({ vars?, json? })` — the product Worker (apps/web), built through
  turbo once per run and booted from its `cf build` output under Miniflare
  (`src/harness/worker-host.ts`) on a scratch persist dir, its D1 carrying
  apps/web's own `db:export` schema plus one invite row; `vars` override
  cloudflare.config.ts's text bindings (a storage cap a scenario can fill), and
  `json` its JSON bindings (the built-in agent's allowance). Each Worker's
  built-in agent runs against its own scripted Messages API
  (`tools/messages-fake`), served in the runner's process on an ephemeral
  port and named to the Worker as `ANTHROPIC_FAKE_URL`, the tools its script
  names run by that Worker's own cell; its counters answer at
  `/__fake/stats`. Registered for teardown exactly like an instance.
- `instance.api` — the oRPC client over `@repo/contract/local`, carrying the device
  token this instance published in `<dataDir>/server.json`;
  `instance.vaultDir` / `dataDir` for on-disk assertions.
- `cloudLink(worker)` — a relay to a booted Worker on a port of its own, so a
  scenario can cut the cloud and restore it (`src/harness/cloud-link.ts`): a
  cut refuses every new connection and drops every open one, as a Mac that lost
  its network meets the cloud, and a restore listens on the same port again.
  Registered for teardown like an instance.
- `desktopShell({ cloudOrigin })` — the checkout's built Tauri shell
  (`pnpm turbo run build:shell --filter=@repo/desktop`, an unbundled debug
  build with the page inside it, which the runner makes before the first
  scenario when any selected one is `exclusive` on `desktop-shell`, outside
  every deadline), calling the cloud at `cloudOrigin`, a Worker's or a
  `cloudLink`'s. Launched by `tauri-driver` on the scenario's scratch `HOME`,
  which a second launch in the same scenario finds again, so a relaunch keeps
  the replica and the credential's stand-in. Its `window` is a WebDriver
  session over the shell's one window, `dataDir` is where the shell keeps the
  account's replica and staged files, `replicaFiles()` lists the replicas it
  holds (`replicaTitle` reads an item back off one), and `quit()` sends the
  shell the SIGTERM it quits on. Registered for teardown like an instance. It
  runs on Linux alone, and skips with no display (run the suite under
  `xvfb-run -a`), no `tauri-driver` or `WebKitWebDriver`, or no built shell.
- `browser(label)` — an agent-browser session registered for teardown like an
  instance, so a failed or abandoned scenario still closes it. It is callable
  with any agent-browser command, and `openLibrary(worker, { path?, ready? })`
  signs it in to a booted Worker through the site's own sign-in, which comes
  back to `/library`, and returns once the rail and `ready` mounted. It skips
  the scenario when no headless browser can launch (see CI).

Beside the context, `src/harness/` carries what the scenarios would otherwise
each re-spell: `pollUntil` (`poll.ts`), which returns the value it waited for
and fails with what the last read held; `untilThreadIdle`, `runTurn` and the
scripted driver's `agentNote` (`threads.ts`); `modChord` for the platform's
modifier key, `clickButtonIn`, `press`, `caretToEndOf` and `untilBodyHolds`
(`agent-browser.ts`); the library page's selectors (`selectors.ts`); the
library's tab over a booted Worker, with a device of the account to seed and
read the cell through `/v1` (`openLibraryTab` and `untilItemText`,
`library-tab.ts`); `gitIn` and `readOrNull`
(`exec.ts`); the bare `inteligir` on an agent shell's PATH
(`agent-shell-cli.ts`); the account's sign-up and device routes against a dev
Worker (`cloud-account.ts`); `NO_AUTO_SYNC` and the one strict sync pass,
`syncExpectClean` (`vault-sync.ts`); the owner's sign-in and a signed-in
instance's explicit sync against the hosted vault (`hosted-vault.ts`); the
phone's own runtime under node over its own database, signed in as the
owner, a second one standing in for another device, with a network a
scenario can take away (`phone-runtime.ts`); the page
server a save's fetch may read, on this machine's own network address
(`lan-fixture.ts`); the browser extension's door and its worker's save
(`native-host-fixture.ts`); and the PNG reader for what a frame or a thumbnail
draws (`png-pixels.ts`).

## Adding a scenario

1. `src/scenarios/<name>.ts` exporting a `Scenario` (`name`, `description`,
   `run(ctx)`, `timeoutMs` only when a green run can near the default, and
   `exclusive` when it holds something only one scenario may, such as the
   desktop shell); it shares a run with others in lanes, so it binds no fixed
   port and writes nothing outside its scratch dir;
   assert with `expect`/`expectEq`, bail with `skip(reason)` for a capability
   this environment/branch does not have yet. The `description` says what the
   scenario proves: it is what `pnpm e2e --list` prints and what the transcript
   heads the scenario with, so it is the one place a reader picks `--only`
   names from.
2. Register it in `SCENARIOS` in `src/run.ts` (a static import — knip reads
   reachability from there), at the place it should run.

Each feature issue lands with its scenario here.

## The env contract the harness drives

| var                          | effect                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `INTELIGIR_DATA_DIR`         | absolute data dir (SQLite + config.json)               |
| `INTELIGIR_VAULT_DIR`        | absolute vault dir; must be disjoint from the data dir |
| `INTELIGIR_PORT`             | exact port (env-configured ports are never probed)     |
| `INTELIGIR_VAULT_REMOTE`     | git remote URL pinned over the vault's own origin;     |
|                              | unset = that origin, else the signed-in account's      |
| `INTELIGIR_CLOUD_URL`        | the cloud origin; hosted-vault-sync points it at its   |
|                              | own scratch Miniflare Worker                           |
| `INTELIGIR_SYNC_INTERVAL_MS` | vault auto-sync cadence; `0` disables the loop AND the |
|                              | boot sync (the sync scenarios set it for determinism)  |
| `INTELIGIR_AGENT`            | `scripted` — the deterministic in-process driver the   |
|                              | local server's thread and action scenarios run against |
| `INTELIGIR_SLOW_READS`       | `<ms>:<vault path>` — every read of that path, and     |
|                              | everything under it, answers that late (an empty path  |
|                              | is the whole vault); slow-storage's stand-in for       |
|                              | storage that fetches or wakes                          |
| `INTELIGIR_DEBUG`            | the diagnostics debug-log reads off an instance's      |
|                              | stderr; unset on every other instance                  |

Instances run with every host `GIT_*` variable stripped, `GIT_CONFIG_GLOBAL`
/`GIT_CONFIG_SYSTEM` pinned to `/dev/null` and an explicit harness git
identity, so no commit or fixture depends on the host's git configuration —
the same env every git the harness itself runs gets. They also drop the host's
vendor credentials and executable overrides (`HOST_AGENT_ENV` in
`src/harness/exec.ts`), so the agent runs the bundled vendors over their empty
stores; a scenario that wants a fake vendor sets it in `extraEnv`.

## CI

Headless by construction: no interactive auth, no pinned ports, and no
accounts on any EXTERNAL service — hosted-vault-sync signs up a real account,
but against its own scratch Miniflare Worker (apps/web's build output, state
under the scenario's scratch dir; secrets are passed as text bindings, so no
`.dev.vars` is needed). The one setup step beyond `pnpm install` is the
browser binary every browser scenario needs: `pnpm add -g agent-browser@X.Y.Z &&
agent-browser install` (Linux: `--with-deps`), at the version
`.github/workflows/ci.yml` pins so a local run drives the browser CI drives.
The desktop shell opens a real window, so CI runs the suite under `xvfb-run -a`,
with WebKitGTK's WebDriver (`webkitgtk-webdriver`, `webkit2gtk-driver` before
Ubuntu 26.04) and `cargo install tauri-driver
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

A scenario whose save must read a page serves it from `lan-fixture.ts`, on the
first address of this machine that the guarded fetch reads from (private or
public space, by the guard's own `classifyAddress`); a machine with none, such
as a sandbox whose only address is in reserved space, skips that scenario at
the fixture's start with "no usable LAN address". It is the one way such a
scenario skips, and the guard is never widened for it: a CI runner's private
address runs them all.

The Worker is built through turbo by the first scenario that boots one, once
per run, rather than at suite start, because only the scenarios that boot a
Worker need it; its build carries the library's page, so a browser scenario
drives the page the Worker deploys.

CI runs the suite in two lanes (`--lanes 2`), half its four-core runner, the
same count a four-core machine's default gives, so a local default run is the
one CI runs.
