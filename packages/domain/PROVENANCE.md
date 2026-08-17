# Vendored: bb's thread domain

- **Upstream**: https://github.com/get-bb/bb, directory `packages/domain` plus
  the notification seam named per file below
- **Commit**: `8e6fc83582881509077ce67ac5e4b59784d83121`
- **License**: MIT — `LICENSE.bb` in this directory is upstream's own text,
  copied verbatim. The per-file notice below is not a substitute for it: MIT
  requires the license itself to travel with the copy, and it names a
  copyright holder no notice line carries.
- **Vendored**: 2026-08-17

Every shipped file here is upstream's, kept under upstream's file names so a
re-vendor diffs cleanly — `src/notifier.ts` is upstream's too, from bb's own
`packages/db`, and is here because the seam is what the store and the wire
contract both derive from. The suites under `src/__tests__/` and the
scaffolding are house, and house files may land beside these later — so the
record is per file rather than whole-directory, and the manifest is what says
which is which.

Vendored rather than depended on because bb publishes no packages and this repo
carries a subset of the event vocabulary.

## Attribution

```text
Vendored from bb (github.com/get-bb/bb), MIT.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                                | Upstream                                                                             | Carried  |
| ----------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| `src/change-kinds.ts`               | `packages/domain/src/change-kinds.ts`                                                | adapted  |
| `src/notifier.ts`                   | `packages/db/src/notifier.ts`, `apps/server/src/services/lib/notification-buffer.ts` | adapted  |
| `src/pending-interaction-status.ts` | `packages/db/src/schema.ts` (the `pending_interactions` status enum)                 | adapted  |
| `src/provider-event.ts`             | `packages/domain/src/provider-event.ts`                                              | vendored |
| `src/thread-event-scope.ts`         | `packages/domain/src/thread-event-scope.ts`                                          | vendored |
| `src/thread-lifecycle.ts`           | `packages/domain/src/thread-lifecycle.ts`                                            | vendored |
| `src/thread-status.ts`              | `packages/domain/src/thread-status.ts`                                               | vendored |

## Local edits worth knowing before a re-vendor

- `src/change-kinds.ts` keeps upstream's shape and replaces the vocabulary:
  the entities are `vault` and `doc` where upstream has project, environment
  and host.
- `src/notifier.ts` keeps upstream's decomposition and names while rewriting
  the buffer's body.
- `src/pending-interaction-status.ts` is upstream's status vocabulary lifted
  out of the table declaration, with a house zod enum beside it so the wire
  and the column read one tuple.
- `src/provider-event.ts` is a subset: web search and fetch, image view,
  background tasks, compaction, goals, rate limits, warnings, model fallback
  and the whole `system/*` family are not carried. The `userMessage` item is
  flattened from a content array to `text: string`, and `getThreadEventItemRef`
  stands in for upstream's `deriveStoredEventItemFields` over the same case
  list with a different body.
- `src/thread-event-scope.ts` keeps the policy table and the five scope
  helpers; upstream's six derived indexes and `assertThreadEventScope` are not
  carried, so `validateThreadEventScope` reads the table directly.
- `src/thread-lifecycle.ts` is longer than upstream because it ADDS turn
  identity: every settling event carries a `turnId`, the row state carries
  `activeTurnId`, and a `stale-turn` noop reason is checked before the
  transition table. Upstream's table, predicates and evaluator body are
  otherwise unchanged.

## Re-vendor recipe

Clone upstream at a newer commit, diff `packages/domain/src` against `src/`
here ignoring the notice lines, re-apply the edits above, update the commit pin
here, and run this package's tests.
