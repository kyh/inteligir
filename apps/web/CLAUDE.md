# Decisions: @repo/web

The site and the Worker that deploys the cloud: Start's page and server
routes, the library's page at `/library`, the Worker's entry, its `Env` and how
it deploys. The cloud's code and its decisions are `@repo/service`'s
(`packages/service/CLAUDE.md`), and the library page's are its own
(`apps/web/src/library/CLAUDE.md`). `AGENTS.md` § Decisions says how a bullet
is written and cited.

## The site and the Worker

- **THE LAYOUT IS kyh/init's, ON CLOUDFLARE, WITH TWO DEPARTURES.** A
  contract package feeds a service package over a db package under one Start
  app, as in kyh/init: `@repo/contract` the client-safe wire and model,
  `@repo/service` the procedures, Better Auth and the Durable Objects,
  `@repo/db` drizzle's schemas, and this app the routes and the Worker's entry.
  First, `@repo/db` reads `@repo/contract` and never the reverse, where init's
  contract reads its db: every client bundles the contract, and none may bundle
  drizzle. Second, a route reaches the service through the doors in Start's
  request context (EVERY PATH IS START'S), where init's API route builds an
  oRPC handler of its own, since only the entry holds the ExecutionContext the
  connector's OAuth provider writes `ctx.props` on. Rejected: init's edges as
  they stand (drizzle in the phone's and the extension's bundles); a handler
  per route (a provider handed a context that is not the one Cloudflare
  passed). `tools/repo-guards/src/dep-dag.test.ts`,
  `apps/web/src/request-context.ts`.

- **EVERY PATH IS START'S, AND A DOOR'S SERVER ROUTE HANDS ITS REQUEST TO THE
  SERVICE THROUGH START'S REQUEST CONTEXT.** The Worker's entry matches no
  path: it exports the Durable Objects and the fill consumer and hands every
  request to Start with `doorsFor(env, ctx)`, built per request, since the
  connector's OAuth provider writes `ctx.props` on the very ExecutionContext
  Cloudflare handed the entry. Each path a door answers is one server route
  declaring `ANY`, a one-line handler giving the door the raw request, and the
  door answers its methods and its 405 itself; `/api/$` and `/v1/$` answer a
  plain 404, so an unknown API path never renders the site's page. A door
  catches its own throw, logged, and answers it in its protocol (`rpcFault` on
  `/v1/rpc`, `internal error` elsewhere), and refuses any path its row in the
  table does not name, since Start's routes also take a splat's bare prefix, a
  trailing slash and any case. One table spells those paths: the suites'
  Worker dispatches by it, and a guard holds one route file to each row. The
  routes type `context.doors` by the service's DOM-safe leaf, so the site's
  program loads none of the service's code. Rejected: a router of our own in front of Start (every path claimed twice);
  a door route declaring its methods (one it leaves out falls to the site's
  page, a 200 of HTML); Start's answer to a door's throw (a JSON 500 of its
  own and a bare log line); doors kept at module scope (the context is per
  request and the provider writes to it). `apps/web/src/worker/server.ts`,
  `apps/web/src/request-context.ts`, `packages/service/src/doors.ts`,
  `doors-api.ts`, `door-routes.ts`, `tools/repo-guards/src/route-paths.test.ts`,
  `tools/e2e/src/scenarios/worker-doors.ts`, `worker-door-faults.ts`.

- **EACH PROGRAM'S `Env` IS WHAT `cf workers types` GENERATES FROM ITS OWN
  CONFIG, AND THE ENTRY'S HOLDS THE SERVICE TO WHAT DEPLOYS.** Every binding
  the Worker deploys is declared in `apps/web/cloudflare.config.ts`: a secret
  with `bindings.secret()`, a value with `bindings.text`, the reset sender and
  the auth limiter's off switch included, and a binding one mode lacks types
  as optional. `@repo/service` generates its own `Env` and `Cloudflare.Exports`
  from its suites' Worker (`packages/service/cloudflare.config.ts`, never
  deployed), which binds what the app's does, typed alike, with the values the
  suites run on, so the service typechecks with no other workspace's output.
  The entry's own program (`apps/web/src/worker/tsconfig.json`) checks again
  every service module `server.ts` reaches, against the deployed `Env`, and a
  type test holds the entry's exports to the service's Durable Object classes,
  so a binding the service reads must be in both configs: one only the suites
  declare fails the app's typecheck, one only the app declares the service's.
  Rejected: a hand-written `Env` beside the generated ones (it drifts from
  what deploys, and a secret it names is never checked against the config);
  the service's program reading the app's generated types (a task naming
  another workspace's output, which its cache key cannot follow). The date and
  flags are one module, the fills' queues another, the agent's allowance and
  prices a third, at the service's root, that both configs and the suites
  import and the Worker's own code never does: the dev server cannot load a
  module the config loads, so the consumer reads its queue's settings from
  `FILL_DELIVERY` and the cell its limits from `AGENT_ALLOWANCE` and
  `AGENT_PRICES`, and `oxlint.config.ts` refuses the import.
  `apps/web/cloudflare.config.ts`, `packages/service/cloudflare.config.ts`,
  `apps/web/src/worker/service-exports.test-d.ts`,
  `packages/service/compatibility.ts`, `packages/service/fill-queues.ts`,
  `packages/service/agent-limits.ts`.

- **THE LIBRARY'S PAGE IS A ROUTE OF THE SITE, AT `/library`, DRAWN IN THE
  BROWSER UNDER THE POLICY EVERY DOCUMENT CARRIES.** The route is `ssr: false`
  under a bare root document, so the server sends the shell and the page's
  head, and none of the site's providers, head or header, which sit in the
  pathless `_site` layout; a deep link is a route of the one router, and a path
  it does not hold answers the site's 404. Start's request middleware mints a
  nonce a request and puts one policy on every `text/html` answer that names
  none: scripts from this origin or by that nonce and no wasm, calls and the
  socket to this origin and the Mac app's command channel alone, nothing
  remote drawn in an item, no frame and no worker; a file served under its own
  sandbox, and the consent page, keep theirs. The page ships in the Worker's
  deploy, so its calls meet no build floor, and its code is chunks a site page
  never preloads (`apps/web/vite.config.ts`). Rejected: a page built apart and
  copied into the Worker's assets (a second build, and a door and
  `runWorkerFirst` rows to answer its deep links); a server render of the
  library (it reads the account's cell online, after the tab's session read);
  inline scripts by `'unsafe-inline'` (an injected one would run); the asset
  server's SPA fallback (every unknown path would answer the page); a page on
  an origin of its own (a second sign-in, CORS on every call).
  `apps/web/src/routes/library.tsx`, `apps/web/src/start.ts`,
  `apps/web/src/lib/document-policy.ts`.

- **A SIGN-IN OR SIGN-UP LANDS IN THE LIBRARY UNLESS SOMETHING ASKED IT BACK, AND
  THE SITE LINKS THE LIBRARY.** `signedInLanding` follows a `next` the
  open-redirect guard passes, else `/library`, by a document load, since the
  library's tab opens once a document, so only a load opens the account just
  signed in to, and the site's router holds no consent page; sign-in, sign-up
  and the reset pages hand `next` on, the reset through its mail's link, each
  page's search parsed by the same guard so none holds an off-site one. One
  link, in the site's header, serves someone signed in and someone not, since
  the page sends a signed-out tab to sign in and back; its document answers
  `noindex`, as the account pages do, since that link hands a crawler an empty
  shell. Rejected: a sign-out passing its own `next` (the landing is already
  the library); `Disallow` in robots.txt (a page it blocks can still be listed
  by its link). `apps/web/src/lib/next-path.ts`,
  `apps/web/src/components/library-link.tsx`,
  `apps/web/src/library/library-tab.ts`, `apps/web/src/routes/library.tsx`.

- **THE CONNECT PAGE TELLS THE EXTENSION WHERE THE SITE IS, AND HANDS IT
  NOTHING.** `/connect/extension` is a site route for the person signed in
  there: a click of Connect sends the committed id alone `{ type: "connect" }`
  through `externally_connectable`, whose sender Chrome names by the page's
  origin, and the page says which account the extension answers it found this
  browser signed in to. The extension reads the browser's own sign-in (EVERY
  DEVICE SIGNS IN WITH BETTER AUTH'S OWN SESSION, in
  `packages/service/CLAUDE.md`), so no credential crosses the
  page, and none is minted or revoked there. Rejected: a credential minted for
  the extension and handed over (a second secret per browser, which outlived
  the browser's sign-out); the id from the link (a link could name another
  extension). `apps/web/src/routes/_site/connect/extension.tsx`,
  `apps/web/src/lib/extension-connect.ts`.

- **A PR PREVIEW IS A WORKER PREVIEW DRIVEN BY ACTIONS, not Workers Builds**,
  and it binds preview-only resources. Previews ride `workflow_run` after CI, as
  Deploy does, only for this repo's branches, since that trigger holds secrets.
  A preview inherits no binding, so `apps/web/cloudflare.config.ts` binds each
  to a preview-only resource, the OAuth namespace by the id the workflow found
  or made and the site's origin as the Preview's own URL, which the workflow
  derives before the deploy and checks after it. The script creates the GitHub
  deployment on the head commit (`.github/scripts/worker-preview.mjs`), since a
  job's `environment:` under `workflow_run` records the default branch, and
  deletes a closed PR's Preview before it reports it gone, Cloudflare's "Preview
  not found" alone being no failure. Rejected: Workers Builds (it deploys on push
  and cannot wait for CI); a preview on the production D1 (PR code would write
  real accounts); `cf previews delete` for the close (it exits 1 on a miss and on
  an expired token alike).
  `.github/workflows/preview.yml`, `apps/web/README.md` § Previews.
