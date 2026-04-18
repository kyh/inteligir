# Agent Instructions

## Project Overview

**inteligir** - An artificially intelligent operating system.

Turborepo monorepo with Next.js marketing site + shared packages.

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15, React 19, Tailwind CSS 4
- **API**: tRPC, better-auth
- **Database**: Supabase + Drizzle ORM + PostgreSQL
- **UI**: shadcn/ui (Radix), lucide-react, vaul, sonner
- **Desktop** (planned): Electron + electron-vite
- **AI Agent** (planned): pi coding agent framework (RPC mode)

## Workspace Structure

```
apps/
  web/           # Marketing site + docs (@repo/web)
packages/
  api/           # tRPC routers, auth (@repo/api)
  db/            # Drizzle schema, Supabase (@repo/db)
  ui/            # Shared UI components (@repo/ui)
```

## Common Commands

```bash
pnpm dev              # Dev all workspaces
pnpm dev:web          # Dev web app only
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

## Quality Gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm build
```
