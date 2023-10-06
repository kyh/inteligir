import { VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/cn";
import { Spinner } from "./spinner";
import { Slot } from "@radix-ui/react-slot";

const iconButtonVariants = cva(
  cn(
    "relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none transition-fg",
    "disabled:bg-ui-bg-disabled disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden",
  ),
  {
    variants: {
      variant: {
        primary: cn(
          "bg-ui-button-neutral text-ui-fg-subtle shadow-buttons-neutral after:button-neutral-gradient",
          "hover:after:button-neutral-hover-gradient hover:bg-ui-button-neutral-hover",
          "active:after:button-neutral-pressed-gradient active:bg-ui-button-neutral-pressed",
          "focus:shadow-buttons-neutral-focus",
          "after:absolute after:inset-0 after:content-['']",
        ),
        transparent: cn(
          "bg-ui-button-transparent text-ui-fg-subtle",
          "hover:bg-ui-button-transparent-hover",
          "active:bg-ui-button-transparent-pressed",
          "focus:bg-ui-bg-base focus:shadow-buttons-neutral-focus",
          "disabled:!bg-transparent disabled:!shadow-none",
        ),
      },
      size: {
        md: "h-8 w-8 p-1.5",
        lg: "h-10 w-10 p-2.5",
        xl: "h-12 w-12 p-3.5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

interface IconButtonProps
  extends React.ComponentPropsWithoutRef<"button">,
    VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      asChild = false,
      className,
      children,
      isLoading = false,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : "button";

    /**
     * In the case of a button where asChild is true, and isLoading is true, we ensure that
     * only on element is passed as a child to the Slot component. This is because the Slot
     * component only accepts a single child.
     */
    const renderInner = () => {
      if (isLoading) {
        return (
          <span className="pointer-events-none">
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-md bg-ui-bg-disabled",
              )}
            >
              <Spinner
                size="sm"
                color={
                  !variant || variant === "primary" ? "primary" : "inverse"
                }
              />
            </div>
            {children}
          </span>
        );
      }

      return children;
    };

    return (
      <Component
        ref={ref}
        {...props}
        className={cn(iconButtonVariants({ variant, size }), className)}
        disabled={disabled || isLoading}
      >
        {renderInner()}
      </Component>
    );
  },
);
IconButton.displayName = "IconButton";

export { IconButton, iconButtonVariants };
