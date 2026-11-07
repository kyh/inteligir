# @repo/notes

The pure, platform-neutral domain core: the library model (an item as fields
and a body of Plate blocks, its ops, its undo and its one SQL schema), the
dialect's markdown grammar the codec, the import and the export read and write
by, and what an item, a highlight, a formula and a search are, which every
device and the cell share.

## Why it exists

This is the sharing seam. ZERO node/react imports — lint- (the root
`oxlint.config.ts`'s `no-restricted-imports`) and tsconfig-enforced (`lib:
["ES2023", "WebWorker"]`, `types: []`) — so the same code runs unchanged on a
server, in a browser and in React Native. Platforms inject capabilities (SQL
driver, clock). Everything above it depends on it; it depends on nothing in the
workspace.

## Layout

```
src/
  iso-date.ts          # a Date → local `YYYY-MM-DD`, the only date text shared
  library/             # the library model: what the cell and every replica share
    library-nodes.ts   # the persisted node set, strict zod over Plate's own
                       # node props, checked at the cell's boundary
    library-item.ts    # an item's fields, one column each, capped to a row
    block-ops.ts       # insert/put/drop/move and field patches, each naming
                       # its base; the per-block guard, apply and rebase
    block-order.ts, block-hash.ts, canonical-json.ts  # fractional order
                       # keys, a block's hash, one spelling of a JSON value
    derive-item.ts     # title, card, text, links, tags, the url's key and
                       # anchored highlights, from the fields and the blocks
    revert-change.ts   # a change set taken back three ways, the set's after
                       # as the base, newest set first
    library-schema.ts  # the ONE DDL, versioned by `meta.schema`
    library-sql.ts     # the ports, plans as generators, statement chunking
    sql-value.ts       # a SQL value and row as zod, a leaf node loads as it
                       # stands
    library-queries.ts # every read and write over the schema, as plans
    library-index.ts   # the listing over a replica's rows, in memory
    uuid-v7.ts         # an id minted on a device that sorts by when
  knowledge/           # links, tags and search, over the library's rows
    link-resolve.ts    # a link's target: the `[[Title|uuid]]` id tier, then
                       # five path and alias tiers, aliases last, and the keys
                       # an export page's resolver is filed under
    rank-wiki-targets.ts  # the order of the `[[` picker's targets
    link-extract.ts    # what a markdown file says outside its blocks: an md
                       # url's target and the frontmatter's tags and aliases
    tag-grammar.ts     # the tag name, with no imports: an item's fields
                       # validate against it in every client
    search-query.ts, search-excerpt.ts, fts-match.ts  # the ONE literal+stem
                       # query policy every engine runs, the excerpt cut over
                       # the literal text (never FTS5's snippet()), and its
                       # FTS5 match
    text-matches.ts    # literal occurrences in a text, for the find bar and
                       # the cell's excerpts
    doc-file.ts, asset-name.ts, folder-path.ts  # what a markdown file is,
                       # a file's free name, and the folder tree's path
                       # helpers, which the import and the export read a zip by
  markdown/            # the dialect's one grammar
    md-plugins.ts      # the EDITOR's plugin list, owned here so the codec,
                       # an import and the editor read one grammar
    parse.ts, bare-parse.ts  # the editor's parse (`parseMdast`, which its
                       # markdown→Slate conversion runs), and the same
                       # grammar with no transformer run
    remark-wiki-link.ts  # own [[wiki-link]] tokenizer, byte-exact both ways;
                       # the body's one parse and one writer
    remark-inline-html.ts  # every tag is inline html (flow html is off),
                       # folded with its closer as the tree compiles: a bare
                       # `<u>` the underline mark, any other pair one element
                       # the editor holds as source; a tag nothing closes
                       # stays its own bytes
    remark-containers.ts   # the `:::` line grammar (tabs, toggles, columns),
                       # nesting in every flow container; an opener whose
                       # container cannot be read whole stays prose
    text-escapes.ts    # which of a text's characters a backslash escape
                       # wrote, so a pill, a date, an annotation marker or a
                       # `:::` line spelled with one stays text, past GFM's
                       # split of a bare url too
    remark-inline-constructs.ts, remark-opaque.ts, table-pipes.ts,
    line-scan.ts       # the rest of the dialect's own remark plugins
    flow-spans.ts      # where each block lands in the markdown a stringify
                       # writes
    parsed-offsets.ts  # the one rebase every parse here runs: micromark
                       # counts from past a leading BOM, so without it every
                       # offset on a BOM note cuts one byte early
    mdast-nodes.ts     # narrows a transform's bare `Node` input to the root
    alert-marker.ts    # GitHub's alert grammar, which the editor and quote
                       # placement read a quote through
    fence-langs.ts     # ONE spelling of every dialect fence — the rule table
                       # reads it, and the skills guard holds the skills to it
    frontmatter.ts     # the ONE header fence every reader cuts at (BOM and
                       # CRLF aware) and the typed-property ADT (YAML it
                       # cannot represent is preserved byte-exactly)
  items/               # what an item is, whatever device reads it
    item-kind.ts       # the kinds, a file's kind by its extension, the
                       # library's own folders and the web rule's sentence
    item-url.ts        # a url's ONE key and its cleaned spelling, with no
                       # platform URL
    item-frontmatter.ts  # a markdown file's facts, read from its frontmatter
    item-name.ts, item-time.ts, host-names.ts, saved-facts.ts  # a page's
                       # title as a name, the one time spelling, what a host's
                       # spelling says of where it is, and a read page's
                       # facts fitted to an item's fields
    link-fill.ts, fill-sentences.ts, sniff-media.ts, oembed.ts  # how much
                       # of a page a reader reads and which picture is its
                       # cover, the sentence each failure is said in, a
                       # file's type by its bytes, and a page's embed
  annotations/         # the %%i:id:start/end%% markers: highlights, notes
                       # and replies, the store schema, the passage text a
                       # person reads, where a quote's markers land, and the
                       # entry-wise revert an undo takes (never a line merge)
  formulas/            # {{source|display|meta}} pills: collection, expression
                       # evaluation, the resolve graph and result formatting
  imports/             # a Raindrop export read into saves, over a CSV reader
  text/                # ONE Myers line diff under diff3 — the merge a
                       # CONFLICT settles through; bounded by an edit budget,
                       # past which the changed span is one hunk
    source-lines.ts    # where a line ends, whichever terminator, stated once
    safe-decode.ts     # a url part percent-decoded, a bad escape left as written
  test-support/        # the seeded generator every property replays, SQLite's
                       # wasm behind a Durable Object's refusals, and the
                       # marker, name and line-revert oracles the suites read
```

## Invariants

- **Purity is the law.** No I/O, clock, or crypto anywhere (the `crypto`
  global is lint-refused); callers supply the driver, the timestamps, the
  random bytes and every fresh id.
- **An item's fields are its properties.** A markdown file's frontmatter is
  read into them on the way in and written from them on the way out; YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **One grammar**, the editor's own (`markdown/md-plugins.ts`), which never
  throws, so a malformed tag cannot cost an imported note its blocks.

## Seams

- `SqlPort` / `AsyncSqlStatements` (`library/library-sql.ts`): one statement
  per call. The cell binds `ctx.storage.sql` to `SqlPort`, with
  `transactionSync` as its `transaction(work)`; a replica binds its driver to
  `AsyncSqlStatements`, and its transaction is `ReplicaSql.exclusive`
  (`@repo/library-replica`). A plan (`library-queries.ts`) runs on either
  through `runPlan` or `runPlanAsync`.

## Testing

`pnpm --filter @repo/notes test` — vitest, each suite beside the module it
tests. `src/knowledge/` pins the resolver's tiers (an oracle equivalence for
the basename buckets among them) and the search policy; `src/text/` pins the
diff3 merge; `src/library/` runs its SQL on SQLite's own wasm build behind a
port that refuses what a Durable Object refuses
(`src/test-support/wasm-sql-port.ts`), and its properties (rebases commute,
undo restores, undo agrees with its line oracle, chunking under both caps) draw
from the one seeded generator. The suites run under a 512MB heap ceiling
(`vitest.config.ts`), so an allocation that grows with a note's size, like a
diff trace that copies the whole frontier every round, fails here rather than
passing on a default heap.
