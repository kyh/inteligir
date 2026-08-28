# @repo/editor

The note editor: Plate (platejs) over the vault's markdown, plus everything that
keeps a round-trip byte-stable.

## Why it exists

The editor is the largest single thing in the product and the one with the
strictest invariant — **opening a file and saving it back must not change its
bytes**. Splitting it out makes that invariant a package boundary: the byte
contract, its fixture matrix and the kit-parity guards live together, and the
workspace above it consumes an editor rather than containing one.

The product's privacy posture lives in `docs/privacy.md`.

Deps: `@repo/notes` (the parse pipeline and the knowledge types), `@repo/ui`
(the components). No node, no electron. The host contract is this package's own
`host.tsx` / `host-io.ts`; the app implements it.

## Layout

```
src/
  markdown-editor.tsx, editor-pane.tsx, editor-chrome.tsx
                       # the editor surface, its chrome, and the pane the app
                       # mounts once per split
  markdown/
    md-rules.ts        # the Slate↔mdast rules — one per node type
    markdown-doc.ts    # the round trip itself: parse → doc → serialize, run to
                       # a BOUNDED FIXPOINT so a second save is a no-op
  kits/
    editor-kit.ts      # the React composition Plate actually runs
    base-kit.ts        # the headless mirror, for the serializer
    markdown-kit.ts    # the markdown plugin wiring
  nodes/               # every node type as a Base (headless) + React pair
  note/
    open-note-store.ts, open-note-context.tsx
                       # the per-pane open-note slice (zustand) and React's door
                       # to one pane's store
    vault-session.ts   # the open note's ORDERING, drivable without React
    note-runtime.ts    # controller + autosave debounce + vanish watcher
    open-doc.ts, markdown-gate.ts, open-note-flush.ts
                       # the open-document union, the raw/rich gate, the flush
                       # that visits every registered pane
  comments/            # anchored-comment markers, ranges, gutter, store
  formulas/            # `{{…}}` pill entry, editing and recompute
  properties/          # the typed frontmatter panel
  lib/                 # debounce, the dark-class hook, the wire helper
  host.tsx, host-io.ts # the injected EditorHost (vault actions + listing) and
                       # its non-React twin for modules Plate renders outside
                       # a provider
  node-props.ts        # the Slate decode boundary: a node's dialect fields ride
                       # TElement's open index signature, so every read arrives
                       # unknown and becomes a domain value here, once
  slash-menu.tsx, selection-toolbar.tsx, block-menu.tsx, block-*.tsx,
  toc.tsx, transclusion*.ts(x), heading-collapse.tsx, find-bar.tsx,
  embed-url-dialog.tsx, emoji-input.tsx, inline-combobox.tsx,
  cursor-overlay.tsx, insert-void.ts
                       # the in-document affordances — every surface a node can
                       # be inserted from, and the transforms behind them
  wiki-*.ts(x)         # the `[[` picker, chips, insertion, key handling
  __tests__/fixtures/  # THE BYTE-PINNED ROUND-TRIP MATRIX (see below)
```

## Invariants

- **`roundTrip(raw) === raw` for every canonical file.** The fixture matrix
  under `src/__tests__/fixtures/roundtrip/` is the contract: `canonical/` must
  survive untouched, `churn/` pins the one normalization each input gets
  (`*.in.md` → `*.out.md`), and `raw/` pins the inputs that cannot be parsed at
  all and so open in Raw mode, with the REASON in the filename.
- **Never hand-edit or format a fixture.** Their bytes are the assertion —
  trailing spaces, indentation, line endings. oxfmt ignores the directory;
  editors must too. Generate them through the `roundTrip` pipeline itself.
- **Every node type is a Base + React pair.** `base-kit.ts` composes the Base
  halves for the headless serializer; `kit-parity.test.ts` fails when the two
  compositions disagree, so a node that renders but does not serialize is
  impossible.
- **Rich is the default surface.** Anything that PARSES opens Rich and
  normalizes on the first real edit. Constructs with no editor node — unknown
  JSX, `{…}` expressions, raw HTML — are opaque nodes
  (`@repo/notes/markdown/remark-opaque`): shown as inert literal text and
  written back byte-for-byte. Only a real parse failure (a mismatched tag, an
  unbalanced brace) opens Raw, byte-exact, with the badge.
- **View state is per pane, keyed by note path.** Two panes are two notes, so
  the open-note store is an instance (`note/open-note-context.tsx`) and every
  module holding view state — heading folds included — keys by the pane's own
  path rather than a shared scope.

## Seams

- `host.tsx` — the injected `EditorHost`: vault actions, the listing, and the
  wiki resolver. The editor never reaches the server for those; the app
  supplies them (`apps/desktop/src/renderer/app/note/vault-provider.tsx`).
- `host-io.ts` — the same boundary as a MODULE SINGLETON, because kit factories
  and paste handlers run outside React: vault reads, asset bytes in and out,
  the knowledge queries, and the change events that invalidate them.
- `note/open-note-context.tsx` — ONE pane's open-note store. Every consumer
  below a pane reads its own note through `useOpenNote(sel)`.

## Testing

```bash
pnpm --filter @repo/editor test
```

Two vitest projects: `editor` (node, `*.test.ts`) for the pipeline, the
fixtures, the property/adversarial harnesses and the open-note store;
`editor-dom` (jsdom, `*.test.tsx`) for the components. Component tests drive
the DOM with `fireEvent` — `@testing-library/user-event` is deliberately not a
dependency.
