# Vendored: plate registry ui components

- **Upstream**: https://github.com/udecode/plate, directory
  `apps/www/src/registry/ui`
- **Commit**: `bc7104f7dd009a0c2da78cffaee1108b4c430f46`
- **License**: MIT — `LICENSE.plate` in this directory is upstream's own text,
  copied verbatim (it names the copyright holders no per-file notice line
  carries).
- **Vendored**: 2026-08-21

This package is house-authored except the files below, whose component shapes
come from plate's free MIT registry (the shadcn-style `ui` kit). Every listed
file is `adapted` rather than `vendored`: upstream's component structure with
the bodies reworked for this editor — this app's design tokens, the nested
toggle document model, an owned column drag-resize (upstream uses
`@platejs/resizable`), URL-only media nodes with a stricter iframe sandbox,
and a re-derived equation input (`@platejs/math` is deliberately not a
dependency). The record is per-file so the house-authored rest of `src/` is
not asked for a notice it should not carry.

## Attribution

```text
Vendored from plate (github.com/udecode/plate), MIT. © Plate contributors.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                          | Upstream                                        | Carried |
| ----------------------------- | ----------------------------------------------- | ------- |
| `src/block-selection.tsx`     | `apps/www/src/registry/ui/block-selection.tsx`  | adapted |
| `src/cursor-overlay.tsx`      | `apps/www/src/registry/ui/cursor-overlay.tsx`   | adapted |
| `src/editor-chrome.tsx`       | `apps/www/src/registry/ui/editor.tsx`           | adapted |
| `src/nodes/column-node.tsx`   | `apps/www/src/registry/ui/column-node.tsx`      | adapted |
| `src/nodes/embed-node.tsx`    | `apps/www/src/registry/ui/media-embed-node.tsx` | adapted |
| `src/nodes/equation-node.tsx` | `apps/www/src/registry/ui/equation-node.tsx`    | adapted |
| `src/nodes/toggle-node.tsx`   | `apps/www/src/registry/ui/toggle-node.tsx`      | adapted |
| `src/nodes/youtube-node.tsx`  | `apps/www/src/registry/ui/media-video-node.tsx` | adapted |

## Local edits worth knowing before a re-vendor

- `src/editor-chrome.tsx` collapses upstream's cva variants to the `default`
  variant as plain class strings, swaps `brand` for this app's `primary`,
  moves document typography to `typeset`/`typeset-docs`, and tightens the
  centered-column padding from upstream's 64px to 48px so the -left-11 drag
  gutter stays inside the editable's clip (`EDITOR_COLUMN_PX`).
- `src/nodes/toggle-node.tsx` targets the NESTED toggle document model (block
  children, not indent siblings) and rescues the selection out of a collapsing
  body before hiding it; upstream renders the flat model.
- `src/nodes/column-node.tsx` keeps upstream's group/column shells but owns
  drag-resize imperatively (commit-on-release percentage writes); upstream
  delegates to `@platejs/resizable`.
- `src/nodes/embed-node.tsx` / `src/nodes/youtube-node.tsx` are URL-only (no
  resize, captions or uploads), gate non-http(s) URLs, and run embeds in a
  minimal `sandbox`; youtube renders through `react-lite-youtube-embed`
  instead of upstream's `react-player`.
- `src/nodes/equation-node.tsx` re-derives the equation input as a plain
  textarea in the popover; upstream's `useEquationInput`/`TextareaAutosize`
  are not used because `@platejs/math` eagerly imports katex.
- `src/cursor-overlay.tsx` / `src/block-selection.tsx` drop upstream's
  AI-chat and DnD wiring; block-selection renders a `span` (a `div` is
  invalid inside `<p>`) and takes `pluginKey` as a prop.

## Re-vendor recipe

Read the upstream files at a newer commit, diff against this directory
ignoring the notice lines, and re-apply the edits above. The kit files that
import these components pin their export names — `pnpm typecheck && pnpm
vitest run` in this package is the parity gate.
