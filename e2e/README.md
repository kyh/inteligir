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
  scratch `data/` + `vault/` siblings, a reserved free port, health-gated
  (`/api/v1/health`), killed as a process group at scenario end. `seedVault`
  writes fixture files before boot; the app's repo init commits them.
- `bareRemote()` — a scratch bare git repo, returned as the `file://` URL for
  `INTELIGIR_VAULT_REMOTE`.
- `instance.api` — the typed hc client from `@repo/server-contract/client`;
  `instance.vaultDir` / `dataDir` for on-disk assertions.

## The scenarios

| name             | proves                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| vault-crud       | write/read/rename/delete over the wire, bytes verified on disk            |
| vault-sync       | two instances + one bare remote: propagation, then a typed conflict state |
| threads-scripted | a chat turn through the scripted driver — SKIPS until #549 wires          |
|                  | `INTELIGIR_AGENT=scripted` into `apps/app/src/node/main.ts`               |
| browser-smoke    | headless page load: title, SPA mount, API reached, clean console          |

## Adding a scenario

1. `src/scenarios/<name>.ts` exporting a `Scenario` (`name`, `description`,
   `run(ctx)`); assert with `expect`/`expectEq`, bail with `skip(reason)` for
   a capability this environment/branch does not have yet.
2. Register it in `SCENARIOS` in `src/run.ts` (a static import — knip reads
   reachability from there).

Each feature issue lands with its scenario here (#556).

## The env contract the harness drives

| var                      | effect                                                 |
| ------------------------ | ------------------------------------------------------ |
| `INTELIGIR_DATA_DIR`     | absolute data dir (SQLite + config.json)               |
| `INTELIGIR_VAULT_DIR`    | absolute vault dir; must be disjoint from the data dir |
| `INTELIGIR_PORT`         | exact port (env-configured ports are never probed)     |
| `INTELIGIR_VAULT_REMOTE` | git remote URL for the sync loop; unset = local-only   |
| `INTELIGIR_AGENT`        | `scripted` — pending contract, see threads-scripted    |

The harness also pins `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` to `/dev/null`
so user git config (hooks, signing, default branch) cannot reach an instance.

## CI

Headless and login-free by construction: no accounts, no interactive auth, no
pinned ports. The one setup step beyond `pnpm install` is the browser binary
for browser-smoke: `npm i -g agent-browser && agent-browser install` (Linux:
`--with-deps`). Where a sandbox cannot launch a browser at all, browser-smoke
reports SKIP with the exact launcher error rather than failing the suite;
every assertion after a successful launch is real.
