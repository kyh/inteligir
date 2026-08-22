// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
/**
 * Static lookup tables for surface tokens.
 *
 * Tailwind v4's static scanner only generates utility classes for literal
 * strings it sees in source. Template-literal class names like
 * `bg-surface-${level}` are invisible to the scanner, so the matching
 * utility never gets generated and the background renders transparent.
 *
 * Use these maps when picking a surface level at runtime:
 *
 *   <div className={surfaceClasses(level)} />
 *
 * Each entry below contains the literal class name, which is enough for
 * Tailwind to detect and emit the utility.
 */

export type SurfaceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const SURFACE_BG = {
  1: "bg-surface-1",
  2: "bg-surface-2",
  3: "bg-surface-3",
  4: "bg-surface-4",
  5: "bg-surface-5",
  6: "bg-surface-6",
  7: "bg-surface-7",
  8: "bg-surface-8",
} satisfies Record<SurfaceLevel, string>;

export const SURFACE_SHADOW = {
  1: "shadow-surface-1",
  2: "shadow-surface-2",
  3: "shadow-surface-3",
  4: "shadow-surface-4",
  5: "shadow-surface-5",
  6: "shadow-surface-6",
  7: "shadow-surface-7",
  8: "shadow-surface-8",
} satisfies Record<SurfaceLevel, string>;

export const SURFACE_HOVER_BG = {
  1: "hover:bg-surface-1",
  2: "hover:bg-surface-2",
  3: "hover:bg-surface-3",
  4: "hover:bg-surface-4",
  5: "hover:bg-surface-5",
  6: "hover:bg-surface-6",
  7: "hover:bg-surface-7",
  8: "hover:bg-surface-8",
} satisfies Record<SurfaceLevel, string>;

export const SURFACE_HOVER_SHADOW = {
  1: "hover:shadow-surface-1",
  2: "hover:shadow-surface-2",
  3: "hover:shadow-surface-3",
  4: "hover:shadow-surface-4",
  5: "hover:shadow-surface-5",
  6: "hover:shadow-surface-6",
  7: "hover:shadow-surface-7",
  8: "hover:shadow-surface-8",
} satisfies Record<SurfaceLevel, string>;

function isSurfaceLevel(level: number): level is SurfaceLevel {
  return Number.isInteger(level) && level >= 1 && level <= 8;
}

/** Round after clamping so a fractional level can't miss the lookup tables.
 *  The final fallback is unreachable — clamp+round always lands on 1..8 —
 *  but the guard can't prove that to the compiler. */
export function clampSurfaceLevel(level: number): SurfaceLevel {
  const clamped = Math.round(Math.max(1, Math.min(8, level)));
  return isSurfaceLevel(clamped) ? clamped : 1;
}

export function surfaceClasses(bgLevel: number, shadowLevel: number = bgLevel): string {
  return `${SURFACE_BG[clampSurfaceLevel(bgLevel)]} ${SURFACE_SHADOW[clampSurfaceLevel(shadowLevel)]}`;
}

/** The hover half of `surfaceClasses`: the level a surface rises to while the
 *  pointer is on it. Same literal-lookup reason as above — `hover:bg-surface-`
 *  plus a template expression generates nothing. */
export function surfaceHoverClasses(bgLevel: number, shadowLevel: number = bgLevel): string {
  return `${SURFACE_HOVER_BG[clampSurfaceLevel(bgLevel)]} ${SURFACE_HOVER_SHADOW[clampSurfaceLevel(shadowLevel)]}`;
}
