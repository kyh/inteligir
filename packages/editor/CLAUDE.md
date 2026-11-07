# Decisions: @repo/editor

The editor, the dialect it round-trips, and an open item's merge.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

The Plate WYSIWYG: kits and nodes for every dialect construct, the md-rules
table, the fixpoint serializer and its fixtures, and an item's editor
(`packages/editor/src/item/item-editor.tsx`) a host drives through its
session's ports and the `EditorHost` singleton
(`packages/editor/src/host-io.ts`, opened to React by `host.ts`), installed by
one `installEditorHost` call per host. Its
`EditorHostIo` reads the library by its own keys (THE EDITOR'S HOST SPEAKS THE
LIBRARY) and carries the link resolver store, so no host writes its own; its
`EditorHostActions` (Ask agent, `showTag`, a highlight's create, note and
open, and a new note, all required) are how a deep node asks the shell. The
item editor provides the id of the item it shows (`open-item.tsx`), which a
highlight's tint, a heading's fold and an embed's cycle check are keyed by.
`static-note.tsx` draws an item's blocks read-only, for an embed. `node-props.ts` is the
SLATE DECODE BOUNDARY: a node's dialect fields ride `TElement`'s open index
signature, so each read arrives as `unknown` and becomes a domain value there
alone, and no walk narrows structurally.

## Editor and dialect

- **THE EDITOR IS A WYSIWYG OVER AN ITEM'S BLOCKS, AND EVERY MARKDOWN THE
  CODEC WRITES GOES THROUGH `serializeNote`** (epic #579, owner decision).
  Plate.js over one owned parse, one rule table and a bounded fixpoint. The
  live editor writes block ops, never markdown (AN ITEM IS EDITED BY ITS ID);
  the codec's import and export, the agent's view and edits, and the block
  merge's markdown all call `serializeNote`, since the rule table expects its
  whole-value pre-pass. Byte stability is the codec's tested contract: a
  canonical file round-trips byte-exact, a churn-class construct may
  canonicalize on its first read (said per fixture), the fixtures are
  formatter-exempt, and a file nested past the conversion's depth is refused
  (an import leaves it out, an agent's edit is turned down), so every item
  opens rich. Rejected: a raw editor beside the rich one (markdown is not at
  rest), a paragraph rule's prune (a heading or list item saved `**a****b**`)
  and Plate's `serializeMd` (no pre-pass, a ZWSP beside every chip).
  `packages/editor/src/markdown/markdown-doc.ts`, `packages/editor/README.md`
  § Invariants.

- **THE FIXPOINT RUNS HEADLESS, AND AN IMPORTED PAGE IS WRITTEN AS ITS OWN
  FIXPOINT.** The base kits are headless files
  (`packages/editor/src/kits/headless/`), each live kit adding its components,
  so the fixpoint runs in node with no React, `@repo/ui` or renderer
  (`packages/editor/src/headless-kits.test.ts`). `canonicalizeImported` answers
  an imported page's canonical markdown and the share of its letters kept, or
  nothing when the result is not canonical
  (`packages/editor/src/markdown/markdown-doc.ts`).

- **THE EDITOR SHIPS ITS BEHAVIOUR CSS, AND THE APPEARANCE DIALS ARE ONE
  DECLARATION.** The editor's sheet reaches each host through its `globals.css`
  import, and every hook is spelled once and pinned both ways and to each
  import, since a missing sheet fails no other test
  (`packages/editor/src/style-hooks.ts`). The tokens are declared once in
  `apps/workspace/src/styles/globals.css` and read with no fallback; the phone
  page writes its own value for each, with no dials and `--editor-size` at 16px
  or more, since iOS zooms into smaller text
  (`tools/repo-guards/src/appearance-tokens.test.ts`). Rejected: an accent axis
  (nothing in Plate consumes a hue).

- **NOTES SPEAK THE INTELIGIR DIALECT**: `[[Title]]` / `[[Title#H]]` /
  `[[#H]]` / `[[Title|alias]]` / `[[Title|uuid]]` wiki links (the last pipe
  starts the alias, an anchor alone stays in its own item, a link by id may hold
  no title while its item has none, and a body that reaches nothing is kept as
  its source), `{{source|display|meta}}` formula pills, `%%i:id:start/end%%`
  annotation markers, `@2026-08-22` date chips, `<u>…</u>` underline, GitHub
  alerts (`> [!NOTE]` … `> [!CAUTION]`) as THE callout, `inteligir-chart` /
  `inteligir-canvas` / `inteligir-html` fences, the `:::tabs`, `:::toggle` and
  `:::columns` containers, the top-level `:::article` that holds the page a
  fill read, and `![](url)` embeds, all valid, round-tripping markdown, the
  article through the codec alone (the live editor holds no section). Only a
  web url embeds (`![](path)` is a file the import resolves to its bytes; alt
  text or a title keeps a web image an image). Every spelling lives in
  `@repo/notes/markdown/fence-langs`, which
  `tools/repo-guards/src/agent-skills.test.ts` holds the skills to. An export
  is plain nested `.md`: no bundles, no meta.json.

- **A DIALECT CONSTRUCT IS READ FROM FINISHED TEXT, SO A BACKSLASH KEEPS ONE
  TEXT.** Pills, dates, annotation markers and `:::` lines are read from
  finished text, so a backslash before one's first character keeps it text
  (`\@2026-08-22`), and the serializer writes that escape before typed text the
  next parse would read as one, so what a person types stays text. Obsidian's
  spellings in a note hold to the same rule (MARKDOWN IS A CODEC BESIDE THE
  LIBRARY). `packages/notes/src/markdown/text-escapes.ts`,
  `packages/notes/src/markdown/remark-inline-constructs.ts`.

- **THE DIALECT HAS NO JSX**: its blocks are one `:::` line grammar that nests
  in any flow container, a `:::` closing the innermost, and every tag is html,
  the editor's own only where it is a bare `<u>`
  (`@repo/notes/markdown/remark-containers`). Rejected: jsx tags for the toggle,
  columns, dates and embeds (an MDX tokenizer in the grammar, a jsx writer in
  the serializer, and tags other markdown tools draw as raw html), and a date as
  a `[[YYYY-MM-DD]]` link (it costs the chip and its calendar).

- **THE ALERT IS THE ONLY CALLOUT** (owner decision): an `inteligir-callout`
  fence is a plain code block and a `<callout>` tag is carried as its source,
  both saved byte-exact. Rejected: reading either as a callout, a second grammar
  with its own node and index pass for kinds the five alerts cannot spell.

- **AN ITEM'S PROPERTIES ARE ITS FIELDS, AND THE PANEL DRAWS ANY SOURCE OF
  ROWS**: an item opened by id reads and patches its own `properties` field,
  each row's edit one property op over the value the item holds, a row typed
  by the frontmatter reader's own rules and a value no row can edit (an
  object, a list that is not all words) drawn as it is and never written
  (`packages/editor/src/item/item-properties.ts`). The panel reads whatever
  source it is handed (`packages/editor/src/properties/property-source.ts`),
  and an item's own fields (its title, tags, folder and pin) are Info's, so no
  key has two editors. Only a file has frontmatter: a `---` fence that opens a
  paste, an agent's text or a page is that text's own lines, read as a YAML code
  block (`packages/editor/src/markdown/md-rules.ts`). Rejected: a frontmatter
  block in an item (its keys are columns).

- **THE PLATE SLASH MENU IS THE INSERTION SURFACE, AND THE TOUCH TOOLBAR IS ITS
  SOFT-KEYBOARD TWIN.** Slash rows are grouped data: each row's markdown
  re-parses to a modeled construct and is its own fixpoint, and no two rows
  write the same bytes, so a second name is a keyword on its row (`/day` finds
  Date). A soft keyboard has no chord and a finger no hover, so each touch
  toolbar button is a row of a table the desktop reads; only what no table holds
  is a touch row, and its suite refuses any other. A locked editor offers no
  rich-block row. An empty inline equation writes no bytes (owner decision):
  markdown has no empty inline math. `packages/editor/src/slash-items.tsx`,
  `packages/editor/src/touch-toolbar.tsx`.

- **A BINDING IS SPELLED FROM THE TABLE ITS LISTENER READS, never as a
  literal.** Six tables own every chord, each walked by its handler; the marks'
  table builds Plate's shortcut config, so Plate's defaults never run. Every
  label and key glyph (`KEY_CAPS`) derives from those rows
  (`@repo/ui/lib/hotkey-spelling`). A chord two tables share is refused (both
  would run), and a row claims shift explicitly, so an unshifted one never fires
  shifted. The rail's `[` and the panel's `]` are BARE rows, live only with
  focus outside a field. The grid and the item view read the library's table
  (`apps/workspace/src/app/library/library-keys.ts`), so Escape to the library
  is the item view's, never the window's, and a field keeps its own.
  `packages/editor/src/mark-shortcuts.ts`,
  `apps/workspace/src/app/global-shortcuts.ts`.

- **A PIN IS THE ITEM'S `pinnedAt` FIELD, AND ITS EDIT IS ONE FIELD OP.** It is
  the item's, so every device and the agent agree, and a pinned item leads the
  grid in every scope and sort; unpinning sets it null. The op names the value it
  was computed over, so a pin another device moved first is read again and
  written once more over what it reads now, never merged, as every item field is
  (`pinItems` in `apps/workspace/src/app/library/library-verbs.ts`). Rejected: a
  Pinned heading (more height than it explains).

- **AN EXTRACT IS ONE HISTORY BATCH, AND ITS NOTE IS AN ITEM OF ITS OWN.** An
  extract asks the host for a note of the very blocks it moves, as the item
  stores them, in the open item's folder (`items.createNote`, which a link's
  Create asks too), before touching the item; it refuses blocks anchoring a
  highlight (the entry is this item's row) and lands the removal and a link to
  the note by its id in one change, so one undo restores both and the next
  pause writes them. The note stays: its create and the item's write are two
  writes. Rejected: create-or-reuse by title (an item of that name counts as
  success and the blocks are lost); the blocks sent as markdown (their ids and
  marks would turn over). `packages/editor/src/extract-note.ts`.

- **A FORMULA RECOMPUTE IS NOT AN EDIT, AND A BOUND REF'S ITEM IS FOUND BY ID.**
  A bound ref names an item by its id, so a pass reads only the items its
  pills name, each one's note through the store the open item's session reads,
  this item's own pills from the live value, and runs again when another item
  changes (`followItemFormulas`). The display a recompute rewrites lands
  outside the undo history, since the user never typed it and one undo must
  reach their own last edit. Rejected: reading every item to find one id (a
  recompute runs after each typing pause); a host read of its own (the
  session's store already answers every item the device holds).
  `packages/editor/src/formulas/formula-recompute.ts`.

- **A BLOCK OVERLAY NAMES ITS BLOCK BY NODE ID AND SUBSCRIBES TO THE DOCUMENT.**
  A path goes stale after an insert above, since Plate re-renders a block only
  when its own node changes, so the heading fold and the drag handle key a block
  by its node id and read the document through a selector that moves only when
  what they draw does. Plate turns the id plugin off under NODE_ENV=test, so
  such a suite mounts the harness with ids on.
  `packages/editor/src/heading-collapse.tsx`,
  `packages/editor/src/block-draggable.tsx`.

- **AN EMBED IS ONE LEVEL OF STATIC RENDER, AND EVERY VOID HAS A STATIC ROW.**
  An embed inside an embed stays a chip, the nesting stop, so the only cycle
  left to refuse is a note embedding itself
  (`packages/editor/src/transclusion-guard.ts`). An embed of a heading draws
  its section, to the next heading of its level or above, an embed of a block
  that block, and an anchor gone says so rather than drawing all of the item.
  PlateStatic's default element draws a void empty or throws, so the static
  table holds a row for every void (`packages/editor/src/transclusion.tsx`).

- **A SAVE KEEPS EVERY LINE BREAK.** The rule table keeps the leading `"\n"`
  (a soft break after an inline node) that Plate's default text rule drops. A
  soft break saves as a hard break, since the model holds both as one `"\n"`;
  the hard break is `\`, except after a bare url, which would read it as its
  own. A bare url is an opaque inline, never `html`, which would turn the break
  into a space. A save may split a line, never join two, and
  `analyzeMarkdown` names one that would a loss
  (`packages/editor/src/markdown-fixpoint.test.ts`).
  `packages/editor/src/markdown/md-rules.ts`, `markdown-doc.ts`.

- **ANNOTATION MARKERS PAIR ACROSS THE DOCUMENT, AND THE TINT IS ONE ROOT
  DECORATION.** Markers pair in document order over the whole note, since a
  block annotation is a marker line above a fence and another below it. The
  ranges are the root's alone, since a per-text decoration leaves an untouched
  middle block's tint stale. An extent inside one top-level block is kept by
  that block, relative to it, so a keystroke elsewhere re-pairs without
  measuring it. Rejected: pairing per block (a two-paragraph annotation draws as
  two orphans) and refusing a selection that crosses blocks.
  `packages/editor/src/annotations/annotation-ranges.ts`.

- **AN ANNOTATION IS A HIGHLIGHT FIRST AND A NOTE SECOND.** ⌘⇧H and both
  toolbars' Highlight are one gesture, `highlightSelection`: it writes the
  markers and at once asks the host for the bare entry, its quote clipped by
  `clipQuote` rather than refused; a refusal takes the markers out. A selection
  with no text offers no Highlight. The optional note comes after, in the
  desktop's popover or the touch field; an empty one keeps the bare highlight.
  The tint is `--highlight`, an id the store lacks a dotted underline, and only
  a note or reply earns a gutter dot (`notedIds`). Rejected: an entry written
  only on Save (no bare highlight), and resolve (a reading mark is not a task).
  `packages/editor/src/annotations/annotation-kit.tsx`.

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
  and undo restores a deletion
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
  set, as nothing remote draws in an item (THE LIBRARY'S PAGE IS THE WORKER'S,
  in `apps/web/CLAUDE.md`).
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
  every run (`apps/workspace/src/styles/print.css`). Rejected: virtualization
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
  engine anchors itself (no paint skip in the shipped app).
  `tools/e2e/src/scenarios/desktop-shell/long-note.ts`.

- **MARKDOWN IS A CODEC BESIDE THE LIBRARY, AND IT RUNS HEADLESS.**
  `@repo/editor/codec/*` reaches no React, so it runs wherever the library
  does (`packages/editor/src/headless-kits.test.ts`). It reads a file into an
  item's fields and blocks over the rule table and writes one back as an
  export's markdown, a file under the item's name, so
  `import(export(item))` is the item, ids aside, over every fixture, and a
  canonical file exports its own body but for the changes the test names
  (`packages/editor/src/codec/item-markdown.test.ts`); a value is settled
  through the serializer before it is mapped, so an import is its own
  fixpoint. The rule table reads and writes the library's own nodes, so the
  codec only names what the dialect spells by words: a link's title to its
  item's id on the way in (`read-blocks.ts`), and on the way out an id to the
  name the caller spells it with and a sha to a path (`write-blocks.ts`).
  Obsidian's `==mark==`, `%%x%%` and `^ref` read in the note's section only,
  off its tree ahead of the settle, where an escape still shows, so text a
  person typed that looks like one comes back as text; a `ref` is a node of its
  own from there to the block, written bare where typed text is escaped.
  Rejected: reading them from the settled value (an escape is gone there, so an
  export's `x\==1==y` came back a highlight), and from text a page wrote (the
  page keeps its words). `packages/notes/src/markdown/remark-obsidian.ts`.
  A block no store takes is counted among what an import could not read, and
  an edit, a note the agent writes or a save's note holding one is turned
  down; a link or image with no address is its words or its source, so it
  takes no block with it. An agent's edit must match once, keep the article's
  own lines and nest no deeper than the editor reads; only the blocks it spans
  are read again, matched by content so the rest keep their ids and markers,
  and a highlight it took either edge of is named. Rejected: a second markdown
  grammar for import (two readings drift) and re-reading a whole item per edit
  (every block's id would turn over). `packages/editor/src/codec/item-edit.ts`.

- **AN ITEM IS EDITED BY ITS ID: ITS BLOCKS ARE THE VALUE, AND A PAUSE WRITES
  OPS.** `createItemSession` opens an item over the replica's read, write and
  change feed (`ItemStore`): each top-level element is the block its Plate node
  id names, the ids inside one the editor's alone, and 800 ms after the last
  keystroke the ops of what changed since the blocks last acknowledged go to the
  outbox, decided by hash; a field patch goes at once, under its base. A change
  from elsewhere is laid in outside the undo and starts it over, since an undo
  replays each edit at the path it was recorded at, a block both sides changed
  merged by `mergeBlocks` (`packages/editor/src/stale-write.ts`), which the
  replica runs on a CONFLICT too. Each item gets its own editor and session,
  drawn once its blocks are in (`packages/editor/src/item/item-editor.tsx`). A
  block no write can store stays as the person left it and counts as a failure
  and as unsaved, so the surface says so on every host and each host holds the
  leave;
  a picker open in a block is read around, since its query is nobody's writing.
  A write the store rejects stays unsaved and goes again after a pause, and a
  first read that fails says so and offers another, each in the person's words.
  A file still being kept counts as unsaved and a leave waits for it, since the
  block that names it is in no value until it is, while what the value holds
  goes at once.
  A block keeps its section wherever it stands, and a new one is the note's, so
  a read of the page never takes what the person typed under it, which reads
  above the article when the item opens again. Rejected: the value mirrored
  into React state (a render per keystroke); a whole-item write (two devices'
  edits to different blocks would meet); one editor handed from item to item
  (a closing write would diff the next one's blocks); a section by where a block
  stands (a read deleted what was typed below the article); rebasing the undo
  through a landing (each recorded batch would be transformed against it).
  `packages/editor/src/item/item-session.ts`, `item-diff.ts`.

- **THE EDITOR'S HOST SPEAKS THE LIBRARY: AN ITEM BY ITS ID, A FILE BY ITS
  SHA.** `openItem`, `readItemBlocks` and `onItemsChanged` take item ids, the
  feed's `titleOf` is live, and `readFile(sha)` answers from the host's file
  source (the tab's staged bytes, then `/v1/blobs`; the Mac's scheme; the
  phone's cache over the bridge). A media block holds `{sha}` (a file its
  `name`) or a web `{url}`, its type the Blob's. A link reaches an item only by
  `[[…]]`, by its id or by `titleKey`, the key the cell resolves a title by; a
  markdown url resolves by path only in an import. Rejected: paths a host maps
  to items (two titles share one); `mime` on the block (a second copy of the
  file's type). `packages/editor/src/host-io.ts`,
  `packages/editor/src/nodes/library-file.ts`.

- **A FILE PASTED OR DROPPED INTO A NOTE IS KEPT BEFORE ITS BLOCK IS WRITTEN.**
  The editor refuses one past the host's `fileMaxBytes` in words before reading
  it, has the host keep the rest by sha (`keepFile`) under the file's type, or
  plain bytes when the browser gives none (`keptFileType`, as the window's own
  saves), and inserts the blocks where the paste or the drop landed, in the
  order they came, the caret after the last: an image, a video or a file card,
  whose Download only a host that `savesFiles` offers. A browser's copy of a web
  picture pastes as its markup. Rejected: the bytes held by the session until
  its pause (a quit in the pause lost them); a card opening a blob of the
  page's origin (it could run script). `packages/editor/src/kits/image-kit.tsx`.

## The open item's merge

- **THE MERGE'S LINE DIFF IS BOUNDED, AND A MERGE THAT KEPT MINE OVER AN
  OVERLAP SAYS SO.** A block both sides changed merges by diff3 over each
  side's markdown, and past its budget the line diff answers one hunk, which
  diff3 reads as one changed region, since an unbounded trace cost gigabytes.
  Rejected: conflicting on every over-budget merge (it warns when nothing was
  lost). The merge answers its overlap, which the replica's change feed carries
  from a CONFLICT's settle and the session's own landing hands its host's
  `notifyOverlap`, said in the item's words. `@repo/notes/text/line-diff`,
  `packages/editor/src/stale-write.ts`.
