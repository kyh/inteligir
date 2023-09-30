import { VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const spinnerVariants = cva("overflow-hidden", {
  variants: {
    color: {
      white: "[--spinner-color:#fff]",
      black: "[--spinner-color:#000]",
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
    color: "black",
    size: "sm",
  },
});

interface StatusBadgeProps
  extends Omit<React.ComponentPropsWithoutRef<"span">, "color">,
    VariantProps<typeof spinnerVariants> {}

const Spinner = React.forwardRef<HTMLDivElement, StatusBadgeProps>(
  ({ className, color = "black", size = "sm", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(spinnerVariants({ color, size }), className)}
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
