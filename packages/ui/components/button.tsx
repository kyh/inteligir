import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  cn(
    "relative inline-flex w-fit items-center justify-center overflow-hidden rounded-md border outline-none transition-fg",
    "disabled:!shadow-none disabled:after:hidden",
    "after:absolute after:inset-0 after:content-['']",
  ),
  {
    variants: {
      variant: {
        primary: cn(
          "border-ui-border-loud bg-ui-button-inverted text-ui-fg-on-inverted shadow-buttons-colored after:button-inverted-gradient",
          "hover:after:button-inverted-hover-gradient disabled:hover:after:button-inverted-gradient hover:bg-ui-button-inverted-hover disabled:hover:bg-ui-button-inverted",
          "active:after:button-inverted-pressed-gradient active:bg-ui-button-inverted-pressed",
          "focus:!shadow-buttons-colored-focus",
        ),
        secondary: cn(
          "border-ui-border-base bg-ui-button-neutral text-ui-fg-base shadow-buttons-neutral after:button-neutral-gradient",
          "hover:after:button-neutral-hover-gradient disabled:hover:after:button-neutral-gradient hover:bg-ui-button-neutral-hover disabled:hover:bg-ui-button-neutral",
          "active:after:button-neutral-pressed-gradient active:bg-ui-button-neutral-pressed",
          "focus:shadow-buttons-neutral-focus",
        ),
        transparent: cn(
          "border-ui-border-transparent bg-ui-button-transparent text-ui-fg-base",
          "hover:bg-ui-button-transparent-hover disabled:hover:bg-ui-button-transparent",
          "active:border-ui-border-base active:bg-ui-button-transparent-pressed",
          "focus:border-ui-border-base focus:bg-ui-bg-base focus:shadow-borders-focus",
          "disabled:!border-none disabled:!bg-transparent disabled:!shadow-none",
        ),
        danger: cn(
          "border-ui-border-danger bg-ui-button-danger text-ui-fg-on-color shadow-buttons-neutral after:button-danger-gradient",
          "hover:after:button-danger-hover-gradient disabled:hover:after:button-danger-gradient hover:bg-ui-button-danger-hover disabled:hover:bg-ui-button-danger",
          "active:after:button-danger-pressed-gradient active:bg-ui-button-danger-pressed",
          "focus:shadow-buttons-neutral-focus",
        ),
      },
      size: {
        sm: "gap-x-1 px-2 py-1 text-xs",
        md: "gap-x-1 px-3 py-1 text-sm",
        lg: "gap-x-1 px-4 py-1.5 text-sm",
        xl: "gap-x-1 px-6 py-1.5 text-base",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "primary",
    },
  },
);

interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
  asChild?: boolean;
}

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
                size="sm"
                color={variant === "primary" ? "primary" : "inverse"}
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
