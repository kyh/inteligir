"use client";
// A row of chips where pressing one is the choice: Base UI's toggle group, so the arrows move
// between chips and the pressed state is announced, never a row of hand-wired buttons.

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { ComponentProps } from "react";

import { cn } from "@repo/ui/lib/cn";

const ToggleGroup = <Value extends string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) => (
  <ToggleGroupPrimitive
    data-slot="toggle-group"
    className={cn("flex flex-wrap items-center gap-1", className)}
    {...props}
  />
);

const ToggleChip = ({ className, ...props }: ComponentProps<typeof TogglePrimitive>) => (
  <TogglePrimitive
    data-slot="toggle-chip"
    className={cn(
      "inline-flex h-6 items-center gap-1 rounded-full border border-line px-2.5 text-body whitespace-nowrap text-muted-foreground outline-none select-none",
      "transition-colors duration-100 hover:bg-hover hover:text-foreground",
      "focus-visible:ring-2 focus-visible:ring-focus-ring",
      "data-pressed:border-transparent data-pressed:bg-foreground data-pressed:text-background",
      "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
);

export { ToggleChip, ToggleGroup };
