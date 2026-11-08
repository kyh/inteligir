# @repo/contract

ONE contract: `/v1`, the wire between every client and the Cloudflare Worker.
`cloud/v1` is that wire as one oRPC contract on `/v1/rpc`, `account.*` answered
by the Worker and `library.*` by the account's library cell, typed by every
client as `V1Client`. Beside it are the plain-HTTP routes it names (a file's
bytes, the account's socket), the build every request names,
and `cloud/extension`, the browser extension's identity and the messages the
site's connect page hands it a credential with.

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
the Worker (`apps/web/src/worker/connector/library-tools.ts`), so no client
bundle carries MCP or OpenAPI (`oxlint.config.ts` refuses either import
anywhere else).

The package is platform-neutral by construction (`lib: ["ES2023",
"WebWorker"]`, `types: []`): it loads in the Mac's and the browser's page, on
node, on workerd and in React Native, and `oxlint.config.ts` refuses a node or
react import here, `tools/repo-guards` a `@tauri-apps` one.

## Layout

```
src/
  cloud/
    v1-contract.ts     # /v1's one oRPC wire: account.* and library.*, and the client type over it
    v1-errors.ts       # every refusal /v1 answers, declared once, and the status map every handler uses
    refusal-text.ts    # what a screen says of a failed call: a declared refusal's own sentence, else its fallback
    account/           # the account's rows (account-contract.ts), its deletion and the sign-up doors (account-schema.ts)
    device/            # the device credential, its sign-in and the account's devices
    library/           # the library's rows (library-contract.ts), the shapes they carry (library-wire.ts),
                       #   the agent's events, a file's route, and the socket's frames
    client-build.ts    # the build every request names, and the floor it is held to
    cloud-origin.ts    # the production origin a client falls back to
    library-page.ts    # where the Worker serves the library's page
    connector.ts       # the connector's path, which an assistant is pointed at
    bytes.ts           # the byte primitives, on globals every target has
    extension/         # the extension's key, id, origin and store link, and the connect page's messages
```

## Who consumes it

- **apps/web** SERVES every row, the account's on its own handler and the
  library's in each account's cell, and decorates the library's rows as the
  connector's tools, the one place MCP and OpenAPI meta are written.
- **apps/workspace** (the browser tab, and the Mac app's window on it) and
  **apps/mobile** reach the library through their replica
  (`@repo/library-replica`) and the account through `cloud/v1`.
- **apps/extension** reaches the library's saves and the account's sign-out
  through `cloud/v1`, and its connect page's messages through
  `cloud/extension`: a browser install updates on the Web Store's cadence, so
  the one build floor holds it as it holds the others (`DECLARED_EDGES` in
  `tools/repo-guards/src/dep-dag.test.ts`).

## Invariants

- **`/v1` reads leniently and is written strictly.** The Worker parses every
  answer through its row's output schema, which strips what the row did not
  declare, and a client reads only the fields it names, so a newer Worker may
  add one and an older build reads on. Requests stay `z.strictObject`: only the
  always-newest Worker parses them. A field that changes what a row MEANS still
  reaches only a client whose request declares it, because ignored, the row
  reads as something else.
- **`/v1`'s refusals are declared once and mapped once.** Each is an `error()`
  factory in `cloud/v1-errors.ts`, registered on the rows that can raise it and
  oRPC's own code wherever it means the same thing (`PAYLOAD_TOO_LARGE`,
  `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`); `V1_ERROR_STATUS_MAP` is every
  `/v1` handler's status map, since an unmapped code answers 400.
  `cloud/v1-contract.test.ts` holds it to exactly the custom codes the rows
  declare and answers each through a real handler and link. An error no row
  declares is never a verdict on a credential: it is a fault a client retries,
  but for `BAD_REQUEST`, which says the call can never land as it is.
- **Every library write takes an optional `opId`**, which the cell keeps, so
  an outbox resending after a lost answer lands once; the test names each read
  it exempts. A write names the base it was computed from (a block's hash, a
  field's value), and `CONFLICT` carries what it met.
- **No row is named after a property every function has** (`apply`, `call`,
  `bind`): a client's path is read off a proxy over a function, so
  `client.library.apply` would be `Function.prototype.apply` (hence
  `library.write`).
- **Every request names its build, and the Worker refuses one below its
  floor.** `x-inteligir-build` rides every call, a file's too
  (`client-build.ts`); `CLIENT_OUTDATED` ends a sign-in as outdated, not signed
  out: the credential stands, and only an update moves past it. A page the
  Worker served names none, and the socket opens on a ticket a call minted.
- **One spelling per route path.** `tools/repo-guards/src/route-paths.test.ts`
  sweeps the repo for the literal strings behind `V1_RPC_PATH` and
  `LIBRARY_PAGE_PATH` and refuses a second spelling outside the file that owns
  it, and `privacy-routes.test.ts` holds every `/v1` route here to a row in
  `docs/privacy.md`.
- **The socket's `library` frame is a hint, never state.** It says the library
  moved, and a pull carries what did. A `thread` frame carries the agent's turn
  as it moves: an event the thread's next pull holds too, or a preview no pull
  ever does. Each frame is JSON, and one of a type a build does not know is no
  frame at all, so a newer cell can add types
  (`cloud/library/library-socket.ts`).

## Testing

`pnpm --filter @repo/contract test` — vitest, no platform. `/v1`'s rows and
refusals are exercised in process, over a real `RPCHandler` and `RPCLink`
(`cloud/v1-contract.test.ts`), and the account's request shapes by their
schemas (`cloud/account/account-schema.test.ts`).
