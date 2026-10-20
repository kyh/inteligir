# Decisions: @repo/editor

The editor, the dialect it round-trips, and the open note's write policy.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

The Plate WYSIWYG: kits and nodes for every dialect construct, the md-rules
table, the fixpoint serializer and its fixtures, and the open-note runtime a
host drives through three seams: `VaultSessionPorts`
(`packages/editor/src/note/vault-session.ts`), the `GuardedVaultPort` the one
write policy runs over (`packages/editor/src/guarded-vault-io.ts`), and the
`EditorHost` singleton (`packages/editor/src/host-io.ts`, opened to React by
`host.ts`), installed by one `installEditorHost` call per host. Its
`EditorHostIo` carries the link resolver store and note formulas, so no host
writes its own; its `EditorHostActions` (Ask agent, `showTag`, a highlight's
create, note and open, all required) are how a deep node asks the shell; its
`VaultActions.closeFile` is the way back to the library. `static-note.tsx`
draws a note read-only, for an embed and for Quick Look. `node-props.ts` is the
SLATE DECODE BOUNDARY: a node's dialect fields ride `TElement`'s open index
signature, so each read arrives as `unknown` and becomes a domain value there
alone, and no walk narrows structurally.

## Editor and dialect

- **THE EDITOR IS A WYSIWYG OVER A BYTE-DISCIPLINED SERIALIZER, AND EVERY SAVE
  GOES THROUGH `serializeNote`** (epic #579, owner decision). Plate.js over one
  owned parse, one rule table and a bounded fixpoint. Byte stability is a tested
  contract: a canonical file round-trips byte-exact, a churn-class construct may
  canonicalize on its first save (said per fixture), a file that cannot
  round-trip opens raw, and the fixtures are formatter-exempt. The live save, an
  extract and the gate all call `serializeNote`, since the rule table expects
  its whole-value pre-pass. Rejected: a paragraph rule's prune (a heading or
  list item saved `**a****b**`) and Plate's `serializeMd` (no pre-pass, a ZWSP
  beside every chip). `packages/editor/src/markdown/markdown-doc.ts`,
  `packages/editor/README.md` § Invariants.

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
  `[[Title|alias]]` / `[[Title|uuid]]` wiki links (the last pipe starts the
  alias), `{{source|display|meta}}` formula pills, `%%i:id:start/end%%`
  annotation markers, `@2026-08-22` date chips, `<u>…</u>` underline, GitHub
  alerts (`> [!NOTE]` … `> [!CAUTION]`) as THE callout, `inteligir-chart` /
  `inteligir-canvas` / `inteligir-html` fences, the `:::tabs`, `:::toggle` and
  `:::columns` containers, and `![](url)` embeds, all valid, round-tripping
  markdown. Only a web url embeds (`![](path)` is a vault image; alt text or a
  title keeps a web image an image). Every spelling lives in
  `@repo/notes/markdown/fence-langs`, which
  `tools/repo-guards/src/agent-skills.test.ts` holds the skills and
  `apps/cli/seed/` to. Plain nested `.md`: no bundles, no meta.json.

- **A DIALECT CONSTRUCT IS READ FROM FINISHED TEXT, SO A BACKSLASH KEEPS ONE
  TEXT.** Pills, dates, annotation markers and `:::` lines are read from
  finished text, so a backslash before one's first character keeps it text
  (`\@2026-08-22`), and the serializer writes that escape before typed text the
  next parse would read as one, so what a person types stays text.
  `packages/notes/src/markdown/text-escapes.ts`,
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

- **FRONTMATTER IS THE ONLY PROPERTY STORE**: no metadata table, a note's UUID
  is its `id:`, and YAML the typing rules cannot represent is preserved
  byte-exactly. `@repo/notes/markdown/frontmatter`. The properties panel hides
  an item's own keys (`ITEM_KEYS`) and `id`, which Info shows and writes
  (`packages/editor/src/properties/properties-panel.tsx`), so no key has two
  editors.

- **THE EDITOR COLUMN SHOWS ONE ITEM, AND NOTHING OPEN IS THE LIBRARY.** One
  `OpenNoteStore`, and every surface reads the open item. With nothing open the
  column draws nothing, since the page draws the library there, and a file that
  is no doc opens with no buffer, its viewer the page's
  (`packages/editor/src/editor-column.tsx`). Registries keyed on a note's path
  keep that key, so a late answer cannot land on the note that replaced it.
  Rejected: a second pane and any pane vocabulary, and a raw/rich toggle (the
  surface derives from `packages/editor/src/note/markdown-gate.ts` alone).

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

- **A PIN IS THE FRONTMATTER KEY `pinned: true`, AND ITS EDIT IS A LINE CUT.**
  It travels with the file, so every device and the agent agree, and a pinned
  item leads the grid in every scope and sort; unpinning removes the key, never
  writes `false`. The open note takes the edit through the live editor, so the
  autosave carries it; any other note gets a guarded write whose mismatch is
  reported, never merged, as every item field does (`editItemFields`,
  `apps/workspace/src/app/note/item-frontmatter.ts`). The pinned set is the
  index's, so a pin shows after the sweep. Rejected: a Pinned heading (more
  height than it explains) and re-serializing the frontmatter (it restyles every
  flow list). `@repo/notes/markdown/frontmatter`,
  `apps/workspace/src/app/note/pin-note.ts`.

- **GO TO HEADING IS THE PALETTE OVER THE TOC'S WALK, AND AN EXTRACT IS ONE
  HISTORY BATCH.** ⌘⇧O opens the palette on the outline and lands through the
  TOC's jump (`packages/editor/src/toc.tsx`); the outline is walked once, by
  whatever opens the palette page, never in render: the workspace sits outside
  the Plate provider, so nothing would refresh a render-time read. An extract
  creates its note exclusively before touching the buffer, refuses blocks
  anchoring an annotation (its entry would stay behind), and lands the removal
  and the `[[link]]` in one flush, so one undo restores both; the created file
  stays, since the vault has no transaction, stamped `saved` like every note the
  session seeds (`packages/editor/src/note/vault-session.ts`). Rejected:
  create-or-reuse (an existing file counts as success and the blocks are lost).
  `packages/editor/src/extract-note.ts`.

- **A FORMULA RECOMPUTE IS NOT AN EDIT, AND A BOUND REF'S NOTE IS FOUND BY ID.**
  A bound ref names its note by frontmatter `id`, which the index's wiki-targets
  rows carry, so a host reads only that note. Rejected: reading every doc to
  find one id (a recompute runs after each typing pause). The display a
  recompute rewrites lands outside the undo history, since the user never typed
  it and one undo must reach their own last edit. The id has one reader, in
  `@repo/notes/markdown/frontmatter`. `packages/editor/src/note-formulas.ts`,
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
  (`packages/editor/src/transclusion-guard.ts`). PlateStatic's default element
  draws a void empty or throws, so the static table holds a row for every void
  (`packages/editor/src/transclusion.tsx`).

- **A SAVE KEEPS EVERY LINE BREAK, AND ONE THAT WOULD JOIN TWO LINES OPENS
  RAW.** The rule table keeps the leading `"\n"` (a soft break after an inline
  node) that Plate's default text rule drops. A soft break saves as a hard
  break, since the model holds both as one `"\n"`; the hard break is `\`, except
  after a bare url, which would read it as its own. A bare url is an opaque
  inline, never `html`, which would turn the break into a space. The gate backs
  it: a save may split a line, never join two.
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
  `packages/editor/src/markdown-editor.tsx`). They read no block, so they leave
  the budget no stack, and
  `packages/editor/src/per-block-subscriptions.test.tsx` holds them off by name.

- **THE PHONE RUNS THE DESKTOP'S EDITOR THROUGH A TOUCH KIT, AND ITS RICH BLOCKS
  ARE READ-ONLY IN THE MODEL** (owner decision). The touch kit is the content
  kit, the lock and touch chrome, so a desktop pointer surface stays off the
  phone until named (`packages/editor/src/kits/touch-editor-kit.ts`). Inside a
  rich block (chart, canvas, html, tabs, columns) every op but a whole-block
  insert, remove or move is refused, so a re-seed lands and undo restores a
  deletion (`packages/editor/src/kits/rich-block-lock-kit.ts`), and
  `beforeinput` refuses keystrokes inside, which slate-react defers to an input
  event never fired. Rejected: the desktop kit minus its pointer chrome, and
  hiding only the edit buttons (a paste or key still gets in). A host with no
  html frame draws no Run.

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
  set (NOTHING REMOTE LOADS IN A NOTE, in `apps/cli/CLAUDE.md`).
  `packages/editor/src/lib/inert-svg.ts` parses Pele's markup as XML and keeps
  only the svg namespace's elements, less every script, handler and reference
  that leaves the drawing.

- **A LONG NOTE RENDERS IN RUNS OF A HUNDRED BLOCKS THAT SKIP THEIR LAYOUT AND
  PAINT OFF SCREEN, AND EVERY BLOCK STAYS MOUNTED.** Slate's chunking splits the
  top level into runs (`CHUNK_BLOCKS` in
  `packages/editor/src/markdown-editor.tsx`), so a keystroke re-renders one.
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

## Vault: writes, git and containment

- **A SAVE THAT FAILS IS SAID ONCE AND RETRIED; ONE WHOSE FILE IS GONE IS ASKED
  ABOUT.** A refused write keeps the buffer dirty, said once per failure and
  retried on a backoff, since nothing else re-arms the autosave. A guarded write
  that finds no file, its merge's retry included, answers `vanished` and is
  never retried, and leaving asks: discard, or re-create the note from the
  buffer. Rejected: refusing to leave (it holds the user there for good).
  `packages/editor/src/note/note-runtime.ts`,
  `packages/editor/src/guarded-vault-io.ts`.

- **THE MERGE'S LINE DIFF IS BOUNDED, AND A MERGE THAT KEPT THE BUFFER OVER AN
  OVERLAP SAYS SO.** The diff runs inside a save's CAS retry, where an unbounded
  trace cost gigabytes; past its budget it answers one hunk, which diff3 reads
  as one changed region. Rejected: conflicting on every over-budget merge (it
  warns when nothing was lost). A conflicted merge's toast opens the note's
  History (owner decision). `rebase` and the 409 retry ask `mergeItemTexts`
  before diff3, so a fill or a Refresh under the person's typing lands both with
  no overlap said, as the sync and the phone's queue would
  (`@repo/notes/sync/url-item-verdict`). `@repo/notes/text/line-diff`,
  `packages/editor/src/vault-editor.ts`,
  `packages/editor/src/guarded-vault-io.ts`.

- **A RENAME HOLDS THE OPEN NOTE THROUGH THE MOVE, NEVER LETS GO OF IT.** The
  session suspends the note's controller across the move (edits land in the
  buffer, saves and reloads wait) and resumes it at the new path, or the old one
  when the move failed. At a new path it reads before it writes, since the
  guarded io holds no base there and the move writes the old name in as an
  alias. Rejected: disposing it and opening the new path (a keystroke mid-move
  reached no controller). `packages/editor/src/vault-editor.ts`.

- **A MOVE THE PAGE DID NOT MAKE IS FOLLOWED BY THE ITEM'S ID.** A fill's rename
  of a stub or an agent's `vault rename` is followed through the session's
  `findMoved` port, so the item stays open at its new path and Back never names
  the old one. While the index has a read out, or names a path the disk no
  longer holds (it has not yet been told of the move), the answer is `unknown`,
  not gone and not the old path: the item
  waits with no buffer, asked again on a bounded schedule (about 14 s) and at
  each vault change, which never delays it; only an id nothing answers, or the
  schedule's end, drops to the library, and a navigation ends the follow.
  Rejected: dropping to the library on every vanish or null read (it bounced
  people off just-renamed items). `packages/editor/src/note/vault-session.ts`.
