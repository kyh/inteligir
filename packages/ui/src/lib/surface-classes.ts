// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
// Tailwind's scanner only emits utilities for literal class strings; `bg-surface-${level}` is
// invisible to it and renders transparent

type SurfaceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

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

function isSurfaceLevel(level: number): level is SurfaceLevel {
  return Number.isInteger(level) && level >= 1 && level <= 8;
}

// round after clamping so a fractional level cannot miss the lookup; the final fallback is
// unreachable but the guard cannot prove that
function clampSurfaceLevel(level: number): SurfaceLevel {
  const clamped = Math.round(Math.max(1, Math.min(8, level)));
  return isSurfaceLevel(clamped) ? clamped : 1;
}

export function surfaceClasses(bgLevel: number, shadowLevel: number = bgLevel): string {
  return `${SURFACE_BG[clampSurfaceLevel(bgLevel)]} ${SURFACE_SHADOW[clampSurfaceLevel(shadowLevel)]}`;
}
