# @repo/service

The cloud's code, which `apps/web` serves: the environment it reads, one zod
schema in `src/env.ts`, accounts on Better Auth over Postgres, the connector,
`/v1/rpc`, the library's reads and writes on Postgres, its files, jobs and
fills, and the built-in agent's side of eve.
Its decisions are this package's [`CLAUDE.md`](CLAUDE.md).

## Layout

```
src/env.ts              every key the cloud reads, parsed once
src/app-url.ts          the deployment's one origin: Better Auth's baseURL, llms.txt's connector
src/rate-limit.ts       the app's own windows on Better Auth's rate_limit table
src/auth/auth.ts        the two Better Auth instances, the session reads, the token strip
src/auth/auth-route.ts  /api/auth/*: the six routes a client calls, a 404 to the rest
src/auth/invite.ts      POST /api/sign-up: claim the code, forward, release on failure
src/auth/send-email.ts  the reset mail's one transport, in EMAIL_MODE's way
src/auth/oauth.ts       the connector's sign-in: Better Auth's OAuth provider and cimd, PKCE
src/mcp/connector-server.ts /connector: the library's tools to a connected assistant, its grant read each call
src/seed.ts             pnpm db:seed: the dev account and DEV-INVITE
src/rpc/v1-rpc.ts       /v1/rpc: admit, then the whole contract's rows, a fault in the protocol
src/rpc/admit.ts        the build floor, the door and its session, before a call is read
src/rpc/orpc.ts         the contract's implementer, its context the admitted principal
src/rpc/account-router.ts account.devices.* and account.delete
src/rpc/rpc-refusal.ts  a refusal or fault outside every row, in the RPC protocol
src/rpc/library-router.ts the library's rows: library/library-read-rows.ts and library-write-rows.ts
src/library/library-access.ts  reading and writing: the caller, the read-only grant, each refusal's error
src/library/library-principal.ts who a call is by: a session, a connector grant, an agent turn
src/library/library-store.ts every library write: the account's lock, the sequence, the op ledger, attempts
src/library/library-landing.ts one item's change: every rule, then its rows
src/library/library-items.ts   notes and files made, organize, Deleted and back, Deleted emptied
src/library/library-writes.ts  an item's fields landed, a device's property ops
src/library/library-folders.ts the folder tree's writes, a path filed into
src/library/library-rows.ts  an item's rows to and from the library model
src/library/file-names.ts      the files the library's rows name, and touched_at
src/library/library-listing.ts listings, the rail's counts and titles, under one read snapshot
src/library/library-reads.ts an item whole or as markdown, an agent's list and search
src/body/write-body.ts       a body written over the version its writer read: a save, an edit once made
src/body/edit-body.ts        an agent's edit by passages, made outside the write and made again if stale
src/library/article-body.ts     a page's article set on a body, the note kept
src/files/file-landing.ts    a file's reserve and settle: the store's upload URL, then its bytes hashed and kept
src/files/file-store-of.ts   which store keeps files: Blob, a folder off Vercel, or none
src/rpc/file-read-route.ts /v1/blobs/<sha>: HEAD, preconditions and ranges from the row, the bytes streamed
src/library/job-queue.ts        the job table: ask, lease under skip locked, finish, retry by backoff
src/jobs/job-kinds.ts        what each kind of job runs, its payload's schema and its tries
src/jobs/drain-jobs.ts       the drain: a kick after a write's response, /api/cron/jobs every minute
src/jobs/housekeeping.ts     /api/cron/housekeeping hourly: the prunes, the files let go, deleted accounts' files
src/files/file-release.ts    a file unnamed a day: its row deleted, its object removed by a job
src/files/deleted-account-files.ts the store's folders of accounts that are gone, emptied at the store's pace
src/fill/fill-run.ts         the fill job: a saved link's page read, its files kept, its reading landed
src/fill/read-page.ts        a page fetched and read by @repo/page-reader into a landing
src/fill/page-fetch.ts       the guarded read: each hop's address judged, redirects, caps, a deadline
src/fill/public-dispatcher.ts the Agent whose lookup refuses a name that resolves into private space
src/fill/fill-landing.ts     a reading landed on an item still waiting for it
src/files/pdf-text-run.ts    the pdf-text job: a PDF's words read after it lands, kept as its article
src/search/search-vector.ts  an item's tsvector literal, from search-query.ts's tokenizer
src/search/search-sql.ts     a search's two tiers, words and the literal, and each hit's passage
src/eve/eve-agent.ts       what eve asks of the app: the library tools as the turn, the record and limits hooks
src/agent/eve-admission.ts   who may reach an eve session: the app's token for that thread
src/agent/agent-sessions.ts  a thread over its eve sessions: send, stop, delete
src/agent/relay.ts           a thread's events, kept then live, as one stream
src/agent/agent-limits.ts    the day's allowance and dollar ceilings, from the agent_usage ledger
src/eve/agent-cron.ts      /api/cron/agent every 15 minutes: stranded turns, deleted threads, the ledger's month
src/background.ts            work after a response, inside its route's maxDuration
```

`apps/web` mounts the three handlers (`src/app/api/auth/[...all]/route.ts`,
`src/app/api/sign-up/route.ts`, `src/app/v1/rpc/[...rest]/route.ts`) and reads
a page's session through `src/lib/auth-server.ts`.

## Seed

```bash
pnpm db:seed    # into the database POSTGRES_URL names (.env.local); no server needed, safe to run again
```

It makes `dev@inteligir.local` / `password` (again, if the account is there
under another password) and the open invite `DEV-INVITE`.

## Testing

One vitest project under node, with `@repo/db`'s database setup: a suite that
reaches Postgres is a `dbSuite`, which runs only with `TEST_POSTGRES_URL` set
(`packages/db/README.md` § Testing). The account suites hand requests to the
route handlers themselves, each from an address of its own, with the limiter on
and mail in log mode, where a test reads the reset link off the log.

```bash
TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:54622/wt_<name> pnpm --filter @repo/service test
```

Every suite keeps its files in a folder of its own. The file store's contract
(`src/files/file-store.contract.test.ts`) runs against private Vercel Blob as
well when the run is given the store's key, which reaches that suite alone:
under a root of the run's own, which it removes at the end, about 2,000 Blob
operations over a minute, a prefix past one page of 1,000 among them. CI is
never given it.

```bash
BLOB_READ_WRITE_TOKEN=<the store's key> pnpm --filter @repo/service test -- files/file-store.contract
```
