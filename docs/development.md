# Development guide

How to run, verify, and change inteligir — the ONE home for the commands, the
ports, where state lives and the gate; `README.md`, `AGENTS.md` and
`CLAUDE.md` link here rather than restating them. `CLAUDE.md` holds the
architecture summary and the decisions, `apps/web/README.md` the Worker's own
routes and deploy, `AGENTS.md` the runnable quickstart for coding agents.

## Prerequisites

- Node 24, pnpm 12 (`corepack enable` reads the root `packageManager`)
- `pnpm install` at the repo root (workspace-wide)
- For `dev:web` only: `cp apps/web/.dev.vars.example apps/web/.dev.vars`,
  then set `BETTER_AUTH_SECRET` to anything. Without it every `/api/auth/*`
  request fails.

## Commands

```bash
pnpm dev              # THE PRODUCT — the shell over its own server
pnpm dev:desktop      # Alias of dev, kept deliberately (owner call 2026-08-26)
pnpm dev:mobile       # apps/mobile: expo start
pnpm cli serve        # The server ALONE, from source, no window; a shell adopts it
pnpm cli <verb>       # Every other verb, against this checkout's instance
pnpm dev:web          # apps/web: vite + miniflare on :5174 (pinned, strictPort)
pnpm package:cli      # The npm artifact (apps/cli) — `npx inteligir serve`
pnpm package:desktop  # An UNSIGNED macOS arm64 dmg
pnpm smoke:cli        # Pack, install into a scratch prefix, boot, probe, stop
pnpm smoke:desktop    # Package the .app, boot its server, drive it, SIGTERM (macOS only)
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all   (oxlint)
pnpm format:fix       # Format     (oxfmt) — run BEFORE gates, never after
pnpm verify           # The static gate (CI adds the e2e suite on top)
pnpm e2e              # The scenario suite (one mode — the SPA is a static build)
```

## Running

`pnpm dev` runs electron-vite: the renderer with HMR, the main process, and
the CLI's bundle rebuilt first — because the shell FORKS that bundle, so a
stale `dist/` would be a window on last week's server. The forked child boots
the server: config → SQLite open + migrate → Hono (the oRPC handler at /rpc,
the /ws invalidation bus). No login.

Iterating on the SERVER is `pnpm cli serve` in its own terminal: that runs the
TypeScript source under tsx, and a shell started afterwards ADOPTS it instead
of forking a second one.

The dev port and data dir are DERIVED PER CHECKOUT (sha256 of the checkout
root — `apps/cli/src/server/dev-instance.ts` is the whole scheme), so parallel
worktrees never share a database or collide on a socket; a busy derived port
is probed upward and the winner logged. The checkout is walked up to from
wherever the command started, so `pnpm dev` (from apps/desktop) and
`pnpm cli …` (from wherever you stand) name the same instance. `INTELIGIR_PORT`
and `INTELIGIR_DATA_DIR` override; a dev data dir is marked with its checkout
path on first boot and refuses a different checkout thereafter.

Every `INTELIGIR_*` variable that module declares works on `pnpm dev`, and
that is a fact `apps/desktop/turbo.json` has to keep: turbo runs in STRICT env
mode, so a variable its `dev` task does not name is stripped before the
process starts — silently, with no error to read, so
`INTELIGIR_AGENT=scripted pnpm dev` would simply boot the default agent. The
task list is held against the module's own declared set by
`tools/repo-guards/src/turbo-passthrough.test.ts`, so adding a variable to
`config.ts` fails the gate until the task names it.

The prod path is `pnpm package:cli`, which bundles the server, the CLI and the
staged workspace UI into `apps/cli/dist`; `inteligir serve` then runs plain
`node` on port 4664. `pnpm package:desktop` wraps that same package in the
unsigned .app.

`pnpm dev:web` runs the marketing site and `/api/auth/*` over a local D1
file. Sign-up is invite-only and there is no seeded account — `AGENTS.md`
§ "There is no seeded login" has the exact commands.

## Where state lives

| What                                | Where                                             |
| ----------------------------------- | ------------------------------------------------- |
| The product (`pnpm dev`)            | derived port 21000–28999 (hash of checkout root)  |
| The renderer's vite dev server      | 31000, searching upward                           |
| The product's SQLite + config.json  | `~/.inteligir-dev/<hash>/` (prod: `~/.inteligir`) |
| Site + auth Worker (`pnpm dev:web`) | 5174 (pinned — `strictPort`)                      |
| Accounts, sessions, invites         | D1 (local file under `apps/web/.wrangler`)        |

## Quality gates

```bash
pnpm format:fix && pnpm verify
```

`pnpm verify` = `typecheck && lint && knip && format && test && build`, the same
six steps CI runs. It is check-only on purpose — `format:fix` is a separate
first step, never folded in. Format before gates, commit after gates. CI runs
every gate independently (each step runs even if an earlier one fails), so a
red format cannot hide test regressions behind it.

CI then runs a few more that `verify` cannot: it installs agent-browser
(pinned) and runs the scenario suite. ONE run, because there is one build —
the workspace is a plain SPA served as files, so the suite drives the same
bytes and the same policy a user gets. So a green `verify` is not a green CI;
run `pnpm e2e` too before claiming one.

That "plus a few more" is a CLAIM, and
`tools/repo-guards/src/ci-verify-parity.test.ts` is what keeps it one: every
gate workflow runs `pnpm verify` or its chain in verify's own order, and every
step on top of that is a row in `DECLARED_CI_EXTRAS` with its reason. A step
nobody declared fails the guard rather than quietly becoming a build a
developer cannot reproduce.

## Tests

Every workspace answers `pnpm --filter <name> test`; each suite's own file
header says what it pins, and `tools/repo-guards` holds the invariants that
span workspaces (the dep DAG, ws change kinds, CI parity, dangling references,
the per-export orphan guard over `@repo/ui`).

End-to-end: `pnpm e2e` boots real app instances on scratch dirs (fixture
vaults, scratch git remotes, a headless browser) and is deliberately outside
`pnpm verify` — `tools/e2e/README.md` is the one-pager.
