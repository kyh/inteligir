import { cloneElement } from "react";
import { ComponentProps, classed, deriveClassed } from "@tw-classed/react";
import Spinner from "~/components/Spinner";

const BaseButton = classed("button", {
  base: "inline-flex items-center border shadow-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40 flex space-x-1 justify-center",
  variants: {
    variant: {
      normal:
        "border-white/20 bg-black-700 hover:bg-gray-900 hover:text-white disabled:hover:bg-black",
      primary:
        "bg-emerald-400/10 text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/10 hover:text-emerald-300 hover:border-emerald-300",
      outline:
        "text-gray-400 border-white/20 hover:bg-white/5 hover:text-white",
      text: "text-emerald-500 hover:text-emerald-300 shadow-none border-0",
    },
    size: {
      none: "px-0 py-0",
      sm: "px-3 py-1 text-xs",
      md: "px-4 py-2 text-sm",
    },
    shape: {
      normal: "rounded-full",
      square: "rounded",
    },
    selected: {
      true: "bg-emerald-400/10 border-emerald-400/20",
    },
    loading: {
      true: "",
    },
    iconOnly: {
      true: "",
    },
  },
  defaultVariants: {
    variant: "normal",
    size: "md",
    shape: "normal",
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
  contentClassName?: string;
  iconClassName?: string;
  startIcon?: string | React.ReactNode;
  endIcon?: string | React.ReactNode;
  iconSize?: number;
  href?: string;
};

const Button = deriveClassed<typeof BaseButton, ButtonProps>(
  (
    {
      children,
      startIcon,
      endIcon,
      iconSize,
      contentClassName,
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
        {!!props.loading && (
          <span className="">
            <Spinner className="mx-auto fill-white" />
          </span>
        )}
        {startIcon && (
          <span>{renderIcon(startIcon, iconClassName, iconSize)}</span>
        )}
        <span>{children}</span>
        {endIcon && <span>{renderIcon(endIcon, iconClassName, iconSize)}</span>}
      </BaseButton>
    );
  }
);

export default Button;
