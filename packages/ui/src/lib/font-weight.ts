/**
 * Variable-font weight tokens, applied via `fontVariationSettings`. Animating
 * the `'wght'` axis (instead of swapping discrete font weights) lets text
 * shift hierarchy smoothly — e.g. a tab label easing from normal to semibold
 * as it becomes selected. Requires a variable sans (the app's --font-sans).
 */
export const fontWeights = {
  normal: "'wght' 400",
  medium: "'wght' 450",
  semibold: "'wght' 550",
  bold: "'wght' 700",
} as const;
