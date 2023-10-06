"use client";

import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import * as React from "react";
import { EyeIcon, EyeOffIcon, SearchIcon } from "../icons";
import { cn } from "../lib/cn";

const inputBaseStyles = cn(
  "relative w-full appearance-none rounded-md bg-ui-bg-field text-ui-fg-base placeholder-ui-fg-muted caret-ui-fg-base shadow-borders-base outline-none transition-fg hover:bg-ui-bg-field-hover",
  "focus:shadow-borders-interactive-with-active",
  "disabled:cursor-not-allowed disabled:!bg-ui-bg-disabled disabled:text-ui-fg-disabled disabled:placeholder-ui-fg-disabled",
  "aria-[invalid=true]:!shadow-borders-error",
);

const inputVariants = cva(
  cn(
    inputBaseStyles,
    "[&::--webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
  ),
  {
    variants: {
      size: {
        md: "h-10 px-3 py-[9px] text-sm",
        sm: "h-8 px-2 py-[5px] text-xs",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const Input = React.forwardRef<
  HTMLInputElement,
  VariantProps<typeof inputVariants> &
    Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">
>(({ className, type, size = "md", ...props }, ref) => {
  const [typeState, setTypeState] = React.useState(type);

  const isPassword = type === "password";
  const isSearch = type === "search";

  return (
    <div className="relative">
      <input
        className={cn(
          inputVariants({ size }),
          {
            "pr-11": isPassword && size === "md",
            "pl-11": isSearch && size === "md",
            "pr-9": isPassword && size === "sm",
            "pl-9": isSearch && size === "sm",
          },
          className,
        )}
        ref={ref}
        type={isPassword ? typeState : type}
        {...props}
      />
      {isSearch ? (
        <div
          className={cn(
            "absolute bottom-0 left-0 flex items-center justify-center text-ui-fg-muted",
            {
              "h-10 w-11": size === "md",
              "h-8 w-9": size === "sm",
            },
          )}
          role="img"
        >
          <SearchIcon className="h-5 w-5" />
        </div>
      ) : null}
      {isPassword ? (
        <div
          className={cn(
            "absolute bottom-0 right-0 flex w-11 items-center justify-center",
            {
              "h-10 w-11": size === "md",
              "h-8 w-9": size === "sm",
            },
          )}
        >
          <button
            className="focus:shadow-borders-interactive-w-focus h-fit w-fit rounded-sm text-ui-fg-muted outline-none transition-all hover:text-ui-fg-base focus:text-ui-fg-base active:text-ui-fg-base"
            onClick={() => {
              setTypeState(typeState === "password" ? "text" : "password");
            }}
            type="button"
          >
            <span className="sr-only">
              {typeState === "password" ? "Show password" : "Hide password"}
            </span>
            {typeState === "password" ? (
              <EyeIcon className="h-5 w-5" />
            ) : (
              <EyeOffIcon className="h-5 w-5" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
});
Input.displayName = "Input";

export { Input, inputBaseStyles };
