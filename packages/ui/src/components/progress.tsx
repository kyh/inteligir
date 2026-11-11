"use client";
// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

import { cn } from "@repo/ui/lib/cn";

const Progress = ({ className, children, value, ...props }: ProgressPrimitive.Root.Props) => (
  <ProgressPrimitive.Root
    value={value}
    data-slot="progress"
    className={cn("flex flex-wrap gap-3", className)}
    {...props}
  >
    {children}
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className="relative flex h-2 w-full items-center overflow-x-hidden rounded-2xl bg-muted"
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full bg-primary transition-all"
      />
    </ProgressPrimitive.Track>
  </ProgressPrimitive.Root>
);

export { Progress };
