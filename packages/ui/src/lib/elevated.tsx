"use client";

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@repo/ui/lib/utils";
import { SurfaceProvider, useSurface } from "@repo/ui/lib/surface-context";
import { surfaceClasses } from "@repo/ui/lib/surface-classes";

interface ElevatedProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Steps above the current substrate. The component's surface level becomes
   * `min(substrate + offset, 8)` and is re-provided to descendants, so further
   * nesting climbs the ladder automatically.
   *
   * Conventional offsets: 2 — dropdown / popover / select; 4 — dialog / modal.
   */
  offset: number;
  /**
   * Override for the shadow level. Defaults to the computed surface level. Pass
   * a fixed value when the shadow weight should stay constant regardless of how
   * deeply the element is nested.
   */
  shadowLevel?: number;
  children?: ReactNode;
}

const Elevated = forwardRef<HTMLDivElement, ElevatedProps>(
  ({ offset, shadowLevel, className, children, ...props }, ref) => {
    const substrate = useSurface();
    const level = Math.min(substrate + offset, 8);
    return (
      <SurfaceProvider value={level}>
        <div
          ref={ref}
          className={cn(surfaceClasses(level, shadowLevel ?? level), className)}
          {...props}
        >
          {children}
        </div>
      </SurfaceProvider>
    );
  },
);
Elevated.displayName = "Elevated";

export { Elevated };
