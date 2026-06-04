/**
 * Spring tokens for functional animation. Motion is information, not
 * decoration — pick the token by the distance/importance of the change.
 *
 *   fast     micro-interactions: hover, fade, toggles, tabs, chips
 *   moderate small expansion / short movement: dropdowns, tooltips, toasts
 *   slow     large expansion / system notifications: modals, side panels
 */
export const springs = {
  fast: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
  },
  moderate: {
    type: "spring" as const,
    duration: 0.16,
    bounce: 0.15,
  },
  slow: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0.15,
  },
} as const;
