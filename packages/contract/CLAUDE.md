# Decisions: @repo/contract

`/v1`'s one wire, and the library model both ends of it validate against: an
item's fields and blocks, its field ops, a folder's order, the listing over the
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
  (the phone's native end hands its note page an item's blocks typed by it,
  and loads no Plate), a tag node (two spellings of
  one tag), an id inside a block (Plate names those again in every editor, so
  one block would read apart on each), a wiki link or an opaque source node beside the
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

- **A FIELD IS GUARDED BY ITS VALUE, AND A BODY IS NO OP.**
  `@repo/contract/library/field-ops`: set, tags, aliases and property each
  name the value they were computed from; a batch lands whole or answers every
  conflict, an op already true is satisfied, a list field merges as a set, so
  two devices tagging at once both land, a tag respelled takes its new
  spelling where it stands, and a batch whose landed fields break a cap (a
  merge past the list's length) lands none and answers `invalid`. A body is
  its note's live document, which every device and the agent edit at once
  (`packages/service/CLAUDE.md`), so the wire carries a body only whole: a
  read answers its blocks in reading order, each in its `section`, and a
  create sends them so. Rejected: block ops guarded by a hash beside the live
  document (two writers of one body, and a merge to settle them); one version
  per item (two fields would conflict).
  `packages/contract/src/library/field-ops.test.ts`.

- **A FOLDER'S PLACE IS A FRACTIONAL KEY.** `@repo/contract/library/order-key`
  mints a folder's sort among its siblings with `fractional-indexing`, and
  `isOrdKey` holds a key to the whole format, since the library checks only
  its head and its last digit. `@repo/contract/library/content-hash` is
  SHA-256 over a text (`@noble/hashes`, synchronous for the cell's
  transaction) cut to 128 bits, the key a change set's part and a heading's
  fold are kept under. Rejected: integer positions (an insert renumbers, and
  two renumberings conflict); the platform's crypto (async in a Durable
  Object, absent from Hermes).

- **THE LISTING OVER ROWS IS IN MEMORY, AND PINNED LEADS IT.**
  `@repo/contract/library/library-index` holds the cell's listing rows, typed by
  the host's own row, a page's rows given whole by the host, and answers kind, tag
  family, folder (with its subfolders), site, date and search scopes, with
  Deleted apart and a count per kind. It keeps one sorted order per sort, dropped only when a row's place in
  it moves. It builds the apps' three reads once, for the cell and the fake
  cell alike: a listing's page (`listingPageOf`), the rail's counts (`scopes`)
  and every title (`titles`), so a suite over the fake reads what the cell
  answers. Rejected: SQL listing queries (a tag family and a folder tree read
  from memory without a join per page); an assembly per host (two assemblies
  of one answer drift apart).
  `packages/contract/src/library/library-index.ts`,
  `packages/contract/src/library/library-index.test.ts`.

- **ONE FAKE CELL ANSWERS EVERY CLIENT'S SUITES.**
  `@repo/contract/test-support/fake-cell` serves `v1Contract`'s library rows
  through oRPC's own handler, with the cell's rules: an op id lands once, a
  field's base holds or answers `CONFLICT`, a file's bytes come first, and a
  card is derived. Each device gets a client and the link it is built from;
  the library page's suites reach it through the page's own client (a
  `DynamicLink` in `apps/web/src/library/test-support/fake-page-library.tsx`),
  and a suite scripts an answer only where it holds or refuses a call.
  Rejected: a fake per client (a second copy of the cell's rules); rows built
  by hand (a shape the cell never answers).
  `packages/contract/src/test-support/fake-cell.ts`,
  `packages/contract/src/test-support/fake-cell.test.ts`.

- **AN ITEM'S READING IS ONE VALUE, WHICH EVERY WRITER MOVES AND EVERY SURFACE
  READS ALIKE.** `@repo/contract/library/item-reading`: none (a note, a file),
  pending, read, or failed with why, each with when the page was last read.
  Writers move it through `readingOps` by `readingAfter`, so a read or a
  failure landing on an item never asked stays none and a failure never lands
  over a read; readers parse it through `readingOf`, so a failure no writer
  explained still says the page couldn't be read. The wire keeps its three
  fields (`fetchState`, `fetchError`, `fetchedAt`), which `readingOf` reads at
  each boundary. Rejected: each writer setting the three fields by hand, and
  each reader pairing them its own way (a card badged a failure over a read,
  and an item said a failed page's text would come soon).
  `packages/contract/src/library/item-reading.ts`.

- **THE ACCOUNT SOCKET'S HINT IS ONE VALUE MOVED BY ONE STEP.**
  `createSocketHint` holds idle, offline, ticketing, connecting, open or
  waiting, moved only by `hintAfter`, whose effects the adapter runs. A ticket
  that fails waits and dials again; `connect()` while a redial waits dials
  once, at once; offline dials nothing and cancels a wait, and online dials
  once. Whatever a socket or a ticket says after another was asked for is
  ignored, by identity. It says up when a socket opens and down whenever an
  open one goes, and each host lets every preview go on down and reads
  everything again on up. Rejected: flags and a generation counter beside the
  socket (a refused ticket left it ticketing for good, and a preview froze
  across a drop). `packages/contract/src/library/account-socket.ts`.

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
