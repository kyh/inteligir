# Decisions: @repo/editor

The editor, the dialect it reads and writes, an item's live note, and the grammar, links and a
file's facts it reads.

## Shape

The Plate WYSIWYG: a kit and node per dialect construct, the md-rules table over Plate's stock
markdown, and the item editor (`packages/editor/src/item/item-editor.tsx`) bound to its note's live
document. A host drives it through the `EditorHost` singleton (`packages/editor/src/host-io.ts`),
installed once per host by `installEditorHost`, so no host keeps a store of its own.
`packages/editor/src/node-props.ts` is the Slate decode boundary: a node's dialect fields arrive as
`unknown` and become domain values there alone.

## Editor and dialect

- **The editor is a WYSIWYG over an item's blocks, and every markdown the codec writes goes through
  `serializeNote`** (owner decision). Plate's stock markdown plus one rule table, meaning the tested
  contract and never bytes, since a byte-exact codec of our own would be most of the editor's code.
  `packages/editor/src/markdown/md-matrix.test.ts`.
- **A read refuses with a typed reason, never a throw.** Markdown (`readMarkdown`) or a tree a
  reader already holds (`readMdast`) nested past `LIST_MAX_INDENT` or `READ_MAX_DEPTH`, or a stack
  that runs out, is `too-deep` and a throwing rule `failed`, and every caller refuses either, so no
  platform reads what another refuses. `packages/editor/src/markdown/md-read.ts`.
- **The markdown runs headless, and the codec sits beside the library.** `@repo/editor/codec/*`
  and the headless kits reach no React or `@repo/ui`, so the codec runs wherever the library does,
  and a body read back from what it wrote is that body, ids aside.
  `packages/editor/src/headless-kits.test.ts`.
- **The editor ships its behaviour CSS, and the appearance dials are one declaration.** Every hook
  is spelled once, since a missing sheet fails no other test; the tokens are declared in
  `apps/web/src/library/styles/globals.css`, and the phone's editor sets `--editor-size` 16px or
  more, since iOS zooms smaller text. `packages/editor/src/style-hooks.ts`.
- **Notes speak the inteligir dialect, stock markdown with directives** (owner decision).
  CommonMark and GFM, an item link as Plate's mention `[Title](mention:<id>)`, `:date`/`:formula`
  pills, `$$` math, GitHub alerts, `inteligir-*` fences and `:::` containers; what markdown cannot
  spell is lost on a write, each loss in the changelog. `packages/editor/src/markdown/md-rules.ts`.
- **Every fence name lives in `@repo/editor/markdown/fence-langs`.** A drifted spelling opens the
  block as plain code. `packages/editor/src/markdown/fence-langs.ts`.
- **A directive the dialect does not name is its text, and typed text stays text.** An unknown
  directive is restored to the bytes that wrote it, and a `:` is escaped only before `date` or
  `formula`, so `10:30` stays as typed. `packages/editor/src/markdown/md-text-safety.test.ts`.
- **A directive's name is spelled once, and the rules switch over the names with no default.** The
  plugins restore what the list does not name and the rules read what it does, so a name added to
  one alone fails typecheck, where a default lost the block's fence lines.
  `packages/editor/src/markdown/directive-names.ts`.
- **The dialect has no JSX, and raw HTML is its text.** Its blocks are remark-directive containers
  and a tag is the text it spells, since an MDX tokenizer or a raw html node is a second spelling
  the editor cannot edit. `packages/editor/src/markdown/md-plugins.ts`.
- **The alert is the only callout, and the quote's `alert` prop is the whole of it** (owner
  decision). A quote led by `[!NOTE]` to `[!CAUTION]` reads as that alert and writes its marker on a
  line of its own; any other marker, one a write escaped, an `inteligir-callout` fence or a
  `<callout>` tag stays text, since five alerts need no second grammar and a marker kept in the
  words is read again by every surface. `packages/editor/src/markdown/md-alerts.test.ts`.
- **An item's properties are its fields, and only a file has frontmatter.** Info edits them, and
  the title, tags, folder and pin are Info's, so no key has two editors; a `---` fence in a paste
  or an agent's text is a YAML code block. `packages/editor/src/markdown/md-rules.ts`.
- **The Plate slash menu is the insertion surface, and the touch toolbar is its soft-keyboard
  twin.** Each row writes its own fixpoint and no other row's bytes, a touch button is a row of a
  table the desktop reads, and an empty inline equation writes no bytes (owner decision).
  `packages/editor/src/slash-items.tsx`.
- **A binding is spelled from the table its listener reads, never as a literal.** The editor's
  three tables and the tab's one, its rows scoped by listener, own every chord, and every label and
  key glyph derives from their rows, since a literal drifts from what the key does.
  `packages/editor/src/mark-shortcuts.ts`.
- **An extract is one undo step, and its note is an item of its own.** The host makes the note of
  the very blocks first, then the removal and the link land as their own undo step, since
  create-or-reuse by title loses the blocks. `packages/editor/src/extract-note.ts`.
- **A pill's display is derived where its source lands, and a source reads its own item's pills by
  name.** Every editor of a note settles it inside the change that touches a pill, outside undo
  when the change is someone else's, and a whole body is settled as it is read, since a display
  only an open editor refreshed is stale to every reader of a closed note.
  `packages/editor/src/kits/headless/inline-constructs-base.ts`.
- **A block overlay names its block by node id and subscribes to the document.** A path goes stale
  after an insert above, and Plate turns ids off under NODE_ENV=test, so such a suite mounts with
  ids on. `packages/editor/src/block-draggable.tsx`.
- **A save keeps every line break.** The model holds both breaks as one `"\n"`, so each saves as a
  backslash break and a url before one is written `<url>`; a save may split a line, never join two.
  `packages/editor/src/markdown/md-stringify.test.ts`.
- **Typing in a long note walks it only through a recorded budget, and pays for no store atom per
  block.** A pass over a 10k-line note is a named row timed as a ratio, so a new pass fails by its
  name and a slow runner never does. `packages/editor/src/typing-budget.test.tsx`.
- **The phone runs the desktop's editor through a touch kit, and its rich blocks are read-only in
  the model** (owner decision). Inside a chart, canvas, html, tabs or columns block only a
  whole-block op lands, and a pill's, date's, link's or equation's popover stays shut there, since
  hiding the buttons lets a paste or key in. `packages/editor/src/kits/rich-block-lock-kit.ts`.
- **Chart, canvas and html draw through one shell.** A block gives its parse, its view and its
  structured editor, and the shell holds the mode, the raw editor, the degraded view and the frozen
  check, since a lifecycle copied per block drifts.
  `packages/editor/src/nodes/rich-block-chrome.tsx`.
- **A Mermaid fence is drawn by Pele, synchronously, and its theme is CSS.** Pele reads Mermaid
  into SVG with no dependency in each change's layout effect, where mermaid.js is 2 MB, async and
  bakes its theme into its DOM. `packages/editor/src/nodes/code-block-mermaid.tsx`.
- **A diagram loads nothing, and its markup becomes nodes only through the inert-SVG parse.**
  Nothing remote draws in an item, so only the svg namespace's elements survive, less every
  script, handler and outside reference. `packages/editor/src/lib/inert-svg.ts`.
- **A long note renders in runs of a hundred blocks that skip paint off screen, every block
  mounted.** Slate needs every node's DOM for a selection or find, so runs replace virtualization,
  and where WebKit keeps no scroll anchor the editor keeps one.
  `packages/editor/src/run-anchoring.ts`.
- **An item is edited by its id, over its note's live document, drawn once that has synced.** No
  device seeds a note and a socket down past 3 s turns the editor read-only, since block ops after
  a pause need a merge a live document does not; a leave asks the connection's `holds`, whose one
  table also says what is unsaved. `packages/editor/src/item/note-connection.ts`.
- **A note's socket is the account's live socket at the note's path, and its document syncs by
  y-protocols over it.** y-partyserver's provider brings a second redial machine of its own, so
  only the server is y-partyserver's, and both ends frame with one y-protocols.
  `packages/editor/src/item/note-socket.ts`.
- **The editor's host speaks the library: an item by its id, a file by its sha.** `openItem`,
  `readItemBlocks` and `notes` take ids, and `fileSrc` and `readFile` a sha, since paths a host
  mapped to items let two titles share one. `packages/editor/src/host-io.ts`.
- **A file in a note draws from an address the host hands, and the editor reads no bytes.** An
  `<img>` or a `<video>` loads, caches and seeks it, since every block of a note is mounted and a
  read of the bytes fetches each file whole at open; only the phone reads them, once a file.
  `packages/editor/src/nodes/library-file.ts`.
- **A file pasted or dropped into a note is kept before its block is written.** The host keeps it
  by sha (`keepFile`), and only an editor whose edits still reach the note inserts the block, since
  bytes held until a pause are lost to a quit. `packages/editor/src/kits/image-kit.tsx`.
- **A fold is the device's view state, and holds none of the library's words.** It sits in local
  storage as the heading's block id, dropped on leaving the account, since a fold in the cell
  makes every fold a write. `packages/editor/src/heading-collapse.tsx`.
- **A table cell keeps a code span's and an equation's pipes, and its `<br/>` parts its blocks.**
  gfm splits a row at every bare pipe and the writer joins a cell's blocks with `<br/>`, so both
  read back as written. `packages/editor/src/markdown/md-rules.ts`.
- **With no connection an item reads but takes no edit.** It goes read-only under Plate's
  `readOnly` and says "Needs a connection", every writing handler `editOnly`, since the cloud is the
  truth; typing from before the drop reaches the note once it is back.
  `packages/editor/src/read-only-handlers.test.ts`.
- **A note that takes no edit refuses one in the model.** Offline, held or refused, it drops every
  local op but a selection, and a node hides its controls by `useReadOnly` or `useFrozen`, since
  Plate's `readOnly` gates handlers and drawing, never a transform.
  `packages/editor/src/live/edit-guard.ts`.
- **A key typed before a picker's input has focus is its query.** Slate drops an insert in the
  picker's void, so `PickerRaceKit` lands it in the hidden text and the input types it in.
  `tools/e2e/src/editor.spec.ts`.
- **An open picker is its page's, and leaves the note with its editor.** Plate's trigger names it
  by the editor's `userId`, one per page, so every other device draws it as its trigger, and the
  item editor takes its own out before it lets the note go, since no device can close another's.
  `packages/editor/src/combobox-input.ts`.
- **A note's body is one live document, every editor of it bound innermost, and every kit fixes
  its nodes alike.** NodeId's ids reach the document and undo takes back only this editor's
  changes, since `@platejs/yjs` takes no custom provider without a type assertion.
  `packages/editor/src/live/yjs-binding.ts`.
- **The editor, `@repo/ui` and the live socket reach no oRPC module.** Expo's DOM bundle compiles
  classes to functions and oRPC's builder dies under that at boot while typecheck stays green, so
  lint refuses `@orpc/*` and every `@repo/contract` module that reaches it. `oxlint.config.ts`.

## The grammar, links and a file's facts

- **Every reader parses through one plugin list, and no input throws out of it.** The codec, an
  import, a paste and the editor read through `MD_REMARK_PLUGINS`, and an unused definition or a
  footnote stays the words written, since two grammars drift; a saved page's tree is parsed by
  none, and read by the same rules. `packages/editor/src/markdown/md-corpus.test.ts`.
- **An md url has one reading, and only an import resolves one by path.** Past the import an item is
  reached by id and a file by sha, and only an http(s) url reaches the browser, since no item has a
  path to resolve against. `packages/editor/src/codec/import-plan.ts`.
- **An import takes off a sole top folder only when it holds `assets/`.** An
  Obsidian vault's top folder is one the person named.
  `packages/editor/src/codec/import-plan.ts`.
- **A `[[…]]` names what the resolver answers to.** Obsidian's links are read only where markdown
  comes in from outside, and `.md` is the one extension a link leaves off, so a `.txt` note links
  as `[[todo.txt]]`. `packages/editor/src/knowledge/link-resolve.test.ts`.
- **An agent's view is written a group at a time: a list with what nests under it, any other
  block alone.** A group's place in the text is where it was written and a page writes only its own
  groups, since finding a block's place after one write of the whole means replaying how the writer
  nests and joins. `packages/editor/src/codec/item-view.ts`.
- **An agent's edit writes in the note alone, matches once there, and reads again only the groups
  it touches.** An empty old text adds after the note and one that reaches the article is refused,
  since a refresh replaces the article; the blocks read again keep their ids by content.
  `packages/editor/src/codec/item-edit.ts`.
- **Markdown written into a body is read by `readBody` at every door, and an edit's new text as
  part of one.** A new note, a save's note, an imported bookmark's note and an edit's text read the
  same text as the same blocks, but for a pill's display, which only a whole body can settle; a
  saved page's tree is stored by the same rules, and only a file's import reads frontmatter,
  sections and held files. `packages/editor/src/codec/read-body.ts`.
- **A markdown file's facts are its frontmatter keys, and one reader reads them.** An import's plan
  and its landing both read through `readFrontmatter`, each key one row and the filename the title,
  since a second reader plans a title or an address the landing reads otherwise.
  `packages/editor/src/codec/item-fields.ts`.
- **The `[[` picker is Plate's mention input, over the library's titles.** A pick is a mention by
  the item's id, so no rename breaks it, and its rows are data handed to Base UI's Autocomplete,
  since a trigger and input of our own respell what Plate's mention does.
  `packages/editor/src/kits/mention-kit.tsx`.
