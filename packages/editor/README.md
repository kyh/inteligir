# @repo/editor

The item editor: Plate (platejs) over an item's blocks, the markdown codec an
import, an export and the agent read and write through, and everything that
keeps a round-trip byte-stable.

## Why it exists

The editor is the largest single thing in the product and the one with the
strictest invariant — **reading a file in and writing it back out must not
change its bytes**. Splitting it out makes that invariant a package boundary: the byte
contract, its fixture matrix and the kit-parity guards live together, and the
workspace above it consumes an editor rather than containing one.

Deps: `@repo/notes` (the parse pipeline and the knowledge types), `@repo/ui`
(the components). No node, and nothing of the desktop shell's. The host contract is this package's own
`host-io.ts` (`EditorHost`: its `EditorHostIo` and its `EditorHostActions`)
and an item session's ports (`item/item-session.ts`); a host implements both
and comes in through one call, `installEditorHost`, and everything above its
store (the block diff, the merge, the link resolver) is this package's, so a
second host copies none of it. The package
also ships ONE stylesheet, `styles.css` (toggle collapse, the callout marker
swap, the hljs theme, the prose scope the appearance dials feed, typeset's
table rules and the diagram frame's `--pele-*` variables), inert until the
host `@import`s `@repo/editor/styles.css` — `style-hooks.ts` spells the
selectors it reads, and `style-hooks.test.ts` pins the two together.

## Layout

```
src/
  markdown/            # the round trip: the Slate↔mdast rules, the one
                       # markdown→Slate conversion, the bounded fixpoint and
                       # `serializeNote`, the one way the codec writes markdown
  codec/               # an item as markdown, headless: import and export of
                       # one file, a folder's or zip's import plan and the
                       # export's, and the agent's view of an item and its edits
  kits/                # the plugin kits: CONTENT_KIT and the desktop and touch
                       # compositions over it, the headless mirror the
                       # serializer runs, the markdown wiring, the rich-block lock
  nodes/               # every node type as a Base (headless) + React pair
  item/                # an item edited by its id: its editor, its session's
                       # ops over the host's store, the block diff and its
                       # properties
  note/                # the line a merge that kept this device's lines says
  annotations/         # annotation markers, ranges, gutter, store
  formulas/            # `{{…}}` pills: the `{{` picker, entry, editing, recompute
  wiki/                # `[[…]]` links: the `[[` picker, the chip, insertion, keys
  properties/          # the typed frontmatter panel
  lib/                 # debounce, the one door a diagram's markup becomes
                       # nodes through, embed and url helpers
  test-support/        # the fake editor host, for any suite that mounts the
                       # editor (the hosts' included), and what this package's
                       # suites share: the DOM cleanup, a mounted editor, an
                       # item held in memory, the codec's ports, the quote
                       # corpus, sample and generated notes
  test-support/fixtures/  # THE BYTE-PINNED ROUND-TRIP MATRIX (see below)
  *.test.ts(x)         # each suite beside the module it names, in whichever
                       # folder that module sits; one that holds several
                       # modules (the round trip, the typing budget, kit
                       # parity) sits here at the top
  *.ts(x)              # the editor surface and its column, the host seam
                       # (§ Seams), the id of the item the editor shows
                       # (`open-item.tsx`), the write policy, and the
                       # in-document affordances: menus, toolbars, TOC, embeds
```

## Invariants

- **`roundTrip(raw) === raw` for every canonical file.** The fixture matrix
  under `src/test-support/fixtures/roundtrip/` is the contract: `canonical/` must
  survive untouched and `churn/` pins the one normalization each input gets
  (`*.in.md` → `*.out.md`). There is no `raw/`: every input parses.
- **Never hand-edit or format a fixture.** Their bytes are the assertion —
  trailing spaces, indentation, line endings. oxfmt ignores the directory;
  editors must too. Generate them through the `roundTrip` pipeline itself.
- **Every node type is a Base + React pair.** `base-kit.ts` composes the Base
  halves for the headless serializer; `kit-parity.test.ts` fails when the two
  compositions disagree, so a node that renders but does not serialize is
  impossible, and `touch-kit.test.ts` holds the touch kit to the same.
- **Every file reads rich.** The parse is total: no jsx and no expressions,
  and every tag is html, folded with its closer
  (`@repo/notes/markdown/remark-inline-html`), so every file the codec reads
  becomes blocks, settled through the serializer as it comes in. Constructs
  with no editor node — a tag that cannot pair, any pair but a bare `<u>`, raw
  HTML — are opaque inline nodes (`@repo/notes/markdown/remark-opaque`): shown
  as inert literal text and written back byte-for-byte, and `{` is prose. Only
  a nesting deeper than the conversion holds is refused (an import leaves the
  file out, an agent's edit is turned down), so nothing is written over it; a
  round trip that never settles or would lose a letter is a rule or serializer
  bug, which the fixtures and `analyzeMarkdown` (`RoundTripFailure` in
  `markdown/markdown-doc.ts`) name.
- **Typing walks a long note only through its budget.**
  `typing-budget.test.tsx` types into a generated 10k-line note opened in the
  item editor (`generateLongNote`, `test-support/memory-item.tsx`) and fails
  on a whole-note pass no row names, on a keystroke, a caret move or the settle
  after typing. A pass a keystroke cannot afford caches by top-level block (the
  outline, the gutter's ids), which an edit replaces while keeping every other
  by identity.
- **View state keys by the open item.** The item editor provides the id of the
  item it shows (`open-item.tsx`), and every module holding view state —
  heading folds and a highlight's tint and pending note included — keys by
  that id: a module outlives the document it describes, so a late answer must
  not land on the item that replaced it.

## Seams

- `host-io.ts` — the injected host, `EditorHost`, as a MODULE SINGLETON
  because kit factories, paste handlers and a deep node's click run outside
  React or with no route to the shell. Its `EditorHostIo` speaks the library
  by its own keys: `openItem`, `readItemBlocks` (an embed's body and a link's
  hover preview) and `onItemsChanged` by item id, `readFile` by sha (a picture,
  a recording or a file card in a note, drawn from an object URL of the page's
  own), `keepFile` (a file pasted or dropped into the text, kept by its sha
  ahead of the write that names it), the cap `fileMaxBytes` and whether a file
  card may save a file (`savesFiles`); and the link resolver store (the
  knowledge index's own `buildResolver` over the items the host feeds, the
  `[[` picker's rows and `titleOf`, subscribed to rather than read, because it
  moves with the library while the actions never do). Its `EditorHostActions`
  are what the editor asks the shell for (Ask agent and a `#tag` chip's
  `showTag`, an annotation's create, edit and open, and the note an extract or
  a link's Create makes, `items.createNote`), every one required, so a host
  that leaves one out fails to typecheck rather than drawing a button that does
  nothing. Each host installs it once, through `installEditorHost`, ahead of
  the first render (`apps/workspace/src/app/item/page-editor-host.ts`, over the
  tab's or the Mac's replica and files, and the phone's over its WebView
  bridge, `apps/mobile-editor/src/item/item-host.ts`), feeding the resolver
  store through `link-resolver-feed.ts`, and `host.ts` is React's door
  (`useLinkResolver`, `useLinkTargets`).
- `stale-write.ts` — `mergeBlocks`, the replica's block merge: a block two
  writers changed, diff3-merged over each side's markdown
  (`codec/block-markdown.ts`), with whether it kept this device's lines over
  the other's change to the same ones; `replicaMerge` is it as the engine's
  port takes it.
- `item/item-session.ts` — an item open in the editor by its id, over the
  replica (`ItemStore`): the value is the item's blocks, a pause writes the
  ops `item/item-diff.ts` reads off it, and a change from elsewhere is laid
  in with the editor's transforms; a merge that kept this device's lines over
  another's goes to the host's `notifyOverlap`. `item/item-editor.tsx` is its
  surface: an editor and a session of its own per item id, drawn once the
  item's blocks are in (or a line saying the device lacks it), which a host
  reads the status of and flushes, and `item/item-properties.ts` the panel's
  rows over its fields. A link to an item by id shows the name the item goes by
  now, the resolver's `titleOf`, read off the items the host feeds.
- `open-item.tsx` — the id of the item the editor shows, which the item editor
  provides and `useOpenItemId` reads under it.
- `editor-profile.tsx` — `EditorProfileProvider`, set once by a host around
  the column. The desktop sets none; a touch host sets `touch` and gets the
  touch kit, no outline rail and a narrower inset.
- `live-editor.ts` — the registry the shell reaches a mounted editor through
  by the id of the item it holds (a find's jump, a highlight's quote in the
  panel, an extract's check that its item is still the one open);
  `liveEditorItemId` answers the id an editor holds, and `getLiveEditor`
  whether it still answers for it.

## Testing

```bash
pnpm --filter @repo/editor test
```

Two vitest projects: `editor` (node, `*.test.ts`) for the pipeline, the
fixtures, the property/adversarial harnesses and the link resolver feed;
`editor-dom` (jsdom, `*.test.tsx`) for the components. `editor-dom` runs the
sources through the React Compiler as the shipped page does, so a
memoized read that goes stale fails here (`compiled-under-test.test.tsx`
fails if the plugin goes). Component tests drive the DOM with `fireEvent` —
`@testing-library/user-event` is deliberately not a dependency.
