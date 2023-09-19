import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/cn";
import { Spinner, type SpinnerProps } from "./spinner";

const buttonVariants = cva(
  "transition-fg relative inline-flex w-fit items-center justify-center overflow-hidden rounded-lg border outline-none after:absolute after:inset-0 after:content-[''] disabled:text-transparent disabled:!shadow-none disabled:after:hidden",
  {
    variants: {
      variant: {
        primary: cn(
          "shadow-buttons-colored text-ui-fg-on-inverted border-ui-border-loud bg-ui-button-inverted after:button-inverted-gradient",
          "hover:bg-ui-button-inverted-hover hover:after:button-inverted-hover-gradient",
          "active:bg-ui-button-inverted-pressed active:after:button-inverted-pressed-gradient",
          "focus:!shadow-buttons-colored-focus",
        ),
        secondary: cn(
          "shadow-buttons-neutral text-ui-fg-base border-ui-border-base bg-ui-button-neutral after:button-neutral-gradient",
          "hover:bg-ui-button-neutral-hover hover:after:button-neutral-hover-gradient",
          "active:bg-ui-button-neutral-pressed active:after:button-neutral-pressed-gradient",
          "focus:shadow-buttons-neutral-focus",
        ),
        transparent: cn(
          "text-ui-fg-base border-ui-border-transparent bg-ui-button-transparent",
          "hover:bg-ui-button-transparent-hover",
          "active:bg-ui-button-transparent-pressed active:border-ui-border-base",
          "focus:shadow-borders-focus focus:bg-ui-bg-base focus:border-ui-border-base",
        ),
        danger: cn(
          "shadow-buttons-neutral text-ui-fg-on-color border-ui-border-danger bg-ui-button-danger after:button-danger-gradient",
          "hover:bg-ui-button-danger-hover hover:after:button-danger-hover-gradient",
          "active:bg-ui-button-danger-pressed active:after:button-danger-pressed-gradient",
          "focus:shadow-buttons-neutral-focus",
        ),
      },
      size: {
        sm: "txt-compact-xsmall-plus gap-x-0.5 px-[7px] py-[1px]",
        md: "txt-compact-small-plus gap-x-1.5 px-[11px] py-[5px]",
        lg: "txt-compact-medium-plus gap-x-2 px-[15px] py-[9px]",
        xl: "txt-compact-large-plus gap-x-2 px-[19px] py-[13px]",
      },
      format: {
        default: "",
        icon: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      format: "default",
    },
    compoundVariants: [
      {
        size: "sm",
        format: "icon",
        className: "px-px py-px",
      },
      {
        size: "md",
        format: "icon",
        className: "px-[5px] py-[5px]",
      },
      {
        size: "lg",
        format: "icon",
        className: "px-[9px] py-[9px]",
      },
      {
        size: "xl",
        format: "icon",
        className: "px-[13px] py-[13px]",
      },
    ],
  },
);

interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button">,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      size,
      variant,
      format,
      className,
      asChild = false,
      children,
      loading = false,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : "button";

    /**
     * In the case of a button where asChild is true, and loading is true, we ensure that
     * only on element is passed as a child to the Slot component. This is because the Slot
     * component only accepts a single child.
     */
    const renderInner = () => {
      if (loading) {
        return (
          <span className="pointer-events-none">
            <div className="absolute inset-0 z-[1] flex items-center justify-center rounded-md">
              <Spinner
                size="sm"
                color={!variant || variant === "primary" ? "black" : "white"}
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
        className={cn(buttonVariants({ variant, size, format }), className)}
        disabled={disabled || loading}
      >
        {renderInner()}
      </Component>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
