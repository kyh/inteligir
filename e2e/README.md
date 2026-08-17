# @repo/e2e — the end-to-end suite

Boots REAL app processes (the same entry `pnpm dev` runs, or the prod bundle)
on scratch instance dirs, drives them over the typed `/api/v1` client and a
headless browser, and asserts on the wire AND on disk. It is orchestration
plus plain assertions on purpose — no test framework; the runner exits
non-zero on any failure with a readable transcript.

## Run it

```sh
pnpm e2e                      # all scenarios against the dev entry
pnpm e2e --prod               # against the built bundle
                              #   (pnpm --filter @repo/app build first)
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
  with a fresh port, bounded), health-gated on `/api/v1/health` answering
  `{ok:true}`. Registered for teardown at SPAWN, before the health wait, and
  torn down as a process group that is polled to verified-dead (SIGTERM →
  SIGKILL → ESRCH) before its scratch is removed; Ctrl-C kills every live
  group. `extraEnv` may not touch harness-owned keys (paths, port, NODE_ENV,
  `GIT_*`) — collisions are refused loudly. `seedVault` writes fixture files
  before boot; the app's repo init commits them.
- `bareRemote()` — a scratch bare git repo, returned as the `file://` URL for
  `INTELIGIR_VAULT_REMOTE`.
- `instance.api` — the typed hc client from `@repo/server-contract/client`;
  `instance.vaultDir` / `dataDir` for on-disk assertions.

## The scenarios

| name                    | proves                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| vault-crud              | write/read/rename/delete over the wire, bytes verified on disk; refused    |
|                         | ops verified to leave the disk untouched                                   |
| vault-sync              | two instances + one bare remote (auto-sync disabled, every sync explicit): |
|                         | propagation, then a typed conflict + git-verified repo integrity           |
| threads-scripted        | a chat turn through the scripted driver: send, settle, timeline            |
| delegation-scripted     | the delegation loop (#552): anchor spliced via the guarded CAS write,      |
|                         | bound thread, scripted turn writes the vault, by-doc chip data, timeline   |
|                         | turn + file change                                                         |
| browser-smoke           | headless page load: title, SPA mount, API reached, clean console after a   |
|                         | settle window                                                              |
| delegation-chip-browser | a seeded marker + settled thread render as a live status chip headless;    |
|                         | selection driving is NOT attempted (the CLI drives selectors, not text     |
|                         | drags) — the create flow is covered API-level by delegation-scripted       |
| editor-constructs-      | every live-preview construct renders in a real browser (one seeded note,   |
| browser                 | one `eval` probe over the built DOM — jsdom has no layout, so the unit     |
|                         | suite cannot prove a widget survived the bundle and a measure pass), and   |
|                         | the file is re-read from disk to prove rendering wrote no bytes            |

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
| `INTELIGIR_HMR_PORT`         | dev only: vite's HMR websocket port (server + injected |
|                              | client) — vite's default is machine-global, so         |
|                              | concurrent instances collide; each dev boot gets its   |
|                              | own reserved one                                       |
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
