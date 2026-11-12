"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@repo/ui/lib/cn";

const CheckMark = () => (
  <motion.svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground"
    initial={{ opacity: 1 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 1 }}
  >
    <motion.path
      d="M6 12L10 16L18 8"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1, transition: { duration: 0.08, ease: "easeOut" } }}
      exit={{ pathLength: 0, transition: { duration: 0.04, ease: "easeIn" } }}
    />
  </motion.svg>
);

// keepMounted holds the span through the exit so the un-draw is visible; initial={false} skips the
// draw for a box that mounts already checked.
const CheckIndicator = () => (
  <CheckboxPrimitive.Indicator
    keepMounted
    data-slot="checkbox-indicator"
    render={(indicatorProps, state) => (
      <span {...indicatorProps}>
        <AnimatePresence initial={false}>{state.checked && <CheckMark />}</AnimatePresence>
      </span>
    )}
  />
);

// invisible ::after padding widens the small square's hit target
const HIT_TARGET = "after:absolute after:-inset-x-3 after:-inset-y-2";

const Checkbox = ({ className, ...props }: CheckboxPrimitive.Root.Props) => (
  <CheckboxPrimitive.Root
    data-slot="checkbox"
    className={cn(
      "relative shrink-0 cursor-pointer appearance-none bg-transparent p-0 outline-none",
      "border-[1.5px] border-solid border-border transition-colors duration-80",
      "hover:border-neutral-400 dark:hover:border-neutral-500",
      HIT_TARGET,
      "focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "data-disabled:pointer-events-none data-disabled:opacity-50",
      "h-[14px] w-[14px] rounded-[4px]",
      className,
    )}
    {...props}
  >
    <CheckIndicator />
  </CheckboxPrimitive.Root>
);

export { Checkbox };
