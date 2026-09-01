// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import type { ComponentType } from "react";
import { ArrowUp, ChevronDown, X } from "lucide-react";

export interface IconComponentProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export type IconComponent = ComponentType<IconComponentProps>;

/** The registry holds only the glyphs the components themselves draw; an app
 *  surface imports lucide directly. The swap facility (IconProvider) had no
 *  caller and is gone — one icon set, named in one place. */
type IconName = "arrow-up" | "chevron-down" | "x";

const icons = {
  "arrow-up": ArrowUp,
  "chevron-down": ChevronDown,
  x: X,
} satisfies Record<IconName, IconComponent>;

/** Returns a single icon component for the given name. */
function useIcon(name: IconName): IconComponent {
  return icons[name];
}

/** Returns the full icon map. */
function useIcons(): typeof icons {
  return icons;
}

export { useIcon, useIcons };
