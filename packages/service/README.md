# @repo/service

The account's library cell's own rules: its one SQL schema and the plans over
it, search, undo, the imports and the fill's own modules. The cell in
`apps/web` runs them over its storage, and nothing else ships them.

## Why it exists

The cell's rules are code no client runs, so they sit apart from the model
every client loads (`@repo/contract`) and the dialect's markdown
(`@repo/editor`), which they apply. No node or react import, and no `crypto`
or `URL` global (the root `oxlint.config.ts`), and `lib: ["ES2023",
"WebWorker"]`, `types: []`: the platform comes in as a port (the SQL driver,
the clock, random bytes and fresh ids), so its suites run the cell's plans on
SQLite's own wasm build.

## Layout

```
src/
  library/             # the library's SQL and undo
    library-schema.ts  # the ONE DDL, versioned by `meta.schema`
    library-sql.ts     # the ports, plans as generators, statement chunking
    sql-value.ts       # a SQL value and row as zod
    library-queries.ts # every read and write over the schema, as plans
    revert-change.ts   # a change set taken back three ways, the set's after
                       # as the base, newest set first
  knowledge/           # search over the library's rows
    search-query.ts, search-excerpt.ts, fts-match.ts  # the ONE literal+stem
                       # query policy every engine runs, the excerpt cut over
                       # the literal text (never FTS5's snippet()), and its
                       # FTS5 match
  items/               # the fill's own modules
    fill-sentences.ts  # the sentence each failed reading is said in
    oembed.ts          # a media host's embed, asked and parsed
    page-fetch.ts      # a page's redirects and capped read, over the host's
                       # own hop rule, fetch and deadline
  imports/             # a Raindrop export read into saves, its highlights
                       # quoted in each one's note, over a CSV reader
  text/
    decode-text.ts     # a page's bytes decoded by the charset it declares
  test-support/        # SQLite's wasm behind a Durable Object's refusals, a
                       # Raindrop export to import, and the line-revert oracle
                       # undo is held to
```

## Invariants

- **Purity is the law.** No I/O, clock, or crypto anywhere (the `crypto`
  global is lint-refused); callers supply the driver, the timestamps, the
  random bytes and every fresh id.
- **One grammar**, the editor's own (`@repo/editor/markdown/md-plugins`),
  which never throws, so a malformed tag cannot cost an imported note its
  blocks.

## Seams

- `SqlPort` (`library/library-sql.ts`): one statement per call. The cell
  binds `ctx.storage.sql` to it, with `transactionSync` as its
  `transaction(work)`, and a plan (`library-queries.ts`) runs over it through
  `runPlan`.

## Testing

`pnpm --filter @repo/service test` — vitest, each suite beside the module it
tests. `src/knowledge/` pins the search policy; `src/library/` runs its SQL on
SQLite's own wasm build behind a port that refuses what a Durable Object
refuses (`src/test-support/wasm-sql-port.ts`), and its properties (undo
restores, undo agrees with its line oracle, chunking under both caps) draw
from the contract's one seeded generator. The suites run under a 512MB heap ceiling
(`vitest.config.ts`), so an allocation that grows with a note's size, like a
diff trace that copies the whole frontier every round, fails here rather than
passing on a default heap.
