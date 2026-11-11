# Decisions: @repo/ui

The shared component vocabulary, its type roles and its motion.

## Components

- **Every component has a surface that draws it** (owner decision). A component or export nothing
  draws is deleted, not held for a coming surface, since git keeps it; knip finds one, and the
  gallery counts as no consumer. `knip.json`.
- **`@repo/ui` reaches no oRPC module, as the editor does not.** The phone's DOM bundle loads both,
  so lint refuses `@orpc/*` and the oRPC-reaching `@repo/contract` modules here too.
  `oxlint.config.ts`.
- **An icon beside a label is a sibling of the label, never inside it.** `Button` trims its text
  with `text-box`, which only a block container honours, so `labelChildren` lifts every element
  child out beside the trimmed text. `packages/ui/src/components/button.tsx`.
- **Every floating surface is a Base UI primitive through `@repo/ui`, never a hand-positioned div.**
  A div owns no dismissal, flipping, layering or focus and drifts on scroll; the selection toolbar
  is the one exception, and Base UI's `render` prop is the polymorphism channel, with no Slot.
  `packages/ui/src/components/popover.tsx`.
- **The chrome has five type roles, and they are Fluid's ladder.** caption 11, body 12, subtitle 13,
  title 15, display 24, as `text-<role>` utilities, since a role says what a line is and a
  convention drifts; the note is not chrome, its prose in em off the appearance dials.
  `packages/ui/src/lib/size-context.tsx`.
- **`cn` is configured once, because the merge engine has to be told the roles are sizes.** An
  untold `cn("text-body", "text-muted-foreground")` drops the size, and so does a second,
  unconfigured `cn`. `packages/ui/src/lib/cn.ts`.
- **A popup's motion rides its popup element, on Base UI's documented motion path, and reduced
  motion is one policy.** Motion starts the exit in the closing commit, so the fade Base UI waits on
  is running when it looks; `MotionPolicy` replaces every `motion-reduce:` class.
  `packages/ui/src/lib/popup-presence.tsx`.
- **A picker is Base UI's Autocomplete or Combobox, never a hand-rolled listbox.** Base UI owns the
  popup, its arrows and an IME-safe Enter, which a listbox of our own kept right under five lint
  suppressions. `packages/ui/src/components/command.tsx`.
- **A row does not answer for its own position; its container does.** The list reads document order
  once a commit through `useRowOrder`, since a row reading its index from the DOM needs an effect
  that makes the compiler skip it. `packages/ui/src/hooks/use-row-order.ts`.
- **The card grid is virtualized by uniform rows, and its one component is the React Compiler's one
  exception.** Every cell is `cellHeight(cellWidth)` tall, so nothing is measured, and
  `useVirtualizer` is read in render, so the compiler skips that component alone.
  `packages/ui/src/components/card-grid.tsx`.
