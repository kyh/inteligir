# `@repo/web` — inteligir.com

One Cloudflare Worker serving the site and the whole cloud from one origin: the
TanStack Start pages, the library tab at `/library`, and the entry that deploys
`@repo/service`'s doors and Durable Objects over `@repo/db`'s D1. Its decisions
are this app's [`CLAUDE.md`](CLAUDE.md), and the library tab's
[`src/library/CLAUDE.md`](src/library/CLAUDE.md).

## Layout

```
src/
  routes/        Start's file routes: the site's pages (_site/), the library tab (library/), and one
                 server route per door, each handing its request to the service
  library/       the library tab: its code, styles and decisions, its suites under jsdom
  components/    the site's own components
  lib/           the site's auth client, session guard, document policy, config and page markdown
  worker/        the deployed entry, its own program with no DOM
cloudflare.config.ts   the Worker's bindings, the build floor and the agent's gateway
```

Two programs check `src/`: `tsconfig.json` the pages and their suites (ES2023
and the DOM, the Mac app's WebKit ceiling), and `src/worker/tsconfig.json` the
Worker, against the deployed `Env` with no `lib.dom`, since workerd and the DOM
declare `BufferSource` and `BodyInit` with different bounds.

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

Every path but the site's own pages is a server route declaring `ANY` that
hands the raw request to its door, `context.doors`, built per request in
`src/worker/server.ts`. What each door does is `packages/service/README.md`
§ The doors and § Auth.

## Invites

Minting invites is a raw insert, deliberately — no admin UI, no self-serve
issuance. Locally, add an `invite_code` row in `pnpm --filter @repo/db
studio`; in production:

```bash
pnpm -F @repo/web exec cf d1 query 005d0e52-f102-4298-8da9-492b672ed00f \
  --sql "INSERT INTO invite_code (code) VALUES ('...')"
```

## Testing and the dev loop

`pnpm dev:web` runs this Worker on miniflare with the scripted Messages API
beside it (`docs/development.md`). The cloud's suites are `@repo/service`'s
(`packages/service/README.md` § Testing). This app's are two vitest projects
(`vitest.config.ts`): `site`, under node, rendering its routes as the Worker's
SSR does, and `library`, the tab under jsdom, compiled by the React Compiler as
it ships; `typecheck` runs the app, Worker and scripts programs.

## Build & deploy (owner-only)

```bash
# 1. Authenticate (once)
pnpm -F @repo/web exec cf auth login

# 2. Push the D1 schema. No migration files: put the three creds in the root
#    .env.production.local (see .env.example), then:
pnpm --filter @repo/db push:remote

# 3. Set the runtime secrets (NOT committed). BETTER_AUTH_SECRET is a DEDICATED signing key: a fresh
#    random 32+ char value. AI_GATEWAY_TOKEN is the `inteligir` AI Gateway's token; the gateway
#    stores the PRODUCTION Anthropic workspace's key itself and splits its spend limit by the
#    `account` each request names (docs/releasing.md § 5). Without it the agent says it can't be reached.
pnpm -F @repo/web exec cf workers secrets update BETTER_AUTH_SECRET --worker inteligir-web --text '...'
pnpm -F @repo/web exec cf workers secrets update AI_GATEWAY_TOKEN --worker inteligir-web --text '...'

# 4. Password reset: onboard the sending domain once (dashboard: Email Sending, then the DKIM/SPF
#    DNS); until then every reset email fails server-side and is only logged.

# 5. The dead-letter queue (once). The deploy provisions what the config binds, the R2 bucket, the
#    D1 database, the KV namespace and the fill queue it produces to; inteligir-fill-failed is
#    only consumed, so it is made by hand
pnpm -F @repo/web exec cf queues create --queue-name inteligir-fill-failed

# 6. Deploy — the exact commands the `Deploy` workflow runs. The build bakes the agent's gateway in
#    from CLOUDFLARE_ACCOUNT_ID, and the check refuses an output that names none
export CLOUDFLARE_ACCOUNT_ID=...
pnpm turbo run build --filter=@repo/web...
jq -e '.env.AGENT_GATEWAY_URL.value | startswith("https://gateway.ai.cloudflare.com/v1/")' \
  apps/web/.cloudflare/output/v0/workers/default/worker.config.json
pnpm -F @repo/web exec cf deploy --prebuilt

# (optional) tail logs: cf cannot tail yet
pnpm -F @repo/web exec wrangler tail inteligir-web
```

The GitHub `Deploy` workflow runs the same commands after a green CI on main,
when anything the build reads changed since the `deployed/web` tag
(`docs/privacy.md` and `docs/terms.md` included). It does NOT apply the D1
schema: push it from a local machine BEFORE merging a change that needs it,
since a new Worker against an old database 500s on every request touching a
table that isn't there. Its secrets are `CLOUDFLARE_API_TOKEN` (Workers
Scripts: Edit, Queues: Edit, Workers KV Storage: Edit, plus Workers Routes:
Edit on the inteligir.com zone) and `CLOUDFLARE_ACCOUNT_ID`, which names the
account of the built-in agent's gateway.
