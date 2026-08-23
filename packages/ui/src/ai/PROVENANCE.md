# Vendored: Beautiful UI

- **Upstream**: https://www.beautifului.dev
- **Commit**: `e8555766605009e5a47f225118f6ddba3712849e`
- **License**: MIT — `LICENSE.beautiful-ui` in this directory is upstream's own
  text. The attribution notice below is not a substitute for it: MIT requires
  the license itself to travel with the copy, and it names a copyright holder
  no notice line carries.
- **Vendored**: 2026-08-22

**Upstream publishes no repository and no registry.** It is a single-page
copy-paste showcase, so there is no commit to name. The pin above is the
**sha1 of the twenty adopted sources**, concatenated in the filename order of
the `## Files` table, exactly as extracted — a reproducible identity for the bytes
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

**The whole published set is here — twenty components.** Three arrived
carrying dependencies that were stripped rather than installed:

- `glimm`, an external WebGL-shader and audio-sweep package, drove a rainbow
  sweep (and a sound) across `Prompt Bar` on model change and inside `Chat`.
  Not added: it is decoration, this app plays no sound, and this package has
  been shedding render libraries rather than gaining them. Both components
  keep their structure and interaction; neither paints a shader.
- `posthog-js` — upstream's own product analytics — fired an event when
  `Chat` sent a prompt. **Stripped.** This product ships no telemetry, and a
  vendored capture call would be one.
- `liveline` (a charting package, in `Insight Cards`), `iconoir-react` and
  `@central-icons-react` (icon sets, in `Selection Actions` and
  `Sidebar Nav`). The chart is now a small SVG line renderer written here;
  icons became SLOTS, since this package already carries `lucide-react` and a
  caller may want neither.

Four components also referenced upstream's OWN internal atoms, which its
copy-paste payload does not include: `GlideMenu` (a menu whose highlight
slides between rows), `Button`, `Shimmer` and `StreamText`. `glide-list.tsx`
in this directory is `GlideMenu` rewritten from its observable behavior — it
is OURS, carries no attribution notice, and is the only file here that is not
a copy. The rest became slots or reuse what this directory already has.

`Prompt Bar` and `Chat` additionally inlined Figma, Slack and Gmail brand
marks as their example sources. **Those are gone**: a design system should not
carry other companies' logos, and rows take an `icon` instead.

Every row is `adapted`, and the adaptation is heavier than the usual
re-pointing, in two passes.

First, upstream ships _showcases_: each component drives itself through a
canned fixture on a timer. The data had to become the input, since a component
that can render nothing but its own fixture is a picture, not a component.

Second — and this is the larger divergence — **the API was recomposed into
this repo's compound idiom**. Upstream describes a component with one array
prop (`rows`, `questions`, `actions`); here the parts are CHILDREN, matching
`components/dialog.tsx` and `components/sidebar-menu.tsx`: a parent plus named
subparts, each carrying `data-slot`, a merged `className`, its intrinsic props
spread, and a forwarded ref, with variants through `cva` so consumers get the
type union for free. Shared state that subparts genuinely need travels by
context (the trace's `working` flag, a task item's expansion, an approval's
answer collection) rather than by prop-drilling or a module singleton.

Two shapes could not survive the recomposition unchanged, and both are stated
rather than hidden. The approval card's one-question-at-a-time STEPPER is
gone: a stepper has to count and index its questions, which a parent cannot do
over children it does not own, so questions stack instead — commit-on-pick,
the answer collection and the sent state all survive. And `Thinking`'s
per-row entrance stagger is now CSS `nth-child` delays rather than an index
computed per row, which caps the stagger at the sixth row. Three components also lost sections that render data this product
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

The fourteen added in the second pass lost their upstream FIXTURES the same way
the first six did, and three lost more than that. `Records Table` is mostly a
demo — a company fixture, a competitor pool, model names and the enrichment
sequence that walks them; what is carried is the GRID (resizable columns, a
header naming each column's type and tool, tag cells, the add-column
affordance), because the rest is one app's data and one app's pipeline.
`Flowchart` gave up upstream's absolute canvas: it positioned two known nodes
from measured heights and normalized offsets, which cannot lay out a chart a
caller brings, so nodes stack and connectors sit between them. `Insight Cards`
keeps its card and scrub-tooltip; the chart underneath is ours.

## Attribution

```text
Vendored from Beautiful UI (beautifului.dev), MIT.
```

## Files

Each row names the upstream component at the pinned extraction, and whether the
code is upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                      | Upstream              | Carried |
| ------------------------- | --------------------- | ------- |
| `approval-card.tsx`       | `Approval Card`       | adapted |
| `chat.tsx`                | `Chat`                | adapted |
| `code-block.tsx`          | `Code Block`          | adapted |
| `context-cards.tsx`       | `Context Cards`       | adapted |
| `diff-table.tsx`          | `Diff Table`          | adapted |
| `filter-table.tsx`        | `Filter Table`        | adapted |
| `fine-tune-card.tsx`      | `Fine-tune Card`      | adapted |
| `flowchart.tsx`           | `Flowchart`           | adapted |
| `insight-cards.tsx`       | `Insight Cards`       | adapted |
| `loading-state.tsx`       | `Loading State`       | adapted |
| `prompt-bar.tsx`          | `Prompt Bar`          | adapted |
| `recommendation-card.tsx` | `Recommendation Card` | adapted |
| `records-table.tsx`       | `Records Table`       | adapted |
| `search.tsx`              | `Search`              | adapted |
| `selection-actions.tsx`   | `Selection Actions`   | adapted |
| `sidebar-nav.tsx`         | `Sidebar Nav`         | adapted |
| `streaming-text.tsx`      | `Streaming Text`      | adapted |
| `task-rows.tsx`           | `Task Rows`           | adapted |
| `thinking.tsx`            | `Thinking`            | adapted |
| `tool-chips.tsx`          | `Tool Chips`          | adapted |

`glide-list.tsx` is deliberately absent from this table: it is this repo's own
code, not a copy, and carries no attribution notice.
