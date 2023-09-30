import { Slot } from "@radix-ui/react-slot";
import { VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const badgeColorVariants = cva("", {
  variants: {
    color: {
      green:
        "border-ui-tag-green-border bg-ui-tag-green-bg text-ui-tag-green-text [&_svg]:text-ui-tag-green-icon",
      red: "border-ui-tag-red-border bg-ui-tag-red-bg text-ui-tag-red-text [&_svg]:text-ui-tag-red-icon",
      blue: "border-ui-tag-blue-border bg-ui-tag-blue-bg text-ui-tag-blue-text [&_svg]:text-ui-tag-blue-icon",
      orange:
        "border-ui-tag-orange-border bg-ui-tag-orange-bg text-ui-tag-orange-text [&_svg]:text-ui-tag-orange-icon",
      grey: "border-ui-tag-neutral-border bg-ui-tag-neutral-bg text-ui-tag-neutral-text [&_svg]:text-ui-tag-neutral-icon",
      purple:
        "border-ui-tag-purple-border bg-ui-tag-purple-bg text-ui-tag-purple-text [&_svg]:text-ui-tag-purple-icon",
    },
  },
  defaultVariants: {
    color: "grey",
  },
});

const badgeSizeVariants = cva("inline-flex items-center gap-x-0.5 border", {
  variants: {
    size: {
      sm: "px-1.5 text-xs",
      md: "px-2 py-0.5 text-xs",
      lg: "px-2.5 py-1 text-sm",
    },
    rounded: {
      md: "rounded-md",
      full: "rounded-full",
    },
  },
  defaultVariants: {
    size: "md",
    rounded: "md",
  },
});

interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof badgeSizeVariants>,
    VariantProps<typeof badgeColorVariants> {
  asChild?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      size = "md",
      rounded = "md",
      color = "grey",
      asChild = false,
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : "span";

    return (
      <Component
        ref={ref}
        className={cn(
          badgeColorVariants({ color }),
          badgeSizeVariants({ size, rounded }),
          className,
        )}
        {...props}
      />
    );
  },
);
Badge.displayName = "Badge";

export { Badge, badgeColorVariants };
