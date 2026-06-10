# Inteligir

> An artificially intelligent operating system.

Turborepo monorepo. Desktop app (Electron + pi-coding-agent) plus a static marketing site, a mobile remote, and a relay Worker.

## Layout

```
apps/
  desktop/         Electron app — the product. See apps/desktop/README.md
  mobile/          Expo app — remote surface, pairs to the desktop
  server/          Cloudflare Worker (partyserver) — WS relay + external chat gateway
  web/             Next.js static marketing site (landing page only)
packages/
  agent-runtime/   Filesystem + install primitives for the agent — see packages/agent-runtime/README.md
  dispatch/        Shared mobile↔desktop wire protocol — see packages/dispatch/PROTOCOL.md
  pi-driver/       Wrapper around pi-coding-agent — stable surface for app code
  ui/              Shared UI components (shadcn/ui base)
```

Architecture-level docs live next to the code:

- [`docs/chat-interfaces.md`](./docs/chat-interfaces.md) — chat with the agent from Slack/Telegram/WhatsApp/Discord (Chat SDK gateway + relay bridge on `@repo/server`)
- [`apps/desktop/README.md`](./apps/desktop/README.md) — process boundary, IPC, lifecycle, "where do I add X?"
- [`apps/desktop/src/main/README.md`](./apps/desktop/src/main/README.md) — state machine triad (reducer/effects/machine)
- [`apps/desktop/src/agent/README.md`](./apps/desktop/src/agent/README.md) — pi extension bundle pattern
- [`packages/agent-runtime/README.md`](./packages/agent-runtime/README.md) — install/seed primitives, what goes here vs. in `apps/desktop/`
- [`packages/dispatch/PROTOCOL.md`](./packages/dispatch/PROTOCOL.md) — dispatch protocol v1: pairing, message catalog, trust boundaries

`AGENTS.md` (root) is read by Claude Code / agents working in the repo — quality gates, dev-loop tools, conventions.

## Common commands

```bash
pnpm dev              # All workspaces
pnpm dev:web          # Web only
pnpm dev:desktop      # Desktop only
pnpm dev:server       # Relay Worker only (wrangler dev)
pnpm build
pnpm typecheck
pnpm lint             # oxlint
pnpm format           # oxfmt
pnpm test
pnpm knip             # Dead exports / unused deps
```

## Quality gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm build
```
