# Agent Instructions

## Project Overview

**inteligir** - An artificially intelligent operating system.

Turborepo monorepo with Next.js marketing site + shared packages.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15, React 19, Tailwind CSS 4 (static marketing site, no backend)
- **UI**: shadcn/ui (Base UI), lucide-react, vaul, sonner
- **Desktop**: Electron + electron-vite (@repo/desktop) — the actual product
- **Mobile**: Expo (@repo/mobile) — remote surface, pairs to desktop
- **Transport**: partyserver Worker (@repo/server) — WebSocket relay, mobile↔desktop
- **AI Agent**: pi coding agent framework (@mariozechner/pi-coding-agent)

The agent runs locally in the desktop app. There is no server-side API or
database — auth is provider OAuth (OpenAI), handled by pi on-device.

## Workspace Structure

```
apps/
  web/           # Static marketing site (@repo/web) — landing page only
  desktop/       # Electron app — agent UI, voice, extensions (@repo/desktop)
  mobile/        # Expo app — remote surface, pairs to desktop (@repo/mobile)
  server/        # partyserver Worker — WS relay, mobile↔desktop (@repo/server)
packages/
  ui/            # Shared UI components (@repo/ui)
  agent-runtime/ # CLI install/seed/run helpers for agent extensions (@repo/agent-runtime)
  pi-driver/     # pi-coding-agent wrapper: sessions, auth, models (@repo/pi-driver)
  dispatch/      # Shared mobile↔desktop message types (@repo/dispatch)
```

## Common Commands

```bash
pnpm dev              # Dev all workspaces
pnpm dev:web          # Dev web app only
pnpm dev:desktop      # Dev desktop app only
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all
pnpm lint:fix         # Lint fix all
pnpm format           # Format check
pnpm format:fix       # Format fix
```

## Desktop Debugging

Desktop dev opens Electron with CDP on port 9222 by default.

```bash
pnpm dev:desktop
agent-browser --session inteligir-desktop connect 9222
agent-browser --session inteligir-desktop snapshot -i
agent-browser --session inteligir-desktop screenshot /tmp/inteligir-desktop.png
```

Use `agent-browser` for desktop UI validation. Inspect the actual Electron app.

## Quality Gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm build
```
