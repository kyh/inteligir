// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import type { ComponentProps } from "react";

import { cn } from "@repo/ui/lib/utils";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";

interface ElevatedProps extends ComponentProps<"div"> {
  // conventional offsets: 2 for menus and popovers, 4 for dialogs
  offset: number;
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
