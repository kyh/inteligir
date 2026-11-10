# @repo/editor

The item editor: Plate (platejs) bound to a note's live document, the
dialect's markdown on Plate's stock reader and writer, and the codec an import
and the agent read and write through. Its decisions are this
package's [`CLAUDE.md`](CLAUDE.md).

## Why it exists

The editor is the largest single thing in the product, and its markdown has one
invariant — **reading a file in keeps every letter, and writing it back keeps
what it means**. Splitting it out makes that invariant a package boundary: the
rule table, the suites that hold its meaning and the kit-parity guards live
together, and the library's page above it (`apps/web/src/library`) consumes an editor rather
than containing one. The cell runs the same codec headless
(`packages/service/src/library/library-router.ts`), and the phone's editor page hosts the
editor whole (`apps/mobile-editor`).

Deps: `@repo/contract` (the library model), `@repo/ui` (the components). No node, and nothing of the desktop shell's. The host contract is this package's own
`host-io.ts` (`EditorHost`: its `EditorHostIo`, whose `notes` port dials a
note's live document, and its `EditorHostActions`); a host implements it and
comes in through one call, `installEditorHost`, and everything above it (the
note's socket and its heartbeat, the binding, the library's titles a link and
the `[[` picker read) is this package's, so a second host copies none of it. The package
also ships ONE stylesheet, `styles.css` (toggle collapse, the callout marker
swap, the hljs theme, the prose scope the appearance dials feed, typeset's
table rules and the diagram frame's `--pele-*` variables), inert until the
host `@import`s `@repo/editor/styles.css` — `style-hooks.ts` spells the
selectors it reads, and `style-hooks.test.ts` pins the two together.

## Layout

```
src/
  markdown/            # the dialect over Plate's stock markdown: the remark
                       # plugin list (`md-plugins.ts`), the rule table
                       # (`md-rules.ts`), the read that refuses with a reason
                       # (`md-read.ts`), Obsidian's `[[…]]` for what comes in
                       # from outside (`remark-wiki-import.ts`), `fence-langs.ts`,
                       # the header fence and typed properties in
                       # `frontmatter.ts`, and `serializeNote`, the one way the
                       # codec writes markdown
  codec/               # an item as markdown, headless: import and export of
                       # one file, a folder's or zip's import plan, and the
                       # agent's view of an item and its edits
  kits/                # the plugin kits: CONTENT_KIT and the desktop and touch
                       # compositions over it, the headless mirror the
                       # serializer runs, the markdown wiring, the rich-block lock
  nodes/               # every node type as a Base (headless) + React pair
  item/                # an item edited by its id: its editor, the connection
                       # to its note's live document, and its properties
  live/                # a note's live document: the binding every editor of
                       # it sits innermost under and its undo, the blocks it
                       # seeds and reads as the library stores them, a writer's
                       # block edits through the editor, and whose a picker is
  formulas/            # formula pills: collection, the expression and its
                       # evaluation, the resolve graph, result formatting, and
                       # the `{{` picker, entry, editing, recompute
  knowledge/           # a link's target in an import (`link-resolve.ts`: the
                       # path and alias tiers), what a file says outside its
                       # blocks, literal matches
  items/               # a markdown file's facts from its frontmatter, the one
                       # time spelling
  text/                # ONE Myers diff over a sequence, bounded by an edit
                       # budget
  mention/             # page links: the `[[` picker over Plate's mention
                       # input, its order, the insert and Create, the chip
  properties/          # the panel of an item's typed properties
  lib/                 # debounce, the one door a diagram's markup becomes
                       # nodes through, embed and url helpers
  test-support/        # the fake editor host, for any suite that mounts the
                       # editor (the hosts' included), and what this package's
                       # suites share: the DOM cleanup, a mounted editor,
                       # notes' objects held in memory behind a fake socket,
                       # live documents relayed in memory, the codec's ports,
                       # a value's meaning and generated notes
  test-support/fixtures/  # the corpus and frontmatter files the suites read
  *.test.ts(x)         # each suite beside the module it names, in whichever
                       # folder that module sits; one that holds several
                       # modules (the typing budget, kit parity) sits here at
                       # the top
  *.ts(x)              # the editor surface and its column, the host seam
                       # (§ Seams), the id of the item the editor shows
                       # (`open-item.tsx`), and the in-document
                       # affordances: menus, toolbars, TOC
```

## Invariants

- **A read keeps every letter, and a write keeps what the value means.**
  `markdown/md-matrix.test.ts` writes and reads every node the model holds and
  reads markdown rows the writer never makes; `md-corpus.test.ts` reads each
  file under `src/test-support/fixtures/corpus/` and `frontmatter/`, keeps its
  letters (a few named files below all of them, with why) and writes a
  fixpoint; `md-text-safety.test.ts` holds what a person types to itself.
  `frontmatter/` holds whole files, which only the codec reads: a body has none.
- **Never format a fixture.** A corpus file is the input as some tool wrote
  it — trailing spaces, indentation, line endings. oxfmt ignores the directory;
  editors must too.
- **Every node type is a Base + React pair.** `base-kit.ts` composes the Base
  halves for the headless serializer; `kit-parity.test.ts` fails when the two
  compositions disagree, so a node that renders but does not serialize is
  impossible, and `touch-kit.test.ts` holds the touch kit to the same.
- **Every file reads, or is refused with a reason.** `readMarkdown`
  (`markdown/md-read.ts`) answers the blocks, or `too-deep` for a nesting
  deeper than the conversion or the writer holds, a list past
  `LIST_MAX_INDENT` among it, or `failed` for a rule that threw; every caller
  treats a refusal as one (an import leaves the file out, an agent's edit is
  turned down, a paste lands as plain text), so nothing is written over it and
  every item writes. Raw html, a definition nothing used, a footnote and a
  directive the dialect does not name are the text they spell.
- **Typing walks a long note only through its budget.**
  `typing-budget.test.tsx` types into a generated 10k-line note opened in the
  item editor over its live document (`generateLongNote`,
  `test-support/memory-note.tsx`) and fails
  on a whole-note pass no row names, on a keystroke, a caret move or the settle
  after typing. A pass a keystroke cannot afford caches by top-level block (the
  outline), which an edit replaces while keeping every other
  by identity.
- **View state keys by the open item.** The item editor provides the id of the
  item it shows (`open-item.tsx`), and every module holding view state —
  heading folds included — keys by
  that id: a module outlives the document it describes, so a late answer must
  not land on the item that replaced it.

## Seams

- `host-io.ts` — the injected host, `EditorHost`, as a MODULE SINGLETON
  because kit factories, paste handlers and a deep node's click run outside
  React or with no route to the shell. Its `EditorHostIo` speaks the library
  by its own keys: `openItem`, `readItemBlocks` (a link's hover preview) and `onItemsChanged` by item id, `readFile` by sha (a picture,
  a recording or a file card in a note, drawn from an object URL of the page's
  own), `keepFile` (a file pasted or dropped into the text, kept by its sha
  ahead of the write that names it), the cap `fileMaxBytes` and whether a file
  card may save a file (`savesFiles`). Beside it sit the library's titles, an
  item's id and the title it goes by, which a host hands `setLibraryTitles`
  each time its listing of them answers: the `[[` picker's rows and the name a
  page link shows, subscribed to rather than read, because they move with the
  library while the host never does. Its `EditorHostActions`
  are what the editor asks the shell for (Ask agent and a `#tag` chip's
  `showTag`, and the note an extract or
  a link's Create makes, `items.createNote`), every one required, so a host
  that leaves one out fails to typecheck rather than drawing a button that does
  nothing. Each host installs it once, through `installEditorHost`, ahead of
  the first render (`apps/web/src/library/item/page-editor-host.ts`, over the
  account's cell in a tab and the Mac app's window, and the phone's over its
  WebView bridge, `apps/mobile-editor/src/item/item-host.ts`), and `host.ts` is
  React's door to the titles (`useLibraryTitles`, `useTitleOf`).
- `item/note-connection.ts` — a note's live document, opened by its item's id
  over the host's `notes` port: y-partyserver's provider dials the note's
  object at the cloud origin the host names, on a fresh ticket, the document
  shows once it has synced, a ping every 20 s finds a socket gone quiet, and
  the status says whether the note is there, whether an edit reaches it now
  and whether the note holds its edits. `item/item-editor.tsx` is its
  surface: a connection per item id and an editor per document, drawn once it
  has synced (or a line saying the library holds no such item), read-only
  while the host is offline, the socket down or the note held, and the open
  note it hands its host (`onNote`) answers a leave (`whenSaved`), which
  `item/note-holds.ts` asks before a host lets the note go. A note that cannot
  open while the host is offline draws what the host holds of it through
  `item/held-item.tsx`, read-only under a line saying why.
  `item/item-properties.ts` is the panel's rows over an item's
  fields as its host holds them (`ItemFields`). A link to an item by id shows
  the name the item goes by now, `useTitleOf` over the library's titles. The
  suites open notes over `test-support/memory-note.tsx` and
  `test-support/note-server.ts`, notes' objects held in memory behind a fake
  socket.
- `open-item.tsx` — the id of the item the editor shows, which the item editor
  provides and `useOpenItemId` reads under it.
- `editor-profile.tsx` — `EditorProfileProvider`, set once by a host around
  the column. The desktop sets none; a touch host sets `touch` and gets the
  touch kit, no outline rail and a narrower inset.
- `live-editor.ts` — the registry the shell reaches a mounted editor through
  by the id of the item it holds (a find's jump, an extract's check that its item is still the one open);
  `liveEditorItemId` answers the id an editor holds, and `getLiveEditor`
  whether it still answers for it.

## Testing

```bash
pnpm --filter @repo/editor test
```

Two vitest projects: `editor` (node, `*.test.ts`, under a 512MB heap) for
the grammar, the codec, the matrix, the corpus and the `[[` picker's trigger;
`editor-dom` (jsdom, `*.test.tsx`) for the components. `editor-dom` runs the
sources through the React Compiler as the shipped page does, so a
memoized read that goes stale fails here (`compiled-under-test.test.tsx`
fails if the plugin goes). Component tests drive the DOM with `fireEvent` —
`@testing-library/user-event` is deliberately not a dependency.
