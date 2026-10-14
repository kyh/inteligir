// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import type { SurfaceLevel } from "@repo/ui/lib/surface-context";

// Tailwind's scanner only emits utilities for literal class strings; `bg-surface-${level}` is
// invisible to it and renders transparent
const SURFACE_BG = {
  1: "bg-surface-1",
  2: "bg-surface-2",
  3: "bg-surface-3",
  4: "bg-surface-4",
  5: "bg-surface-5",
  6: "bg-surface-6",
  7: "bg-surface-7",
  8: "bg-surface-8",
} satisfies Record<SurfaceLevel, string>;

const SURFACE_SHADOW = {
  1: "shadow-surface-1",
  2: "shadow-surface-2",
  3: "shadow-surface-3",
  4: "shadow-surface-4",
  5: "shadow-surface-5",
  6: "shadow-surface-6",
  7: "shadow-surface-7",
  8: "shadow-surface-8",
} satisfies Record<SurfaceLevel, string>;

export const surfaceClasses = (bg: SurfaceLevel, shadow: SurfaceLevel = bg): string =>
  `${SURFACE_BG[bg]} ${SURFACE_SHADOW[shadow]}`;
