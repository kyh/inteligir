// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).
import type { ComponentType } from "react";

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export type IconComponent = ComponentType<IconProps>;
