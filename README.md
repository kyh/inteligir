# Inteligir

> An artificially intelligent operating system.

Turborepo monorepo. Desktop app (Electron + pi-coding-agent) plus a marketing/docs site.

## Layout

```
apps/
  desktop/         Electron app — see apps/desktop/README.md
  web/             Next.js marketing + docs site
packages/
  agent-runtime/   Filesystem + install primitives for the agent — see packages/agent-runtime/README.md
  pi-driver/       Wrapper around pi-coding-agent — stable surface for app code
  api/             tRPC routers + auth (web)
  db/              Drizzle schema + Supabase (web)
  ui/              Shared UI components (shadcn/ui base)
```

Architecture-level docs live next to the code:

- [`docs/chat-interfaces.md`](./docs/chat-interfaces.md) — chat with the agent from Slack/Telegram/WhatsApp/Discord (Chat SDK gateway + party relay bridge)
- [`apps/desktop/README.md`](./apps/desktop/README.md) — process boundary, IPC, lifecycle, "where do I add X?"
- [`apps/desktop/src/main/README.md`](./apps/desktop/src/main/README.md) — state machine triad (reducer/effects/machine)
- [`apps/desktop/src/agent/README.md`](./apps/desktop/src/agent/README.md) — pi extension bundle pattern
- [`packages/agent-runtime/README.md`](./packages/agent-runtime/README.md) — install/seed primitives, what goes here vs. in `apps/desktop/`

`AGENTS.md` (root) is read by Claude Code / agents working in the repo — quality gates, dev-loop tools, conventions.

## Common commands

```bash
pnpm dev              # All workspaces
pnpm dev:web          # Web only
pnpm dev:desktop      # Desktop only
pnpm build
pnpm typecheck
pnpm lint             # oxlint
pnpm format           # oxfmt
pnpm test

# Database (web)
pnpm db:start | db:stop | db:push | db:push-remote | db:reset
```

## Quality gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm build
```
