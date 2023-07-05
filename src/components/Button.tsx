import { cloneElement } from "react";
import { ComponentProps, deriveClassed } from "@tw-classed/react";
import { classed, cn } from "~/lib/utils";
import Spinner from "~/components/Spinner";

const BaseButton = classed("button", {
  base: "relative inline-flex items-center focus:outline-none focus:ring-2 focus:ring-emerald-500 space-x-1 justify-center transition",
  variants: {
    variant: {
      normal:
        "border-border bg-black hover:bg-zinc-900 hover:text-white disabled:hover:bg-black border shadow-sm",
      primary:
        "bg-emerald-400/10 text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/10 hover:text-emerald-300 hover:border-emerald-300 border shadow-sm",
      text: "text-emerald-500 hover:text-emerald-300",
      transparent: "bg-transparent hover:bg-zinc-900 hover:text-white",
      plain: "",
    },
    size: {
      none: "px-0 py-0",
      sm: "px-3 py-1 text-xs",
      md: "px-4 py-2 text-sm",
    },
    shape: {
      pill: "rounded-full",
      square: "rounded",
    },
    selected: {
      true: "bg-emerald-400/10 border-emerald-400/20",
    },
    iconOnly: {
      true: "px-3 py-3",
    },
  },
  defaultVariants: {
    variant: "normal",
    size: "md",
    shape: "pill",
  },
});

const renderIcon = (
  icon: ButtonProps["startIcon"],
  iconClassName: ButtonProps["iconClassName"],
  iconSize: ButtonProps["iconSize"]
) => {
  const iconProps = { width: iconSize || 24, height: iconSize || 24 };

  return cloneElement(icon as React.ReactElement, {
    style: { flexShrink: 0 },
    className: iconClassName,
    ...iconProps,
  });
};

export type ButtonProps = ComponentProps<typeof BaseButton> & {
  loading?: boolean;
  contentClassName?: string;
  iconClassName?: string;
  startIcon?: string | React.ReactNode;
  endIcon?: string | React.ReactNode;
  iconSize?: number;
};

export const Button = deriveClassed<typeof BaseButton, ButtonProps>(
  (
    {
      children,
      startIcon,
      endIcon,
      iconSize,
      iconClassName,
      contentClassName,
      disabled,
      loading,
      ...props
    },
    ref
  ) => {
    const hasIcon = !!startIcon || !!endIcon;
    const hasContent = !!children;

    return (
      <BaseButton
        disabled={disabled || !!loading}
        iconOnly={hasIcon && !hasContent}
        ref={ref}
        {...props}
      >
        <Spinner
          className={cn(
            "absolute border-white opacity-0 transition duration-300",
            !!loading && "opacity-100"
          )}
        />
        <div
          className={cn(
            "transition duration-300",
            loading && "opacity-0",
            disabled && "opacity-50",
            contentClassName
          )}
        >
          {startIcon && renderIcon(startIcon, iconClassName, iconSize)}
          {children}
          {endIcon && renderIcon(endIcon, iconClassName, iconSize)}
        </div>
      </BaseButton>
    );
  }
);
