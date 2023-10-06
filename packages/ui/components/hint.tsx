import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { forwardRef } from "react";
import { AlertCircleIcon } from "../icons";
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

const Hint = forwardRef<HTMLSpanElement, HintProps>(
  ({ className, variant = "info", children, ...props }, ref) => {
    return (
      <span
        className={cn(hintVariants({ variant }), className)}
        ref={ref}
        {...props}
      >
        {variant === "error" && <AlertCircleIcon className="h-5 w-5" />}
        {children}
      </span>
    );
  },
);
Hint.displayName = "Hint";

export { Hint };
