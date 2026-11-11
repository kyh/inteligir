# Decisions: @repo/web

The site and the Worker that deploys the cloud: Start's page and server routes,
the library tab at `/library`, the Worker's entry, its `Env` and how it
deploys. The cloud's decisions are `packages/service/CLAUDE.md`'s, and the
library tab's `apps/web/src/library/CLAUDE.md`'s.

## The site and the Worker

- **The layout is kyh/init's, on Cloudflare, with two departures.** `@repo/db`
  reads `@repo/contract` and never the reverse, since no client may bundle
  drizzle, and a route reaches the service through Start's request context.
  `apps/web/src/request-context.ts`.
- **Every path is Start's, and a door's server route hands its request to the
  service through Start's request context.** Only the entry holds the
  ExecutionContext the connector's OAuth provider writes `ctx.props` on, so the
  doors are built per request. `tools/e2e/src/site.spec.ts`.
- **Each program's `Env` is what `cf workers types` generates from its own
  config, and the entry's holds the service to what deploys.** A hand-written
  `Env` drifts from what deploys, so a binding the service reads is declared in
  both configs. `apps/web/cloudflare.config.ts`.
- **A module `cloudflare.config.ts` loads is never the Worker's code.** The dev
  server stops on a module both load, so the Worker reads those values from
  the bindings the config declares. `oxlint.config.ts`.
- **The library tab is a route of the site, at `/library`, drawn in the browser
  under the policy every document carries.** A tab built apart is a second
  build with a door for its deep links. `apps/web/src/routes/library.tsx`.
- **A sign-in or sign-up lands in the library unless something asked it back,
  and the site links the library.** Only a document load opens the account just
  signed in to. `apps/web/src/lib/next-path.ts`.
- **The connect page tells the extension where the site is, and hands it
  nothing.** The extension rides the browser's own sign-in, so no credential
  crosses the page. `apps/web/src/routes/_site/connect/extension.tsx`.
- **A PR preview is a Worker Preview driven by Actions, on preview-only
  bindings.** Workers Builds can't wait for CI, and PR code must never write
  production D1. `.github/workflows/preview.yml`.
