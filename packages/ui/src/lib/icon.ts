// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import type { ComponentType } from "react";

interface IconComponentProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/** The shape a glyph prop accepts — what lucide's icons already satisfy, so a
 *  surface passes them straight through. The components that draw a glyph of
 *  their own import lucide directly: one icon set, no registry. */
export type IconComponent = ComponentType<IconComponentProps>;
