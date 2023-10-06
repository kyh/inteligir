import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
import { DotIcon } from "../icons";

type StatusBadgeProps = Omit<React.ComponentPropsWithoutRef<"span">, "color"> &
  VariantProps<typeof badgeColorVariants>;

const badgeColorVariants = cva("", {
  variants: {
    color: {
      green: "bg-green-500",
      red: "bg-red-500",
      blue: "bg-blue-500",
      orange: "bg-orange-500",
      grey: "bg-neutral-500",
      purple: "bg-purple-500",
    },
  },
  defaultVariants: {
    color: "grey",
  },
});

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ children, className, color = "grey", ...props }, ref) => {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-ui-border-base bg-ui-bg-base py-1 pl-1 pr-3 text-xs text-ui-fg-base",
          badgeColorVariants({ color }),
          className,
        )}
        ref={ref}
        {...props}
      >
        <DotIcon className="mr-0.5 h-5 w-5" />
        {children}
      </span>
    );
  },
);
StatusBadge.displayName = "StatusBadge";

export { StatusBadge };
