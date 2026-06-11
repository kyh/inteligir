# Inteligir

> An artificially intelligent operating system.

A consumer desktop AI OS. The **product is the Electron desktop app**: a
local-first, voice-first agent that does real work on your machine — personal
admin over connected apps (Google Workspace), Q&A, on-the-fly generative
widgets, and filesystem/shell automation. The agent and voice run on-device;
nothing leaves the machine. Bring your own OpenAI auth; the app is free.
Pre-launch.

Turborepo monorepo. Desktop app (Electron + pi-coding-agent) is the product;
the web app is a marketing landing page.

## Layout

```
apps/
  desktop/         Electron app — the product — see apps/desktop/README.md
  web/             Next.js marketing landing page (static, no backend)
  mobile/          Expo app — remote surface, pairs to desktop
  server/          partyserver Worker — WS relay for mobile↔desktop (Cloudflare)
packages/
  agent-runtime/   Filesystem + install primitives for the agent — see packages/agent-runtime/README.md
  pi-driver/       Wrapper around pi-coding-agent — stable surface for app code
  dispatch/        Shared mobile↔desktop message types
  ui/              Shared UI components (shadcn/ui base)
```

There is **no server-side API or database** — auth is provider OAuth (OpenAI),
handled on-device by pi.

Architecture-level docs live next to the code:

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
pnpm dev:server       # WS relay only
pnpm build
pnpm typecheck
pnpm lint             # oxlint
pnpm format           # oxfmt
pnpm test
```

## Quality gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm build
```
