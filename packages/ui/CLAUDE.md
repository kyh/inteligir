# Decisions: @repo/ui

The shared component vocabulary, its type roles and its motion. `AGENTS.md` §
Decisions says how a bullet is written and cited.

## Shape

A LIBRARY AHEAD OF ITS CONSUMERS: `packages/ui/src/ai` holds components no
surface draws on yet, kept by owner decision and listed one by one in
`AWAITING_CONSUMER` (`tools/repo-guards/src/ui-package.ts`), which the
per-export orphan guard reads, so one more unconsumed export still fails.

## Editor and dialect

- **AN ICON BESIDE A LABEL IS A SIBLING OF THE LABEL, NEVER INSIDE IT.**
  `Button` trims its text with `text-box`, which only a block container honours,
  so an inline svg inside the label's span is pushed above it. `labelChildren`
  (`packages/ui/src/components/button.tsx`) lifts every element child out beside
  the trimmed text, however the icon was passed; "which children are text" is
  spelled once, in `@repo/ui/lib/text-children`.

- **EVERY FLOATING SURFACE IS A BASE UI PRIMITIVE THROUGH `@repo/ui`, never a
  hand-positioned div**, which owns no dismissal, flipping, layering or focus
  and drifts on scroll. A selection-anchored surface hands the Positioner a
  virtual anchor (`annotations/annotation-kit.tsx`, `block-menu.tsx`). Base UI is
  reached only through `@repo/ui` (the one exception is `inline-combobox.tsx`),
  and a missing primitive is added there first, with a gallery demo. The find
  bar hangs under the top bar's Find through `setFindBarAnchor`
  (`packages/editor/src/find-bar.tsx`), since the editor never reaches the
  shell; the wiki-link preview is the HoverCard, because Popover has no hover
  mode (`packages/editor/src/wiki/wiki-chip.tsx`); the ⌘K composer is a non-modal
  `Dialog` whose `finalFocus` returns through the editor
  (`apps/workspace/src/app/actions/action-composer.tsx` says why). The selection
  toolbar (`packages/editor/src/selection-toolbar.tsx`) is the one exception:
  with no open/dismiss lifecycle, a Popover would still need its
  selection-driven `open` and its `frozen` hold.

- **THE CHROME HAS FIVE TYPE ROLES, AND THEY ARE FLUID'S LADDER.** caption 11,
  body 12, subtitle 13, title 15, display 24 — the compact column of `typeScale`
  (`packages/ui/src/lib/size-context.tsx`), drawn as the `text-caption | body |
  subtitle | title | display` utilities in `packages/ui/src/styles/globals.css`,
  whose numbers `lib/__tests__/type-scale.test.ts` derives from the map. No
  `text-sm`, `text-xs` or px/rem literal in the chrome, because a role says what
  a line IS and a scale held by convention drifts:
  `tools/repo-guards/src/type-roles.test.ts` holds it, `packages/ui/src/ai`
  included less `AWAITING_CONSUMER` (owner decision). THE MERGE ENGINE HAS TO BE
  TOLD THEY ARE SIZES: an unknown value after `text-` reads as a colour, so
  `cn("text-body", "text-muted-foreground")` drops the size. `cn` is configured
  once (`packages/ui/src/lib/cn.ts`) and imported from there: a second,
  unconfigured `cn` drops the size again. THE NOTE IS NOT CHROME: its prose
  keeps the appearance dials and sizes in em, the title a multiple of
  `--editor-size` (`packages/editor/src/editor-column.tsx`), and a fixed size
  that is part of the note is a reasoned `PROSE_SIZES` row in that guard.

- **A POPUP'S MOTION RIDES ITS POPUP ELEMENT, AND REDUCED MOTION IS ONE
  POLICY.** Base UI unmounts a closing popup once the Popup element's own
  animations finish, so a framer popup renders its Popup as the motion element,
  with no `actionsRef` hold or fallback timer, each exit wrapped in `PopupExit`
  (`packages/ui/src/lib/popup-exit.tsx`). Reduced motion is `MotionPolicy`
  (`packages/ui/src/lib/motion-policy.tsx`) at each app root, and tw-animate's
  classes collapse to 1ms in `packages/ui/src/styles/globals.css`, so no class
  carries a `motion-reduce:` suffix.

## Repo guards, vendoring and tooling

- **THE ORPHAN GUARD OVER `@repo/ui` IS PER EXPORT**: every named export under
  the wildcard-exported directories needs a consumer outside the gallery or a
  reasoned allowance row (`tools/repo-guards/src/ui-orphan-exports.test.ts` says
  why neither a file guard nor knip can ask this). Base UI's `render` prop is
  the polymorphism channel; there is no Slot.

- **A ROW DOES NOT ANSWER FOR ITS OWN POSITION; ITS CONTAINER DOES.** A
  conditional row changes where its siblings sit without re-rendering them, so a
  row deriving its index from the DOM needs an effect with no dependency array,
  and that rule suppression makes the compiler skip the whole component. The
  list keeps the set and reads document order itself, through one registry
  (`useRowOrder` in `packages/ui/src/hooks/use-row-order.ts`), syncing once per
  commit in the layout phase: a sync per row mounts a thousand-row tree in tens
  of seconds, and a microtask can render a frame late with the pills at the old
  rects. The lit row rides a store, so a hover step re-renders two rows, not the
  list (`packages/ui/src/components/__tests__/row-registry.test.tsx`).
  `react/rule-suppression` refuses a new `exhaustive-deps` or `rules-of-hooks`
  suppression, the ones the compiler bails on.
