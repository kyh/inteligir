"use client";
// @license MIT, vendored from Fluid Functionalism (github.com/mickadesign/fluid-functionalism).

import type { CSSProperties, ReactNode, RefAttributes } from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";

import { Tooltip } from "@repo/ui/components/tooltip";
import type { IconComponent } from "@repo/ui/lib/icon";
import { radius } from "@repo/ui/lib/radius";
import { childList, isTextChild } from "@repo/ui/lib/text-children";
import { cn } from "@repo/ui/lib/cn";

const buttonStructure = cva(
  [
    "group relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center outline-none select-none whitespace-nowrap",
    "transition-colors duration-80",
    "disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:ring-1 focus-visible:ring-focus-ring",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    compoundVariants: [
      { className: "pl-[6px]", iconLeft: true, size: "compact" },
      { className: "pl-[10px]", iconLeft: true, size: "default" },
    ],
    defaultVariants: {
      size: "compact",
      variant: "primary",
    },
    variants: {
      iconLeft: { true: "" },
      size: {
        compact: "h-7 gap-1 px-3 text-body [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-9 gap-1.5 px-4 text-subtitle",
        icon: "h-9 w-9 p-0",
        "icon-compact": "h-7 w-7 p-0 [&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        destructive: "text-red-700 dark:text-red-400",
        ghost: "text-muted-foreground hover:text-foreground",
        primary: "text-background",
        secondary: "text-foreground",
        tertiary: "text-foreground",
      },
    },
  },
);

type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "destructive";

type ButtonSize = "default" | "compact" | "icon" | "icon-compact";

const bgVariants = {
  destructive:
    "[--btn-bg:color-mix(in_oklab,var(--color-red-500)_15%,transparent)] group-hover:[--btn-bg:color-mix(in_oklab,var(--color-red-500)_25%,transparent)] group-active:[--btn-bg:color-mix(in_oklab,var(--color-red-500)_15%,transparent)] dark:[--btn-bg:color-mix(in_oklab,var(--color-red-500)_20%,transparent)] dark:group-hover:[--btn-bg:color-mix(in_oklab,var(--color-red-500)_30%,transparent)] dark:group-active:[--btn-bg:color-mix(in_oklab,var(--color-red-500)_20%,transparent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  ghost:
    "bg-transparent shadow-[0_0_0_1px_transparent] group-hover:bg-hover group-hover:shadow-[0_0_0_1px_var(--hover)] group-active:bg-active group-active:shadow-[0_0_0_0px_var(--active)]",
  primary:
    "[--btn-bg:var(--foreground)] group-hover:[--btn-bg:color-mix(in_oklab,var(--foreground)_90%,var(--background))] group-active:[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--tint)] group-hover:[--btn-bg:var(--tint-hover)] group-active:[--btn-bg:var(--tint)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  tertiary:
    "bg-transparent shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-hover:bg-hover group-active:bg-active group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
} satisfies Record<ButtonVariant, string>;

const activeBgVariants = {
  destructive:
    "[--btn-bg:color-mix(in_oklab,var(--color-red-500)_25%,transparent)] dark:[--btn-bg:color-mix(in_oklab,var(--color-red-500)_30%,transparent)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  ghost: "bg-active shadow-[0_0_0_1px_var(--active)] group-active:shadow-[0_0_0_0px_var(--active)]",
  primary:
    "[--btn-bg:color-mix(in_oklab,var(--foreground)_80%,var(--background))] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  secondary:
    "[--btn-bg:var(--tint)] bg-[var(--btn-bg)] shadow-[0_0_0_1px_var(--btn-bg)] group-active:shadow-[0_0_0_0px_var(--btn-bg)]",
  tertiary:
    "bg-active shadow-[0_0_0_1px_var(--border),inset_0_0_0_0px_var(--border)] group-active:shadow-[0_0_0_0px_var(--border),inset_0_0_0_1px_var(--border)]",
} satisfies Record<ButtonVariant, string>;

const flatBgVariants = {
  destructive: "bg-red-500/15 hover:bg-red-500/25 dark:bg-red-500/20 dark:hover:bg-red-500/30",
  ghost: "bg-transparent hover:bg-hover active:bg-active",
  primary: "bg-foreground hover:bg-foreground/90 active:bg-foreground/80",
  secondary: "bg-tint hover:bg-[var(--tint-hover)]",
  tertiary: "bg-transparent shadow-[inset_0_0_0_1px_var(--border)] hover:bg-hover active:bg-active",
} satisfies Record<ButtonVariant, string>;

const buttonVariants = (props?: {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  className?: string;
}) => {
  const variant = props?.variant ?? "primary";
  const size = props?.size ?? "compact";

  return cn(buttonStructure({ size, variant }), flatBgVariants[variant], props?.className);
};

interface ButtonProps extends Omit<ButtonPrimitive.Props, "className" | "style"> {
  className?: string;
  style?: CSSProperties;
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: IconComponent;
  active?: boolean;
}

const labelTrimClass = "[text-box:trim-both_cap_alphabetic]";

const labelChildren = (children: ReactNode) => {
  const nodes = childList(children);
  const out: ReactNode[] = [];
  let run: ReactNode[] = [];

  const flush = (key: number) => {
    if (run.length > 0) {
      out.push(
        <span key={`text-${String(key)}`} className={labelTrimClass}>
          {run}
        </span>,
      );
      run = [];
    }
  };

  for (const [index, node] of nodes.entries()) {
    if (isTextChild(node)) {
      run.push(node);
    } else {
      flush(index);
      out.push(node);
    }
  }

  flush(nodes.length);

  return out;
};

interface ButtonLabelProps {
  children: ReactNode;
  iconSize: number;
  isIconOnly: boolean;
  leadingIcon: IconComponent | undefined;
}

const ButtonLabel = ({
  children,
  iconSize,
  isIconOnly,
  leadingIcon: LeadingIcon,
}: ButtonLabelProps) => {
  if (isIconOnly) {
    return (
      <span className="inline-flex items-center gap-[inherit] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 [&_svg]:stroke-[1.5] group-hover:[&_svg]:stroke-[2]">
        {labelChildren(children)}
      </span>
    );
  }

  return (
    <>
      {LeadingIcon && (
        <LeadingIcon
          size={iconSize}
          strokeWidth={1.5}
          className="transition-[stroke-width] duration-80 group-hover:stroke-[2]"
        />
      )}
      {labelChildren(children)}
    </>
  );
};

const Button = ({
  className,
  variant,
  size,
  leadingIcon: LeadingIcon,
  active = false,
  disabled,
  children,
  style,
  "aria-label": ariaLabel,
  title,
  ref,
  ...props
}: ButtonProps & RefAttributes<HTMLButtonElement>) => {
  const resolvedSize: ButtonSize = size ?? "compact";
  const resolvedVariant = variant ?? "primary";
  const isIconOnly = resolvedSize === "icon" || resolvedSize === "icon-compact";
  const isCompact = resolvedSize === "compact" || resolvedSize === "icon-compact";
  const iconSize = isCompact ? 14 : 16;
  const bgClass = active ? activeBgVariants[resolvedVariant] : bgVariants[resolvedVariant];

  const internals = (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute inset-px rounded-[inherit] transition-[box-shadow,background-color] [transition-duration:180ms,80ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1),ease] group-active:[transition-duration:80ms,80ms]",
          bgClass,
        )}
      />
      <span className="relative inline-flex items-center justify-center gap-[inherit]">
        <ButtonLabel iconSize={iconSize} isIconOnly={isIconOnly} leadingIcon={LeadingIcon}>
          {children}
        </ButtonLabel>
      </span>
    </>
  );

  const rootClassName = cn(
    buttonStructure({
      iconLeft: !isIconOnly && !!LeadingIcon,
      size: resolvedSize,
      variant: resolvedVariant,
    }),
    radius.button,
    className,
  );

  const iconLabel = isIconOnly ? (ariaLabel ?? title) : undefined;

  const element = (
    <ButtonPrimitive
      ref={ref}
      className={rootClassName}
      disabled={disabled}
      style={style}
      aria-label={ariaLabel ?? iconLabel}
      title={isIconOnly ? undefined : title}
      {...props}
    >
      {internals}
    </ButtonPrimitive>
  );

  return iconLabel === undefined ? element : <Tooltip content={iconLabel}>{element}</Tooltip>;
};

export { Button, buttonVariants };
