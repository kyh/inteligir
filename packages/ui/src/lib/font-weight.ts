// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
// each weight pairs with an opsz measured to hold the advance width nearly constant while animating:
// a heavier wght widens the text, a higher opsz pulls it back. the explicit opsz overrides
// font-optical-sizing: auto on purpose.
export const fontWeights = {
  bold: "'wght' 700, 'opsz' 25",
  medium: "'wght' 450, 'opsz' 15",
  normal: "'wght' 400, 'opsz' 14",
  semibold: "'wght' 550, 'opsz' 20",
} as const;
