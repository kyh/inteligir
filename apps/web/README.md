# `@repo/web` — inteligir.com

One Cloudflare Worker serving the marketing site and the whole cloud from
one origin: the TanStack Start pages, the library tab at `/library`, Better
Auth on D1 and every device's session, each account's library cell (a SQLite
Durable Object holding the library and its devices' sockets), the connector a
person's own assistant reaches the library through. The wire contract is
`@repo/contract/v1` — the Worker implements it; the library tab (the Mac
app's window and the browser tab), the phone and the extension consume it.
The cloud's code is `@repo/service`'s (`packages/service`) and the D1 schema
`@repo/db`'s (`packages/db`): this app is the site and the entry that deploys
them.

## Layout

```
src/
  start.ts           Start's request middleware: a nonce a request, and the
                     page policy (lib/document-policy.ts) on every document
  router.tsx         The one router, handing the nonce to Start's scripts
  routes/            TanStack Start file routes
    __root.tsx       The bare document every page shares: head, theme script
    _site.tsx        The site's layout (SSR): providers, head, header, 404
    _site/
      index.tsx      The marketing page
      privacy.tsx    docs/privacy.md itself, rendered
      terms.tsx      docs/terms.md itself, rendered
      about, contact lib/site-content.ts's markdown, rendered or answered as-is
      app/           /app/sign-in, /app/sign-up, /app/forgot-password and
                     /app/reset-password (the last client-only)
      connect/       /connect/extension, which tells the browser extension
                     where the site is and which account this browser is
                     signed in to (client-only)
    library.tsx      The library's layout (ssr: false): opens the tab once a
                     document (library/library-tab.ts), then draws the page
    library/         /library and /library/settings
    api/, v1/,       Server routes, one a door's path, each handing every
    oauth/,          method to its @repo/service door; api/$ and v1/$ answer
    [.]well-known/,  a plain 404
    connect/authorize.ts, connector.ts
  library/           The library tab: its code, styles and decisions
                     (library/CLAUDE.md), suites under jsdom
  components/        The site's own components (auth card, header, theme, orb)
  lib/               Better Auth client and the tab's session read, session
                     guard, document policy, site config (the Download
                     button's fixed dmg link among it), page markdown
  request-context.ts What the entry hands Start with every request: the
                     service's doors, typed for both programs
  worker/            The deployed entry: its OWN tsconfig program (no DOM)
    server.ts        Hands every request to Start with that request's doors,
                     and exports the Durable Objects and the fill queue's
                     consumer
    service-exports.test-d.ts  the deployed exports held to the service's classes
  **/*.test.ts       the site's suites under node, the library's under jsdom
```

Two programs check `src/`: `tsconfig.json` the pages and their suites (ES2023
and the DOM, the Mac app's WebKit 16.6 ceiling), and `src/worker/tsconfig.json`
the Worker; `scripts/tsconfig.json` checks the scripts.

`src/worker/` compiles without `lib.dom` on purpose: workerd and the DOM both
declare `BufferSource`/`BodyInit` globally with different bounds, so one
program would typecheck the Worker against a stdlib it never runs on. Its
own `tsconfig.json` checks `server.ts`, and every `@repo/service` module it
reaches, against the deployed `Env`. The markdown codec the cell runs reaches
highlight.js's types, which reference `lib.dom` themselves, so the program maps
`highlight.js` to the service's stub
(`packages/service/src/types/highlight-js.d.ts`), the one type lowlight takes
from it (`LanguageFn`); the fill reads a page with `@repo/page-reader`, whose code is typed by the
DOM's globals, so the one entry the Worker calls publishes a `types` condition,
its DOM-free signature (`packages/page-reader/src/read-html-api.ts`).

## Routes

| Route                       | Auth            | What                                                                                                                  |
| --------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`                         | —               | Marketing page (SSR); markdown to `Accept: text/markdown`                                                             |
| `/about`, `/contact`        | —               | Trust pages from `lib/site-content.ts`, negotiated the same way                                                       |
| `/privacy`                  | —               | Renders `docs/privacy.md` itself (SSR) — never a copy                                                                 |
| `/terms`                    | —               | Renders `docs/terms.md` itself (SSR) — never a copy                                                                   |
| `/llms.txt`, `/sitemap.xml` | —               | Agent and crawler files, beside `/robots.txt`                                                                         |
| `/*` (anything else)        | —               | 404; a markdown recovery body to `Accept: text/markdown`                                                              |
| `/app`                      | —               | Redirects to `SIGNED_IN_HOME`, the library; the layout has no page of its own                                         |
| `/app/sign-in`              | —               | Sign-in (SSR when signed out — see `lib/session-guard.ts`)                                                            |
| `/app/sign-up`              | —               | Sign-up form; submits to the invite gate                                                                              |
| `/app/forgot-password`      | —               | Requests the reset link                                                                                               |
| `/app/reset-password`       | —               | Where the emailed link lands (client-only, `no-store`, no referrer)                                                   |
| `/library`, `/library/*`    | —               | The library in a tab (`src/library`), drawn in the browser; a signed-out visit goes to sign-in                        |
| `/api/auth/*`               | —               | Better Auth (email+password; the session cookie, signed as the extension's bearer, under `expo-origin` for the phone) |
| `POST /api/sign-up`         | —               | The invite gate in front of Better Auth's sign-up, for the site's form and the phone's                                |
| `GET /v1/socket`            | ticket          | The account's socket: a moved frame per landed write, a thread's events; on a minute's ticket; hibernatable           |
| `GET /v1/notes/:id`         | ticket          | An item's note: its live document's socket, on the account socket's ticket, to the note's own object                  |
| `POST /v1/rpc/account/*`    | session         | The account's oRPC rows: devices, delete, the socket's ticket, assistants                                             |
| `POST /v1/rpc/library/*`    | session         | The library's oRPC rows, forwarded to the account's library cell                                                      |
| `/v1/blobs/:sha`            | session         | A file's bytes in R2: PUT once by its SHA-256, GET/HEAD by range                                                      |
| `POST /connector`           | assistant token | The connector: the library's tools, forwarded to the account's cell                                                   |
| `/connect/authorize`        | session         | The consent page an assistant sends the person to, after sign-in                                                      |
| `/connect/extension`        | session         | The site's page that tells the browser extension where the site is and whose sign-in it found; it hands over nothing  |
| `/.well-known/oauth-*`      | —               | The authorization server's and the connector's metadata                                                               |
| `POST /oauth/register`      | —               | An assistant registers itself, ten an address a minute; let go 90 days unused                                         |
| `POST /oauth/token`         | —               | A code (PKCE S256) or refresh token for an access token; revocation                                                   |
| `/api/*`, `/v1/*` (else)    | —               | A plain `not found` 404, never the site's page                                                                        |

## The doors

Every path in the table but the site's own pages is a server route under
`src/routes/` declaring `ANY`, a one-line handler that gives the raw request to
its door: `context.doors`, which the entry builds per request with
`doorsFor(env, ctx)` (`src/worker/server.ts`) and `src/request-context.ts`
types by the service's DOM-safe leaf, so the site's program loads none of the
service's code. Each door answers its own methods, its 405 and its own throw,
and refuses a path its row in `DOOR_ROUTES` does not name
(`packages/service/src/door-routes.ts`); `routes/api/$.ts` and
`routes/v1/$.ts` answer a plain 404, so an unknown API path never renders the
site's page. What each door does, its sessions, refusals, floor and
throttles, is `packages/service/README.md` § The doors and § Auth.

## The site's pages

- **The site's pages remember the way back.** Sign-in and sign-up follow
  `next` through `internalNextPath` (`src/lib/next-path.ts`, the
  open-redirect guard), each handing it to the other, else land in the
  library, `SIGNED_IN_HOME`, as bare `/app` does, each by a document load. The
  auth forms submit through one `useAuthSubmit`
  (`src/components/auth-shell.tsx`), which turns a request that never left
  into a message rather than a button stuck busy.
- **The emailed reset link lands on a site page, not a Worker route.**
  `/app/forgot-password` asks Better Auth for a link whose GET leg redirects
  to `/app/reset-password?token=…` (or `?error=INVALID_TOKEN` for a spent or
  expired one), and that page posts the new password through the Better Auth
  client. Its URL carries a live single-use token, so the route is
  `ssr: false`, answers `Cache-Control: no-store` and sets a `no-referrer`
  meta (`src/routes/_site/app/reset-password.tsx`). It works with no app installed,
  since an email client opens a browser. A `next` the person came with rides
  the request, the mail's link and the page's links back to sign-in.

## Invites

Minting invites is a raw insert, deliberately — no admin UI, no self-serve
issuance. Locally, add an `invite_code` row in `pnpm --filter @repo/db
studio`; in production:

```bash
pnpm -F @repo/web exec cf d1 query 005d0e52-f102-4298-8da9-492b672ed00f \
  --sql "INSERT INTO invite_code (code) VALUES ('...')"
```

## Dev

```bash
cp .env.example .env              # at the repo root; runs unedited
pnpm dev:web                      # vite + miniflare on :5174 (pinned, strictPort)

# The local D1 file is materialized lazily, on the first request that touches
# the binding — `dev` alone does not create it. So hit one, THEN push:
curl -s -o /dev/null localhost:5174/api/auth/get-session
pnpm --filter @repo/db push
```

> **Never run `@repo/db`'s `push:remote` or `studio:remote`.** Both load
> `packages/db/drizzle.config.ts` (`driver: "d1-http"`) with the root
> `.env.production.local` creds and hit the PRODUCTION D1. The bare `push` and
> `studio` are the local ones.

`pnpm dev:web` also starts the scripted Messages API on :5177
(`tools/messages-fake`), and `ANTHROPIC_FAKE_URL` in the root `.env` points the
built-in agent at it: each conversation's object runs its turns through the
SDK as it does deployed, with no key and no model, and the cell runs the tools
the script names. The suites bind the same name, and their outbound service
answers it with the fake's handler and refuses every other address
(`packages/service/messages-service.ts`).

The Worker's suites are `@repo/service`'s, inside workerd on a config of its
own (`packages/service/README.md` § Testing). This app's are two vitest
projects (`vitest.config.ts`): `site`, under node, rendering its routes to a
string as the Worker's SSR does, and `library`, the library tab under jsdom,
compiled by the React Compiler as it ships. `pnpm --filter @repo/web test` runs
both; `typecheck` runs the app, Worker and scripts programs.

## Build & deploy (owner-only)

```bash
# 1. Authenticate (once)
pnpm -F @repo/web exec cf auth login

# 2. Create the D1 auth database (once) and paste its id into
#    cloudflare.config.ts -> env.DB
pnpm -F @repo/web exec cf d1 create --name inteligir-auth

# 3. Push the schema to the remote D1. No migration files — put the three creds
#    in the root .env.production.local (see .env.example), then:
pnpm --filter @repo/db push:remote

# 4. Set the runtime secrets (NOT committed). BETTER_AUTH_SECRET is a DEDICATED
#    signing key — generate a fresh random 32+ char value, don't reuse another.
pnpm -F @repo/web exec cf workers secrets update BETTER_AUTH_SECRET --worker inteligir-web --text '...'
#    The built-in agent's: the token of the `inteligir` AI Gateway, whose Authenticated
#    Gateway admits only requests carrying it, and which stores the PRODUCTION Anthropic
#    workspace's key itself (docs/releasing.md § 5). Without it the agent says it can't be
#    reached. The deploy job's CLOUDFLARE_ACCOUNT_ID names the gateway's account. Every
#    request names its account in cf-aig-metadata: set the gateway's spend limit split by
#    that `account` before the first deploy (docs/releasing.md § 5).
pnpm -F @repo/web exec cf workers secrets update AI_GATEWAY_TOKEN --worker inteligir-web --text '...'

# 5. Password reset. Until the sending domain is onboarded, every reset email
#    fails server-side and is only logged — the request response stays neutral
#    on purpose. Onboard it (dashboard: Email Sending, then the DKIM/SPF DNS);
#    the sender is RESET_FROM_ADDRESS in cloudflare.config.ts, on inteligir.app
#    until the verified domain is another one.

# 6. The library's files bucket, BLOBS (once — the R2 binding refuses to deploy without it)
pnpm -F @repo/web exec cf r2 buckets create --name inteligir-vault

# 6b. The fill queues (once — the queue bindings and consumers refuse to deploy without them)
pnpm -F @repo/web exec cf queues create --queue-name inteligir-fill
pnpm -F @repo/web exec cf queues create --queue-name inteligir-fill-failed

# 6c. The connector's OAuth namespace takes no step: OAUTH_KV names no id, so the first
#     deploy creates it and keeps it linked to the Worker after

# 7. Deploy — the exact commands the `Deploy` workflow runs. The build bakes the agent's
#    gateway into the Build Output from CLOUDFLARE_ACCOUNT_ID (apps/web/turbo.json hands it
#    the build), and the check refuses an output that names none
export CLOUDFLARE_ACCOUNT_ID=...
pnpm turbo run build --filter=@repo/web...
jq -e '.env.AGENT_GATEWAY_URL.value | startswith("https://gateway.ai.cloudflare.com/v1/")' \
  apps/web/.cloudflare/output/v0/workers/default/worker.config.json
pnpm -F @repo/web exec cf deploy --prebuilt

# (optional) tail logs: cf cannot tail yet
pnpm -F @repo/web exec wrangler tail inteligir-web
```

The GitHub `Deploy` workflow runs the same command on push to main, gated on
CI, when anything the build reads changed since the `deployed/web` tag
(`docs/privacy.md` and `docs/terms.md` included). It does NOT apply the
schema: the schema reaches production only from a local machine (step 3), so
push it BEFORE merging a change that needs it — the schema is additive, so an
old Worker against a new database ignores what it does not know, while a new
Worker against an old database 500s on every request touching a table that
isn't there. The workflow's secrets are `CLOUDFLARE_API_TOKEN` (Workers
Scripts: Edit, Queues: Edit, Workers KV Storage: Edit, for the namespace the
first deploy creates, plus Workers Routes: Edit on the inteligir.com zone) and
`CLOUDFLARE_ACCOUNT_ID`, which names the account of the built-in agent's
gateway.

## Previews

Every PR from a branch of this repo gets a
[Worker Preview](https://developers.cloudflare.com/workers/previews/) once CI is
green, the way Vercel previews a PR: a sticky comment with the status and the
URL, a "View deployment" button on the PR, a fresh deploy on every push, and the
Preview deleted when the PR closes. `.github/workflows/preview.yml` runs it;
`.github/scripts/worker-preview.mjs` draws the comment and the deployment, and
deletes the Preview. A delete Cloudflare refuses fails the job and leaves the
comment as it was, so rerun the job; only "Preview not found", a PR that never
had one, is no failure.

A Preview never touches production data. `cloudflare.config.ts` binds
`inteligir-auth-preview` (D1), `inteligir-vault-preview` (R2),
`inteligir-fill-preview` (a queue nothing consumes) and
`inteligir-oauth-preview` (KV, the connected assistants) when `isPreview`,
which the workflow creates on first use and pushes the PR's schema into with
`drizzle-kit push --force`; the Durable Objects are a fresh namespace per
Preview. The workflow hands the build the KV namespace's id and the Preview's
own URL (`OAUTH_KV_PREVIEW_ID`, `PREVIEW_ORIGIN`), so the connector's tokens
name the Preview that minted them, and fails a deploy that lands elsewhere. All PRs share the one preview D1, so an account made on one Preview
signs in on the next. There is no `send_email` binding, so a reset email is
logged, not sent. Sign-up stays invite-gated: mint a code into the preview D1
to create the first account.

Setup, once:

```bash
# the Deploy token also needs D1: Edit and Workers R2 Storage: Edit
# wrangler: cf has no preview secret command yet
pnpm -F @repo/web exec wrangler preview base-config secret put BETTER_AUTH_SECRET --worker-name inteligir-web  # a preview-only value
# the token of the `inteligir-preview` AI Gateway, which stores the PREVIEW Anthropic
# workspace's own key, never production's
pnpm -F @repo/web exec wrangler preview base-config secret put AI_GATEWAY_TOKEN --worker-name inteligir-web
```

A Preview's built-in agent calls Claude through the `inteligir-preview`
gateway, so nothing a PR deploys can spend production's key, and runs the PR's
own definition, since the definition is code; its conversations are the
Preview's own `AgentThreadDO` namespace. Each of its requests names its
account in `cf-aig-metadata`, which that gateway's spend limit splits by.

Locally, `pnpm -F @repo/web exec cf previews deploy <name>` deploys one.
