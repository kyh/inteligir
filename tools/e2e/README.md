# @repo/e2e — the end-to-end suite

Boots REAL servers (`inteligir serve`, the same binary a packaged install
runs) on scratch instance dirs, drives them over the typed oRPC client and a
headless browser, and asserts on the wire AND on disk. It is orchestration
plus plain assertions on purpose — no test framework; the runner exits
non-zero on any failure with a readable transcript.

ONE mode, and that is what deleting the document server bought: the workspace
is a plain SPA, built once and served as files, so the suite drives the same
bytes and the same policy a user gets. It ran twice while a dev entry mounted
Vite in the server process and served no CSP at all.

## Run it

```sh
pnpm e2e                      # every scenario (build first: pnpm build)
pnpm e2e --only vault-sync    # one scenario (comma-separated, repeatable)
pnpm e2e --keep               # keep the scratch dirs for post-mortem
pnpm e2e --list               # names + descriptions
```

Deliberately OUTSIDE `pnpm verify`: the package typechecks/lints/formats in
the gate (it has a `typecheck` script and lives under the root oxlint/oxfmt
sweep), but its scenarios boot processes and a browser, so they run only via
`pnpm e2e`.

## What a scenario gets

Each scenario receives a context (`src/harness/scenario.ts`) that owns its
scratch dir and tears everything down afterwards:

- `boot({ name, vaultRemote?, extraEnv?, seedVault? })` — a fresh instance:
  scratch `data/` + `vault/` siblings, a reserved free port (bind races retry
  with a fresh port, bounded), health-gated on `/health` answering
  `{ok:true}`. Registered for teardown at SPAWN, before the health wait, and
  torn down as a process group that is polled to verified-dead (SIGTERM →
  SIGKILL → ESRCH) before its scratch is removed; Ctrl-C kills every live
  group. `extraEnv` may not touch harness-owned keys (paths, port, NODE_ENV,
  `GIT_*`) — collisions are refused loudly. `seedVault` writes fixture files
  before boot; the app's repo init commits them.
- `bareRemote()` — a scratch bare git repo, returned as the `file://` URL for
  `INTELIGIR_VAULT_REMOTE`.
- `instance.api` — the oRPC client over `@repo/api/local`, carrying the device
  token this instance published in `<dataDir>/server.json`;
  `instance.vaultDir` / `dataDir` for on-disk assertions.

## The scenarios

`pnpm e2e --list` prints this table from the registry itself; what follows is
what each one is FOR.

| name                      | proves                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| vault-crud                | write/read/rename/delete over the wire, bytes verified on disk; refused  |
|                           | ops verified to leave the disk untouched                                 |
| vault-sync                | two instances + one bare remote (auto-sync off, every sync explicit):    |
|                           | propagation, then a typed conflict + git-verified repo integrity         |
| threads-scripted          | a turn through the scripted driver: send, settle, timeline               |
| delegation-scripted       | the action loop: anchor spliced via the guarded CAS write, bound thread, |
|                           | scripted turn writes the vault, by-doc data, timeline turn + file change |
| proposal-review           | a review-mode action proposes instead of writing; accepting lands bytes  |
| cli-drive                 | the CLI drives a real instance, and the env an agent's shell would get   |
|                           | resolves against this checkout                                           |
| browser-smoke             | headless page load: the REAL policy on the served document, SPA mount,   |
|                           | API reached, the palette chord safe, clean console after a settle window |
| editor-constructs-browser | every live-preview construct renders in a real browser (jsdom has no     |
|                           | layout, so the unit suite cannot prove a widget survived the bundle and  |
|                           | a measure pass), and the file is re-read to prove rendering wrote no     |
|                           | bytes                                                                    |
| slash-menu-browser        | a typed slash opens the menu, and the picked construct lands in the file |
| external-edit-browser     | a clean buffer adopts an agent write; a dirty buffer merges instead of   |
|                           | clobbering                                                               |
| view-context-browser      | the agent is told which note the message left from, and at what revision |
| dictation-browser         | the composer's mic captures, transcribes and inserts — never sends       |

## Adding a scenario

1. `src/scenarios/<name>.ts` exporting a `Scenario` (`name`, `description`,
   `run(ctx)`); assert with `expect`/`expectEq`, bail with `skip(reason)` for
   a capability this environment/branch does not have yet.
2. Register it in `SCENARIOS` in `src/run.ts` (a static import — knip reads
   reachability from there).

Each feature issue lands with its scenario here (#556).

## The env contract the harness drives

| var                          | effect                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `INTELIGIR_DATA_DIR`         | absolute data dir (SQLite + config.json)               |
| `INTELIGIR_VAULT_DIR`        | absolute vault dir; must be disjoint from the data dir |
| `INTELIGIR_PORT`             | exact port (env-configured ports are never probed)     |
| `INTELIGIR_VAULT_REMOTE`     | git remote URL for the sync loop; unset = local-only   |
| `INTELIGIR_SYNC_INTERVAL_MS` | vault auto-sync cadence; `0` disables the loop AND the |
|                              | boot sync (vault-sync sets it for determinism)         |
| `INTELIGIR_AGENT`            | `scripted` — the deterministic in-process driver the   |
|                              | thread and delegation scenarios run against            |

Instances run with every host `GIT_*` variable stripped, `GIT_CONFIG_GLOBAL`
/`GIT_CONFIG_SYSTEM` pinned to `/dev/null` and an explicit harness git
identity, so no commit or fixture depends on the host's git configuration —
the same env every git the harness itself runs gets.

## CI

Headless and login-free by construction: no accounts, no interactive auth, no
pinned ports. The one setup step beyond `pnpm install` is the browser binary
for browser-smoke: `npm i -g agent-browser && agent-browser install` (Linux:
`--with-deps`). browser-smoke probes the environment with `about:blank`
first — only a failure THERE (the browser cannot launch at all) reports SKIP,
with the exact launcher error; opening the app and everything after is a real
assertion.

`pnpm build` must have run: the harness refuses to boot without
`apps/cli/dist/ui`, because a server with no workspace UI answers the API and
serves a 404 to the browser — a green API run beside a page that never loads.
