# @repo/contract

ONE contract: `/v1`, the wire between every client and the Cloudflare Worker,
and the library's model both ends validate against. `v1` is that wire as one
oRPC contract on `/v1/rpc`, `account.*` answered by the Worker and `library.*`
by the account's library cell, typed by every client as `V1Client`. Beside it
are the plain-HTTP routes it names (a file's bytes, the account's socket), the
build every request names, `extension/`, the browser extension's identity and
the messages the site's connect page tells it where the site is with, and the
model: an item's fields and blocks, its field ops, a folder's order, a url's key and
what a page's reading keeps. Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md).

## Why it exists

`/v1` is a deployed Worker answering installs that may be months stale, so it
breaks only behind the client build floor: the Worker may grow an answer, a
client ignores what it does not know (the first invariant below), and a shape
retires once the floor is past every build that reads it, which costs nothing
while nobody but the owner holds an install (`AGENTS.md` § Project Overview).
It is one oRPC wire rather than REST routes beside an RPC path, because two
wires are two serializers, two error vocabularies and two clients; every
`@orpc/*` package is pinned to one exact beta so the serializer and the error
shape it owns move only with a deliberate bump. The library's rows are plain
contract rows: which of them an agent sees as a tool, and how, is decorated in
the Worker (`packages/service/src/connector/library-tools.ts`), so no client
bundle carries MCP or OpenAPI (`oxlint.config.ts` refuses either import
anywhere else).

The package is platform-neutral by construction (`lib: ["ES2023",
"WebWorker"]`, `types: []`): it loads in the Mac's and the browser's page, on
node, on workerd and in React Native, and `oxlint.config.ts` refuses a node or
react import here, and the `crypto` and `URL` globals in the model, and its
`package.json` names no workspace, no `@tauri-apps` and no markdown parser, so
no client bundles the service's code or `@repo/db`'s drizzle. Callers supply
the clock, the random bytes and every fresh id. It is kyh/init's contract
package, but for one edge: init's reads its db, and here `@repo/db` reads this
one (`apps/web/CLAUDE.md`).

## Layout

```
src/
  v1-contract.ts       # /v1's one oRPC wire: account.* and library.*, and the client type over it
  v1-errors.ts         # every refusal /v1 answers, declared once, and the status map every handler uses
  refusal-text.ts      # what a screen says of a failed call: a declared refusal's own sentence, else its fallback
  needs-connection.ts  # what every screen says of a call only the cloud answers while there is no connection;
                       #   oRPC-free, so the editor and the phone's DOM bundle load it
  account/             # the account's rows (account-contract.ts) and what they carry (account-schema.ts):
                       #   the password's bounds, its devices, each a signed-in session, its deletion and
                       #   the sign-up form
  library/             # the library's rows (library-contract.ts), the shapes they carry (library-wire.ts),
                       #   the agent's events, a file's route, the socket's frames and address (library-socket.ts)
                       #   and what a failed call means (call-outcome.ts);
                       #   and the model: the persisted node set (library-nodes.ts), an item's capped fields
                       #   (library-item.ts), what each make's fields are (item-makes.ts), the field ops
                       #   each naming its base, a list's merge and sameness (field-ops.ts), the order
                       #   keys a folder sits among its siblings by (order-key.ts), the content hash
                       #   (content-hash.ts), one spelling of a JSON value, the card, text and links
                       #   derived from an item (derive-item.ts), the listing over the cell's rows in
                       #   memory (library-index.ts) and a sortable id
  items/               # what an item is on every device: its kinds, a url's ONE key with no platform URL
                       #   (item-url.ts), a page's title as a name, a host's spelling, a read page's facts,
                       #   how much of a page a fill reads and which picture is its cover, a file's type by
                       #   its bytes
  knowledge/           # the tag name with no imports, what a markdown file is, the mark of this app's
                       #   folder of files and the folder tree's paths
  text/                # a text clipped to a cap, and a url part percent-decoded
  iso-date.ts          # a Date → local `YYYY-MM-DD`, the only date text shared
  library-scope.ts     # the library's scopes, one spelling every listing and view context reads
  client-build.ts      # the build every request names, and the floor it is held to
  cloud-origin.ts      # the production origin a client falls back to
  library-page.ts      # where the site serves the library tab
  connector.ts         # the connector's path, which an assistant is pointed at
  bytes.ts             # the byte primitives, on globals every target has
  extension/           # the extension's key, id, origin and store link, and the connect page's messages
  test-support/        # the fake cell, sockets, clock and deferred every client's suites drive, the seeded
                       #   generator every property replays, and library items to build a suite from
```

## Who consumes it

- **packages/service** SERVES every row, the account's on the Worker's own
  handler and the library's in each account's cell, and decorates the
  library's rows as the connector's tools, the one place MCP and OpenAPI meta
  are written; `apps/web`'s entry deploys it. **packages/db** holds the cell's
  columns to the model's vocabularies, and **packages/editor** reads and
  writes the model's blocks.
- **apps/web/src/library** (the browser tab, and the Mac app's window on it) reaches
  the library and the account through `v1`, each read a query under
  oRPC's own key that the account's socket invalidates
  (`library/library-socket`). **apps/mobile** reaches them the same way,
  its query cache kept between launches.
- **Every app's suites** drive the fake cell, sockets and clock in
  `test-support/`, the contract's rows answered in memory.
- **apps/extension** reaches the library's saves and the account's sign-out
  through `v1`, and its connect page's messages through
  `extension/`: a browser install updates on the Web Store's cadence, so
  the one build floor holds it as it holds the others.

## Invariants

- **`/v1` reads leniently and is written strictly.** The Worker parses every
  answer through its row's output schema, which strips what the row did not
  declare, and a client reads only the fields it names, so a newer Worker may
  add one and an older build reads on. Requests stay `z.strictObject`: only the
  always-newest Worker parses them. A field that changes what a row MEANS still
  reaches only a client whose request declares it, because ignored, the row
  reads as something else.
- **`/v1`'s refusals are declared once and mapped once.** Each is an `error()`
  factory in `v1-errors.ts`, registered on the rows that can raise it and
  oRPC's own code wherever it means the same thing (`PAYLOAD_TOO_LARGE`,
  `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`); `V1_ERROR_STATUS_MAP` is every
  `/v1` handler's status map, since an unmapped code answers 400.
  `v1-contract.test.ts` holds it to exactly the custom codes the rows
  declare and answers each through a real handler and link. An error no row
  declares is never a verdict on a session: it is a fault a client retries,
  but for `BAD_REQUEST`, which says the call can never land as it is.
- **Every library write takes an optional `opId`**, which the cell keeps, so
  a save queue resending after a lost answer lands once; the test names each read
  it exempts. A field write names the value it was computed from, and
  `CONFLICT` carries what it met; a body is its note's, written live.
- **No row is named after a property every function has** (`apply`, `call`,
  `bind`): a client's path is read off a proxy over a function, so
  `client.library.apply` would be `Function.prototype.apply` (hence
  `library.write`).
- **Every request names its build, and the Worker refuses one below its
  floor.** `x-inteligir-build` rides every call, a file's too
  (`client-build.ts`); `CLIENT_OUTDATED` ends a sign-in as outdated, not signed
  out: the session stands, and only an update moves past it. A page the
  Worker served names none, and the socket opens on a ticket a call minted.
- **One spelling per route path.** `V1_RPC_PATH` and `LIBRARY_PAGE_PATH` are
  their paths' one spelling, but for a route the site's router types, and every
  `/v1` route here keeps a row in `docs/privacy.md`.
- **The socket's `moved` frame is a hint, never state.** It says what a write
  moved, and a client reads that again over `/v1`. A `preview` frame carries the
  reply the agent is writing, which no read ever answers, and a `moved` frame
  naming its thread lets it go. Each frame is JSON, and one of a type a build does not know is no
  frame at all, so a newer cell can add types
  (`library/library-socket.ts`).

## Testing

`pnpm --filter @repo/contract test` — vitest, no platform. `/v1`'s rows and
refusals are exercised in process, over a real `RPCHandler` and `RPCLink`
(`v1-contract.test.ts`), and the account's request shapes by their schemas
(`account/account-schema.test.ts`). The model's properties draw from the one
seeded generator (`test-support/seeded-random.ts`), and the suites run under a
512MB heap ceiling (`vitest.config.ts`), so an allocation that grows with a
note's size fails here rather than passing on a default heap.

## Loop

```bash
pnpm --filter @repo/contract test        # vitest, no platform
pnpm --filter @repo/contract typecheck
```

A change to a row reaches every client and the Worker at once: run the
service's suites (`pnpm --filter @repo/service test`) and the e2e flows
that drive the row, since the contract's own suites answer it only in process.
