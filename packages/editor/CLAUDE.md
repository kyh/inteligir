# Decisions: @repo/editor

The editor, the dialect it round-trips, and the open note's write policy.
`AGENTS.md` § Decisions says how a bullet is written and cited.

## Shape

The Plate WYSIWYG: kits and nodes for every dialect construct, the md-rules
table, the fixpoint serializer and its fixture matrix, and the open-note runtime
(vault-session, note-runtime, open-note-store) a host drives through three
seams: `VaultSessionPorts` (`packages/editor/src/note/vault-session.ts`), the
`GuardedVaultPort` its one write policy runs over
(`packages/editor/src/guarded-vault-io.ts`) and the `EditorHost` singleton
(`packages/editor/src/host-io.ts`, opened to React by `host.ts`): its
`EditorHostIo`, which also carries the link resolver store and note formulas so
no host writes its own, the `EditorHostActions` a deep node asks the shell
through (Ask agent, `showTag`, a comment's create and open, all required),
installed by one `installEditorHost` call per host.
`node-props.ts` is the SLATE DECODE BOUNDARY: a node's dialect fields ride
`TElement`'s open index signature, so every read arrives as `unknown` and
becomes a domain value there alone, which is why no walk narrows structurally.

## Editor and dialect

- **THE EDITOR IS A WYSIWYG OVER A BYTE-DISCIPLINED SERIALIZER, AND EVERY SAVE
  GOES THROUGH `serializeNote`** (epic #579, owner decision). Plate.js over one
  owned parse, one rule table and a bounded fixpoint. Byte stability is a
  contract defended by tests, not a property of the data model: canonical files
  round-trip byte-exact, churn-class constructs may canonicalize on the first
  save (stated per fixture), and a file the pipeline cannot round-trip opens
  raw; the fixtures are formatter-exempt because their bytes are the assertion.
  The live save, an extract and the gate all call `serializeNote`, because the
  rule table expects its pre-pass over the whole value. Rejected: a paragraph
  rule's prune, under which a heading or a list item saved `**a****b**`, and
  Plate's own `serializeMd`, which skips the pre-pass and writes a ZWSP beside
  every chip. `packages/editor/src/markdown/markdown-doc.ts`,
  `packages/editor/README.md` § Invariants.

- **THE EDITOR SHIPS ITS BEHAVIOUR CSS, AND THE APPEARANCE DIALS ARE ONE
  DECLARATION.** The editor's sheet reaches each host through its `globals.css`
  import, and every hook is spelled once, pinned both ways and to each host's
  import, because a missing sheet fails no other test
  (`packages/editor/src/style-hooks.ts`). The tokens are declared once in
  `apps/workspace/src/styles/globals.css` and read with no fallback; the phone
  page writes its own value for each, no dials, `--editor-size` at 16px or more
  because iOS zooms into smaller text
  (`tools/repo-guards/src/appearance-tokens.test.ts` counts the writes). No
  accent axis: nothing in Plate consumes a hue.

- **NOTES SPEAK THE INTELIGIR DIALECT**: `[[Title]]` / `[[Title#H]]` /
  `[[Title|alias]]` / `[[Title|uuid]]` wiki links (the last pipe starts the
  alias), `{{source|display|meta}}` formula pills, `%%i:id:start/end%%` comment
  anchors, `@2026-08-22` date chips, `<u>…</u>` underline, GitHub alerts (`>
  [!NOTE]` through `> [!CAUTION]`) as THE callout, `inteligir-chart` /
  `inteligir-canvas` / `inteligir-html` fences, the `:::tabs`, `:::toggle` and
  `:::columns` containers, and `![](url)` embeds, all valid markdown, all
  round-tripping. Pills, dates, comment anchors and `:::` lines are read from
  finished text, so a backslash before one's first character keeps it text
  (`\@2026-08-22`), and the serializer writes that escape before a text the next
  parse would read as one, so text a person types stays text. Only a web url
  embeds, since `![](path)` is a vault image, and alt text or a title keeps a
  web image an image. Every spelling lives in one place
  (`@repo/notes/markdown/fence-langs`), and
  `tools/repo-guards/src/agent-skills.test.ts` holds the skills and
  `apps/cli/seed/` to it. Plain nested `.md`: no bundles, no meta.json.

- **THE DIALECT HAS NO JSX**: its blocks are one `:::` line grammar that nests
  in any flow container, a `:::` closing the innermost, and every tag is html,
  the editor's own only where it is a bare `<u>`
  (`@repo/notes/markdown/remark-containers`). Rejected: jsx tags for the toggle,
  columns, dates and embeds, which kept an MDX tokenizer and its guards in the
  grammar and a jsx writer in the serializer, and wrote tags other markdown
  tools draw as raw html; and a date as a `[[YYYY-MM-DD]]` link, which costs the
  chip and its calendar.

- **THE ALERT IS THE ONLY CALLOUT** (owner decision): an `inteligir-callout`
  fence is a plain code block and a `<callout>` tag is carried as its source,
  both saved byte-exact. Rejected: reading either as a callout, a second grammar
  with its own node and index pass for kinds the five alerts cannot spell.

- **FRONTMATTER IS THE ONLY PROPERTY STORE**: no metadata table, a note's UUID
  is its `id:`, and YAML the typing rules cannot represent is preserved
  byte-exactly. `@repo/notes/markdown/frontmatter`.

- **THE EDITOR COLUMN SHOWS ONE NOTE.** No second pane and no pane vocabulary:
  one `OpenNoteStore`, and every surface reads the open note. Registries keyed
  on a note's path keep that key so a late answer cannot land on the note that
  replaced it. There is no raw/rich toggle: the surface derives from
  `packages/editor/src/note/markdown-gate.ts` alone.

- **THE PLATE SLASH MENU IS THE INSERTION SURFACE, AND THE TOUCH TOOLBAR IS ITS
  SOFT-KEYBOARD TWIN.** Slash items are grouped data; every row's markdown must
  re-parse to a modeled construct and be its own fixpoint, no row excepted, and
  no two rows may write the same bytes: a second name for a construct is a
  keyword on its row (`/day` finds Date). A soft keyboard has no chord and a
  finger no hover, so the touch kit adds a keyboard toolbar whose every button
  is a row of a table the desktop reads; only what no table holds is a touch row
  of its own, and the toolbar's suite refuses anything else. A locked editor
  offers no rich-block row. An empty inline equation writes no bytes, by owner
  decision: markdown has no empty inline math.
  `packages/editor/src/slash-items.tsx`,
  `packages/editor/src/touch-toolbar.tsx`.

- **TEMPLATES ARE A FOLDER, AND PLACEHOLDERS EXPAND ON THE TEMPLATE'S OWN
  BYTES.** A template is a doc under `templates/` (a fixed convention like the
  daily folder, no setting); `templates/Daily.md` shapes the daily note. Exactly
  three placeholders, `{{date}}`, `{{time}}`, `{{title}}`, replaced in place on
  the raw markdown, so the formula grammar never sees them and every other
  `{{…}}` is a pill left byte-exact. The title is a file name, which can spell
  markdown and yaml, so it is escaped for where it lands, and only as much as
  the next parse needs. Rejected: escaping every punctuation mark, which writes
  `Mike\'s` into the file, and re-serializing the template, which restyles bytes
  the author wrote. That expansion loads both parsers, so the folder names live
  apart from it (`@repo/notes/templates/folders`), where the contract and every
  command-line verb read them. A note minted from a template drops the
  template's `id:`, because two notes with one id make the uuid link tier
  ambiguous. `@repo/notes/templates/placeholders`,
  `packages/editor/src/insert-template.ts`.

- **A BINDING IS SPELLED FROM THE TABLE ITS LISTENER READS, never as a
  literal.** Five tables own every chord and each handler walks its own; the
  marks' table builds Plate's own shortcut config, so Plate's defaults never
  run. Every label is derived from those rows (`@repo/ui/lib/hotkey-spelling`),
  so a rebinding leaves no stale label. A chord two tables share is refused,
  because a key both claim runs both. A row claims shift explicitly, so an
  unshifted row never fires on a shifted chord. The rail's `[` and the panel's
  `]` are BARE rows, answering only with focus outside a field, since a bare key
  is a character wherever text is typed.
  `packages/editor/src/mark-shortcuts.ts`,
  `apps/workspace/src/app/global-shortcuts.ts`.

- **A PIN IS THE FRONTMATTER KEY `pinned: true`, AND ITS EDIT IS A LINE CUT.**
  Pinning travels with the file, so every device and the agent agree; a pinned
  note tops the recents with no Pinned heading, which would cost more height
  than it explains. The edit cuts or appends the key's own lines rather than
  re-serializing the frontmatter, which restyles every flow list; unpinning
  removes the key, never writes `false`. The open note takes the edit through
  the live editor, so the autosave carries it; any other note is a guarded write
  whose mismatch is reported, never merged. The pinned set is the index's, so a
  pin shows after the sweep. `@repo/notes/markdown/frontmatter`,
  `apps/workspace/src/app/note/pin-note.ts`.

- **GO TO HEADING IS THE PALETTE OVER THE TOC'S WALK, AND AN EXTRACT IS ONE
  HISTORY BATCH.** ⌘⇧O opens the palette on the open note's outline and lands
  through the TOC's own jump (`packages/editor/src/toc.tsx`). The outline is
  walked once, by whatever opens the page, and rides the page, never walked in
  render: the workspace sits outside the Plate provider, so a render-time read
  is one nothing refreshes. "Extract to new note" creates the note through the
  exclusive create before touching the buffer, because create-or-reuse would
  count an existing file as success and the blocks would leave for a note that
  never received them; blocks anchoring a comment are refused, since the thread
  would stay behind. The removal and the `[[link]]` land in one flush, so one
  undo restores both; the created file stays, because the vault has no
  transaction and a note that exists is truer than an edit that never happened.
  `packages/editor/src/extract-note.ts`.

- **A FORMULA RECOMPUTE IS NOT AN EDIT, AND A BOUND REF'S NOTE IS FOUND BY ID.**
  A bound ref names its note by frontmatter `id`, which the index's wiki-targets
  rows carry, so a host reads only that note; reading every doc to find one id
  is rejected, since a recompute runs after each typing pause. The display a
  recompute rewrites lands outside the undo history, because the user never
  typed it and one undo must reach their own last edit. The id has one reader,
  in `@repo/notes/markdown/frontmatter`. `packages/editor/src/note-formulas.ts`,
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
  RAW.** Plate's default text rule drops a leading `"\n"`, a soft break after
  any inline node, so the rule table keeps it. A paragraph's soft break saves as
  a hard break, since the model holds both as one `"\n"`; the hard break is `\`,
  except after a bare url, which would read it back as its own, and a bare url
  is an opaque inline, never `html`, which would turn the break into a space.
  The gate backs it: a save may split a line but never join two.
  `packages/editor/src/markdown/md-rules.ts`, `markdown-doc.ts`.

- **COMMENT MARKERS PAIR ACROSS THE DOCUMENT, AND THE TINT IS ONE ROOT
  DECORATION.** A block comment is a marker line above a fence and another below
  it, so markers pair in document order over the whole note. Rejected: pairing
  per block, which draws a two-paragraph comment as two orphans, and refusing a
  selection that crosses blocks. The ranges are returned for the root alone,
  because a per-text decoration leaves an untouched middle block with a stale
  tint. `packages/editor/src/comments/comment-ranges.ts`.

- **TYPING IN A LONG NOTE WALKS IT ONLY THROUGH A RECORDED BUDGET, AND THE
  BUDGET FINDS ITS PASSES.** In a 10k-line note a keystroke, a caret move and
  the settle after typing may each walk the whole note only through passes a row
  names with its reason, and their times are held as ratios (to how a keystroke
  grows with the note, to the parse of the same note) so a slow runner cannot
  fail them. A pass is found, never declared: a block near the note's end
  records the stack of every read of it, so a new pass fails named by its
  function, where instrumenting the known passes would miss the one nobody
  instrumented. A pass a keystroke cannot afford caches by top-level block,
  since an edit keeps every untouched block by identity.
  `packages/editor/src/__tests__/typing-budget.test.tsx`, held by the Linux CI
  job: on the 7 GB macOS runner the note swaps, so that job sets
  `SKIP_TYPING_BUDGET` (`packages/editor/vitest.config.ts`).

- **THE PHONE RUNS THE DESKTOP'S EDITOR THROUGH A TOUCH KIT, AND ITS RICH BLOCKS
  ARE READ-ONLY IN THE MODEL** (owner decision). The touch kit is COMPOSED, the
  content kit plus the lock and the touch chrome, rather than the desktop kit
  minus its pointer chrome, so a pointer surface added to the desktop stays off
  the phone until someone names it there
  (`packages/editor/src/kits/touch-editor-kit.ts`). A chart, a canvas, an html
  block, tabs and columns are read-only there: every op inside one is refused,
  while a whole-block insert, remove or move passes, so a re-seed lands and one
  undo restores a deleted block
  (`packages/editor/src/kits/rich-block-lock-kit.ts`). Hiding the edit buttons
  alone was rejected, since a paste, a key or a transform from elsewhere would
  still reach the block. A keystroke aimed inside a locked block is refused at
  `beforeinput` too: slate-react defers a plain character to an input event the
  browser never fires there, so the model guard alone let it land wherever the
  user typed next. A host with no html frame draws no Run.

## Vault: writes, git and containment

- **A SAVE THAT FAILS IS SAID ONCE AND RETRIED; ONE WHOSE FILE IS GONE IS ASKED
  ABOUT.** A refused write keeps the buffer dirty, said once per failure and
  retried on a backoff, since nothing else re-arms the autosave. A guarded write
  that finds no file, its merge's retry included, answers `vanished` and is
  never retried; refusing to leave it would hold the user there for good, so
  leaving asks: discard, or re-create the note from the buffer.
  `packages/editor/src/note/note-runtime.ts`,
  `packages/editor/src/guarded-vault-io.ts`.

- **THE MERGE'S LINE DIFF IS BOUNDED, AND A MERGE THAT KEPT THE BUFFER OVER AN
  OVERLAP SAYS SO.** The line diff runs inside a save's CAS retry, where an
  unbounded trace cost gigabytes for two long, far-apart notes; past its budget
  it answers one hunk, which diff3 reads as one changed region. Conflicting on
  every over-budget merge is rejected: it would warn when nothing was lost. A
  conflicted merge's toast opens that note's History (owner decision).
  `@repo/notes/text/line-diff`, `packages/editor/src/vault-editor.ts`.

- **A RENAME HOLDS THE OPEN NOTE THROUGH THE MOVE, NEVER LETS GO OF IT.** The
  session suspends the note's controller across the move: edits still land in
  the buffer while saves and reloads wait, and it resumes at the new path, or
  the old one when the move failed. Disposing it and opening the new path was
  rejected: a keystroke typed during the move reached no controller. At a new
  path the resume reads before it writes, because the guarded io holds no base
  for a path it never read and the move writes the old name into the note as an
  alias. `packages/editor/src/vault-editor.ts`,
  `packages/editor/src/note/vault-session.ts`.
