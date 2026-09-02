// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
// each tier is the enter spring and `.exit` its matching tween, one tier quicker; never hand-write
// a duration, reach for a tier
export const spring = {
  fast: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
    exit: { duration: 0.06 },
  },
  moderate: {
    type: "spring" as const,
    duration: 0.16,
    bounce: 0,
    exit: { duration: 0.12 },
  },
  slow: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0.12,
    exit: { duration: 0.16 },
  },
} as const;

// derived here so the deferred-unmount fallback timers (a throttled tab stalls onAnimationComplete)
// stay in step with the tokens
export const exitFallbackMs = (tier: { exit: { duration: number } }) =>
  Math.round(tier.exit.duration * 1000) + 100;
