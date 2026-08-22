// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import type { ComponentProps } from "react";

import { cn } from "@repo/ui/lib/utils";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";

interface ElevatedProps extends ComponentProps<"div"> {
  /**
   * Steps above the current substrate.
   *
   * The component's own surface level becomes `min(substrate + offset, 8)`
   * and is re-provided to descendants via SurfaceProvider, so further
   * nesting walks up the ladder automatically.
   *
   * Conventional offsets:
   *   2 — dropdown / popover / select menu
   *   4 — dialog / modal
   */
  offset: number;
  /**
   * Override for the shadow level. Defaults to the computed surface level.
   *
   * Pass a fixed value when the component should keep a constant shadow
   * weight regardless of how deeply it's nested — e.g. a dropdown always
   * reads `shadow-surface-3` whether it opens on the page or inside a
   * dialog, even though its background tracks the substrate.
   */
  shadowLevel?: number;
}

function Elevated({ offset, shadowLevel, className, children, ...props }: ElevatedProps) {
  const substrate = useSurface();
  const level = Math.min(substrate + offset, 8);
  return (
    <SurfaceProvider value={level}>
      <div className={cn(surfaceClasses(level, shadowLevel ?? level), className)} {...props}>
        {children}
      </div>
    </SurfaceProvider>
  );
}

export { Elevated };
