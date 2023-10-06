import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const spinnerVariants = cva("overflow-hidden", {
  variants: {
    color: {
      primary: "[--spinner-color:#fff] dark:[--spinner-color:#000]",
      inverse: "[--spinner-color:#000] dark:[--spinner-color:#fff]",
    },
    size: {
      xs: "h-3 w-3",
      sm: "h-4 w-4",
      md: "h-6 w-6",
      lg: "h-8 w-8",
      xl: "h-12 w-12",
    },
  },
  defaultVariants: {
    color: "primary",
    size: "sm",
  },
});

type StatusBadgeProps = Omit<React.ComponentPropsWithoutRef<"span">, "color"> &
  VariantProps<typeof spinnerVariants>;

const Spinner = React.forwardRef<HTMLDivElement, StatusBadgeProps>(
  ({ className, color = "primary", size = "sm", ...props }, ref) => {
    return (
      <div
        className={cn(spinnerVariants({ color, size }), className)}
        ref={ref}
        {...props}
      >
        <div className="relative h-full w-full">
          <div className="spinner-line atom-spinner-line-1 animate-atom-spinner-animation-1" />
          <div className="spinner-line atom-spinner-line-2 animate-atom-spinner-animation-2" />
          <div className="spinner-line atom-spinner-line-3 animate-atom-spinner-animation-3" />
        </div>
      </div>
    );
  },
);
Spinner.displayName = "Spinner";

export { Spinner };
