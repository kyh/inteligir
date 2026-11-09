# @repo/service

The cloud's code: its doors, Better Auth, `/v1`, the connector, each account's
library cell with its SQL, search, undo and imports, the fill and each
conversation with the built-in agent. `apps/web`'s entry serves its doors and
exports its Durable Objects, and nothing else ships it. The decisions it
carries are `apps/web/CLAUDE.md`'s (the cloud) and this package's `CLAUDE.md`
(the library model).

## Why it exists

The cloud's rules are code no client runs, so they sit apart from the model
every client loads (`@repo/contract`), the dialect's markdown (`@repo/editor`)
and the site (`apps/web`). Its program has no DOM: it runs on workerd, typed
by the runtime `cf workers types` generates from the suites' Worker
(`cloudflare.config.ts`), and the app's Worker program checks every module its
entry reaches against the deployed `Env` again. No node or react import (the
root `oxlint.config.ts`), and the library model's modules (`src/library/`'s
SQL and undo, `src/knowledge/`, `src/items/`, `src/imports/`, `src/text/`)
take no `crypto` or `URL` global either: the clock, random bytes and fresh ids
come in as ports. The cell's SQL is the Durable Object's own, drizzle over
`@repo/db`'s cell schema with raw plans beside it, so every suite that reaches
it runs in workerd.

## Layout

```
compatibility.ts       # workerd's date and flags, for both configs
fill-queues.ts         # the fills' queues, for both configs and the suites
agent-limits.ts        # the built-in agent's allowance and list prices
messages-service.ts    # the suites' outbound service: the scripted Messages API
cloudflare.config.ts   # the suites' Worker, never deployed
scripts/agent-prompt.ts  # writes src/agent/agent-prompt.ts from @repo/agent-skills
src/
  doors.ts             # the route table apps/web's entry answers its paths by
  auth/                # Better Auth factory, invite gate, reset email, the
                       # account's sessions as its devices, account deletion
  wire/                # /v1's one wire: the floor, the principal a session
                       # verifies to (v1-principal.ts), the account's rows on
                       # the Worker's own handler (account-router.ts), and the
                       # library's forwarded to its cell (v1-rpc.ts)
  library/             # the account's library cell: LibraryDO (library-do.ts),
                       # its engine over the cell's SQLite (library-engine.ts:
                       # writes, change sets, undo, quota, files), every library
                       # procedure over it and the markdown codec
                       # (library-router.ts, served by library-rpc.ts), what the
                       # apps read (cell-listing.ts), the alarm's jobs, the
                       # account's purge in order (account-purge.ts), its
                       # sockets and what each write moved for them
                       # (cell-moved.ts), the upgrade routes with the ticket a
                       # browser's socket opens on, the files' bytes in R2
                       # (blob-routes.ts), the readings it sends to the fill
                       # queue (cell-fills.ts) and its imports (cell-imports.ts);
                       # beside the cell, the library's page, answered from the
                       # assets (library-page.ts). The library's SQL and undo:
    cell-db.ts         # drizzle over the cell, its migrations run on wake,
                       # inserts cut under the bound-parameter cap
    library-sql.ts     # the raw port, plans as generators, statement chunking
    sql-value.ts       # a SQL value and row as zod
    library-queries.ts # an item's rows: drizzle for its row and derived rows,
                       # plans for its blocks and the search index
    revert-change.ts   # a change set taken back three ways, the set's after
                       # as the base, newest set first
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
                       # (thread-schema.ts), its loop (thread-loop.ts), its
                       # requests (thread-request.ts) and its client through AI
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
  rate-limit.ts        # the D1 fixed window every throttled route spends
  types/               # the highlight.js stub that keeps the DOM lib out, and
                       # the type of a suite's `?raw` import
  test-support/        # the suites' Worker (test-worker.ts), the schema setup,
                       # the client helpers and the test env's types; SQLite's
                       # wasm behind a Durable Object's refusals, a Raindrop
                       # export to import, and the line-revert oracle undo is
                       # held to
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

- `answerDoor` (`src/doors.ts`): the one fetch-shaped function `apps/web`'s
  entry hands every path `ownsPath` claims, and the suites' Worker its every
  request.
- `SqlPort` (`src/library/library-sql.ts`): one statement per call. The cell
  binds `ctx.storage.sql` to it, with `transactionSync` as its
  `transaction(work)`, and a plan (`library-queries.ts`) runs over it through
  `runPlan`.

## Testing

`pnpm --filter @repo/service test` — vitest, each suite beside the module it
tests, in three projects (`vitest.config.ts`):

- `worker`: inside workerd through `@cloudflare/vitest-plugin`, on the suites'
  own Worker (`cloudflare.config.ts`, read by the plugin's `newConfig`), never
  the app's: the deployed Durable Objects and the Worker's doors without the
  site (`src/test-support/test-worker.ts`). A suite reaches the Worker through
  `exports.default.fetch()` and reads every response body to the end. The D1
  schema's DDL is `@repo/db`'s `export`, derived at config load and applied as
  one batch.
- `sockets`: the suites that open the account's socket, sharing one storage,
  since Durable Object WebSockets are unsupported under per-file isolation.
- `model`: the library model's pure suites, under node: `src/knowledge/` pins
  the search policy, and undo's properties (undo restores, undo agrees with
  its line oracle) draw from the contract's one seeded generator. The library's
  SQL runs in `worker`, on a cell's own SQLite, which refuses what a Durable
  Object refuses. The model's suites run under a 512MB heap ceiling, so an
  allocation that grows with a note's size, like a diff trace that copies the
  whole frontier every round, fails here rather than passing on a default
  heap.

The built-in agent runs against the scripted Messages API
(`messages-service.ts`), the suites' outbound service, which refuses every
other address.
