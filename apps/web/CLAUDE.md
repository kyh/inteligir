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
- **Every path is Start's, and a mount's server route hands each request
  under it to the service through Start's request context.** The service's own
  table names the door, so a route per door spells every path twice; only the
  entry holds the ExecutionContext the connector's OAuth provider writes
  `ctx.props` on, so the service is built per request.
  `tools/e2e/src/site.spec.ts`.
- **Each program's `Env` is what `cf workers types` generates from its own
  config, and the entry's holds the service to what deploys.** A hand-written
  `Env` drifts from what deploys, so a binding the service reads is declared in
  both configs. `apps/web/cloudflare.config.ts`.
- **The agent's gateway is two secrets on the Worker, its address and its
  token, and no build holds either.** cf refuses a deploy while a declared
  secret is unset, so a Worker whose agent has no gateway never ships, with no
  check of ours. `apps/web/cloudflare.config.ts`.
- **A module `cloudflare.config.ts` loads is never the Worker's code.** The dev
  server stops on a module both load, so the Worker reads those values from
  the bindings the config declares. `oxlint.config.ts`.
- **The library tab is a route of the site, at `/library`, drawn in the browser
  under the policy every document carries.** A tab built apart is a second
  build with a door for its deep links. `apps/web/src/routes/library.tsx`.
- **The Worker sends a request with no session cookie for a signed-in page to
  sign in, before any of the page loads, and reads no session to do it.** A
  read would cost every library document a database query, so a cookie whose
  session ended is the page's own read to find.
  `apps/web/src/lib/session-guard.ts`.
- **Sign-in and sign-up ask the Worker who is signed in as it renders them,
  through Start's request context, and nothing in the browser.** A fetch of
  this zone's own route skips Workers, and a guard in the browser reads the
  session on every hover of a link. `apps/web/src/worker/server.ts`.
- **A sign-in or sign-up lands in the library unless something asked it back,
  and the site links the library.** Only a document load opens the account just
  signed in to. `apps/web/src/lib/next-path.ts`.
- **An account form's submit is one value, and done is never idle again.** A
  sign-in that went through is still loading the next document, and a form
  live meanwhile posts twice. `apps/web/src/components/auth-shell.tsx`.
- **The connect page tells the extension where the site is, and hands it
  nothing.** The extension rides the browser's own sign-in, so no credential
  crosses the page. `apps/web/src/routes/_site/connect/extension.tsx`.
- **A PR gets no deploy, and the config refuses a Preview.** Its bindings are
  production's, and a preview copy of the cloud is upkeep nobody uses yet.
  `apps/web/cloudflare.config.ts`.
