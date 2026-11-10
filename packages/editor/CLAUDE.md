# Decisions: @repo/editor

The editor, the dialect it reads and writes, an item's live note, and the
dialect's one grammar with the links and a file's facts it reads.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

The Plate WYSIWYG: kits and nodes for every dialect construct, the md-rules
table over Plate's stock markdown and the suites that hold what it means, and
an item's editor
(`packages/editor/src/item/item-editor.tsx`) bound to its note's live document,
which a host drives through the `EditorHost` singleton
(`packages/editor/src/host-io.ts`, opened to React by `host.ts`), installed by
one `installEditorHost` call per host. Its
`EditorHostIo` reads the library by its own keys (THE EDITOR'S HOST SPEAKS THE
LIBRARY), and the library's titles a host hands `setLibraryTitles` sit beside
it, so no host keeps a store of its own (THE `[[` PICKER IS PLATE'S MENTION
INPUT); its
`EditorHostActions` (Ask agent, `showTag` and a new note, all required) are
how a deep node asks the shell. The item editor provides the id of the item it
shows (`open-item.tsx`), which a heading's fold is keyed by. `node-props.ts` is the
SLATE DECODE BOUNDARY: a node's dialect fields ride `TElement`'s open index
signature, so each read arrives as `unknown` and becomes a domain value there
alone, and no walk narrows structurally.
`packages/editor/src/markdown/mdast-nodes.ts` narrows a transform's bare
`Node` input to the mdast root.

## Editor and dialect

- **THE EDITOR IS A WYSIWYG OVER AN ITEM'S BLOCKS, AND EVERY MARKDOWN THE CODEC
  WRITES GOES THROUGH `serializeNote`** (epic #579, owner decision). Plate.js
  over Plate's stock markdown: one remark plugin list
  (`@repo/editor/markdown/md-plugins`) and one rule table
  (`@repo/editor/markdown/md-rules`) for the nodes Plate's own table lacks or
  gets wrong. The live editor writes the note's document, never markdown (AN
  ITEM IS EDITED BY ITS ID); the codec's import and export and the agent's view
  and edits all call `serializeNote`, since the rule table expects its
  whole-value pre-pass (a block nested in a list, an empty equation). Meaning is
  the codec's tested contract, never bytes: a read keeps every letter a person
  wrote, a write is its own fixpoint, and what a value means survives a write
  and a read, over every node the model holds
  (`packages/editor/src/markdown/md-matrix.test.ts`), the corpus
  (`md-corpus.test.ts`) and typed text (`md-text-safety.test.ts`); the fixtures
  are formatter-exempt. `readMarkdown` refuses with a typed reason, never a
  throw: a file nested past what the conversion and the writer hold is
  `too-deep` and a rule that throws is `failed`, and every caller treats either
  as a refusal (an import leaves the file out, an agent's edit is turned down, a
  paste lands as plain text). A list is flat in the model, so nothing but a cap
  holds it inside the writer's recursion: `LIST_MAX_INDENT`, which the read
  refuses past, the vocabulary stores no deeper than and a Tab stops at. Any
  other nesting is refused past the depth a storable item reads as
  (`READ_MAX_DEPTH`), measured on the parsed tree before Plate builds a node,
  since that build costs more than linear in depth and its stack runs out where
  each platform's frames put it; a stack that still runs out in the parse is
  refused too, which V8 says as a RangeError or, compiling a regular expression,
  as a SyntaxError (`withinStack`). Rejected: a byte-exact codec of our own
  (most of the editor's code, for round trips no reader needs); a raw editor
  beside the rich one (markdown is not at rest); Plate's bare `serialize` (no
  pre-pass); a catch per item around a write (a list a writer cannot hold would
  land, and read nowhere after); and refusing only where a stack runs out (a
  quote 6,000 deep builds for seconds on x64 first, and one platform reads what
  another refuses). `packages/editor/src/markdown/markdown-doc.ts`,
  `packages/editor/src/markdown/md-read.ts`, `packages/editor/README.md` §
  Invariants.

- **THE MARKDOWN RUNS HEADLESS, AND AN IMPORTED PAGE IS WRITTEN AS ITS OWN
  FIXPOINT.** The base kits are headless files
  (`packages/editor/src/kits/headless/`), each live kit adding its components,
  so the codec runs in node with no React, `@repo/ui` or renderer
  (`packages/editor/src/headless-kits.test.ts`). `canonicalizeImported` answers
  an imported page's markdown as its blocks write it and the share of its
  letters kept (`lettersKept`, a multiset, so a letter dropped is not paid back
  by one the writer added), or nothing when the read refuses it
  (`packages/editor/src/markdown/markdown-doc.ts`).

- **THE EDITOR SHIPS ITS BEHAVIOUR CSS, AND THE APPEARANCE DIALS ARE ONE
  DECLARATION.** The editor's sheet reaches each host through its `globals.css`
  import, and every hook is spelled once and pinned both ways and to each
  import, since a missing sheet fails no other test
  (`packages/editor/src/style-hooks.ts`). The tokens are declared once in
  `apps/web/src/library/styles/globals.css` and read with no fallback; the phone
  page writes its own value for each, with no dials and `--editor-size` at 16px
  or more, since iOS zooms into smaller text
  (`tools/repo-guards/src/appearance-tokens.test.ts`). Rejected: an accent axis
  (nothing in Plate consumes a hue).

- **NOTES SPEAK THE INTELIGIR DIALECT, AND IT IS STOCK MARKDOWN WITH
  DIRECTIVES** (#931, owner decision). CommonMark and GFM as Plate writes them;
  a page link is Plate's mention, written `[Title](mention:<id>)`, an untitled
  item's as `[Untitled](…)`, which reads back as no title; `:date[2026-08-22]`
  date chips and `:formula[display]{source="…" meta="…"}` formula pills; inline
  math `$$…$$` (a single `$` is text); GitHub alerts (`> [!NOTE]` … `>
  [!CAUTION]`) as THE callout; `inteligir-chart` / `inteligir-canvas` /
  `inteligir-html` fences, and Mermaid a stock code block; the `::::tabs` of
  `:::tab[Label]` panels, `:::toggle` and the `::::columns` of
  `:::column{width="40%"}` containers; the top-level `article` container that
  holds the page a fill read, the article through the codec alone (the live
  document holds no container, only each block's `section`); and `![](url)`
  embeds. A bare url is written `<url>`. Only a web url embeds (`![](path)` is a
  file the import resolves to its bytes; alt text or a title keeps a web image
  an image). What markdown cannot spell is lost on a write, each loss in the
  changelog: underline, a link's title, a table's alignment, an image's width, a
  web file's name, an ordered list's restart inside a run, and a heading or a
  quote as a list item, which stands outside the list. Every fence name lives in
  `@repo/editor/markdown/fence-langs`, which
  `tools/repo-guards/src/agent-skills.test.ts` holds the skills to, and the
  skills' examples read as the constructs they show
  (`packages/editor/src/skill-examples.test.ts`). The codec writes plain `.md`:
  no bundles, no meta.json. Rejected: transclusion (`![[Note]]` reads as a link,
  and nothing draws another item's text inside one); an owned grammar for any of
  it (STOCK BEFORE CUSTOM, in `AGENTS.md`).
  `packages/editor/src/markdown/md-plugins.ts`,
  `packages/editor/src/markdown/md-rules.ts`.

- **A DIRECTIVE THE DIALECT DOES NOT NAME IS ITS TEXT, AND TYPED TEXT STAYS
  TEXT.** remark-directive reads every `:name`, `::name` and `:::name`, so a
  directive the dialect does not read (an unknown name, a leaf, a date that is
  no day) is restored to the bytes that wrote it, an unknown container's
  marker lines as paragraphs around what it held. Inside a line the writer
  escapes a `:` only before `date` or `formula`, the names that could turn
  typed text into a node, so `10:30` stays as typed; a line that opens with
  colons keeps the stock escape. Every text a person types reads back as
  itself, and a url they type becomes its link
  (`packages/editor/src/markdown/md-text-safety.test.ts`). Rejected: the
  directive writer's own escape before any word (`10\:30` on every save), and
  reading constructs from finished text (an owned grammar beside the stock
  one). `restoreUnknownDirectives` in
  `packages/editor/src/markdown/md-plugins.ts`.

- **THE DIALECT HAS NO JSX, AND RAW HTML IS ITS TEXT**: its blocks are
  remark-directive's containers, a container holding others written with a
  longer fence than theirs, and a tag is the text it spells: the persisted set
  holds no raw leaf, and a `<br>` reads as a line break (A `<br/>` IN A TABLE
  CELL IS THE BOUNDARY BETWEEN ITS BLOCKS). Rejected: jsx tags for the toggle,
  columns, dates and embeds (an MDX tokenizer in the grammar, a jsx writer in
  the serializer, and tags other markdown tools draw as raw html); a raw html
  node (a second spelling of what the blocks hold, and markup the editor cannot
  edit); and a date as a `[[YYYY-MM-DD]]` link (it costs the chip and its
  calendar). `packages/editor/src/markdown/md-rules.ts`.

- **THE ALERT IS THE ONLY CALLOUT** (owner decision): a quote whose text
  leads with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`,
  in either case, reads and writes as that alert; a marker of any other kind is
  escaped on the write, so it stays a quote's text. An `inteligir-callout`
  fence is a plain code block and a `<callout>` tag its text. Rejected: reading
  either as a callout, a second grammar with its own node and index pass for
  kinds the five alerts cannot spell.
  `packages/editor/src/markdown/md-alerts.test.ts`.

- **AN ITEM'S PROPERTIES ARE ITS FIELDS, AND THE PANEL DRAWS ANY SOURCE OF
  ROWS**: the panel reads an item's own `properties` field as its host holds it
  (`ItemFields`), each row's edit one property op over the value the item holds,
  a row typed by the frontmatter reader's own rules and a value no row can edit
  (an object, a list that is not all words) drawn as it is and never written
  (`packages/editor/src/item/item-properties.ts`). The panel reads whatever
  source it is handed (`packages/editor/src/properties/property-source.ts`), and
  an item's own fields (its title, tags, folder and pin) are Info's, so no key
  has two editors. Only a file has frontmatter: a `---` fence that opens a
  paste, an agent's text or a page is that text's own lines, read as a YAML code
  block (`packages/editor/src/markdown/md-rules.ts`). Rejected: a frontmatter
  block in an item (its keys are columns).

- **THE PLATE SLASH MENU IS THE INSERTION SURFACE, AND THE TOUCH TOOLBAR IS ITS
  SOFT-KEYBOARD TWIN.** Slash rows are grouped data: each row's markdown
  escapes none of the constructs it inserts and is its own fixpoint, and no two rows
  write the same bytes, so a second name is a keyword on its row (`/day` finds
  Date). A soft keyboard has no chord and a finger no hover, so each touch
  toolbar button is a row of a table the desktop reads; only what no table holds
  is a touch row, and its suite refuses any other. A locked editor offers no
  rich-block row. An empty inline equation writes no bytes (owner decision):
  markdown has no empty inline math. `packages/editor/src/slash-items.tsx`,
  `packages/editor/src/touch-toolbar.tsx`.

- **A BINDING IS SPELLED FROM THE TABLE ITS LISTENER READS, never as a
  literal.** Five tables own every chord, each walked by its handler; the marks'
  table builds Plate's shortcut config, so Plate's defaults never run. Every
  label and key glyph (`KEY_CAPS`) derives from those rows
  (`@repo/ui/lib/hotkey-spelling`). A chord two tables share is refused (both
  would run), and a row claims shift explicitly, so an unshifted one never fires
  shifted. The rail's `[` and the panel's `]` are BARE rows, live only with
  focus outside a field. The grid and the item view read the library's table
  (`apps/web/src/library/library/library-keys.ts`), so Escape to the library
  is the item view's, never the window's, and a field keeps its own.
  `packages/editor/src/mark-shortcuts.ts`,
  `apps/web/src/library/global-shortcuts.ts`.

- **A PIN IS THE ITEM'S `pinnedAt` FIELD, AND THE CELL SETS IT.** It is the
  item's, so every device and the agent agree, and a pinned item leads the grid
  in every scope and sort; unpinning sets it null. A press asks the cell to pin
  or unpin (`items.organize`), which sets what was asked over whatever another
  device left, so there is nothing to merge (`pin` in
  `apps/web/src/library/library/library-verbs.ts`). Rejected: a Pinned
  heading (more height than it explains).

- **AN EXTRACT IS ONE UNDO STEP, AND ITS NOTE IS AN ITEM OF ITS OWN.** An
  extract asks the host for a note of the very blocks it moves, as the item
  stores them, in the open item's folder (`items.createNote`, which a link's
  Create asks too), before touching the item, and lands the removal and a link
  to the note by its id as an undo step of its own (`ownUndoStep`, since the
  note's undo joins whatever lands within its capture window), so one undo
  restores both and keeps the typing either side. The note stays: its create and
  the item's edit are two writes. Rejected: create-or-reuse by title (an item of
  that name counts as success and the blocks are lost); the blocks sent as
  markdown (their ids and marks would turn over).
  `packages/editor/src/extract-note.ts`.

- **A FORMULA RECOMPUTE IS NOT AN EDIT, AND A BOUND REF'S ITEM IS FOUND BY ID.**
  A bound ref names an item by its id, so a pass reads only the items its pills
  name, each one's blocks through the host's `readItemBlocks`, this item's own
  pills from the live value, and runs again when another item changes
  (`followItemFormulas`). The display a recompute rewrites lands outside the
  note's undo (`withoutSaving`, which `YHistoryPlugin` carries to the document's
  undo), since the user never typed it and one undo must reach their own last
  edit. Rejected: reading every item to find one id (a recompute runs after each
  typing pause). `packages/editor/src/formulas/formula-recompute.ts`.

- **A BLOCK OVERLAY NAMES ITS BLOCK BY NODE ID AND SUBSCRIBES TO THE DOCUMENT.**
  A path goes stale after an insert above, since Plate re-renders a block only
  when its own node changes, so the heading fold and the drag handle key a block
  by its node id and read the document through a selector that moves only when
  what they draw does. Plate turns the id plugin off under NODE_ENV=test, so
  such a suite mounts the harness with ids on.
  `packages/editor/src/heading-collapse.tsx`,
  `packages/editor/src/block-draggable.tsx`.

- **A SAVE KEEPS EVERY LINE BREAK.** A soft break saves as a hard break,
  since the model holds both as one `"\n"`, and the hard break is a backslash;
  a link is always a link node, so a url before the break is written `<url>`
  and never takes the backslash into its address. A save may split a line,
  never join two. `packages/editor/src/markdown/md-stringify.test.ts`,
  `packages/editor/src/markdown/md-rules.ts`.

- **TYPING IN A LONG NOTE WALKS IT ONLY THROUGH A RECORDED BUDGET, AND THE
  BUDGET FINDS ITS PASSES.** In a 10k-line note a keystroke, a caret move and
  the settle may walk the whole note only through passes a row names with its
  reason, timed as ratios to the note's growth and its parse, so a slow runner
  cannot fail them but a per-block store atom does. A block near the end records
  the stack of every read, so a new pass fails by its function's name. Rejected:
  instrumenting the known passes (it misses the one nobody did). An unaffordable
  pass caches by top-level block. `packages/editor/src/typing-budget.test.tsx`,
  skipped by `SKIP_TYPING_BUDGET` on the 7 GB macOS runner, which swaps
  (`packages/editor/vitest.config.ts`).

- **A KEYSTROKE PAYS FOR NO STORE ATOM PER BLOCK.** Plate's navigation flash and
  flat-model toggle hider each hold one that every change recomputes, so both
  are off (`packages/editor/src/kits/toggle-kit.tsx`, `navigationFeedback` in
  `packages/editor/src/item/item-editor.tsx`). They read no block, so they
  leave the budget no stack, and
  `packages/editor/src/per-block-subscriptions.test.tsx` holds them off by name.

- **THE PHONE RUNS THE DESKTOP'S EDITOR THROUGH A TOUCH KIT, AND ITS RICH BLOCKS
  ARE READ-ONLY IN THE MODEL** (owner decision). The touch kit is the content
  kit, the lock and touch chrome, so a desktop pointer surface stays off the
  phone until named (`packages/editor/src/kits/touch-editor-kit.ts`). Inside a
  rich block (chart, canvas, html, tabs, columns) every op but a whole-block
  insert, remove or move is refused, so a block changed elsewhere lands whole
  and undo restores a deletion, while another device's change and a
  normalizer's fix land, since the live document already holds the one and
  Slate's normalizer loops forever on a refused other
  (`packages/editor/src/kits/rich-block-lock-kit.ts`), and `beforeinput`
  refuses keystrokes inside, which slate-react defers to an input event never
  fired. Rejected: the desktop kit minus its pointer chrome, and
  hiding only the edit buttons (a paste or key still gets in).

- **A MERMAID FENCE IS DRAWN BY PELE, SYNCHRONOUSLY, AND ITS THEME IS CSS.**
  Pele (`pele`, MIT) reads Mermaid 12.1 into SVG with no runtime dependency,
  loads lazily with a note's first diagram, and draws in each change's layout
  effect, with no debounce. A parse failure shows Pele's line and column, a
  drawing failure (an impossible date, the size cap) shows in the same frame,
  and the last drawing stays, dimmed. Colours and faces are the frame's
  `--pele-*` variables over the app's tokens (`packages/editor/src/styles.css`),
  so a theme repaints with no redraw, and a change on the root element
  re-measures each drawing's labels. Rejected: mermaid.js (about 2 MB, an async
  render behind a debounce, its theme baked into its DOM).
  `packages/editor/src/nodes/code-block-mermaid.tsx`.

- **A DIAGRAM LOADS NOTHING, AND ITS MARKUP BECOMES NODES ONLY THROUGH THE
  INERT-SVG PARSE.** A diagram draws no link and no image and is handed no icon
  set, as nothing remote draws in an item (THE LIBRARY'S PAGE IS A ROUTE OF THE
  SITE, in `apps/web/CLAUDE.md`).
  `packages/editor/src/lib/inert-svg.ts` parses Pele's markup as XML and keeps
  only the svg namespace's elements, less every script, handler and reference
  that leaves the drawing.

- **A LONG NOTE RENDERS IN RUNS OF A HUNDRED BLOCKS THAT SKIP THEIR LAYOUT AND
  PAINT OFF SCREEN, AND EVERY BLOCK STAYS MOUNTED.** Slate's chunking splits the
  top level into runs (`CHUNK_BLOCKS` in
  `packages/editor/src/item/item-editor.tsx`), so a keystroke re-renders one.
  Each run is a `content-visibility: auto` flow-root held at an estimated, then
  its last, height (`EditorChunk` in `packages/editor/src/editor-chrome.tsx`),
  overhanging the column by the gutter for the handles that hang left; what
  hangs below sits in its block's box, and a drag unclips its runs. Print draws
  every run (`apps/web/src/library/styles/print.css`). Rejected: virtualization
  (Slate needs the DOM of every node a selection, find or far link reaches) and
  a ProseMirror rewrite (it redoes the markdown conversion, the hard part).
  `packages/editor/src/long-note-chunks.test.tsx`.

- **A RUN NOT YET DRAWN MISPLACES NO SCROLL, JUMP OR HEADING.** WebKit, the Mac
  app's and the phone's engine, keeps no scroll anchor, so where
  `overflow-anchor` is unsupported the editor keeps one: a run wholly above the
  view that changes size, or first draws with its top above the view's, moves
  the scroller by as much, except the run a jump or the caret landed in, and a
  far jump lands at once and holds its target for a moment, or until the person
  scrolls (`holdInView` in `packages/editor/src/run-anchoring.ts`,
  `packages/editor/src/scroll-reveal.ts`). The outline places its scanner line
  by the runs' boxes before it measures a heading (`activeHeadingAt` in
  `packages/editor/src/toc.tsx`). Rejected: content-visibility only where the
  engine anchors itself (no paint skip in the shipped app). Residual: Chromium
  keeps its own anchor, so no scenario can show WebKit's, and a long note's far
  jump and scroll back up are the owner's check on a Mac (`docs/releasing.md`).
  `packages/editor/src/run-anchoring.test.tsx`.

- **MARKDOWN IS A CODEC BESIDE THE LIBRARY.** `@repo/editor/codec/*` reaches
  no React, so it runs wherever the library does (THE MARKDOWN RUNS
  HEADLESS). It reads a file into an
  item's fields and blocks over the rule table and writes one back as
  markdown, a file under the item's name, so `import(export(item))` means the
  item, ids aside, over every fixture
  (`packages/editor/src/codec/item-markdown.test.ts`). The rule table reads
  and writes the library's own nodes, so the codec only names what the
  dialect spells by words: a page link's id to an item the reader knows on the
  way in, a link to no item it knows staying its words (`read-blocks.ts`), and
  on the way out an id to the title the caller spells it with and a sha to a
  path (`write-blocks.ts`). Obsidian's `[[Title]]`, `[[Title#Heading]]`,
  `[[Title|alias]]` and `![[…]]` are read only where markdown comes in from
  outside the library, an import and the agent's text, through the resolver
  the caller hands in: a page it names is a page link, its anchor and alias
  dropped, a file an embed names an image of that file, and anything it names
  nothing for stays the text it was, never to become a link later
  (`packages/editor/src/markdown/remark-wiki-import.ts`). `[[#Heading]]`,
  `^ref`, `%%…%%` and `==…==` are the text they spell, since an item keeps no
  anchor, block id, comment or highlight. A block no store takes is counted
  among what an import could not read, and an edit, a note the agent writes or
  a save's note holding one is turned down; a link or image with no address is
  its words or its source, so it takes no block with it (EVERY READER PARSES
  THROUGH ONE PLUGIN LIST says what a definition reads as). A list item is its
  words, and a block nested in one sits at the item's indent plus one; one the
  item opens with nests under an empty line, but for a heading, which is the
  item's words. Rejected: Plate's list rule alone (it made
  every such block a `p`, which holds no address, fence or source). What
  follows a `$$` on its line leads the expression, since an equation holds no
  fence meta and a person who opens `$$ E = mc^2` wrote it there. An agent's
  edit must match once, keep the article's own lines and nest no deeper than
  the editor reads; only the blocks it spans are read again, matched by
  content so the rest keep their ids. Rejected: re-reading a whole item per
  edit (every block's id would turn over). `packages/editor/src/markdown/md-rules.ts`,
  `packages/editor/src/codec/item-edit.ts`,
  `packages/editor/src/codec/library-links.ts`.

- **AN ITEM IS EDITED BY ITS ID, OVER ITS NOTE'S LIVE DOCUMENT, DRAWN ONCE
  THAT HAS SYNCED.** `noteConnection` dials the note's object with
  y-partyserver's provider through the host's `notes` port (`NoteHost`: the
  cloud's origin, a fresh ticket each dial, the note's path, whether the host
  is offline), presence off, and shows a document only once it has synced, so
  no device seeds a note and nothing is typed into a value the note then replaces
  (`packages/editor/src/item/note-connection.ts`). The item editor binds it
  (`packages/editor/src/item/item-editor.tsx`): a connection per item id, an
  editor per document, drawn anew over each connect, which hands the editor
  fresh nodes. The status is one value: opening; missing, which the object
  says by closing the socket 4404, since the provider redials any other close
  forever; or open, with whether an edit reaches the note now and whether the
  note holds every edit back (`full`, or `deleted` while the item is in
  Deleted), which the object says in a custom message, ahead of the sync to a
  socket that opens on one. A ping every 20 s that no pong answers within 5 s
  dials a fresh socket over the same document, a page shown again or a
  connection back probes at once, and a socket down past 3 s turns the editor
  read-only, so a blip goes unseen. A frame the object refused (`read-only`),
  or a note grown full under this socket, drops the document for the note's
  own, shown read-only until it syncs. A leave asks whether the note stored
  every edit made here (`whenSaved`: `saved?`, answered `saved`) once each file
  in flight is kept and Slate's unsent change is handed over; a close answers
  it false, and so does a hold, since the object answers no ask on a socket it
  holds read-only. A picker's input names the document client that opened it, so
  another device draws it inert (`packages/editor/src/live/picker-owner.ts`).
  Rejected: a session writing block ops after a pause (a diff, a merge and a
  conflict path a live document has no need of); seeding a document from a
  device (two opening an empty note would each write one); presence (no
  surface draws it); waiting for a quiet socket's close (it can take minutes);
  the page's own location (a page loaded from a file or a dev server is not
  the cloud).

- **THE EDITOR'S HOST SPEAKS THE LIBRARY: AN ITEM BY ITS ID, A FILE BY ITS
  SHA.** `openItem`, `readItemBlocks`, `onItemsChanged` and `notes` (a note's
  socket) take item ids, a page link shows the title its id goes by in the
  library's titles now, and `readFile(sha)` answers from the host's file source
  (the page's staged bytes, then `/v1/blobs`, in a tab and the Mac app alike;
  the phone's cache over the bridge). A media block holds `{sha}` (a file its
  `name`) or a web `{url}`, its type the Blob's. A page link reaches an item by
  its id, the mention's key; a `[[Title]]` in an import or the agent's text
  reaches one by `titleKey`, the key the cell resolves a title by; a markdown
  url resolves by path only in an import. Rejected: paths a host maps to items
  (two titles share one); `mime` on the block (a second copy of the file's
  type). `packages/editor/src/host-io.ts`,
  `packages/editor/src/nodes/library-file.ts`.

- **A FILE PASTED OR DROPPED INTO A NOTE IS KEPT BEFORE ITS BLOCK IS WRITTEN.**
  The editor refuses one past the host's `fileMaxBytes` in words before reading
  it, has the host keep the rest by sha (`keepFile`) under the file's type, or
  plain bytes when the browser gives none (`keptFileType`, as the window's own
  saves), and inserts the blocks where the paste or the drop landed, in the
  order they came, the caret after the last: an image, a video or a file card,
  whose Download only a host that `savesFiles` offers. Only the editor the file
  came into inserts its block, and only while its edits reach the note: one gone
  read-only or closed meanwhile says it could not add the file, and a leave
  waits for each keep. A browser's copy of a web picture pastes as its markup.
  Rejected: the bytes held until a pause (a quit in the pause lost them); a card
  opening a blob of the page's origin (it could run script).
  `packages/editor/src/kits/image-kit.tsx`.

- **A FOLD IS THE DEVICE'S VIEW STATE, AND HOLDS NONE OF THE LIBRARY'S WORDS.**
  Which headings an item has folded sits in the page's local storage, each by a
  hash of its rank, text and ordinal, since that storage is out of the phone's
  wipe and in its device backup. The Mac and the tab drop it on leaving the
  account (`apps/web/src/library/cloud/account-storage.ts`). Rejected: a fold
  in the cell (it is one device's view, and every fold a write); the heading's
  text as the key (it stayed on the phone after a sign-out). Residual: the
  phone's page keeps the ids and hashes, which name nothing, past a sign-out.
  `packages/editor/src/heading-collapse.tsx`.

- **A TABLE CELL KEEPS A CODE SPAN'S AND AN EQUATION'S PIPES.** gfm splits a
  row at every bare pipe before any inline is read. An inline equation in a
  row writes its pipes as `\|` and reads them back as gfm reads a code span's,
  and TeX's own `\|` is written `\Vert`, the same double bar. A code span's
  pipe is written after an odd run of backslashes, which gfm pairs back to the
  span's own; an odd run the span held itself has no spelling, so it reads
  back one backslash longer and from there holds. A pipe in a directive's
  attribute, which has no backslash escape, is written as the character
  reference the value decodes. Rejected: `\vert` for a bare pipe (it means
  nothing in `\begin{array}{c|c}` or `\text{a|b}`), and gfm's own handler (a
  span's `\|` would write a divider).
  `packages/editor/src/markdown/md-plugins.ts`.

- **A `<br/>` IN A TABLE CELL IS THE BOUNDARY BETWEEN ITS BLOCKS.** The table
  writer joins a cell's blocks with that tag and has no other word for a cell's
  second line, so the read cuts a cell at any `<br>` it holds. An image is a
  block wherever it stands in a cell, so a tag beside one, a space between them
  or not, is the edge it already has, and a line of spaces alone holds no words
  of the cell's. A cell settles on its first write, and its two lines stay two
  through an edit anywhere in the table. Rejected: holding the tag as source
  (a re-read of the table would turn a person's second line into a tag), an
  inline image in a cell (a second image node for one place), and a writer that
  drops the tag beside an image (it would filter Plate's private output).
  `packages/editor/src/markdown/md-rules.ts`.

- **WITH NO CONNECTION AN ITEM READS BUT TAKES NO EDIT, AND ONE TYPED BEFORE THE
  CONNECTION WENT REACHES THE NOTE WHEN IT IS BACK.** The host says it is
  offline (`notes.offline`), or the note's socket stays down past its grace, and
  the surface goes read-only under Plate's `readOnly` and says "Needs a
  connection" above the text, the words every screen says of what only the cloud
  answers. Slate keeps typing out of a read-only editor but hands its paste,
  drop and keys on to Plate's plugins, so every plugin whose DOM handler could
  write is `editOnly`, Plate's own keydown among them (its Tab indents), and
  each left live is named with why it writes nothing
  (`packages/editor/src/read-only-handlers.test.ts`). What edits around the
  editor reads the same flag: the find bar offers no replace, the touch toolbar
  draws nothing and no formula recomputes. An edit typed while the socket was
  going stays in the document, which the provider's sync hands the note once the
  socket is back. A note that cannot open while the host is offline draws what
  the host holds of it (`readItemBlocks`) read-only under the same words, until
  the note opens; a host holding none, or whose read fails, shows the words
  alone (`packages/editor/src/item/held-item.tsx`). Rejected: queueing an edit
  offline (the cloud is the truth, and a queue that outlives the tab is a
  second writer); a read-only flag of the editor's own (every node and toolbar
  already reads Plate's); a read-only check inside each handler (a new plugin
  would miss it, where `editOnly` is Plate's own gate); a blank surface until
  the note opens (an item read before shows nothing on a plane).
  `packages/editor/src/item/item-editor.tsx`.

- **A KEY TYPED BEFORE A PICKER'S INPUT HAS FOCUS IS ITS QUERY.** Between a
  trigger opening a picker (the slash menu, `[[`, `{{`) and its input taking
  focus, a key reaches Slate with the caret in the picker's element, a void,
  where Slate drops an insert. The content kit's innermost `insertText` lands
  it in the element's hidden text instead (`PickerRaceKit`), and the input
  types it in as the browser types, so Base UI narrows the rows and lights the
  first as it does for any key. Rejected: setting the query from the input's
  effect (Base UI lights a row only on the input's own change, so Enter picked
  nothing); leaving the race to timing in the e2e (a loaded runner loses it at
  random, so the scenario runs it every time).
  `packages/editor/src/combobox-input.ts`,
  `packages/editor/src/inline-combobox.tsx`,
  `tools/e2e/src/scenarios/slash-menu-browser.ts`.

- **A NOTE'S BODY IS ONE LIVE DOCUMENT, EVERY EDITOR OF IT IS BOUND
  INNERMOST, AND EVERY KIT HOLDS AND FIXES ITS NODES ALIKE.**
  `yjsBindingPlugin` sits beneath every kit plugin, so each op reaches the
  document as the plugins outside it left it, NodeId's ids included; while it
  applies another editor's change NodeId names nothing, since a move arrives as
  an insert before its delete under the id it has. Undo is a `Y.UndoManager`
  over the editor's own origin (`YHistoryPlugin`), so it takes back this
  editor's changes and no one else's, and `editor.tf.withoutSaving` keeps a
  write out of it. `seedDoc` writes a note's blocks as BASE_KIT normalizes
  them, so an editor connecting has nothing to fix, and `readBlocks` reads
  them back as the library stores them, each in its `section`. A writer's
  block edits land through the editor by id (`applyBodyChanges`): a put that
  keeps the block's shape edits it in place by code point, so a person's typing
  in it meanwhile stays, and a batch whose base moved lands nothing. Every kit
  holds each node as BASE_KIT does and writes the same fix for the same state
  (`packages/editor/src/kit-parity.test.ts`), or each reader rewrites what its
  writer left and two readers write it twice. Rejected: `@platejs/yjs` (its
  provider config is a closed union a custom provider joins only by a type
  assertion, it bundles hocuspocus, y-webrtc and y-indexeddb, 44 KB gzip
  nothing runs, its init waits 5 s for a sync, and its `withTYjs` and
  `withTYHistory` pass through); the binding at Plate's default priority (the
  ids NodeId gives never reach the document).
  `packages/editor/src/live/yjs-binding.ts`,
  `packages/editor/src/live/note-blocks.ts`,
  `packages/editor/src/live/body-change.ts`.

- **THE EDITOR AND `@repo/ui` REACH NO oRPC MODULE.** The phone's editor page is
  a Metro DOM bundle, which Expo compiles with classes transpiled to functions,
  and oRPC's builder dies under that at boot while typecheck and the export stay
  green, so lint refuses `@orpc/*` and every module of `@repo/contract` that
  reaches it (`v1`, `v1/errors`, `refusal-text`, the library's contract and
  `call-outcome`) under `packages/editor/src` and `packages/ui/src`. What a
  screen says with no connection is `@repo/contract/needs-connection`, apart
  from the refusal rule. Rejected: stubbing the module for the page's bundle (a
  second spelling of one import, which the web's bundle would not share); a
  Babel override (Expo offers none for a DOM component). `oxlint.config.ts`.

## The grammar, links and a file's facts

- **EVERY READER PARSES THROUGH ONE PLUGIN LIST, AND NO INPUT THROWS OUT OF
  IT.** The codec, an import, a paste and the editor read through
  `MD_REMARK_PLUGINS` (`@repo/editor/markdown/md-plugins`): frontmatter first,
  so a leading `---` is claimed before the thematic break reads it, `$$` math,
  GFM, the unused-definition pass and the dialect's directives. Every entry
  normalizes CRLF to LF first, and deserialize's own normalization is proven
  beside it (`packages/editor/src/markdown/md-read.test.ts`). A reference reads
  as the link or image its label's first definition names, and a definition
  nothing used, or a label's second, is the line it was written as, so no
  words a person wrote go. A footnote reads as its text: its call the
  `[^label]` it spells, and its definition a paragraph led by `[^label]: `
  where it stood, so its words are searched like any others. Entities are
  decoded. Rejected: a second, plain-markdown grammar for an import (two
  readings drift), a node for a reference in the library (a second spelling of
  every link), and holding a footnote as its source (its words would go
  unsearched). `packages/editor/src/markdown/md-corpus.test.ts`.

- **AN MD URL HAS ONE READING, AND ONLY AN IMPORT RESOLVES ONE BY PATH.** An
  import reads a link's or an image's url through `mdLinkTarget`
  (`@repo/editor/knowledge/link-extract`) and resolves it with `buildResolver`
  beside the file that wrote it, so a folder's relative links and pictures
  become links by id and files by sha, and a file's path written as a url, by
  the codec or an import's `![[…]]`, goes through `mdLinkUrl`, its inverse, so
  a `#` or `%` in a name reads back. Past the import nothing is a path: the
  editor reaches an item by a page link's id, its `[[` picker the library's
  titles (THE `[[` PICKER IS PLATE'S MENTION INPUT), and a file by its sha,
  and only an http(s) url reaches the browser. Rejected: resolving
  a live note's relative url (no library item has a path to resolve it
  against).
  `packages/editor/src/codec/import-plan.ts`.

- **A `[[…]]` NAMES WHAT THE RESOLVER ANSWERS TO.** `.md` is the one
  extension a file's link leaves off (`wikiLinkName` in
  `@repo/contract/knowledge/doc-file`), and `buildResolver`, which an import
  reads a zip's links by, keys that name, so a `.txt` note links as
  `[[todo.txt]]`; a zip links only within itself. Past the zip there are no
  files: the cell and the editor reach an item by its id or by `titleKey`.
  Rejected: dropping every doc extension (it loses Obsidian's reading and the
  pinned resolver). `packages/editor/src/knowledge/link-resolve.test.ts`.

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

- **THE `[[` PICKER IS PLATE'S MENTION INPUT, OVER THE LIBRARY'S TITLES.**
  `MentionPlugin` opens its input on a `[` typed after a `[`, outside a code
  block, so `[[` opens it and an `@` stays the character typed; the first `[`
  stays typed until a pick takes it (`consumeTriggerLead`). The rows are the
  library's titles, which a host hands `setLibraryTitles` each time its listing
  of them answers, a title's prefix ranked first and the list cut before any
  row mounts (`packages/editor/src/mention/rank-titles.ts`), since Base UI's
  filter and Plate's `filterWords` only filter. A pick is Plate's own mention
  insert, by the item's id with the title it goes by, so no rename breaks it,
  and a page link's chip reads the same titles, so it shows the name the item
  goes by now. A title no item has offers Create, which makes the note before
  linking it and leaves the words typed as text when the note was not made;
  typing `]]` links the item the words name by `titleKey`, the first the
  library lists, or leaves them the text they are. The popup, its keys and its
  IME-safe Enter are Base UI's Combobox (A PICKER IS BASE UI'S, in
  `packages/ui/CLAUDE.md`). Rejected: a trigger plugin and input element of our
  own (Plate's mention input opens on a trigger and the character before it);
  a resolver store each host fed and kept (every host hands the editor the
  same list). `packages/editor/src/kits/mention-kit.tsx`,
  `packages/editor/src/mention/mention-input.tsx`,
  `packages/editor/src/host-io.ts`.
