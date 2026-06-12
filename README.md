# Inteligir

> An artificially intelligent operating system.

Turborepo monorepo. Desktop app (Electron + pi-coding-agent) plus a static marketing site, a mobile remote, and a relay Worker.

## Layout

```
apps/
  desktop/         Electron app — the product
  mobile/          Expo app — remote surface, pairs to the desktop
  server/          Cloudflare Worker (partyserver) — WS relay + external chat gateway
  web/             Next.js static marketing site (landing page only)
packages/
  agent-runtime/   Filesystem + install primitives for the agent
  dispatch/        Shared mobile↔desktop wire protocol
  pi-driver/       Wrapper around pi-coding-agent — stable surface for app code
  ui/              Shared UI components (shadcn/ui base)
```

Every app and package has its own `README.md`:

| Workspace                | README                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `apps/desktop`           | [process boundary, IPC, lifecycle, voice](./apps/desktop/README.md)                          |
| `apps/mobile`            | [Expo remote — pairing flow, screens](./apps/mobile/README.md)                               |
| `apps/server`            | [relay Worker — WS relay + chat gateway, auth](./apps/server/README.md)                      |
| `apps/web`               | [static marketing site](./apps/web/README.md)                                                |
| `packages/agent-runtime` | [install / seed / run-cli primitives](./packages/agent-runtime/README.md)                    |
| `packages/dispatch`      | [protocol code map](./packages/dispatch/README.md) · [spec](./packages/dispatch/PROTOCOL.md) |
| `packages/pi-driver`     | [pi-coding-agent wrapper](./packages/pi-driver/README.md)                                    |
| `packages/ui`            | [shared design system](./packages/ui/README.md)                                              |

Deeper architecture docs live next to the code:

- [`docs/chat-interfaces.md`](./docs/chat-interfaces.md) — chat with the agent from Slack/Telegram/WhatsApp/Discord (Chat SDK gateway + relay bridge on `@repo/server`)
- [`apps/desktop/src/main/README.md`](./apps/desktop/src/main/README.md) — state machine triad (reducer/effects/machine)
- [`apps/desktop/src/agent/README.md`](./apps/desktop/src/agent/README.md) — pi extension bundle pattern
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
