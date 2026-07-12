"use client";

import { memo } from "react";

import { cn } from "@repo/ui/lib/utils";

const SPREAD_PER_CHAR = 2;

export interface TextShimmerProps {
  children: string;
  className?: string | undefined;
  duration?: number | undefined;
}

// A moving highlight window swept across text via a CSS keyframe animation
// (`animate-shimmer-sweep` in globals.css) — background-position paints, but
// no JS runs per frame, which matters because this ticks for the whole busy
// window. Under prefers-reduced-motion the sweep stops and the text renders
// as plain muted foreground.
const ShimmerComponent = ({ children, className, duration = 2 }: TextShimmerProps) => {
  const spread = (children?.length ?? 0) * SPREAD_PER_CHAR;

  return (
    <p
      className={cn(
        "animate-shimmer-sweep relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[background-repeat:no-repeat,padding-box]",
        "motion-reduce:bg-none motion-reduce:text-muted-foreground",
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(90deg,#0000 calc(50% - ${spread}px),var(--color-background),#0000 calc(50% + ${spread}px)), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))`,
        animationDuration: `${duration}s`,
      }}
    >
      {children}
    </p>
  );
};

export const Shimmer = memo(ShimmerComponent);
