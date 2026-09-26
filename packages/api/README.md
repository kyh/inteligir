# @repo/api

ONE contract package, TWO entry points. `@repo/api/local` is the oRPC contract
the desktop renderer and the CLI compile against and `inteligir serve`
implements. `@repo/api/cloud` is the wire between an install and the Cloudflare
Worker — and the client runtime core both the CLI and the phone run over it.

## Why it exists

Two entries rather than one router because their compatibility obligations are
OPPOSITE. `/local`'s two ends ship in one bundle, so it may break freely on any
commit; a CLI installed apart from the app is refused by the release the
server's `server.json` names, not kept compatible. `/cloud` is a deployed
Worker answering installs that may be months stale, so it may never break: the
Worker may grow an answer, and a client ignores what it does not know (the
first invariant below). That is also
why `/cloud` is zod + REST paths and NOT oRPC, diverging from the decision
record (#611 phase 6) deliberately: oRPC addresses a procedure by its position
in the router, so moving the deployed wire onto it would break exactly the
installs `/cloud` exists to keep.

The package is platform-neutral by construction (`lib: ["ES2023",
"WebWorker"]`, `types: []`): it loads in the Electron renderer, on node, on
workerd and in React Native, and `tools/repo-guards` refuses a node, react or
electron import here.

## Layout

```
src/
  local/               the oRPC contract — ONE folder per domain
    local-contract.ts  # the router: agents · cloud · comments · connectors ·
                       # folders · knowledge · system · threads · vault
    <domain>/          # each is a `<domain>-contract.ts` (rows: input, output,
                       # and ONLY the error classes that row can raise) beside
                       # a `<domain>-schema.ts` (the zod shapes)
    local-errors.ts    # the custom error classes and LOCAL_ERROR_STATUS_MAP,
                       # checked exhaustive: oRPC carries no status on an error,
                       # and a code with no entry would answer 500 silently
    local-routes.ts    # the paths that are NOT procedures: /health, /vault/asset
                       # (bytes + etag + sandbox csp), /html-frame (the document
                       # a note's html block runs in) and /ws
    notifications.ts   # the /ws frame grammar: subscribe/unsubscribe in, hello
                       # and `changed` pings out — never a payload
    thread-timeline.ts # the timeline row grammar, and the delta algebra
                       # (computeTimelineDelta / applyTimelineDelta): rows
                       # whole, a held turn as a patch of the children that moved
    build-thread-timeline.ts  # the pure fold from stored events into rows —
                       # deterministic, ids included, because the server diffs
                       # two projections into one delta
  cloud/               the never-break wire, plus the client runtime core
    cloud-errors.ts    # CLOUD_ERROR_CODES, the ONE code→status map, and which
                       # codes end a session vs. condemn an outbox position
    cloud-client.ts    # fetch over the paths: a refusal is a VALUE (CloudResult),
                       # never a throw, so the sync loop switches on the code
    cloud-origin.ts    # the production origin, the one spelling both clients
                       # fall back to when nothing names another
    bytes.ts           # hex/base64/sha256/constant-time compare on web-crypto
                       # globals alone, and the utf-8 byte count the row cap
                       # is held in — the leaf that loads everywhere
    device/            # DEVICE_API_PATHS, the igd_ credential grammar, and
                       # login-flow.ts — the one spelling of "join an account"
    sync/              # SYNC_API_PATHS and the opaque-body event rows;
                       # plan-page.ts (the ONE page planner every reader of the
                       # merged log runs); sync-session.ts (the id-fenced
                       # session, pullPages, the single-flight pass); sync-ws.ts
                       # (the bare ping frames); fit-sync-event.ts (the clip
                       # that fits an over-cap event to one row, payload text
                       # only, so a peer's fold settles it the same)
    captures/          # at-least-once delivery, exactly-once deletion by claim
    account/           # /v1/account — its own route, because 0.4.0 and older
                       # read the login answer strictly
    vault/             # VAULT_API_PATHS, the hosted tree/file/files/asset
                       # shapes and ceilings, VAULT_GIT_PATH, and the asset
                       # media-type allowlist the desktop and Worker routes share;
                       # vault-commit-schema.ts is the phone's write: a change
                       # set CAS'd per path, its 409 conflict beside the
                       # envelope, and the one collision key a Mac compares by
```

## Who consumes which half

- **apps/web** SERVES every `/cloud` row and reaches nothing under `/local`;
  `dep-dag.test.ts` pins that per import.
- **apps/cli** implements `/local` and, in `src/server/cloud/`, consumes all
  of `/cloud` — push, pull, claim, ack, the git remote.
- **apps/mobile** pulls threads, produces captures and commits vault change
  sets (`vaultCommit`), and never pushes thread events, claims a capture or
  speaks git, because the desktop runs the turns and owns applying a capture
  to the vault. It reaches nothing under `/local`
  either, pinned by the same `dep-dag.test.ts` table (`CLOUD_ONLY_CLIENTS`) as
  apps/web: a phone install may be months stale against the deployed Worker.
- **apps/desktop** compiles against `/local` (plus `cloud/bytes`, once).

## Invariants

- **`/cloud` reads leniently and is written strictly.** Every response schema
  strips a field it does not declare, so a newer Worker may add one and this
  build reads on; a refusal code it does not know reads as `internal`, a fault
  to retry in the Worker's own words, never a verdict on the credential.
  Requests stay `.strict()`: only the always-newest Worker parses them. The
  Worker's tests hold every answer to exactly the declared shape (`emitted` in
  `apps/web/src/worker/__tests__/cloud-helpers.ts`), since a stripping client
  would let a leaked column through. Two things stay closed: 0.4.0 and older
  parse every response strictly, so a field they must read rides a new route;
  and a field that changes what a row MEANS (a new capture kind) reaches only
  a client whose request declares it, because stripped, the row reads as the
  old kind.
- **`src/` holds exactly two buckets.** The cloud-never-reaches-local guard
  populates itself from `src/cloud`, so a file outside both halves is one no
  guard reads; `dep-dag.test.ts` refuses a third. The sanctioned crossing is
  `local` importing a `cloud` constant (`local/vault/vault-schema.ts` takes the
  asset ceiling and the hash helpers; `local/cloud/cloud-schema.ts` the device
  name bound) — a number copied by hand passes locally and is refused at the
  Worker as a shape error. The other direction never.
- **Every local row declares only the error classes it can raise.** A base
  carrying every class hands each client switch unreachable branches; the
  vault rows' declared set is held against the handlers by
  `apps/cli/src/server/vault/__tests__/vault-contract-errors.test.ts`.
- **One page planner.** Two copies of `sync/plan-page.ts` would be two answers
  to "did this row move the cursor?", and a mis-set cursor is a duplicated
  conversation. The same reason keeps the session fence, the login flow and
  the single-flight pass here rather than in each client: a security
  discipline with two spellings is two to audit. A skip step names the lowest
  foreign row it moves past unread (`firstUnparsed`), so a client that keeps
  its cursor can pull that row again under a build that reads it.
- **The cloud client never throws a refusal.** `CloudResult` carries
  `refused` (a code this build names, `internal` for one it does not),
  `unreachable` (no verdict on the credential) or `malformed` (a body this
  build cannot read); an `Error("HTTP 409")` would retry a batch the server
  refuses forever. One refusal is an answer: `vaultCommit` reads a 409
  `vault-conflict` as the value `{ kind: "conflict" }`, since it carries the
  bytes to merge against, while any reader that knows only the envelope,
  `readCloudCall` included, still sees the refusal.
- **One spelling per route path.** `route-paths.test.ts` sweeps the repo for
  the literal strings behind `@repo/api/local/routes` and `VAULT_API_PATHS`
  and refuses a second spelling outside the file that owns it.
- **The `/ws` frame grammar is strict outbound, lenient inbound.** The
  `.strict()` schemas type what the server broadcasts and are what its tests
  parse the frames with; no broadcast is parsed at runtime. A client parses
  with the lenient twin, or a long-lived tab against a newer server drops whole
  messages over an additive change. Client→server frames stay strict: an
  unknown field is an unknown client, closed 1008.
- **A turn row's `sourceSeqEnd` names its own contributors**, not every
  turn-scoped event: a streaming assistant message is turn-scoped but lands
  top-level, and counting it moved the turn row and resent the subtree per
  token.
- **A held turn moves as a patch, and a command row carries a head.** A turn
  holds its whole turn's work, so the delta sends its own fields and only the
  children past the base; a command row carries its first lines and the count
  of the rest, never the output. Both bound what one streamed token costs on
  the wire.

## Seams

- `CloudFetch` / `CloudEndpoint` (`cloud-client.ts`): the client takes a
  fetch and a signal, composed with its own 30s per-request timeout, so a
  shutdown never waits out a hung request and vice versa.
- `CloudSocketOpener`: the socket dial is platform code — a browser-program
  import of a node dial types `WebSocket` as the DOM one, which takes no
  headers, and the bearer rides the upgrade — so each consumer injects its own.
- `DeviceCredentialStore` (`device/login-flow.ts`): where the credential lands
  is the only thing the CLI and the phone supply to the login flow.

## Testing

`pnpm --filter @repo/api test` — vitest, no platform. `src/cloud/__tests__/`
pins the contract shapes and refusals (and that every answer a newer Worker
grows still reads), the login flow, the session fence and single-flight, the
byte primitives, the sync clip (every event type fits the cap with its envelope
untouched), and that the cloud vault-path grammar admits exactly what
`parseVaultPath` returns unchanged; `src/local/**/__tests__/` pin the timeline
fold and delta algebra, the `/ws` strict/lenient pair, each domain's schemas and
the restore composition; `knowledge/__tests__/engine-mirror.test.ts` is
type-level and fails under `tsc`, not `vitest`.
