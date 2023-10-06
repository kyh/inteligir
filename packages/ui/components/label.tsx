"use client";

import * as Primitives from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";

const labelVariants = cva("font-sans", {
  variants: {
    size: {
      md: "text-xs",
      lg: "text-sm",
    },
    weight: {
      regular: "font-normal",
      plus: "font-medium",
    },
  },
  defaultVariants: {
    size: "md",
    weight: "regular",
  },
});

interface LabelProps
  extends React.ComponentPropsWithoutRef<"label">,
    VariantProps<typeof labelVariants> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, size = "md", weight = "regular", ...props }, ref) => {
    return (
      <Primitives.Root
        ref={ref}
        className={cn(labelVariants({ size, weight }), className)}
        {...props}
      />
    );
  },
);
Label.displayName = "Label";

export { Label };
