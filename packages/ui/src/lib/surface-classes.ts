/**
 * Static lookup tables for the surface + shadow elevation ladders.
 *
 * Tailwind v4's scanner only generates utilities for literal class strings it
 * sees in source. Template literals like `bg-surface-${level}` are invisible to
 * it, so the utility never gets emitted and the background renders transparent.
 * Pick a level at runtime through these maps instead:
 *
 *   <div className={surfaceClasses(level)} />
 */

export const SURFACE_BG: Record<number, string> = {
  1: "bg-surface-1",
  2: "bg-surface-2",
  3: "bg-surface-3",
  4: "bg-surface-4",
  5: "bg-surface-5",
  6: "bg-surface-6",
  7: "bg-surface-7",
  8: "bg-surface-8",
};

const SURFACE_SHADOW: Record<number, string> = {
  1: "shadow-surface-1",
  2: "shadow-surface-2",
  3: "shadow-surface-3",
  4: "shadow-surface-4",
  5: "shadow-surface-5",
  6: "shadow-surface-6",
  7: "shadow-surface-7",
  8: "shadow-surface-8",
};

export function surfaceClasses(bgLevel: number, shadowLevel: number = bgLevel): string {
  const bg = Math.max(1, Math.min(8, bgLevel));
  const shadow = Math.max(1, Math.min(8, shadowLevel));
  return `${SURFACE_BG[bg]} ${SURFACE_SHADOW[shadow]}`;
}
