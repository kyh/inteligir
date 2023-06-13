import { cloneElement } from "react";
import { ComponentProps, deriveClassed } from "@tw-classed/react";
import { classed } from "~/lib/utils/cn";
import Spinner from "~/components/Spinner";

const BaseButton = classed("button", {
  base: "relative inline-flex items-center focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40 space-x-1 justify-center transition",
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
    loading: {
      true: "",
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
  iconClassName?: string;
  startIcon?: string | React.ReactNode;
  endIcon?: string | React.ReactNode;
  iconSize?: number;
  href?: string;
};

export const Button = deriveClassed<typeof BaseButton, ButtonProps>(
  (
    {
      children,
      startIcon,
      endIcon,
      iconSize,
      iconClassName,
      disabled,
      ...props
    },
    ref
  ) => {
    const hasIcon = !!startIcon || !!endIcon;
    const hasContent = !!children;

    return (
      <BaseButton
        disabled={disabled || !!props.loading}
        iconOnly={hasIcon && !hasContent}
        ref={ref}
        {...props}
      >
        {!!props.loading && <Spinner className="absolute mx-auto fill-white" />}
        {startIcon && renderIcon(startIcon, iconClassName, iconSize)}
        {children}
        {endIcon && renderIcon(endIcon, iconClassName, iconSize)}
      </BaseButton>
    );
  }
);
