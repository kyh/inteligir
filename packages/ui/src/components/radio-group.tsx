"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "@repo/ui/lib/cn";

// A segmented row: each item is its own label, so there is no dot. Radio rather than a toggle
// group because a choice among a few cannot be cleared; Base UI brings the roving focus and the
// arrow keys that make it one tab stop.
const RadioGroup = <Value,>({ className, ...props }: RadioGroupPrimitive.Props<Value>) => (
  <RadioGroupPrimitive data-slot="radio-group" className={cn("flex gap-1", className)} {...props} />
);

const RadioGroupItem = <Value,>({ className, ...props }: Radio.Root.Props<Value>) => (
  <Radio.Root
    data-slot="radio-group-item"
    className={cn(
      "cursor-pointer rounded-md border border-border px-3 py-1 text-subtitle text-muted-foreground select-none hover:bg-muted/50",
      "data-checked:border-ring data-checked:bg-muted data-checked:text-foreground data-checked:hover:bg-muted",
      "data-disabled:pointer-events-none data-disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export { RadioGroup, RadioGroupItem };
