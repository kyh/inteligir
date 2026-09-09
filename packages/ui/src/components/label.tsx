"use client";
// Vendored from shadcn/ui (github.com/shadcn-ui/ui), MIT.

import * as React from "react";

import { cn } from "cn";

const Label = ({ className, ...props }: React.ComponentProps<"label">) => (
  // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- a pass-through primitive: the caller supplies htmlFor or nests the control, neither of which is visible here
  <label
    data-slot="label"
    className={cn(
      "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export { Label };
