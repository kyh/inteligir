# @repo/service

The cloud's code: its doors, Better Auth, `/v1`, the connector, each account's
library cell, each item's note, the fill and each conversation with the
built-in agent. `apps/web`'s Worker entry serves its doors and exports its
Durable Objects, and nothing else ships it. Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md); the routes that reach each door are
`apps/web/README.md` § Routes.

## Why it exists

The cloud's rules are code no client runs, so they sit apart from the model
every client loads (`@repo/contract`), the dialect (`@repo/editor`), the
schemas (`@repo/db`) and the site (`apps/web`), as kyh/init's service package
does. Its program runs on workerd, typed by the `Env` `cf workers types`
generates from the suites' Worker (`cloudflare.config.ts`, never deployed).

## Layout

```
*.ts (root)     the values both configs read: workerd's date, the fill queues, the agent's allowance,
                the suites' scripted Messages API, and the suites' Worker
src/            the doors, their routes and the build floor, the rate limits, the object DDL applied on wake
  auth/         Better Auth per request, the invite gate, the reset mail, sessions as devices, deletion
  wire/         /v1's one wire: the principal a session verifies to, the account's rows, the library's
                forwarded to its cell, and what a refused call answers
  library/      the account's library cell: its engine, change sets and undo, files, listing, sockets,
                jobs, fills, imports, the agent's turns as it lands them, and the account's purge
  note/         each item's note object, its door, what it owes the cell and its turn log
  connector/    the connector's OAuth, consent page, route and per-request server
  agent/        the built-in agent: its definition and prompt, each conversation's object and loop, the
                cell's tools, allowance and switch
  fill/         the fill queue's consumer and the guarded fetch
  knowledge/    the one search query policy and its excerpt
  items/, imports/, text/, zip/   the fill's helpers, a Raindrop export, a page's charset, the zip reader
  types/        the DOM-free stubs the Worker's program reads
  test-support/ the suites' Worker and the harnesses a suite drives
```

## Seams

- `doorsFor(env, ctx)` (`src/doors.ts`): a request's doors, each a
  fetch-shaped function of the request alone, which `apps/web`'s routes reach
  through Start's request context and the suites' Worker by `DOOR_ROUTES`.
- `SqlPort` (`src/library/library-sql.ts`): one statement per call, which the
  cell binds to `ctx.storage.sql` and the search runs over.
- The clock, random bytes and fresh ids come into the model's modules as ports.

## The doors

`src/wire/v1-principal.ts` says which session each door reads (the tab's
cookie, the phone's under `expo-origin`, the extension's bearer);
`src/wire/rpc-refusal.ts` how `/v1/rpc` answers every refusal before a
procedure runs; `src/client-floor.ts` the build floor; `src/wire/v1-rpc.ts`
the principal a library call carries into its cell;
`src/library/blob-routes.ts` a file's bytes; `src/library/cell-fills.ts` and
`src/fill/` a link's reading off the queue; and
`src/connector/connector-route.ts` the connector, an assistant's door alone.

## Auth

`src/auth/auth.ts` builds Better Auth per request and shuts every route no
client calls; `src/auth/invite.ts` gates sign-up by invite in front of it;
`src/auth/session-devices.ts` makes the account's sessions its devices;
`src/rate-limit.ts` holds the D1 windows and the Rate Limiting bindings every
signed call spends; and `src/auth/delete-account.ts` with
`src/library/account-purge.ts` delete an account in the order the purge's
header gives. `docs/privacy.md` is the user-facing statement of all of it.

## The built-in agent

Our own loop over the Messages API, one `AgentThreadDO` a conversation
(`src/agent/agent-thread.ts`), its definition code (`library-agent.ts`), its
system prompt `@repo/agent-skills`'s files imported as text in the hub's order
(`agent-prompt.ts`), its tools the library's procedures run by the cell
(`agent-tools.ts`). The cell admits, queues and seals each turn
(`agent-turns.ts`), and Claude is reached through the AI Gateway
(`anthropic-client.ts`). `vite dev` names no production gateway: the root
`.env` names the scripted Messages API or a gateway of the developer's own.

## Testing

`pnpm --filter @repo/service test`, three vitest projects
(`vitest.config.ts`):

- `worker`: inside workerd on the suites' own Worker, the D1 DDL
  `@repo/db`'s `export` prints applied as one batch; the type claims
  (`*.test-d.ts`) run as tsc beside them.
- `sockets`: the suites that open the account's socket, sharing one storage,
  since Durable Object WebSockets are unsupported under per-file isolation.
- `model`: the library model's pure suites under node and a 512MB heap.

The built-in agent runs against the scripted Messages API
(`messages-service.ts`), which refuses every other address.

## Loop

```bash
pnpm --filter @repo/service generate      # the Env and runtime types, from cloudflare.config.ts
pnpm --filter @repo/service typecheck
pnpm --filter @repo/service test
```

`generate` writes what no checkout holds until it runs; turbo runs it ahead of
`typecheck` and `test`. Running the Worker is `pnpm dev:web`
(`docs/development.md`).
