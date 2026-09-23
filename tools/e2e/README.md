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
pnpm e2e --keep               # keep the scratch dirs for post-mortem
pnpm e2e --list               # names + descriptions
pnpm e2e --require-browser    # a browser that cannot launch FAILS, never skips
```

Before the first scenario the runner builds the CLI bundle and the workspace
UI it stages, through turbo (`--filter=inteligir`): a cache hit when nothing
changed, and never a stale `dist/` booted as if it were this checkout.

Every scenario runs under a deadline (`timeoutMs`, default 180s; the two that
build or boot a Worker declare more). A run still going past it FAILS with
its instances' output tails and is torn down, so a hang costs one scenario,
not the whole job.

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
  `NODE_ENV=production`, what npm and the .app run). Scratch `data/` + `vault/`
  siblings, a reserved free port (bind races retry with a fresh port,
  bounded), health-gated on `/health` answering `{ok:true}`. Registered for
  teardown at SPAWN, before the health wait, and torn down as a process group
  that is polled to verified-dead (SIGTERM →
  SIGKILL → ESRCH) before its scratch is removed; Ctrl-C kills every live
  group. `extraEnv` may not touch harness-owned keys (paths, port, NODE_ENV,
  `GIT_*`) — collisions are refused loudly. `seedVault` writes fixture files
  before boot; the app's repo init commits them. `seedData` does the same for
  the data dir — a device credential, so the instance boots already signed in.
- `bareRemote()` — a scratch bare git repo, returned as the `file://` URL for
  `INTELIGIR_VAULT_REMOTE`.
- `cloudWorker()` — the product Worker (apps/web) under `wrangler dev` on a
  scratch persist dir, its D1 carrying apps/web's own `db:export` schema plus
  one invite row. Registered for teardown exactly like an instance.
- `instance.api` — the oRPC client over `@repo/api/local`, carrying the device
  token this instance published in `<dataDir>/server.json`;
  `instance.vaultDir` / `dataDir` for on-disk assertions.

## The scenarios

`pnpm e2e --list` prints this table from the registry itself; what follows is
what each one is FOR.

| name                      | proves                                                                    |
| ------------------------- | ------------------------------------------------------------------------- |
| vault-crud                | write/read/rename/delete over the wire, bytes verified on disk; refused   |
|                           | ops verified to leave the disk untouched                                  |
| vault-sync                | two instances + one bare remote (auto-sync off, every sync explicit):     |
|                           | propagation, then a typed conflict + git-verified repo integrity          |
| hosted-vault-sync         | the hosted loop for real: a wrangler-dev Worker, production login,        |
|                           | convergence through the derived remote, boot clone, revoke → unauthorized |
| built-worker-boot         | the vite-built bundle — what `wrangler deploy` ships — boots under        |
|                           | wrangler dev and answers; built through turbo on every run, so it is the  |
|                           | current source, and the one place a module-scope crash of the emitted     |
|                           | module can show                                                           |
| built-cli-boot            | the esbuild bundle — what npm and the .app run — boots in production      |
|                           | mode, serves `dist/ui`'s shell byte for byte, migrates and indexes a      |
|                           | write, hears an on-disk write through its forked watcher, and answers a   |
|                           | client verb run from the same split bundle                                |
| threads-scripted          | a turn through the scripted driver: send, settle, timeline                |
| action-scripted           | an action attaches to its note; a scripted turn writes the vault; the     |
|                           | CAS write guards the save (typed conflict, current bytes in the body);    |
|                           | a rename drags the attachment along — all verified on disk                |
| cli-drive                 | the CLI drives a real instance, and the env an agent's shell would get    |
|                           | resolves against this checkout                                            |
| browser-smoke             | headless page load: the REAL policy on the served document, SPA mount,    |
|                           | API reached, the palette chord safe, clean console after a settle window  |
| note-create-browser       | a note created through the session — the sidebar's New note, the inline   |
|                           | name, Enter — lands on disk as the file a user would go looking for       |
| editor-constructs-browser | every live-preview construct renders in a real browser (jsdom has no      |
|                           | layout, so the unit suite cannot prove a widget survived the bundle and   |
|                           | a measure pass), and the file is re-read to prove rendering wrote no      |
|                           | bytes                                                                     |
| slash-menu-browser        | a typed slash opens the menu, and the picked construct lands in the file  |
| external-edit-browser     | a clean buffer adopts an agent write; a dirty buffer merges instead of    |
|                           | clobbering                                                                |
| view-context-browser      | the agent is told which note the message left from, and at what revision  |
| dictation-browser         | the composer's mic captures, transcribes and inserts — never sends        |
| settings-browser          | /settings hosts the window-level surfaces: Sign out opens its confirm     |
|                           | dialog on that route, and a refused connector add toasts there            |

## Adding a scenario

1. `src/scenarios/<name>.ts` exporting a `Scenario` (`name`, `description`,
   `run(ctx)`, and `timeoutMs` only when a green run can near the default);
   assert with `expect`/`expectEq`, bail with `skip(reason)` for a capability
   this environment/branch does not have yet.
2. Register it in `SCENARIOS` in `src/run.ts` (a static import — knip reads
   reachability from there).

Each feature issue lands with its scenario here.

## The env contract the harness drives

| var                          | effect                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `INTELIGIR_DATA_DIR`         | absolute data dir (SQLite + config.json)               |
| `INTELIGIR_VAULT_DIR`        | absolute vault dir; must be disjoint from the data dir |
| `INTELIGIR_PORT`             | exact port (env-configured ports are never probed)     |
| `INTELIGIR_VAULT_REMOTE`     | git remote URL for the sync loop; unset = local-only   |
| `INTELIGIR_CLOUD_URL`        | the cloud origin; hosted-vault-sync points it at its   |
|                              | own scratch wrangler-dev Worker                        |
| `INTELIGIR_SYNC_INTERVAL_MS` | vault auto-sync cadence; `0` disables the loop AND the |
|                              | boot sync (the sync scenarios set it for determinism)  |
| `INTELIGIR_AGENT`            | `scripted` — the deterministic in-process driver the   |
|                              | thread and action scenarios run against                |
| `INTELIGIR_VOICE`            | `scripted` — a dictation session with no model and no  |
|                              | native binding, so dictation-browser drives the whole  |
|                              | streaming path on any machine                          |

Instances run with every host `GIT_*` variable stripped, `GIT_CONFIG_GLOBAL`
/`GIT_CONFIG_SYSTEM` pinned to `/dev/null` and an explicit harness git
identity, so no commit or fixture depends on the host's git configuration —
the same env every git the harness itself runs gets.

## CI

Headless by construction: no interactive auth, no pinned ports, and no
accounts on any EXTERNAL service — hosted-vault-sync signs up a real account,
but against its own scratch wrangler-dev Worker (apps/web's wrangler, local
mode, state under the scenario's scratch dir; secrets ride `--var`, so no
`.dev.vars` is needed). The one setup step beyond `pnpm install` is the
browser binary every browser scenario needs: `npm i -g agent-browser@X.Y.Z &&
agent-browser install` (Linux: `--with-deps`), at the version
`.github/workflows/ci.yml` pins so a local run drives the browser CI drives.
Every browser scenario probes the environment with `about:blank` first — only
a failure THERE (the browser cannot launch at all) reports SKIP, with the exact
launcher error; opening the app and everything after is a real assertion.
A SKIP still exits 0, which is right on a machine with no browser and wrong on
one that just installed it: there a failed install passes as every browser
scenario skipped behind a green step. So a run that installed the browser
passes `--require-browser`, and every skip becomes a FAIL carrying the same
launcher error.

The runner's suite-start build is what stages `apps/cli/dist/ui`; the harness
still refuses to boot without it, because a server with no workspace UI
answers the API and serves a 404 to the browser — a green API run beside a
page that never loads. built-worker-boot builds apps/web for itself, through
turbo, because the bundle it boots is the thing under test and no other
scenario needs it.
