# Vendored: bb's wire contract

- **Upstream**: https://github.com/get-bb/bb, `packages/server-contract` plus
  the ws hub named per file below
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — `LICENSE.bb` in this directory is upstream's own text,
  copied verbatim. The per-file notice below is not a substitute for it: MIT
  requires the license itself to travel with the copy, and it names a
  copyright holder no notice line carries.
- **Vendored**: 2026-08-17

Three files here came from bb: the hc client construction, the ws notification
protocol and the timeline row grammar with its delta algebra. The route table
and every payload schema beside them are this repo's own, which is why the
record is per file.

Vendored rather than depended on because bb publishes no packages.

## Attribution

```text
Vendored from bb (github.com/get-bb/bb), MIT.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                     | Upstream                                            | Carried  |
| ------------------------ | --------------------------------------------------- | -------- |
| `src/client.ts`          | `packages/server-contract/src/public-api.ts` (tail) | vendored |
| `src/notifications.ts`   | `apps/server/src/ws/hub.ts`                         | vendored |
| `src/thread-timeline.ts` | `packages/server-contract/src/thread-timeline.ts`   | vendored |

## Partial copies

- `src/notifications.ts` is upstream's hub half only: the subscribe and
  unsubscribe schemas, the client union, the target-key switch, the lenient
  filter and `subscriptionKeysForMessage`. The `hello` frame has no upstream
  counterpart, and the `changedMessagePair` factory collapses upstream's
  hand-written strict/lenient pairs into one parameterised pair. The change-kind
  vocabulary it builds those pairs from is `@repo/domain/change-kinds`, which
  carries its own record.
- `src/thread-timeline.ts` carries upstream's row schemas and both delta
  functions near-verbatim, trimmed of fields this repo does not model. Three
  row kinds are local inventions with no bb counterpart: the `reasoning` and
  `plan` work rows, and the top-level `error` row (bb models errors as system
  rows). The conversation row also ADDS a nullable `viewContext`
  (`@repo/domain/view-context`), which upstream has no counterpart for.

## Re-vendor recipe

Clone upstream at a newer commit and diff each row's upstream file against its
counterpart here, ignoring the notice lines and expecting the divergences
above. Update the commit pin here and run this package's tests.
