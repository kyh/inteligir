import { VariantProps, cva } from "class-variance-authority";
import { AlertCircleIcon } from "../icons";
import React from "react";
import { cn } from "../lib/cn";

const hintVariants = cva("inline-flex items-center gap-x-2 text-xs", {
  variants: {
    variant: {
      info: "text-ui-fg-subtle",
      error: "text-ui-fg-error",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

type HintProps = VariantProps<typeof hintVariants> &
  React.ComponentPropsWithoutRef<"span">;

const Hint = React.forwardRef<HTMLSpanElement, HintProps>(
  ({ className, variant = "info", children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(hintVariants({ variant }), className)}
        {...props}
      >
        {variant === "error" && <AlertCircleIcon />}
        {children}
      </span>
    );
  },
);
Hint.displayName = "Hint";

export { Hint };
