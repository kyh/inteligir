# @repo/contract

ONE contract: `/v1`, the wire between every client and the cloud, as one oRPC
contract on `/v1/rpc` (`account.*` answered over Better Auth, `library.*` by the
account's library cell), the plain-HTTP routes it names, the build every
request names, the browser extension's identity, and the library model both
ends validate against. Its decisions are this package's
[`CLAUDE.md`](CLAUDE.md).

## Why it exists

`/v1` is a deployment answering installs that may be months stale, so every
client and the service compile against one spelling of it, and it breaks only
behind the client build floor (`packages/service/CLAUDE.md` § The wire). It
loads in the Mac's and the browser's page, on node and in React Native, so it
names no platform, no workspace and no markdown parser, and no client bundles
the service's code, `@repo/db`'s drizzle, MCP or OpenAPI (`oxlint.config.ts`).
Callers supply the clock, the random bytes and every fresh id.

## Layout

```
src/
  rpc/           every module that reaches oRPC: /v1's one wire, the account's and the library's
                 rows, every refusal it answers and its sentence, and what a failed call means
  account/       what the account's rows read and answer: the password's bounds, its devices, its
                 deletion, sign-up
  library/       the model and its wire: the node set, an item's fields and ops, a body's save, a
                 folder's order, the listing, what moved, the agent's events, the cell's rules
  items/         what an item is on every device: its kinds, a url's one key, a read page's facts
  knowledge/     what a markdown file is, a tag's name, the folder tree's paths
  extension/     the extension's key, id and origin
  test-support/  the fake cell every client's suites drive, the cases it and the real cell both
                 answer, the seeded generator, library items
  *.ts           the library's scopes, the client build, the origins, a few shared primitives
```

## Consumers

`packages/service` serves every row and decorates the library's as the
connector's tools; `packages/db` holds the cell's columns to the model's
vocabularies; `packages/editor` reads and writes the model's blocks; the
library tab, the phone and the extension reach the library through `v1`, each
over the one `v1Client` (`rpc/call-outcome.ts`); and every app's suites
drive the fake cell in `test-support/`.

## Testing

```bash
pnpm --filter @repo/contract test        # vitest, no platform, a 512MB heap
pnpm --filter @repo/contract typecheck
```

`/v1`'s rows and refusals run over a real `RPCHandler` and `RPCLink`
(`rpc/v1-contract.test.ts`), and the model's properties draw from the one seeded
generator (`test-support/seeded-random.test-utils.ts`). The fake cell runs the cases in
`test-support/cell-conformance.test-utils.ts`, which the service runs over the real cell,
so a case added there holds both. A change to a row reaches every
client and the cloud at once: run the service's suites and every client's.
