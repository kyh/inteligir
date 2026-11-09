# Decisions: @repo/ui

The shared component vocabulary, its type roles and its motion. `AGENTS.md` §
Decisions says how a bullet is written and cited.

## Shape

EVERY COMPONENT HAS A SURFACE THAT DRAWS IT. `packages/ui/src/ai` is the agent
panel's vocabulary; `components/card-grid.tsx`, `media-card.tsx` and
`toggle-group.tsx` are the library's grid, cards and kind chips. A component or
an export nothing draws is deleted, not held for a coming surface (owner
decision): a held one is a file the guards read and the gallery demos for
nobody, and git keeps it (`tools/repo-guards/src/ui-orphan-exports.test.ts`).

## Editor and dialect

- **AN ICON BESIDE A LABEL IS A SIBLING OF THE LABEL, NEVER INSIDE IT.**
  `Button` trims its text with `text-box`, which only a block container honours,
  so an inline svg inside the label's span rides above it. `labelChildren`
  (`packages/ui/src/components/button.tsx`) lifts every element child out beside
  the trimmed text, however the icon was passed; which children are text is
  spelled once, in `@repo/ui/lib/text-children`.

- **EVERY FLOATING SURFACE IS A BASE UI PRIMITIVE THROUGH `@repo/ui`, never a
  hand-positioned div**, which owns no dismissal, flipping, layering or focus
  and drifts on scroll. Base UI is reached only through `@repo/ui` (bar
  `inline-combobox.tsx`); a missing primitive lands there first, with a gallery
  demo. Selection-anchored surfaces take a virtual anchor (`block-menu.tsx`),
  the find bar the item view's slot above the note (`setFindBarAnchor` in
  `packages/editor/src/find-bar.tsx`); the
  page link's preview is a HoverCard, since Popover has no hover
  (`packages/editor/src/mention/mention-chip.tsx`); Quick Look is a `Dialog`
  (`apps/web/src/library/library/quick-look.tsx`). The one exception is the
  selection toolbar (`packages/editor/src/selection-toolbar.tsx`): with no
  open/dismiss lifecycle, a Popover would still need its selection-driven `open`
  and its `frozen` hold. Not a popup: the drop layer, which has no anchor or
  dismissal of its own.

- **THE CHROME HAS FIVE TYPE ROLES, AND THEY ARE FLUID'S LADDER.** caption 11,
  body 12, subtitle 13, title 15, display 24: `typeScale`'s compact column
  (`packages/ui/src/lib/size-context.tsx`), drawn as the `text-<role>` utilities
  in `packages/ui/src/styles/globals.css` that `lib/type-scale.test.ts` holds to
  it. No `text-sm`, `text-xs` or px/rem literal in the chrome, `packages/ui/src/ai`
  included (`tools/repo-guards/src/type-roles.test.ts`): a role says what a line
  is, and a convention drifts. THE NOTE IS NOT CHROME: its prose sizes in em off
  the appearance dials, the title a multiple of `--editor-size`
  (`packages/editor/src/styles.css`), and a fixed size in it is a
  reasoned `PROSE_SIZES` row of that guard.

- **`cn` IS CONFIGURED ONCE, BECAUSE THE MERGE ENGINE HAS TO BE TOLD THE ROLES
  ARE SIZES.** An unknown value after `text-` reads as a colour, so an untold
  `cn("text-body", "text-muted-foreground")` drops the size. `cn` is configured
  in `packages/ui/src/lib/cn.ts` and imported from there: a second, unconfigured
  `cn` drops the size again.

- **A POPUP'S MOTION RIDES ITS POPUP ELEMENT, ON BASE UI'S DOCUMENTED MOTION
  PATH, AND REDUCED MOTION IS ONE POLICY.** A Motion popup's Root is
  controlled, its Portal kept mounted under `AnimatePresence` while open, and
  its Popup rendered as the motion element with an exit of its own, which
  Motion starts in the closing commit, so the fade Base UI waits on is running
  when it looks (`packages/ui/src/lib/popup-presence.tsx`). Reduced motion is
  `MotionPolicy` (`packages/ui/src/lib/motion-policy.tsx`) at each app root,
  and tw-animate's classes collapse to 1ms in
  `packages/ui/src/styles/globals.css`, so no class carries a `motion-reduce:`
  suffix. Rejected: an exit keyed on `transitionStatus` (Motion starts it a
  frame after Base UI looks, so the popup left at once, held only by an
  undocumented resolver flush); `preventUnmountOnClose()` with
  `actionsRef.unmount()` (a close the page makes by its `open` never passes
  through `onOpenChange`); a fallback timer.

- **A PICKER IS BASE UI'S AUTOCOMPLETE OR COMBOBOX, NEVER A HAND-ROLLED
  LISTBOX.** The palette is Autocomplete as Base UI builds a command palette:
  inline in a Dialog, `open`, `autoHighlight="always"`, the rows the page's
  grouped data and nothing filtered or filled from them, so the field keeps
  focus while the arrows move the light, Enter runs the lit row and a picked
  row never becomes the query (`packages/ui/src/components/command.tsx`); the
  editor's in-text menus are Combobox (`packages/editor/src/inline-combobox.tsx`),
  drawn inside the input element Plate's trigger plugin opens, the `[[` picker
  inside Plate's mention input (`packages/editor/src/mention/mention-input.tsx`),
  so Base UI owns the popup's portal, positioning, dismissal, arrows and Enter,
  an Enter that ends an IME composition included. Rejected: the palette's own
  listbox (its active descendant, arrows, Enter and row registry were ours to
  keep right, under five lint suppressions); cmdk (a second picker library
  beside Base UI); Plate's registry combobox (Ariakit, a second popup library).

## Repo guards, vendoring and tooling

- **THE ORPHAN GUARD OVER `@repo/ui` IS PER EXPORT**: every named export under
  the wildcard-exported directories needs a consumer outside the gallery
  (`tools/repo-guards/src/ui-orphan-exports.test.ts` says why neither a file
  guard nor knip can ask this). Base UI's `render` prop is the polymorphism
  channel; there is no Slot.

- **A ROW DOES NOT ANSWER FOR ITS OWN POSITION; ITS CONTAINER DOES.** The list
  keeps the set and reads document order itself through one registry
  (`useRowOrder` in `packages/ui/src/hooks/use-row-order.ts`), synced once per
  commit in the layout phase; the lit row rides a store, so a hover step
  re-renders two rows, not the list. Rejected: a row deriving its index from the
  DOM (a conditional sibling moves it without a re-render, so it needs an effect
  with no dependency array, whose suppression makes the compiler skip the
  component; `react/rule-suppression` refuses a new `exhaustive-deps` or
  `rules-of-hooks` one); a sync per row (a thousand-row mount takes tens of
  seconds); a microtask (a frame late, pills at the old rects).

- **THE CARD GRID IS VIRTUALIZED BY UNIFORM ROWS, AND ITS ONE COMPONENT IS THE
  REACT COMPILER'S ONE EXCEPTION.** Every cell is `cellHeight(cellWidth)` tall,
  so nothing is measured: the columns and the row pitch derive from the width
  alone, and a 10,000-item scope mounts a screenful of rows
  (`packages/ui/src/components/card-grid.tsx`). `useVirtualizer` is a mutable
  instance read in render, so the compiler skips that component alone and still
  compiles the cells it renders; the workspace build's report of what the
  compiler skipped names that file alone. Rejected: masonry (heights measured
  before a row is placed, jumping as covers load); hand-rolled windowing (a
  second virtualizer to keep right); virtua (a second library for one grid).
