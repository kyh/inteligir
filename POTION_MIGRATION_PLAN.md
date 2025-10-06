# Potion Template Migration Plan

## Objectives & Guardrails
- Deliver the Notion-like editor, commenting, versioning, and workspace UX from `apps/template-potion` inside `apps/nextjs` without regressing the marketing/docs experience already there.
- Move all shared server logic into packages: TRPC routers/handlers into `packages/api`, relational schema into `packages/db`, shared UI into `packages/ui`, while keeping Better Auth as the single source of authentication.
- Preserve existing monorepo conventions (pnpm workspace, turbo pipeline, Drizzle ORM, TRPC, Better Auth) and keep streaming-only APIs as Next.js route handlers.
- Avoid breaking existing waitlist/organization flows during migration; use feature flags or route gating so we can merge iteratively.

## Phase 1 – Discovery & Alignment
- Create a living inventory of critical features in `apps/template-potion` (documents, comments, versions, files, AI helpers, admin/export flows) and map each to the target location in `apps/nextjs`, `packages/api`, and `packages/db`.
- Review current `apps/nextjs` structure (`(dashboard)`, `registry`, `components`, `trpc`, `providers`) to confirm placeholders that expect editor features.
- Identify configuration deltas (Tailwind setup, env handling, Next config, fonts, analytics) between the template and `apps/nextjs`.
- Confirm operational requirements (Redis, UploadThing, AI providers) and note which services must be provisioned per environment.

## Phase 2 – Tooling & Dependency Baseline
- List all runtime and dev dependencies unique to `apps/template-potion/package.json`; group them into: shared (move to root `package.json` or `packages/ui`), app-only (add to `apps/nextjs`), server-only (add to `packages/api`).
- Add missing catalog entries if version pinning is required (e.g., `@platejs/*`, `hono`, `uploadthing`, `@upstash/ratelimit`).
- Align PostCSS/Tailwind setup: merge template’s config into `apps/nextjs/postcss.config.mjs` and ensure Tailwind 4-compatible usage across editor styles.
- Ensure TypeScript path aliases used in the template exist in `apps/nextjs/tsconfig.json` and workspace `tsconfig` chain.

## Phase 3 – Database Migration (Prisma → Drizzle)
- Translate `apps/template-potion/prisma/schema.prisma` models (User, Document, DocumentVersion, Discussion, Comment, File, Session, OAuthAccount) into Drizzle tables under `packages/db/src`:
  - Extend `drizzle-schema-auth.ts` to capture additional Better Auth fields (e.g., `username`, `profileImageUrl`, `role`, `uploadLimit`, Stripe metadata) while keeping compatibility with Better Auth adapters.
  - Create new application tables in `drizzle-schema.ts`: documents hierarchy, versions, discussions/comments, files, enums as `pgEnum` equivalents.
  - Model foreign keys, unique constraints (`@@unique([userId, templateId])`), self-referential relations, indexes, and cascading deletes.
- Add Drizzle relation helpers and update `packages/db/src/index.ts` exports if new helpers are needed.
- Introduce migration scripts (Drizzle kit or SQL snapshots) and document how to apply them (`pnpm db:migrate`) for dev/prod.
- Backfill seeds or dev fixtures that existed in Prisma (see `.prisma/seed.ts`) using Drizzle + `Better Auth` APIs.
- Update README/ops docs with new env vars required for Postgres/Redis/Uploadting.

## Phase 4 – Server Utilities & Context
- Recreate shared Redis, rate limiting, and storage clients from `apps/template-potion/src/server` inside packages:
  - Port `ratelimit.ts`, `redis.ts`, `pg.ts` into `packages/api/src/utils` or `packages/db` as appropriate, replacing Prisma-specific code.
  - Convert `nid`, slug helpers, and generic utils into reusable functions (place in `packages/api/src/utils` or `packages/ui` if client-side).
- Expand `createTRPCContext` in `packages/api/src/trpc.ts` to inject the new utilities: `db`, `ratelimit`, Better Auth session, active organization, optional cookies.
- Provide server-only helper functions (e.g., `getViewer`, `requireDocumentAccess`) in `packages/api/src/server` for reuse in routers and Next route handlers.

## Phase 5 – TRPC Routers & Procedures
- Move each template router (`comment`, `document`, `file`, `layout`, `user`, `version`) from `apps/template-potion/src/server/api/routers` into `packages/api/src`:
  - Replace Prisma client calls with Drizzle queries using helper functions; ensure pagination/cursor logic (`getNextCursor`) translates correctly.
  - Recreate middleware layers (authorization, logging, ratelimiting) using the existing `protectedProcedure`/`publicProcedure` pattern in `packages/api/src/trpc.ts`.
  - Add input/output schemas (`zod`) and share them with the app via generated types.
  - Update `packages/api/src/root-router.ts` to register the new routers and expose typed callers.
- Ensure router composition aligns with `appRouter.createCaller` usage in `apps/nextjs/src/trpc/server.tsx` and update the client hooks as needed.

## Phase 6 – Auth Alignment (Better Auth + Template Needs)
- Audit template auth flows (`src/server/auth/*`) and map features (admin roles, session cookies, `SUPERADMIN`, dev login, OAuth providers).
- Configure Better Auth to support username, role, upload limits, active org, and stripe IDs by updating `packages/api/src/auth/auth.ts` hooks and types.
- Recreate helper functions (`getAuthUser`, `getDevUser`, `findOrCreateUser`) using Better Auth APIs instead of Lucia, exposing them via `packages/api`.
- Align cookie/session usage in the TRPC context and Next route handlers with `better-auth/react` client used in `apps/nextjs/src/auth`.
- Ensure admin gating, impersonation, and organization membership checks mirror template behavior.

## Phase 7 – File Handling & Uploads
- Port `uploadthing` router (`apps/template-potion/src/app/api/uploadthing/route.ts` and supporting `components/editor/uploadthing-app`) into `apps/nextjs/src/app/api/uploadthing`.
- Move file storage utilities (`lib/storage/images`, `use-file-picker` helpers) into `apps/nextjs/src/lib/storage` and `packages/ui` as appropriate.
- Update TRPC `file` router to integrate with UploadThing callbacks, Drizzle `files` table, and Better Auth user quotas (`uploadLimit`).
- Document required env vars (UPLOADTHING_TOKEN, storage buckets) and ensure they are wired via `@t3-oss/env` configuration shared across packages.

## Phase 8 – AI & Streaming Endpoints
- Recreate Hono routes under `apps/nextjs/src/app/api` using Next Route Handlers:
  - `/api/ai/*` → Next streaming routes powered by `ai` SDK, reusing ratelimit + TRPC helpers for permissions.
  - `/api/export` and `/api/auth` flows either become TRPC mutations or Next route handlers depending on method (non-streaming logic should be TRPC).
- Move shared AI utilities (prompt templates, transforms, `use-chat` hooks) to `apps/nextjs/src/registry` / `components/editor` and ensure imports resolve without `@/` path conflicts.
- Verify streaming responses remain edge-compatible if required; update route runtime config accordingly.

## Phase 9 – Next.js App Structure & Routing
- Merge template routes into `apps/nextjs/src/app`:
  - Translate `(dynamic)` layout stack into existing `(dashboard)` and `(auth)` segments, reconciling marketing/docs pages.
  - Implement editor pages (`documents/[documentId]`, `documents/trash`, `editor`, public document view, admin screens) with server components calling new TRPC queries.
  - Integrate not-found/error boundaries and template’s `global-error.tsx` logic into Next app.
- Bring over global CSS (`globals.css`), fonts, and metadata settings; ensure they coexist with existing marketing styles under `styles/`.
- Update `apps/nextjs/next.config.js` and `turbo.json` if new experimental flags or static asset handling is required (e.g., tailwind registry).

## Phase 10 – Client State, Providers & UI Composition
- Copy provider tree (`components/providers/*`, `AppProvider`, `TailwindProvider`, `ThemeProvider`) into `apps/nextjs`, hooking into Better Auth session fetchers and React Query hydration.
- Migrate Jotai stores, custom hooks (`hooks/*`), and utils to the correct locations (`apps/nextjs/src/hooks`, `apps/nextjs/src/lib`). Remove unused ones or adapt to monorepo patterns.
- Port UI components (`components/editor`, `components/sidebar`, `components/context-panel`, etc.) ensuring shared primitives live in `packages/ui` where possible to avoid duplication.
- Rebuild `registry/components/editor` entries so Plate editor demos continue to work and align with existing registry usage in `apps/nextjs`.
- Ensure client components explicitly opt-in to `"use client"` and server components remain async-friendly.

## Phase 11 – Supporting Services & Observability
- Recreate instrumentation (Sentry, analytics, logging) from template if needed, wiring to environment-specific configs in Next.
- Bring over cron/scripts (`scripts/*`) that sync template assets if still relevant; convert to pnpm workspace scripts under the root package.
- Ensure Docker/dev containers align with current monorepo tooling or document alternative local stack instructions.

## Phase 12 – Testing & Validation
- Add unit tests for new Drizzle repositories and TRPC routers using existing test harnesses or create new ones in `packages/api/tests`.
- Write integration tests for document lifecycle (create/update/archive/restore), comments, file uploads, and AI command flows (mock LLM responses).
- Leverage Playwright or Cypress (if available) to cover critical user journeys (login, create doc, comment, export).
- Verify type safety across app/packaged boundaries by running `pnpm typecheck` in workspace and ensure `eslint` rules pass after imports move.
- Update CI pipeline (turbo tasks) so affected packages run lint/test/build in the right order.

## Phase 13 – Rollout Strategy & Cleanup
- Stage deployment behind a feature flag or sub-route to allow internal testing before replacing the current dashboard experience.
- Plan database migration rollout: create reversible migrations, snapshot existing data, communicate downtime (if any).
- Document manual verification checklist (auth, document CRUD, uploads, AI, export) for QA/UAT.
- Once stable, retire `apps/template-potion` by extracting any remaining shared assets to packages, update workspace configs, and remove redundant dependencies/scripts.
- Update project documentation (`README.md`, onboarding docs) to reflect the new architecture and operational steps.

## Deliverables & References
- Updated `POTION_MIGRATION_PLAN.md` (this file) tracked with progress notes.
- Schema documentation for new Drizzle tables and ERD snapshot.
- API reference (routers, procedures, route handlers) published or linked from internal docs.
- Updated environment variable matrix covering app/api/db packages.
- QA checklist and regression test results before decommissioning the template app.

