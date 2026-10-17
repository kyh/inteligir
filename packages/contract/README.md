# @repo/contract

ONE contract package, TWO entry points. `@repo/contract/local` is the oRPC contract
the workspace UI and the CLI compile against and `inteligir serve`
implements. `@repo/contract/cloud` is the wire between an install and the Cloudflare
Worker — and the client runtime core both the CLI and the phone run over it.

## Why it exists

Two entries rather than one router because their compatibility obligations are
OPPOSITE. `/local`'s two ends ship in one bundle, so it may break freely on any
commit; a CLI installed apart from the app is refused by the release the
server's `server.json` names, not kept compatible. `/cloud` is a deployed
Worker answering installs that may be months stale, so it breaks only behind
the client build floor: the Worker may grow an answer, a client ignores what it
does not know (the first invariant below), and a shape retires once the floor
is past every build that reads it, which costs nothing while nobody but the
owner holds an install (`AGENTS.md` § Project Overview). That is also why
`/cloud` is zod + REST paths and NOT oRPC, diverging from the decision record
(#611 phase 6) deliberately: the deployed wire is hand-owned because it must
not break, and oRPC is beta, owning the serializer and the error shape the
wire would hand it.

The package is platform-neutral by construction (`lib: ["ES2023",
"WebWorker"]`, `types: []`): it loads in the desktop page, on node, on workerd
and in React Native, and `oxlint.config.ts` refuses a node or react import
here, `tools/repo-guards` a `@tauri-apps` one.

## Layout

```
src/
  local/               the oRPC contract, one folder per domain
    local-contract.ts  # the router every domain's rows hang from
    <domain>/          # a `<domain>-contract.ts` of rows beside a `<domain>-schema.ts`
    local-errors.ts    # each error code's status, which oRPC does not carry
    local-routes.ts    # the paths that are not procedures
    notifications.ts   # the /ws frame grammar
    thread-timeline.ts # the timeline rows and the delta that moves them
  cloud/               the wire that breaks behind a floor, plus the client runtime core
    client-build.ts    # the build every request names, and the floor it is held to
    cloud-errors.ts    # the ONE code→status map
    cloud-client.ts    # the one client both installs call the Worker through
    cloud-origin.ts    # the production origin both clients fall back to
    bytes.ts           # the byte primitives, on globals every target has
    device/            # the device credential and the one login flow
    sync/              # the merged log's rows, its one page planner, session and socket
    dispatch/          # the inbox a phone asks a Mac through
    account/           # the account's deletion and the sign-up doors
    vault/             # the hosted vault's paths and shapes, and the phone's write
```

## Who consumes which half

- **apps/web** SERVES every `/cloud` row and reaches nothing under `/local`;
  `dep-dag.test.ts` pins that per import.
- **apps/cli** implements `/local` and, in `src/server/cloud/`, consumes all
  of `/cloud` — push, pull, the dispatch claims and acks, the approvals it
  relays, the git remote.
- **apps/mobile** pulls threads, produces dispatches, answers a phone-started
  turn's approvals and commits vault change sets (`vaultCommit`), and never
  pushes thread events, claims a dispatch or speaks git, because the desktop
  runs the turns. It reaches nothing under `/local` either, pinned by
  the same `dep-dag.test.ts` table (`CLOUD_ONLY_CLIENTS`) as apps/web: a phone
  install may be months stale against the deployed Worker.
- **apps/workspace** compiles against `/local` alone.

## Invariants

- **`/cloud` reads leniently and is written strictly.** Every response schema
  strips a field it does not declare, so a newer Worker may add one and this
  build reads on; a refusal code it does not know reads as `internal`, a fault
  to retry in the Worker's own words, never a verdict on the credential.
  Requests stay `z.strictObject`: only the always-newest Worker parses them. The
  Worker's tests hold every answer to exactly the declared shape (`emitted` in
  `apps/web/src/worker/__tests__/cloud-helpers.ts`), since a stripping client
  would let a leaked column through. A field that changes what a row MEANS (a
  new dispatch kind) still reaches only a client whose request declares it,
  because stripped, the row reads as the old kind: a dispatch claim names the
  kinds it takes.
- **Every request names its build, and the Worker refuses one below its
  floor.** `x-inteligir-build` rides the REST calls, the two that ask for a
  credential, the socket's upgrade and the hosted vault's git `extraHeader`
  (`client-build.ts`; `__tests__/client-build.test.ts` walks every
  `CloudClient` method). `client-outdated` ends a session as `outdated`, not
  `unauthorized`: the credential stands, and only an update moves past it
  (`sync/sync-session.ts`).
- **`src/` holds exactly two buckets.** The cloud-never-reaches-local guard
  populates itself from `src/cloud`, so a file outside both halves is one no
  guard reads; `dep-dag.test.ts` refuses a third. The sanctioned crossing is
  `local` importing a `cloud` constant (`local/vault/vault-schema.ts` takes the
  asset media-type allowlist and the hash helpers; `local/cloud/cloud-schema.ts`
  the device name bound) — a number copied by hand passes locally and is
  refused at the Worker as a shape error. The other direction never.
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
  its cursor can pull that row again under a build that reads it. A row filed
  under one thread whose event names another is skipped here too, never
  recorded for a pull again, since no build reads it differently: a client
  applying it would file it under whichever id it keyed by.
- **The cloud client never throws a refusal.** `CloudResult` carries
  `refused` (a code this build names, `internal` for one it does not),
  `unreachable` (no verdict on the credential) or `malformed` (a body this
  build cannot read); an `Error("HTTP 409")` would retry a batch the server
  refuses forever. One refusal is an answer: `vaultCommit` reads a 409
  `vault-conflict` as the value `{ kind: "conflict" }`, since it carries the
  bytes to merge against, while any reader that knows only the envelope,
  `readCloudCall` included, still sees the refusal.
- **One spelling per route path.** `route-paths.test.ts` sweeps the repo for
  the literal strings behind `@repo/contract/local/routes` and `VAULT_API_PATHS`
  and refuses a second spelling outside the file that owns it.
- **The `/ws` frame grammar is strict outbound, lenient inbound.** The
  `z.strictObject` schemas type what the server broadcasts and are what its tests
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
- `SocketDial` (`sync/cloud-socket.ts`): the one platform line of the
  socket. The bearer rides the upgrade, node's `WebSocket` takes headers as
  `{ headers }`, React Native's as a third argument, and the DOM's takes none,
  so each client hands `createCloudSocketOpener` its own dial and the frame
  parse and keepalive stay one spelling. A runtime takes the resulting
  `CloudSocketOpener`, so a test hands it a fake that never dials.
- `DeviceCredentialStore` (`device/login-flow.ts`): where the credential lands
  is the only thing the CLI and the phone supply to the login flow.

## Testing

`pnpm --filter @repo/contract test` — vitest, no platform.
`knowledge/__tests__/engine-mirror.test.ts` is type-level and fails under
`tsc`, not `vitest`. The delta algebra is pinned over the projections it
diffs, beside the server's fold in `apps/cli/src/server/threads/__tests__/`.
