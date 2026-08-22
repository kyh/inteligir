# Vendored: Fluid Functionalism (partial)

- **Upstream**: https://github.com/mickadesign/fluid-functionalism (registry
  served at https://www.fluidfunctionalism.com/r/)
- **Commit**: `ec595cd3c65125efb9fb87140b28b3ccfc920473`
- **License**: MIT — `LICENSE.fluid-functionalism` in this directory is
  upstream's own text, copied verbatim. The attribution notice below is not a
  substitute for it: MIT requires the license itself to travel with the copy,
  and it names a copyright holder no notice line carries.
- **Vendored**: 2026-08-22

This package is only PARTLY vendored, from two sources: the files below come
from Fluid Functionalism's registry (`-base` / Base UI variants where the
registry ships both), and the rest of `src/components` is stock shadcn from a
ui.shadcn.com/create preset, tracked by `components.provenance.json` (the
accepted-bytes manifest `scripts/provenance.mjs` regenerates — its `fluid`
block names this same upstream and pin). The record is per-file so the
hand-written components (`attachment`, `bubble`, `message*`, …) are not asked
for a notice they should not carry.

Every row is `adapted`: the bodies are upstream's, re-pointed at
`@repo/ui/*` aliases and rewritten to this repo's type rules (no `any`, no
`as`, no non-null `!`), with local extensions re-applied where the file
replaces a component that carried them (dropdown's `anchor` passthrough and
`modal=false` default; button's shadcn variant/size alias maps).

## Attribution

```text
Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
```

## Files

Each row names the upstream file at the pinned commit, and whether the code is
upstream's (`vendored`) or upstream's shape with the bodies rewritten
(`adapted`).

| File                               | Upstream                                        | Carried |
| ---------------------------------- | ----------------------------------------------- | ------- |
| `src/components/badge.tsx`         | `registry/default/badge.tsx`                    | adapted |
| `src/components/button.tsx`        | `registry/base/button.tsx`                      | adapted |
| `src/components/checkbox.tsx`      | `registry/base/checkbox-group.tsx`              | adapted |
| `src/components/dialog.tsx`        | `registry/base/dialog.tsx`                      | adapted |
| `src/components/dropdown-menu.tsx` | `registry/base/dropdown.tsx`                    | adapted |
| `src/components/menu-item.tsx`     | `registry/default/menu-item.tsx`                | adapted |
| `src/components/switch.tsx`        | `registry/base/switch.tsx`                      | adapted |
| `src/components/tooltip.tsx`       | `registry/base/tooltip.tsx`                     | adapted |
| `src/lib/springs.ts`               | `registry/default/lib/springs.ts`               | adapted |
| `src/lib/font-weight.ts`           | `registry/default/lib/font-weight.ts`           | adapted |
| `src/lib/shape-context.tsx`        | `registry/default/lib/shape-context.tsx`        | adapted |
| `src/lib/size-context.tsx`         | `registry/default/lib/size-context.tsx`         | adapted |
| `src/lib/icon-context.tsx`         | `registry/default/lib/icon-context.tsx`         | adapted |
| `src/lib/surface-context.tsx`      | `registry/default/lib/surface-context.tsx`      | adapted |
| `src/lib/surface-classes.ts`       | `registry/default/lib/surface-classes.ts`       | adapted |
| `src/lib/elevated.tsx`             | `registry/default/lib/elevated.tsx`             | adapted |
| `src/lib/utils.ts`                 | `registry/default/lib/utils.ts`                 | adapted |
| `src/hooks/use-proximity-hover.ts` | `registry/default/hooks/use-proximity-hover.ts` | adapted |
| `src/hooks/use-merge-split.tsx`    | `registry/default/hooks/use-merge-split.tsx`    | adapted |
| `src/components/sidebar.tsx`       | `registry/base/sidebar.tsx`                     | adapted |
| `src/components/sidebar-core.tsx`  | `registry/default/sidebar-core.tsx`             | adapted |
| `src/components/sidebar-menu.tsx`  | `registry/default/sidebar-menu.tsx`             | adapted |
| `src/components/scroll-area.tsx`   | `registry/base/scroll-area.tsx`                 | adapted |
| `src/hooks/use-touch-primary.tsx`  | `registry/default/hooks/use-touch-primary.tsx`  | adapted |
