# Decisions: @repo/service and the library model

The account's cell's own rules (its SQL, undo and search), and the model they
apply: an item as fields and blocks and its ops, which `@repo/contract`
holds, and the dialect's markdown grammar the codec and the import read and
write by, with the rules of links and tags, which `@repo/editor` holds.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

Pure and platform-neutral: no node or react import, and no `crypto` or `URL`
global here, in the contract's model or in the editor's grammar
(lint-enforced), and every platform capability (the SQL driver, the clock,
random bytes and fresh ids) is injected.
`packages/editor/src/markdown/mdast-nodes.ts` narrows a transform's bare
`Node` input to the mdast root.

## Library

- **THE PERSISTED NODE SET IS SPELLED HERE, BELOW THE EDITOR, AND IT IS
  STRICT.** `@repo/contract/library/library-nodes` is Plate's own vocabulary as
  zod, every node the editor round-trips: every element a strict object, only
  a top-level block named, by its id and optionally the `ref` a link's
  `blockRef` reaches, a depth and a size checked before the recursive parse
  (`storableBlockSchema`), and a list's indent held to what the writer can nest
  (`LIST_MAX_INDENT`). The editor holds these nodes as they are: a link or
  an embed names its target by id with the title the writer saw, a `#tag` is
  its text, media a sha or a url. Rejected: the vocabulary in `@repo/editor`
  (the cell cannot load Plate), a tag node (two spellings of
  one tag), an id inside a block (Plate names those again in every editor, so
  one block would hash apart), and loose objects (a prop no reader draws).

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

- **UNDO RUNS A CHANGE SET BACKWARDS AS A THREE-WAY MERGE, BLOCK FOR LINE.**
  `@repo/service/library/revert-change`: the set's after is the base,
  the item now is mine, its before is theirs; the order merges by diff3 over
  block ids, fields revert one by one, and an overlap keeps the item whole and
  named. An item the set made goes to Deleted
  unless a person's part changed since (a fill is not a person), told by each
  fill's own change set: a field still holds what the set left or what a fill
  wrote there. Sets undo newest first. Unlike the line oracle the
  suites hold it to (`packages/service/src/test-support/revert-edit.ts`), a block
  keeps its identity across a move, so a block moved, edited and then deleted
  stays deleted. Rejected: a list of the fields a fill owns (it drifts from what
  a fill writes, and a title is a fill's on an unread link and a person's after).
  `packages/service/src/library/revert-change.test.ts`.

- **THE LIBRARY'S SQL IS ONE SCHEMA AND ONE SET OF PLANS, THE CELL'S.**
  `@repo/service/library/library-schema` versions STRICT tables by a
  `meta.schema` row, a mismatch starting the cell over, and asks the engine
  nothing (a Durable Object refuses `sqlite_version()`); `library-sql` runs a
  plan, one statement yielded at a time, over the cell's port or the suites'
  SQLite alike, under 100 parameters and 100 KB a statement;
  `library-queries` matches text with instr() and lays an item, its body and
  derived rows with it, only over an older `seq`. Rejected: SQLite's version
  pragma and pattern-match operators (a Durable Object refuses the one and caps
  the other at 50 bytes); SQL written apart from its plans (it drifts from
  what the suites run).
  `packages/service/src/test-support/wasm-sql-port.ts`.

- **THE LISTING OVER ROWS IS IN MEMORY, AND PINNED LEADS IT.**
  `@repo/contract/library/library-index` holds the cell's listing rows, typed by
  the host's own row, built for the one read that asks, and answers kind, tag
  family, folder (with its subfolders), site, date and search scopes, with
  Deleted apart and a count per kind. It keeps one sorted order per sort, dropped only when a row's place in
  it moves. Rejected: SQL listing queries (a tag family and a folder tree read
  from memory without a join per page).
  `packages/contract/src/library/library-index.test.ts`.

## Items

- **A MARKDOWN FILE'S FACTS ARE ITS FRONTMATTER KEYS, AND ONE READER READS
  THEM.** An import, and the codec reading a file back, take a link's, a
  video's or a note's facts from its frontmatter (`kind`, `url`, `site`,
  `author`, `published`, `saved`, `fetched`, `fetch-error`, `description`,
  `lang`, beside `id`, `tags` and `aliases`) through `readItemFacts`
  (`@repo/editor/items/item-frontmatter`), into the item's fields: a missing or
  unknown `kind` is a note, and an export writes a note none. The filename is
  the title (`itemNameFromTitle` in `@repo/contract/items/item-name`), and a
  `title:` key is written only for a title the file's stem cannot carry, one
  its name mended or numbered or the empty one, so an export reads back as the
  item: `title: ""` is no title, and a blank `title:`, which says nothing,
  leaves the filename standing and stays a property, as an Obsidian template
  writes it. Rejected: a frontmatter block kept in the item (its keys are the
  item's fields).

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

## Knowledge: index, search and links

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Each of
  the four literal columns (title, headings, meta, body) has a stem shadow at
  equal bm25 weight, and `@repo/service/knowledge/search-query` owns the one
  policy every index runs. Every term asks both halves, and that OR is the exact
  tier: a doc holding the literal word scores about twice a stem-only hit.
  Rejected: FTS5's `porter` tokenizer (it stems the index, so a prefix query for
  a half-typed word stops retrieving, 86 of 1,555 labelled prefixes, and it puts
  half a shared policy in SQLite's C). Residual: the title/body gap is 10x, so a
  title collision still beats a body exact match. `search-query.ts`,
  `knowledge/search-excerpt.ts`.

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

- **THE DIALECT'S GRAMMAR IS THE EDITOR'S OWN, AND IT IS TOTAL.** Every reader
  of markdown, the codec, an import and the editor alike, parses through one
  plugin list (`@repo/editor/markdown/md-plugins`), so what reads as prose is
  what the editor draws as prose: no indented code, no flow html, and math as
  latex, never a link. No input throws: with no jsx or expressions, `<` opens an
  html tag, an autolink or text and `{` is prose, and a tag folds with its
  closer as the tree compiles (`@repo/editor/markdown/remark-inline-html`), as
  the editor pairs it, or stays an `html` literal. An escape stays on the text
  it wrote even where GFM splits that text for a bare url
  (`@repo/editor/markdown/text-escapes`). A reference reads as the link or image
  it names and a definition one used goes, so every reader after the parse
  meets a link; a definition nothing used stays its line, as source
  (`@repo/editor/markdown/remark-references`,
  `@repo/editor/markdown/remark-opaque`). A footnote reads as its text by the
  time the parse ends: its call the `[^label]` it spells, and its definition
  its own blocks where it stood, led by `[^label]: `, so its words are searched
  like any others and an edit of a call's line alone reads it the same.
  Rejected: a second, plain-markdown grammar for an import (it needed a bridge
  to say where the two disagreed), a node for a reference in the library (a
  second spelling of every link), holding a footnote as its source (its words
  would go unsearched, and an edit would read a call apart from its
  definition), and switching GFM's footnote constructs off (CommonMark would
  read `[^a]: word` as a link definition, and the call as a link to its words).
  `packages/editor/src/markdown/total-grammar.test.ts`.

- **AN MD URL HAS ONE READING, AND ONLY AN IMPORT RESOLVES ONE BY PATH.** An
  import reads a link's or an image's url through `mdLinkTarget`
  (`@repo/editor/knowledge/link-extract`) and resolves it with `buildResolver`
  beside the file that wrote it, so a folder's relative links and pictures
  become links by id and files by sha, and a file's path written as a url, by
  the codec or an import's `![[…]]`, goes through `mdLinkUrl`, its inverse, so
  a `#` or `%` in a name reads back. Past the import nothing is a path: the
  editor reaches an item by `[[…]]` through the resolver its host feeds with
  the library's items (`packages/editor/src/link-resolver-feed.ts`) and a file
  by its sha, and only an http(s) url reaches the browser. Rejected: resolving
  a live note's relative url (no library item has a path to resolve it
  against).
  `packages/editor/src/codec/import-plan.ts`.

- **A WIKI LINK NAMES WHAT THE RESOLVER ANSWERS TO, AND ONE FUNCTION BESIDE THE
  PARSER WRITES IT.** `.md` is the one extension a file's link leaves off
  (`wikiLinkName` in `@repo/contract/knowledge/doc-file`), and `buildResolver`,
  which an import reads a zip's links by, keys that name, so a
  `.txt` note links as `[[todo.txt]]`. Past the zip there are no files: the cell
  and the editor reach an item by its id or by `titleKey`. Rejected: dropping
  every doc extension (it loses Obsidian's reading and the pinned resolver).
  The `[[` picker links an item by its id, with its title, so no rename breaks
  it. Every writer's bytes come from `serializeWikiBody`
  (`@repo/editor/markdown/remark-wiki-link`), and its null writes nothing.
  `packages/editor/src/knowledge/link-resolve.test.ts`.

- **A LINK IS SPELLED BARE ONLY WHERE GFM READS IT BACK IN ITS PLACE.** A link
  whose label is its own address writes no label, so a url written by hand stays
  as typed. But gfm ends a literal short of trailing punctuation, runs it on to
  the next space and wants no word before it, so the writer's link handler asks
  gfm itself, over the literal and the bytes either side as they are about to be
  written, and every other link keeps `[text](url)`, which always reads back.
  A link touching a mark keeps its label, since the
  writer may spell the character beside a mark as a reference, and a literal with
  no space before the next link does too, as does a marked literal after a link,
  whose closer it would join. So does a link in a mark's own node, which only a
  held source holds, since a literal runs on through the closer into bytes the
  writer cannot see, and a mark over a held link's label, which would read back
  as that node. A mail address with a `>` after it does too, since only one
  character before shows and a `<` further back would close on it as an angle
  link to another address. Rejected: a copy of gfm's rules (it reads
  a literal twice, in its tokenizer and over finished text, by two different
  trails, and a copy of either drifts), deciding in the rule table (a rule sees
  no neighbour), a pass over the tree ahead of the write (only the write knows
  what it will escape), labelling every link in a held source (a url written
  by hand in a tag would not stay as typed) and every link
  writing all it looks past in full (each tag deep multiplied the writes).
  `packages/editor/src/markdown/autolink-text.ts`,
  `packages/editor/src/markdown-bare-links.test.ts`.
