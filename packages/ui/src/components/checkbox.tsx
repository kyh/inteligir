"use client";
// Vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism), MIT.

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { AnimatePresence, motion } from "framer-motion";

import { useSize, type SizeVariant } from "@repo/ui/lib/size-context";
import { cn } from "@repo/ui/lib/utils";

function CheckMark({ compact }: { compact: boolean }) {
  return (
    <motion.svg
      width={compact ? 16 : 18}
      height={compact ? 16 : 18}
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
}

// keepMounted holds the span through the exit so the un-draw is visible; initial={false} skips the
// draw for a box that mounts already checked.
function CheckIndicator({ compact }: { compact: boolean }) {
  return (
    <CheckboxPrimitive.Indicator
      keepMounted
      data-slot="checkbox-indicator"
      render={(indicatorProps, state) => (
        <span {...indicatorProps}>
          <AnimatePresence initial={false}>
            {state.checked && <CheckMark compact={compact} />}
          </AnimatePresence>
        </span>
      )}
    />
  );
}

type CheckboxProps = CheckboxPrimitive.Root.Props & {
  size?: SizeVariant;
};

function Checkbox({ className, size, ...props }: CheckboxProps) {
  const compact = useSize(size).variant === "compact";
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "relative shrink-0 cursor-pointer appearance-none bg-transparent p-0 outline-none",
        "border-[1.5px] border-solid border-border transition-colors duration-80",
        "hover:border-neutral-400 dark:hover:border-neutral-500",
        // Invisible ::after padding widens the small square's hit target.
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        compact ? "h-[14px] w-[14px] rounded-[4px]" : "h-[16px] w-[16px] rounded-[5px]",
        className,
      )}
      {...props}
    >
      <CheckIndicator compact={compact} />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
