# @repo/editor

The note editor: Plate (platejs) over the vault's markdown, plus everything that
keeps a round-trip byte-stable.

## Why it exists

The editor is the largest single thing in the product and the one with the
strictest invariant — **opening a file and saving it back must not change its
bytes**. Splitting it out makes that invariant a package boundary: the byte
contract, its fixture matrix and the kit-parity guards live together, and the
workspace above it consumes an editor rather than containing one.

Deps: `@repo/notes` (the parse pipeline and the knowledge types), `@repo/ui`
(the components). No node, and nothing of the desktop shell's. The host contract is this package's own
`host-io.ts` (`EditorHost`: its `EditorHostIo` and its `EditorHostActions`),
`note/vault-session.ts` (`VaultSessionPorts`) and
`guarded-vault-io.ts` (`GuardedVaultPort`); a host implements all three and
comes in through one call, `installEditorHost`, and everything above its
store (the write policy, the link resolver, note formulas) is this package's,
so a second host copies none of it. The package
also ships ONE stylesheet, `styles.css` (toggle collapse, the callout marker
swap, the hljs theme, the prose scope the appearance dials feed, typeset's
table rules and the diagram frame's `--pele-*` variables), inert until the
host `@import`s `@repo/editor/styles.css` — `style-hooks.ts` spells the
selectors it reads, and `__tests__/style-hooks.test.ts` pins the two together.

## Layout

```
src/
  markdown/            # the round trip: the Slate↔mdast rules, the one
                       # markdown→Slate conversion, the bounded fixpoint and
                       # `serializeNote`, the one way any save reaches bytes
  kits/                # the plugin kits: CONTENT_KIT and the desktop and touch
                       # compositions over it, the headless mirror the
                       # serializer runs, the markdown wiring, the rich-block lock
  nodes/               # every node type as a Base (headless) + React pair
  note/                # the open note: its store and React's door to it, the
                       # session's ordering, the autosave runtime, the raw/rich
                       # gate and the flush writers outside the note reach
  annotations/         # annotation markers, ranges, gutter, store
  formulas/            # `{{…}}` pills: the `{{` picker, entry, editing, recompute
  wiki/                # `[[…]]` links: the `[[` picker, the chip, insertion, keys
  properties/          # the typed frontmatter panel
  lib/                 # debounce, the one door a diagram's markup becomes
                       # nodes through, embed and url helpers
  test-support/        # the fake editor host, for any suite that mounts the
                       # editor (the desktop's included)
  __tests__/fixtures/  # THE BYTE-PINNED ROUND-TRIP MATRIX (see below)
  *.ts(x)              # the editor surface and its column, the host seam
                       # (§ Seams), the write policy, and the in-document
                       # affordances: menus, toolbars, TOC, embeds
```

## Invariants

- **`roundTrip(raw) === raw` for every canonical file.** The fixture matrix
  under `src/__tests__/fixtures/roundtrip/` is the contract: `canonical/` must
  survive untouched and `churn/` pins the one normalization each input gets
  (`*.in.md` → `*.out.md`). There is no `raw/`: every input parses.
- **Never hand-edit or format a fixture.** Their bytes are the assertion —
  trailing spaces, indentation, line endings. oxfmt ignores the directory;
  editors must too. Generate them through the `roundTrip` pipeline itself.
- **Every node type is a Base + React pair.** `base-kit.ts` composes the Base
  halves for the headless serializer; `kit-parity.test.ts` fails when the two
  compositions disagree, so a node that renders but does not serialize is
  impossible, and `touch-kit.test.ts` holds the touch kit to the same.
- **Rich is the default surface.** The parse is total: no jsx and no
  expressions, and every tag is html, folded with its closer
  (`@repo/notes/markdown/remark-inline-html`), so every file opens Rich and
  normalizes on the first real edit. Constructs with no editor node — a tag
  that cannot pair, any pair but a bare `<u>`, raw HTML — are opaque inline
  nodes (`@repo/notes/markdown/remark-opaque`): shown as inert literal text and
  written back byte-for-byte, and `{` is prose. Only one of the editor's own
  limits — nesting deeper than the conversion holds, a conversion that leaves
  text outside any block, a round trip that never settles, or one that would
  lose a letter or join two lines (a rule or serializer bug) — opens Raw,
  byte-exact, and the gate's reason says which (`GateReason` in
  `markdown/markdown-doc.ts`).
- **Typing walks a long note only through its budget.**
  `__tests__/typing-budget.test.tsx` types into a generated 10k-line note
  (`generateLongNote`) and fails on a whole-note pass no row names, on a
  keystroke, a caret move or the settle after typing. A pass a keystroke cannot
  afford caches by top-level block (the outline, the count, the gutter's ids),
  which an edit replaces while keeping every other by identity.
- **View state keys by note path.** The workspace holds ONE open-note store
  (an instance, `note/open-note-context.tsx`), and every module holding view
  state — heading folds included — keys by the note's own path: a module
  outlives the document it describes, so a late answer must not land on the
  note that replaced it.

## Seams

- `host-io.ts` — the injected host, `EditorHost`, as a MODULE SINGLETON
  because kit factories, paste handlers and a deep node's click run outside
  React or with no route to the shell. Its `EditorHostIo` carries the vault
  actions (`vault`), the link resolver store (the knowledge index's own `buildResolver` over
  the listing, for wiki targets and md urls alike, and the wiki targets it was
  built over, which the `[[` picker lists — subscribed to rather than read,
  because it moves with every refresh while the
  actions never do), vault reads, asset bytes in and out, the knowledge queries,
  and the change events that invalidate them, plus what only some hosts have:
  a frame to run an html block in (`htmlFrameUrl`, null hides Run) and a
  native photo picker that writes what it picks (`pickImage`, null hides the
  touch toolbar's image button; a picked path lands through `insertVaultImage`,
  as a paste does). Its `EditorHostActions` are what the editor asks the shell
  for (Ask agent and a `#tag` chip's `showTag`, an annotation's create, edit
  and open),
  every one required, so a host that leaves one out fails to typecheck rather
  than drawing a button that does nothing. The install hands `flushOpenNote`
  the host's own flush, so a writer outside the note's tree reaches the open
  note on every host. The editor never reaches the
  server for any of it; each host installs it once, through
  `installEditorHost`, ahead of the first render
  (`apps/workspace/src/app/note/vault-provider.tsx`, and the phone's
  over its WebView bridge, `apps/mobile-editor/src/host/page-host.ts`),
  feeding the resolver store through `link-resolver-feed.ts` and
  `readNoteFormulas` with `note-formulas.ts` over its own reads, and `host.ts` is
  React's door (`useVaultActions`, `useLinkResolver`, `useWikiTargets`, and
  `useVaultLinkTarget`, which reads an md url through `mdLinkTarget` and
  resolves it from the note it is written in — the open note, or the one an
  embed shows — so an image or a link lands where the index says it does).
- `note/vault-session.ts` — `VaultSessionPorts`, what the open note's ordering
  is driven through: boot (whose note the host reads through `note`, since
  that read is the base the first save is guarded by), list, rename, the
  `VaultIO` it reads and writes notes with (`vault-editor.ts`:
  read/write/create/remove), the
  publish/notify callbacks, and the one question it asks the user
  (`askVanished`). Drivable without React.
- `guarded-vault-io.ts` — `GuardedVaultPort`, the host's store under that
  `VaultIO`: a read, a write under an `absent` or `expected` guard answering
  written, exists, changed (with the bytes now there) or missing, and a remove.
  `createGuardedVaultIo` is the one write policy over it, so no host decides
  what a stale save does: the base each note was read as, a `changed` answer
  diff3-merged and retried once against those bytes, `missing` as vanished. A
  host turns the base into whatever its store compares (the desktop hashes it
  for the server's CAS).
- `note/open-note-context.tsx` — the open-note store. Every consumer under
  the editor reads the open note through `useOpenNote(sel)`.
- `editor-profile.tsx` — `EditorProfileProvider`, set once by a host around
  the column. The desktop sets none; a touch host sets `touch` and gets the
  touch kit, no outline rail and a narrower inset.
- `live-editor.ts` — the path-keyed registry the shell reaches a mounted
  editor through (the pin, annotations, Info's properties). A render
  SUBSCRIBES — `useLiveEditor`, or `subscribeLiveEditors` for a snapshot of
  the document — and never reads: the editor registers after the render that
  asked for it, and the compiler memoizes a render-time read on its inputs,
  so it never re-runs. `MarkdownEditor` announces every edit on the same
  channel, because Slate's one `onChange` slot is Plate's.

## Testing

```bash
pnpm --filter @repo/editor test
```

Two vitest projects: `editor` (node, `*.test.ts`) for the pipeline, the
fixtures, the property/adversarial harnesses and the open-note store;
`editor-dom` (jsdom, `*.test.tsx`) for the components. `editor-dom` runs the
sources through the React Compiler as the shipped page does, so a
memoized read that goes stale fails here (`compiled-under-test.test.tsx`
fails if the plugin goes). Component tests drive the DOM with `fireEvent` —
`@testing-library/user-event` is deliberately not a dependency.
