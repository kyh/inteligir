# Decisions: @repo/contract

`/v1`'s one wire, and the library model both ends of it validate against: an
item's fields and blocks, their ops, order and hashes, the listing over the
cell's rows, a url's key and what a file is. `AGENTS.md` § Decisions says how
a bullet is written and cited.

## Shape

The contract is what every client and the Worker compile against, so it loads
in the library's page, the extension, the phone's React Native, on workerd and
in node's suites: zod and oRPC's contract, with no node, react, server or
drizzle import (`oxlint.config.ts`, `DECLARED_EDGES` in
`tools/repo-guards/src/dep-dag.test.ts`). The model's modules
(`packages/contract/src/library/`, `src/items/`, `src/knowledge/`, `src/text/`
and `iso-date.ts`) take no `crypto` or `URL` global either: the clock, random
bytes and fresh ids are injected. How the Worker reads and refuses the wire is
the service's (`packages/service/CLAUDE.md`).

## The library model

- **THE PERSISTED NODE SET IS SPELLED HERE, BELOW THE EDITOR, AND IT IS
  STRICT.** `@repo/contract/library/library-nodes` is Plate's own vocabulary as
  zod, every node the editor reads and writes: every element a strict object,
  only a top-level block named, by its id, a depth and a size checked before
  the recursive parse (`storableBlockSchema`), and an indent on any block held
  to what the writer can nest (`LIST_MAX_INDENT`), so a block nested under a
  list item keeps its depth. The editor holds these nodes as they are: a page
  link is Plate's mention, its `key` the item's id and its `value` the title the
  writer saw, the one link node `deriveItem` reads, which strips every
  zero-width space Plate writes for an empty line from the text it derives;
  a `#tag` is its text, media a sha or a url. Rejected: the vocabulary
  in `@repo/editor`
  (the phone's native end parses its editor page's blocks by it, and loads no
  Plate), a tag node (two spellings of
  one tag), an id inside a block (Plate names those again in every editor, so
  one block would hash apart), a wiki link or an opaque source node beside the
  mention (a second spelling of every link, and markup no editor edits), and
  loose objects (a prop no reader draws).

- **AN ITEM IS FIELDS AND BLOCKS, AND EVERYTHING ELSE IS DERIVED IN THE SAME
  TRANSACTION.** `@repo/contract/library/library-item` caps every field, and each
  list and the properties by their JSON's bytes, so the largest legal row,
  card and url key included, stays well inside a Durable Object's 2 MB
  (`packages/service/src/library/library-queries.test.ts` sums it).
  `deriveItem` reads the card (an empty
  title falls back to the first heading, then the first line, and a surface
  draws an item with none of them as Untitled, a word the app gives no note, so
  a new note follows its body on every device; the outline keeps the first h1
  to h3, as the editor's contents do, each cut to a line),
  the index text (every heading ranks), the links by id or url key, and each
  block's text. The card alone rides its row, so a listing draws
  an item without its body. Rejected: a frontmatter block (its keys are
  columns).
  `packages/contract/src/library/derive-item.ts`.

- **A BLOCK IS GUARDED BY ITS HASH, ITS PLACE BY ITS KEY, A FIELD BY ITS
  VALUE.** `@repo/contract/library/block-ops`: insert, put, drop, move and the
  field patches each name their base; a batch lands whole or answers every
  conflict, an op already true is satisfied, a list field merges as a set, so
  two devices tagging at once both land, a tag respelled takes its new spelling
  where it stands, and a batch whose landed fields break a cap (a merge past
  the list's length) lands none and answers `invalid`.
  The hash is SHA-256 over canonical JSON (`@noble/hashes`, synchronous for
  the cell's transaction) cut to 128 bits. Rejected: one version per item
  (two blocks would conflict) and the platform's crypto (async in a Durable
  Object, absent from Hermes).
  `packages/contract/src/library/block-ops.test.ts`.

- **A BLOCK'S PLACE IS A FRACTIONAL KEY, READ NOTE BEFORE ARTICLE.**
  `@repo/contract/library/block-order` mints keys with `fractional-indexing`;
  equal keys from two devices order by block id, and `isOrdKey` holds a key to
  the whole format, since the library checks only its head and its last digit.
  `placeInOrder` restores every old key when they all still fit, else moves
  the fewest blocks. Rejected: integer positions (an insert renumbers, and two
  renumberings conflict) and interleaving the sections (a fill's keys would
  thread through the person's).

- **THE LISTING OVER ROWS IS IN MEMORY, AND PINNED LEADS IT.**
  `@repo/contract/library/library-index` holds the cell's listing rows, typed by
  the host's own row, built for the one read that asks, and answers kind, tag
  family, folder (with its subfolders), site, date and search scopes, with
  Deleted apart and a count per kind. It keeps one sorted order per sort, dropped only when a row's place in
  it moves. Rejected: SQL listing queries (a tag family and a folder tree read
  from memory without a join per page).
  `packages/contract/src/library/library-index.test.ts`.

## Items and files

- **A URL HAS ONE KEY, COMPUTED WITHOUT THE PLATFORM'S URL.**
  `@repo/contract/items/item-url` parses by the RFC 3986 appendix-B regex. The key
  drops the scheme, userinfo, `www.`, a default port, the tracking parameters
  and a non-route fragment, folds the host and its aliases (`youtu.be`, `x.com`,
  a mobile host) and sorts the query; `cleanUrl`, what an item's url holds,
  drops only userinfo and tracking parameters, so `urlKey(cleanUrl(u)) ===
  urlKey(u)` (a seeded property). The key is a row `deriveItem` writes with
  every write of the item, and `URL` is a banned global here
  (`oxlint.config.ts`). Rejected: `new URL()` (React Native's is not WHATWG, so
  the phone and the Mac would disagree); the key as a field (a rule change
  strands every item on the old one).

- **NO READER DECIDES WHAT A DOC IS ON ITS OWN.** `@repo/contract/knowledge/doc-file`
  is the one answer: `isDocPath` (`.md`, `.markdown`, `.mdx`, `.txt`) and
  `docStem`, which an import asks of every file it is handed. Rejected: a
  private `.md` rule in a reader (it leaves out every `.txt` note and disagrees
  on a name once it is not lowercase). What any other file is in the library
  is `fileKindOf` (`@repo/contract/items/item-kind`), and what a doc is as an item
  is its `kind`: one answer each, for every reader. A file in
  `assets/<16 hex>/`, a folder named by its bytes (`isBytesFolderPath`), an
  import reads as a file by that shape, whatever its name says, and an
  unclaimed one lands in the folder above it. What an operating system leaves
  (`isOsLitterPath`) is passed over first, there too, since unpacking and
  zipping a folder again puts it in those folders. Every mark of an export is
  read from the zip's root, and a Mac's Compress of the unpacked folder
  puts all of it under that folder, so an import first takes off a sole top
  folder that every path but what an operating system left shares, when it holds
  `assets/` (`packages/editor/src/codec/import-plan.ts`).
  Rejected: taking off any sole top folder (an Obsidian vault's is a folder the
  person named).
