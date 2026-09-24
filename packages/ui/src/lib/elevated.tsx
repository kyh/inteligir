// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.
import type { ReactNode, RefAttributes } from "react";
import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";

import { cn } from "@repo/ui/lib/cn";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";

interface ElevatedProps extends Omit<HTMLMotionProps<"div">, "children"> {
  // conventional offsets: 2 for menus and popovers, 4 for dialogs
  offset: number;
  shadowLevel?: number;
  children?: ReactNode;
}

// a motion element, so a popup can render its Popup as the surface and animate that one element:
// Base UI waits only on the Popup's own animations before it unmounts a closing popup
const Elevated = ({
  offset,
  shadowLevel,
  className,
  children,
  ...props
}: ElevatedProps & RefAttributes<HTMLDivElement>) => {
  const substrate = useSurface();
  const level = Math.min(substrate + offset, 8);
  return (
    <SurfaceProvider value={level}>
      <motion.div className={cn(surfaceClasses(level, shadowLevel ?? level), className)} {...props}>
        {children}
      </motion.div>
    </SurfaceProvider>
  );
};

export { Elevated };
