"use client";

import * as Primitives from "@radix-ui/react-checkbox";
import * as React from "react";
import { CheckIcon, MinusIcon } from "../icons";
import { cn } from "../lib/cn";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof Primitives.Root>,
  React.ComponentPropsWithoutRef<typeof Primitives.Root>
>(({ className, checked, ...props }, ref) => {
  return (
    <Primitives.Root
      {...props}
      checked={checked}
      className={cn(
        "group relative inline-flex h-5 w-5 items-center justify-center outline-none ",
        className,
      )}
      ref={ref}
    >
      <div className="h-[14px] w-[14px] rounded-[3px] bg-ui-bg-base text-ui-fg-on-inverted shadow-borders-base transition-fg group-hover:bg-ui-bg-base-hover group-focus:!shadow-borders-interactive-with-focus group-disabled:!bg-ui-bg-disabled group-disabled:text-ui-fg-disabled group-disabled:!shadow-borders-base group-data-[state=checked]:bg-ui-bg-interactive group-data-[state=indeterminate]:bg-ui-bg-interactive group-data-[state=checked]:shadow-borders-interactive-with-shadow group-data-[state=indeterminate]:shadow-borders-interactive-with-shadow [&_path]:shadow-details-contrast-on-bg-interactive">
        <Primitives.Indicator className="absolute inset-0">
          {checked === "indeterminate" ? <MinusIcon /> : <CheckIcon />}
        </Primitives.Indicator>
      </div>
    </Primitives.Root>
  );
});
Checkbox.displayName = "Checkbox";

export { Checkbox };
