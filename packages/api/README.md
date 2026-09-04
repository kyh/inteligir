# @repo/api

ONE contract package, TWO entry points. `@repo/api/local` is the oRPC contract
the desktop renderer and the CLI compile against and `inteligir serve`
implements. `@repo/api/cloud` is the wire between an install and the Cloudflare
Worker — and the client runtime core both the CLI and the phone run over it.

## Why it exists

Two entries rather than one router because their compatibility obligations are
OPPOSITE. `/local`'s two ends ship in one bundle, so it may break freely on any
commit. `/cloud` is a deployed Worker answering installs that may be months
stale, so it may never break: every response is `.strict()` and final at
birth, a new field is a new route (`account/account-schema.ts` says why), and a
new error code is safe only on a route stale clients never call. That is also
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
                       # folders · knowledge · system · threads · vault · voice
    <domain>/          # each is a `<domain>-contract.ts` (rows: input, output,
                       # and ONLY the error classes that row can raise) beside
                       # a `<domain>-schema.ts` (the zod shapes)
    local-errors.ts    # the custom error classes and LOCAL_ERROR_STATUS_MAP,
                       # checked exhaustive: oRPC carries no status on an error,
                       # and a code with no entry would answer 500 silently
    local-routes.ts    # the paths that are NOT procedures: /health, /vault/asset
                       # (bytes + etag + sandbox csp), /ws and /voice/stream
    notifications.ts   # the /ws frame grammar: subscribe/unsubscribe in, hello
                       # and `changed` pings out — never a payload
    thread-timeline.ts # the timeline row grammar, and the delta algebra
                       # (computeTimelineDelta / applyTimelineDelta)
    build-thread-timeline.ts  # the pure fold from stored events into rows —
                       # deterministic, ids included, because the server diffs
                       # two projections into one delta
  cloud/               the never-break wire, plus the client runtime core
    cloud-errors.ts    # CLOUD_ERROR_CODES, the ONE code→status map, and which
                       # codes end a session vs. condemn an outbox position
    cloud-client.ts    # fetch over the paths: a refusal is a VALUE (CloudResult),
                       # never a throw, so the sync loop switches on the code
    bytes.ts           # hex/base64/sha256/constant-time compare on web-crypto
                       # globals alone — the leaf that loads everywhere
    approval-slot.ts   # connector OAuth's one slot: arm, claim once, expire
    device/            # DEVICE_API_PATHS, the igd_ credential grammar, and
                       # login-flow.ts — the one spelling of "join an account"
    sync/              # SYNC_API_PATHS and the opaque-body event rows;
                       # plan-page.ts (the ONE page planner every reader of the
                       # merged log runs); sync-session.ts (the id-fenced
                       # session, pullPages, the single-flight pass); sync-ws.ts
                       # (the bare ping frames)
    captures/          # at-least-once delivery, exactly-once deletion by claim
    account/           # /v1/account — its own route, because a login field
                       # cannot be added
    vault/             # VAULT_API_PATHS, the hosted tree/file/asset shapes and
                       # ceilings, VAULT_GIT_PATH, and the asset media-type
                       # allowlist the desktop and Worker routes share
```

## Who consumes which half

- **apps/web** SERVES every `/cloud` row and reaches nothing under `/local`;
  `dep-dag.test.ts` pins that per import.
- **apps/cli** implements `/local` and, in `src/server/cloud/`, consumes all
  of `/cloud` — push, pull, claim, ack, the git remote.
- **apps/mobile** consumes the read half alone: it pulls threads and produces
  captures, never pushes or claims, because the desktop runs the turns and
  owns applying a capture to the vault.
- **apps/desktop** compiles against `/local` (plus `cloud/bytes`, once).

## Invariants

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
  discipline with two spellings is two to audit.
- **The cloud client never throws a refusal.** `CloudResult` carries
  `refused` (a code the contract names), `unreachable` (no verdict on the
  credential) or `malformed` (a body this build cannot read); an
  `Error("HTTP 409")` would retry a batch the server refuses forever.
- **One spelling per route path.** `route-paths.test.ts` sweeps the repo for
  the literal strings behind `@repo/api/local/routes` and `VAULT_API_PATHS`
  and refuses a second spelling outside the file that owns it.
- **The `/ws` frame grammar is strict outbound, lenient inbound.** The server
  validates what it broadcasts with `.strict()`; a client parses with the
  lenient twin, or a long-lived tab against a newer server drops whole
  messages over an additive change. Client→server frames stay strict: an
  unknown field is an unknown client, closed 1008.
- **A turn row's `sourceSeqEnd` names its own contributors**, not every
  turn-scoped event: a streaming assistant message is turn-scoped but lands
  top-level, and counting it moved the turn row and resent the subtree per
  token.

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
pins the contract shapes and refusals, the login flow, the session fence and
single-flight, the approval slot, the byte primitives, and that the cloud
vault-path grammar admits exactly what `parseVaultPath` returns unchanged;
`src/local/__tests__/` the timeline fold and delta algebra, the `/ws`
strict/lenient pair, and the vault and comments schemas.
