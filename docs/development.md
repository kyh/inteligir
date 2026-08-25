# Development guide

How to run, verify, and change inteligir. `CLAUDE.md` holds the architecture
summary, `apps/web/README.md` the Worker's own routes and deploy, `AGENTS.md`
the runnable quickstart for coding agents.

## Prerequisites

- Node ≥ 24, pnpm 10 (`corepack enable`)
- `pnpm install` at the repo root (workspace-wide)
- For `dev:web` only: `cp apps/web/.dev.vars.example apps/web/.dev.vars`,
  then set `BETTER_AUTH_SECRET` to anything. Without it every `/api/auth/*`
  request fails.

## Running

```bash
pnpm dev             # THE PRODUCT: the shell over its own server
pnpm cli serve       # the server ALONE, from source, no window
pnpm dev:web         # vite + miniflare — the marketing/auth Worker, :5174
```

`pnpm dev` runs electron-vite: the renderer with HMR, the main process, and
the CLI's bundle rebuilt first — because the shell FORKS that bundle, so a
stale `dist/` would be a window on last week's server. The forked child boots
the server: config → SQLite open + migrate → Hono (the oRPC handler at /rpc,
the /ws invalidation bus). No login.

Iterating on the SERVER is `pnpm cli serve` in its own terminal: that runs the
TypeScript source under tsx, and a shell started afterwards ADOPTS it instead
of forking a second one.

The dev port and data dir are DERIVED PER CHECKOUT (sha256 of the checkout
root — `apps/cli/src/server/config.ts` documents the scheme), so parallel
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

## Tests

- `pnpm --filter inteligir test` — the server and the CLI: every procedure
  against the contract, the device-token gate, a REAL ws upgrade round-trip
  (serve + injectWebSocket + `WebSocket`), the ws bus, config layering,
  port probing, the dev-dir ownership marker, and every CLI leaf EXECUTED
  against its refusal path.
- `pnpm --filter @repo/api test` — the contract itself: the vault path
  grammar, the ws change kinds, the cloud wire's envelopes and ceilings.
- `pnpm --filter @repo/desktop test` — the window's decisions (the origin pin,
  the server verdicts, the packaged layout) and the renderer's own suites.
- `pnpm --filter @repo/db test` — migrate-on-boot, WAL pragmas, ids.
- `pnpm --filter @repo/notes test` — the pure domain: the knowledge engine
  (link graph, search, related notes, rename), tags and tasks, markdown
  parse/opaque-nodes/frontmatter.
- `pnpm --filter @repo/web test` — the Worker, against real in-process
  miniflare (D1 + Better Auth): the invite gate and the password-reset flow.
- `pnpm --filter @repo/ui test` — no-orphan-components.

End-to-end: `pnpm e2e` boots real app instances on scratch dirs (fixture
vaults, scratch git remotes, a headless browser) and is deliberately outside
`pnpm verify` — `tools/e2e/README.md` is the one-pager.
