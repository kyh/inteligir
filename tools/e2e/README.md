# @repo/e2e — the end-to-end suite

Boots the REAL Worker (apps/web's `cf build` output under Miniflare), the
browser extension and the phone's own runtime on scratch dirs, drives them over
`/v1`, the connector and a headless browser, and asserts on the wire, in the cell and on disk. It is orchestration plus
plain assertions on purpose — no test framework; the runner exits non-zero on
any failure with a readable transcript.

## Run it

```sh
pnpm e2e                      # every scenario
pnpm e2e --only agent-cell    # one scenario (comma-separated, repeatable)
pnpm e2e --lanes 1            # one scenario at a time, every line as it happens
pnpm e2e --keep               # keep the scratch dirs for post-mortem
pnpm e2e --list               # every scenario, in run order, and what it proves
pnpm e2e --no-skip            # every SKIP FAILS: for a provisioned browser
```

The extension's scenarios need a browser that loads an unpacked extension:
Chrome for Testing does, branded Chrome ignores `--load-extension`. On a Mac
whose agent-browser finds branded Chrome, point it at a Chrome for Testing
binary with `AGENT_BROWSER_EXECUTABLE_PATH`.

Before the first scenario the runner builds the browser extension's dev build
through turbo (`--filter=@repo/extension`): a cache hit when nothing changed,
and never a stale output loaded as if it were this checkout.

Scenarios run in lanes: `--lanes <n>` of them at once, by default half this
machine's cores and at most four, each started in registry order as a lane
frees. With more than one lane a scenario's lines are held and printed whole
when it ends, after a live `[name] started` line, so two lanes never
interleave; `--lanes 1` streams each line as it happens. A run that dies first
(a signal, a crash, a job's timeout) prints what each scenario still running
had written, under an `[name] INTERRUPTED` line. The summary lists
every scenario in registry order whatever finished first. Everything a
scenario touches is its own, which is what lets it share a run: its scratch
dir, ports reserved ephemerally and never handed to two lanes in one run
(`src/harness/ports.ts`), and browser sessions named for it. A build a scenario
makes through turbo (the Worker, the phone's editor page) runs once per run and
one at a time (`src/harness/turbo-build.ts`), because a second build would
rewrite the output a running Worker serves its assets from.

Every scenario runs under a deadline (`timeoutMs`, default 180s; a scenario
that builds or boots a Worker declares more). A run
still going past it FAILS with its processes' output tails and is torn down,
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

- `cloudWorker({ vars?, json?, pages? })` — the product Worker (apps/web), built through
  turbo once per run and booted from its `cf build` output under Miniflare
  (`src/harness/worker-host.ts`) on a scratch persist dir, its D1 carrying
  `@repo/db`'s own `export` schema plus one invite row; `vars` override
  cloudflare.config.ts's text bindings (a storage cap a scenario can fill), and
  `json` its JSON bindings (the built-in agent's allowance). Each Worker's
  built-in agent runs against its own scripted Messages API
  (`tools/messages-fake`), served in the runner's process on an ephemeral
  port and named to the Worker as `ANTHROPIC_FAKE_URL`, the tools its script
  names run by that Worker's own cell; its counters answer at
  `/__fake/stats`. `pages` names public hosts whose pages a loopback server
  answers for the Worker's own fetch (`page-fixture.ts`). Registered for
  teardown with the scenario.
- `cloudLink(worker)` — a relay to a booted Worker on a port of its own, so a
  scenario can cut the cloud and restore it (`src/harness/cloud-link.ts`): a
  cut refuses every new connection and drops every open one, as a device that
  lost its network meets the cloud, and a restore listens on the same port
  again. Registered for teardown with the scenario.
- `browser(label)` — an agent-browser session registered for teardown with the
  scenario, so a failed or abandoned scenario still closes it. It is callable
  with any agent-browser command, and `openLibrary(worker, { path?, ready? })`
  signs it in to a booted Worker through the site's own sign-in, which comes
  back to `/library`, and returns once the rail and `ready` mounted. It skips
  the scenario when no headless browser can launch (see CI).

Beside the context, `src/harness/` carries what the scenarios would otherwise
each re-spell: `pollUntil` (`poll.ts`), which returns the value it waited for
and fails with what the last read held; `modChord` for the platform's
modifier key, `clickButtonIn`, `press`, `caretToEndOf` and `untilBodyHolds`
(`agent-browser.ts`); the library page's selectors (`selectors.ts`); the
library's tab over a booted Worker, with a session of the account to seed and
read the cell through `/v1` (`openLibraryTab` and `untilItemText`,
`library-tab.ts`); the account's sign-up and Better Auth sign-in against a dev
Worker (`cloud-account.ts`); `/v1` as a phone or the extension calls it, a file's upload and read and
an item's fields as the cell holds them (`v1-wire.ts`); the
phone's own runtime under node over its own database, signed in as the
owner through a plain fetch on Better Auth's routes (`expo-origin`, the
session cookie in a stand-in Keychain), since the Expo client loads in no node
process, a second one standing in for another device, with a network a
scenario can take away (`phone-runtime.ts`); the page
server a save's fetch reads, on loopback, which the Worker's fill reaches under
a public name of its own (`page-fixture.ts`); the browser extension's dev build, signed in on the
site in its own profile and pointed at the Worker by the connect page, and its worker's save (`extension-fixture.ts`); and the
one-colour PNG a scenario saves (`png-pixels.ts`). `pnpm --filter @repo/e2e serve-worker` boots one
Worker alone, as `cloudWorker` does, and prints its origin: the packaged Mac
app's smoke (`apps/desktop/scripts/smoke-packaged.ts`) opens its window on it.

## Adding a scenario

1. `src/scenarios/<name>.ts` exporting a `Scenario` (`name`, `description`,
   `run(ctx)`, and `timeoutMs` only when a green run can near the default); it
   shares a run with others in lanes, so it binds no fixed
   port and writes nothing outside its scratch dir;
   assert with `expect`/`expectEq`, bail with `skip(reason)` for a capability
   this environment/branch does not have yet. The `description` says what the
   scenario proves: it is what `pnpm e2e --list` prints and what the transcript
   heads the scenario with, so it is the one place a reader picks `--only`
   names from.
2. Register it in `SCENARIOS` in `src/run.ts` (a static import — knip reads
   reachability from there), at the place it should run.

Each feature issue lands with its scenario here.

## The env the harness drives

Every process the harness starts runs with every host `GIT_*` variable
stripped, since turbo hashes the checkout through git and a hook's `GIT_DIR`
would point it elsewhere (`src/harness/exec.ts`). The Worker's own settings ride as
Miniflare bindings over its config's (`cloudWorker({ vars, json, pages })`),
never as process env.

## CI

Headless by construction: no interactive auth, no pinned ports, and no
accounts on any EXTERNAL service — a scenario signs up a real account, but
against its own scratch Miniflare Worker (apps/web's build output, state
under the scenario's scratch dir; secrets are passed as text bindings, so no
`.dev.vars` is needed). The one setup step beyond `pnpm install` is the
browser binary every browser scenario needs: `pnpm add -g agent-browser@X.Y.Z &&
agent-browser install` (Linux: `--with-deps`), at the version
`.github/workflows/ci.yml` pins so a local run drives the browser CI drives.
The first browser a run asks for probes the
environment with `about:blank`, once per run and in a session of its own, so
every scenario's session still launches with its own flags. Only a failure THERE (the browser cannot launch at all)
reports SKIP, for that scenario and every browser scenario after it, with the
exact launcher error; opening the app and everything after is a real assertion.
A SKIP still exits 0, which is right on a machine with no browser and wrong on
one provisioned for it: there a failed install passes as skipped scenarios
behind a green step. So a run whose
environment was provisioned passes `--no-skip`, and every skip becomes a FAIL
carrying the reason it would have skipped with.

A scenario whose save must read a page serves it from `page-fixture.ts`, on
loopback. The Worker's fill reads it at
`PAGE_HOST`, a name in `.test` that the Worker host answers from that server
through Miniflare's outbound service (`cloudWorker({ pages })`), so the fill's
guard judges the name as it judges any site's and is never widened for a
scenario, and every machine runs them all.

The Worker is built through turbo by the first scenario that boots one, once
per run, rather than at suite start, because only the scenarios that boot a
Worker need it; its build carries the library's page, so a browser scenario
drives the page the Worker deploys.

CI runs the suite in two lanes (`--lanes 2`), half its four-core runner, the
same count a four-core machine's default gives, so a local default run is the
one CI runs.
