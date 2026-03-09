# Agent Instructions

## Project Overview

**inteligir** - Turborepo monorepo with Next.js app + shared packages

## Tech Stack

- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15, React 19, Tailwind CSS 4
- **Editor**: Plate.js (rich text editor)
- **API**: tRPC, better-auth
- **Database**: Supabase + Drizzle ORM + PostgreSQL
- **UI**: shadcn/ui (Radix), lucide-react, vaul, sonner
- **Payments**: Stripe
- **Uploads**: uploadthing
- **Docs**: fumadocs

## Workspace Structure

```
apps/
  web/           # Main Next.js app (@repo/web)
packages/
  api/           # tRPC routers, auth (@repo/api)
  db/            # Drizzle schema, Supabase (@repo/db)
  ui/            # Shared UI components (@repo/ui)
```

## Common Commands

```bash
pnpm dev              # Dev all workspaces
pnpm dev-web          # Dev web app only
pnpm build            # Build all
pnpm typecheck        # Type check all
pnpm lint             # Lint all
pnpm lint-fix         # Lint fix all
pnpm format           # Format check
pnpm format-fix       # Format fix

# Database
pnpm db-start         # Start local Supabase
pnpm db-stop          # Stop local Supabase
pnpm db-push          # Push schema to local
pnpm db-push-remote   # Push schema to prod
pnpm db-reset         # Reset local DB

# UI
pnpm gen-ui           # Add shadcn component
```

## Quality Gates

Before committing:

```bash
pnpm typecheck && pnpm lint && pnpm build
```
