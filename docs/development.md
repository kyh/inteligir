# Development guide

How to run, verify, and change inteligir. `CLAUDE.md` holds the architecture
summary, `apps/web/README.md` the Worker's own routes and deploy, `AGENTS.md`
the runnable quickstart for coding agents.

## Prerequisites

- Node ≥ 24, pnpm 10 (`corepack enable`)
- `pnpm install` at the repo root (workspace-wide)
- `cp apps/web/.dev.vars.example apps/web/.dev.vars`, then set
  `BETTER_AUTH_SECRET` to anything. Without it every `/api/auth/*` request
  fails.

## Running

```bash
pnpm dev:site        # vite + miniflare — the real Worker, in-process, :5174
```

One command runs everything that exists: the marketing site and `/api/auth/*`
over a local D1 file. Sign-up is invite-only and there is no seeded account —
`AGENTS.md` § "There is no seeded login" has the exact commands to materialize
the local D1 file, push the schema, mint an invite and sign up against it.

## Where state lives

| What                                 | Where                                      |
| ------------------------------------ | ------------------------------------------ |
| Site + auth Worker (`pnpm dev:site`) | 5174 (pinned — `strictPort`)               |
| Accounts, sessions, invites          | D1 (local file under `apps/web/.wrangler`) |

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

- `pnpm --filter @repo/notes test` — the pure domain: the knowledge engine
  (link graph, search, related notes, rename), tags and tasks, markdown
  parse/opaque-nodes/frontmatter.
- `pnpm --filter @repo/web test` — the Worker, against real in-process
  miniflare (D1 + Better Auth): the invite gate and the password-reset flow.
- `pnpm --filter @repo/ui test` — component provenance + no-orphan-components.
