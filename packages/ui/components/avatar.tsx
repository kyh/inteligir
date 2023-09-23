"use client";

import * as Primitives from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";

const avatarVariants = cva(
  "border-ui-border-strong flex shrink-0 items-center justify-center overflow-hidden border",
  {
    variants: {
      variant: {
        squared: "rounded-lg",
        rounded: "rounded-full",
      },
      size: {
        md: "h-8 w-8",
        lg: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "rounded",
      size: "md",
    },
  },
);

const innerVariants = cva("aspect-square object-cover object-center", {
  variants: {
    variant: {
      squared: "rounded-lg",
      rounded: "rounded-full",
    },
    size: {
      md: "h-6 w-6 text-xs",
      lg: "h-8 w-8 text-sm",
    },
  },
  defaultVariants: {
    variant: "rounded",
    size: "md",
  },
});

interface AvatarProps
  extends Omit<
      React.ComponentPropsWithoutRef<typeof Primitives.Root>,
      "asChild" | "children" | "size"
    >,
    VariantProps<typeof avatarVariants> {
  src?: string;
  fallback: string;
}

const Avatar = React.forwardRef<
  React.ElementRef<typeof Primitives.Root>,
  AvatarProps
>(
  (
    { src, fallback, variant = "rounded", size = "md", className, ...props },
    ref,
  ) => {
    return (
      <Primitives.Root
        ref={ref}
        {...props}
        className={cn(avatarVariants({ variant, size }), className)}
      >
        {src && (
          <Primitives.Image
            src={src}
            className={innerVariants({ variant, size })}
          />
        )}
        <Primitives.Fallback
          className={cn(
            innerVariants({ variant, size }),
            "bg-ui-bg-component text-ui-fg-subtle pointer-events-none flex select-none items-center justify-center",
          )}
        >
          {fallback}
        </Primitives.Fallback>
      </Primitives.Root>
    );
  },
);
Avatar.displayName = "Avatar";

export { Avatar };
