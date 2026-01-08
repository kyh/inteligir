# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

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
  nextjs/        # Main Next.js app (@repo/nextjs)
  potion-main/   # Reference app (Plate.js editor source)
packages/
  api/           # tRPC routers, auth (@repo/api)
  db/            # Drizzle schema, Supabase (@repo/db)
  ui/            # Shared UI components (@repo/ui)
```

## Common Commands

```bash
pnpm dev              # Dev all workspaces
pnpm dev-nextjs       # Dev nextjs app only
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

## Quick Reference (bd)

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

