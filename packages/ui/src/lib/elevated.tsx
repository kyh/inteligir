// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).
import type { ReactNode, RefAttributes } from "react";
import { motion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";

import { cn } from "@repo/ui/lib/cn";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";
import { SurfaceProvider, useRaisedSurface } from "@repo/ui/lib/surface-context";
import type { SurfaceLevel } from "@repo/ui/lib/surface-context";

interface ElevatedProps extends Omit<HTMLMotionProps<"div">, "children"> {
  offset: number;
  shadowLevel?: SurfaceLevel;
  children?: ReactNode;
}

const Elevated = ({
  offset,
  shadowLevel,
  className,
  children,
  ...props
}: ElevatedProps & RefAttributes<HTMLDivElement>) => {
  const level = useRaisedSurface(offset);

  return (
    <SurfaceProvider value={level}>
      <motion.div className={cn(surfaceClasses(level, shadowLevel ?? level), className)} {...props}>
        {children}
      </motion.div>
    </SurfaceProvider>
  );
};

export { Elevated };
