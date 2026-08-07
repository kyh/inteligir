# @repo/editor

The note editor: Plate (platejs) over the vault's markdown, plus everything that
keeps a round-trip byte-stable.

## Why it exists

The editor is the largest single thing in the product and the one with the
strictest invariant — **opening a file and saving it back must not change its
bytes**. Splitting it out makes that invariant a package boundary: the byte
contract, its fixture matrix and the kit-parity guards live together, and the
workspace above it consumes an editor rather than containing one.

Deps: `@repo/bridge` (the host contract), `@repo/notes` (the parse pipeline and
the knowledge types), `@repo/ui` (the components). No node, no electron.

## Layout

```
src/
  markdown-editor.tsx, editor-pane.tsx, editor-chrome.tsx
                       # the editor surface, its chrome, and the pane the
                       # workspace mounts
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
    open-note-store.ts # the high-cadence open-note slice (zustand)
    note-runtime.ts    # controller + autosave debounce + vanish watcher
    open-doc.ts, open-note-flush.ts  # opening, flushing, the privacy read
  note-privacy.ts      # the OTHER privacy read — off the live Plate document,
                       # gating ⌘J and ghost text (see docs/privacy.md)
  ai/                  # the ⌘J menu, intent, suggestions, ghost text,
                       # and the transient state that must never reach disk
  properties/          # the typed frontmatter panel
  stores/              # AI settings, AI provider snapshot, delegation badges
  delegation/          # the inline delegation badge on a checkbox
  lib/                 # debounce, the dark-class hook
  host.tsx             # the injected EditorHost: vault actions + listing
  slash-menu.tsx, selection-toolbar.tsx, block-menu.tsx, block-*.tsx,
  toc.tsx, transclusion*.ts(x), todo-*.ts(x), embed-url-dialog.tsx,
  emoji-input.tsx, inline-combobox.tsx, cursor-overlay.tsx, insert-void.ts
                       # the in-document affordances — every surface a node can
                       # be inserted from, and the transforms behind them
  wiki-*.ts(x)         # the `[[` picker, chips, insertion, key handling
  __tests__/fixtures/  # THE BYTE-PINNED ROUND-TRIP MATRIX (see below)
```

## Invariants

- **`roundTrip(raw) === raw` for every canonical file.** The fixture matrix
  under `src/__tests__/fixtures/roundtrip/` is the contract: `canonical/` must
  survive untouched, `churn/` pins the one normalization each input gets
  (`*.in.md` → `*.out.md`), and `raw/` pins the inputs that must fall out of the
  vocabulary into Raw mode, with the REASON in the filename.
- **Never hand-edit or format a fixture.** Their bytes are the assertion —
  trailing spaces, indentation, line endings. oxfmt ignores the directory;
  editors must too. Generate them through the `roundTrip` pipeline itself.
- **Every node type is a Base + React pair.** `base-kit.ts` composes the Base
  halves for the headless serializer; `kit-parity.test.ts` fails when the two
  compositions disagree, so a node that renders but does not serialize is
  impossible.
- **Rich is the default surface.** Anything that parses inside the MDX
  vocabulary (`@repo/notes/markdown/vocabulary`) opens Rich and normalizes on
  the first real edit. Only unrepresentable content — unknown JSX, expressions,
  HTML comments, parse errors — opens Raw, byte-exact, with the badge.
- **AI state is transient.** Generation marks and accept/reject suggestions are
  editor-only; `ai/transient*.ts` settles them before any flush, so no AI
  artifact can reach a file.
- **The privacy read is the live buffer**, not the last save, so a
  `private: true` typed a second ago already counts. Two reads over one kernel
  (`@repo/notes/markdown/frontmatter`'s `privacyOfParsed`):
  `note/open-note-flush.ts::openNoteIsPrivate` for the chat context hint and
  read-aloud, `note-privacy.ts::isEditorNotePrivate` off the live Plate document
  for ⌘J and ghost text. Harden both or the guarantee is half true. Fail-closed
  in each: unreadable, untypeable or unregistered reads as private.

## Seams

- `host.tsx` — the injected `EditorHost`: vault actions, the listing, and the
  wiki resolver. The editor never calls the Bridge for those; the workspace
  supplies them (`workspace/vault-context.tsx`).
- `stores/*` — read through the Bridge directly, because they are host state
  the editor owns the UI for (AI provider snapshot, delegation badges).

## Testing

```bash
pnpm --filter @repo/editor test
```

Two vitest projects: `editor` (node, `*.test.ts`) for the pipeline, the
fixtures, the property/adversarial harnesses and the stores; `editor-dom`
(jsdom, `*.test.tsx`) for the components. Component tests drive the DOM with
`fireEvent` — `@testing-library/user-event` is deliberately not a dependency
(root `CLAUDE.md` § Decisions).
