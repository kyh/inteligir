# Vendored: bb's server edge and file watcher

- **Upstream**: https://github.com/get-bb/bb, `apps/server`,
  `packages/host-watcher` and `packages/config` as named per file below
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — `LICENSE.bb` in this directory is upstream's own text,
  copied verbatim. The per-file notice below is not a substitute for it: MIT
  requires the license itself to travel with the copy, and it names a
  copyright holder no notice line carries.
- **Vendored**: 2026-08-17

This app is overwhelmingly house code; the files below came from bb, which is
why the record is per file. Two clusters under `src/node/`: the server edge
(the Hono composition, the origin guard, the ws subscription registry, the
config resolver) and the whole `@parcel/watcher` subprocess, which is the part
most worth copying — a native addon supervised across a fork, with a ping/pong
liveness loop and backoff respawn, is a lot of hard-won detail. The esbuild
bundling script is the one file outside `src/`.

Vendored rather than depended on because bb publishes no packages.

## Attribution

```text
Vendored from bb (github.com/get-bb/bb), MIT.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                                             | Upstream                                                                                                     | Carried  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | -------- |
| `scripts/build-node-entry.mjs`                   | `scripts/build-utils.mjs`, `apps/host-daemon/scripts/bundle-manifest.mjs`                                    | vendored |
| `src/node/app.ts`                                | `apps/server/src/server.ts`                                                                                  | adapted  |
| `src/node/browser-request-guard.ts`              | `apps/server/src/browser-request-guard.ts`, `packages/config/src/local-app-origins.ts`                       | vendored |
| `src/node/config.ts`                             | `packages/config/src/runtime.ts`, `packages/config/src/env.ts`                                               | adapted  |
| `src/node/ws-bus.ts`                             | `apps/server/src/ws/hub.ts`, `apps/server/src/ws/client-protocol.ts`, `apps/server/src/ws/decode-payload.ts` | vendored |
| `src/node/vault/watcher/debounce.ts`             | `packages/host-watcher/src/watch-callback-scheduler.ts`                                                      | vendored |
| `src/node/vault/watcher/fork-channel.ts`         | `packages/host-watcher/src/parcel-subprocess/fork-channel.ts`                                                | vendored |
| `src/node/vault/watcher/messages.ts`             | `packages/host-watcher/src/parcel-subprocess/messages.ts`                                                    | vendored |
| `src/node/vault/watcher/parcel-backend.ts`       | `packages/host-watcher/src/parcel-watcher-backend.ts`, `packages/host-watcher/src/watch-error.ts`            | vendored |
| `src/node/vault/watcher/parcel-child-entry.ts`   | `packages/host-watcher/src/parcel-subprocess/parcel-child-entry.ts`                                          | vendored |
| `src/node/vault/watcher/parcel-child-handler.ts` | `packages/host-watcher/src/parcel-subprocess/parcel-child-handler.ts`                                        | vendored |
| `src/node/vault/watcher/parcel-watcher-proxy.ts` | `packages/host-watcher/src/parcel-subprocess/parcel-watcher-proxy.ts`                                        | vendored |

## Partial copies

- `src/node/ws-bus.ts` — the subscription engine is upstream's: the two-map
  registry, `subscribe`/`unsubscribe`/`unregisterClient`, `handleMessage` and
  the head of the broadcast. The hello ack, the ordered shutdown
  (`closeAllClients`/`terminateAllClients`) and the `readyState` send gate are
  house; upstream closes sockets from its server entry instead.
- `src/node/vault/watcher/messages.ts` — upstream's message types carry over
  whole. The parser half below them (`parseParentToChildMessage`,
  `parseChildToParentMessage` and their narrowers) is house: bb casts IPC
  payloads where this repo narrows them.
- `src/node/vault/watcher/parcel-backend.ts` — upstream's types and
  `toWatchErrorMessage` verbatim, minus its process-wide backend registry.
- `scripts/build-node-entry.mjs` — `NODE_ESM_REQUIRE_BANNER` is byte-identical
  to upstream's, mixed quote style included, and both esbuild option objects
  reproduce upstream's. The decomposition is house: upstream factors a reusable
  `buildNodeEsmEntry` helper over a declarative target manifest, where this is
  a flat script with two literal calls. Do not be misled by upstream's own
  `scripts/build-node-entry.mjs` — same filename, different code, not the
  source.

The two `adapted` rows are the weakest claims here and are kept attributed on
purpose:

- `src/node/app.ts` keeps upstream's composition — `createApp` returning
  `{ app, injectWebSocket }`, the API sub-app mounted with a catch-all 404
  behind it, the origin-guard call, the `/ws` upgrade triple and the immutable
  asset cache-control — and rewrites everything under it. Static serving,
  the dev/prod fallback union, the nonce CSP shell and the typed-route
  registrar have no upstream counterpart.
- `src/node/config.ts` carries small helpers near-verbatim — `defineEnvVar`,
  the sha256 checkout hash, the derived-port arithmetic and its two constants,
  `parsePortValue`'s message, the `~` expansion — while its actual subject is
  new. The env→config.json→default layering, the managed-config schema, the
  vault/data-dir disjointness check and the probe limit are this repo's;
  upstream reads no config file.

## Re-vendor recipe

Clone upstream at a newer commit and diff each row's upstream file against its
counterpart here, ignoring the notice lines. The watcher rows diff cleanly; the
two adapted rows do not, and are worth reading rather than merging. Update the
commit pin here and run this app's tests.
