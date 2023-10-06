"use client";

import * as Primitives from "@radix-ui/react-switch";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const switchVariants = cva(
  "data-[state=unchecked]:hover:after:bg-switch-off-hover-gradient group relative inline-flex items-center rounded-full bg-ui-bg-switch-off outline-none transition-all before:absolute before:inset-0 before:rounded-full before:shadow-details-switch-background before:content-[''] after:absolute after:inset-0 after:rounded-full after:content-[''] hover:bg-ui-bg-switch-off-hover focus:shadow-details-switch-background-focus disabled:cursor-not-allowed disabled:!bg-ui-bg-disabled data-[state=checked]:bg-ui-bg-interactive",
  {
    variants: {
      size: {
        sm: "h-[16px] w-[28px]",
        md: "h-[18px] w-[32px]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const thumbVariants = cva(
  "pointer-events-none h-[14px] w-[14px] rounded-full bg-ui-fg-on-color shadow-details-switch-handle transition-all group-disabled:bg-ui-fg-disabled group-disabled:shadow-none",
  {
    variants: {
      size: {
        sm: "h-[12px] w-[12px] data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0.5",
        md: "h-[14px] w-[14px] transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

type SwitchProps = Omit<
  React.ComponentPropsWithoutRef<typeof Primitives.Root>,
  "asChild"
> &
  VariantProps<typeof switchVariants>;

const Switch = React.forwardRef<
  React.ElementRef<typeof Primitives.Root>,
  SwitchProps
>(({ className, size = "md", ...props }, ref) => (
  <Primitives.Root
    className={cn(switchVariants({ size }), className)}
    {...props}
    ref={ref}
  >
    <Primitives.Thumb className={cn(thumbVariants({ size }))} />
  </Primitives.Root>
));
Switch.displayName = "Switch";

export { Switch };
