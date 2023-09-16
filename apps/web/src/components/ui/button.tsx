import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  "focus-visible:ring-brand-950 dark:focus-visible:ring-brand-300 relative inline-flex items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default:
          "text-brand-50 bg-brand-900 hover:bg-brand-900/90 disabled:bg-brand-900/70 dark:bg-brand-50 dark:text-brand-900 dark:hover:bg-brand-50/90 dark:disabled:bg-brand-50/70 shadow dark:[--spinner-color:#000]",
        secondary:
          "bg-brand-100 text-brand-900 hover:bg-brand-100/80 dark:bg-brand-800 dark:text-brand-50 dark:hover:bg-brand-800/80 shadow-sm",
        destructive:
          "text-brand-50 dark:text-brand-50 bg-red-500 shadow-sm hover:bg-red-500/90 dark:bg-red-900 dark:hover:bg-red-900/90",
        outline:
          "border-brand-200 hover:bg-brand-100 hover:text-brand-900 dark:border-brand-800 dark:hover:bg-brand-800 dark:hover:text-brand-50 border bg-transparent shadow-sm",
        ghost:
          "hover:bg-brand-100 hover:text-brand-900 dark:hover:bg-brand-800 dark:hover:text-brand-50",
        link: "text-brand-900 dark:text-brand-50 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, disabled, loading, children, ...props },
    ref,
  ) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        <>
          <Spinner
            className={cn(
              "absolute border-white opacity-0 transition duration-300",
              loading && "opacity-100",
            )}
          />
          <div
            className={cn(
              "transition duration-300",
              loading && "opacity-0",
              disabled && "opacity-50",
            )}
          >
            {children}
          </div>
        </>
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
