# Decisions: @repo/ui

The shared component vocabulary, its type roles and its motion.

## Components

- **Every component has a surface that draws it** (owner decision). A component or export nothing
  draws is deleted, not held for a coming surface, since git keeps it; knip finds one.
  `knip.json`.
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
- **The chrome has one size, Fluid's compact step, and five type roles on it.** caption 11, body
  12, subtitle 13, title 15, display 24, as `text-<role>` utilities, since a role says what a line
  is, and a size every root sets alike is a branch in each component; the note is not chrome, its
  prose in em off the appearance dials. `packages/ui/src/styles/globals.css`.
- **Dark is the screen's, so every print is light.** The `dark` variant and both dark palettes sit
  inside `@media not print`, since a printer skips backgrounds and dark's light ink would land on
  white paper. `packages/ui/src/styles/globals.css`.
- **The body face never swaps under the reader.** Inter's faces are Fontsource's with
  `font-display: optional` over an Arial fallback sized to Inter's metrics, and the site preloads
  the Latin file, because a swap reflows every line a few seconds into a slow first load.
  `packages/ui/src/styles/inter.css`.
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
- **A list's lit row is an element, and the list reads its box.** A dropdown takes the row Base UI
  marks `data-highlighted`, the sidebar the row under the pointer and the one marked `aria-current`,
  and a row registers nothing, since a row named by its index needs an order registry and a measure
  of every row to find one. `packages/ui/src/hooks/use-layout-reading.ts`.
- **The card grid is virtualized by uniform rows, and its one component is the React Compiler's one
  exception.** Every cell is `cellHeight(cellWidth)` tall, so nothing is measured, and
  `useVirtualizer` is read in render, so the compiler skips that component alone.
  `packages/ui/src/components/card-grid.tsx`.
