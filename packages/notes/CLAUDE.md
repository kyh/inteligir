# Decisions: @repo/notes

The library model (an item as fields and blocks, its ops, its undo and its
SQL), the dialect's markdown grammar the codec, the import and the export read
and write by, and the rules of search, links and tags.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

Pure and platform-neutral: no node, react or ui import and no `crypto` global
(lint-enforced), and every platform capability (the SQL driver, the clock,
random bytes and fresh ids) is injected.
`markdown/mdast-nodes.ts` narrows a transform's bare `Node` input to the mdast
root.

## Library

- **THE PERSISTED NODE SET IS SPELLED HERE, BELOW THE EDITOR, AND IT IS
  STRICT.** `@repo/notes/library/library-nodes` is Plate's own vocabulary as
  zod, every node the editor round-trips: every element a strict object, only
  a top-level block named, by its id and optionally the `ref` a link's
  `blockRef` reaches, a depth and a size checked before the recursive parse
  (`storableBlockSchema`). The editor holds these nodes as they are: a link or
  an embed names its target by id with the title the writer saw, a `#tag` is
  its text, media a sha or a url. Rejected: the vocabulary in `@repo/editor`
  (the cell and the replicas cannot load Plate), a tag node (two spellings of
  one tag), an id inside a block (Plate names those again in every editor, so
  one block would hash apart), and loose objects (a prop no reader draws).

- **AN ITEM IS FIELDS AND BLOCKS, AND EVERYTHING ELSE IS DERIVED IN THE SAME
  TRANSACTION.** `@repo/notes/library/library-item` caps every field, and each
  list and the properties by their JSON's bytes, so the largest legal row,
  card and url key included, stays well inside a Durable Object's 2 MB
  (`packages/notes/src/library/library-queries.test.ts` sums it).
  `deriveItem` reads the card (an empty
  title falls back to the first heading, then the first line; the outline
  keeps the first h1 to h3, as the editor's contents do, each cut to a line),
  the index text (every heading ranks), the links by id or url key, and each
  block's anchored highlights. The card alone rides its row, so a replica draws
  an item before its body arrives. Rejected: syncing the other derived rows
  (two derivations would drift), a frontmatter block (its keys are columns).
  `packages/notes/src/library/derive-item.ts`.

- **A BLOCK IS GUARDED BY ITS HASH, ITS PLACE BY ITS KEY, A FIELD BY ITS
  VALUE.** `@repo/notes/library/block-ops`: insert, put, drop, move and the
  field patches each name their base; a batch lands whole or answers every
  conflict, an op already true is satisfied, a list field merges as a set, so
  two devices tagging at once both land, a tag respelled takes its new spelling
  where it stands, and a batch whose landed fields break a cap (a merge past
  the list's length) lands none and answers `invalid`.
  The hash is SHA-256 over canonical JSON (`@noble/hashes`, synchronous for
  the cell's transaction) cut to 128 bits. Rejected: one version per item
  (two blocks would conflict) and the platform's crypto (async in a Durable
  Object, absent from Hermes).
  `packages/notes/src/library/block-ops.test.ts`.

- **A BLOCK'S PLACE IS A FRACTIONAL KEY, READ NOTE BEFORE ARTICLE.**
  `@repo/notes/library/block-order` mints keys with `fractional-indexing`;
  equal keys from two devices order by block id, and `isOrdKey` holds a key to
  the whole format, since the library checks only its head and its last digit.
  `placeInOrder` restores every old key when they all still fit, else moves
  the fewest blocks. Rejected: integer positions (an insert renumbers, and two
  renumberings conflict) and interleaving the sections (a fill's keys would
  thread through the person's).

- **UNDO RUNS A CHANGE SET BACKWARDS AS A THREE-WAY MERGE, BLOCK FOR LINE.**
  `@repo/notes/library/revert-change`: the set's after is the base,
  the item now is mine, its before is theirs; the order merges by diff3 over
  block ids, fields revert one by one, highlights entry by entry, and an
  overlap keeps the item whole and named. An item the set made goes to Deleted
  unless a person's part changed since (a fill is not a person), told by each
  fill's own change set: a field still holds what the set left or what a fill
  wrote there. Sets undo newest first. Unlike the line oracle the suites hold it
  to (`packages/notes/src/test-support/revert-edit.ts`), a block keeps its
  identity across a move, so a block moved, edited and then deleted stays
  deleted. Rejected: a list of the fields a fill owns (it drifts from what a
  fill writes, and a title is a fill's on an unread link and a person's after).
  `packages/notes/src/library/revert-change.test.ts`.

- **THE LIBRARY'S SQL IS ONE SCHEMA AND ONE SET OF PLANS FOR EVERY ENGINE.**
  `@repo/notes/library/library-schema` versions STRICT tables, a replica's
  outbox among them, by a `meta.schema` row, a mismatch starting the engine
  over, and holds a replica to SQLite 3.37 (a Durable Object refuses
  `sqlite_version()`); `library-sql` runs a plan, one statement yielded at a
  time, over either port, under 100 parameters and 100 KB a statement;
  `library-queries` matches text with instr() and lays an item, its body and
  derived rows with it, only over an older `seq`. Rejected: SQLite's version
  pragma and pattern-match operators (a Durable Object refuses the one and caps
  the other at 50 bytes); SQL per engine (it drifts).
  `packages/notes/src/test-support/wasm-sql-port.ts`.

- **THE LISTING OVER ROWS IS IN MEMORY, AND PINNED LEADS IT.**
  `@repo/notes/library/library-index` holds a replica's listing rows, typed by
  the host's own row, and answers kind, tag family, folder (with its
  subfolders), site, date and search scopes, with Deleted apart and a count per
  kind. It keeps one sorted order per sort, dropped only when a row's place in
  it moves. Rejected: SQL listing queries (a tag family and a folder tree read
  from memory without a join per page).
  `packages/notes/src/library/library-index.test.ts`.

## Items

- **A MARKDOWN FILE'S FACTS ARE ITS FRONTMATTER KEYS, AND ONE READER READS
  THEM.** An import, and the codec reading a file back, take a link's, a
  video's or a note's facts from its frontmatter (`kind`, `url`, `site`,
  `author`, `published`, `saved`, `fetched`, `fetch-error`, `description`,
  beside `id`, `tags` and `aliases`) through `readItemFacts`
  (`@repo/notes/items/item-frontmatter`), into the item's fields: a missing or
  unknown `kind` is a note, and an export writes a note none. The filename is
  the title (`itemNameFromTitle` in `@repo/notes/items/item-name`). Rejected:
  a `title:` key (two names that drift); a frontmatter block kept in the item
  (its keys are the item's fields).

- **A URL HAS ONE KEY, COMPUTED WITHOUT THE PLATFORM'S URL.**
  `@repo/notes/items/item-url` parses by the RFC 3986 appendix-B regex. The key
  drops the scheme, userinfo, `www.`, a default port, the tracking parameters
  and a non-route fragment, folds the host and its aliases (`youtu.be`, `x.com`,
  a mobile host) and sorts the query; `cleanUrl`, what an item's url holds,
  drops only userinfo and tracking parameters, so `urlKey(cleanUrl(u)) ===
  urlKey(u)` (a seeded property). The key is a row `deriveItem` writes with
  every write of the item, and `URL` is a banned global here
  (`oxlint.config.ts`). Rejected: `new URL()` (React Native's is not WHATWG, so
  the phone and the Mac would disagree); the key as a field (a rule change
  strands every item on the old one).

## Annotations

- **AN ANNOTATION IS A HIGHLIGHT AND AN OPTIONAL NOTE, STORED BY THE ITEM'S
  ID.** Markers, `%%i:<id>[,<id>…]:start%%…%%i:<ids>:end%%`, wrap the passage in
  the item's blocks; entries are the item's rows in its library's
  `annotations` table (`@repo/notes/library/library-schema`), keyed by entry id (`text`, `""` for a bare highlight; a root's `quote`;
  `createdAt`/`updatedAt` in unix seconds; `source`; a reply's `parentId`). The
  fold lists roots in marker order, then the unanchored by creation
  (`foldAnnotations` in `@repo/notes/annotations/annotation-threads`). An
  unanchored root is waiting on a link not yet read, whose fill places it by its
  quote, and
  missing elsewhere, derived on every answer, never stored (a stored claim
  breaks whichever of text and store is written first). Rejected: resolve (a
  reading mark is not a task) and the comments name (two spellings forever).
  `@repo/notes/annotations/store-schema`.

## Knowledge: index, search and links

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Each of
  the four literal columns (title, headings, meta, body) has a stem shadow at
  equal bm25 weight, and `@repo/notes/knowledge/search-query` owns the one
  policy every index runs. Every term asks both halves, and that OR is the exact
  tier: a doc holding the literal word scores about twice a stem-only hit.
  Rejected: FTS5's `porter` tokenizer (it stems the index, so a prefix query for
  a half-typed word stops retrieving, 86 of 1,555 labelled prefixes, and it puts
  half a shared policy in SQLite's C). Residual: the title/body gap is 10x, so a
  title collision still beats a body exact match. `search-query.ts`,
  `knowledge/search-excerpt.ts`.

- **NO READER DECIDES WHAT A DOC IS ON ITS OWN.** `@repo/notes/knowledge/doc-file`
  is the one answer: `isDocPath` (`.md`, `.markdown`, `.mdx`, `.txt`) and
  `docStem`, which an import asks of every file it is handed. Rejected: a
  private `.md` rule in a reader (it leaves out every `.txt` note and disagrees
  on a name once it is not lowercase). What any other file is in the library
  is `fileKindOf` (`@repo/notes/items/item-kind`), and what a doc is as an item
  is its `kind`: one answer each, for every reader.

- **THE DIALECT'S GRAMMAR IS THE EDITOR'S OWN, AND IT IS TOTAL.** Every reader
  of markdown, the codec, an import and the editor alike, parses through one
  plugin list (`@repo/notes/markdown/md-plugins`), so what reads as prose is
  what the editor draws as prose: no indented code, no flow html, and math as
  latex, never a link. No input throws: with no jsx or expressions, `<` opens an
  html tag, an autolink or text and `{` is prose, and a tag folds with its
  closer as the tree compiles (`@repo/notes/markdown/remark-inline-html`), as
  the editor pairs it, or stays an `html` literal. An escape stays on the text
  it wrote even where GFM splits that text for a bare url
  (`@repo/notes/markdown/text-escapes`). Rejected: a second, plain-markdown
  grammar for an import (it needed a bridge to say where the two disagreed).
  `packages/notes/src/markdown/total-grammar.test.ts`.

- **AN MD URL HAS ONE READING, AND ONLY AN IMPORT RESOLVES ONE BY PATH.** An
  import reads a link's or an image's url through `mdLinkTarget`
  (`@repo/notes/knowledge/link-extract`) and resolves it with `buildResolver`
  beside the file that wrote it, so a folder's relative links and pictures
  become links by id and files by sha. Past the import nothing is a path: the
  editor reaches an item by `[[…]]` through the resolver its host feeds with
  the library's items (`packages/editor/src/link-resolver-feed.ts`) and a file
  by its sha, and only an http(s) url reaches the browser. Rejected: resolving
  a live note's relative url (no library item has a path to resolve it
  against). `packages/editor/src/codec/import-plan.ts`.

- **A WIKI LINK NAMES WHAT THE RESOLVER ANSWERS TO, AND ONE FUNCTION BESIDE THE
  PARSER WRITES IT.** `.md` is the one extension a link leaves off
  (`wikiLinkName` in `@repo/notes/knowledge/doc-file`), and the resolver keys
  that name, so a `.txt` note links as `[[todo.txt]]`. Rejected: dropping every
  doc extension (it loses Obsidian's reading and the pinned resolver). An
  export spells a link by `wikiTargetForPath`
  (`@repo/notes/knowledge/link-resolve`: the name when it resolves back, else
  the path), and the `[[` picker links an item by its id, with its title, so
  no rename breaks it. Every writer's bytes come from `serializeWikiBody`
  (`@repo/notes/markdown/remark-wiki-link`), and its null writes nothing.
  `packages/notes/src/knowledge/link-resolve.test.ts`.
