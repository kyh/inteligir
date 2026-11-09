# `@repo/web` — inteligir.com

One Cloudflare Worker serving the marketing site and the whole cloud from
one origin: the TanStack Start pages, the library's page at `/library`, Better
Auth on D1 and every device's session, each account's library cell (a SQLite
Durable Object holding the library and its devices' sockets), the connector a
person's own assistant reaches the library through. The wire contract is
`@repo/contract/v1` — the Worker implements it; the library's page (the Mac
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
  library/           The library's page: its code, styles and decisions
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

Three programs check `src/`: `tsconfig.page.json` the pages as they ship
(ES2023 and the DOM, the Mac app's floor), `tsconfig.json` the suites beside
them, and `src/worker/tsconfig.json` the Worker.

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

## The built-in agent

The agent is our own loop over the Messages API, one Durable Object a
conversation, `AgentThreadDO`, named `agent-thread:<accountId>:<threadId>` by
the account's cell alone and reached through `ctx.exports` with no namespace
binding. It imports `agents/lifecycle` and nothing else of Cloudflare's Agents
SDK: Lifecycle's durable job queue and its one alarm drive the loop, wake a
conversation whose instance died, and deny an approval nobody answered in ten
minutes. Its definition is code, the same bytes for every account: the model
and effort (`packages/service/src/agent/library-agent.ts`), the system prompt
(`packages/service/src/agent/agent-prompt.ts`, which `pnpm --filter @repo/service
agent-prompt` writes from `@repo/agent-skills`; edit the skills and run it,
never the module) and the tools (`agent-tools.ts`). A thread freezes them at
its first turn and replays them byte for byte; a deploy that changes them is
taken up at the start of the thread's next turn, never mid-turn, its requests
from then on carrying no thinking from before that turn.

A person's send (`library.agent.send`) is admitted in one transaction of the
account's cell: refused `SERVICE_UNAVAILABLE` while the agent is off or the
Worker has no Claude to call, `AGENT_BUDGET` once the day's turns or list cost
(`AGENT_ALLOWANCE`) are spent, queued behind its thread's open turn or while
the account runs two, and otherwise opened and handed to its thread's object,
again every 30 seconds until it lands. The object reserves each model call
with the cell before it sends it, streams it with previews to the account's
sockets, and lands only the whole reply, as returned, beside its usage; a call
an instance died reading is sent again whole. A conversation past 50,000
input tokens, the least the API compacts at, is compacted by the API inside
the request that reaches them, its summary landing with the reply, and every
request after carries the conversation from that summary on. A call that
may compact is reserved for the summary's pass beside its answer; at the API's
default of 150,000, a turn after a pause could not afford its first call.
Every tool call runs in the cell
through the library's own procedures as that turn's, its write's op id derived
from the call's, so one run again lands once; a deletion waits for the
person. What the turn did reaches the cell as pushes, each once by its
sequence, stored as the thread's events, a short progress note
before each tool call among them; the push that ends a
turn seals its one change set, books what it cost at list price
(`AGENT_PRICES`), gives back a turn that cost nothing, and lets the links it
saved be read.

Claude is reached through the target's AI Gateway, on its provider-native
Anthropic route (`AGENT_GATEWAY_URL`): `inteligir` for production,
`inteligir-preview` for every Preview, each holding its target's own Anthropic
workspace key with provider credentials required and Authenticated Gateway
on, so the Worker holds no Anthropic key, only the gateway's `AI_GATEWAY_TOKEN`,
and every request asks the gateway to keep no prompt or reply. A Worker with
no gateway refuses every send. `vite dev` names no target's gateway: its
`.dev.vars` names the scripted Messages API or a gateway of the developer's
own (`.dev.vars.example`).

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

"session" is Better Auth's own, read once a request by the door it came
through (`packages/service/src/wire/v1-principal.ts`): the site's page sends its cookie
same-origin, the phone its cookie under `expo-origin` naming `PHONE_ORIGIN`,
and the browser extension the browser's signed cookie value as a bearer. Every
read is of the row in D1, with no cookie cache, so an ended session is refused
at once. The VERIFIED session's userId — never a path or a body — names the
state it reaches: the socket upgrade to that user's own library cell,
`LibraryDO` named `library:<userId>` (on the cell's own socket path, carrying
the verified holder; a session's end and a deletion call the cell by RPC), and
the account deletion reads D1 directly. `/v1/rpc` answers every refusal, an
unhandled fault included, in its own protocol, and `/v1/blobs` and the socket's
upgrade in HTTP's statuses alone, with a sentence for a person.

A link the library holds unread (a `saveLink`, a `refresh`, an import's) is
read by the Worker's own queue consumer: the cell writes the reading's ask as a
`fill` job in the write's transaction and sends it to `inteligir-fill` once
the write commits, the alarm sending again what no send took; the consumer
reads the page and hands it back in one `landFill` call. A message the queue's
three retries could not handle reaches `inteligir-fill-failed`, whose consumer
says the failure in the item. A preview binds `inteligir-fill-preview`, which
nothing consumes, so its links stay unread.

`/v1/rpc` is oRPC's RPC protocol: POST only, every refusal a declared code at
the status `V1_ERROR_STATUS_MAP` gives it, the floor, the session and the
budget answered in the same protocol before any procedure runs
(`packages/service/src/wire/rpc-refusal.ts`). A request carrying `Authorization` is read
from its bearer alone, so one that does not verify is refused, never retried as
the cookie. A library call reaches the cell with the principal the session
verified, in
`x-library-principal`, and nothing the caller sent in its place
(`packages/service/src/wire/v1-rpc.ts`). A file is PUT with its `Content-Length` (at most
100 MB, room held in the cell first) and kept only if its bytes hash to its
sha; a read is answered its single range (206), the whole file for a multi-part
ask, 416 for a range past the end, and 304/412 for its preconditions, under a
script-less sandbox but for a PDF (`packages/service/src/library/blob-routes.ts`).

Every `/v1` request an install sends names its build in
`x-inteligir-build: <semver>+<platform>` (`@repo/contract/client-build`),
and before any route reads it `packages/service/src/client-floor.ts` refuses one that
names none, or a version below `MIN_CLIENT_BUILD` (`cloudflare.config.ts`):
426, as `CLIENT_OUTDATED` on `/v1/rpc` and in plain text on a file or an
export. The platform is telemetry and never compared. A request a browser marks `Sec-Fetch-Site:
same-origin` passes, since the site's own pages ship in this deploy. The floor
is how `/v1` retires a shape: raise it past every build that reads the shape,
then delete the shape.

The connector is an assistant's door alone: its OAuth is
`@cloudflare/workers-oauth-provider`'s on `OAUTH_KV`, which keeps the
assistants' registrations, grants and tokens, and its issuer and resource are
named from `SITE_ORIGIN`, one value per deployment, never the request's Host.
A call to `/connector` is refused 403 for a Host or Origin not this
deployment's, challenged 401 with its `resource_metadata` without a token this
Worker minted for it (a session of the person's is none), and forwarded into the
account's cell with an `assistant` principal once its grant's budget (300
calls a minute) holds (`packages/service/src/connector/connector-route.ts`). A grant is
`library` (read and change) or `library:read`, as the person chose on the
consent page; the account's `assistants.list` and `assistants.revoke` name
and end them, and the account's deletion revokes every one.

## Auth

- `packages/service/src/auth/auth.ts::createAuth(env, ctx, baseURL)` builds a **per-request**
  Better Auth instance (D1 is a runtime binding, not a module singleton;
  `baseURL` is the request origin, so localhost/preview/prod all work with no
  config). Two plugins: `bearer({ requireSignature: true })`, so the
  extension's bearer is the browser's signed cookie value and a session row's
  token alone opens nothing, and `expo()`, which reads the phone's
  `expo-origin` as its origin. Every answer drops `set-auth-token`
  (`withoutAuthToken`), since no client reads one. A session lasts 60 days,
  slid a day at a time, and a sign-in past twenty live sessions ends the one
  used longest ago (`packages/service/src/auth/session-devices.ts`); a password reset
  ends every one. `disabledPaths` shuts every Better Auth route no client calls
  (the clients use sign-in, sign-out, `get-session`, the reset pair and,
  through the invite gate, sign-up). That includes its own `/delete-user`, so
  `account.delete` is the one way to delete an account;
  `auth.api.deleteUser` behind it is unaffected, as the list gates only HTTP.
  Only `/callback/:id` stays open: an exact list cannot name it, and with no
  social provider it has nothing to sign in with. `trustedOrigins` spells out
  the extension's origin and the phone's scheme beside the request's own, and
  Better Auth reads `BETTER_AUTH_TRUSTED_ORIGINS` itself, should another ever
  need trusting. `readSession` is a route of the Worker's own
  reading a session, which never slides it: only `/api/auth/get-session` answers
  with the cookie a slid row needs.
- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`packages/service/src/auth/invite.ts`). `POST /api/sign-up` parses its body with
  `signUpRequestSchema` (`@repo/contract/account/account-schema`, which the
  page, the gate and the e2e harness share with `AUTH_API_PATHS`) and refuses a
  password outside `PASSWORD_MIN_LENGTH`–`PASSWORD_MAX_LENGTH` before touching
  the code. It then claims the code in one atomic
  `UPDATE … WHERE redeemed_at IS NULL` and forwards into the one instance built
  with sign-up enabled — so the response (cookie, Better Auth's own refusals)
  is Better Auth's, untouched. Better Auth is configured with those same two
  bounds (`packages/service/src/auth/auth.ts`), which the reset-password page and the
  apps' sign-in forms hold too. Every other caller's instance carries
  `disableSignUp`, which shuts `/api/auth/sign-up/email` and
  `auth.api.signUpEmail` together. The site's form and the phone's first run
  both post here, so the browser keeps Better Auth's cookie and the phone the
  one its Expo client stores; a refused sign-up releases the claim
  (`claimInvite` / `releaseInvite`), and every attempt spends one per-address
  window first.
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
- **Every device signs in on Better Auth's own route, and its devices are the
  account's sessions.** The site, the Mac app's window and the phone post
  `/api/auth/sign-in/email`; the extension signs in nowhere, riding the
  browser's sign-in to the site. A wrong password and an unknown address
  answer one refusal, under Better Auth's per-address limiter.
  `account.devices.list` names each live session from the user agent it
  signed in with, marks the one asking and selects no token;
  `account.devices.revoke` ends one by its id through Better Auth's adapter,
  whose `session.delete.after` closes its sockets
  (`packages/service/src/wire/account-router.ts`, `packages/service/src/auth/session-devices.ts`).
  Signing out is Better Auth's `/api/auth/sign-out`, which ends the session the
  request names and clears its cookie.
- **Rate limits live in D1** (`rate_limit` table): Better Auth's own database
  limiter on the auth routes, and the same table behind the invite gate's
  10/60s-per-IP window (`packages/service/src/rate-limit.ts`). The
  window is one upsert that RETURNS the count it settled on — a read-then-write
  limiter lets N concurrent requests all read the same count and all decide
  they are under the cap, which is the burst it exists to stop. Every window
  keyed on an address, Better Auth's included, reads `cf-connecting-ip`
  (`CALLER_IP_HEADER`), the one address the edge writes itself, never
  `x-forwarded-for`, and counts an IPv6 address by its /64 (`CALLER_ADDRESS`),
  which one host holds whole. `/api/auth/get-session` spends no window: a session read
  is no password oracle, and every route guard and hover preload makes one. A
  read that fails is unknown to the route guards, never signed out
  (`src/lib/auth-client.ts`). `/v1/rpc` and `/v1/blobs` spend the same table
  keyed on the HOLDER, the session, never the address: a stolen session moves
  between addresses, and the session is what Settings › Account ends. The
  connector spends it keyed on the assistant's grant. Each family is its own,
  so a drained budget never takes another down. An ended session's rows and a
  grant's wait for the prune. Better Auth prunes the shared
  table on its own writes, every row past its 60s window with it, so every
  Worker window is declared in `RATE_WINDOWS` and a guard holds each to 60s or
  less.
- **No CORS.** Every page that calls `/v1` is served by this Worker from this
  origin, the Mac app's window among them, and the browser extension's worker
  calls the site under its host permission, which needs none. CORS added
  later lets no `expo-origin` through: that header names the phone's door, and
  a page allowed to send it would read what the phone's cookie opens.
- **Deleting the account deletes the account's data** in a `beforeDelete` hook,
  so a failed step aborts the deletion rather than orphaning data, and the
  retry runs every step again. THE ORDER IS LOAD-BEARING
  (`packages/service/src/library/account-purge.ts`): the library cell's tombstone first
  (every later call to the cell, a socket's included, is refused) and its
  sockets closed, then every conversation's object, while the cell's rows that
  alone name them are still there, then the cell's storage with the tombstone
  written back at once, then the account's files in R2, then every assistant's
  grant with its tokens, before the sessions that could let one in again, then
  the deleted email off the invite it spent (`redeemed_at` stays set, so the
  code stays burned); Better Auth deletes the sessions with the user, after
  the hook, so a failure leaves one to retry with. The tombstone stays, so a
  request that verified a moment before the sessions went founds no library.
  Any signed-in device asks it through `account.delete`
  (`packages/service/src/auth/delete-account.ts`): the session's own call, a window of 5
  a minute, and `auth.api.deleteUser` handed the password in its body, which
  it checks in place of the session's freshness, so this hook stays the one
  purge path. A session alone deletes nothing: whoever stole one could end the
  account. `docs/privacy.md` is the user-facing statement of all of it.

Minting invites is a raw insert, deliberately — no admin UI, no self-serve
issuance. Locally, add an `invite_code` row in `pnpm --filter @repo/db
studio`; in production:

```bash
pnpm -F @repo/web exec cf d1 query 005d0e52-f102-4298-8da9-492b672ed00f \
  --sql "INSERT INTO invite_code (code) VALUES ('...')"
```

## Dev

```bash
cp .dev.vars.example .dev.vars    # set BETTER_AUTH_SECRET to anything
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
(`tools/messages-fake`), and `ANTHROPIC_FAKE_URL` in `.dev.vars` points the
built-in agent at it: each conversation's object runs its turns through the
SDK as it does deployed, with no key and no model, and the cell runs the tools
the script names. The suites bind the same name, and their outbound service
answers it with the fake's handler and refuses every other address
(`packages/service/messages-service.ts`).

The Worker's suites are `@repo/service`'s, inside workerd on a config of its
own (`packages/service/README.md` § Testing). This app's suites are the site's,
under node: they render its routes to a string as the Worker's SSR does.

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
#    reached. The deploy job's CLOUDFLARE_ACCOUNT_ID names the gateway's account.
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
Preview's own `AgentThreadDO` namespace.

Locally, `pnpm -F @repo/web exec cf previews deploy <name>` deploys one.
