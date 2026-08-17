# Development guide

How to run, verify, and change inteligir. `CLAUDE.md` holds the architecture
summary, `apps/web/README.md` the Worker's own routes and deploy, `AGENTS.md`
the runnable quickstart for coding agents.

## Prerequisites

- Node ≥ 24, pnpm 10 (`corepack enable`)
- `pnpm install` at the repo root (workspace-wide)
- For `dev:site` only: `cp apps/web/.dev.vars.example apps/web/.dev.vars`,
  then set `BETTER_AUTH_SECRET` to anything. Without it every `/api/auth/*`
  request fails.

## Running

```bash
pnpm dev             # THE PRODUCT (apps/app) — prints its URL on boot
pnpm dev:site        # vite + miniflare — the marketing/auth Worker, :5174
```

`pnpm dev` boots the local server: config → SQLite open + migrate →
Hono (/api/v1 from the contract table, /ws invalidation bus) → Vite in
middlewareMode serving the Start SPA. One process, HMR intact. No login.

The dev port and data dir are DERIVED PER CHECKOUT (sha256 of the checkout
path — `apps/app/src/node/config.ts` documents the scheme), so parallel
worktrees never share a database or collide on a socket; a busy derived port
is probed upward and the winner logged. `INTELIGIR_PORT` and
`INTELIGIR_DATA_DIR` override; a dev data dir is marked with its checkout
path on first boot and refuses a different checkout thereafter.

Every `INTELIGIR_*` variable that module declares works on `pnpm dev`, and
that is a fact `apps/app/turbo.json` has to keep: turbo runs in STRICT env
mode, so a variable its `dev` task does not name is stripped before the
process starts — silently, with no error to read, so
`INTELIGIR_AGENT=scripted pnpm dev` would simply boot the default agent. The
task list is held against the module's own declared set by
`tools/repo-guards/src/turbo-passthrough.test.ts`, so adding a variable to
`config.ts` fails the gate until the task names it.

The prod path is `pnpm -F @repo/app build && pnpm -F @repo/app start`:
`build` emits the SPA (`dist/`) and the bundled Node entry
(`dist-node/main.js`, migrations copied beside it); `start` runs plain
`node`, port 4664.

`pnpm dev:site` runs the marketing site and `/api/auth/*` over a local D1
file. Sign-up is invite-only and there is no seeded account — `AGENTS.md`
§ "There is no seeded login" has the exact commands.

## Where state lives

| What                                 | Where                                             |
| ------------------------------------ | ------------------------------------------------- |
| The product (`pnpm dev`)             | derived port 21000–28999 (hash of checkout path)  |
| Its vite HMR socket                  | derived port 31000–38999 (same hash)              |
| The product's SQLite + config.json   | `~/.inteligir-dev/<hash>/` (prod: `~/.inteligir`) |
| Site + auth Worker (`pnpm dev:site`) | 5174 (pinned — `strictPort`)                      |
| Accounts, sessions, invites          | D1 (local file under `apps/web/.wrangler`)        |

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

- `pnpm --filter @repo/app test` — the local server: the API against the
  contract, the browser-origin guard, a REAL ws upgrade round-trip
  (serve + injectWebSocket + `WebSocket`), the ws bus, config layering,
  port probing, the dev-dir ownership marker.
- `pnpm --filter @repo/typed-routes test` — the vendored route machinery.
- `pnpm --filter @repo/server-contract test` — target keys, strict outbound /
  lenient inbound ws schemas.
- `pnpm --filter @repo/db test` — migrate-on-boot, WAL pragmas, ids.
- `pnpm --filter @repo/notes test` — the pure domain: the knowledge engine
  (link graph, search, related notes, rename), tags and tasks, markdown
  parse/opaque-nodes/frontmatter.
- `pnpm --filter @repo/web test` — the Worker, against real in-process
  miniflare (D1 + Better Auth): the invite gate and the password-reset flow.
- `pnpm --filter @repo/ui test` — component provenance + no-orphan-components.

End-to-end: `pnpm e2e` boots real app instances on scratch dirs (fixture
vaults, scratch git remotes, a headless browser) and is deliberately outside
`pnpm verify` — `e2e/README.md` is the one-pager.
