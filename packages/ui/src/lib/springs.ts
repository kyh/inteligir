// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
// each tier is the enter spring and `.exit` its matching tween, one tier quicker; never hand-write
// a duration, reach for a tier
export const spring = {
  fast: {
    bounce: 0,
    duration: 0.08,
    exit: { duration: 0.06 },
    type: "spring" as const,
  },
  moderate: {
    bounce: 0,
    duration: 0.16,
    exit: { duration: 0.12 },
    type: "spring" as const,
  },
  slow: {
    bounce: 0.12,
    duration: 0.24,
    exit: { duration: 0.16 },
    type: "spring" as const,
  },
} as const;

// derived here so the deferred-unmount fallback timers (a throttled tab stalls onAnimationComplete)
// stay in step with the tokens
export const exitFallbackMs = (tier: { exit: { duration: number } }) =>
  Math.round(tier.exit.duration * 1000) + 100;
