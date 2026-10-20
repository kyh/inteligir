# Decisions: @repo/ui

The shared component vocabulary, its type roles and its motion. `AGENTS.md` §
Decisions says how a bullet is written and cited.

## Shape

EVERY COMPONENT HAS A SURFACE THAT DRAWS IT. `packages/ui/src/ai` is the action
timeline's vocabulary and the library's selection strip; `components/card-grid.tsx`,
`media-card.tsx` and `toggle-group.tsx` are the library's grid, cards and kind
chips. A component nothing draws is deleted, not held for a coming surface
(owner decision): a held one is a file the guards read and the gallery demos for
nobody, and git keeps it. A single export beside a drawn component is a reasoned
`ALLOWED_EXPORTS` row (`tools/repo-guards/src/ui-orphan-exports.test.ts`).

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
  demo. Selection-anchored surfaces take a virtual anchor
  (`annotations/annotation-kit.tsx`, `block-menu.tsx`), the find bar the top
  bar's Find (`setFindBarAnchor` in `packages/editor/src/find-bar.tsx`); the
  wiki-link preview is a HoverCard, since Popover has no hover
  (`packages/editor/src/wiki/wiki-chip.tsx`); the ⌘K composer and Quick Look are
  `Dialog`s, the composer non-modal, its `finalFocus` the editor
  (`apps/workspace/src/app/actions/action-composer.tsx`,
  `apps/workspace/src/app/library/quick-look.tsx`). The one exception is the
  selection toolbar (`packages/editor/src/selection-toolbar.tsx`): with no
  open/dismiss lifecycle, a Popover would still need its selection-driven `open`
  and its `frozen` hold. Not popups: the drop layer and the selection strip
  (over the grid's foot, so selecting moves no card), which have no anchor or
  dismissal of their own.

- **THE CHROME HAS FIVE TYPE ROLES, AND THEY ARE FLUID'S LADDER.** caption 11,
  body 12, subtitle 13, title 15, display 24: `typeScale`'s compact column
  (`packages/ui/src/lib/size-context.tsx`), drawn as the `text-<role>` utilities
  in `packages/ui/src/styles/globals.css` that `lib/type-scale.test.ts` holds to
  it. No `text-sm`, `text-xs` or px/rem literal in the chrome, `packages/ui/src/ai`
  included (`tools/repo-guards/src/type-roles.test.ts`): a role says what a line
  is, and a convention drifts. THE NOTE IS NOT CHROME: its prose sizes in em off
  the appearance dials, the title a multiple of `--editor-size`
  (`packages/editor/src/editor-column.tsx`), and a fixed size in it is a
  reasoned `PROSE_SIZES` row of that guard.

- **`cn` IS CONFIGURED ONCE, BECAUSE THE MERGE ENGINE HAS TO BE TOLD THE ROLES
  ARE SIZES.** An unknown value after `text-` reads as a colour, so an untold
  `cn("text-body", "text-muted-foreground")` drops the size. `cn` is configured
  in `packages/ui/src/lib/cn.ts` and imported from there: a second, unconfigured
  `cn` drops the size again.

- **A POPUP'S MOTION RIDES ITS POPUP ELEMENT, AND REDUCED MOTION IS ONE
  POLICY.** Base UI unmounts a closing popup once the Popup element's own
  animations finish, so a framer popup renders its Popup as the motion element,
  each exit wrapped in `PopupExit` (`packages/ui/src/lib/popup-exit.tsx`).
  Reduced motion is `MotionPolicy` (`packages/ui/src/lib/motion-policy.tsx`) at
  each app root, and tw-animate's classes collapse to 1ms in
  `packages/ui/src/styles/globals.css`, so no class carries a `motion-reduce:`
  suffix. Rejected: an `actionsRef` hold or a fallback timer.

## Repo guards, vendoring and tooling

- **THE ORPHAN GUARD OVER `@repo/ui` IS PER EXPORT**: every named export under
  the wildcard-exported directories needs a consumer outside the gallery or a
  reasoned allowance row (`tools/repo-guards/src/ui-orphan-exports.test.ts` says
  why neither a file guard nor knip can ask this). Base UI's `render` prop is
  the polymorphism channel; there is no Slot.

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
  compiles the cells it renders; the workspace build's diagnostic names that
  file alone. Rejected: masonry (heights measured before a row is placed, jumping
  as covers load); hand-rolled windowing (a second virtualizer to keep right);
  virtua (a second library for one grid).
