# Decisions: @repo/notes

The library model (an item as fields and blocks, its ops, its undo and its
SQL), and the markdown vault's knowledge engine beside it until its last
client moves: the scan, the index's rules,
search, links and tags. `AGENTS.md` § Decisions says how a bullet is written
and cited.

## Shape

Pure and platform-neutral: no node, react or ui import and no `crypto` global
(lint-enforced), and every platform capability (the SQL driver, the clock,
random bytes and fresh ids) is injected.
`markdown/mdast-nodes.ts` is the mdast NARROWING boundary: a walk asks it what a
node is rather than discriminating structurally at each visit.

## Library

- **THE PERSISTED NODE SET IS SPELLED HERE, BELOW THE EDITOR, AND IT IS
  STRICT.** `@repo/notes/library/library-nodes` is Plate's own vocabulary as
  zod: every element a strict object, a top-level block always named by its
  id, a depth and a size checked before the recursive parse
  (`storableBlockSchema`). A wiki link names its target by id with the title
  the writer saw, an image, file or video holds a sha or a url, and a marker
  keeps `ids` and a pill its `meta` as the editor holds them. Rejected: the
  vocabulary in `@repo/editor` (the cell and the replicas cannot load Plate,
  and this package is the leaf every one of them reaches), and loose objects
  (a prop no reader draws would land).

- **AN ITEM IS FIELDS AND BLOCKS, AND EVERYTHING ELSE IS DERIVED IN THE SAME
  TRANSACTION.** `@repo/notes/library/library-item` caps each field inside a
  Durable Object's 2 MB row; `tags` is a column, the source `item_tags`
  derives from beside the body's tag chips.
  `deriveItem` reads the card (an empty title falls back to the first heading,
  then the first line), the index text, the links by id, title key or url key,
  and each block's anchored highlights. Rejected: syncing derived rows (two
  derivations would drift), a frontmatter block (its keys are columns).
  `packages/notes/src/library/derive-item.ts`.

- **A BLOCK IS GUARDED BY ITS HASH, ITS PLACE BY ITS KEY, A FIELD BY ITS
  VALUE.** `@repo/notes/library/block-ops`: insert, put, drop, move and the
  field patches each name their base; a batch lands whole or answers every
  conflict, an op already true is satisfied, and a list field merges as a set,
  so two devices tagging at once both land. The hash is SHA-256 over canonical
  JSON (`@noble/hashes`, synchronous for the cell's transaction) cut to 128
  bits. Rejected: one version per item (two blocks would conflict) and the
  platform's crypto (async in a Durable Object, absent from Hermes).
  `packages/notes/src/library/block-ops.test.ts`.

- **A BLOCK'S PLACE IS A FRACTIONAL KEY, READ NOTE BEFORE ARTICLE.**
  `@repo/notes/library/block-order` mints keys with `fractional-indexing`;
  equal keys from two devices order by block id, and `isOrdKey` holds a key to
  the whole format, since the library checks only its head and its last digit.
  `placeInOrder` restores every old key when they all still fit, else moves
  the fewest blocks. Rejected: integer positions (an insert renumbers, and two
  renumberings conflict) and interleaving the sections (a fill's keys would
  thread through the person's).

- **UNDO RUNS A CHANGE SET BACKWARDS IN REVERT-EDIT'S ORIENTATION, BLOCK FOR
  LINE.** `@repo/notes/library/revert-change`: the set's after is the base,
  the item now is mine, its before is theirs; the order merges by diff3 over
  block ids, fields revert one by one, highlights entry by entry, and an
  overlap keeps the item whole and named. An item the set made goes to Deleted
  unless a person's part changed since (a fill is not a person). Sets undo
  newest first. Unlike revert-edit, a block keeps its identity across a move,
  so a block moved, edited and then deleted stays deleted.
  `packages/notes/src/library/revert-change.test.ts`.

- **THE LIBRARY'S SQL IS ONE SCHEMA AND ONE SET OF PLANS FOR THREE
  ENGINES.** `@repo/notes/library/library-schema` versions STRICT tables by a
  `meta.schema` row, and a mismatch starts the engine over;
  `@repo/notes/library/library-sql` runs a plan (a generator yielding one
  statement at a time) over the cell's synchronous port or a replica's
  asynchronous one, and cuts many-row statements under 100 parameters and 100
  KB; `library-queries` matches text with instr(). Rejected: SQLite's
  version pragma and its pattern-match operators (a Durable Object refuses the
  one and caps the other at 50 bytes) and SQL per engine (it drifts). `packages/notes/src/test-support/wasm-sql-port.ts`.

- **THE LISTING OVER ROWS IS IN MEMORY, AND PINNED LEADS IT.**
  `@repo/notes/library/library-index` holds a replica's listing rows, typed by
  the host's own row, and answers kind, tag family, folder (with its
  subfolders), site, date and search scopes, with Deleted apart and a count per
  kind. It keeps one sorted order per sort, dropped only when a row's place in
  it moves. Rejected: SQL listing queries (a tag family and a folder tree read
  from memory without a join per page).
  `packages/notes/src/library/library-index.test.ts`.

## Items

- **AN ITEM IS ONE MARKDOWN FILE, AND `@repo/notes/items` IS ITS ONE READER AND
  WRITER.** A link, a video, an image's wrapper and a person's note are each one
  doc, whose facts are frontmatter keys (`kind`, `url`, `site`, `author`,
  `published`, `saved`, `fetched`, `fetch-error`, `description`, beside `id`,
  `tags`, `pinned` and `aliases`) read by `readItemFacts`: a missing or unknown
  `kind` is a note, and a note writes none. The filename is the title
  (`itemNameFromTitle` in `@repo/notes/items/item-name`). A stub is an app-made
  url item whose page is unread, which needs the `id` and `saved` every writer
  stamps (`isItemStub`). Rejected: a `title:` key (two names that drift).

- **EVERY ITEM WRITE IS A LINE CUT, AND EVERY ITEM A WRITER MAKES IS THE
  EDITOR'S FIXPOINT.** A write of an item's keys (`withItemFields` in
  `@repo/notes/items/item-frontmatter`, over `replaceTopLevelKey`) leaves every
  other byte of the block alone and puts an added key in its compose position,
  so two devices filling one stub write the same bytes. A body sits one blank
  line under the block, the editor's own spelling (`composeItemFile`, and
  `withBody` in `@repo/notes/items/item-body`), so the item opens rich
  (`packages/editor/src/item-embed-spelling.test.ts`).

- **AN ITEM'S COVER, ORIGINAL AND PAGE COPY ARE READ FROM ITS EMBEDS, NEVER
  STORED.** They are computed from its first embeds and its links on every read
  (`@repo/notes/items/item-files`). A media file no doc embeds is a card of its
  own (a bare file); the library rules file, the dot-folders and the covers and
  page copies folders are never cards. Rejected: a frontmatter cover path
  (rename's link rewrite and the phone never see it), and wrapping every file a
  doc mentions (a pasted image and a cover would each become a card).

- **A URL HAS ONE KEY, COMPUTED WITHOUT THE PLATFORM'S URL.**
  `@repo/notes/items/item-url` parses by the RFC 3986 appendix-B regex. The key
  drops the scheme, userinfo, `www.`, a default port, the tracking parameters
  and a non-route fragment, folds the host and its aliases (`youtu.be`, `x.com`,
  a mobile host) and sorts the query; `cleanUrl`, what `url:` holds, drops only
  userinfo and tracking parameters, so `urlKey(cleanUrl(u)) === urlKey(u)` (a
  seeded property). The key is projected, so a rule change bumps
  `PROJECTION_VERSION`, and `URL` is a banned global here (`oxlint.config.ts`).
  Rejected: `new URL()` (React Native's is not WHATWG, so the phone and Mac
  would disagree) and storing the key in frontmatter (a rule change strands
  every file on the old one).

- **THE LIBRARY LISTING IS AN IN-MEMORY INDEX BESIDE THE TAGS.**
  `@repo/notes/items/library-index` lives inside `LinkGraphIndex`, fed every
  file, its live resolver and tag index. Its members are every doc and bare
  media file, less the hidden paths; pinned items lead every sort; it filters by
  kind, folder, tag family, untagged, site and saved date, and counts the scope
  per kind, ignoring the asked kinds. It keeps one sorted order per sort,
  dropped only when membership or that sort's key moves, so a page costs its own
  rows, and a new path files its own resolver keys (`createPathResolver` in
  `@repo/notes/knowledge/link-resolve`). Rejected: SQLite columns (tag families,
  bareness and mtime live in memory) and re-resolving per new path (550–630 ms
  at 50k). `packages/notes/src/items/library-cost.test.ts`.

## Annotations

- **AN ANNOTATION IS A HIGHLIGHT AND AN OPTIONAL NOTE, STORED BY THE ITEM'S
  ID.** Markers, `%%i:<id>[,<id>…]:start%%…%%i:<ids>:end%%`, wrap the passage in
  the item's bytes; entries live in `.inteligir/annotations/<item id>.json`,
  keyed by entry id (`text`, `""` for a bare highlight; a root's `quote`;
  `createdAt`/`updatedAt` in unix seconds; `source`; a reply's `parentId`). The
  fold lists roots in marker order, then the unanchored by creation
  (`foldAnnotations` in `@repo/notes/annotations/annotation-threads`). An
  unanchored root is waiting on a stub, whose fill places it by its quote, and
  missing elsewhere, derived on every answer, never stored (a stored claim
  breaks whichever of text and store is written first). Rejected: resolve (a
  reading mark is not a task) and the comments name (two spellings forever).
  `@repo/notes/annotations/store-schema`.

## Sync

- **TWO VERSIONS OF ONE SAVED LINK SETTLE ON ONE TEXT, WHICHEVER DEVICE ASKS.**
  A side's fill mark is its `fetched` as written. If both changed it
  differently, a total order picks the winner (fetched, then read over
  `fetch-error`, earlier fetch, earlier save, smaller text) and the loser's
  edits since base ride onto it (tags, aliases, its own keys, the earlier
  `saved`, a missing `id`, an unfetched loser's note). If one did, the filler's
  text takes the editor's edits, its body by diff3, or against a first fill the
  editor's note for the stub's. Only a text-replacing refresh against a body
  edit answers null and falls to the copy.
  `packages/notes/src/sync/url-item-verdict.test.ts`.

- **ONE URL-ITEM VERDICT RUNS IN EVERY MERGE, AND BOTH ASKERS LAND THE SAME
  BYTES.** It takes a pair only when both read as a url item (or the image or
  PDF a fill made of one) with one url key, over a base with that key or none.
  Every rule is phrased by role and every diff3 runs in one orientation, so no
  copy is made. It runs in reconcile-file (the desktop's sync merge and the
  phone's queue) and in the editor's merges (`mergeItemTexts`). Rejected: a
  Worker lease so one device fills (a new /cloud protocol for what a pure
  verdict settles), and renaming on fill (git cannot pair the rename with a
  concurrent phone edit). `@repo/notes/sync/url-item-verdict`.

## Knowledge: index, search and links

- **Stemming is a SHADOW of the indexed text, never a rewrite of it.** Each of
  the four literal columns (title, headings, meta, body) has a stem shadow at
  equal bm25 weight, and `@repo/notes/knowledge/search-query` owns the one
  policy both engines run. Every term asks both halves, and that OR is the exact
  tier: a doc holding the literal word scores about twice a stem-only hit.
  Rejected: FTS5's `porter` tokenizer (it stems the index, so a prefix query for
  a half-typed word stops retrieving, 86 of 1,555 labelled prefixes, and it puts
  half a shared policy in SQLite's C). Residual: the title/body gap is 10x, so a
  title collision still beats a body exact match. `search-query.ts`,
  `knowledge/search-excerpt.ts`.

- **THE CLIENT DOES NOT DECIDE WHAT A DOC IS.** `@repo/notes/knowledge/doc-file`
  is the one answer: `isDocPath` (`.md`, `.markdown`, `.mdx`, `.txt`) and
  `docStem`. Rejected: a private `.md` rule in a client (it hides every `.txt`
  note and disagrees on display once a name is not lowercase). What any other
  file is in the library is `fileKindOf` (`@repo/notes/items/item-kind`), and
  what a doc is as an item is its `kind`: one answer each, for every client.
  `apps/workspace/src/app/vault-hooks.test.ts` walks the page for either shape.

- **THE SCAN READS A NOTE IN THE EDITOR'S OWN GRAMMAR, AND THAT GRAMMAR IS
  TOTAL.** The knowledge scan walks the editor's plugin list as a bare parse
  (`@repo/notes/markdown/bare-parse`), so the index reads as prose exactly what
  the editor draws as prose: no indented code, no flow html, and math as latex,
  never a link. No input throws: with no jsx or expressions, `<` opens an html
  tag, an autolink or text and `{` is prose, and a tag folds with its closer as
  the tree compiles (`@repo/notes/markdown/remark-inline-html`), as the editor
  pairs it, or stays an `html` literal. Rejected: a second, plain-markdown
  grammar for the scan (it needed a bridge to say where the two disagreed).
  `packages/notes/src/markdown/total-grammar.test.ts`.

- **A RENAME'S SPANS SKIP WHAT THE EDITOR CARRIES AS SOURCE.** A span is a
  licence to rewrite bytes, so the scan withholds spans inside a construct the
  editor carries as its source (`isOpaqueSource` in
  `@repo/notes/markdown/remark-opaque`, walked by
  `@repo/notes/knowledge/link-extract`); the index path emits no spans.

- **A TAG IS A SCOPE ON THE LIBRARY GRID, NOT A VIEW; ITS ITEMS ARE A LISTING,
  NOT A SEARCH; AND A TAG RENAME IS THE LINK RENAME'S SURGERY.** No tag browser
  (owner decision): a `#tag` chip's `showTag` (`packages/editor/src/host-io.ts`)
  scopes the grid, as a rail Tags row does
  (`apps/workspace/src/app/sidebar/tag-list.tsx`,
  `apps/workspace/src/app/library/library-view.tsx`). `knowledge.items({tag})`
  pages the family (`notesInTagFamily` in `@repo/notes/knowledge/tag-notes`)
  with its whole count from the index, since search stops at its ceiling unsaid.
  A non-note item's tags are its frontmatter's (page hashtags are the page's).
  `knowledge.renameTag` splices each entry over its yaml scalar under
  `writeIfUnchanged`, reporting a note changed mid-rename. Rejected:
  re-serializing (it restyles a flow list and rewrites a CRLF one). `isTagName`
  (`@repo/notes/knowledge/tag-grammar`, import-free for the contract) is its
  grammar. `@repo/notes/knowledge/rename-tags.ts`,
  `apps/cli/src/server/knowledge/rename-tag.ts`.

- **VAULT SEARCH IS A LITERAL SCAN BESIDE THE RANKED INDEX, AND BOTH READ THE
  BODY WITHOUT ITS YAML.** FTS5 cannot place a hit inside a line, so
  `knowledge.matches` (behind the palette and `inteligir matches`) scans bodies
  with ONE matcher, `@repo/notes/knowledge/text-matches`, which the find bar's
  jump runs too; the store only pre-narrows by ascii substrings (`docTexts`),
  since LIKE folds ascii case alone. Both engines blank the frontmatter's lines
  (`searchBodyOf` in `@repo/notes/knowledge/search-columns`), so a match's line
  stays the file's; an item's url, site, author, description and tags are ranked
  as `meta`. The scan never rewrites: a many-note change is the agent's, under
  History and Undo (`apps/workspace/src/app/palette/search-page.tsx`). The jump
  lands by match ordinal, since a markdown column is not a Slate offset.

- **AN MD URL HAS ONE READING, AND THE EDITOR RESOLVES IT WITH THE INDEX'S
  RESOLVER.** The scan and the editor read a link's or an image's url through
  `mdLinkTarget` (`@repo/notes/knowledge/link-extract`), and the editor resolves
  it from its note with the index's `buildResolver`
  (`packages/editor/src/link-resolver-feed.ts`), so the image the index cannot
  resolve is the one drawn missing, a vault url opens in the app, and only an
  http(s) url reaches the browser. A missed image falls back to a root path,
  since a pasted asset lands before the listing. A non-image embed draws as a
  file card whose Open shows the original in the system's viewer
  (`packages/editor/src/nodes/file-card.tsx`), since an `<img>` over it is
  broken. `useVaultLinkTarget` in `packages/editor/src/host.ts`,
  `packages/editor/src/nodes/image-node.tsx`, `link-node.tsx`,
  `packages/editor/src/transclusion.tsx`.

- **A WIKI LINK NAMES WHAT THE RESOLVER ANSWERS TO, AND ONE FUNCTION BESIDE THE
  PARSER WRITES IT.** `.md` is the one extension a link leaves off
  (`wikiLinkName` in `@repo/notes/knowledge/doc-file`), and the resolver keys
  that name, so a `.txt` note links as `[[todo.txt]]`. Rejected: dropping every
  doc extension (it loses Obsidian's reading and the pinned resolver). The `[[`
  picker, extract and a rename target `wikiTargetForPath`
  (`@repo/notes/knowledge/link-resolve`: the name when it resolves back, else
  the path), but a rename refuses the bare name unless no other file answers to
  it (`answersOnly` in `packages/notes/src/knowledge/rename-links.ts`), since
  rewriting links the user never typed must not lean on the resolver's
  tie-break. Every writer's bytes come from `serializeWikiBody`
  (`@repo/notes/markdown/remark-wiki-link`), and its null writes nothing.
  `packages/notes/src/knowledge/link-resolve.test.ts`.

- **COPY LINK COPIES THE ITEM'S `[[wiki link]]`, FOR EVERY KIND.** It copies
  `wikiLinkFor`'s link, and a name no link can carry copies nothing and says so;
  a url item also offers Copy address, which copies its `url`. Rejected: a
  loopback URL (it opened nothing anywhere else and died with the port).
  `apps/workspace/src/app/item/item-topbar.tsx`.
