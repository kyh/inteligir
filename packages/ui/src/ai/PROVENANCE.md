# Vendored: Beautiful UI (the AI surface)

- **Upstream**: https://www.beautifului.dev
- **Commit**: `88e24f28bdc5b5563916e122d89e744be25d88c7`
- **License**: MIT — `LICENSE.beautiful-ui` in this directory is upstream's own
  text. The attribution notice below is not a substitute for it: MIT requires
  the license itself to travel with the copy, and it names a copyright holder
  no notice line carries.
- **Vendored**: 2026-08-22

**Upstream publishes no repository and no registry.** It is a single-page
copy-paste showcase, so there is no commit to name. The pin above is the
**sha1 of the six adopted sources**, concatenated in the filename order of the
`## Files` table, exactly as extracted — a reproducible identity for the bytes
this directory came from. They were read out of the page's RSC flight payload
on 2026-08-22, from deployment `dpl_GPGKnycJDDkoM7oAYwuPhxeaFah9`. A
re-extraction whose hash differs is the signal to re-diff, not a failure.

Re-extraction is fiddly in a way worth writing down: each component is a
length-prefixed blob in the flight stream, and the length is in BYTES while a
naive slice counts UTF-16 units — so a first pass over-reads and every file
arrives carrying the head of the next one. Truncate each blob at the following
`<id>:T<hexlen>,` marker. The over-read is how upstream's own `posthog-js`
analytics import (which belongs to `Chat`) first appeared to be part of
`Task Rows`; nothing in this directory imports it, and nothing here may.
**This product ships no telemetry** — if a future re-extraction reintroduces a
`posthog-js` (or any analytics) import, strip it rather than adapting it.

Two upstream components that look adoptable are deliberately absent for a
dependency reason rather than a design one: `Chat` and `Prompt Bar` both
import `glimm`, an external WebGL-shader and audio-sweep package.

Every row is `adapted`, and the adaptation is heavier than the usual
re-pointing because upstream ships _showcases_: each component drives itself
through a canned fixture on a timer. **The data is now the input** — every one
takes its rows/text/questions as props and holds only view state — since a
component that can render nothing but its own fixture is a picture, not a
component. Three components also lost sections that render data this product
does not have: `Streaming Text`'s inline web-source chips, source list and
follow-up prompts; `Thinking`'s entire `Search` variant; `Tool Chips`' hover
diff-preview chips. `Loading State` lost its `Surfer` variant, which needs a
meme video fixture in `/public`.

Upstream's own design tokens (`--canvas`, `--field`, `--tooltip-bg`,
`bg-inset`, `rounded-card`, `shadow-card`, `shadow-hairline`, `hover-2`) do not
exist here and are mapped onto this repo's ladder (`--background`, `--muted`,
`bg-surface-inset`, `rounded-xl`, `shadow-surface-2`, `bg-hover`). Upstream's
`bg-green` / `bg-red` / `bg-green-tint` status hues are not real Tailwind
colors — they are the site's own tokens, and would have resolved to nothing
here. Settled-status badges keep one semantic accent (`emerald-500` for done,
`--destructive` for failed) matching the vocabulary `THREAD_ACTIVITY_DOT_CLASSES`
already uses in the app; everything else is monochrome. `text-white` survives
on the done badge as a contrast requirement — the palette has no
success-foreground token to reach for.

The `pixel-on` and `shimmer-text` keyframes these files animate with live in
`packages/ui/src/styles/globals.css`, alongside a `prefers-reduced-motion`
block that switches both off.

## Attribution

```text
Vendored from Beautiful UI (beautifului.dev), MIT.
```

## Files

Each row names the upstream component at the pinned extraction, and whether the
code is upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                 | Upstream         | Carried |
| -------------------- | ---------------- | ------- |
| `approval-card.tsx`  | `Approval Card`  | adapted |
| `loading-state.tsx`  | `Loading State`  | adapted |
| `streaming-text.tsx` | `Streaming Text` | adapted |
| `task-rows.tsx`      | `Task Rows`      | adapted |
| `thinking.tsx`       | `Thinking`       | adapted |
| `tool-chips.tsx`     | `Tool Chips`     | adapted |
