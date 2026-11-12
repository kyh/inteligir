# @repo/service

The cloud's code: its doors, Better Auth, `/v1`, the connector, each account's
library cell with its SQL, search, undo and imports, the fill and each
conversation with the built-in agent. `apps/web`'s Worker entry serves its
doors and exports its Durable Objects, and nothing else ships it. Its decisions
are this package's [`CLAUDE.md`](CLAUDE.md); the routes that reach each door
are `apps/web/README.md` § Routes.

## Why it exists

The cloud's rules are code no client runs, so they sit apart from the model
every client loads (`@repo/contract`), the dialect's markdown (`@repo/editor`),
the schemas (`@repo/db`) and the site (`apps/web`), as kyh/init's service
package does. Its program has no DOM: it runs on workerd, typed by the `Env` and
runtime `cf workers types` generates from the suites' Worker
(`cloudflare.config.ts`, never deployed), and the app's entry program checks
every module it reaches against the deployed `Env` again. No node or react
import (the root `oxlint.config.ts`), and the library model's modules
(`src/library/`'s SQL and undo, `src/knowledge/`, `src/items/`, `src/imports/`,
`src/text/`, `src/note/turn-log.ts`) take no `crypto` or `URL` global either:
the clock, random bytes and fresh ids come in as ports. The cell's SQL is the
Durable Object's own, drizzle over `@repo/db`'s cell schema with raw plans
beside it, so every suite that reaches it runs in workerd.

## Layout

```
compatibility.ts       # workerd's date and flags, for both configs
fill-queues.ts         # the fills' queues, for both configs and the suites
agent-limits.ts        # the built-in agent's daily allowance and list prices
messages-service.ts    # the suites' outbound service: the scripted Messages API
cloudflare.config.ts   # the suites' Worker, never deployed; the Env's source
scripts/agent-prompt.ts  # writes src/agent/agent-prompt.ts from @repo/agent-skills
src/
  doors.ts             # each door apps/web's Start routes hand a request to
  doors-api.ts         # the doors' types, naming only Request and Response
  door-routes.ts       # the path each door answers, as its Start route spells it
  client-floor.ts      # the build floor every install's request is held to
  plain-http.ts        # the answers outside the one wire, in HTTP's statuses
  rate-limit.ts        # the D1 fixed window every throttled route spends
  log.ts               # an error logged whole, its causes included
  object-schema.ts     # a Durable Object's DDL, applied as it wakes
  auth/                # Better Auth factory, invite gate, reset email, the
                       # account's sessions as its devices, account deletion
  wire/                # /v1's one wire: the principal a session verifies to
                       # (v1-principal.ts), the account's rows on the
                       # Worker's own handler (account-router.ts), the
                       # library's forwarded to its cell (v1-rpc.ts), and
                       # what a refused or failed call answers and logs
  library/             # the account's library cell: LibraryDO (library-do.ts),
                       # its engine over the cell's SQLite (library-engine.ts:
                       # field writes, change sets, undo, quota, files), each
                       # item's body as a seed until its note opens and as
                       # what the note projects after (cell-notes.ts), an edit
                       # by passages through the note (cell-edits.ts), every library
                       # procedure over it and the markdown codec
                       # (library-router.ts, served by library-rpc.ts), what the
                       # apps read (cell-listing.ts), the alarm's jobs, each
                       # kind's payload typed (cell-jobs.ts), the account's
                       # purge in order (account-purge.ts), its sockets and
                       # what each write moved for them (cell-moved.ts), the
                       # upgrade routes with the ticket a browser's socket
                       # opens on (socket-routes.ts), the files' bytes in R2
                       # (blob-routes.ts), kept one way by every upload
                       # (keep-bytes.ts), the readings it sends to the fill
                       # queue (cell-fills.ts), a page's article put in its
                       # note before the write (article-landing.ts) and its
                       # imports (cell-imports.ts).
                       # The library's SQL and undo:
    cell-db.ts         # drizzle over the cell, its DDL applied on wake,
                       # inserts cut under the bound-parameter cap
    library-sql.ts     # the raw port, plans as generators, statement chunking
    sql-value.ts       # a SQL value and row as zod
    library-queries.ts # an item's rows: drizzle for its row and derived rows,
                       # plans for its seed and the search index
    revert-change.ts   # a change set's fields taken back three ways, the
                       # set's after as the base, newest set first
  note/                # each item's note: NoteDO (note-do.ts), a y-partyserver
                       # YServer over its own SQLite, named only by
                       # note-stub.ts; its door on the account socket's ticket
                       # (note-routes.ts), what it and the cell say over RPC
                       # (note-wire.ts), a page's article as changes by block
                       # (article-body.ts), what it owes the cell and when
                       # (note-duty.ts), what it takes from whom
                       # (note-standing.ts) and a turn undone from its stored
                       # log (turn-log.ts)
  connector/           # the connector: its OAuth on
                       # @cloudflare/workers-oauth-provider (connector-auth.ts),
                       # the consent page an assistant sends the person to
                       # (consent-route.ts), the route that forwards a verified
                       # call into the account's cell (connector-route.ts), the
                       # MCP server the cell builds per request over the
                       # library's tool rows (connector-server.ts,
                       # library-tools.ts) and the account's grants
                       # (assistant-grants.ts)
  agent/               # the built-in agent: its one definition
                       # (library-agent.ts) and its generated prompt
                       # (agent-prompt.ts), each conversation's object,
                       # AgentThreadDO (agent-thread.ts), with its tables
                       # (thread-db.ts), its loop (thread-loop.ts), its drive
                       # (thread-drive.ts), each tool call's state
                       # (tool-call.ts), its requests (thread-request.ts) and
                       # its client through AI
                       # Gateway (anthropic-client.ts); and the cell's side: the
                       # tools it runs (agent-tools.ts), the allowance and the
                       # prices it books (agent-allowance.ts), the switch
                       # (agent-switch.ts), and each turn let in, handed over,
                       # landed and sealed (agent-turns.ts, turn-rows.ts)
  fill/                # the fill queue's consumer (fill-consumer.ts): a saved
                       # link read through the guarded fetch (page-fetch.ts)
                       # and the page reader, its files kept, landed in the cell
  knowledge/           # search over the library's rows
    search-query.ts, search-excerpt.ts, fts-match.ts  # the ONE literal+stem
                       # query policy every engine runs, the excerpt cut over
                       # the literal text (never FTS5's snippet()), and its
                       # FTS5 match
  items/               # the fill's own modules
    fill-sentences.ts  # the sentence each failed reading is said in
    oembed.ts          # a media host's embed, asked and parsed
    page-fetch.ts      # a page's redirects and capped read, over the host's
                       # own hop rule, fetch and deadline
  imports/             # a Raindrop export read into saves, its highlights
                       # quoted in each one's note, over a CSV reader
  text/
    decode-text.ts     # a page's bytes decoded by the charset it declares
  zip/                 # the zip reader imports read by
  types/               # the highlight.js stub that keeps the DOM lib out, a
                       # DDL's `.sql` text and a suite's `?raw` import
  test-support/        # the suites' Worker (test-worker.ts), the schema setup,
                       # the client helpers and the test env's types, a cell
                       # and a conversation's loop under test, and the
                       # line-revert oracle undo is held to
```

## Invariants

- **The model is pure.** No I/O, clock, or crypto in the library model's
  modules (the `crypto` global is lint-refused there); callers supply the
  driver, the timestamps, the random bytes and every fresh id.
- **One grammar**, the editor's own (`@repo/editor/markdown/md-plugins`),
  which never throws, so a malformed tag cannot cost an imported note its
  blocks.
- **The Worker's code imports no config module.** `cloudflare.config.ts`
  loads `compatibility.ts`, `fill-queues.ts` and `agent-limits.ts`, and the
  dev server cannot load a module the config loads too, so the Worker reads
  their values from the bindings the config declares (`oxlint.config.ts`).

## Seams

- `doorsFor(env, ctx)` (`src/doors.ts`): a request's doors, each a
  fetch-shaped function of the request alone. `apps/web`'s entry puts them in
  Start's request context, where each door's server route reaches its own, and
  the suites' Worker dispatches to them by `DOOR_ROUTES`
  (`src/door-routes.ts`), the table those routes are held to. A door answers
  its own methods, its 405 and its own throw.
- `SqlPort` (`src/library/library-sql.ts`): one statement per call. The cell
  binds `ctx.storage.sql` to it, with `transactionSync` as its
  `transaction(work)`, and a plan (`library-queries.ts`) runs over it through
  `runPlan`.

## The doors

"session" is Better Auth's own, read once a request by the door it came
through (`src/wire/v1-principal.ts`): the site's page sends its cookie
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
(`src/wire/rpc-refusal.ts`). A request carrying `Authorization` is read from
its bearer alone, so one that does not verify is refused, never retried as the
cookie. A library call reaches the cell with the principal the session
verified, in `x-library-principal`, and nothing the caller sent in its place
(`src/wire/v1-rpc.ts`). A file is PUT with its `Content-Length` (at most
100 MB, room held in the cell first) and kept only if its bytes hash to its
sha; a read is answered its single range (206), the whole file for a multi-part
ask, 416 for a range past the end, and 304/412 for its preconditions, under a
script-less sandbox but for a PDF (`src/library/blob-routes.ts`).

Every `/v1` request an install sends names its build in
`x-inteligir-build: <semver>+<platform>` (`@repo/contract/client-build`), and
before any route reads it `src/client-floor.ts` refuses one that names none,
or a version below `MIN_CLIENT_BUILD` (`apps/web/cloudflare.config.ts`): 426,
as `CLIENT_OUTDATED` on `/v1/rpc` and in plain text on a file or an export.
The platform is telemetry and never compared. A request a browser marks
`Sec-Fetch-Site: same-origin` passes, since the site's own pages ship in this
deploy. The floor is how `/v1` retires a shape: raise it past every build that
reads the shape, then delete the shape.

The connector is an assistant's door alone: its OAuth is
`@cloudflare/workers-oauth-provider`'s on `OAUTH_KV`, which keeps the
assistants' registrations, grants and tokens, and its issuer and resource are
named from `SITE_ORIGIN`, one value per deployment, never the request's Host.
A call to `/connector` is refused 403 for a Host or Origin not this
deployment's, challenged 401 with its `resource_metadata` without a token this
Worker minted for it (a session of the person's is none), and forwarded into
the account's cell with an `assistant` principal once its grant's budget (300
calls a minute) holds (`src/connector/connector-route.ts`). A grant is
`library` (read and change) or `library:read`, as the person chose on the
consent page; the account's `assistants.list` and `assistants.revoke` name and
end them, and the account's deletion revokes every one.

## Auth

- `src/auth/auth.ts::createAuth(env, ctx, baseURL)` builds a **per-request**
  Better Auth instance (D1 is a runtime binding, not a module singleton;
  `baseURL` is the request origin, so localhost/preview/prod all work with no
  config). Two plugins: `bearer({ requireSignature: true })`, so the
  extension's bearer is the browser's signed cookie value and a session row's
  token alone opens nothing, and `expo()`, which reads the phone's
  `expo-origin` as its origin. Every answer drops `set-auth-token`
  (`withoutAuthToken`), since no client reads one. A session lasts 60 days,
  slid a day at a time, and a sign-in past twenty live sessions ends the one
  used longest ago (`src/auth/session-devices.ts`); a password reset ends every
  one. `disabledPaths` shuts every Better Auth route no client calls (the
  clients use sign-in, sign-out, `get-session`, the reset pair and, through the
  invite gate, sign-up). That includes its own `/delete-user`, so
  `account.delete` is the one way to delete an account; `auth.api.deleteUser`
  behind it is unaffected, as the list gates only HTTP. Only `/callback/:id`
  stays open: an exact list cannot name it, and with no social provider it has
  nothing to sign in with. `trustedOrigins` spells out the extension's origin
  and the phone's scheme beside the request's own, and Better Auth reads
  `BETTER_AUTH_TRUSTED_ORIGINS` itself, should another ever need trusting.
  `readSession` is a route of the Worker's own reading a session, which never
  slides it: only `/api/auth/get-session` answers with the cookie a slid row
  needs.
- **Sign-up is invite-gated by a Worker route in front of Better Auth**
  (`src/auth/invite.ts`). `POST /api/sign-up` parses its body with
  `signUpRequestSchema` (`@repo/contract/account/account-schema`, which the
  page, the gate and the e2e share with `AUTH_API_PATHS`) and refuses a
  password outside `PASSWORD_MIN_LENGTH`–`PASSWORD_MAX_LENGTH` before touching
  the code. It then claims the code in one atomic
  `UPDATE … WHERE redeemed_at IS NULL` and forwards into the one instance built
  with sign-up enabled — so the response (cookie, Better Auth's own refusals)
  is Better Auth's, untouched. Better Auth is configured with those same two
  bounds (`src/auth/auth.ts`), which the reset-password page and the apps'
  sign-in forms hold too. Every other caller's instance carries
  `disableSignUp`, which shuts `/api/auth/sign-up/email` and
  `auth.api.signUpEmail` together. The site's form and the phone's first run
  both post here, so the browser keeps Better Auth's cookie and the phone the
  one its Expo client stores; a refused sign-up releases the claim
  (`claimInvite` / `releaseInvite`), and every attempt spends one per-address
  window first.
- **Every device signs in on Better Auth's own route, and its devices are the
  account's sessions.** The site, the Mac app's window and the phone post
  `/api/auth/sign-in/email`; the extension signs in nowhere, riding the
  browser's sign-in to the site. A wrong password and an unknown address
  answer one refusal, under Better Auth's per-address limiter.
  `account.devices.list` names each live session from the user agent it
  signed in with, marks the one asking and selects no token;
  `account.devices.revoke` ends one by its id through Better Auth's adapter,
  whose `session.delete.after` closes its sockets (`src/wire/account-router.ts`,
  `src/auth/session-devices.ts`). Signing out is Better Auth's
  `/api/auth/sign-out`, which ends the session the request names and clears
  its cookie.
- **Rate limits live in D1** (`rate_limit` table): Better Auth's own database
  limiter on the auth routes, and the same table behind the invite gate's
  10/60s-per-IP window (`src/rate-limit.ts`). The window is one upsert that
  RETURNS the count it settled on — a read-then-write limiter lets N
  concurrent requests all read the same count and all decide they are under
  the cap, which is the burst it exists to stop. Every window keyed on an
  address, Better Auth's included, reads `cf-connecting-ip`
  (`CALLER_IP_HEADER`), the one address the edge writes itself, never
  `x-forwarded-for`, and counts an IPv6 address by its /64 (`CALLER_ADDRESS`),
  which one host holds whole. `/api/auth/get-session` spends no window: a
  session read is no password oracle, and every route guard and hover preload
  makes one. A read that fails is unknown to the route guards, never signed
  out (`apps/web/src/lib/auth-client.ts`). `/v1/rpc` and `/v1/blobs` spend the
  same table keyed on the HOLDER, the session, never the address: a stolen
  session moves between addresses, and the session is what Settings › Account
  ends. The connector spends it keyed on the assistant's grant. Each family is
  its own, so a drained budget never takes another down. An ended session's
  rows and a grant's wait for the prune. Better Auth prunes the shared table on
  its own writes, every row past its 60s window with it, so every Worker window
  is declared in `RATE_WINDOWS` and a guard holds each to 60s or less.
- **No CORS.** Every page that calls `/v1` is served by this Worker from this
  origin, the Mac app's window among them, and the browser extension's worker
  calls the site under its host permission, which needs none. CORS added
  later lets no `expo-origin` through: that header names the phone's door, and
  a page allowed to send it would read what the phone's cookie opens.
- **Deleting the account deletes the account's data** in a `beforeDelete` hook,
  so a failed step aborts the deletion rather than orphaning data, and the
  retry runs every step again. THE ORDER IS LOAD-BEARING
  (`src/library/account-purge.ts`): the library cell's tombstone first (every
  later call to the cell, a socket's included, is refused) and its sockets
  closed, then every conversation's object, while the cell's rows that alone
  name them are still there, then the cell's storage with the tombstone
  written back at once, then the account's files in R2, then every assistant's
  grant with its tokens, before the sessions that could let one in again, then
  the deleted email off the invite it spent (`redeemed_at` stays set, so the
  code stays burned); Better Auth deletes the sessions with the user, after
  the hook, so a failure leaves one to retry with. The tombstone stays, so a
  request that verified a moment before the sessions went founds no library.
  Any signed-in device asks it through `account.delete`
  (`src/auth/delete-account.ts`): the session's own call, a window of 5 a
  minute, and `auth.api.deleteUser` handed the password in its body, which it
  checks in place of the session's freshness, so this hook stays the one purge
  path. A session alone deletes nothing: whoever stole one could end the
  account. `docs/privacy.md` is the user-facing statement of all of it.

## The built-in agent

The agent is our own loop over the Messages API, one Durable Object a
conversation, `AgentThreadDO`, named `agent-thread:<accountId>:<threadId>` by
the account's cell alone and reached through `ctx.exports` with no namespace
binding. It imports `agents/lifecycle` and nothing else of Cloudflare's Agents
SDK: Lifecycle's durable job queue and its one alarm drive the loop, wake a
conversation whose instance died, and deny an approval nobody answered in ten
minutes. Its definition is code, the same bytes for every account: the model
and effort (`src/agent/library-agent.ts`), the system prompt
(`src/agent/agent-prompt.ts`, which `pnpm --filter @repo/service agent-prompt`
writes from `@repo/agent-skills`; edit the skills and run it, never the
module) and the tools (`agent-tools.ts`). A thread freezes them at its first
turn and replays them byte for byte; a deploy that changes them is taken up at
the start of the thread's next turn, never mid-turn, its requests from then on
carrying no thinking from before that turn.

A person's send (`library.agent.send`) is admitted in one transaction of the
account's cell: refused `SERVICE_UNAVAILABLE` while the agent is off or the
Worker has no Claude to call, `AGENT_BUDGET` once the day's turns or list cost
(`AGENT_ALLOWANCE`) are spent, queued behind its thread's open turn or while
the account runs two, and otherwise opened and handed to its thread's object,
again every 30 seconds until it lands. The object streams each model call
with previews to the account's sockets, every call asking the same
`max_tokens`, and lands only the whole reply, as returned, beside its usage; a
call an instance died reading is sent again whole, and a turn ends `budget`
before a call past its twentieth reply. A conversation past 50,000 input
tokens, the least the API compacts at, is compacted by the API inside the
request that reaches them, its summary landing with the reply, and every
request after carries the conversation from that summary on; at the API's
default of 150,000, a turn after a pause would write its whole prompt to the
cache again for 60 cents of a day's dollar. Every tool call runs in the cell
through the library's own procedures as that turn's, its write's op id
derived from the call's, so one run again lands once; a deletion waits for the
person. What the turn did reaches the cell as pushes, each once by its
sequence, stored as the thread's events, a short progress note before each
tool call among them, and each reply's usage, booked at list price
(`AGENT_PRICES`) on the day its turn started; the push that ends a turn seals
its one change set, gives back a turn Claude could not be reached for, never
one the person stopped, and lets the links it saved be read.

Claude is reached through the target's AI Gateway, on its provider-native
Anthropic route (`AGENT_GATEWAY_URL`): `inteligir` for production,
`inteligir-preview` for every Preview, each holding its target's own Anthropic
workspace key with provider credentials required and Authenticated Gateway
on, so the Worker holds no Anthropic key, only the gateway's `AI_GATEWAY_TOKEN`,
and every request asks the gateway to keep no prompt or reply and names the
conversation's account in `cf-aig-metadata`, which the gateway's per-account
spend limit splits by, bounding what no usage books: a stream cut before it
ended, and a day's last reply past its cost. A Worker with
no gateway refuses every send. `vite dev` names no target's gateway: the
root `.env` names the scripted Messages API or a gateway of the developer's
own (`.env.example`).

## Testing

`pnpm --filter @repo/service test` — vitest, each suite beside the module it
tests, in three projects (`vitest.config.ts`):

- `worker`: inside workerd through `@cloudflare/vitest-plugin`, on the suites'
  own Worker (`cloudflare.config.ts`, read by the plugin's `newConfig`), never
  the app's: the deployed Durable Objects and the Worker's doors without the
  site (`src/test-support/test-worker.ts`). A suite reaches the Worker through
  `exports.default.fetch()` and reads every response body to the end. The D1
  schema's DDL is `@repo/db`'s `export`, derived at config load and applied as
  one batch; the type claims (`*.test-d.ts`) run as tsc over this package's
  program beside them.
- `sockets`: the suites that open the account's socket, sharing one storage,
  since Durable Object WebSockets are unsupported under per-file isolation.
- `model`: the library model's pure suites, under node: `src/knowledge/` pins
  the search policy, and undo's properties (undo restores, undo agrees with
  its line oracle) draw from the contract's one seeded generator, and
  `turn-log.test.ts` holds Undo this turn to keeping every later edit and to
  flagging text inside a block the turn added. The library's
  SQL runs in `worker`, on a cell's own SQLite, which refuses what a Durable
  Object refuses. The model's suites run under a 512MB heap ceiling, so an
  allocation that grows with a note's size, like a diff trace that copies the
  whole frontier every round, fails here rather than passing on a default
  heap.

The built-in agent runs against the scripted Messages API
(`messages-service.ts`), the suites' outbound service, which refuses every
other address.

## Loop

```bash
pnpm --filter @repo/service generate      # the Env and runtime types, from cloudflare.config.ts
pnpm --filter @repo/service typecheck     # this program, and scripts/ under node
pnpm --filter @repo/service test          # the three projects above
pnpm --filter @repo/service agent-prompt  # rewrite the agent's prompt from @repo/agent-skills
```

The program and the type claims read the `Env` `generate` writes, which no
checkout holds until it runs: turbo runs it ahead of `typecheck` and `test`
(`pnpm turbo run test --filter @repo/service`), and a bare filter call needs
it run first. Running the Worker itself is `pnpm dev:web`
(`apps/web/README.md` § Dev).
