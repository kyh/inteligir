"use client";

import { memo, useMemo } from "react";
import { motion } from "framer-motion";

import { cn } from "@repo/ui/lib/utils";
import { toMotionStyle } from "@repo/ui/lib/motion-bridge";

const SPREAD_PER_CHAR = 2;

export interface TextShimmerProps {
  children: string;
  className?: string | undefined;
  duration?: number | undefined;
}

const ShimmerComponent = ({ children, className, duration = 2 }: TextShimmerProps) => {
  const dynamicSpread = useMemo(() => (children?.length ?? 0) * SPREAD_PER_CHAR, [children]);

  return (
    <motion.p
      animate={{ backgroundPosition: "0% center" }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      style={toMotionStyle({
        "--spread": `${dynamicSpread}px`,
        backgroundImage:
          "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
      })}
      transition={{
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY,
      }}
    >
      {children}
    </motion.p>
  );
};

export const Shimmer = memo(ShimmerComponent);
