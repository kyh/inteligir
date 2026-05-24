# Agent Instructions

## Project Overview

**inteligir** - An artificially intelligent operating system.

Turborepo monorepo with Next.js marketing site + shared packages.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15, React 19, Tailwind CSS 4
- **API**: tRPC, better-auth
- **Database**: Supabase + Drizzle ORM + PostgreSQL
- **UI**: shadcn/ui (Base UI), lucide-react, vaul, sonner
- **Desktop**: Electron + electron-vite (@repo/desktop)
- **AI Agent**: pi coding agent framework (@mariozechner/pi-coding-agent)

## Workspace Structure

```
apps/
  web/           # Marketing site + docs (@repo/web)
  desktop/       # Electron app — agent UI, voice, extensions (@repo/desktop)
packages/
  api/           # tRPC routers, auth (@repo/api)
  db/            # Drizzle schema, Supabase (@repo/db)
  ui/            # Shared UI components (@repo/ui)
  agent-runtime/ # CLI install/seed/run helpers for agent extensions (@repo/agent-runtime)
  pi-driver/     # pi-coding-agent wrapper: sessions, auth, models (@repo/pi-driver)
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

# Database
pnpm db:start         # Start local Supabase
pnpm db:stop          # Stop local Supabase
pnpm db:push          # Push schema to local
pnpm db:push-remote   # Push schema to prod
pnpm db:reset         # Reset local DB
```

## Verifying Changes

Use the **agent-browser** skill to check things in a running app — it drives
both the web app (browser) and the desktop app (Electron). Don't claim a UI
change works without driving it; type/test passing isn't feature-correct.

- Desktop dev exposes a remote-debugging port: `pnpm dev:desktop` runs
  electron-vite with `--remoteDebuggingPort 9222`. Point agent-browser at it
  to inspect/automate the Electron renderer.

## Quality Gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm build
```
