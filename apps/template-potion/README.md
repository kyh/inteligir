# Potion

## Getting Started

### Environment Variables

Copy the example env file:

```bash
cp .env.example .env.local
```

### Database

There are two options for the database:

1. Local Docker Compose
2. Remote PostgreSQL

#### Local Docker Compose

1. Launch Docker Desktop
2. Set the database environment variables:

```dotenv
DATABASE_URL=postgresql://admin:password@localhost:5432/db?schema=public
POSTGRES_USER=admin
POSTGRES_PASSWORD=password
POSTGRES_DB=db
```

#### Remote PostgreSQL

1. Remove `dev:db` script from the `scripts` in `package.json`.
2. Set the database environment variable to your remote database URL:

```dotenv
DATABASE_URL=
```

### Authentication

Create a new [GitHub OAuth](https://github.com/settings/developers) app with the following settings:

- Application Name: `Potion Local`
- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/github/callback`

Then set these environment variables:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

### AI

For AI, create a new [OpenAI](https://platform.openai.com/api-keys) account and set:

- `OPENAI_API_KEY`

### File Uploads

For file uploads, create a new [UploadThing](https://uploadthing.com/) account and set:

- `UPLOADTHING_TOKEN`

### Development

1. `pnpm install`
2. `pnpm dev`
3. `pnpm migrate`: db migration in another terminal

## Deployment

Potion is deployed on [Coolify](https://coolify.io/) using a Dockerfile. You could deploy it anywhere you want (Vercel, Fly.io, etc.) without Docker.

Set the following environment variables:

```dotenv
NEXT_PUBLIC_ENVIRONMENT=production
# Use your own domain
NEXT_PUBLIC_SITE_URL=https://potion.platejs.org
```

### Coolify

General settings:

- Build Pack: `Nixpacks`
- Direction: `Redirect to non-www.`

Build settings:

- Build Command: `pnpm build && pnpm db:deploy`
- Start Command: `pnpm start`

Advanced settings:

- `Enable Gzip Compression`: disabled

Environment variables:

- Set each environment variable with `Build Variable?` enabled.

### CloudFlare DNS

- SSL/TLS: Full

## App Architecture

### Frontend

- Routes
  - [`app/`](src/app/) - Next.js 15+ App Router
  - [`app/(dynamic)/(main)/`](<src/app/(dynamic)/(main)/>) - Main app routes
  - [`app/(dynamic)/(public)/`](<src/app/(dynamic)/(public)/>) - Public routes
  - [`app/(dynamic)/(admin)/`](<src/app/(dynamic)/(admin)/>) - Admin routes
- Components
  - [`components/`](src/components/) - Application-wide components
  - [`components/hooks/`](src/components/hooks/) - Application-wide hooks
  - [`components/ui/`](src/components/ui/) - Reusable UI components
  - [`components/editor/`](src/components/editor/) - Editor components coupled to the application
  - [`registry/`](src/registry/) - Core editor components from [pro.platejs.org](https://pro.platejs.org/)
  - [`components/auth/`](src/components/auth/) - Auth components
- Configuration
  - [`env`](src/env.ts) - Environment variables
  - [`config`](src/config.ts) - App configuration
  - Client state with Jotai, including persistent storage (localStorage/cookies)
  - Server state with React Query ([tRPC](src/trpc/react.tsx), [Hono](src/server/hono/hono-client.ts))

### Backend

- API tRPC

  - [`server/api/`](src/server/api/) - Default API layer using tRPC
  - [`server/api/middlewares/`](src/server/api/middlewares/) - tRPC middlewares
  - [`server/api/routers/`](src/server/api/routers/) - tRPC routers
  - [`trpc/hooks.ts`](src/trpc/hooks.ts) - React query and mutation hooks

- API Hono

  - [`server/hono/`](src/server/hono/) - API layer using Hono
  - [`server/hono/middlewares/`](src/server/hono/middlewares/) - Hono middlewares
  - [`server/hono/routes/`](src/server/hono/routes/) - Hono routes

- Auth

  - [`server/auth/`](src/server/auth/) - Authentication system
  - [`server/auth/findOrCreateUser.ts`](src/server/auth/findOrCreateUser.ts) - User creation
  - [`server/auth/providers/github.ts`](src/server/auth/providers/github.ts) - GitHub OAuth

- Database
  - [`prisma/schema.prisma`](prisma/schema.prisma) - Prisma schema
  - [`server/db.ts`](src/server/db.ts) - Prisma with PostgreSQL
  - [`server/ratelimit.ts`](src/server/ratelimit.ts) - Rate limiting with Redis
