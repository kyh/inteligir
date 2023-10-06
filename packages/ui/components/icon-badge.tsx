import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";
import { badgeColorVariants } from "./badge";

const iconBadgeVariants = cva(
  "flex items-center justify-center overflow-hidden rounded-md border",
  {
    variants: {
      size: {
        md: "h-6 w-6",
        lg: "h-7 w-7",
      },
    },
  },
);

type IconBadgeProps = {
  asChild?: boolean;
} & Omit<React.ComponentPropsWithoutRef<"span">, "color"> &
  VariantProps<typeof badgeColorVariants> &
  VariantProps<typeof iconBadgeVariants>;

const IconBadge = React.forwardRef<HTMLSpanElement, IconBadgeProps>(
  (
    {
      children,
      className,
      color = "grey",
      size = "md",
      asChild = false,
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : "span";

    return (
      <Component
        className={cn(
          badgeColorVariants({ color }),
          iconBadgeVariants({ size }),
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </Component>
    );
  },
);
IconBadge.displayName = "IconBadge";

export { IconBadge };
