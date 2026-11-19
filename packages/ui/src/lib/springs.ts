// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).
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
