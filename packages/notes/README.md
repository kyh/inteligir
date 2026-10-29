# @repo/notes

The pure, platform-neutral domain core: the library model the cloud cut builds
(an item as fields and a body of Plate blocks, its ops, its undo and its one
SQL schema), and beside it, until their last clients move, the item model of
the markdown vault (what a saved link, a file and a note are as one markdown
file) and the knowledge engine (links/tags/search and the library listing)
over one markdown scan.

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
  library/             # the library model: what the cell and both replicas share
    library-nodes.ts   # the persisted node set, strict zod over Plate's own
                       # node props, checked at the cell's boundary
    library-item.ts    # an item's fields, one column each, capped to a row
    block-ops.ts       # insert/put/drop/move and field patches, each naming
                       # its base; the per-block guard, apply and rebase
    block-order.ts, block-hash.ts, canonical-json.ts  # fractional order
                       # keys, a block's hash, one spelling of a JSON value
    derive-item.ts     # title, card, text, links, tags and anchored
                       # highlights, from the fields and the blocks
    revert-change.ts   # a change set taken back three ways, in
                       # revert-edit's orientation, newest set first
    library-schema.ts  # the ONE DDL, versioned by `meta.schema`
    library-sql.ts     # the ports, plans as generators, statement chunking
    library-queries.ts # every read and write over the schema, as plans
    library-index.ts   # the listing over a replica's rows, in memory
  knowledge/           # derived-index engine
    projection.ts      # projectDoc — the ONE parse per doc (PROJECTION_VERSION)
    link-graph-index.ts  # pure link/tag/title/graph resolution, fed projections
    link-extract.ts, link-resolve.ts, rename-links.ts  # scan → resolution
                       # (the `[[Title|uuid]]` id tier, then five path/alias
                       # tiers, aliases last) → byte-surgical rename
    tag-grammar.ts, link-kinds.ts, default-limits.ts  # the tag name, the
                       # link kinds and the search and related page sizes,
                       # with no imports: the contract validates against them
                       # and must not load the parser or the engines to do it
    knowledge-store.ts, sql-knowledge-store.ts  # persistence port (types
                       # only) + schema/FTS5-bm25 written once over SqlDriver
    knowledge-index.ts, search-index.ts  # zero-dep reference composition +
                       # in-memory tiered lexical index (behavior pin)
    vault-search.ts    # the text ∧ tag composition, shared VERBATIM by the
                       # command palette and `inteligir search`
    search-query.ts, search-excerpt.ts  # the ONE literal+stem query policy
                       # both engines run, and the excerpt both cut over the
                       # literal text (never FTS5's snippet())
    search-columns.ts  # a doc's FTS row, stems included, computed apart from
                       # the store so a host can stem where it projects
    projection-row.ts, rename-candidates.ts  # the stored projection's one
                       # json column, and the schema any carrier of it is
                       # parsed by; which links a rename may rewrite
    tag-index.ts, related-notes.ts, note-name.ts, doc-file.ts,
    vault-path.ts      # tags, related-notes scorer, name validation, doc
                       # test, posix path helpers
    vault-ignore.ts    # the vault's .gitignore rules, one matcher per file
                       # scoped to its folder; the host reads the files
  markdown/            # the one scan, and what reads a doc's header
    bare-parse.ts      # the editor's grammar as a bare parse, no transformer
                       # run: the tree every knowledge scan walks, so the
                       # index reads as prose what the editor draws as prose
    remark-wiki-link.ts  # own [[wiki-link]] tokenizer, byte-exact both ways;
                       # the body's one parse, one writer and one display
                       # label (`wikiLinkLabel`), which every chip, preview
                       # and snippet on desktop and phone draws
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
                       # `:::` line spelled with one stays text
    remark-inline-constructs.ts, remark-opaque.ts, table-pipes.ts,
    line-scan.ts
                       # the rest of the dialect's own remark plugins
    md-plugins.ts      # the EDITOR's plugin list, owned here so the scan
                       # reads the same grammar
    parse.ts           # the editor's parse (`parseMdast`, which its
                       # markdown→Slate conversion runs); it answers the
                       # escaped text its offsets index
    parsed-offsets.ts  # the one rebase every parse here runs: micromark
                       # counts from past a leading BOM, so without it every
                       # offset on a BOM note cuts one byte early
    mdast-nodes.ts     # the mdast NARROWING boundary: a walk asks it what a
                       # node is, never discriminates structurally
    fence-langs.ts     # ONE spelling of every dialect fence — the rule table
                       # reads it, and the skills guard holds the skills and
                       # the seed to it
    frontmatter.ts     # the ONE header fence every reader cuts at (BOM and
                       # CRLF aware), split/recombine (ONE
                       # `replaceFrontmatterYaml`, which
                       # keeps a BOM and the note's line ending) + the
                       # typed-property ADT (YAML it cannot represent is
                       # preserved byte-exactly)
  items/               # what an item is, as one markdown file
    item-kind.ts       # the kinds, a file's kind by its extension, the
                       # library's own folders and the refusal sentences
                       # every client says
    item-url.ts        # a url's ONE key and its cleaned spelling, with no
                       # platform URL
    item-frontmatter.ts, item-body.ts  # the facts' reader, the line-cut
                       # writes of them, and a link's composed body
    item-files.ts      # a cover, an original and a page copy, computed from
                       # the first embeds and links every time
    item-name.ts, item-stub.ts, item-tags.ts, item-time.ts  # a page's
                       # title as a name, a stub's text, tag edits, and the
                       # one time spelling
    library-index.ts   # the library listing: every doc and every bare
                       # media file, sorted, filtered and counted in memory
  annotations/         # the %%i:id:start/end%% markers' store: highlights,
                       # notes and replies, marker ids, the store schema, and
                       # the entry-wise merge two devices' stores take and
                       # revert an undo takes (never a line merge)
  formulas/            # {{source|display|meta}} pills: collection, expression
                       # evaluation, the resolve graph and the walk that loads
                       # it across notes, and result formatting
  text/                # ONE Myers line diff under diff3 — the merge a 409'd
                       # write retries through; bounded by an edit budget,
                       # past which the changed span is one hunk
    source-lines.ts    # what a LINE is — content excludes its terminator,
                       # whichever flavor — stated once, for every reader
  sync/                # what a path two writers changed becomes
    reconcile-file.ts  # the ONE verdict, bytes in and bytes out, that the
                       # desktop's sync and the phone's write queue both run
    conflict-copy.ts   # the copy's name, its parse, and the one sentence
                       # every surface says about it
    url-item-verdict.ts  # two versions of one saved link settled on one
                       # text, whichever device asks, before any line merge
```

## Invariants

- **Purity is the law.** No I/O, clock, or crypto anywhere (the `crypto`
  global is lint-refused); callers supply the driver, the timestamps, the
  random bytes and every fresh id.
- **The knowledge index is a wipe-and-rebuild cache** (repo Decisions).
  Nothing durable may ever live in it; it is rebuilt from the vault.
- **Frontmatter is the ONLY property store** (repo Decisions). YAML the
  typing rules can't represent is preserved byte-exactly, never coerced.
- **One SCAN per doc** (`projectDoc`), over ONE grammar, the editor's own
  (`markdown/md-plugins.ts` as `markdown/bare-parse.ts`), which never throws,
  so a malformed tag cannot cost a note its place in the index. A link inside
  a construct the editor carries as its source is indexed with no rewritable
  span.
- **There is no crawl to exclude anything from.** This package never reads a
  directory: the vault's `.gitignore` rules reach it as text the host read
  (`vault-ignore.ts`), and any other hiding is a VIEW filter a consumer
  applies over the listing.

## Seams

- `SqlPort` / `AsyncSqlPort` (`library/library-sql.ts`): one statement per
  call and `transaction(work)`; the cell binds `ctx.storage.sql` and
  `transactionSync`, a replica its driver. A plan (`library-queries.ts`) runs
  on either through `runPlan` or `runPlanAsync`.
- `SqlDriver` (`knowledge/sql-knowledge-store.ts`): the host binds it —
  better-sqlite3 in `apps/cli/src/server/knowledge/sqlite-driver.ts` — and
  throws `KnowledgeStoreError` for every database failure, the one failure the
  host rebuilds on.

## Testing

`pnpm --filter @repo/notes test` — vitest, each suite beside the module it
tests. The suites in `src/knowledge/` pin the knowledge engine: resolver tiers
(including an oracle equivalence for the basename buckets), rename byte
surgery, the search policy against both engines and the scan's prose against
the editor's parse; `src/text/` pins the diff3 merge; `src/library/` runs its
SQL on SQLite's own wasm build behind a port that refuses what a Durable
Object refuses (`src/test-support/wasm-sql-port.ts`), and its properties
(rebases commute, undo restores, revert-edit's orientation, chunking under
both caps) draw from the one seeded generator. The
suites run under a 512MB heap ceiling (`vitest.config.ts`), so an allocation
that grows with a note's size, like a diff trace that copies the whole
frontier every round, fails here rather than passing on a default heap.
