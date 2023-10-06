import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  cn(
    "relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md outline-none transition-fg",
    "disabled:border-ui-border-base disabled:bg-ui-bg-disabled disabled:text-ui-fg-disabled disabled:shadow-buttons-neutral disabled:after:hidden",
    "after:absolute after:inset-0 after:transition-fg after:content-['']",
  ),
  {
    variants: {
      variant: {
        primary: cn(
          "bg-ui-button-inverted text-ui-fg-on-inverted shadow-buttons-inverted after:button-inverted-gradient",
          "hover:after:button-inverted-hover-gradient hover:bg-ui-button-inverted-hover",
          "active:after:button-inverted-pressed-gradient active:bg-ui-button-inverted-pressed",
          "focus:!shadow-buttons-inverted-focus",
        ),
        secondary: cn(
          "bg-ui-button-neutral text-ui-fg-base shadow-buttons-neutral after:button-neutral-gradient",
          "hover:after:button-neutral-hover-gradient hover:bg-ui-button-neutral-hover",
          "active:after:button-neutral-pressed-gradient active:bg-ui-button-neutral-pressed",
          "focus:shadow-buttons-neutral-focus",
        ),
        danger: cn(
          "shadow-buttons-colored bg-ui-button-danger text-ui-fg-on-color shadow-buttons-danger after:button-danger-gradient",
          "hover:after:button-danger-hover-gradient hover:bg-ui-button-danger-hover",
          "active:after:button-danger-pressed-gradient active:bg-ui-button-danger-pressed",
          "focus:shadow-buttons-danger-focus",
        ),
        transparent: cn(
          "after:hidden",
          "bg-ui-button-transparent text-ui-fg-base",
          "hover:bg-ui-button-transparent-hover",
          "active:bg-ui-button-transparent-pressed",
          "focus:bg-ui-bg-base focus:shadow-buttons-neutral-focus",
          "disabled:!bg-transparent disabled:!shadow-none",
        ),
        outline: cn(
          "shadow-buttons-colored border-ui-border-base bg-transparent",
          "hover:border-ui-border-strong hover:bg-ui-button-neutral disabled:hover:border-ui-border-base disabled:hover:bg-transparent",
        ),
      },
      size: {
        xs: "gap-1 px-2 py-1 text-xs",
        sm: "gap-1 px-3 py-1.5 text-xs",
        md: "gap-1.5 px-4 py-2 text-sm",
        lg: "gap-2 px-5 py-2.5 text-sm",
        xl: "gap-2 px-6 py-3 text-sm",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "primary",
    },
  },
);

type ButtonProps = {
  isLoading?: boolean;
  asChild?: boolean;
} & React.ComponentPropsWithoutRef<"button"> &
  VariantProps<typeof buttonVariants>;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      className,
      asChild = false,
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
          <span className="pointer-events-none duration-300 animate-in fade-in">
            <div
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-md",
              )}
            >
              <Spinner
                color={variant === "primary" ? "primary" : "inverse"}
                size="sm"
              />
            </div>
            <span className="opacity-0">{children}</span>
          </span>
        );
      }

      return children;
    };

    return (
      <Component
        ref={ref}
        {...props}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || isLoading}
      >
        {renderInner()}
      </Component>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
